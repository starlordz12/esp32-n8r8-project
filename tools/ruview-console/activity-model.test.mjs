import test from 'node:test';
import assert from 'node:assert/strict';
import { activityFeatures, loadActivityModel, predictActivity, applyActivityModel } from './activity-model.mjs';

const model = (overrides = {}) => loadActivityModel(JSON.stringify({ version: 2, trained_frames: 200,
  class_names: ['absent', 'present_still', 'present_moving'], global_mean: Array(15).fill(0),
  global_std: Array(15).fill(1), weights: [Array(15).fill(0).concat(2), Array(16).fill(0), Array(16).fill(0)], ...overrides }));
const features = { variance: 1, motion_band_power: 2, breathing_band_power: 3,
  spectral_power: 4, dominant_freq_hz: 5, change_points: 6, mean_rssi: -60 };
const frame = () => ({ type: 'sensing_update', source: 'esp32', tick: 99,
  classification: { motion_level: 'present_moving', presence: true, confidence: .9 },
  room_inference: { classification: 'present_moving' },
  nodes: [{ node_id: 42, amplitude: Array(128).fill(2) }],
  node_features: [{ node_id: 42, stale: false, features }] });

test('feature contract preserves measured frequency and truncates amplitudes to 56', () => {
  const a = activityFeatures(features, Array(56).fill(2).concat(Array(72).fill(10000)));
  assert.deepEqual(a.slice(0, 7), [1, 2, 3, 4, 5, 6, -60]);
  assert.equal(a[7], 2);
  assert.equal(a[9], 0);
  assert.equal(a[10], -3);
  assert.ok(Math.abs(a[12] - 1) < 1e-12);
  assert.equal(a[13], 2);
  assert.equal(a[14], 0);
});
test('malformed/missing raw features abstain rather than classifying zeros', () => {
  assert.equal(activityFeatures(features, []), null);
  assert.equal(activityFeatures({ ...features, mean_rssi: NaN }, Array(56).fill(2)), null);
  assert.throws(() => model({ version: 1 }));
  assert.throws(() => model({ weights: [[1]] }));
});
test('stable softmax uses learned bias and feature coefficients', () => {
  const prediction = predictActivity(model(), Array(15).fill(0));
  assert.equal(prediction.label, 'absent');
  assert.ok(Math.abs(prediction.confidence - Math.exp(2) / (Math.exp(2) + 2)) < 1e-12);
  const w = [Array(16).fill(0), Array(16).fill(0), [2, ...Array(15).fill(0)]];
  assert.equal(predictActivity(model({ weights: w }), [1000, ...Array(14).fill(0)]).label, 'present_moving');
});
test('real model prediction replaces stale heuristic label while retaining provenance', () => {
  const input = frame();
  const output = applyActivityModel(input, model(), 42);
  assert.equal(output.classification.presence, false);
  assert.equal(output.nodes[0].node_inference.classification, 'absent');
  assert.equal(output.local_activity.status, 'live');
  assert.equal(output.upstream_classification.motion_level, 'present_moving');
  assert.equal(input.classification.motion_level, 'present_moving');
  assert.equal(output.source, 'esp32');
});
test('simulation, stale data, different hardware and multiple nodes never acquire a trained-live label', () => {
  const f = frame();
  for (const bad of [{ ...f, source: 'simulated' }, { ...f, age_ms: 6000 },
    { ...f, nodes: [{ ...f.nodes[0], node_id: 9 }] }, { ...f, nodes: [...f.nodes, f.nodes[0]] }]) {
    const output = applyActivityModel(bad, model(), 42);
    assert.equal(output.local_activity.status, 'unavailable');
    assert.equal(output.classification, bad.classification);
  }
});
