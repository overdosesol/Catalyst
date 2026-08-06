import test from 'node:test';
import assert from 'node:assert/strict';

import { isNarrativeLaneEnabled, resolveLane, LANE_NARRATIVE, LANE_VOLUME } from '../src/analysis/lane.js';

const dbWith = (settings = {}) => ({
  getSetting: (k, d) => (k in settings ? settings[k] : d),
});

test('lane is enabled by default, including with no db at all', () => {
  assert.equal(isNarrativeLaneEnabled(dbWith()), true);
  assert.equal(isNarrativeLaneEnabled(null), true);
});

test('lane can be switched off by setting', () => {
  assert.equal(isNarrativeLaneEnabled(dbWith({ narrativeLaneEnabled: '0' })), false);
});

test('a db that throws does not change scoring behaviour', () => {
  const angry = { getSetting: () => { throw new Error('db is down'); } };
  assert.equal(isNarrativeLaneEnabled(angry), true);
});

test('an item from a narrative probe is narrative regardless of its text', () => {
  const item = { title: 'just a cat', _fromProbe: true };
  assert.equal(resolveLane(item, { enabled: true }).lane, LANE_NARRATIVE);
});

test('a story-shaped title lands in the narrative lane', () => {
  const item = { title: 'Dog rescued from frozen lake after three hours' };
  const r = resolveLane(item, { enabled: true });
  assert.equal(r.lane, LANE_NARRATIVE);
  assert.equal(r.reason, 'lexical:event');
});

test('a known-lore subject lands in the narrative lane even with a flat title', () => {
  const item = { title: 'capybara vibes', metrics: { subjectNames: ['Janet'] } };
  const r = resolveLane(item, { enabled: true, hasLore: () => true });
  assert.equal(r.lane, LANE_NARRATIVE);
  assert.equal(r.reason, 'ledger:Janet');
});

test('plain cute content stays in the volume lane', () => {
  const item = { title: 'My cat being adorable as always' };
  assert.equal(resolveLane(item, { enabled: true }).lane, LANE_VOLUME);
});

test('with the lane disabled everything is volume, probes included', () => {
  const item = { title: 'Dog rescued from frozen lake', _fromProbe: true };
  assert.equal(resolveLane(item, { enabled: false }).lane, LANE_VOLUME);
});

test('a throwing hasLore callback degrades to lexical only', () => {
  const item = { title: 'Dog rescued from a lake', metrics: { subjectNames: ['Janet'] } };
  const r = resolveLane(item, { enabled: true, hasLore: () => { throw new Error('nope'); } });
  assert.equal(r.lane, LANE_NARRATIVE);
  assert.equal(r.reason, 'lexical:event');
});
