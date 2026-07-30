import test from 'node:test';
import assert from 'node:assert/strict';

import Scorer from '../src/analysis/scorer.js';

const silentLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

// grok-4.3 reasons by default: verified live on 2026-07-31, an "ok" reply cost
// 109 output tokens with no parameter and 1 token with effort:'none'. The
// retired `-non-reasoning` ids encoded that choice in the model name, so every
// xAI call now has to state it or quietly pay for a thinking budget.
function bareScorer() {
  const scorer = Object.create(Scorer.prototype);
  scorer.logger = silentLogger;
  scorer.openaiReasoningEffort = 'low'; // OPENAI_REASONING_EFFORT is set in .env.example
  return scorer;
}

function withCapturedFetch(fn) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return {
      ok: true,
      status: 200,
      json: async () => ({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'ok' }] }], usage: {} }),
      text: async () => '',
    };
  };
  try {
    return fn(calls);
  } finally {
    globalThis.fetch = original;
  }
}

const xaiRuntime = { provider: 'xai', model: 'grok-4.3', apiKey: 'k', baseUrl: 'https://api.x.ai/v1', enabled: true };
const openaiRuntime = { provider: 'openai', model: 'gpt-5.4-mini', apiKey: 'k', baseUrl: 'https://api.openai.com/v1', enabled: true };

test('an xAI call defaults to no thinking budget', async () => {
  await withCapturedFetch(async calls => {
    await bareScorer()._callResponsesAPI({
      input: [{ role: 'user', content: 'x' }],
      runtimeOverride: xaiRuntime,
    });
    assert.deepEqual(calls[0].body.reasoning, { effort: 'none' });
  });
});

test('an xAI call can be asked for reasoning explicitly', async () => {
  await withCapturedFetch(async calls => {
    await bareScorer()._callResponsesAPI({
      input: [{ role: 'user', content: 'x' }],
      runtimeOverride: xaiRuntime,
      xaiReasoningEffort: 'low',
    });
    assert.deepEqual(calls[0].body.reasoning, { effort: 'low' });
  });
});

test("the OpenAI branch still follows its own reasoning setting", async () => {
  await withCapturedFetch(async calls => {
    await bareScorer()._callResponsesAPI({
      input: [{ role: 'user', content: 'x' }],
      runtimeOverride: openaiRuntime,
      reasoningEffort: 'medium',
    });
    assert.deepEqual(calls[0].body.reasoning, { effort: 'medium' });
  });

  // ...and sends nothing when the operator left the setting empty.
  await withCapturedFetch(async calls => {
    await bareScorer()._callResponsesAPI({
      input: [{ role: 'user', content: 'x' }],
      runtimeOverride: openaiRuntime,
      reasoningEffort: null,
    });
    assert.equal(calls[0].body.reasoning, undefined);
  });
});
