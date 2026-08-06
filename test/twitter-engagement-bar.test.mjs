import test from 'node:test';
import assert from 'node:assert/strict';

import { meetsEngagementBar, VIEWS_BAR, LIKES_BAR } from '../src/collectors/twitter.js';

test('both bars must be cleared, not just one', () => {
  assert.equal(meetsEngagementBar(600_000, 6_000), true, 'clears both');
  assert.equal(meetsEngagementBar(900_000, 900), false, 'reach without engagement is rejected');
  assert.equal(meetsEngagementBar(300_000, 60_000), false, 'engagement without reach is rejected');
});

test('reach alone no longer passes — this is the behaviour change', () => {
  // Old rule: views known -> likes never consulted, so this passed. A sticky
  // clip collects impressions from the scroll without anyone reacting; that is
  // exactly the shape the preset is trying to stop surfacing.
  assert.equal(meetsEngagementBar(2_000_000, 1_200), false);
});

test('the bars are the ones the preset queries imply', () => {
  assert.equal(LIKES_BAR, 5_000);
  assert.equal(VIEWS_BAR, 500_000);
  assert.equal(meetsEngagementBar(500_000, 5_000), true, 'exactly at both bars passes');
  assert.equal(meetsEngagementBar(499_999, 5_000), false);
  assert.equal(meetsEngagementBar(500_000, 4_999), false);
});

test('a payload with no view count fails, since one bar cannot be cleared', () => {
  // Documented consequence of the AND rule rather than an accident: some actor
  // payloads omit views entirely. If those turn out to be common, the fix is to
  // treat a missing count as unknown — not to loosen the bar.
  assert.equal(meetsEngagementBar(0, 50_000), false);
  assert.equal(meetsEngagementBar(undefined, 50_000), false);
});

test('missing or junk metrics never throw and never pass', () => {
  for (const [v, l] of [[undefined, undefined], [null, null], [NaN, NaN], ['x', 'y']]) {
    assert.equal(meetsEngagementBar(v, l), false);
  }
});

test('CJK tweets get a harder bar on both signals', () => {
  // zh = 4x -> 2M views AND 20k likes; ja/ko = 2x -> 1M views AND 10k likes.
  assert.equal(meetsEngagementBar(600_000, 6_000, { cjkMult: 4 }), false, 'zh needs 4x on both');
  assert.equal(meetsEngagementBar(2_100_000, 21_000, { cjkMult: 4 }), true);
  assert.equal(meetsEngagementBar(2_100_000, 12_000, { cjkMult: 2 }), true, 'ja/ko multiplier is 2x');
  assert.equal(meetsEngagementBar(2_100_000, 6_000,  { cjkMult: 2 }), false, '6k likes misses the 10k ja/ko bar');
});

test('the relaxed floor for X-Trends pulls stays relaxed, but also needs both', () => {
  assert.equal(meetsEngagementBar(11_000, 600, { relaxedFloor: true }), true);
  assert.equal(meetsEngagementBar(11_000, 100, { relaxedFloor: true }), false);
  assert.equal(meetsEngagementBar(100, 600, { relaxedFloor: true }), false);
});
