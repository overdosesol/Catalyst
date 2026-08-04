/**
 * AI-origin wording must not be read as a meme-shape signal.
 *
 * Until 2026-08-05 `RE_ABSURD` listed "ai generated" / "deepfake" /
 * "hallucination" among absurdity signals. A clip that admitted being fake
 * therefore earned BOTH a safe-override divisor on its junk penalty AND a
 * memeShapeBoost on emergence — the filter paid content for being generated.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateJunkPenalty } from '../src/analysis/junk-filter.js';

const item = (title, description = '') =>
  ([{ title, description, source: 'reddit', metrics: { imageUrl: 'x' } }]);

test('AI-origin wording is not a meme-shape signal', () => {
  const r = calculateJunkPenalty(item('An AI generated clip of a flood in Rome'), {}, 'general');
  assert.equal(r.memeShapeSignals.includes('absurd'), false,
    'admitting AI origin must not count as absurdity');
  assert.equal(r.memeShapeBoost, 0);
});

test('deepfake wording earns no safe-override', () => {
  // politics fires (40) — with a meme signal it would be divided by 3.
  const r = calculateJunkPenalty(item('Deepfake of the president addressing parliament'), {}, 'general');
  assert.equal(r.junkReasons.some(x => String(x).startsWith('safe-override')), false);
  assert.ok(r.junkPenalty >= 40, `expected full politics penalty, got ${r.junkPenalty}`);
});

test('hallucination wording is not absurdity either', () => {
  const r = calculateJunkPenalty(item('Model hallucination produced a fake photo of the flood'), {}, 'general');
  assert.equal(r.memeShapeSignals.includes('absurd'), false);
});

test('genuine absurdity still counts', () => {
  const r = calculateJunkPenalty(item('Weird goat escapes and wanders into city hall'), {}, 'general');
  assert.ok(r.memeShapeSignals.includes('absurd'));
  assert.ok(r.memeShapeBoost > 0);
});
