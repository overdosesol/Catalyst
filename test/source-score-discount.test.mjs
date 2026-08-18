import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applySourceScoreMultiplier,
  applyPotentialCaps,
  runPostPass,
  computeAlertScore,
  SOURCE_SCORE_MULT,
  DEFAULT_ALERT_WEIGHTS,
} from '../src/analysis/scorer.js';

// Why this exists: over 14 days of prod, TikTok trends averaged virality 92.4
// and 74 of 118 scored 95+. A scale where nearly every item is a 95 carries no
// information. The Stage 1 prompt already tells the model not to do that and
// the model does it anyway, because TikTok's raw numbers really are 5-10x
// Twitter's for the same cultural weight. Hence a deterministic discount.

// `metrics.thumbnailUrl` is not decoration: without it the post-pass also
// applies the text-only x0.65 multiplier, and every number below shifts. Real
// TikTok items always carry a cover, so the fixture carries one too.
const trend = (over = {}) => ({
  title: 'test', source: 'tiktok', memePotential: 80, score: 90,
  emergenceScore: 30, storyScore: 0, subjectName: '', nameStrength: 0,
  metrics: { thumbnailUrl: 'https://p16.tiktokcdn.com/cover.jpeg' },
  ...over,
});

test('the discount is 20% and applies to TikTok only', () => {
  assert.equal(SOURCE_SCORE_MULT.tiktok, 0.8);
  assert.equal(Object.keys(SOURCE_SCORE_MULT).length, 1,
    'adding a source here changes prod scoring — do it on purpose');
});

test('both visible numbers come down together', () => {
  const t = trend({ memePotential: 80, score: 90 });
  applySourceScoreMultiplier(t);
  assert.equal(t.memePotential, 64);
  assert.equal(t.score, 72);
});

test('every other source is untouched', () => {
  for (const source of ['reddit', 'twitter', 'google_trends', 'x_trends', 'instagram']) {
    const t = trend({ source });
    applySourceScoreMultiplier(t);
    assert.equal(t.memePotential, 80, source);
    assert.equal(t.score, 90, source);
    assert.equal(t.sourcePenalty, undefined, source);
  }
});

test('source matching is case-insensitive — collectors write "TikTok"', () => {
  const t = trend({ source: 'TikTok' });
  applySourceScoreMultiplier(t);
  assert.equal(t.memePotential, 64);
});

test('the audit trail records both before and after', () => {
  const t = trend({ memePotential: 80, score: 90 });
  applySourceScoreMultiplier(t);
  assert.deepEqual(t.sourcePenalty, {
    source: 'tiktok', multiplier: 0.8,
    memeBefore: 80, memeAfter: 64,
    viralBefore: 90, viralAfter: 72,
  });
});

test('a trend with nothing to discount is left alone', () => {
  const t = trend({ memePotential: 0, score: 0 });
  applySourceScoreMultiplier(t);
  assert.equal(t.sourcePenalty, undefined, 'no penalty recorded for a 0/0 trend');
});

// Not idempotent by design — it is a plain multiplier. The post-pass calls it
// exactly once, which is the contract this test pins.
test('runPostPass applies the discount exactly once', () => {
  const t = trend({ memePotential: 80, score: 90 });
  runPostPass([t], DEFAULT_ALERT_WEIGHTS);
  assert.equal(t.memePotential, 64, 'not 51 — that would be a double application');
  assert.equal(t.score, 72);
});

// ── Ordering inside the post-pass ────────────────────────────────────────────
// The discount runs LAST. Anything else lets a later step give part of it back.

test('the discount lands after the narrative bonus, not before it', () => {
  const t = trend({
    source: 'tiktok', memePotential: 70, score: 90,
    storyScore: 100, subjectName: 'Peanut', nameStrength: 100,
  });
  runPostPass([t], DEFAULT_ALERT_WEIGHTS);
  // bonuses first: 70 -> 83 (story +9, name +4). Then x0.8 -> 66.
  assert.equal(t.sourcePenalty.memeBefore, 83, 'the bonus had already landed');
  assert.equal(t.memePotential, 66);
});

test('the discount lands after the caps, so a cap cannot undo it', () => {
  const t = trend({
    source: 'tiktok', memePotential: 90, score: 90,
    preStage: { gemini: { isCompilation: true, aiOrigin: 'real', retelling: 'a dog surfs' } },
  });
  runPostPass([t], DEFAULT_ALERT_WEIGHTS);
  // compilation caps meme at 25, then x0.8 -> 20.
  assert.equal(t.capsApplied.memeAfter, 25);
  assert.equal(t.memePotential, 20, 'the cap is a ceiling, the discount still applies under it');
});

test('applied by hand in the wrong order, a cap would eat the discount', () => {
  // Documents WHY the order in runPostPass is what it is, rather than trusting
  // a comment to stay true.
  const gemini = { isCompilation: true, aiOrigin: 'real', retelling: 'a dog surfs' };
  const wrong = trend({ memePotential: 90, preStage: { gemini } });
  applySourceScoreMultiplier(wrong);   // 90 -> 72
  applyPotentialCaps(wrong);           // 72 -> 25, discount gone
  assert.equal(wrong.memePotential, 25);

  const right = trend({ memePotential: 90, preStage: { gemini } });
  applyPotentialCaps(right);
  applySourceScoreMultiplier(right);
  assert.equal(right.memePotential, 20, 'only this order actually costs TikTok 20%');
});

// ── What it does to the number that decides alerts ───────────────────────────

test('alertScore follows the discount down', () => {
  const before = trend({ memePotential: 80, score: 90, emergenceScore: 40 });
  const beforeScore = computeAlertScore(before, DEFAULT_ALERT_WEIGHTS).alertScore;

  const after = trend({ memePotential: 80, score: 90, emergenceScore: 40 });
  runPostPass([after], DEFAULT_ALERT_WEIGHTS);

  assert.ok(after.alertScore < beforeScore,
    `expected a drop from ${beforeScore}, got ${after.alertScore}`);
  // meme 0.60 + viral 0.20 carry the cut: 16*0.6 + 18*0.2 = 13.2 points.
  assert.equal(beforeScore - after.alertScore, 14);
});

test('adoptionScore is recomputed off the discounted meme, not the original', () => {
  // adoptionScore is a literal alias of memePotential; if the recompute ran
  // before the discount the two would disagree and rankScore would sort on a
  // stale number.
  const t = trend({ memePotential: 80, score: 90 });
  runPostPass([t], DEFAULT_ALERT_WEIGHTS);
  assert.equal(t.adoptionScore, t.memePotential);
  assert.equal(t.adoptionScore, 64);
});

test('one exploding trend does not abort the batch', () => {
  const bad = trend();
  Object.defineProperty(bad, 'source', { get() { throw new Error('boom'); } });
  const good = trend({ memePotential: 80, score: 90 });
  runPostPass([bad, good], DEFAULT_ALERT_WEIGHTS);
  assert.equal(good.memePotential, 64, 'the healthy trend was still processed');
});

// ── Persistence ──────────────────────────────────────────────────────────────
// Same gap that hid the narrative bonuses for a week: the score is saved but
// the evidence of why is not, and the "did this help?" review a week later has
// nothing to count.
test('the discount audit trail survives a save/reload round-trip', async () => {
  const { default: TrendDatabase } = await import('../src/db/database.js');
  const silent = { info() {}, warn() {}, debug() {}, error() {} };
  const db = new TrendDatabase(':memory:', silent);

  const t = trend({
    title: 'Capybara commandeers a kayak', source: 'tiktok',
    url: 'https://www.tiktok.com/@x/video/discount-round-trip',
    memePotential: 80, score: 90, pipelineStatus: 'scored',
  });
  runPostPass([t], DEFAULT_ALERT_WEIGHTS);
  assert.equal(t.sourcePenalty.multiplier, 0.8, 'precondition: the discount fired');

  db.saveTrend(t);
  const row = db.db.prepare('SELECT score, raw_metrics FROM trends WHERE url = ?').get(t.url);
  const saved = JSON.parse(row.raw_metrics);

  assert.equal(saved.sourcePenalty.memeBefore, 80);
  assert.equal(saved.sourcePenalty.memeAfter, 64);
  assert.equal(saved.sourcePenalty.viralBefore, 90);
  assert.equal(saved.memePotential, 64, 'the discounted score is the one stored');
  assert.equal(row.score, 72, 'and the discounted virality reached the column too');
});

test('a non-TikTok trend stores null, not undefined', async () => {
  const { default: TrendDatabase } = await import('../src/db/database.js');
  const silent = { info() {}, warn() {}, debug() {}, error() {} };
  const db = new TrendDatabase(':memory:', silent);

  const t = trend({
    title: 'Same story on reddit', source: 'reddit',
    url: 'https://reddit.com/r/aww/comments/no-discount',
    pipelineStatus: 'scored',
  });
  runPostPass([t], DEFAULT_ALERT_WEIGHTS);
  db.saveTrend(t);
  const row = db.db.prepare('SELECT raw_metrics FROM trends WHERE url = ?').get(t.url);
  assert.equal(JSON.parse(row.raw_metrics).sourcePenalty, null);
});

// The two multipliers are independent and both live in the post-pass. A TikTok
// item that somehow arrives with no cover would take 0.65 x 0.8 = 0.52. That
// should be vanishingly rare — apidojo always returns a cover — but if TikTok
// scores ever look halved rather than shaved, this is the interaction to check.
test('the text-only multiplier still stacks on top for a media-less TikTok', () => {
  const t = trend({ memePotential: 80, score: 90, metrics: {} });
  runPostPass([t], DEFAULT_ALERT_WEIGHTS);
  assert.equal(t.textOnlyPenalty.multiplier, 0.65);
  assert.equal(t.sourcePenalty.memeBefore, 52, 'the text-only cut landed first');
  assert.equal(t.memePotential, 42);
});
