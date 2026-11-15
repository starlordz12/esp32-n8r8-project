import test from 'node:test';
import assert from 'node:assert/strict';
import {createMultiNodeMotion,loadMotionReference,applyMultiNodeMotion} from './multi-node-motion.mjs';
import {MOTION_ALGORITHM,motionWindow,fitMotionReference} from './motion-reference.mjs';
const model=()=>loadMotionReference(JSON.stringify({version:1,algorithm:MOTION_ALGORITHM,nodes:[1,2].map(node_id=>({node_id,subcarrier_count:128,motion_threshold:.001}))}));
const frame=(i,{missing=false,moving=false}={})=>({type:'sensing_update',source:'esp32',timestamp:100+i*.05,tick:i,
  nodes:[1,2].map(node_id=>({node_id,subcarrier_count:128,amplitude:missing&&node_id===2?[]:[0,0,...Array.from({length:54},(_,k)=>10+(k%5)+Math.sin(i*.3+k)*(moving&&node_id===2?4:.01))]})),
  node_features:[1,2].map(node_id=>({node_id,stale:false,last_seen_ms:0}))});
test('two-node room detects movement from node two and preserves occupancy unknown',()=>{
  let now,result;const detect=createMultiNodeMotion(model(),{clock:()=>now});
  for(let i=0;i<45;i++){const f=frame(i,{moving:true});now=f.timestamp*1000;result=detect(f);}
  assert.equal(result.label,'movement_detected');assert.equal(result.nodes[0].label,'no_movement');assert.equal(result.nodes[1].label,'movement_detected');
  const f=frame(44),out=applyMultiNodeMotion({...f,estimated_persons:2,vital_signs:{heart_rate:60}},result);
  assert.equal(out.classification.presence,null);assert.equal(out.estimated_persons,null);assert.equal(out.vital_signs,null);
  assert.equal(out.nodes[1].node_inference.classification,'movement_detected');
});
test('quiet room requires both nodes; duplicate or missing raw samples expire',()=>{
  let now,result;const detect=createMultiNodeMotion(model(),{clock:()=>now});
  for(let i=0;i<45;i++){const f=frame(i);now=f.timestamp*1000;result=detect(f);}
  assert.equal(result.label,'no_movement');
  for(let i=45;i<65;i++){const f=frame(i,{missing:true});now=f.timestamp*1000;result=detect(f);}
  assert.equal(result.status,'unavailable');assert.equal(result.nodes[0].status,'live');assert.equal(result.nodes[1].status,'unavailable');
  const f=frame(65);f.nodes[0].subcarrier_count=64;now=f.timestamp*1000;
  assert.equal(detect(f).nodes[0].reason,'csi_grid_changed');
});
test('transport ticks do not turn unchanged multi-node snapshots into fresh evidence',()=>{
  let now,result;const detect=createMultiNodeMotion(model(),{clock:()=>now});
  for(let i=0;i<45;i++){const f=frame(i);now=f.timestamp*1000;result=detect(f);}
  const frozen=frame(44);
  for(let i=45;i<65;i++){now=(100+i*.05)*1000;result=detect({...frozen,timestamp:now/1000,tick:i});}
  assert.equal(result.status,'unavailable');
});
test('sparse windows reject gaps longer than lag and malformed reference bindings',()=>{
  const frames=Array.from({length:30},(_,i)=>({timestamp:i*.07,shape:Array(54).fill(1)}));
  assert.equal(motionWindow(frames).motion,0);
  assert.equal(motionWindow(frames.filter(f=>f.timestamp<.5||f.timestamp>1.2)),null);
  assert.throws(()=>loadMotionReference(JSON.stringify({...model(),nodes:[model().nodes[0],model().nodes[0]]})));
  assert.throws(()=>fitMotionReference({label:'empty'},{label:'moving'},[1,2]));
});
