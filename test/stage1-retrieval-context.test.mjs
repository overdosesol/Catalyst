import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildRetrievalLine,
  buildAnalysisPrompt,
  STAGE1_SYSTEM_PROMPT,
} from '../src/analysis/prompts.js';

// Measured 2026-08-09 in prod: storyScore averaged 35.1 on narrative-lane items
// against 32.0 on volume ones. The lane knew the item was story-shaped and the
// prompt never told the model. These tests pin the contract that carries it.

test('a ledger hit names the subject and says the history is independent of this post', () => {
  const line = buildRetrievalLine({
    lane: 'narrative', laneReason: 'ledger:Chuck', title: 'a quiet photo',
  });
  assert.match(line, /Chuck/);
  assert.match(line, /independent of this post/);
});

test('the ledger wording follows the constants, so it cannot drift from the code', () => {
  const line = buildRetrievalLine({ lane: 'narrative', laneReason: 'ledger:Pippin', title: 'x' });
  assert.match(line, /at least 3 mentions across 2\+ separate days/);
});

test('a probe hit says the query looked for a story, not that the post has one', () => {
  const line = buildRetrievalLine({
    lane: 'narrative', laneReason: 'probe', title: 'Otter floating on its back',
  });
  assert.match(line, /story-shaped search query/);
  assert.match(line, /this post's own text does not state one/);
});

test('a probe hit whose text also carries markers reports both', () => {
  const line = buildRetrievalLine({
    lane: 'narrative', laneReason: 'probe',
    title: 'Dog reunited with owner after years',
  });
  assert.match(line, /story-shaped search query/);
  assert.match(line, /"reunited"/);
});

test('a lexical hit quotes the actual words, not the family name', () => {
  const line = buildRetrievalLine({
    lane: 'narrative', laneReason: 'lexical:event',
    title: 'Climbers rescued a lamb stuck on a cliff',
  });
  assert.match(line, /"rescued"/);
  assert.ok(!line.includes('lexical'), 'internal reason codes must not leak into the prompt');
});

test('volume items get no retrieval line at all', () => {
  assert.equal(buildRetrievalLine({ lane: 'volume', laneReason: 'none', title: 'Cute cat' }), '');
  assert.equal(buildRetrievalLine({ title: 'no lane at all' }), '');
  assert.equal(buildRetrievalLine(null), '');
});

test('a malformed lane reason degrades to no line instead of a broken one', () => {
  assert.equal(buildRetrievalLine({ lane: 'narrative', laneReason: 'ledger:', title: 'x' }), '');
  assert.equal(buildRetrievalLine({ lane: 'narrative', laneReason: '', title: 'x' }), '');
  // Lexical claimed but the text carries nothing — say nothing rather than lie.
  assert.equal(
    buildRetrievalLine({ lane: 'narrative', laneReason: 'lexical:event', title: 'nothing here' }),
    ''
  );
});

test('the line reaches the assembled batch prompt', () => {
  const prompt = buildAnalysisPrompt([
    { title: 'Dog reunited with owner', source: 'reddit', lane: 'narrative', laneReason: 'lexical:event' },
    { title: 'Cute cat sleeping', source: 'reddit', lane: 'volume', laneReason: 'none' },
  ]);
  assert.match(prompt, /Retrieval: title contains story markers "reunited"/);
  assert.equal(prompt.match(/Retrieval:/g).length, 1, 'only the narrative item gets a line');
});

test('the system prompt teaches how to read the line, in both directions', () => {
  assert.match(STAGE1_SYSTEM_PROMPT, /RETRIEVAL CONTEXT/);
  // Rule 1 — no rubber-stamping what the lexical prefilter flagged.
  assert.match(STAGE1_SYSTEM_PROMPT, /never justifies a high storyScore/);
  // Rule 2 — a missing line must not become a penalty.
  assert.match(STAGE1_SYSTEM_PROMPT, /NOT evidence against a story/);
});

test('the narrative-core block survives alongside the new one', () => {
  assert.match(STAGE1_SYSTEM_PROMPT, /NARRATIVE CORE/);
  assert.ok(
    STAGE1_SYSTEM_PROMPT.indexOf('NARRATIVE CORE') < STAGE1_SYSTEM_PROMPT.indexOf('RETRIEVAL CONTEXT'),
    'both blocks are spliced, in order, ahead of BATCH CALIBRATION'
  );
  assert.ok(
    STAGE1_SYSTEM_PROMPT.indexOf('RETRIEVAL CONTEXT') < STAGE1_SYSTEM_PROMPT.indexOf('BATCH CALIBRATION'),
    'the blocks must land before the calibration marker, not after it'
  );
});
