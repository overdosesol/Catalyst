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

test('with no probes configured the cycle degrades to volume only', () => {
  const bareDb = {
    getSetting: (k, d) => {
      if (k === 'activePreset') return 'animals';
      if (k === 'presetConfigs') return JSON.stringify({ animals: { sources: { twitter: { narrativeProbes: [] } } } });
      return d;
    },
  };
  const c = new TwitterCollector(config, silentLogger, bareDb);
  const picked = c._pickQueries();
  assert.ok(picked.length >= 1);
  assert.equal(picked.filter(p => p.fromProbe).length, 0);
});
