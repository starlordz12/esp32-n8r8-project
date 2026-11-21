import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTrainingController } from './training-controller.mjs';
import { ACTIVITY_CLASSES } from './activity-training.mjs';
import { loadActivityModel } from './activity-model.mjs';

test('candidate training leaves the current model untouched until exact candidate activation, with backup', () => {
  const dir=mkdtempSync(join(tmpdir(),'ruview-training-'));
  try {
    const modelPath=join(dir,'model.local.json'),original='original model retained until activation';
    writeFileSync(modelPath,original);
    const samples=ACTIVITY_CLASSES.flatMap((label,c)=>Array.from({length:30},(_,i)=>({
      label,node_id:42,tick:100*c+i,features:Array.from({length:15},()=>c*4+i*.001),
    })));
    writeFileSync(modelPath+'.samples.local.json',JSON.stringify({node_id:42,saved_at:Date.now(),samples}));
    let activated=null;
    const controller=createTrainingController({modelPath,nodeId:42,getModel:()=>null,
      setModel:model=>{activated=model;},readFrame:()=>{throw new Error('Unused');}});
    const result=controller.train();
    assert.equal(readFileSync(modelPath,'utf8'),original);
    assert.throws(()=>controller.activate('wrong-candidate'));
    controller.activate(result.candidate.id);
    assert.equal(activated.id,result.candidate.id);
    assert.equal(loadActivityModel(readFileSync(modelPath,'utf8')).id,activated.id);
    const backup=readdirSync(dir).find(name=>name.includes('.backup-'));
    assert.equal(readFileSync(join(dir,backup),'utf8'),original);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
