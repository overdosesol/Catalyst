import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_PRESET_CONFIGS, PRESET_FIELD_RANGES } from '../src/analysis/preset-config.js';
import { classifyStoryShape } from '../src/analysis/story-markers.js';

const animals = DEFAULT_PRESET_CONFIGS.animals.sources;

test('lore-bearing subreddits are present', () => {
  for (const sub of ['Awwducational', 'likeus', 'NatureIsMetal', 'HumansBeingBros']) {
    assert.ok(animals.reddit.subreddits.includes(sub), `missing lore sub: ${sub}`);
  }
});

test('pure-cuteness feeds are trimmed, not all removed', () => {
  // Volume lane still needs some reach; we only cut the ones that cannot
  // structurally carry a story.
  for (const sub of ['Eyebleach', 'rarepuppers']) {
    assert.ok(!animals.reddit.subreddits.includes(sub), `${sub} should be gone`);
  }
  assert.ok(animals.reddit.subreddits.includes('aww'), 'aww stays as the volume anchor');
});

test('subreddit list stays within the admin field cap of 30', () => {
  assert.ok(animals.reddit.subreddits.length <= 30);
  assert.ok(animals.reddit.subreddits.length >= 8);
});

test('narrative probes are declared separately from volume queries', () => {
  assert.ok(Array.isArray(animals.twitter.narrativeProbes));
  assert.equal(animals.twitter.narrativeProbes.length, 4, 'one probe per story family');
});

test('every probe carries the same bar as ordinary queries', () => {
  for (const q of animals.twitter.narrativeProbes) {
    assert.ok(q.includes('min_faves:5000'), `probe must use the preset bar: ${q}`);
    assert.ok(q.includes('-is:retweet'));
  }
});

test('probes search for event shape, not for the object in frame', () => {
  for (const q of animals.twitter.narrativeProbes) {
    assert.equal(classifyStoryShape(q).isStory, true, `probe has no story marker: ${q}`);
  }
});

test('the upvote bar is untouched — thresholds are out of scope', () => {
  assert.equal(animals.reddit.minUpvotes, 5000);
});

test('volume query bars are untouched too', () => {
  // Owner decision 2026-08-07: recall comes from WHAT we search for, not from
  // letting more through. The two broadest queries kept their 10k bar; if a
  // later edit quietly drops them to 5k this test is the thing that notices.
  const bar = (needle) => animals.twitter.queries.find(q => q.includes(needle));
  assert.ok(bar('puppy').includes('min_faves:10000'), 'dog query must keep its 10k bar');
  assert.ok(bar('kitten').includes('min_faves:10000'), 'cat query must keep its 10k bar');
});

test('the admin UI can render and validate the probe list', () => {
  const desc = PRESET_FIELD_RANGES.sources.twitter.narrativeProbes;
  assert.ok(desc, 'no field descriptor — admin would silently drop edits');
  assert.equal(desc.type, 'list');
  assert.ok(desc.max >= 4);
});
