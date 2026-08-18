import test from 'node:test';
import assert from 'node:assert/strict';

import config from '../src/config.js';
import TwitterCollector, { resolveItemBudget, PROBE_ITEM_CAP } from '../src/collectors/twitter.js';

// 2026-08-15 the operator switched twitterActor from kaitoeasyapi to xquik.
// xquik rejects the whole run with 400 "Max Items must be at least 20" when
// maxItems is lower — and two callers ask for lower: narrative probes (15) and
// X-Trends tweet pulls (7). Both returned nothing for three days, at WARN
// level, while the volume slot kept working and hid the hole.

const silentLogger = { info() {}, warn() {}, debug() {}, error() {} };

function collectorOn(actor, apiKey = 'test-key') {
  const db = {
    getSetting: (k, d) => {
      if (k === 'twitterActor') return actor;
      if (k === 'activePreset') return 'animals';
      return d;
    },
  };
  const c = new TwitterCollector(
    { ...config, apify: { ...config.apify, twitterKeys: { kaitoeasyapi: apiKey, xquik: apiKey } } },
    silentLogger,
    db
  );
  c.twitterKeys = { kaitoeasyapi: apiKey, xquik: apiKey };
  return c;
}

/** Capture the Apify request body without hitting the network. */
async function sentInput(collector, ...searchArgs) {
  const realFetch = global.fetch;
  let body = null;
  global.fetch = async (_url, opts) => {
    body = JSON.parse(opts.body);
    return { ok: true, json: async () => [] };
  };
  try { await collector._searchQuery(...searchArgs); }
  finally { global.fetch = realFetch; }
  return body;
}

test('the floor lifts a request, never lowers one', () => {
  assert.equal(resolveItemBudget({ minItems: 20 }, 7), 20);
  assert.equal(resolveItemBudget({ minItems: 20 }, 15), 20);
  assert.equal(resolveItemBudget({ minItems: 20 }, 50), 50, 'a bigger ask must survive');
  assert.equal(resolveItemBudget({}, 7), 7, 'an actor without a floor is left alone');
  assert.equal(resolveItemBudget({ minItems: 20 }, 0), 20);
  assert.equal(resolveItemBudget({}, undefined), 1, 'never send zero');
});

test('a probe query clears the xquik floor instead of 400-ing the run', async () => {
  const input = await sentInput(collectorOn('xquik'), 'story query', undefined, { fromProbe: true });
  assert.equal(input.maxItems, 20);
});

test('an X-Trends pull of 7 clears the floor too', async () => {
  const input = await sentInput(collectorOn('xquik'), 'Some Trend', 7);
  assert.equal(input.maxItems, 20);
});

test('on an actor without a floor probes stay shallow', async () => {
  const input = await sentInput(collectorOn('kaitoeasyapi'), 'story query', undefined, { fromProbe: true });
  assert.equal(input.maxItems, PROBE_ITEM_CAP, 'shallow is still the preference where it is allowed');
});

test('a volume query is unaffected on either actor', async () => {
  for (const actor of ['xquik', 'kaitoeasyapi']) {
    const input = await sentInput(collectorOn(actor), 'volume query', undefined, {});
    assert.equal(input.maxItems, 20, `${actor}: the configured cycle cap goes through untouched`);
  }
});
