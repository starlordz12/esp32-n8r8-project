import { createHash } from 'node:crypto';

const FEATURE_COUNT = 15;
const CLASSES = new Set(['absent', 'present_still', 'present_moving', 'active']);
const FEATURE_NAMES = ['variance', 'motion_band_power', 'breathing_band_power',
  'spectral_power', 'dominant_freq_hz', 'change_points', 'mean_rssi'];
const finiteArray = (value, size) => Array.isArray(value) && value.length === size && value.every(Number.isFinite);

export function loadActivityModel(text) {
  const model = JSON.parse(text);
  if (model.version !== 2 || !Number.isInteger(model.trained_frames) || model.trained_frames < 1 ||
      !Array.isArray(model.class_names) || model.class_names.length < 2 ||
      new Set(model.class_names).size !== model.class_names.length || !model.class_names.every(c => CLASSES.has(c)) ||
      !finiteArray(model.global_mean, FEATURE_COUNT) || !finiteArray(model.global_std, FEATURE_COUNT) ||
      model.global_std.some(x => x < 0) || !Array.isArray(model.weights) ||
      model.weights.length !== model.class_names.length || !model.weights.every(w => finiteArray(w, FEATURE_COUNT + 1))) {
    throw new Error('Unsupported or invalid trained activity model');
  }
  return { ...model, id: createHash('sha256').update(text).digest('hex') };
}

// Mirrors the running server's version-2 feature contract: seven measured
// features and eight statistics over the FIRST 56 broadcast amplitudes.
export function activityFeatures(features, amplitudes) {
  if (!features || !FEATURE_NAMES.every(k => Number.isFinite(features[k])) ||
      !Array.isArray(amplitudes) || amplitudes.length < 56) return null;
  const a = amplitudes.slice(0, 56);
  if (!a.every(Number.isFinite)) return null;
  const n = a.length;
  const mean = a.reduce((s, x) => s + x, 0) / n;
  const variance = a.reduce((s, x) => s + (x - mean) ** 2, 0) / n;
  const std = Math.max(Math.sqrt(variance), 1e-9);
  const skew = a.reduce((s, x) => s + ((x - mean) / std) ** 3, 0) / n;
  const kurtosis = a.reduce((s, x) => s + ((x - mean) / std) ** 4, 0) / n - 3;
  const sorted = [...a].sort((x, y) => x - y);
  const iqr = sorted[Math.floor(3 * n / 4)] - sorted[Math.floor(n / 4)];
  const power = Math.max(a.reduce((s, x) => s + x * x, 0), 1e-9);
  const entropy = a.reduce((s, x) => {
    const p = x * x / power;
    return s + (p > 1e-12 ? -p * Math.log(p) : 0);
  }, 0) / Math.max(Math.log(n), 1e-9);
  const vector = [...FEATURE_NAMES.map(k => features[k]), mean, std, skew,
    kurtosis, iqr, entropy, sorted[n - 1], sorted[n - 1] - sorted[0]];
  return vector.every(Number.isFinite) ? vector : null;
}

export function predictActivity(model, vector) {
  if (!finiteArray(vector, FEATURE_COUNT)) throw new Error('Invalid activity feature vector');
  const x = vector.map((v, i) => (v - model.global_mean[i]) / (model.global_std[i] + 1e-9));
  const logits = model.weights.map(w => w[FEATURE_COUNT] + x.reduce((s, v, i) => s + v * w[i], 0));
  if (!logits.every(Number.isFinite)) throw new Error('Nonfinite model prediction');
  const max = Math.max(...logits);
  const exp = logits.map(z => Math.exp(z - max));
  const total = exp.reduce((s, v) => s + v, 0);
  const probabilities = exp.map(v => v / total);
  const index = probabilities.indexOf(Math.max(...probabilities));
  return { label: model.class_names[index], confidence: probabilities[index],
    probabilities: Object.fromEntries(model.class_names.map((c, i) => [c, probabilities[i]])) };
}

export function applyActivityModel(frame, model, nodeId) {
  if (frame?.type !== 'sensing_update') return frame;
  const unavailable = reason => ({ ...frame, local_activity: { status: 'unavailable', reason, model_id: model.id } });
  if (frame.source !== 'esp32' || (Number.isFinite(frame.age_ms) && frame.age_ms > 5000)) return unavailable('source_not_live');
  if (!Array.isArray(frame.nodes) || frame.nodes.length !== 1) return unavailable('single_trained_node_required');
  const node = frame.nodes.find(n => n.node_id === nodeId);
  const perNode = frame.node_features?.find(n => n.node_id === nodeId);
  if (!node || !perNode || perNode.stale || (Number.isFinite(perNode.age_ms) && perNode.age_ms > 5000)) return unavailable('trained_node_not_fresh');
  const features = activityFeatures(perNode.features, node.amplitude);
  if (!features) return unavailable('complete_raw_features_required');
  const prediction = predictActivity(model, features);
  const classification = { presence: prediction.label !== 'absent',
    motion_level: prediction.label, confidence: prediction.confidence };
  return { ...frame,
    upstream_classification: frame.classification,
    classification,
    upstream_room_inference: frame.room_inference,
    room_inference: { classification: prediction.label, confidence: prediction.confidence, contributing_nodes: 1 },
    nodes: frame.nodes.map(n => ({ ...n, upstream_node_inference: n.node_inference,
      node_inference: { ...n.node_inference, classification: prediction.label, confidence: prediction.confidence } })),
    local_activity: { status: 'live', model_id: model.id, model_version: model.version,
      trained_frames: model.trained_frames, node_id: nodeId, ...prediction,
      scope: 'room_activity_only', source_tick: frame.tick },
  };
}
