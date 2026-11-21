// Known-condition verification only. No model or Pi writes.
import {createRequire} from 'node:module';
import {writeFileSync} from 'node:fs';
import {readCalibratedPresence} from './calibrated-presence.mjs';
const require=createRequire(process.env.RUVIEW_WS_PACKAGE||import.meta.url),WebSocket=require('ws');
const [condition,path,duration='30']=process.argv.slice(2),seconds=Number(duration);
if(!['empty','seated'].includes(condition)||!path||!Number.isFinite(seconds)||seconds<20)throw new Error('Usage: check-calibrated-presence.mjs empty|seated PRIVATE_OUTPUT SECONDS');
async function readHealth(){const r=await fetch('http://127.0.0.1:8092/api/v1/calibration/status',{signal:AbortSignal.timeout(2500)});if(!r.ok)throw new Error('Baseline status unavailable');return {...await r.json(),checked_at_ms:Date.now()};}
let health=await readHealth();
if(health.status!=='fresh'||health.sequence_fault_node_ids?.length||health.source_node_ids?.length!==1)throw new Error('A fresh healthy single-link baseline is required');
const identity=Object.fromEntries(['model_id','session_id','boot_epoch','binding_digest'].map(k=>[k,health[k]]));
const nodeId=health.source_node_ids[0],expected=condition==='seated',seen=new Set(),samples=[];
let latest=null,unavailable=0,identityChanged=false,refreshing=false;
const socket=new WebSocket('ws://127.0.0.1:8092/ws/sensing',{origin:'http://127.0.0.1:8092'});
socket.on('message',b=>{try{const f=JSON.parse(b);if(f.type==='sensing_update'&&f.source==='esp32'&&f.calibrated_presence_evidence?.inference_node_id===nodeId)latest=f;}catch{}});
socket.on('error',()=>{latest=null;});
const healthTimer=setInterval(async()=>{if(refreshing)return;refreshing=true;try{health=await readHealth();if(Object.keys(identity).some(k=>health[k]!==identity[k]))identityChanged=true;}catch{health=null;}finally{refreshing=false;}},2000);
const start=Date.now();
const sampleTimer=setInterval(()=>{
  const s=readCalibratedPresence(latest,health);
  if(identityChanged||!['experimental','live'].includes(s.status)||seen.has(s.source_tick)){unavailable++;return;}
  seen.add(s.source_tick);samples.push({source_tick:s.source_tick,presence:s.presence,matched:s.presence===expected});
},200);
setTimeout(()=>{
  clearInterval(sampleTimer);clearInterval(healthTimer);socket.close();
  const report={...identity,node_id:nodeId,condition,expected,duration_s:(Date.now()-start)/1000,
    unique_frames:samples.length,matched:samples.filter(s=>s.matched).length,wrong:samples.filter(s=>!s.matched).length,
    unavailable,identity_changed:identityChanged,created_at_ms:Date.now(),samples};
  writeFileSync(path,JSON.stringify(report));
  const {samples:_,...summary}=report;delete summary.binding_digest;delete summary.boot_epoch;delete summary.session_id;delete summary.model_id;
  console.log(JSON.stringify(summary));
},seconds*1000);
