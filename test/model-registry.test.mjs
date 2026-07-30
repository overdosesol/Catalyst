import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MODELS,
  DEFAULT_MODELS,
  getModel,
  isRetired,
  listModelsForProvider,
} from '../src/analysis/model-registry.js';

test('every default model exists in the registry and is not retired', () => {
  for (const [role, id] of Object.entries(DEFAULT_MODELS)) {
    const model = getModel(id);
    assert.ok(model, `default for ${role} (${id}) is missing from the registry`);
    assert.equal(model.status, 'live', `default for ${role} (${id}) is ${model.status}`);
  }
});

test('retired xAI ids are known and flagged', () => {
  const retired = [
    'grok-4-1-fast-non-reasoning',
    'grok-4-1-fast-reasoning',
    'grok-4-fast-non-reasoning',
    'grok-4-1-fast',
  ];
  for (const id of retired) {
    assert.equal(isRetired(id), true, `${id} must be flagged retired`);
  }
  assert.equal(isRetired('grok-4.3'), false);
  assert.equal(isRetired('gemini-3.5-flash-lite'), false);
});

test('a retired model names its replacement', () => {
  for (const model of Object.values(MODELS)) {
    if (model.status !== 'retired') continue;
    assert.ok(getModel(model.replacedBy), `${model.id} points at unknown replacement ${model.replacedBy}`);
    assert.equal(getModel(model.replacedBy).status, 'live', `${model.id} is replaced by a non-live model`);
  }
});

test('curated Stage 1 lists are non-empty and offer no retired model', () => {
  for (const provider of ['xai', 'openai', 'gemini']) {
    const ids = listModelsForProvider(provider);
    assert.ok(ids.length > 0, `${provider} curated list is empty`);
    for (const id of ids) {
      assert.equal(isRetired(id), false, `${provider} list still offers retired ${id}`);
      assert.equal(getModel(id).provider, provider, `${id} listed under the wrong provider`);
    }
  }
});

test('every live model carries pricing', () => {
  for (const model of Object.values(MODELS)) {
    if (model.status !== 'live') continue;
    assert.equal(typeof model.pricing.input, 'number', `${model.id} has no input price`);
    if (model.roles.includes('embeddings')) continue; // embeddings bill input only
    assert.equal(typeof model.pricing.output, 'number', `${model.id} has no output price`);
  }
});

test('unknown ids are handled without throwing', () => {
  assert.equal(getModel('gpt-9000'), null);
  assert.equal(getModel(undefined), null);
  assert.equal(isRetired('gpt-9000'), false);
  assert.deepEqual(listModelsForProvider('nosuchprovider'), []);
});
