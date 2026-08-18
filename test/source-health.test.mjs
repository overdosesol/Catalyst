import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createHealthTracker,
  formatHealthEvent,
  normalizeSource,
  SILENT_CYCLES,
  DEFAULT_FAIL_CYCLES,
} from '../src/notifications/source-health.js';

// The bug this exists for: from 2026-08-15 every narrative-probe and every
// X-Trends tweet fetch was rejected by Apify with a 400. Caught per-request,
// logged at WARN, three days unnoticed.

const failing = { items: 0, failures: 2, lastError: 'Apify 400: Max Items must be at least 20' };
const healthy = { items: 12, failures: 0 };
const empty   = { items: 0, failures: 0 };

/** A clock the test drives by hand. */
function fakeClock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

const feed = (tracker, source, cycle, times) => {
  const events = [];
  for (let i = 0; i < times; i++) {
    const e = tracker.record(source, cycle);
    if (e) events.push(e);
  }
  return events;
};

test('a source goes down only after the streak, not on the first failure', () => {
  const t = createHealthTracker({ failCycles: 4 });
  assert.equal(t.record('twitter', failing), null, 'cycle 1 stays quiet');
  assert.equal(t.record('twitter', failing), null);
  assert.equal(t.record('twitter', failing), null, 'cycle 3 still quiet');

  const e = t.record('twitter', failing);
  assert.equal(e.kind, 'down');
  assert.equal(e.source, 'twitter');
  assert.equal(e.cycles, 4);
  assert.match(e.lastError, /Max Items/);
});

test('a transient blip resets the streak — 502s must not page anyone', () => {
  const t = createHealthTracker({ failCycles: 4 });
  t.record('twitter', failing);
  t.record('twitter', failing);
  t.record('twitter', healthy);          // one good cycle wipes the slate
  assert.deepEqual(feed(t, 'twitter', failing, 3), [], 'three more is still short of four');
  assert.equal(t.record('twitter', failing).kind, 'down');
});

test('a persistent fault is announced once, not every cycle', () => {
  const t = createHealthTracker({ failCycles: 2, remindAfterMs: 6 * 3600_000, now: fakeClock().now });
  t.record('twitter', failing);
  assert.equal(t.record('twitter', failing).kind, 'down');
  assert.deepEqual(feed(t, 'twitter', failing, 50), [], '50 more cycles, zero extra messages');
});

test('an unresolved fault reminds once the cooldown passes, marked as a repeat', () => {
  const clock = fakeClock();
  const t = createHealthTracker({ failCycles: 2, remindAfterMs: 6 * 3600_000, now: clock.now });
  t.record('twitter', failing);
  assert.equal(t.record('twitter', failing).repeat, false, 'first announcement is not a repeat');

  clock.advance(5 * 3600_000);
  assert.equal(t.record('twitter', failing), null, 'five hours in, still silent');

  clock.advance(2 * 3600_000);
  const again = t.record('twitter', failing);
  assert.equal(again.kind, 'down');
  assert.equal(again.repeat, true);
});

test('recovery is announced exactly once', () => {
  const t = createHealthTracker({ failCycles: 2 });
  t.record('twitter', failing);
  t.record('twitter', failing);

  const rec = t.record('twitter', healthy);
  assert.equal(rec.kind, 'recovered');
  assert.equal(rec.from, 'down');
  assert.deepEqual(feed(t, 'twitter', healthy, 10), [], 'staying healthy is not news');
});

test('silence thresholds are per source: reddit is loud, tiktok is not', () => {
  const t = createHealthTracker();
  assert.deepEqual(feed(t, 'reddit', empty, 5), []);
  assert.equal(t.record('reddit', empty).kind, 'silent', 'six empty reddit cycles is a fault');

  const t2 = createHealthTracker();
  assert.deepEqual(feed(t2, 'tiktok', empty, 40), [], 'forty empty tiktok cycles is a normal day');
  assert.equal(t2.record('tiktok', empty), null, 'still nothing at 41');
});

// Every threshold must sit clear of the longest silence that source actually
// produced in 10 days of prod (2026-08-08…18). The first draft of this file
// failed this test on four sources out of five.
test('no threshold fires inside the observed normal gap', () => {
  const observedMaxCycles = {   // longest real gap, in 30-minute cycles
    reddit: 3, twitter: 36, tiktok: 41, google_trends: 65, x_trends: 169,
  };
  for (const [source, normal] of Object.entries(observedMaxCycles)) {
    const t = createHealthTracker();
    assert.deepEqual(
      feed(t, source, empty, normal),
      [],
      `${source}: ${normal} empty cycles happen in normal operation and must stay quiet`
    );
  }
});

test('an erroring source reports down, never both conditions', () => {
  const t = createHealthTracker({ failCycles: 4 });
  // Failing cycles are also empty ones, so both streaks advance together.
  const events = feed(t, 'reddit', failing, 12);
  assert.equal(events.length, 1, 'one fault, one message');
  assert.equal(events[0].kind, 'down', 'down outranks silent');
});

test('a skipped cycle is not evidence of anything', () => {
  const t = createHealthTracker();
  // TikTok idles through half the cycles by design (60-min interval against a
  // 30-min scan). Counting those as silence would keep it permanently broken.
  assert.deepEqual(feed(t, 'tiktok', { items: 0, skipped: true }, 100), []);
  assert.equal(t.snapshot().tiktok?.emptyStreak ?? 0, 0, 'skips must not advance the streak');
});

test('sources are tracked independently', () => {
  const t = createHealthTracker({ failCycles: 2 });
  t.record('twitter', failing);
  t.record('reddit', healthy);
  assert.equal(t.record('twitter', failing).kind, 'down');
  assert.equal(t.record('reddit', healthy), null, 'reddit is fine and stays quiet');
});

test('collector names normalize to the keys the thresholds use', () => {
  assert.equal(normalizeSource('GoogleTrends'), 'google_trends');
  assert.equal(normalizeSource('XTrends'), 'x_trends');
  assert.equal(normalizeSource('Reddit'), 'reddit');
  assert.equal(normalizeSource('TikTok'), 'tiktok');
  // Every threshold key must be reachable from a real collector name,
  // otherwise a source silently falls back to the lenient default.
  for (const key of Object.keys(SILENT_CYCLES)) {
    assert.ok(key === normalizeSource(key), `${key} is not a normalized name`);
  }
});

test('messages say which source, what happened, and how long', () => {
  const t = createHealthTracker({ failCycles: DEFAULT_FAIL_CYCLES });
  let down = null;
  for (let i = 0; i < DEFAULT_FAIL_CYCLES; i++) down = t.record('twitter', failing) || down;

  const msg = formatHealthEvent(down);
  assert.match(msg, /twitter/);
  assert.match(msg, /4/);
  assert.match(msg, /Max Items/, 'the actual error has to be in the message');

  assert.match(formatHealthEvent(t.record('twitter', healthy)), /✅/);
  assert.equal(formatHealthEvent(null), '');
});

// ── False-alarm budget ───────────────────────────────────────────────────────
// Not decoration. Reddit's RSS passes roughly one request in three, and the
// first version of this counted a retried-and-recovered 429 as a failed cycle.
// At a 33% per-cycle failure rate and 48 cycles a day that is a false alarm
// every other day, which is exactly the spam the feature was asked not to be.
test('a fault needs four consecutive cycles, so routine flakiness stays quiet', () => {
  const t = createHealthTracker({ failCycles: 4 });
  // One bad cycle in every three — the observed Reddit pattern.
  let events = 0;
  for (let cycle = 0; cycle < 300; cycle++) {
    const bad = cycle % 3 === 0;
    if (t.record('reddit', bad ? failing : healthy)) events++;
  }
  assert.equal(events, 0, '300 cycles of one-in-three flakiness must produce nothing');
});

test('but a real outage still gets through that same filter', () => {
  const t = createHealthTracker({ failCycles: 4 });
  let events = 0;
  for (let cycle = 0; cycle < 300; cycle++) {
    if (t.record('reddit', failing)) events++;
  }
  assert.ok(events >= 1, 'a genuine outage is announced');
  assert.ok(events <= 3, `and not more than the 6h reminder allows, got ${events}`);
});
