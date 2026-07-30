/**
 * Model registry — the single source of truth for which model ids this project
 * uses, what they cost and whether they still exist.
 *
 * Before this file the ids were hardcoded in eight places (scorer, admin API,
 * admin SPA, trigger-finder, config, nano-classifier, captioner, tag-refresher).
 * They drifted: `config.js` carried `grok-4-1-fast` while the scorer used
 * `grok-4-1-fast-non-reasoning`, and when xAI retired that whole family on
 * 2026-05-15 the dead ids stayed in five files because nobody could see them
 * all at once. `test/no-retired-models.test.mjs` now fails if a retired id
 * reappears anywhere outside this file.
 *
 * This is a registry of what Catalyst uses, not a catalogue of every model a
 * provider sells. Add an entry when the project actually reaches for it.
 *
 * Provenance:
 *   - Liveness verified 2026-07-31 against `/v1/models` on the operator's own
 *     keys for all three providers. The four `grok-4-1*` / `grok-4-fast*` ids
 *     are absent from the xAI account, confirming the retirement.
 *   - Prices are USD per 1M tokens from the providers' public pricing pages,
 *     checked 2026-07-31. They are reference data for choosing a model and for
 *     the future cost counter — nothing bills off them today, so treat a stale
 *     number as a documentation bug, not a production one.
 */

/**
 * @typedef {object} ModelEntry
 * @property {string} id                 API identifier, exactly as sent to the provider
 * @property {'xai'|'openai'|'gemini'} provider
 * @property {'live'|'retired'} status
 * @property {string} [retiredOn]        ISO date the provider pulled it
 * @property {string} [replacedBy]       id to migrate to — required when retired
 * @property {string} [eolOn]            ISO date of the announced shutdown, while still live
 * @property {{input?: number, cachedInput?: number, output?: number}} pricing  USD per 1M tokens
 * @property {number} [context]          max input tokens
 * @property {{structuredOutputs?: boolean, reasoning?: boolean, vision?: boolean}} capabilities
 * @property {string[]} roles            pipeline roles this model is eligible for
 * @property {string} [note]
 */

/** @type {Record<string, ModelEntry>} */
export const MODELS = {
  // ── Google Gemini ────────────────────────────────────────────────────────
  'gemini-3.1-flash-lite': {
    id: 'gemini-3.1-flash-lite',
    provider: 'gemini',
    status: 'live',
    eolOn: '2027-05-07',
    pricing: { input: 0.25, cachedInput: 0.025, output: 1.50 },
    context: 1_048_576,
    capabilities: { structuredOutputs: true, vision: true },
    roles: ['stage1', 'vision'],
    note: 'Ran Stage 1 in production until the 3.5 migration. Kept as the rollback target and still the cheapest vision option.',
  },
  'gemini-3.5-flash-lite': {
    id: 'gemini-3.5-flash-lite',
    provider: 'gemini',
    status: 'live',
    pricing: { input: 0.30, cachedInput: 0.03, output: 2.50 },
    context: 1_048_576,
    capabilities: { structuredOutputs: true, vision: true },
    roles: ['stage1', 'vision'],
    note: "Google's named successor to 3.1 Flash-Lite. ~45% dearer, which is about 12 cents per 1000 trends at our shape.",
  },
  'gemini-3.6-flash': {
    id: 'gemini-3.6-flash',
    provider: 'gemini',
    status: 'live',
    pricing: { input: 1.50, cachedInput: 0.15, output: 7.50 },
    context: 1_048_576,
    capabilities: { structuredOutputs: true, vision: true },
    roles: ['stage1'],
    note: '5x the input price of 3.5 Flash-Lite. Meant for escalating contested candidates, not for the bulk of Stage 1.',
  },

  // ── xAI Grok ─────────────────────────────────────────────────────────────
  'grok-4.3': {
    id: 'grok-4.3',
    provider: 'xai',
    status: 'live',
    pricing: { input: 1.25, cachedInput: 0.20, output: 2.50 },
    context: 1_000_000,
    capabilities: { structuredOutputs: true, reasoning: true, vision: true },
    roles: ['stage1', 'stage2', 'triggerFinder', 'tagRefresh'],
    note: "Reasoning is an effort level ('none' | 'low' | 'medium' | 'high'), not a separate id — which is why deepReasoningEnabled no longer has to swap models.",
  },
  'grok-4.20-0309-reasoning': {
    id: 'grok-4.20-0309-reasoning',
    provider: 'xai',
    status: 'live',
    pricing: { input: 1.25, cachedInput: 0.20, output: 2.50 },
    context: 1_000_000,
    capabilities: { structuredOutputs: true, reasoning: true },
    roles: ['stage1', 'tagRefresh'],
    note: 'Same price as 4.3, different model. Serves as the tag-refresh fallback.',
  },
  'grok-4.20-0309-non-reasoning': {
    id: 'grok-4.20-0309-non-reasoning',
    provider: 'xai',
    status: 'live',
    pricing: { input: 1.25, cachedInput: 0.20, output: 2.50 },
    context: 1_000_000,
    capabilities: { structuredOutputs: true },
    roles: ['stage1'],
  },

  // ── OpenAI ───────────────────────────────────────────────────────────────
  'gpt-5.4-mini': {
    id: 'gpt-5.4-mini',
    provider: 'openai',
    status: 'live',
    pricing: { input: 0.75, cachedInput: 0.075, output: 4.50 },
    context: 400_000,
    capabilities: { structuredOutputs: true, reasoning: true },
    roles: ['stage1'],
  },
  'gpt-5.6-luna': {
    id: 'gpt-5.6-luna',
    provider: 'openai',
    status: 'live',
    pricing: { input: 0.20, cachedInput: 0.02, output: 1.20 },
    context: 1_050_000,
    capabilities: { structuredOutputs: true, reasoning: true },
    roles: ['stage1'],
    note: 'Cheaper per token than the Gemini Lite models. Untested on our scoring scale — in the selector for a controlled comparison, not as a default.',
  },
  'gpt-5.4-nano': {
    id: 'gpt-5.4-nano',
    provider: 'openai',
    status: 'live',
    pricing: { input: 0.20, cachedInput: 0.02, output: 1.25 },
    context: 400_000,
    capabilities: { structuredOutputs: true },
    roles: ['nano'],
    note: 'Stage 0a enrichment. Deliberately out of the Stage 1 selector.',
  },
  'text-embedding-3-small': {
    id: 'text-embedding-3-small',
    provider: 'openai',
    status: 'live',
    pricing: { input: 0.02 },
    capabilities: {},
    roles: ['embeddings'],
    note: '1536 dims. 7.5-10x cheaper than the Gemini embedding models, and switching would force a re-embed of the whole corpus plus re-tuning of the cluster thresholds.',
  },

  // ── Retired: kept so the guard test can name them ─────────────────────────
  'grok-4-1-fast-non-reasoning': {
    id: 'grok-4-1-fast-non-reasoning',
    provider: 'xai',
    status: 'retired',
    retiredOn: '2026-05-15',
    replacedBy: 'grok-4.3',
    pricing: {},
    capabilities: {},
    roles: [],
    note: "Was the Stage 2 model. Stage 2 was switched off in production, so nothing broke — it would have failed on the first call.",
  },
  'grok-4-1-fast-reasoning': {
    id: 'grok-4-1-fast-reasoning',
    provider: 'xai',
    status: 'retired',
    retiredOn: '2026-05-15',
    replacedBy: 'grok-4.3',
    pricing: {},
    capabilities: {},
    roles: [],
    note: 'Was the trigger-finder default.',
  },
  'grok-4-fast-non-reasoning': {
    id: 'grok-4-fast-non-reasoning',
    provider: 'xai',
    status: 'retired',
    retiredOn: '2026-05-15',
    replacedBy: 'grok-4.3',
    pricing: {},
    capabilities: {},
    roles: [],
  },
  'grok-4-1-fast': {
    id: 'grok-4-1-fast',
    provider: 'xai',
    status: 'retired',
    retiredOn: '2026-05-15',
    replacedBy: 'grok-4.3',
    pricing: {},
    capabilities: {},
    roles: [],
    note: 'Only ever referenced by config.js, which had drifted from the scorer.',
  },
};

/**
 * Default model per pipeline role. Env vars and the `settings` table still win
 * over these — see `_getRuntimeAiConfig()` in scorer.js. Production reads the
 * database, so changing a default here does NOT move the live pipeline.
 */
export const DEFAULT_MODELS = {
  stage1Xai:     'grok-4.3',
  stage1OpenAI:  'gpt-5.4-mini',
  stage1Gemini:  'gemini-3.5-flash-lite',
  stage2:        'grok-4.3',
  triggerFinder: 'grok-4.3',
  nano:          'gpt-5.4-nano',
  vision:        'gemini-3.1-flash-lite',
  embeddings:    'text-embedding-3-small',
  tagRefresh:    'grok-4.3',
};

/**
 * Look up a model. Returns null for anything unknown — callers get ids from
 * the database and from operators, so "not in the registry" is a normal input,
 * not an exception.
 *
 * @param {*} id
 * @returns {ModelEntry|null}
 */
export function getModel(id) {
  if (!id || typeof id !== 'string') return null;
  return MODELS[id] || null;
}

/**
 * True only for ids the registry knows to be retired. An id it has never heard
 * of is not "retired" — it might be a model an operator picked deliberately.
 *
 * @param {*} id
 * @returns {boolean}
 */
export function isRetired(id) {
  return getModel(id)?.status === 'retired';
}

/**
 * Live Stage 1 models for a provider, in registry order — this is what the
 * admin selector offers.
 *
 * @param {string} provider
 * @returns {string[]}
 */
export function listModelsForProvider(provider) {
  return Object.values(MODELS)
    .filter(m => m.provider === provider && m.status === 'live' && m.roles.includes('stage1'))
    .map(m => m.id);
}

/**
 * The live replacement for a retired id, or null when the id is fine as-is.
 * Used by the one-time settings migration.
 *
 * @param {*} id
 * @returns {string|null}
 */
export function replacementFor(id) {
  const model = getModel(id);
  return model?.status === 'retired' ? model.replacedBy || null : null;
}
