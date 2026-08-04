/**
 * Stage 0b authenticity fields (2026-08-05).
 *
 * Stage 0b stopped scoring and started reporting facts. `aiOrigin` is the new
 * one that needs coercion: Gemini goes through an OpenAI-compat endpoint with
 * `json_object` and NO schema, so the value is whatever the model typed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAiOrigin, AI_ORIGIN_VALUES } from '../src/analysis/gemini-captioner.js';

test('normalizeAiOrigin accepts the four documented values', () => {
  for (const v of ['real', 'likely_ai', 'obvious_ai', 'unclear']) {
    assert.equal(normalizeAiOrigin(v), v);
  }
});

test('normalizeAiOrigin defaults unknown/missing to unclear', () => {
  assert.equal(normalizeAiOrigin('definitely-fake'), 'unclear');
  assert.equal(normalizeAiOrigin(undefined), 'unclear');
  assert.equal(normalizeAiOrigin(null), 'unclear');
  assert.equal(normalizeAiOrigin(''), 'unclear');
});

test('normalizeAiOrigin tolerates case and spacing from loose providers', () => {
  assert.equal(normalizeAiOrigin('Likely AI'), 'likely_ai');
  assert.equal(normalizeAiOrigin('OBVIOUS-AI'), 'obvious_ai');
  assert.equal(normalizeAiOrigin('  real  '), 'real');
});

test('AI_ORIGIN_VALUES is the single source of truth', () => {
  assert.deepEqual([...AI_ORIGIN_VALUES].sort(), ['likely_ai', 'obvious_ai', 'real', 'unclear']);
});
