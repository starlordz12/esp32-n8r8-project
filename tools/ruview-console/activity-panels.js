const styles = `
.activity-panel{padding:20px;background:#111827;border:1px solid #384459;border-radius:10px;color:#dce6f2;font:14px/1.6 system-ui;min-width:0}
.activity-panel h3{margin:0 0 12px;color:#f1f5f9}.activity-panel h4{margin:20px 0 8px}.activity-panel p{margin:8px 0}.activity-panel button,.activity-panel select{background:#203348;color:#e0f2fe;border:1px solid #54718b;border-radius:6px;padding:9px 12px;margin:5px 6px 5px 0}.activity-panel button:disabled{opacity:.45;cursor:not-allowed}.activity-panel label{display:block;margin:12px 0}.activity-panel output{display:block;white-space:pre-wrap;margin:10px 0}.activity-panel .activity-ok{color:#7ce6b2}.activity-panel .activity-warning{color:#ffd58a}.activity-panel progress{width:100%}
@media(max-width:800px){#model-panel-container{order:-1;max-width:none!important;flex-basis:100%!important}#training-panel-container{min-width:0!important}}
`;
async function api(path, body) {
  const response = await fetch(path, { method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  const data = await response.json();
  if (!response.ok || data.success === false) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}
const identity = s => Object.fromEntries(['boot_epoch','session_id','binding_digest','source_node_ids'].map(k => [k,s[k]]));
export function baselineReady(status, capture) {
  if (JSON.stringify(identity(status)) !== JSON.stringify(identity(capture))) throw new Error('Baseline session changed. Automatic finalization stopped.');
  if (status.sequence_fault_node_ids?.length) throw new Error('Sequence fault: cancel this capture and try again.');
  return ['collecting','uncalibrated'].includes(status.status) &&
    Number.isFinite(status.min_duration_s) && status.min_duration_s >= 600 &&
    Number.isFinite(status.min_frames) && status.min_frames >= 1000 &&
    status.elapsed_s >= status.min_duration_s && status.frame_count >= status.min_frames;
}
const describe = label => ({ present:'Person present', absent:'Empty room', present_still:'Present, still', present_moving:'Moving', active:'Active' })[label] || label;
class Panel {
  constructor(container, html) {
    this.container = typeof container === 'string' ? document.getElementById(container) : container;
    if (!document.getElementById('activity-panel-styles')) {
      const style = document.createElement('style'); style.id = 'activity-panel-styles'; style.textContent = styles; document.head.append(style);
    }
    this.container.innerHTML = `<div class="activity-panel">${html}</div>`;
    this.disposed = false;
  }
  el(key) { return this.container.querySelector(`[data-field="${key}"]`); }
  text(key,value) { this.el(key).textContent = value; }
  destroy() { this.disposed = true; clearTimeout(this.timer); clearTimeout(this.countdown); this.container.textContent = ''; }
  dispose() { this.destroy(); }
}
export class ModelPanel extends Panel {
  constructor(container) {
    super(container, `<h3>Room activity model</h3><output data-field="training" aria-live="polite">Checking trained model…</output><p data-field="details"></p><label>Display mode <select data-field="mode"><option value="calibrated_presence_only">Calibrated presence only</option><option value="calibrated_presence_learned_motion">Experimental learned motion</option></select></label><p class="activity-warning">Learned motion is experimental and has not passed independent room validation.</p><h4>Room decision</h4><output data-field="prediction" aria-live="polite">Connecting…</output><p data-field="probabilities"></p><h4>Calibrated room presence</h4><output data-field="presence" aria-live="polite">Checking baseline evidence…</output><output class="activity-warning" data-field="agreement"></output><p class="activity-warning">Trained does not mean validated. Complete fresh empty, seated, and walking checks. Model confidence is not measured accuracy.</p><p>This classifier detects room presence and movement. Body pose and vital signs have not been validated.</p>`);
    this.el('mode').addEventListener('change', async () => {try{await api('/local/activity/training/mode',{mode:this.el('mode').value});await this.refresh();}catch(error){this.text('agreement',error.message);}});
    this.refresh();
  }
  async refresh() {
    clearTimeout(this.timer);
    try {
      const s = await api('/local/activity/status'); if (this.disposed) return;
      if (s.training?.inference_mode && document.activeElement !== this.el('mode')) this.el('mode').value = s.training.inference_mode;
      this.text('training', s.model_loaded ? 'Trained · Loaded · Room activity' : 'No room activity model loaded');
      this.el('training').className = s.model_loaded ? 'activity-ok' : 'activity-warning';
      this.text('details', s.training ? `Version ${s.training.version} · ${s.training.trained_frames.toLocaleString()} training frames · ${s.training.classes.length} classes · Bound node ${s.training.node_id}` : '');
      this.text('prediction', s.status === 'live' ? s.confidence == null ? `${describe(s.label)} - calibrated presence` : `${describe(s.label)} - ${Math.round(s.confidence*100)}% learned motion confidence` : `Prediction unavailable: ${(s.reason || s.status).replaceAll('_',' ')}`);
      this.text('probabilities', s.status === 'live' ? Object.entries(s.probabilities).map(([k,v]) => `${describe(k)} ${Math.round(v*100)}%`).join(' · ') : '');
      const e = s.calibrated_presence;
      this.text('presence', e?.status === 'live' ? (e.presence ? 'Person present · calibrated signal' : 'Empty room · calibrated signal') : 'Fresh calibrated evidence unavailable');
      this.text('agreement', e?.status === 'live' && !e.agrees_with_activity_model ? (['calibrated_presence_learned_motion','calibrated_presence_only'].includes(s.inference_method) ? 'The raw activity model disagrees. Room presence comes from the fresh calibrated signal.' : 'DISAGREEMENT: the activity model and calibrated presence differ. Do not treat this model as validated.') : '');
    } catch { if (!this.disposed) this.text('prediction','Connection unavailable; no live prediction.'); }
    if (!this.disposed) this.timer = setTimeout(() => this.refresh(), 2000);
  }
}
export class TrainingPanel extends Panel {
  constructor(container) {
    super(container, `<h3>Room setup & validation</h3><p>The saved activity model is already trained. Recheck it after changes to the room, radio placement, or nearby moving equipment.</p>
<h4>1. Empty-room baseline</h4><output data-field="baseline" aria-live="polite">Checking calibration…</output><progress data-field="progress" max="1" value="0"></progress>
<p>Keep the printer stopped and leave the room empty for at least 10 minutes. A 20-second countdown gives you time to leave. Keep this page open; it finishes the capture when the server's duration and frame targets are met.</p>
<label><input data-field="empty" type="checkbox"> Replace the current baseline; the room will be empty after the countdown.</label>
<button data-field="start" disabled>Start new baseline (20-second delay)</button><button data-field="cancel" disabled>Cancel baseline</button>
<p class="activity-warning">A new capture replaces the current runtime baseline. Baseline persistence across a Pi restart is not configured. This does not retrain the activity classifier.</p>
<h4>2. Check activity accuracy</h4><p>Set the known room condition, then start a 20-second check (after a 20-second preparation countdown). Empty means nobody in the room; seated means sitting still; walking means moving around the desk.</p>
<label>Expected condition <select data-field="expected"><option value="absent">Empty room</option><option value="present">Person present (presence only)</option><option value="present_still">Seated still</option><option value="present_moving">Walking</option></select></label>
<button data-field="validate">Start activity check</button><output data-field="trial" aria-live="polite">No new checks yet. Results stay on this page and are not training data.</output><h4>3. Train for this room</h4><p>Capture each condition with the printer stopped. Each capture starts after 20 seconds and records for 30 seconds. New examples replace that condition's previous examples; the active model stays in use until you activate a candidate.</p><label>Training condition <select data-field="training-label"><option value="absent">Empty room</option><option value="present_still">Seated still</option><option value="present_moving">Walking</option></select></label><label><input data-field="training-confirm" type="checkbox"> I will maintain the selected condition throughout the capture.</label><button data-field="capture" disabled>Capture training examples</button><button data-field="cancel-training" disabled>Cancel training capture</button><output data-field="training-progress" aria-live="polite">Checking saved examples…</output><button data-field="train" disabled>Train candidate model</button><output data-field="candidate"></output><button data-field="activate" disabled>Activate candidate (back up current model)</button><output data-field="error" role="alert"></output>`);
    this.el('empty').addEventListener('change', () => this.updateButtons());
    this.el('start').addEventListener('click', () => this.startBaseline());
    this.el('cancel').addEventListener('click', () => this.cancelBaseline());
    this.el('validate').addEventListener('click', () => this.validate());
    this.el('training-confirm').addEventListener('change', () => this.updateButtons());
    for (const [field, action] of [['capture','capture'],['cancel-training','cancel'],['train','train'],['activate','activate']]) {
      this.el(field).addEventListener('click', async () => {
        this.trainingRequest = true; this.updateButtons();
        try { this.trainingState = await api('/local/activity/training/'+action, action === 'capture' ? {label:this.el('training-label').value,confirmed:this.el('training-confirm').checked} : action === 'activate' ? {candidate_id:this.trainingState.candidate.id} : {}); this.text('error', action === 'activate' ? 'New model activated. Run fresh accuracy checks before relying on it.' : ''); }
        catch(error) { this.text('error',error.message); }
        finally { this.trainingRequest = false; this.updateButtons(); }
      });
    }
    this.refresh();
  }
  updateButtons() {
    const trainingBusy = !!this.trainingRequest || this.trainingState?.status === 'countdown' || this.trainingState?.status === 'recording';
    this.el('start').disabled = trainingBusy || this.busy || this.trialRunning || !this.el('empty').checked || !this.binding?.binding_digest || ['collecting','uncalibrated'].includes(this.calibration?.status);
    this.el('cancel').disabled = !this.busy;
    this.el('validate').disabled = trainingBusy || !!this.busy || !!this.trialRunning || ['collecting','uncalibrated'].includes(this.calibration?.status);
    const blocked = trainingBusy || !!this.busy || !!this.trialRunning || ['collecting','uncalibrated'].includes(this.calibration?.status);
    this.el('capture').disabled = blocked || !this.el('training-confirm').checked;
    this.el('cancel-training').disabled = !trainingBusy;
    this.el('train').disabled = blocked || !this.trainingState || Object.values(this.trainingState.counts).some(n => n < 25);
    this.el('activate').disabled = blocked || !this.trainingState?.candidate;
  }
  async refresh() {
    try {
      const s = await api('/api/v1/calibration/status'); if (this.disposed) return;
      this.trainingState = await api('/local/activity/training');
      const t = this.trainingState;
      const remaining = t.capture ? Math.max(0,Math.ceil(((t.status === 'countdown' ? t.capture.starts_at : t.capture.ends_at)-Date.now())/1000)) : 0;
      this.text('training-progress', `${t.status}${t.capture ? ` · ${describe(t.capture.label)} · ${remaining}s remaining` : ''} · ${Object.entries(t.counts).map(([label,n]) => `${describe(label)}: ${n}`).join(' · ')}${t.error ? ` · ${t.error}` : ''}`);
      this.text('candidate', t.candidate ? `Candidate: ${t.candidate.training_frames} fitting frames · raw three-class holdout ${Math.round(100*t.candidate.holdout_accuracy)}% on ${t.candidate.holdout_frames} frames; still/moving holdout ${Math.round(100*t.candidate.motion_holdout_accuracy)}% on ${t.candidate.motion_holdout_frames} frames. The current display mode is retained on activation; learned motion remains experimental. Fresh room trials are still required.` : 'No candidate waiting for activation.');
      this.calibration = s;
      if (s.binding_digest && s.source_node_ids?.length === 1) this.binding = s;
      const elapsed = Math.floor(s.elapsed_s || 0), required = Math.ceil(s.min_duration_s || 600);
      const collecting = ['collecting','uncalibrated'].includes(s.status);
      this.text('baseline', `Baseline: ${s.status} · ${collecting ? `${elapsed}/${required} seconds · ` : ''}${s.frame_count || 0} frames${s.sequence_fault_node_ids?.length ? ' · SEQUENCE FAULT' : ''}`);
      this.el('progress').value = Math.min(1, elapsed/required, (s.frame_count || 0)/(s.min_frames || 1000));
      if (this.capture && !this.finishing) {
        if (baselineReady(s, this.capture)) {
          this.finishing = true;
          try { await api('/api/v1/calibration/stop', this.capture); this.capture = null; this.busy = false; this.text('error','New runtime baseline completed. Keep hardware in place; activity accuracy still needs checking.'); }
          finally { this.finishing = false; }
        }
      }
    } catch (error) { if (!this.disposed) this.text('error',error.message); }
    if (!this.disposed) { this.updateButtons(); this.timer = setTimeout(() => this.refresh(), 2000); }
  }
  async startBaseline() {
    if (this.el('start').disabled) return;
    this.busy = true; this.updateButtons(); this.text('error','Leave the room now. Capture starts in 20 seconds.');
    this.countdown = setTimeout(async () => {
      try {
        const s = this.binding;
        if (!s || !Array.isArray(s.source_node_ids) || s.source_node_ids.length !== 1 || ['collecting','uncalibrated'].includes(this.calibration.status)) throw new Error('A single established room binding is required.');
        if (this.calibration.status === 'fresh') await api('/api/v1/calibration/reset', identity(this.calibration));
        this.capture = identity(await api(`/api/v1/calibration/start?source_node_id=${s.source_node_ids[0]}`, { binding_digest: s.binding_digest, source_node_ids: s.source_node_ids }));
        this.text('error','Capturing empty room. Stay outside until baseline completes (at least 10 minutes).');
      } catch (error) { this.busy = false; this.text('error',error.message); }
      this.updateButtons();
    }, 20000);
  }
  async cancelBaseline() {
    clearTimeout(this.countdown);
    try { if (this.capture) await api('/api/v1/calibration/cancel', this.capture); this.capture = null; this.busy = false; this.text('error','Baseline capture cancelled.'); }
    catch (error) { this.text('error',error.message); }
    this.updateButtons();
  }
  async validate() {
    if (this.el('validate').disabled) return;
    const expected = this.el('expected').value;
    this.trialRunning = true; this.updateButtons();
    this.text('trial',`Prepare: ${describe(expected)}. Check begins in 20 seconds, then runs for 20 seconds.`);
    const pause = ms => new Promise(resolve => setTimeout(resolve,ms));
    await pause(20000);
    if (this.disposed) return;
    const counts = {}, ticks = new Set(); let unavailable = 0;
    const deadline = Date.now()+20000;
    this.text('trial',`Checking: ${describe(expected)}. Maintain this condition for 20 seconds.`);
    while (Date.now() < deadline && !this.disposed) {
      try { const f = await api('/api/v1/sensing/latest'); const s = f.local_activity;
        if (s?.status !== 'live') unavailable++;
        else if (!ticks.has(s.source_tick)) { ticks.add(s.source_tick); counts[s.label] = (counts[s.label] || 0)+1; }
      } catch { unavailable++; }
      await pause(1000);
    }
    if (this.disposed) return;
    const n = ticks.size, matched = counts[expected] || 0;
    this.text('trial', `${describe(expected)} check: ${matched}/${n} unique live frames matched${n ? ` (${Math.round(100*matched/n)}%)` : ''}. Unavailable reads: ${unavailable}.\n${Object.entries(counts).map(([k,v]) => `${describe(k)}: ${v}`).join(' · ')}\nOne short trial does not establish overall accuracy.`);
    this.trialRunning = false; this.updateButtons();
  }
}
