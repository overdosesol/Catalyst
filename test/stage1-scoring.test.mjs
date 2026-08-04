/**
 * Stage 1 owns the score (2026-08-05 roles swap).
 *
 * Before this date Stage 0b was the authoritative scorer and Stage 1 echoed
 * its numbers. `resolveScores` is what replaced that trust contract: whatever
 * Stage 1 answered wins, and `scoreSource` records only whether vision was
 * available — the axis worth auditing now.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveScores, CATEGORY_VALUES } from '../src/analysis/scorer.js';

test('Stage 1 numbers win over the Stage 0b leftovers', () => {
  const r = resolveScores({ memePotential: 42, viralityScore: 51, category: 'animals' },
                          { preStage: { gemini: { memePotential: 88, viralityScore: 90, category: 'meme' } } });
  assert.equal(r.memePotential, 42);
  assert.equal(r.viralityScore, 51);
  assert.equal(r.category, 'animals');
  assert.equal(r.scoreSource, 'stage1');
});

test('missing vision is recorded as a distinct source', () => {
  const r = resolveScores({ memePotential: 30, viralityScore: 20, category: 'other' }, { preStage: null });
  assert.equal(r.scoreSource, 'stage1_no_vision');
});

test('a zero from Stage 1 is a real score, not a missing one', () => {
  const r = resolveScores({ memePotential: 0, viralityScore: 0, category: 'politics' },
                          { preStage: { gemini: { visualCaption: 'x' } } });
  assert.equal(r.memePotential, 0);
  assert.equal(r.scoreSource, 'stage1');
});

test('scores are clamped and unknown categories fall back', () => {
  const r = resolveScores({ memePotential: 150, viralityScore: -5, category: 'nonsense' },
                          { preStage: { gemini: { visualCaption: 'x' } } });
  assert.equal(r.memePotential, 100);
  assert.equal(r.viralityScore, 0);
  assert.equal(r.category, 'other');
});

test('a missing answer degrades to zeros instead of throwing', () => {
  const r = resolveScores(null, null);
  assert.equal(r.memePotential, 0);
  assert.equal(r.viralityScore, 0);
  assert.equal(r.category, 'other');
  assert.equal(r.scoreSource, 'stage1_no_vision');
});

test('CATEGORY_VALUES stays the single taxonomy', () => {
  assert.ok(CATEGORY_VALUES.has('meme') && CATEGORY_VALUES.has('boring'));
  assert.equal(CATEGORY_VALUES.has('nonsense'), false);
  assert.equal(CATEGORY_VALUES.size, 11);
});
