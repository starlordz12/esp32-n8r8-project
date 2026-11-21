import { activityFeatures, applyActivityModel, loadActivityModel, predictActivity } from './activity-model.mjs';

export const ACTIVITY_CLASSES = ['absent', 'present_still', 'present_moving'];
export function trainingSample(frame, model, nodeId, label) {
  if (!ACTIVITY_CLASSES.includes(label) || applyActivityModel(frame, { ...model, inference_mode: undefined }, nodeId)?.local_activity?.status !== 'live') return null;
  const features = activityFeatures(frame.node_features[0].features, frame.nodes[0].amplitude);
  return { label, features, tick: frame.tick, node_id: nodeId };
}
export function trainActivity(samples, nodeId) {
  if (!samples.every(s => s.node_id === nodeId && ACTIVITY_CLASSES.includes(s.label) &&
      Array.isArray(s.features) && s.features.length === 15 && s.features.every(Number.isFinite))) throw new Error('Invalid or differently bound training samples');
  const grouped = ACTIVITY_CLASSES.map(label => samples.filter(s => s.label === label));
  if (grouped.some(g => g.length < 25)) throw new Error('Record at least 25 samples for each room condition');
  // Hold out the end of each capture, rather than randomly splitting adjacent CSI frames.
  const fitting = grouped.flatMap(g => g.slice(0, Math.floor(g.length*.8)));
  const holdout = grouped.flatMap(g => g.slice(Math.floor(g.length*.8)));
  const mean = Array.from({length:15},(_,i) => fitting.reduce((a,s)=>a+s.features[i],0)/fitting.length);
  const std = mean.map((m,i) => Math.max(1e-6,Math.sqrt(fitting.reduce((a,s)=>a+(s.features[i]-m)**2,0)/fitting.length)));
  const x = fitting.map(s => s.features.map((v,i)=>(v-mean[i])/(std[i]+1e-9)).concat(1));
  const weights = ACTIVITY_CLASSES.map(()=>Array(16).fill(0));
  const classWeights = grouped.map(g => 1/(3*Math.floor(g.length*.8)));
  for(let epoch=0;epoch<1500;epoch++) {
    const gradient = ACTIVITY_CLASSES.map(()=>Array(16).fill(0));
    for(let n=0;n<fitting.length;n++) {
      const logits=weights.map(w=>w.reduce((a,v,i)=>a+v*x[n][i],0));const max=Math.max(...logits);
      const exp=logits.map(v=>Math.exp(v-max)),sum=exp.reduce((a,v)=>a+v,0);
      const classWeight=classWeights[ACTIVITY_CLASSES.indexOf(fitting[n].label)];
      for(let c=0;c<3;c++){const error=(exp[c]/sum-(fitting[n].label===ACTIVITY_CLASSES[c]?1:0))*classWeight;for(let i=0;i<16;i++)gradient[c][i]+=error*x[n][i];}
    }
    for(let c=0;c<3;c++)for(let i=0;i<16;i++)weights[c][i]-=.08*(gradient[c][i]+(i<15?.005*weights[c][i]:0));
  }
  const candidate={version:2,trained_frames:fitting.length,class_names:ACTIVITY_CLASSES,
    global_mean:mean,global_std:std,weights,training_method:'local_regularized_softmax_v1',
    trained_node_id:nodeId,created_at:new Date().toISOString()};
  const model=loadActivityModel(JSON.stringify(candidate));
  const accuracy=set=>set.filter(s=>predictActivity(model,s.features).label===s.label).length/set.length;
  const motionHoldout=holdout.filter(s=>s.label!=='absent');
  const motionAccuracy=motionHoldout.filter(s=>{
    const p=predictActivity(model,s.features).probabilities;
    return (p.present_moving>p.present_still?'present_moving':'present_still')===s.label;
  }).length/motionHoldout.length;
  return {...candidate,inference_mode:'calibrated_presence_learned_motion',
    training_accuracy:accuracy(fitting),capture_holdout_accuracy:accuracy(holdout),
    motion_holdout_accuracy:motionAccuracy,motion_holdout_frames:motionHoldout.length,
    capture_holdout_frames:holdout.length,validation_scope:'same_capture_temporal_holdout_only'};
}
