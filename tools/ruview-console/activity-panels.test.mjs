import test from 'node:test';
import assert from 'node:assert/strict';
import { baselineReady } from './activity-panels.js';

const capture = { boot_epoch: 'boot-test', session_id: 'capture-test',
  binding_digest: 'a'.repeat(64), source_node_ids: [42] };
const status = () => ({ ...capture, status: 'collecting', min_duration_s: 600,
  min_frames: 1000, elapsed_s: 601, frame_count: 1100, sequence_fault_node_ids: [] });

test('baseline finalization requires both real server targets and an unfinished capture', () => {
  assert.equal(baselineReady(status(), capture), true);
  for (const override of [{ elapsed_s: 599 }, { frame_count: 999 },
    { min_duration_s: null }, { min_frames: 0 }, { status: 'fresh' }]) {
    assert.equal(baselineReady({ ...status(), ...override }, capture), false);
  }
});

test('baseline never finalizes a changed room, boot, session, radio set, or faulty sequence', () => {
  for (const override of [{ boot_epoch: 'new-boot' }, { session_id: 'other' },
    { binding_digest: 'b'.repeat(64) }, { source_node_ids: [43] },
    { sequence_fault_node_ids: [42] }]) {
    assert.throws(() => baselineReady({ ...status(), ...override }, capture));
  }
});
