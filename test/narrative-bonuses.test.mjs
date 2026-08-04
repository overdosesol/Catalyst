import { test } from 'node:test';
import assert from 'node:assert';
import { applyNarrativeBonuses, runPostPass, DEFAULT_ALERT_WEIGHTS } from '../src/analysis/scorer.js';

const trend = (over = {}) => ({
  title: 'test', memePotential: 50, score: 50, emergenceScore: 30,
  storyScore: 0, storyHook: '', subjectName: '', nameStrength: 0, ...over,
});

test('no bonus below the story gate', () => {
  const t = trend({ memePotential: 50, storyScore: 59 });
  applyNarrativeBonuses(t);
  assert.strictEqual(t.memePotential, 50);
  assert.strictEqual(t.storyBonus, undefined);
});

test('both bonuses at max, upper band: 70 -> 83', () => {
  const t = trend({ memePotential: 70, storyScore: 100, subjectName: 'Peanut', nameStrength: 100 });
  applyNarrativeBonuses(t);
  assert.strictEqual(t.memePotential, 83);
  assert.strictEqual(t.storyBonus.bonus, 15);
  assert.strictEqual(t.nameBonus.bonus, 10);
});

test('headroom multiplier is capped at 1: 20 -> 45, not 55', () => {
  const t = trend({ memePotential: 20, storyScore: 100, subjectName: 'Peanut', nameStrength: 100 });
  applyNarrativeBonuses(t);
  assert.strictEqual(t.memePotential, 45);
});

test('headroom multiplier is capped at 1: 10 -> 35, not 50', () => {
  const t = trend({ memePotential: 10, storyScore: 100, subjectName: 'Peanut', nameStrength: 100 });
  applyNarrativeBonuses(t);
  assert.strictEqual(t.memePotential, 35);
});

test('name bonus cascades off the story-raised value, not the original', () => {
  const t = trend({ memePotential: 70, storyScore: 100, subjectName: 'Peanut', nameStrength: 100 });
  applyNarrativeBonuses(t);
  // story: 70 -> 79 (scale 0.6). name headroom is computed from 79, not 70.
  assert.strictEqual(t.storyBonus.memeAfter, 79);
  assert.strictEqual(t.nameBonus.memeBefore, 79);
});

test('no name bonus without a subject name', () => {
  const t = trend({ memePotential: 50, subjectName: '', nameStrength: 100 });
  applyNarrativeBonuses(t);
  assert.strictEqual(t.memePotential, 50);
  assert.strictEqual(t.nameBonus, undefined);
});

test('applying twice does not stack', () => {
  const t = trend({ memePotential: 70, storyScore: 100, subjectName: 'Peanut', nameStrength: 100 });
  applyNarrativeBonuses(t);
  const once = t.memePotential;
  applyNarrativeBonuses(t);
  assert.strictEqual(t.memePotential, once);
});

test('never exceeds 100', () => {
  const t = trend({ memePotential: 98, storyScore: 100, subjectName: 'Peanut', nameStrength: 100 });
  applyNarrativeBonuses(t);
  assert.ok(t.memePotential <= 100, `got ${t.memePotential}`);
});

test('missing fields are treated as zero, not NaN', () => {
  const t = { title: 'bare', memePotential: 50, score: 50 };
  applyNarrativeBonuses(t);
  assert.strictEqual(t.memePotential, 50);
});

// ─── post-pass ───────────────────────────────────────────────────────────────

test('post-pass recomputes adoptionScore to match memePotential', () => {
  const t = trend({ memePotential: 70, storyScore: 100, subjectName: 'Peanut', nameStrength: 100, adoptionScore: 70 });
  runPostPass([t], DEFAULT_ALERT_WEIGHTS);
  assert.strictEqual(t.memePotential, 83);
  assert.strictEqual(t.adoptionScore, 83);
});

test('post-pass fills phase, rank and alert score', () => {
  const t = trend({ memePotential: 70, storyScore: 100 });
  runPostPass([t], DEFAULT_ALERT_WEIGHTS);
  assert.ok(typeof t.narrativePhase === 'string' && t.narrativePhase.length > 0);
  assert.ok(Number.isFinite(t.rankScore));
  assert.ok(Number.isFinite(t.alertScore));
  assert.ok(t.alertBreakdown && typeof t.alertBreakdown === 'object');
});

test('post-pass run twice does not stack bonuses', () => {
  const t = trend({ memePotential: 70, storyScore: 100, subjectName: 'Peanut', nameStrength: 100 });
  runPostPass([t], DEFAULT_ALERT_WEIGHTS);
  const once = t.memePotential;
  runPostPass([t], DEFAULT_ALERT_WEIGHTS);
  assert.strictEqual(t.memePotential, once);
});

test('post-pass survives a trend that has no narrative fields at all', () => {
  const t = { title: 'fallback', memePotential: 40, score: 40, source: 'google_trends' };
  runPostPass([t], DEFAULT_ALERT_WEIGHTS);
  assert.strictEqual(t.memePotential, 40);
  assert.strictEqual(t.adoptionScore, 40);
});

test('bonus applies once on top of a Stage-2-rewritten score, not the Stage 1 one', () => {
  // Simulates a trend that went through Stage 2: memePotential was overwritten
  // (70 -> 60) and xSearchData is present. The bonus must key off 60, the final
  // value, not off whatever Stage 1 produced.
  const t = trend({
    memePotential: 60, storyScore: 100,
    xSearchData: { xBuzz: 'low', narrativeMomentum: 'flat', organicity: 'organic' },
  });
  runPostPass([t], DEFAULT_ALERT_WEIGHTS);
  // story: scale = min(1, 40/50) = 0.8 -> round(60 + 15*0.8) = 72
  assert.strictEqual(t.memePotential, 72);
  assert.strictEqual(t.storyBonus.memeBefore, 60);
});
