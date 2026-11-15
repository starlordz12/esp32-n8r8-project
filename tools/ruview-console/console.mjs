// Private localhost viewer for the Pi's existing native UI/API.
// The existing server token is read over SSH into memory, never sent to the browser.
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import WebSocket, { WebSocketServer } from 'ws';
import { loadActivityModel, applyActivityModel } from './activity-model.mjs';
import { createTrainingController } from './training-controller.mjs';
import { loadTemporal, createTemporalDetector, applyTemporalDecision } from './temporal-model.mjs';
import {loadMotionReference,createMultiNodeMotion,applyMultiNodeMotion} from './multi-node-motion.mjs';
import {allowsUpstreamWrite} from './request-policy.mjs';
import {readCalibratedPresence} from './calibrated-presence.mjs';

const port = 8092;
const host = `127.0.0.1:${port}`;
const origin = `http://${host}`;
let model = process.env.RUVIEW_ACTIVITY_MODEL
  ? loadActivityModel(readFileSync(process.env.RUVIEW_ACTIVITY_MODEL, 'utf8')) : null;
const modelNodeId = Number(process.env.RUVIEW_MODEL_NODE_ID);
if (model && (!Number.isInteger(modelNodeId) || modelNodeId < 0 || modelNodeId > 255)) {
  throw new Error('An explicit trained node binding is required');
}
let lastActivity = null;
let lastActivityAt = 0;
let baselineHealth = null;
const temporalPath = process.env.RUVIEW_TEMPORAL_MODEL || `${process.env.RUVIEW_ACTIVITY_MODEL}.temporal.local.json`;
const temporalModel = existsSync(temporalPath) ? loadTemporal(readFileSync(temporalPath, 'utf8')) : null;
if (temporalModel && temporalModel.node_id !== modelNodeId) throw new Error('Temporal model radio binding mismatch');
const temporalDetector = temporalModel ? createTemporalDetector(temporalModel) : null;
const motionDetector = temporalModel ? createTemporalDetector(temporalModel, { motionOnly: true }) : null;
const multiMotionPath=process.env.RUVIEW_MOTION_REFERENCE;
const multiMotionModel=multiMotionPath?loadMotionReference(readFileSync(multiMotionPath,'utf8')):null;
const multiMotionDetector=multiMotionModel?createMultiNodeMotion(multiMotionModel):null;
const presenceReceiptPath=process.env.RUVIEW_PRESENCE_VALIDATION||`${process.env.RUVIEW_ACTIVITY_MODEL}.calibrated-validation.local.json`;
let presenceReceiptAt=0,lastPresenceReceipt=null;
function presenceReceipt(){
  if(Date.now()-presenceReceiptAt>1000){presenceReceiptAt=Date.now();try{lastPresenceReceipt=JSON.parse(readFileSync(presenceReceiptPath,'utf8'));}catch{lastPresenceReceipt=null;}}
  return lastPresenceReceipt;
}
let lastTemporal = null;
let lastMotion = null;
function transform(frame) {
  if (!model) return frame;
  if(multiMotionDetector && model.inference_mode==='temporal_motion_only') {
    const decision=multiMotionDetector(frame);
    if(!decision)return frame;
    decision.calibrated_presence=readCalibratedPresence(frame,baselineHealth,Date.now(),presenceReceipt());
    lastActivity=decision;lastActivityAt=Date.now();
    return applyMultiNodeMotion(frame,decision);
  }
  let output;
  if (temporalDetector) { const value = temporalDetector(frame); if (value) lastTemporal = value; }
  if (motionDetector) { const value = motionDetector(frame); if (value) lastMotion = value; }
  try { output = applyActivityModel(frame, model, modelNodeId, baselineHealth); }
  catch { output = { ...frame, local_activity: { status: 'unavailable', reason: 'invalid_features' } }; }
  if (model.inference_mode === 'temporal_channel_shape') output = applyTemporalDecision(frame, lastTemporal, modelNodeId);
  else if (model.inference_mode === 'temporal_motion_only') output = applyTemporalDecision(frame, lastMotion, modelNodeId);
  else if (output.local_activity?.status === 'unavailable') output = applyTemporalDecision(frame, output.local_activity, modelNodeId);
  if (output.local_activity) { lastActivity = output.local_activity; lastActivityAt = Date.now(); }
  return output;
}
const badge = `<aside id="local-activity-badge" role="status" style="position:sticky;top:0;z-index:9999;padding:10px;background:#12352c;color:#e4fff4;font:14px system-ui">Local trained room activity model · Connecting…</aside>
<script type="importmap">{"imports":{"/ui/components/TrainingPanel.js":"/ui/components/TrainingPanel.js?activity=2","/ui/components/ModelPanel.js":"/ui/components/ModelPanel.js?activity=2"}}</script>
<script type="module">
const badge=document.getElementById('local-activity-badge');
async function update(){try{
  const r=await fetch('/local/activity/status');const s=await r.json();
  if(s.multi_node_motion){
    const label=s.status==='live'?s.label.replaceAll('_',' '):'unavailable';
    badge.textContent='Two-node CSI motion: '+label+' | '+(s.nodes||[]).map(n=>'Node '+n.node_id+': '+(n.status==='live'?n.label.replaceAll('_',' '):'unavailable')).join(' | ')+(s.calibrated_presence?.status==='live'?' | Calibrated presence: '+(s.calibrated_presence.presence?'present':'empty'):' | Occupancy unknown · validation pending');
  }else{
    const motion=s.inference_method==='normalized_channel_motion_v1';
    badge.textContent=s.status==='live'?(motion?'Temporal CSI motion: ':'Local room activity: ')+s.label.replaceAll('_',' ')+(motion?' · Occupancy unknown':''):'Local activity unavailable: '+(s.reason||s.status);
  }
  badge.style.background=s.status==='live'?'#12352c':'#614515';
}catch{badge.textContent='Local room activity connection unavailable';}}
update();setInterval(update,1000);
</script>`;
let token;
try {
  const env = execFileSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=7',
    '-o', 'StrictHostKeyChecking=yes', process.env.RUVIEW_PI_SSH, 'cat',
    process.env.RUVIEW_PI_ENV], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  token = env.split(/\r?\n/).find(l => /^RUVIEW_API_TOKEN=/.test(l))?.split('=').slice(1).join('=').trim();
  if ((token?.startsWith('"') && token.endsWith('"')) || (token?.startsWith("'") && token.endsWith("'"))) token = token.slice(1, -1);
  if (!token || /[\r\n]/.test(token)) throw new Error();
} catch {
  console.error('Cannot load existing Pi API credential. No credential contents were logged.');
  process.exit(1);
}
async function readFrame() {
  const response = await fetch('http://127.0.0.1:3000/api/v1/sensing/latest', {
    headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(2500),
  });
  if (!response.ok) throw new Error('Live sensing unavailable');
  return response.json();
}
async function refreshBaselineHealth() {
  try {
    const response = await fetch('http://127.0.0.1:3000/api/v1/calibration/status', {
      headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(2500),
    });
    if (!response.ok) throw new Error();
    baselineHealth = { ...await response.json(), checked_at_ms: Date.now() };
  } catch { baselineHealth = null; }
}
await refreshBaselineHealth();
setInterval(refreshBaselineHealth, 2000);
// Keep a real stream for temporal windows even when Training is the only open tab.
// Browser sockets and HTTP reads share the detector, which ignores duplicate ticks.
function connectSensingFeed() {
  const feed = new WebSocket('ws://127.0.0.1:3000/ws/sensing', {
    headers: { authorization: `Bearer ${token}`, origin: 'http://127.0.0.1:3000' },
    maxPayload: 8 * 1024 * 1024,
  });
  feed.on('message', data => { try { transform(JSON.parse(data.toString())); } catch {} });
  feed.on('error', () => {});
  feed.on('close', () => setTimeout(connectSensingFeed, 1000));
}
if (temporalDetector || multiMotionDetector) connectSensingFeed();
const training = model ? createTrainingController({ modelPath: process.env.RUVIEW_ACTIVITY_MODEL,
  nodeId: modelNodeId, getModel: () => model,
  setModel: value => { model = value; lastActivity = null; lastActivityAt = 0; }, readFrame }) : null;
const wsPaths = new Set(['/ws/sensing', '/ws/introspection', '/api/v1/stream/pose']);
const readApi = /^\/api\/v1\/(?:info$|status$|metrics$|sensing\/|nodes(?:\/|$)|mesh(?:\/|$)|vital-signs$|edge-vitals$|wasm-events$|model\/|models(?:\/|$)|pose\/|stream\/status$|introspection\/snapshot$|calibration\/status$|adaptive\/status$|rf\/vendors|radar\/latest$|csi\/)/;
function valid(req) {
  if (req.headers.host !== host) return false;
  if (req.headers.origin && req.headers.origin !== origin) return false;
  if (req.headers['sec-fetch-site'] === 'cross-site') return false;
  return true;
}
function headers(req) {
  const forwarded = { ...req.headers };
  delete forwarded['if-none-match'];
  delete forwarded['if-modified-since'];
  return { ...forwarded, host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000',
    'accept-encoding': 'identity', authorization: `Bearer ${token}` };
}
const localModules = {
    // The upstream offline worker ignores query strings and replays old HTML,
    // modules and even API responses. This console must always use fresh data.
    '/ui/sw.js': "self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));",
    '/ui/components/TrainingPanel.js': "export { TrainingPanel as default } from '/local/activity/panels.js';",
    '/ui/components/ModelPanel.js': "export { ModelPanel as default } from '/local/activity/panels.js';",
    '/local/activity/panels.js': readFileSync(new URL('./activity-panels.js', import.meta.url), 'utf8'),
    '/local/activity/motion-view.js': readFileSync(new URL('./motion-view.js', import.meta.url), 'utf8'),
    '/ui/components/gaussian-splats.js': readFileSync(new URL('./motion-view.js', import.meta.url), 'utf8'),
};
const server = http.createServer(async (req, res) => {
  const path = new URL(req.url, origin).pathname;
  if(model && path==='/ui/observatory.html' && req.method==='GET' && valid(req)){
    res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});
    res.end(readFileSync(new URL('./observatory.html',import.meta.url),'utf8'));return;
  }
  const actions = new Set(['/local/activity/training/capture', '/local/activity/training/cancel',
    '/local/activity/training/train', '/local/activity/training/activate', '/local/activity/training/mode']);
  if (training && valid(req) && (path === '/local/activity/training' && req.method === 'GET' ||
      actions.has(path) && req.method === 'POST' && req.headers.origin === origin)) {
    try {
      let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 1024) throw new Error('Request too large'); }
      const input = body ? JSON.parse(body) : {};
      if (path.endsWith('/mode') && ['temporal_channel_shape','temporal_motion_only'].includes(input.mode) && !temporalModel) throw new Error('No temporal model is loaded');
      const result = path.endsWith('/capture') ? await training.start(input.label, input.confirmed) :
        path.endsWith('/cancel') ? training.cancel() : path.endsWith('/train') ? training.train() :
        path.endsWith('/activate') ? training.activate(input.candidate_id) :
        path.endsWith('/mode') ? training.mode(input.mode) : training.status();
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(result));
    } catch (error) { res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: error.message.startsWith('E') ? 'Local training file operation failed' : error.message })); }
    return;
  }
  if (model && Object.hasOwn(localModules, path) && req.method === 'GET' && valid(req)) {
    res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' });
    res.end(localModules[path]); return;
  }
  if (path === '/local/activity/status' && req.method === 'GET' && valid(req)) {
    // Training can be open without a sensing socket. Read a real frame so the
    // model status does not depend on visiting another tab first.
    try {
      const latest = await fetch('http://127.0.0.1:3000/api/v1/sensing/latest', {
        headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(2500),
      });
      if (!latest.ok) throw new Error();
      transform(await latest.json());
    } catch { lastActivity = { status: 'unavailable', reason: 'upstream_unavailable' }; lastActivityAt = Date.now(); }
    const activity = lastActivityAt && Date.now() - lastActivityAt < 5000
      ? lastActivity : { status: 'unavailable', reason: 'awaiting_fresh_frame' };
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    const selected = ['temporal_channel_shape','temporal_motion_only'].includes(model?.inference_mode) ? temporalModel : model;
    res.end(JSON.stringify({ model_loaded: !!selected,
      temporal_model: temporalModel ? { loaded: true, capture_holdout: temporalModel.capture_holdout } : null,
      temporal_activity: lastTemporal,
      temporal_motion: lastMotion,
      multi_node_motion:multiMotionModel?{loaded:true,node_ids:multiMotionModel.nodes.map(n=>n.node_id),validation:multiMotionModel.validation}:null,
      training: multiMotionModel && model?.inference_mode==='temporal_motion_only' ? {        status:'trained',version:1,model_id:multiMotionModel.id,node_ids:multiMotionModel.nodes.map(n=>n.node_id),        classes:['no_movement','movement_detected'],inference_mode:'temporal_motion_only',validation:multiMotionModel.validation,        trained_frames:multiMotionModel.nodes.reduce((s,n)=>s+n.trained_frames,0),      } : selected ? { status: 'trained', version: selected.version,
        trained_frames: selected.trained_frames, classes: model.inference_mode === 'temporal_motion_only' ? ['no_movement','movement_detected'] : ['absent','present_still','present_moving'],
        node_id: modelNodeId, model_id: selected.id, inference_mode: model.inference_mode || 'learned_three_class', validation: 'pending_room_trials' } : null,
      ...activity }));
    return;
  }
  const read = ['GET', 'HEAD'].includes(req.method) &&
    (path === '/' || path === '/ui' || path.startsWith('/ui/') || path.startsWith('/health') || path === '/oauth/status' || readApi.test(path));
  const write = allowsUpstreamWrite(req.method,path,req.headers.origin,origin);
  if (!valid(req) || !(read || write)) { res.writeHead(403); res.end('Local viewer request not permitted.'); return; }
  const upstream = http.request({ hostname: '127.0.0.1', port: 3000, path: req.url,
    method: req.method, headers: headers(req) }, reply => {
      const responseHeaders = { ...reply.headers, 'cache-control': 'no-store',
        'referrer-policy': 'no-referrer', 'cross-origin-resource-policy': 'same-origin' };
      if (model && req.method === 'GET' && reply.statusCode === 200 &&
          (path === '/api/v1/sensing/latest' || path === '/ui/index.html' || path === '/ui/' || path === '/ui/components/SensingTab.js')) {
        delete responseHeaders['content-length'];
        delete responseHeaders['content-encoding'];
        let body = ''; let size = 0;
        reply.on('data', chunk => { size += chunk.length; if (size > 8 * 1024 * 1024) reply.destroy(); else body += chunk.toString('utf8'); });
        reply.on('end', () => {
          try {
            const output = path === '/api/v1/sensing/latest' ? JSON.stringify(transform(JSON.parse(body)))
              : path === '/ui/components/SensingTab.js' ? body.replace('await this._loadThree();','').replace('<label>Motion Band</label>','<label>Spatial packet power</label>').replace('<label>Breathing Band</label>','<label>Low-frequency power</label>').replace(/With <strong><span id="sensingNodeCount">0<\/span> ESP32 node\(s\)<\/strong>[\s\S]*?limb-level tracking\./, 'Connected radios: <strong><span id="sensingNodeCount">0</span></strong>. Local CSI detects channel movement only. Occupancy is unknown. The graphic shows measured motion over time.').replace("confPct + '%'", "c.confidence == null ? (data.local_activity?.status !== 'live' ? 'Unavailable' : ['normalized_channel_shape_temporal_v1','normalized_channel_motion_v1','normalized_channel_motion_sparse_v1'].includes(data.local_activity?.inference_method) ? 'Temporal CSI' : 'Calibrated presence') : confPct + '%'").replace("motion + ' ' + conf + '%'", "nf.classification?.confidence == null ? motion + (['normalized_channel_shape_temporal_v1','normalized_channel_motion_v1','normalized_channel_motion_sparse_v1'].includes(nf.classification?.inference_method) ? ' - Temporal CSI' : '') : motion + ' ' + conf + '%'")
              : body.replace(/<body([^>]*)>/i, `<body$1>${badge}`)
                .replace('Record CSI data, train pose estimation models, and manage .rvf files',
                  'Trained room activity, live predictions, empty-room baseline, and accuracy checks')
                .replace('src="app.js"', 'src="app.js?activity=2"');
            res.writeHead(200, responseHeaders); res.end(output);
          } catch { res.writeHead(502); res.end('Invalid upstream response.'); }
        });
        reply.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end('Upstream response unavailable.'); });
      } else { res.writeHead(reply.statusCode, responseHeaders); reply.pipe(res); }
    });
  upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end('Pi connection unavailable.'); });
  req.pipe(upstream);
});
const wss = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024 * 1024 });
server.on('upgrade', (req, socket, head) => {
  const path = new URL(req.url, origin).pathname;
  if (!valid(req) || req.headers.origin !== origin || !wsPaths.has(path)) { socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return; }
  wss.handleUpgrade(req, socket, head, client => {
    const upstream = new WebSocket(`ws://127.0.0.1:3000${req.url}`, {
      headers: { authorization: `Bearer ${token}`, origin: 'http://127.0.0.1:3000' },
      maxPayload: 8 * 1024 * 1024,
    });
    upstream.on('message', (data, binary) => {
      if (client.readyState !== WebSocket.OPEN) return;
      if (binary || path !== '/ws/sensing' || !model) { client.send(data, { binary }); return; }
      try { client.send(JSON.stringify(transform(JSON.parse(data.toString())))); }
      catch { client.close(1011, 'Invalid sensing frame'); }
    });
    client.on('message', (data, binary) => { if (upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary }); });
    upstream.on('error', () => client.close(1011, 'Pi stream unavailable'));
    client.on('error', () => upstream.close());
    upstream.on('close', () => client.close());
    client.on('close', () => upstream.close());
  });
});
server.listen(port, '127.0.0.1', () => console.log(`Native RuView console: ${origin}/ui/index.html`));
