// Experimental stationary occupancy: compare real channel shapes from each
// radio. Fitting and independent validation are deliberately separate steps.
import {channelShape} from './temporal-model.mjs';
const mean=v=>v.reduce((a,b)=>a+b,0)/v.length;
const centroid=frames=>Array.from({length:54},(_,k)=>mean(frames.map(f=>f.shape[k])));
const distance=(a,b)=>mean(a.map((v,k)=>(v-b[k])**2));
export function presenceWindows(capture,nodeIds){
  const maps=new Map(nodeIds.map(id=>[id,[]])),keys=new Map(),grids=new Map();
  for(const f of capture.frames){
    for(const id of nodeIds){
      const n=f.nodes?.find(n=>n.node_id===id),feature=f.node_features?.find(n=>n.node_id===id),shape=channelShape(n?.amplitude);
      if(!shape||feature?.stale||!Number.isFinite(feature?.last_seen_ms)||feature.last_seen_ms>250||!Number.isFinite(f.timestamp))continue;
      if(!Number.isInteger(n.subcarrier_count)||n.subcarrier_count<56)continue;
      const key=JSON.stringify(n.amplitude);if(key===keys.get(id))continue;keys.set(id,key);
      if(grids.has(id)&&grids.get(id)!==n.subcarrier_count)throw new Error('Grid changed during presence capture');
      grids.set(id,n.subcarrier_count);const list=maps.get(id);if(list.length&&f.timestamp<=list.at(-1).timestamp)continue;
      list.push({timestamp:f.timestamp,shape});
    }
  }
  if([...maps.values()].some(f=>f.length<100))throw new Error('Insufficient measured presence samples');
  const start=Math.max(...[...maps.values()].map(v=>v[0].timestamp)),end=Math.min(...[...maps.values()].map(v=>v.at(-1).timestamp));
  const windows=[];
  for(let t=start;t+2<=end;t+=2){
    const nodes=nodeIds.map(id=>{
      const f=maps.get(id).filter(f=>f.timestamp>=t&&f.timestamp<t+2);
      if(f.length<12||f.at(-1).timestamp-f[0].timestamp<1.8||f.some((f,i,a)=>i&&f.timestamp-a[i-1].timestamp>.5))return null;
      return {node_id:id,subcarrier_count:grids.get(id),shape:centroid(f)};
    });
    if(nodes.every(Boolean))windows.push({timestamp:t,nodes});
  }
  return {windows,possible:Math.floor((end-start)/2)};
}
export function fitPresenceReference(empty,seated,nodeIds){
  if(empty.label!=='empty'||seated.label!=='stationary')throw new Error('Known empty and seated captures required');
  const a=presenceWindows(empty,nodeIds),b=presenceWindows(seated,nodeIds);
  if(a.windows.length<10||b.windows.length<10)throw new Error('Need at least ten complete paired windows per condition');
  const nodes=nodeIds.map(id=>{
    const x=a.windows.map(w=>w.nodes.find(n=>n.node_id===id)),y=b.windows.map(w=>w.nodes.find(n=>n.node_id===id));
    if(x[0].subcarrier_count!==y[0].subcarrier_count)throw new Error('Presence grids differ');
    const absent=centroid(x),present=centroid(y);
    return {node_id:id,subcarrier_count:x[0].subcarrier_count,empty:absent,seated:present,
      empty_radius:Math.max(1e-10,...x.map(f=>distance(f.shape,absent)))*4,
      seated_radius:Math.max(1e-10,...y.map(f=>distance(f.shape,present)))*4};
  });
  return {version:1,algorithm:'paired_stationary_channel_shape_v1',created_at:new Date().toISOString(),validated:false,nodes,
    fitting_windows:{empty:a.windows.length,seated:b.windows.length}};
}
export function classifyPresence(model,window){
  const scores=[];
  for(const reference of model.nodes){
    const n=window.nodes.find(n=>n.node_id===reference.node_id);
    if(!n||n.subcarrier_count!==reference.subcarrier_count)return {status:'unavailable',reason:'missing_or_changed_radio'};
    const empty=distance(n.shape,reference.empty),seated=distance(n.shape,reference.seated);
    if(empty>reference.empty_radius&&seated>reference.seated_radius)return {status:'unavailable',reason:'outside_reference_shapes'};
    scores.push((empty-seated)/(empty+seated+1e-12));
  }
  const score=mean(scores);
  if(Math.abs(score)<.2)return {status:'unavailable',reason:'ambiguous_channel_shape',score};
  return {status:'experimental',label:score>0?'present':'absent',score,validated:false};
}
export function evaluatePresence(model,capture,expected){
  const data=presenceWindows(capture,model.nodes.map(n=>n.node_id));
  const results=data.windows.map(w=>classifyPresence(model,w));
  return {expected,total_windows:data.possible,complete_windows:results.length,
    matched:results.filter(r=>r.label===expected).length,wrong:results.filter(r=>r.label&&r.label!==expected).length,
    unavailable:data.possible-results.filter(r=>r.label).length,results};
}
