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

test('a manual value equal to the DEFAULT survives when an auto layer differs', () => {
  // The bug this guards: compaction was written for a two-layer world
  // (defaults -> manual), but the system has three (defaults -> auto -> manual).
  // With an auto layer in between, "equal to the default" is NOT a no-op — it
  // is precisely how an operator overrides auto. Dropping it silently handed
  // control back to Grok, which is how pressing Save right after "Restore
  // hardcoded" undid the restore.
  const baselines = {
    animals: {
      sources: { reddit: { subreddits: ['Eyebleach', 'rarepuppers'] } },
    },
  };
  const manual = {
    animals: {
      sources: {
        reddit: { subreddits: DEFAULT_PRESET_CONFIGS.animals.sources.reddit.subreddits },
      },
    },
  };

  const validated = validatePresetOverrides(manual, { baselines });
  assert.deepEqual(
    validated.animals.sources.reddit.subreddits,
    DEFAULT_PRESET_CONFIGS.animals.sources.reddit.subreddits,
    'must survive: it differs from the layer directly beneath it'
  );
});

test('a manual value equal to the effective layer beneath it is still dropped', () => {
  // The compaction itself is right — it just needs the correct baseline.
  const baselines = {
    animals: {
      sources: { reddit: { subreddits: ['Eyebleach', 'rarepuppers'] } },
    },
  };
  const manual = {
    animals: { sources: { reddit: { subreddits: ['Eyebleach', 'rarepuppers'] } } },
  };
  assert.deepEqual(validatePresetOverrides(manual, { baselines }), {},
    'a genuine no-op must not bloat the blob');
});

test('without baselines the comparison falls back to plain defaults', () => {
  const manual = {
    animals: {
      sources: {
        reddit: { subreddits: DEFAULT_PRESET_CONFIGS.animals.sources.reddit.subreddits },
      },
    },
  };
  assert.deepEqual(validatePresetOverrides(manual), {});
});

test('keepDefaults still validates — it relaxes compaction, not the range checks', () => {
  const bad = { animals: { sources: { reddit: { minUpvotes: 999_999 } } } };
  assert.throws(() => validatePresetOverrides(bad, { keepDefaults: true }), /minUpvotes/);

  const unknown = { animals: { sources: { reddit: { nonsenseField: 1 } } } };
  assert.throws(() => validatePresetOverrides(unknown, { keepDefaults: true }), /unknown field/);
});
