import {createHash} from 'node:crypto';
const BINS=54, WINDOW=2;
export const TEMPORAL_ALGORITHM='normalized_channel_shape_temporal_v1';
export function channelShape(amplitude) {
  if(!Array.isArray(amplitude)||amplitude.length<56)return null;
  // S3 can report an invalid first CSI word. The current wire format omits
  // that flag, so conservatively exclude its two complex samples in all frames.
  const shape=amplitude.slice(2,56);
  if(!shape.every(v=>Number.isFinite(v)&&v>=0))return null;
  const norm=Math.hypot(...shape);return norm>1e-9?shape.map(v=>v/norm):null;
}
const distance=(a,b)=>a.reduce((s,v,i)=>s+(v-b[i])**2,0);
const quantile=(values,p)=>values.toSorted((a,b)=>a-b)[Math.floor((values.length-1)*p)];
const centroid=frames=>Array.from({length:BINS},(_,i)=>frames.reduce((s,f)=>s+f.shape[i],0)/frames.length);
export function temporalWindow(frames) {
  if(frames.length<20||frames.at(-1).timestamp-frames[0].timestamp<1.8)return null;
  const deltas=[];
  for(let i=1,j=0;i<frames.length;i++) {
    const dt=frames[i].timestamp-frames[i-1].timestamp;
    if(dt<=0||dt>.25)return null;
    while(j+1<i&&frames[j+1].timestamp<=frames[i].timestamp-.5)j++;
    const lag=frames[i].timestamp-frames[j].timestamp;
    if(lag>=.4&&lag<=.65)deltas.push(distance(frames[i].shape,frames[j].shape));
  }
  if(deltas.length<10)return null;
  return {shape:centroid(frames),motion:quantile(deltas,.75),frames:frames.length};
}
function captureWindows(capture) {
  const frames=capture.frames.map(f=>({...f,shape:channelShape(f.amplitude)})).filter(f=>f.shape);
  if(frames.length<100)throw new Error('Not enough complete raw CSI frames');
  const windows=[];
  for(let t=frames[0].timestamp;t+WINDOW<=frames.at(-1).timestamp;t+=WINDOW){
    const value=temporalWindow(frames.filter(f=>f.timestamp>=t&&f.timestamp<t+WINDOW));
    if(value)windows.push({...value,label:capture.label});
  }
  if(windows.length<10)throw new Error('Capture requires at least 20 seconds of continuous CSI');
  return windows;
}
export function temporalDecision(model,value) {
  if(value.motion>model.motion_threshold)return {label:'present_moving',motion:value.motion};
  const absent=distance(value.shape,model.profiles.absent),still=distance(value.shape,model.profiles.present_still);
  const margin=Math.abs(absent-still)/(absent+still+1e-12);
  const label=absent<still?'absent':'present_still';
  if(margin<model.min_shape_margin||Math.min(absent,still)>model.shape_radius[label])
    return {label:null,reason:'channel_shape_outside_training',motion:value.motion};
  return {label,motion:value.motion,shape_margin:margin};
}
export function trainTemporal(captures,nodeId) {
  const labels=['absent','present_still','present_moving'];
  if(captures.length!==3||!labels.every(l=>captures.filter(c=>c.label===l).length===1))throw new Error('Capture all three known conditions');
  const grids=new Set(captures.flatMap(c=>c.frames.map(f=>f.subcarrier_count)));
  if(grids.size!==1||!Number.isInteger([...grids][0])||[...grids][0]<56)throw new Error('Capture one consistent subcarrier grid');
  const grouped=Object.fromEntries(captures.map(c=>[c.label,captureWindows(c)]));
  const fit={},held=[];
  for(const label of labels){const n=Math.floor(grouped[label].length*2/3);fit[label]=grouped[label].slice(0,n);held.push(...grouped[label].slice(n));}
  const profiles=Object.fromEntries(['absent','present_still'].map(label=>[label,centroid(fit[label])]));
  const stationary=[...fit.absent,...fit.present_still].map(w=>w.motion),moving=fit.present_moving.map(w=>w.motion);
  const quietMax=Math.max(...stationary),movingMin=Math.min(...moving);
  if(quietMax>=movingMin)throw new Error('Motion capture overlaps the stationary captures; do not activate');
  const staticWindows=[...fit.absent,...fit.present_still];
  const margin=w=>{const a=distance(w.shape,profiles.absent),b=distance(w.shape,profiles.present_still);return Math.abs(a-b)/(a+b+1e-12);};
  const model={version:3,algorithm:TEMPORAL_ALGORITHM,node_id:nodeId,bins:BINS,window_s:WINDOW,subcarrier_count:[...grids][0],
    profiles,motion_threshold:(quietMax+movingMin)/2,min_shape_margin:Math.min(...staticWindows.map(margin))/2,
    shape_radius:Object.fromEntries(['absent','present_still'].map(label=>[label,4*Math.max(...fit[label].map(w=>distance(w.shape,profiles[label])))])),
    trained_frames:Object.values(fit).flat().reduce((s,w)=>s+w.frames,0),training_windows:Object.values(fit).flat().length,
    created_at:new Date().toISOString(),validation_scope:'same_capture_temporal_holdout_only'};
  const report=Object.fromEntries(labels.map(label=>{const windows=held.filter(w=>w.label===label);return [label,{matched:windows.filter(w=>temporalDecision(model,w).label===label).length,total:windows.length}];}));
  return {...model,capture_holdout:report};
}
export function loadTemporal(text) {
  const model=JSON.parse(text);
  const vector=a=>Array.isArray(a)&&a.length===BINS&&a.every(Number.isFinite);
  if(model.version!==3||model.algorithm!==TEMPORAL_ALGORITHM||!Number.isInteger(model.node_id)||model.node_id<0||model.node_id>255||
    model.bins!==BINS||model.window_s!==WINDOW||!vector(model.profiles?.absent)||!vector(model.profiles?.present_still)||
    !Number.isInteger(model.subcarrier_count)||model.subcarrier_count<56||
    ![model.motion_threshold,model.min_shape_margin,model.shape_radius?.absent,model.shape_radius?.present_still].every(v=>Number.isFinite(v)&&v>0))throw new Error('Invalid temporal model');
  return {...model,id:createHash('sha256').update(text).digest('hex')};
}
export function createTemporalDetector(model, { motionOnly = false } = {}) {
  let history=[],fingerprint=null,lastTimestamp=null,lastTick=null,lastDecision=null,lastArrival=0;
  const unavailable=reason=>({status:'unavailable',reason,model_id:model.id});
  return frame=>{
    if(frame?.type!=='sensing_update')return null;
    const node=frame.nodes?.find(n=>n.node_id===model.node_id),feature=frame.node_features?.find(n=>n.node_id===model.node_id);
    if(frame.source!=='esp32'||!feature||feature.stale||feature.last_seen_ms>5000||frame.age_ms>5000)return unavailable('trained_node_not_fresh');
    const shape=channelShape(node?.amplitude),timestamp=frame.timestamp;
    if(!Number.isFinite(timestamp)||Math.abs(Date.now()/1000-timestamp)>5)return unavailable('complete_fresh_raw_csi_required');
    if(!shape)return lastDecision&&Date.now()-lastArrival<250?lastDecision:unavailable('complete_fresh_raw_csi_required');
    if(node.subcarrier_count!==model.subcarrier_count){history=[];lastDecision=null;return unavailable('csi_grid_changed');}
    if(lastTimestamp!==null&&timestamp<=lastTimestamp)return lastDecision&&Date.now()-lastArrival<500?lastDecision:unavailable('awaiting_new_csi_sample');
    const key=JSON.stringify(node.amplitude);
    if(lastTimestamp!==null&&timestamp-lastTimestamp>.25){history=[];lastDecision=null;}
    // A perfectly steady single-node channel can legitimately repeat the same
    // quantized samples on new ticks. Do not confuse stability with missing data.
    // With multiple nodes, unchanged snapshots cannot prove this node updated.
    if(lastTick===frame.tick||(frame.nodes.length>1&&key===fingerprint)){return lastDecision&&Date.now()-lastArrival<500?lastDecision:unavailable('awaiting_new_csi_sample');}
    fingerprint=key;lastTick=frame.tick;lastTimestamp=timestamp;lastArrival=Date.now();
    history.push({timestamp,shape});history=history.filter(f=>timestamp-f.timestamp<=WINDOW);
    const value=temporalWindow(history);
    if(!value)return unavailable('temporal_window_warming');
    const decision=motionOnly ? {label:value.motion>model.motion_threshold?'movement_detected':'no_movement',motion:value.motion}
      : temporalDecision(model,value);
    if(!decision.label)return unavailable(decision.reason);
    lastDecision={status:'live',model_id:model.id,model_version:3,node_id:model.node_id,label:decision.label,
      confidence:null,probabilities:{},inference_method:motionOnly?'normalized_channel_motion_v1':TEMPORAL_ALGORITHM,trained_frames:model.trained_frames,
      scope:motionOnly?'channel_motion_only':'trained_node_link_only',source_tick:frame.tick,motion:decision.motion,motion_threshold:model.motion_threshold};
    return lastDecision;
  };
}

export function applyTemporalDecision(frame,activity,nodeId) {
  if(frame?.type!=='sensing_update')return frame;
  const live=activity?.status==='live';
  const classification={motion_level:live?activity.label:'unavailable',presence:live&&activity.scope!=='channel_motion_only'?activity.label!=='absent':null,confidence:null,
    inference_method:activity?.inference_method};
  return {...frame,upstream_classification:frame.classification,upstream_room_inference:frame.room_inference,
    ...(activity?.scope==='channel_motion_only'?{upstream_estimated_persons:frame.estimated_persons,
      upstream_vital_signs:frame.vital_signs,upstream_persons:frame.persons,
      estimated_persons:null,vital_signs:null,persons:null,pose_keypoints:null,posture:null}:{}),
    classification,room_inference:{classification:classification.motion_level,confidence:null,contributing_nodes:live?1:0},
    nodes:frame.nodes?.map(n=>({...n,upstream_node_inference:n.node_inference,node_inference:{...n.node_inference,
      classification:n.node_id===nodeId?classification.motion_level:'untrained',confidence:null}})),
    node_features:frame.node_features?.map(n=>({...n,upstream_classification:n.classification,
      classification:n.node_id===nodeId?classification:{motion_level:'untrained',presence:null,confidence:null}})),
    local_activity:activity||{status:'unavailable',reason:'temporal_model_not_loaded'}};
}
