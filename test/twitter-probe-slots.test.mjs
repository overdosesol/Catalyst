import test from 'node:test';
import assert from 'node:assert/strict';

import config from '../src/config.js';
import TwitterCollector from '../src/collectors/twitter.js';

const silentLogger = { info() {}, warn() {}, debug() {}, error() {} };
const db = { getSetting: (k, d) => (k === 'activePreset' ? 'animals' : d) };

test('a cycle picks three queries: one volume, two probes', () => {
  const c = new TwitterCollector(config, silentLogger, db);
  const picked = c._pickQueries();

  assert.equal(picked.length, 3);
  assert.equal(picked.filter(p => p.fromProbe).length, 2);
  assert.equal(picked.filter(p => !p.fromProbe).length, 1);
});

test('probes rotate across cycles so all four families get used', () => {
  const c = new TwitterCollector(config, silentLogger, db);
  const seen = new Set();
  for (let i = 0; i < 4; i++) {
    for (const p of c._pickQueries()) if (p.fromProbe) seen.add(p.query);
  }
  assert.equal(seen.size, 4, 'all four probes must appear within four cycles');
});

test('volume queries rotate too', () => {
  const c = new TwitterCollector(config, silentLogger, db);
  const seen = new Set();
  for (let i = 0; i < 4; i++) {
    for (const p of c._pickQueries()) if (!p.fromProbe) seen.add(p.query);
  }
  assert.ok(seen.size >= 3, 'volume slot must not stick to one query');
});

test('with no probes configured the cycle keeps the old two volume slots', () => {
  const bareDb = {
    getSetting: (k, d) => {
      if (k === 'activePreset') return 'animals';
      if (k === 'presetConfigs') return JSON.stringify({ animals: { sources: { twitter: { narrativeProbes: [] } } } });
      return d;
    },
  };
  const c = new TwitterCollector(config, silentLogger, bareDb);
  const picked = c._pickQueries();
  assert.equal(picked.length, 2, 'no probes must not mean half the coverage');
  assert.equal(picked.filter(p => p.fromProbe).length, 0);
  assert.notEqual(picked[0].query, picked[1].query, 'two slots must not spend two calls on one query');
});

// The regression this guards: only `animals` ships narrativeProbes, so a
// probes-aware _pickQueries that always reserved just one volume slot cut
// every other preset from 2 X queries per cycle to 1.
for (const preset of ['culture', 'celebrities', 'events', 'general']) {
  test(`preset "${preset}" still gets two volume queries per cycle`, () => {
    const presetDb = { getSetting: (k, d) => (k === 'activePreset' ? preset : d) };
    const c = new TwitterCollector(config, silentLogger, presetDb);
    const picked = c._pickQueries();

    assert.equal(picked.filter(p => p.fromProbe).length, 0, `${preset} has no probes`);
    assert.equal(picked.length, 2);
  });
}

test('a one-query preset spends one call, not two on the same query', () => {
  const oneQueryDb = {
    getSetting: (k, d) => {
      if (k === 'activePreset') return 'animals';
      if (k === 'presetConfigs') {
        return JSON.stringify({
          animals: { sources: { twitter: { queries: ['solo min_faves:10000'], narrativeProbes: [] } } },
        });
      }
      return d;
    },
  };
  const c = new TwitterCollector(config, silentLogger, oneQueryDb);
  const picked = c._pickQueries();
  assert.equal(picked.length, 1);
});
