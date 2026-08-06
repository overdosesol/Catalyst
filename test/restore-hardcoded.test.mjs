import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_PRESET_CONFIGS,
  PRESET_KEYS,
  validatePresetOverrides,
  resolvePresetConfig,
} from '../src/analysis/preset-config.js';

/** Exactly what admin `_restoreHardcodedPresetSources` builds before validating. */
const hardcodedSourcesBlob = () => {
  const next = {};
  for (const preset of PRESET_KEYS) {
    next[preset] = { sources: JSON.parse(JSON.stringify(DEFAULT_PRESET_CONFIGS[preset]?.sources || {})) };
  }
  return next;
};

test('restoring hardcoded sources survives validation instead of being compacted away', () => {
  // The whole point of "↩ Restore hardcoded" is to PIN the defaults into the
  // manual layer, because manual beats the Grok-written auto layer. The normal
  // compaction — "drop anything equal to the default" — deletes exactly that,
  // leaving {} and a button that silently does nothing.
  const validated = validatePresetOverrides(hardcodedSourcesBlob(), { keepDefaults: true });

  assert.ok(Object.keys(validated).length > 0, 'restore must not validate down to an empty blob');
  assert.deepEqual(
    validated.animals.sources.reddit.subreddits,
    DEFAULT_PRESET_CONFIGS.animals.sources.reddit.subreddits
  );
  assert.deepEqual(
    validated.animals.sources.twitter.narrativeProbes,
    DEFAULT_PRESET_CONFIGS.animals.sources.twitter.narrativeProbes
  );
});

test('the pinned blob actually beats an auto-layer override when merged', () => {
  const manual = validatePresetOverrides(hardcodedSourcesBlob(), { keepDefaults: true });
  // The Grok list that was live on prod, as the auto layer would supply it.
  const auto = { animals: { sources: { reddit: { subreddits: ['Eyebleach', 'rarepuppers'] } } } };

  const merged = resolvePresetConfig('animals', {
    animals: {
      ...auto.animals,
      ...manual.animals,
      sources: { ...auto.animals.sources, ...manual.animals.sources },
    },
  });

  assert.ok(merged.sources.reddit.subreddits.includes('Awwducational'));
  assert.ok(!merged.sources.reddit.subreddits.includes('Eyebleach'));
});

test('default compaction still applies on the ordinary save path', () => {
  // Without the flag the behaviour must not change: an operator saving a value
  // identical to the default should not grow the blob.
  const validated = validatePresetOverrides(hardcodedSourcesBlob());
  assert.deepEqual(validated, {}, 'ordinary saves still compact defaults away');
});

test('keepDefaults still validates — it relaxes compaction, not the range checks', () => {
  const bad = { animals: { sources: { reddit: { minUpvotes: 999_999 } } } };
  assert.throws(() => validatePresetOverrides(bad, { keepDefaults: true }), /minUpvotes/);

  const unknown = { animals: { sources: { reddit: { nonsenseField: 1 } } } };
  assert.throws(() => validatePresetOverrides(unknown, { keepDefaults: true }), /unknown field/);
});
