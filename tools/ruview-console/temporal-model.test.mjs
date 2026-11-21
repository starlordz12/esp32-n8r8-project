import test from 'node:test';import assert from 'node:assert/strict';
import {channelShape,temporalWindow,trainTemporal,loadTemporal,temporalDecision,createTemporalDetector,applyTemporalDecision} from './temporal-model.mjs';
const shape=(state,t)=>[200+t,150-t,...Array.from({length:54},(_,i)=>10+(state==='absent'?(i%4):i%7)+(state==='present_moving'?Math.sin(t*8+i*.4)*3:0))];
const captures=()=>['absent','present_still','present_moving'].map(label=>({label,frames:Array.from({length:600},(_,i)=>({timestamp:i*.05,amplitude:shape(label,i*.05),subcarrier_count:128}))}));
test('temporal motion is zero for a static channel despite global gain and invalid first-word changes',()=>{
 const frames=Array.from({length:40},(_,i)=>({timestamp:i*.05,shape:channelShape(shape('absent',i).map((v,j)=>j<2?v:v*(1+i*.03)))}));
 assert.ok(temporalWindow(frames).motion<1e-25);
});
test('temporal candidate holds out entire time windows and distinguishes new stationary and moving windows',()=>{
 const trained=trainTemporal(captures(),42),model=loadTemporal(JSON.stringify(trained));
 for(const label of ['absent','present_still','present_moving']){
   const frames=Array.from({length:40},(_,i)=>({timestamp:i*.05,shape:channelShape(shape(label,40+i*.05))}));
   assert.equal(temporalDecision(model,temporalWindow(frames)).label,label);
 }
 assert.ok(Object.values(trained.capture_holdout).every(r=>r.matched===r.total));
});
test('temporal detector rejects stale, wrong radio, changed grid and untrained output instead of recycling heuristic labels',()=>{
 const model=loadTemporal(JSON.stringify(trainTemporal(captures(),42))),detect=createTemporalDetector(model);
 const frame={type:'sensing_update',source:'esp32',timestamp:Date.now()/1000,tick:1,nodes:[{node_id:42,amplitude:shape('absent',0),subcarrier_count:128}],node_features:[{node_id:42,stale:false,last_seen_ms:0}],classification:{motion_level:'present_moving'}};
 assert.equal(detect({...frame,timestamp:frame.timestamp-10}).status,'unavailable');
 assert.equal(detect({...frame,nodes:[{...frame.nodes[0],subcarrier_count:64}]}).reason,'csi_grid_changed');
 assert.equal(detect({...frame,node_features:[{node_id:9}]}).status,'unavailable');
 const output=applyTemporalDecision(frame,{status:'unavailable',reason:'test'},42);
 assert.equal(output.classification.motion_level,'unavailable');
 assert.equal(output.upstream_classification.motion_level,'present_moving');
});
test('new single-node ticks with identical samples are valid stationary CSI, not a frozen snapshot',()=>{
 const model=loadTemporal(JSON.stringify(trainTemporal(captures(),42))),detect=createTemporalDetector(model);
 const now=Date.now()/1000;let result;
 for(let i=0;i<40;i++)result=detect({type:'sensing_update',source:'esp32',timestamp:now-1.95+i*.05,tick:i,
   nodes:[{node_id:42,amplitude:shape('absent',0),subcarrier_count:128}],node_features:[{node_id:42,stale:false,last_seen_ms:0}]});
 assert.equal(result.status,'live');assert.equal(result.label,'absent');
});
test('motion-only decisions do not infer occupancy or publish unvalidated people/vitals',()=>{
 const model=loadTemporal(JSON.stringify(trainTemporal(captures(),42))),detect=createTemporalDetector(model,{motionOnly:true});
 const now=Date.now()/1000;let result;
 for(let i=0;i<40;i++)result=detect({type:'sensing_update',source:'esp32',timestamp:now-1.95+i*.05,tick:i,
   nodes:[{node_id:42,amplitude:shape('absent',0),subcarrier_count:128}],node_features:[{node_id:42,stale:false,last_seen_ms:0}]});
 assert.equal(result.label,'no_movement');
 const output=applyTemporalDecision({type:'sensing_update',estimated_persons:1,vital_signs:{heart_rate_bpm:70}},result,42);
 assert.equal(output.classification.presence,null);assert.equal(output.estimated_persons,null);
 assert.equal(output.vital_signs,null);assert.equal(output.upstream_estimated_persons,1);
});
