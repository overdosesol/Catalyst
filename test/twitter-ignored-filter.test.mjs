import test from 'node:test';
import assert from 'node:assert/strict';

import config from '../src/config.js';
import TwitterCollector, {
  parseMinFaves,
  detectIgnoredFilter,
  IGNORED_FILTER_MIN_SAMPLE,
} from '../src/collectors/twitter.js';
import { sourceHealth } from '../src/notifications/source-health.js';

// The failure this exists for, measured 2026-08-18 against xquik~x-tweet-scraper:
// roughly two runs in three, the actor ignores the `min_faves:` operator in the
// query and returns ~20 arbitrary tweets with a median of 0 likes. HTTP 201, no
// error, well-formed payload. Every one of them then fails the 500K-views bar,
// so the cycle logs "Collected 0 items" and nothing anywhere raises a hand.
//
// Neither existing health signal can see it: `down` needs a thrown error and
// `silent` needs 72 consecutive empty cycles, which never happen because the
// occasional honest run trickles one item through. A source that lies is
// invisible to a monitor that only knows "erroring" and "quiet".
//
// Sampled that day: xquik honoured the filter on 5 of 15 runs, kaitoeasyapi on
// 5 of 5.

const silentLogger = { info() {}, warn() {}, debug() {}, error() {} };

const tweets = (likeCounts) => likeCounts.map((likeCount, i) => ({
  id: String(i), text: 'a tweet about cats that is long enough', likeCount, viewCount: likeCount * 40,
}));

// ── Reading the demand out of our own query ──────────────────────────────────

test('the floor is read from the query we sent', () => {
  assert.equal(parseMinFaves('(dog OR puppy) min_faves:10000 -is:retweet'), 10000);
  assert.equal(parseMinFaves('(rescue OR adopt) (dog OR cat) min_faves:5000 -is:retweet'), 5000);
  assert.equal(parseMinFaves('MIN_FAVES:250'), 250, 'operators are case-insensitive on X');
});

test('a query without the operator yields no floor to check', () => {
  assert.equal(parseMinFaves('capybara escapes zoo'), 0);
  assert.equal(parseMinFaves(''), 0);
  assert.equal(parseMinFaves(null), 0);
  assert.equal(parseMinFaves(undefined), 0);
});

// ── The detector ─────────────────────────────────────────────────────────────

test('an honest run is not flagged', () => {
  // What kaitoeasyapi returned on all five sampled runs.
  const honest = tweets([184199, 33712, 22923, 35033, 36382, 12061, 12063, 134996]);
  assert.equal(detectIgnoredFilter(honest, 10000), null);
});

test('the observed junk shape is flagged', () => {
  // Median 0 likes against a query that demanded 10 000.
  const junk = tweets([0, 0, 7, 2, 0, 0, 2, 0, 6, 10, 3, 38, 1, 30, 0, 0, 5, 11, 11, 1]);
  const hit = detectIgnoredFilter(junk, 10000);
  assert.ok(hit, 'twenty tweets averaging single-digit likes must not read as success');
  assert.equal(hit.total, 20);
  assert.equal(hit.below, 20);
  assert.equal(hit.minFaves, 10000);
  assert.equal(hit.medianLikes, 2);
});

test('the other observed junk shape — a short run with two real tweets — is flagged too', () => {
  // The 2-of-16 case from the same day: a couple of genuine hits mixed into
  // noise. Still junk, and a rule that needed ALL tweets to be below would
  // have missed it.
  const mixed = tweets([0, 0, 13, 22923, 4, 0, 1, 9, 0, 33712, 2, 0, 7, 0, 3, 1]);
  const hit = detectIgnoredFilter(mixed, 10000);
  assert.ok(hit);
  assert.equal(hit.below, 14);
  assert.equal(hit.total, 16);
});

test('a run that is mostly good is left alone', () => {
  // Search indexes lag: a tweet can be indexed above the floor and read back
  // below it. A handful of those is normal and must not page anyone.
  const slightlyStale = tweets([184199, 33712, 22923, 9800, 35033, 36382, 9100, 12063]);
  assert.equal(detectIgnoredFilter(slightlyStale, 10000), null, '2 of 8 stale is not a broken actor');
});

test('the boundary is half the sample', () => {
  const half = tweets([0, 0, 0, 0, 20000, 20000, 20000, 20000]);
  assert.ok(detectIgnoredFilter(half, 10000), 'exactly half below trips it');
  const justUnder = tweets([0, 0, 0, 20000, 20000, 20000, 20000, 20000]);
  assert.equal(detectIgnoredFilter(justUnder, 10000), null);
});

test('a small sample is never judged', () => {
  // Three bad tweets is a slow news minute, not evidence about the actor.
  const tiny = tweets([0, 0, 0]);
  assert.equal(detectIgnoredFilter(tiny, 10000), null);
  assert.equal(tiny.length < IGNORED_FILTER_MIN_SAMPLE, true, 'precondition');
  assert.equal(detectIgnoredFilter(tweets([0, 0, 0, 0, 0]), 10000)?.total, 5, 'five is enough to judge');
});

test('with no floor in the query there is nothing to check', () => {
  // X-Trends pulls a trend name with no operators. Every tweet is "below"
  // a floor of zero, and flagging those would fire on every single run.
  assert.equal(detectIgnoredFilter(tweets([0, 0, 0, 0, 0, 0]), 0), null);
});

test('junk metrics never throw and never pass as healthy', () => {
  const weird = [{ likeCount: null }, { favoriteCount: 'x' }, {}, { likeCount: undefined }, null, { likeCount: NaN }];
  const hit = detectIgnoredFilter(weird, 5000);
  assert.ok(hit, 'unreadable engagement is not evidence the filter worked');
  assert.equal(hit.below, 6);
});

test('the legacy field name counts too', () => {
  const legacy = [1, 2, 3, 4, 5, 6].map(i => ({ favoriteCount: 50000 + i }));
  assert.equal(detectIgnoredFilter(legacy, 10000), null, 'favoriteCount is read like likeCount');
});

test('an empty or non-array payload is not a filter fault', () => {
  // "Nothing came back" is the `silent` signal's job, not this one.
  assert.equal(detectIgnoredFilter([], 10000), null);
  assert.equal(detectIgnoredFilter(null, 10000), null);
  assert.equal(detectIgnoredFilter(undefined, 10000), null);
});

// ── Wiring: the detector has to reach the health tracker ─────────────────────

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

async function searchReturning(payload, query) {
  const collector = collectorOn('xquik');
  const realFetch = global.fetch;
  global.fetch = async () => ({ ok: true, json: async () => payload });
  try {
    const items = await collector._searchQuery(query, undefined, {});
    return { items, collector };
  } finally { global.fetch = realFetch; }
}

const Q = '(cat OR kitten OR kitty OR meow) min_faves:10000 -is:retweet';

test('a lying run yields nothing and counts as a failure', async () => {
  const junk = tweets([0, 0, 7, 2, 0, 0, 2, 0, 6, 10, 3, 38, 1, 30, 0, 0, 5, 11, 11, 1]);
  const { items, collector } = await searchReturning(junk, Q);
  assert.deepEqual(items, [], 'junk must not be handed downstream');
  assert.equal(collector._cycleFailures, 1, 'the cycle is marked failed, same as a thrown error');
  assert.match(collector._cycleLastError || '', /min_faves/);
});

test('an honest run is passed through untouched', async () => {
  const honest = tweets([184199, 33712, 22923, 35033, 36382, 12061, 12063, 134996]);
  const { items, collector } = await searchReturning(honest, Q);
  assert.ok(items.length > 0, 'real viral tweets still make it through');
  assert.equal(collector._cycleFailures, 0, 'a healthy run is not a failure');
});

test('four lying cycles reach Telegram, one honest cycle clears it', async () => {
  sourceHealth.reset();
  const junk   = tweets([0, 0, 7, 2, 0, 0, 2, 0, 6, 10, 3, 38, 1, 30, 0, 0, 5, 11, 11, 1]);
  const honest = tweets([184199, 33712, 22923, 35033, 36382, 12061, 12063, 134996]);

  const collector = collectorOn('xquik');
  collector._delay = async () => {};   // the real one sleeps 2s between queries
  const realFetch = global.fetch;
  let payload = junk;
  global.fetch = async () => ({ ok: true, json: async () => payload });
  try {
    for (let i = 0; i < 4; i++) await collector.safeCollect();
    const down = sourceHealth.snapshot().twitter;
    assert.equal(down.active, 'down', 'a source that lies for two hours must say so');
    assert.match(down.lastError, /ignored min_faves/);

    payload = honest;
    await collector.safeCollect();
    assert.equal(sourceHealth.snapshot().twitter.active, null, 'and the recovery has to land too');
  } finally {
    global.fetch = realFetch;
    sourceHealth.reset();
  }
});
