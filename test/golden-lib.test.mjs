/**
 * Unit tests for the golden-set core (scripts/golden/lib.mjs).
 *
 * Fixtures here are SYNTHETIC on purpose — the real golden set contains scraped
 * third-party content (post text, URLs, author handles) and this repo is public,
 * so the curated set lives in data/golden/ under .gitignore. These tests only
 * exercise the pure functions, so they need no API keys and no snapshot.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  rowToTrend,
  heuristicClass,
  checkBand,
  checkClasses,
  BANDS,
  GOLDEN_CLASSES,
} from '../scripts/golden/lib.mjs';

const ROW = {
  id: 4242,
  source: 'tiktok',
  title: 'Dog compilation chaos',
  original_title: 'dog compilation chaos raw',
  description: 'desc here',
  url: 'https://example.test/v/1',
  score: 63,
  category: 'animals',
  ai_explanation: 'explanation text',
  first_seen_at: '2026-08-02 10:00:00',
  raw_metrics: JSON.stringify({
    plays: 1000, likes: 20, upvotes: 5,
    memePotential: 70, adoptionScore: 70, emergenceScore: 88,
    junkPenalty: 12, junkReasons: ['text-only'],
    alertScore: 69, alertBreakdown: { meme: 70 },
    storyScore: 40, storyHook: 'hook', subjectName: 'Pipi', nameStrength: 60,
    narrativePhase: 'strong', marketStage: null, rankScore: 75,
    alertType: 'post', tgMessageUrl: 'https://t.me/x/1',
    preStage: { gemini: { viralPattern: 'compilation', memePotential: 70, memeShapeStrength: 65 } },
  }),
};

// ── rowToTrend ──────────────────────────────────────────────────────────────

test('rowToTrend keeps engagement metrics and strips service fields', () => {
  const t = rowToTrend(ROW);
  assert.equal(t.metrics.plays, 1000);
  assert.equal(t.metrics.likes, 20);
  assert.equal(t.metrics.memePotential, undefined, 'score fields must not leak into metrics');
  assert.equal(t.metrics.preStage, undefined);
  assert.equal(t.metrics.alertBreakdown, undefined);
});

test('rowToTrend mirrors cluster-domain fields into clusterMetrics', () => {
  const t = rowToTrend(ROW);
  assert.equal(t.clusterMetrics.emergenceScore, 88);
  assert.equal(t.clusterMetrics.junkPenalty, 12);
  assert.deepEqual(t.clusterMetrics.junkReasons, ['text-only']);
  assert.equal(t.clusterMetrics.isNovel, true);
});

test('rowToTrend captures production baseline separately from inputs', () => {
  const t = rowToTrend(ROW);
  assert.equal(t.baseline.memePotential, 70);
  assert.equal(t.baseline.viralPattern, 'compilation');
  assert.equal(t.baseline.memeShapeStrength, 65);
  assert.equal(t.baseline.geminiMeme, 70);
});

test('rowToTrend survives corrupt raw_metrics', () => {
  const t = rowToTrend({ ...ROW, raw_metrics: '{not json' });
  assert.equal(t.memePotential, 0);
  assert.deepEqual(t.metrics, {});
  assert.equal(t.title, 'Dog compilation chaos');
});

// ── heuristicClass ──────────────────────────────────────────────────────────

const mk = (over = {}) => ({
  title: '', description: '', category: 'other', memePotential: 50, junkPenalty: 0,
  preStage: { gemini: { visualCaption: 'a cat sits', viralPattern: 'animal_action' } },
  ...over,
});

test('heuristicClass detects compilation by viralPattern', () => {
  const t = mk({ preStage: { gemini: { visualCaption: 'x', viralPattern: 'compilation' } } });
  assert.equal(heuristicClass(t), 'compilation');
});

test('heuristicClass detects compilation by caption wording', () => {
  const t = mk({ preStage: { gemini: { visualCaption: 'A series of humorous dog clips', viralPattern: 'other' } } });
  assert.equal(heuristicClass(t), 'compilation');
});

test('heuristicClass flags explicit ai wording', () => {
  const t = mk({ preStage: { gemini: { visualCaption: 'An AI-generated scene of a flood', viralPattern: 'event' } } });
  assert.equal(heuristicClass(t), 'ai_suspect');
});

// The 16066 lesson: Gemini narrates a physically impossible action without
// concluding anything. That wording is the only machine-readable trace of a
// generated clip in historic data, so the selection heuristic must catch it.
test('heuristicClass flags physically impossible action as ai_suspect', () => {
  const t = mk({
    category: 'animals', memePotential: 87,
    preStage: { gemini: {
      visualCaption: 'Two fluffy kittens with big eyes are walking along a sandy beach at dusk.',
      videoSummary: 'The kittens appear to be walking upright on two legs, holding hands, moving in sync.',
      viralPattern: 'animal_action',
    } },
  });
  assert.equal(heuristicClass(t), 'ai_suspect');
});

test('heuristicClass pools high-scoring animals for the exceptionality control', () => {
  assert.equal(heuristicClass(mk({ category: 'animals', memePotential: 72 })), 'animal_high');
});

test('heuristicClass marks records without vision as text_only', () => {
  assert.equal(heuristicClass(mk({ preStage: null })), 'text_only');
});

// ── bands ───────────────────────────────────────────────────────────────────

test('checkBand enforces max for compilation', () => {
  assert.equal(checkBand('compilation', 25).ok, true);
  assert.equal(checkBand('compilation', 26).ok, false);
  assert.match(checkBand('compilation', 70).detail, /<= 25/);
});

test('checkBand enforces min for ai_slop — slop must NOT be crushed', () => {
  assert.equal(checkBand('ai_slop', 55).ok, true);
  assert.equal(checkBand('ai_slop', 12).ok, false);
});

test('checkBand handles two-sided band for good trends', () => {
  assert.equal(checkBand('good', 70).ok, true);
  assert.equal(checkBand('good', 40).ok, false);
  assert.equal(checkBand('good', 99).ok, false);
});

// Fail-closed: heuristicClass emits SELECTION buckets ('animal_high',
// 'high_score', 'ai_suspect', 'other') that are NOT golden classes. If one of
// them leaks into a fixture, the check must scream instead of passing silently.
test('checkBand rejects an unknown class instead of passing it', () => {
  const r = checkBand('animal_high', 10);
  assert.equal(r.ok, false);
  assert.equal(r.unknown, true);
  assert.match(r.detail, /unknown golden class/);
});

test('GOLDEN_CLASSES lists exactly the banded classes', () => {
  assert.deepEqual([...GOLDEN_CLASSES].sort(), Object.keys(BANDS).sort());
});

// ── multi-class fixtures (case 16041 is compilation AND ai_fake) ────────────

test('checkClasses applies the strictest ceiling across classes', () => {
  const r = checkClasses(['compilation', 'ai_fake'], 22);
  assert.equal(r.max, 20, 'ai_fake ceiling (20) must win over compilation (25)');
  assert.equal(r.ok, false);
  assert.equal(checkClasses(['compilation', 'ai_fake'], 18).ok, true);
});

test('checkClasses accepts a bare string for single-class fixtures', () => {
  assert.equal(checkClasses('compilation', 20).ok, true);
  assert.equal(checkClasses('compilation', 40).ok, false);
});

test('checkClasses reports contradictory labels instead of silently failing', () => {
  // ai_slop wants >= 40, compilation wants <= 25 — no value can satisfy both.
  const r = checkClasses(['ai_slop', 'compilation'], 30);
  assert.equal(r.conflict, true);
  assert.equal(r.ok, false);
  assert.match(r.detail, /contradictory/i);
});

test('checkClasses rejects empty and unknown label sets', () => {
  assert.equal(checkClasses([], 50).unknown, true);
  assert.equal(checkClasses(['nonsense'], 50).unknown, true);
});
