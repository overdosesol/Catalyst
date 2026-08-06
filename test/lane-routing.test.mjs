import test from 'node:test';
import assert from 'node:assert/strict';

import { applyLanePriority } from '../src/analysis/clusterer.js';
import { LANE_NARRATIVE, LANE_VOLUME } from '../src/analysis/lane.js';

test('a narrative item that would be saved without scoring is promoted', () => {
  assert.equal(applyLanePriority('save_only', { lane: LANE_NARRATIVE }), 'priority');
});

test('a narrative item that would go to stage1 is promoted', () => {
  assert.equal(applyLanePriority('stage1', { lane: LANE_NARRATIVE }), 'priority');
});

test('drop still wins — the lane must not resurrect settled noise', () => {
  assert.equal(applyLanePriority('drop', { lane: LANE_NARRATIVE }), 'drop');
});

test('volume items keep whatever the metrics decided', () => {
  assert.equal(applyLanePriority('save_only', { lane: LANE_VOLUME }), 'save_only');
  assert.equal(applyLanePriority('stage1',    { lane: LANE_VOLUME }), 'stage1');
});

test('a missing lane is treated as volume', () => {
  assert.equal(applyLanePriority('save_only', {}), 'save_only');
  assert.equal(applyLanePriority('save_only', null), 'save_only');
});
