// Private, local diagnostic captures. Output must remain outside tracked source.
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
const require = createRequire(process.env.RUVIEW_WS_PACKAGE || import.meta.url);
const WebSocket = require('ws');
const [label, path, seconds = '30'] = process.argv.slice(2);
if (!['stationary', 'moving', 'empty'].includes(label) || !path || !Number.isFinite(+seconds) || +seconds < 20) {
  throw new Error('Usage: capture-motion.mjs stationary|moving|empty PRIVATE_OUTPUT SECONDS');
}
const frames = [];
const socket = new WebSocket('ws://127.0.0.1:8092/ws/sensing', { origin: 'http://127.0.0.1:8092' });
socket.on('message', data => {
  const frame = JSON.parse(data);
  if (frame.type !== 'sensing_update' || frame.source !== 'esp32') return;
  frames.push({timestamp: frame.timestamp, tick: frame.tick,local_activity:frame.local_activity,classification:frame.classification,
    nodes: frame.nodes?.map(n => ({node_id: n.node_id, amplitude: n.amplitude,
      subcarrier_count: n.subcarrier_count, age_ms: n.node_inference?.age_ms, sync: n.sync})),
    node_features: (frame.node_features || frame.features)?.map(n => ({node_id: n.node_id, stale:n.stale,last_seen_ms:n.last_seen_ms}))});
});
socket.on('error', () => { console.error('Local sensing stream unavailable'); process.exitCode = 1; });
setTimeout(() => {
  socket.close();
  writeFileSync(path, JSON.stringify({label, captured_at:new Date().toISOString(), frames}));
  console.log(JSON.stringify({label, frames:frames.length, nodes:[...new Set(frames.flatMap(f=>f.nodes?.map(n=>n.node_id)||[]))]}));
}, +seconds * 1000);
