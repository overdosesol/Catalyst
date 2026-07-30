import test from 'node:test';
import assert from 'node:assert/strict';

import TriggerFinder from '../src/analysis/trigger-finder.js';
import { DEFAULT_MODELS } from '../src/analysis/model-registry.js';

const silentLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

// Captures the outgoing request instead of hitting xAI.
function withCapturedFetch(fn) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return {
      ok: true,
      status: 200,
      json: async () => ({ output: [{ type: 'message', content: [{ type: 'output_text', text: '{}' }] }], usage: {} }),
      text: async () => '',
    };
  };
  try {
    return fn(calls);
  } finally {
    globalThis.fetch = original;
  }
}

test('trigger search asks grok for reasoning explicitly', async () => {
  process.env.XAI_API_KEY = process.env.XAI_API_KEY || 'test-key';
  const finder = new TriggerFinder({}, silentLogger);

  await withCapturedFetch(async calls => {
    await finder._callResponsesAPI({ input: [{ role: 'user', content: 'x' }], tools: [] });

    assert.equal(calls.length, 1);
    const { body } = calls[0];
    assert.equal(body.model, DEFAULT_MODELS.triggerFinder);
    // Reasoning used to come from the model id itself (`-reasoning` suffix).
    // On grok-4.3 it is a parameter, so dropping it would silently downgrade
    // the feature to whatever the model defaults to.
    assert.deepEqual(body.reasoning, { effort: 'low' });
  });
});
