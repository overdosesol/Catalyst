import test from 'node:test';
import assert from 'node:assert/strict';

import {
  STORY_FAMILIES,
  classifyStoryShape,
  PROBE_ROTATION,
} from '../src/analysis/story-markers.js';

test('all four families exist and carry markers', () => {
  assert.deepEqual(Object.keys(STORY_FAMILIES), ['named', 'event', 'anomaly', 'drama']);
  for (const [name, family] of Object.entries(STORY_FAMILIES)) {
    assert.ok(family.markers.length >= 5, `${name} needs at least 5 markers`);
    assert.ok(family.probeTerms.length >= 3, `${name} needs at least 3 probe terms`);
  }
});

test('an event-shaped headline is classified as a story', () => {
  const r = classifyStoryShape('Dog reunited with owner after 5 years lost in the mountains');
  assert.equal(r.isStory, true);
  assert.equal(r.family, 'event');
  assert.ok(r.hits.includes('reunited'));
});

test('a named-subject headline is classified as a story', () => {
  const r = classifyStoryShape('Meet Pesto, the baby penguin who already weighs more than his parents');
  assert.equal(r.isStory, true);
  assert.equal(r.family, 'named');
});

test('an anomaly headline is classified as a story', () => {
  const r = classifyStoryShape('Rare white orca spotted for the first time in 70 years');
  assert.equal(r.isStory, true);
  assert.equal(r.family, 'anomaly');
});

test('a drama headline is classified as a story', () => {
  const r = classifyStoryShape('Zoo faces court hearing over the fate of its oldest elephant');
  assert.equal(r.isStory, true);
  assert.equal(r.family, 'drama');
});

test('pure cuteness is NOT a story', () => {
  for (const title of [
    'My cat being adorable as always',
    'Funny puppy compilation',
    'This is the cutest thing you will see today',
    'Golden retriever does a silly little dance',
  ]) {
    assert.equal(classifyStoryShape(title).isStory, false, `false positive on: ${title}`);
  }
});

test('classification reads description too, not just title', () => {
  const r = classifyStoryShape('Update on our girl', 'She was rescued from the shelter three weeks ago');
  assert.equal(r.isStory, true);
});

test('markers match whole words only', () => {
  // "born" must not fire inside "airborne", "rare" must not fire inside "rarely"
  assert.equal(classifyStoryShape('Airborne pets rarely travel well').isStory, false);
});

test('classification is case-insensitive', () => {
  assert.equal(classifyStoryShape('DOG RESCUED FROM FROZEN LAKE').isStory, true);
});

test('empty and junk input never throws', () => {
  for (const bad of [undefined, null, '', '   ', 123, {}]) {
    assert.equal(classifyStoryShape(bad).isStory, false);
  }
});

test('probe rotation covers every family exactly once', () => {
  assert.deepEqual([...PROBE_ROTATION].sort(), Object.keys(STORY_FAMILIES).sort());
});
