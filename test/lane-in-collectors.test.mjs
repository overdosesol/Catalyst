import test from 'node:test';
import assert from 'node:assert/strict';

import config from '../src/config.js';
import RedditCollector from '../src/collectors/reddit.js';
import { LANE_NARRATIVE, LANE_VOLUME } from '../src/analysis/lane.js';

const silentLogger = { info() {}, warn() {}, debug() {}, error() {} };
const db = { getSetting: (k, d) => (k === 'activePreset' ? 'animals' : d) };

const redditPost = (title) => ({
  id: 'abc123',
  title,
  subreddit: 'Awwducational',
  score: 9000,
  num_comments: 120,
  upvote_ratio: 0.97,
  created_utc: Math.floor(Date.now() / 1000) - 3600,
  permalink: '/r/Awwducational/comments/abc123/x/',
  url: 'https://i.redd.it/x.jpg',
});

test('a story-shaped reddit post is tagged narrative', () => {
  const c = new RedditCollector(config, silentLogger, db);
  const item = c._normalize(redditPost('Dog reunited with owner after 5 years'), 'Awwducational');
  assert.equal(item.lane, LANE_NARRATIVE);
});

test('a plain cute reddit post is tagged volume', () => {
  const c = new RedditCollector(config, silentLogger, db);
  const item = c._normalize(redditPost('My cat being adorable as always'), 'aww');
  assert.equal(item.lane, LANE_VOLUME);
});

test('lane survives onto the item that the pipeline consumes', () => {
  const c = new RedditCollector(config, silentLogger, db);
  const item = c._normalize(redditPost('Rare white orca spotted for the first time'), 'NatureIsMetal');
  assert.equal(item.lane, LANE_NARRATIVE);
  assert.equal(typeof item.laneReason, 'string');
  assert.ok(item.laneReason.length > 0);
});
