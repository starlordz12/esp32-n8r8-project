import test from 'node:test';
import assert from 'node:assert/strict';
import { trainActivity, ACTIVITY_CLASSES } from './activity-training.mjs';
import { loadActivityModel, predictActivity } from './activity-model.mjs';

const samples = () => ACTIVITY_CLASSES.flatMap((label,c) => Array.from({length:30},(_,i) => ({
  label,node_id:42,tick:c*100+i,features:Array.from({length:15},(_,f)=>f===0?(c-1)*4+i*.003:1),
})));
test('local training produces compatible learned weights and evaluates temporal holdout', () => {
  const trained=trainActivity(samples(),42), model=loadActivityModel(JSON.stringify(trained));
  assert.equal(trained.trained_frames,72);
  assert.equal(trained.capture_holdout_frames,18);
  assert.equal(trained.capture_holdout_accuracy,1);
  for(const sample of samples()) assert.equal(predictActivity(model,sample.features).label,sample.label);
});
test('local training rejects incomplete conditions, invalid features, and different radio bindings', () => {
  assert.throws(()=>trainActivity(samples().filter(s=>s.label!=='absent'),42));
  assert.throws(()=>trainActivity([{...samples()[0],node_id:43},...samples()],42));
  assert.throws(()=>trainActivity([{...samples()[0],features:[NaN]},...samples()],42));
});
