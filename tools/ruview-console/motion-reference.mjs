import { channelShape } from './temporal-model.mjs';

export const MOTION_ALGORITHM='normalized_channel_motion_sparse_v1';
export function motionWindow(frames) {
  // Each receiver supplies only part of the aggregate stream. Require real
  // samples spanning the window; never bridge a gap longer than the lag.
  if(frames.length<12||frames.at(-1).timestamp-frames[0].timestamp<1.8)return null;
  const deltas=[];
  for(let i=1,j=0;i<frames.length;i++) {
    const dt=frames[i].timestamp-frames[i-1].timestamp;
    if(dt<=0||dt>.5)return null;
    while(j+1<i&&frames[j+1].timestamp<=frames[i].timestamp-.5)j++;
    const lag=frames[i].timestamp-frames[j].timestamp;
    if(lag>=.4&&lag<=.65)deltas.push(frames[i].shape.reduce((s,v,k)=>s+(v-frames[j].shape[k])**2,0));
  }
  if(deltas.length<6)return null;
  return {motion:deltas.toSorted((a,b)=>a-b)[Math.floor((deltas.length-1)*.75)]};
}

// Raw snapshots carry no sample identity of their own. Conservatively accept
// changed snapshots only; transport counters alone cannot date cached arrays.
export function captureMotionWindows(capture, nodeId) {
  let fingerprint, lastTime = -Infinity;
  const frames = [];
  for (const frame of capture.frames) {
    const node = frame.nodes?.find(n => n.node_id === nodeId);
    const feature = frame.node_features?.find(n => n.node_id === nodeId);
    const shape = channelShape(node?.amplitude);
    if (!shape || feature?.stale || !Number.isFinite(feature?.last_seen_ms) || feature.last_seen_ms > 250 || !Number.isFinite(frame.timestamp)) continue;
    const key = JSON.stringify(node.amplitude);
    if (key === fingerprint || frame.timestamp <= lastTime) continue;
    fingerprint = key; lastTime = frame.timestamp;
    frames.push({timestamp:frame.timestamp, shape, grid:node.subcarrier_count});
  }
  if (frames.length < 100) throw new Error(`Insufficient raw CSI for node ${nodeId}`);
  const grids = new Set(frames.map(f=>f.grid));
  if (grids.size !== 1 || !Number.isInteger(frames[0].grid) || frames[0].grid < 56) throw new Error('CSI grid changed');
  const windows=[];
  for (let t=frames[0].timestamp;t+2<=frames.at(-1).timestamp;t+=2) {
    const value=motionWindow(frames.filter(f=>f.timestamp>=t && f.timestamp<t+2));
    if(value) windows.push(value.motion);
  }
  return {node_id:nodeId, subcarrier_count:frames[0].grid, frames:frames.length, windows};
}

export function fitMotionReference(stationary, moving, nodeIds) {
  if(stationary.label!=='stationary'||moving.label!=='moving') throw new Error('Known stationary and moving trials required');
  return {version:1, algorithm:MOTION_ALGORITHM, created_at:new Date().toISOString(),
    validation:'pending_independent_trials', nodes:nodeIds.map(nodeId=>{
      const quiet=captureMotionWindows(stationary,nodeId), active=captureMotionWindows(moving,nodeId);
      if(quiet.subcarrier_count!==active.subcarrier_count) throw new Error('Capture grids differ');
      if(quiet.windows.length<8||active.windows.length<8) throw new Error(`Insufficient continuous windows for node ${nodeId}`);
      const quietMax=Math.max(...quiet.windows), movingMin=Math.min(...active.windows);
      if(quietMax>=movingMin) throw new Error(`Stationary and moving overlap for node ${nodeId}`);
      return {node_id:nodeId, subcarrier_count:quiet.subcarrier_count, motion_threshold:(quietMax+movingMin)/2,
        trained_frames:quiet.frames+active.frames, stationary_max:quietMax, moving_min:movingMin,
        stationary_windows:quiet.windows.length, moving_windows:active.windows.length};
    })};
}
