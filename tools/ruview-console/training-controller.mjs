import { readFileSync, writeFileSync, existsSync, copyFileSync, renameSync } from 'node:fs';
import { ACTIVITY_CLASSES, trainingSample, trainActivity } from './activity-training.mjs';
import { loadActivityModel } from './activity-model.mjs';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export function createTrainingController({modelPath,nodeId,getModel,setModel,readFrame}) {
  const samplesPath=modelPath+'.samples.local.json';let samples=[],capture=null,candidate=null,error=null;
  try { const saved=JSON.parse(readFileSync(samplesPath,'utf8'));if(saved.node_id===nodeId && Date.now()-saved.saved_at<3600000) samples=saved.samples; } catch {}
  const status=()=>({status:capture?(Date.now()<capture.starts_at?'countdown':'recording'):'idle',
    capture:capture?{label:capture.label,starts_at:capture.starts_at,ends_at:capture.ends_at}:null,
    counts:Object.fromEntries(ACTIVITY_CLASSES.map(c=>[c,samples.filter(s=>s.label===c).length])),error,
    candidate:candidate?{id:candidate.model.id,training_frames:candidate.model.trained_frames,
      training_accuracy:candidate.model.training_accuracy,holdout_accuracy:candidate.model.capture_holdout_accuracy,
      holdout_frames:candidate.model.capture_holdout_frames,
      motion_holdout_accuracy:candidate.model.motion_holdout_accuracy,
      motion_holdout_frames:candidate.model.motion_holdout_frames}:null});
  async function start(label,confirmed) {
    if(capture)throw new Error('A training capture is already running');
    if(!ACTIVITY_CLASSES.includes(label)||confirmed!==true)throw new Error('Confirm the selected physical condition first');
    const session={label,starts_at:Date.now()+20000,ends_at:Date.now()+50000};capture=session;error=null;candidate=null;
    const recorded=[],ticks=new Set();
    (async()=>{
      try {
        await sleep(20000);
        while(capture===session&&Date.now()<session.ends_at){
          const frame=await readFrame();const sample=trainingSample(frame,getModel(),nodeId,label);
          if(sample&&!ticks.has(sample.tick)){ticks.add(sample.tick);recorded.push(sample);}
          await sleep(100);
        }
        if(capture!==session)return;
        if(recorded.length<25)throw new Error('Not enough complete live frames; previous examples were retained');
        const next=samples.filter(s=>s.label!==label).concat(recorded);
        writeFileSync(samplesPath,JSON.stringify({node_id:nodeId,saved_at:Date.now(),samples:next}));
        samples=next;
      }catch{error='Training capture failed or lacked complete live frames. Previous examples were retained.';}
      finally{if(capture===session)capture=null;}
    })();
    return status();
  }
  return {status,start,
    mode(mode){if(capture || !['calibrated_presence_only','calibrated_presence_learned_motion','temporal_channel_shape','temporal_motion_only'].includes(mode)) throw new Error('Select a supported mode after capture finishes');
      const raw={...getModel(),inference_mode:mode};delete raw.id;
      const text=JSON.stringify(raw,null,2),next=loadActivityModel(text);
      copyFileSync(modelPath,modelPath+'.backup-'+Date.now()+'.local.json');
      const pendingPath=modelPath+'.next.local.json';writeFileSync(pendingPath,text);renameSync(pendingPath,modelPath);
      setModel(next);return status();},
    cancel(){capture=null;return status();},
    train(){if(capture)throw new Error('Finish the capture first');const raw=trainActivity(samples,nodeId);const text=JSON.stringify(raw,null,2);candidate={text,model:loadActivityModel(text)};return status();},
    activate(id){if(capture||!candidate||candidate.model.id!==id)throw new Error('Select the current candidate model');
      if(getModel()?.inference_mode==='calibrated_presence_only') {
        const raw={...candidate.model,inference_mode:'calibrated_presence_only'};delete raw.id;
        candidate.text=JSON.stringify(raw,null,2);candidate.model=loadActivityModel(candidate.text);
      }
      if(existsSync(modelPath))copyFileSync(modelPath,modelPath+'.backup-'+Date.now()+'.local.json');
      const pendingPath=modelPath+'.next.local.json';
      writeFileSync(pendingPath,candidate.text);renameSync(pendingPath,modelPath);
      setModel(candidate.model);candidate=null;return status();},
  };
}
