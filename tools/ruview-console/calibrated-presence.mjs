// Keep calibrated evidence separate from movement and learned occupancy.
// A healthy single-link baseline can be inspected while other radios stream.
export function readCalibratedPresence(frame,health,now=Date.now(),receipt=null){
  const unavailable=reason=>({status:'unavailable',presence:null,reason});
  if(frame?.source!=='esp32'||!Number.isFinite(frame.timestamp)||Math.abs(now-frame.timestamp*1000)>1000)return unavailable('source_not_fresh');
  if(!Number.isFinite(health?.checked_at_ms)||Math.abs(now-health.checked_at_ms)>5000)return unavailable('baseline_status_not_fresh');
  if(health.status!=='fresh')return unavailable(`baseline_${health.status||'unavailable'}`);
  if(health.grid_binding?.status!=='active'||!Array.isArray(health.sequence_fault_node_ids)||health.sequence_fault_node_ids.length)return unavailable('baseline_grid_or_sequence_fault');
  if(receipt?.kind==='calibrated_presence_failed_trials'&&
    ['model_id','session_id','boot_epoch','binding_digest'].every(k=>receipt[k]===health[k])&&
    health.source_node_ids?.length===1&&receipt.node_id===health.source_node_ids[0])return unavailable('failed_independent_presence_trials');
  const e=frame.calibrated_presence_evidence;
  if(e?.schema!=='ruview.calibration.calibrated-presence-evidence.v2'||typeof e.presence!=='boolean')return unavailable('calibrated_evidence_missing');
  if(!['model_id','session_id','boot_epoch','binding_digest'].every(k=>typeof e[k]==='string'&&e[k]&&e[k]===health[k]))return unavailable('baseline_identity_mismatch');
  if(e.source_tick!==frame.tick||!Number.isFinite(e.observed_at_unix_ms)||Math.abs(now-e.observed_at_unix_ms)>1000)return unavailable('calibrated_evidence_not_fresh');
  if(!Array.isArray(e.source_node_ids)||e.source_node_ids.length!==1||e.source_node_ids[0]!==e.inference_node_id||
    JSON.stringify(e.source_node_ids)!==JSON.stringify(health.source_node_ids))return unavailable('baseline_radio_mismatch');
  const n=frame.node_features?.find(n=>n.node_id===e.inference_node_id);
  if(!n||n.stale||!Number.isFinite(n.last_seen_ms)||n.last_seen_ms>250)return unavailable('baseline_radio_not_fresh');
  const approved=validPresenceReceipt(receipt,e,now);
  return {status:approved?'live':'experimental',presence:e.presence,node_id:e.inference_node_id,model_id:e.model_id,
    session_id:e.session_id,boot_epoch:e.boot_epoch,binding_digest:e.binding_digest,source_tick:e.source_tick,
    validation:approved?'short_independent_trials_passed':'pending',
    reason:approved?null:'independent_presence_validation_required'};
}

export function validPresenceReceipt(receipt,evidence,now=Date.now()){
  if(receipt?.version!==1||receipt.kind!=='calibrated_presence_independent_trials'||
    !Number.isFinite(receipt.created_at_ms)||now-receipt.created_at_ms>86400000||receipt.created_at_ms>now||
    !['model_id','session_id','boot_epoch','binding_digest'].every(k=>receipt[k]===evidence[k])||
    receipt.node_id!==evidence.inference_node_id||!Array.isArray(receipt.trials))return false;
  return [false,true].every(expected=>receipt.trials.some(t=>t.expected===expected&&
    t.identity_changed===false&&
    ['model_id','session_id','boot_epoch','binding_digest'].every(k=>t[k]===receipt[k])&&t.node_id===receipt.node_id&&
    Number.isFinite(t.duration_s)&&t.duration_s>=20&&Number.isInteger(t.unique_frames)&&t.unique_frames>=20&&
    Number.isInteger(t.matched)&&Number.isInteger(t.wrong)&&Number.isInteger(t.unavailable)&&t.unavailable>=0&&t.wrong>=0&&
    t.matched>=0&&t.matched+t.wrong===t.unique_frames&&t.matched/t.unique_frames>=.95&&
    t.unique_frames/(t.unique_frames+t.unavailable)>=.8));
}
