import test from 'node:test';
import assert from 'node:assert/strict';

import { computeVolumeCap } from '../src/notifications/alert-dispatcher.js';

test('half the cycle cap is reserved for the narrative lane', () => {
  // 5 slots, 2 reserved (floor(5/2)) → volume may take 3
  assert.equal(computeVolumeCap(5, 4), 3);
});

test('an unused reserve flows back to volume', () => {
  // only 1 narrative candidate exists → reserve shrinks to 1 → volume gets 4
  assert.equal(computeVolumeCap(5, 1), 4);
  // none at all → volume gets the whole cap
  assert.equal(computeVolumeCap(5, 0), 5);
});

test('volume never eats into the narrative half when candidates exist', () => {
  assert.equal(computeVolumeCap(4, 10), 2);
  assert.equal(computeVolumeCap(6, 10), 3);
});

test('an unlimited cap stays unlimited', () => {
  assert.equal(computeVolumeCap(0, 10), 0);
});

test('a cap of one is not stolen by the reserve', () => {
  // floor(1/2) = 0 → the single slot stays open to whoever ranks highest
  assert.equal(computeVolumeCap(1, 5), 1);
});
