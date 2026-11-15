import {createHash} from 'node:crypto';
import {channelShape} from './temporal-model.mjs';
import {MOTION_ALGORITHM,motionWindow} from './motion-reference.mjs';

export function loadMotionReference(text) {
  const model=JSON.parse(text);
  if(model.version!==1||model.algorithm!==MOTION_ALGORITHM||!Array.isArray(model.nodes)||!model.nodes.length||
    new Set(model.nodes.map(n=>n.node_id)).size!==model.nodes.length||model.nodes.some(n=>
      !Number.isInteger(n.node_id)||n.node_id<0||n.node_id>255||!Number.isInteger(n.subcarrier_count)||n.subcarrier_count<56||
      !Number.isFinite(n.motion_threshold)||n.motion_threshold<=0))throw new Error('Invalid per-node motion reference');
  return {...model,id:createHash('sha256').update(text).digest('hex')};
}

export function createMultiNodeMotion(model,{clock=()=>Date.now()}={}) {
  const states=new Map(model.nodes.map(n=>[n.node_id,{history:[],lastTime:-Infinity,lastArrival:0,key:null,tick:null,result:null}]));
  return frame=>{
    if(frame?.type!=='sensing_update')return null;
    const now=clock();
    const decisions=model.nodes.map(reference=>{
      const id=reference.node_id,s=states.get(id);
      const unavailable=reason=>({node_id:id,status:'unavailable',reason});
      const reset=reason=>{s.history=[];s.result=null;s.key=null;s.lastTime=-Infinity;return unavailable(reason);};
      const node=frame.nodes?.find(n=>n.node_id===id),feature=frame.node_features?.find(n=>n.node_id===id);
      if(frame.source!=='esp32'||!node||!feature||feature.stale||!Number.isFinite(feature.last_seen_ms)||feature.last_seen_ms>250||
        !Number.isFinite(frame.timestamp)||Math.abs(now/1000-frame.timestamp)>1)return reset('node_not_fresh');
      const shape=channelShape(node.amplitude);
      if(shape&&node.subcarrier_count!==reference.subcarrier_count)return reset('csi_grid_changed');
      if(!shape)return s.result&&now-s.lastArrival<=500?s.result:unavailable('raw_csi_unavailable');
      const key=JSON.stringify(node.amplitude);
      if(frame.timestamp<=s.lastTime||frame.tick===s.tick||key===s.key)
        return s.result&&now-s.lastArrival<=500?s.result:unavailable('awaiting_changed_raw_sample');
      if(frame.timestamp-s.lastTime>.5)s.history=[];
      s.lastTime=frame.timestamp;s.lastArrival=now;s.tick=frame.tick;s.key=key;
      s.history.push({timestamp:frame.timestamp,shape});s.history=s.history.filter(f=>frame.timestamp-f.timestamp<=2);
      const value=motionWindow(s.history);
      s.result=value?{node_id:id,status:'live',label:value.motion>reference.motion_threshold?'movement_detected':'no_movement',
        motion:value.motion,motion_threshold:reference.motion_threshold,source_tick:frame.tick}:null;
      return s.result||unavailable('temporal_window_warming');
    });
    const moving=decisions.some(d=>d.status==='live'&&d.label==='movement_detected');
    const complete=decisions.every(d=>d.status==='live');
    return {status:moving||complete?'live':'unavailable',label:moving?'movement_detected':complete?'no_movement':null,
      reason:moving||complete?null:'incomplete_node_coverage',nodes:decisions,model_id:model.id,model_version:1,source_tick:frame.tick,
      scope:'channel_motion_only',inference_method:MOTION_ALGORITHM,confidence:null,
      coverage:complete?'complete':'partial',required_nodes:model.nodes.length,contributing_nodes:decisions.filter(d=>d.status==='live').length};
  };
}

export function applyMultiNodeMotion(frame,decision) {
  if(frame?.type!=='sensing_update')return frame;
  const calibrated=decision?.calibrated_presence;
  const classification={motion_level:decision?.status==='live'?decision.label:'unavailable',presence:calibrated?.status==='live'?calibrated.presence:null,confidence:null,inference_method:MOTION_ALGORITHM,
    presence_inference_method:calibrated?.status==='live'?'validated_calibrated_link':null,presence_node_id:calibrated?.status==='live'?calibrated.node_id:null};
  return {...frame,upstream_classification:frame.classification,upstream_room_inference:frame.room_inference,
    upstream_estimated_persons:frame.estimated_persons,upstream_vital_signs:frame.vital_signs,upstream_persons:frame.persons,
    estimated_persons:null,vital_signs:null,persons:null,pose_keypoints:null,posture:null,classification,
    room_inference:{classification:classification.motion_level,confidence:null,contributing_nodes:decision?.contributing_nodes||0},
    nodes:frame.nodes?.map(n=>{const d=decision?.nodes.find(d=>d.node_id===n.node_id);return {...n,upstream_node_inference:n.node_inference,
      node_inference:{...n.node_inference,classification:d?.status==='live'?d.label:d?'unavailable':'untrained',confidence:null}};}),
    node_features:frame.node_features?.map(n=>{const d=decision?.nodes.find(d=>d.node_id===n.node_id);return {...n,upstream_classification:n.classification,
      classification:{...classification,presence:n.node_id===calibrated?.node_id?classification.presence:null,motion_level:d?.status==='live'?d.label:d?'unavailable':'untrained'}};}),local_activity:decision};
}
