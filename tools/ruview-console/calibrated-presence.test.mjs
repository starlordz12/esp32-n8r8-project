import test from 'node:test';import assert from 'node:assert/strict';
import {readCalibratedPresence,validPresenceReceipt} from './calibrated-presence.mjs';
test('bound calibrated evidence can be inspected with two streaming radios but remains experimental',()=>{
 const now=Date.now(),identity={model_id:'m',session_id:'s',boot_epoch:'b',binding_digest:'d',source_node_ids:[1]};
 const health={...identity,checked_at_ms:now,status:'fresh',grid_binding:{status:'active'},sequence_fault_node_ids:[]};
 const frame={source:'esp32',timestamp:now/1000,tick:10,nodes:[{node_id:1},{node_id:2}],node_features:[{node_id:1,stale:false,last_seen_ms:0}],
 calibrated_presence_evidence:{...identity,schema:'ruview.calibration.calibrated-presence-evidence.v2',inference_node_id:1,source_tick:10,observed_at_unix_ms:now,presence:true}};
 assert.equal(readCalibratedPresence(frame,health,now).status,'experimental');
 for(const bad of [{...health,status:'stale'},{...health,sequence_fault_node_ids:[1]},{...health,checked_at_ms:now-6000},{...health,model_id:'other'},{...health,source_node_ids:[2]}])assert.equal(readCalibratedPresence(frame,bad,now).presence,null);
 assert.equal(readCalibratedPresence({...frame,source:'simulated'},health,now).presence,null);
 assert.equal(readCalibratedPresence({...frame,tick:11},health,now).presence,null);
});
test('presence authorization needs passing independent empty and occupied trials for the exact baseline',()=>{
 const now=Date.now(),e={model_id:'m',session_id:'s',boot_epoch:'b',binding_digest:'d',inference_node_id:1};
 const receipt={...e,node_id:1,version:1,kind:'calibrated_presence_independent_trials',created_at_ms:now,
   trials:[false,true].map(expected=>({...e,node_id:1,expected,identity_changed:false,duration_s:30,unique_frames:100,matched:100,wrong:0,unavailable:10}))};
 assert.equal(validPresenceReceipt(receipt,e,now),true);
 for(const bad of [{...receipt,model_id:'other'},{...receipt,trials:receipt.trials.slice(1)},{...receipt,created_at_ms:now-86400001},
   {...receipt,trials:receipt.trials.map(t=>({...t,matched:90,wrong:10}))},
   {...receipt,trials:receipt.trials.map(t=>({...t,unavailable:100}))},
   {...receipt,trials:receipt.trials.map(t=>({...t,unique_frames:10,matched:10}))},
   {...receipt,trials:receipt.trials.map(t=>({...t,model_id:'other'}))}])assert.equal(validPresenceReceipt(bad,e,now),false);
});
