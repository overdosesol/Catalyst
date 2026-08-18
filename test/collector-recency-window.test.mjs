import test from 'node:test';
import assert from 'node:assert/strict';

import config from '../src/config.js';
import TwitterCollector, { withRecencyWindow, countQueryGroups } from '../src/collectors/twitter.js';
import TikTokCollector, { dateRangeForMaxAge } from '../src/collectors/tiktok.js';

// The bug both halves of this file fix, found 2026-08-18:
//
// We asked both actors for their ALL-TIME best and then threw away everything
// older than our own cap. Nobody had put the two numbers side by side.
//
//   Twitter: `queryType:'Top'` shipped in the first commit (2026-04-16).
//            `twitterMaxAgeHours` arrived eight days later (2026-04-24) and
//            started discarding exactly what Top returns. Measured: 1 of 20
//            tweets survived both filters; the oldest was 66957h (7.6 years).
//   TikTok:  the /tag/ page is editorially ranked, median age of what came
//            back was 691 days. Of 20 videos, 8 cleared the virality floor
//            and ALL 8 were then dropped by the 7-day cap. Zero reached the
//            pipeline — which is why the source read as "quiet, not broken".
//
// The fix in both cases is the same idea: ask the actor for the window we are
// actually going to keep, derived from our own setting, so the request and the
// filter can never disagree again.
//
// Measured after (3 runs each, same query):
//   Twitter within_time:3d → 20/20 fresh, oldest 69h, 7-8 reach the pipeline.
//   TikTok  dateRange THIS_WEEK → 20/20 fresh, median 3 days, 4 reach.

// ── Twitter ──────────────────────────────────────────────────────────────────

test('the window comes from our own age cap, in days when it divides evenly', () => {
  assert.equal(withRecencyWindow('cats min_faves:10000', 72), 'cats min_faves:10000 within_time:3d');
  assert.equal(withRecencyWindow('cats', 24), 'cats within_time:1d');
  assert.equal(withRecencyWindow('cats', 168), 'cats within_time:7d');
});

test('an odd number of hours stays in hours rather than rounding the window open', () => {
  assert.equal(withRecencyWindow('cats', 36), 'cats within_time:36h');
  assert.equal(withRecencyWindow('cats', 1), 'cats within_time:1h');
  assert.equal(withRecencyWindow('cats', 0.5), 'cats within_time:1h', 'never widen to satisfy the unit');
});

test('a query that already states its own window is left alone', () => {
  // An operator the caller wrote deliberately outranks the default.
  for (const q of [
    'cats within_time:12h',
    'cats since:2026-08-01',
    'cats until:2026-08-10',
    'cats SINCE_TIME:1234567890',
  ]) {
    assert.equal(withRecencyWindow(q, 72), q, q);
  }
});

test('with the age filter switched off we ask for everything, as before', () => {
  // twitterMaxAgeHours = 0 disables the cap. Narrowing the request anyway
  // would silently reinstate a filter the operator turned off.
  assert.equal(withRecencyWindow('cats', 0), 'cats');
  assert.equal(withRecencyWindow('cats', null), 'cats');
  assert.equal(withRecencyWindow('cats', undefined), 'cats');
  assert.equal(withRecencyWindow('cats', -5), 'cats');
});

test('empty input never becomes a bare operator', () => {
  assert.equal(withRecencyWindow('', 72), '');
  assert.equal(withRecencyWindow(null, 72), '');
  assert.equal(withRecencyWindow('   ', 72), '');
});

const silentLogger = { info() {}, warn() {}, debug() {}, error() {} };

function twitterOn(settings = {}) {
  const db = {
    getSetting: (k, d) => {
      if (k === 'twitterActor') return 'kaitoeasyapi';
      if (k === 'activePreset') return 'animals';
      if (k in settings) return settings[k];
      return d;
    },
  };
  const c = new TwitterCollector(
    { ...config, apify: { ...config.apify, twitterKeys: { kaitoeasyapi: 'k', xquik: 'k' } } },
    silentLogger, db
  );
  c.twitterKeys = { kaitoeasyapi: 'k', xquik: 'k' };
  return c;
}

async function sentQuery(collector, ...args) {
  const realFetch = global.fetch;
  let body = null;
  global.fetch = async (_u, opts) => { body = JSON.parse(opts.body); return { ok: true, json: async () => [] }; };
  try { await collector._searchQuery(...args); } finally { global.fetch = realFetch; }
  return body.searchTerms[0];
}

test('the window actually reaches Apify', async () => {
  const q = await sentQuery(twitterOn(), '(cat OR kitten) min_faves:10000 -is:retweet', undefined, {});
  assert.equal(q, '(cat OR kitten) min_faves:10000 -is:retweet within_time:3d');
});

test('the window tracks twitterMaxAgeHours, so the two can never disagree', async () => {
  // This is the whole point: one setting, one window. Change the cap in the
  // admin panel and the request follows it.
  assert.match(await sentQuery(twitterOn({ twitterMaxAgeHours: 24 }), 'cats', undefined, {}), /within_time:1d$/);
  assert.match(await sentQuery(twitterOn({ twitterMaxAgeHours: 12 }), 'cats', undefined, {}), /within_time:12h$/);
  assert.equal(await sentQuery(twitterOn({ twitterMaxAgeHours: 0 }), 'cats', undefined, {}), 'cats');
});

test('X-Trends pulls get the window too', async () => {
  // searchByQuery is how x-trends.js asks for tweets about a bare trend name.
  // Verified against the live actor: adding the window returns MORE tweets for
  // a trend, not fewer, and drops 82-day-old results that were pure noise.
  const q = await sentQuery(twitterOn(), '#SomeTrend', 7, { relaxedFloor: true });
  assert.equal(q, '#SomeTrend within_time:3d');
});

// ── The two-group limit ──────────────────────────────────────────────────────
// Found the hard way: this shipped without the guard, and the min_faves
// detector flagged our OWN queries in the very first cycle afterwards. Adding
// a recency operator to a query with two parenthesised groups makes the
// advanced-search parse collapse — min_faves stops being honoured and the
// median result comes back with 0 likes. Measured twice, identical both times.

test('one group takes the window, two groups do not', () => {
  const one = '(rescued OR reunited OR escaped OR survived) min_faves:5000 -is:retweet';
  assert.equal(withRecencyWindow(one, 72), `${one} within_time:3d`, 'OK: 20/20 honoured, 6 reach');

  const two = '(meet OR named) (dog OR cat OR zoo) min_faves:5000 -is:retweet';
  assert.equal(withRecencyWindow(two, 72), two, 'JUNK if windowed: 4/15 honoured, median 0 likes');
});

test('it is the group count, not the query length or -is:retweet', () => {
  // Both of these were measured as JUNK when windowed, so neither shortening
  // the groups nor dropping -is:retweet earns the window back.
  const short = '(rescued OR escaped) (dog OR cat) min_faves:5000 -is:retweet';
  const noRt  = '(meet OR named OR nicknamed) (dog OR cat OR zoo) min_faves:5000';
  assert.equal(withRecencyWindow(short, 72), short);
  assert.equal(withRecencyWindow(noRt, 72), noRt);
});

test('every shipped narrative probe is two-group, so none of them get windowed', async () => {
  // If a future preset edit collapses a probe to one group it SHOULD start
  // getting the window — this test documents today's state, not a rule.
  const { DEFAULT_PRESET_CONFIGS } = await import('../src/analysis/preset-config.js');
  const probes = DEFAULT_PRESET_CONFIGS.animals?.sources?.twitter?.narrativeProbes || [];
  assert.ok(probes.length > 0, 'precondition: animals has probes');
  for (const p of probes) {
    assert.ok(countQueryGroups(p) >= 2, `probe is single-group now, re-measure it: ${p}`);
    assert.equal(withRecencyWindow(p, 72), p);
  }
});

test('every shipped volume query is single-group, so all of them do', async () => {
  const { DEFAULT_PRESET_CONFIGS } = await import('../src/analysis/preset-config.js');
  const queries = DEFAULT_PRESET_CONFIGS.animals?.sources?.twitter?.queries || [];
  assert.ok(queries.length > 0, 'precondition: animals has volume queries');
  for (const q of queries) {
    const windowed = withRecencyWindow(q, 72);
    if (countQueryGroups(q) <= 1) assert.match(windowed, /within_time:3d$/, q);
  }
});

test('counting groups ignores nesting and unbalanced parens', () => {
  assert.equal(countQueryGroups('(a OR b)'), 1);
  assert.equal(countQueryGroups('(a OR b) (c OR d)'), 2);
  assert.equal(countQueryGroups('plain words'), 0);
  assert.equal(countQueryGroups('(unclosed'), 0);
  assert.equal(countQueryGroups(''), 0);
  assert.equal(countQueryGroups(null), 0);
});

// ── TikTok ───────────────────────────────────────────────────────────────────

test('the age cap maps onto the tightest window the actor offers', () => {
  // apidojo takes an enum, not a number, so we round DOWN to the nearest
  // window that still contains our cap — never up, or the actor pre-filters
  // away days we would have accepted.
  assert.equal(dateRangeForMaxAge(1), 'YESTERDAY');
  assert.equal(dateRangeForMaxAge(7), 'THIS_WEEK');
  assert.equal(dateRangeForMaxAge(3), 'THIS_WEEK', 'no 3-day option exists, so take the next one up');
  assert.equal(dateRangeForMaxAge(30), 'THIS_MONTH');
  assert.equal(dateRangeForMaxAge(90), 'LAST_THREE_MONTHS');
  assert.equal(dateRangeForMaxAge(180), 'LAST_SIX_MONTHS');
});

test('no cap means no date filter at all', () => {
  // tiktokMaxAgeDays = 0 disables our filter; the actor must not keep one.
  assert.equal(dateRangeForMaxAge(0), null);
  assert.equal(dateRangeForMaxAge(null), null);
  assert.equal(dateRangeForMaxAge(undefined), null);
  assert.equal(dateRangeForMaxAge(400), null, 'past six months there is nothing tighter than everything');
});

function tiktokOn(actor, settings = {}) {
  const db = {
    getSetting: (k, d) => {
      if (k === 'tiktokActor') return actor;
      if (k === 'activePreset') return 'animals';
      if (k in settings) return settings[k];
      return d;
    },
  };
  const c = new TikTokCollector(
    { ...config, tiktok: { ...config.tiktok, enabled: true }, apify: { ...config.apify, tiktokKeys: { clockworks: 'k', apidojo: 'k' } } },
    silentLogger, db
  );
  c.tiktokKeys = { clockworks: 'k', apidojo: 'k' };
  return c;
}

async function sentInput(collector, hashtag) {
  const realFetch = global.fetch;
  let body = null;
  global.fetch = async (_u, opts) => { body = JSON.parse(opts.body); return { ok: true, json: async () => [] }; };
  try { await collector._fetchHashtag(hashtag); } finally { global.fetch = realFetch; }
  return body;
}

test('apidojo is asked by keyword search, not by tag page', async () => {
  // The /tag/ page is editorially ranked and returns years-old videos, and
  // apidojo's own schema says dateRange "only works in Search". Keyword search
  // is the only input mode where a date filter exists at all.
  const input = await sentInput(tiktokOn('apidojo'), 'animalsoftiktok');
  assert.deepEqual(input.keywords, ['animalsoftiktok']);
  assert.equal(input.startUrls, undefined, 'the tag-page path is what we are leaving');
  assert.equal(input.dateRange, 'THIS_WEEK');
});

test('the TikTok window tracks tiktokMaxAgeDays as well', async () => {
  assert.equal((await sentInput(tiktokOn('apidojo', { tiktokMaxAgeDays: 1 }), 'cats')).dateRange, 'YESTERDAY');
  assert.equal((await sentInput(tiktokOn('apidojo', { tiktokMaxAgeDays: 30 }), 'cats')).dateRange, 'THIS_MONTH');
  const off = await sentInput(tiktokOn('apidojo', { tiktokMaxAgeDays: 0 }), 'cats');
  assert.equal('dateRange' in off, false, 'an absent filter must be absent, not null');
});

test('clockworks keeps its native hashtag input', async () => {
  // It has no search mode and no date filter; nothing to change there.
  const input = await sentInput(tiktokOn('clockworks'), 'animalsoftiktok');
  assert.deepEqual(input.hashtags, ['animalsoftiktok']);
  assert.equal(input.keywords, undefined);
  assert.equal(input.dateRange, undefined);
});

test('media downloads stay switched off on both actors', async () => {
  for (const actor of ['apidojo', 'clockworks']) {
    const input = await sentInput(tiktokOn(actor), 'cats');
    assert.equal(input.shouldDownloadVideos, false, actor);
    assert.equal(input.shouldDownloadCovers, false, actor);
  }
});
