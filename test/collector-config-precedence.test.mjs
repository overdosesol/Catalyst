/**
 * Regression guard for the env-shadowing bug fixed on 2026-08-06.
 *
 * `config.js` doubles as the env-override layer for collectors: a PRESENT
 * value means "the operator pinned this via env" and wins over the per-preset
 * config. So a non-empty literal default there is not a default — it is a
 * permanent shadow that makes `sources.<platform>` in every preset dead code.
 *
 * Reddit shipped with `subreddits: ['all','popular']` (plus hardcoded
 * minUpvotes/postsPerSubreddit) and therefore ignored presets from the day
 * they landed until this was caught. Twitter and TikTok used `undefined` and
 * were never affected.
 *
 * These tests fail if anyone reintroduces a literal default in that layer.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import config from '../src/config.js';
import RedditCollector from '../src/collectors/reddit.js';
import { DEFAULT_PRESET_CONFIGS } from '../src/analysis/preset-config.js';

const silentLogger = { info() {}, warn() {}, debug() {}, error() {} };

/** Minimal db stub: only `activePreset` is set, every other setting defaults. */
const presetDb = (preset) => ({
  getSetting: (key, fallback) => (key === 'activePreset' ? preset : fallback),
});

// ── The config layer must stay empty unless env says otherwise ───────────────
//
// Skipped rather than failed when the developer running the suite genuinely
// has the env var set — that is the supported escape hatch, not a regression.

test('reddit config fields are undefined when their env vars are absent', (t) => {
  const pinned = ['REDDIT_SUBREDDITS', 'REDDIT_POSTS_PER_SUBREDDIT', 'REDDIT_MIN_UPVOTES']
    .filter(k => process.env[k]);
  if (pinned.length > 0) return t.skip(`env pins present: ${pinned.join(', ')}`);

  assert.equal(config.reddit.subreddits, undefined,
    'a literal subreddit default here permanently shadows sources.reddit in every preset');
  assert.equal(config.reddit.postsPerSubreddit, undefined);
  assert.equal(config.reddit.minUpvotes, undefined);
});

test('twitter and tiktok config fields are undefined when their env vars are absent', (t) => {
  const pinned = ['TWITTER_QUERIES', 'TIKTOK_HASHTAGS'].filter(k => process.env[k]);
  if (pinned.length > 0) return t.skip(`env pins present: ${pinned.join(', ')}`);

  assert.equal(config.twitter.queries, undefined);
  assert.equal(config.tiktok.hashtags, undefined);
});

// ── What the shadow actually broke: preset resolution ────────────────────────

test('RedditCollector resolves subreddits from the active preset, not from config defaults', (t) => {
  if (process.env.REDDIT_SUBREDDITS) return t.skip('env pin present');

  const collector = new RedditCollector(config, silentLogger, presetDb('animals'));
  const resolved = collector._resolveRedditConfig();

  assert.deepEqual(resolved.subreddits, DEFAULT_PRESET_CONFIGS.animals.sources.reddit.subreddits);
  assert.ok(!resolved.subreddits.includes('all'),     'r/all must not leak in from the config layer');
  assert.ok(!resolved.subreddits.includes('popular'), 'r/popular must not leak in from the config layer');
});

test('RedditCollector picks up the preset upvote bar and post count', (t) => {
  if (process.env.REDDIT_MIN_UPVOTES || process.env.REDDIT_POSTS_PER_SUBREDDIT) {
    return t.skip('env pin present');
  }

  const expected = DEFAULT_PRESET_CONFIGS.animals.sources.reddit;
  const resolved = new RedditCollector(config, silentLogger, presetDb('animals'))
    ._resolveRedditConfig();

  assert.equal(resolved.minUpvotes,        expected.minUpvotes);
  assert.equal(resolved.postsPerSubreddit, expected.postsPerSubreddit);
});

test('switching the active preset switches the resolved subreddit list', (t) => {
  if (process.env.REDDIT_SUBREDDITS) return t.skip('env pin present');

  const animals = new RedditCollector(config, silentLogger, presetDb('animals'))
    ._resolveRedditConfig().subreddits;
  const culture = new RedditCollector(config, silentLogger, presetDb('culture'))
    ._resolveRedditConfig().subreddits;

  assert.notDeepEqual(animals, culture, 'presets must not resolve to the same list');
});

// ── The escape hatch itself must keep working ────────────────────────────────

test('an explicit env pin still overrides the preset', () => {
  const pinnedConfig = {
    ...config,
    reddit: {
      ...config.reddit,
      subreddits:        ['pinnedSubOne', 'pinnedSubTwo'],
      minUpvotes:        1234,
      postsPerSubreddit: 7,
    },
  };

  const resolved = new RedditCollector(pinnedConfig, silentLogger, presetDb('animals'))
    ._resolveRedditConfig();

  assert.deepEqual(resolved.subreddits, ['pinnedSubOne', 'pinnedSubTwo']);
  assert.equal(resolved.minUpvotes,        1234);
  assert.equal(resolved.postsPerSubreddit, 7);
});

test('a malformed numeric env pin falls through to the preset instead of poisoning it', () => {
  const brokenConfig = {
    ...config,
    reddit: { ...config.reddit, minUpvotes: Number.NaN, postsPerSubreddit: Number.NaN },
  };

  const resolved = new RedditCollector(brokenConfig, silentLogger, presetDb('animals'))
    ._resolveRedditConfig();

  assert.equal(resolved.minUpvotes,        DEFAULT_PRESET_CONFIGS.animals.sources.reddit.minUpvotes);
  assert.equal(resolved.postsPerSubreddit, DEFAULT_PRESET_CONFIGS.animals.sources.reddit.postsPerSubreddit);
});
