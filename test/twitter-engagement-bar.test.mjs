import test from 'node:test';
import assert from 'node:assert/strict';

import { meetsEngagementBar, VIEWS_BAR, LIKES_BAR } from '../src/collectors/twitter.js';

test('either signal clears the floor', () => {
  // The case that motivated the change: a story tweet that wins on likes and
  // loses on views. Under the old rule (views known -> likes never consulted)
  // this was bought from Apify and then thrown away.
  assert.equal(meetsEngagementBar(300_000, 6_000), true, 'likes must count even when views are known');
  assert.equal(meetsEngagementBar(900_000, 900), true, 'views alone still pass');
});

test('a tweet that clears neither bar is still dropped', () => {
  assert.equal(meetsEngagementBar(120_000, 800), false);
  assert.equal(meetsEngagementBar(0, 0), false);
});

test('the likes bar matches what the preset queries actually ask for', () => {
  // Queries say min_faves:5000. A floor above that means paying for results we
  // discard; this test is what notices if the two drift apart again.
  assert.equal(LIKES_BAR, 5_000);
  assert.equal(VIEWS_BAR, 500_000);
  assert.equal(meetsEngagementBar(1, 5_000), true, 'exactly at the bar passes');
  assert.equal(meetsEngagementBar(1, 4_999), false);
});

test('missing or junk metrics never throw and never pass', () => {
  for (const [v, l] of [[undefined, undefined], [null, null], [NaN, NaN], ['x', 'y']]) {
    assert.equal(meetsEngagementBar(v, l), false);
  }
});

test('CJK tweets get a harder bar on both signals', () => {
  assert.equal(meetsEngagementBar(600_000, 6_000, { cjkMult: 4 }), false, 'zh needs 4x on both');
  assert.equal(meetsEngagementBar(600_000, 21_000, { cjkMult: 4 }), true, 'clears the 4x likes bar');
  assert.equal(meetsEngagementBar(2_100_000, 100, { cjkMult: 4 }), true, 'clears the 4x views bar');
});

test('the relaxed floor for X-Trends pulls stays relaxed', () => {
  assert.equal(meetsEngagementBar(11_000, 10, { relaxedFloor: true }), true);
  assert.equal(meetsEngagementBar(100, 600, { relaxedFloor: true }), true);
  assert.equal(meetsEngagementBar(100, 100, { relaxedFloor: true }), false);
});
