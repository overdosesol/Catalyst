import test from 'node:test';
import assert from 'node:assert/strict';

import { meetsViralBar, PLAYS_BAR, LIKES_BAR, SHARES_BAR } from '../src/collectors/tiktok.js';

// Owner's call 2026-08-18: TikTok was too loud in the feed, so the plays and
// likes bars doubled. These tests pin the numbers, because the bar has been
// silently re-tuned twice before (2026-05-05, 2026-08-18) and the only record
// of what it used to be was a comment.

test('the doubled bars are the ones in force', () => {
  assert.equal(PLAYS_BAR,  1_000_000, 'was 500K until 2026-08-18');
  assert.equal(LIKES_BAR,     40_000, 'was 20K until 2026-08-18');
  assert.equal(SHARES_BAR,     5_000, 'deliberately NOT doubled — see the docblock');
});

test('any one bar is enough — this is an OR, unlike Twitter', () => {
  assert.equal(meetsViralBar(1_000_000, 0, 0), true, 'reach alone passes');
  assert.equal(meetsViralBar(0, 40_000, 0),    true, 'likes alone pass');
  assert.equal(meetsViralBar(0, 0, 5_000),     true, 'shares alone pass');
});

test('exactly at a bar passes, one short fails', () => {
  assert.equal(meetsViralBar(1_000_000, 0, 0), true);
  assert.equal(meetsViralBar(  999_999, 0, 0), false);
  assert.equal(meetsViralBar(0, 40_000, 0), true);
  assert.equal(meetsViralBar(0, 39_999, 0), false);
  assert.equal(meetsViralBar(0, 0, 5_000), true);
  assert.equal(meetsViralBar(0, 0, 4_999), false);
});

// The behaviour change itself. Everything in this test used to be collected.
test('what the doubling actually rejects', () => {
  assert.equal(meetsViralBar(600_000, 3_000, 200), false, '600K plays was viral, now it is not');
  assert.equal(meetsViralBar(120_000, 25_000, 400), false, '25K likes was viral, now it is not');
  // And what still gets through, so the change is a trim and not a shutdown.
  assert.equal(meetsViralBar(2_400_000, 3_000, 200), true);
  assert.equal(meetsViralBar(120_000, 61_000, 400), true);
});

// 101 of 143 TikTok trends saved over 30 days had >=5K shares, so this path is
// the loosest of the three, not the rarest. 24 of them clear nothing else and
// ride in on shares alone. That is a known, measured consequence of leaving
// SHARES_BAR where it is — not an oversight. If this test starts failing
// because someone doubled shares too, that was probably deliberate.
test('a modest video with heavy sharing still gets in', () => {
  assert.equal(meetsViralBar(180_000, 9_000, 6_200), true);
});

test('CJK videos face the same bars multiplied', () => {
  // zh = 4x, ja/ko = 2x. Apify's firehose drags in regional virality that
  // clears the default floor but never crosses into a global narrative.
  assert.equal(meetsViralBar(2_000_000, 0, 0, { cjkMult: 4 }), false, 'zh needs 4M plays');
  assert.equal(meetsViralBar(4_000_000, 0, 0, { cjkMult: 4 }), true);
  assert.equal(meetsViralBar(1_500_000, 0, 0, { cjkMult: 2 }), false, 'ja/ko need 2M plays');
  assert.equal(meetsViralBar(2_000_000, 0, 0, { cjkMult: 2 }), true);
  assert.equal(meetsViralBar(0, 0, 9_000, { cjkMult: 2 }), false, 'the shares bar scales too');
  assert.equal(meetsViralBar(0, 0, 10_000, { cjkMult: 2 }), true);
});

test('a junk multiplier falls back to 1 instead of letting everything through', () => {
  // cjkMult=0 would make every bar 0 and pass literally any video.
  for (const mult of [0, -3, NaN, undefined, null, 'zh']) {
    assert.equal(meetsViralBar(10, 10, 10, { cjkMult: mult }), false, `mult=${mult}`);
    assert.equal(meetsViralBar(1_000_000, 0, 0, { cjkMult: mult }), true, `mult=${mult}`);
  }
});

test('missing or junk metrics never throw and never pass', () => {
  for (const v of [undefined, null, NaN, 'lots', {}, []]) {
    assert.equal(meetsViralBar(v, v, v), false, String(v));
  }
  assert.equal(meetsViralBar(), false, 'no arguments at all');
});
