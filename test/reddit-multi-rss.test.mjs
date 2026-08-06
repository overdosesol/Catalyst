import test from 'node:test';
import assert from 'node:assert/strict';

import config from '../src/config.js';
import RedditCollector from '../src/collectors/reddit.js';
import { LANE_NARRATIVE, LANE_VOLUME } from '../src/analysis/lane.js';

const silentLogger = { info() {}, warn() {}, debug() {}, error() {} };
const db = { getSetting: (k, d) => (k === 'activePreset' ? 'animals' : d) };
const collector = () => new RedditCollector(config, silentLogger, db);

const SUBS = ['Awwducational', 'likeus', 'NatureIsMetal', 'aww'];

test('all subreddits are folded into ONE multireddit url', () => {
  const url = collector()._buildMultiRssUrl(SUBS);
  assert.ok(url.startsWith('https://www.reddit.com/r/Awwducational+likeus+NatureIsMetal+aww/hot/.rss'));
  assert.ok(url.includes('limit=100'));
});

test('the story search url is scoped to the same multireddit', () => {
  const url = collector()._buildMultiSearchUrl(SUBS, 'event');
  const parsed = new URL(url);

  assert.ok(parsed.pathname.startsWith('/r/Awwducational+likeus+NatureIsMetal+aww/search.rss'));
  assert.equal(parsed.searchParams.get('restrict_sr'), 'on', 'must not leak into site-wide search');
  assert.equal(parsed.searchParams.get('sort'), 'top');
  assert.equal(parsed.searchParams.get('t'), 'week');
});

test('search terms come from the story-marker vocabulary', () => {
  const q = new URL(collector()._buildMultiSearchUrl(SUBS, 'event')).searchParams.get('q');
  assert.ok(q.includes('rescued') || q.includes('reunited'), `no event marker in: ${q}`);
});

test('multi-word markers are quoted so the phrase survives the search', () => {
  const q = new URL(collector()._buildMultiSearchUrl(SUBS, 'anomaly')).searchParams.get('q');
  assert.ok(q.includes('"first ever"'), `phrase must be quoted: ${q}`);
});

test('an unknown family throws rather than silently searching for nothing', () => {
  assert.throws(() => collector()._buildMultiSearchUrl(SUBS, 'nonsense'));
});

test('an empty subreddit list produces no url at all', () => {
  assert.equal(collector()._buildMultiRssUrl([]), null);
  assert.equal(collector()._buildMultiSearchUrl([], 'event'), null);
});

test('rss items carry a lane — the classifier reads titles, and rss has titles', () => {
  const c = collector();
  const items = c._parseAtomFeed(atomFeed([
    'Dog reunited with owner after five years',
    'My cat being adorable as always',
  ]));

  assert.equal(items[0].lane, LANE_NARRATIVE);
  assert.equal(items[0].laneReason, 'lexical:event');
  assert.equal(items[1].lane, LANE_VOLUME);
});

test('search results are marked as probe-sourced regardless of wording', () => {
  const c = collector();
  const items = c._parseAtomFeed(atomFeed(['just a cat']), { fromProbe: true });
  assert.equal(items[0].lane, LANE_NARRATIVE);
  assert.equal(items[0].laneReason, 'probe');
});

test('the family rotates across cycles so all four get searched', () => {
  const c = collector();
  const seen = new Set();
  for (let i = 0; i < 4; i++) seen.add(c._nextSearchFamily());
  assert.equal(seen.size, 4);
});

// ── helpers ────────────────────────────────────────────────────────────────

/** Minimal Reddit Atom feed carrying the given titles. */
function atomFeed(titles) {
  const nowIso = new Date().toISOString();
  const entries = titles.map((t, i) => `
  <entry>
    <author><name>/u/someone</name><uri>https://www.reddit.com/user/someone</uri></author>
    <id>t3_abc${i}</id>
    <link href="https://www.reddit.com/r/aww/comments/abc${i}/x/" />
    <updated>${nowIso}</updated>
    <published>${nowIso}</published>
    <title>${t}</title>
    <content type="html">&lt;!-- SC_OFF --&gt;&lt;div&gt;&lt;/div&gt;</content>
  </entry>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">${entries}
</feed>`;
}
