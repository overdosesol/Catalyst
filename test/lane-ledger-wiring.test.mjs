import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';

import { createEntityLedgerSchema, recordEntityMentions } from '../src/db/entity-ledger.js';
import { resolveLane, makeLoreChecker, LANE_NARRATIVE, LANE_VOLUME } from '../src/analysis/lane.js';
import { upgradeLaneWithLedger, applyLanePriority } from '../src/analysis/clusterer.js';

const dayAgo = (n) => new Date(Date.now() - n * 86_400_000).toISOString();

/** A db with lore already recorded for `name`, shaped like the app wrapper. */
const dbWithLore = (name) => {
  const raw = new Database(':memory:');
  createEntityLedgerSchema(raw);
  recordEntityMentions(raw, [name], 'reddit', dayAgo(9));
  recordEntityMentions(raw, [name], 'twitter', dayAgo(4));
  recordEntityMentions(raw, [name], 'tiktok', dayAgo(1));
  return { db: raw, getSetting: (k, d) => d };
};

test('a flat title with a lore-carrying name is promoted to narrative', () => {
  const db = new Database(':memory:');
  createEntityLedgerSchema(db);
  recordEntityMentions(db, ['Moo Deng'], 'reddit', dayAgo(9));
  recordEntityMentions(db, ['Moo Deng'], 'twitter', dayAgo(4));
  recordEntityMentions(db, ['Moo Deng'], 'tiktok', dayAgo(1));

  const item = { title: 'just vibes', metrics: { subjectNames: ['Moo Deng'] } };
  const r = resolveLane(item, { enabled: true, hasLore: makeLoreChecker(db) });

  assert.equal(r.lane, LANE_NARRATIVE);
  assert.ok(r.reason.startsWith('ledger:'));
});

test('an unknown name leaves the item in the volume lane', () => {
  const db = new Database(':memory:');
  createEntityLedgerSchema(db);
  const item = { title: 'just vibes', metrics: { subjectNames: ['Nobody'] } };
  assert.equal(resolveLane(item, { enabled: true, hasLore: makeLoreChecker(db) }).lane, LANE_VOLUME);
});

test('a null db yields a checker that answers false instead of throwing', () => {
  const item = { title: 'just vibes', metrics: { subjectNames: ['Whoever'] } };
  assert.equal(resolveLane(item, { enabled: true, hasLore: makeLoreChecker(null) }).lane, LANE_VOLUME);
});

test('the checker accepts the app Database wrapper, not just a raw handle', () => {
  // The clusterer holds the wrapper (`this.db`), whose real handle is `db.db`.
  // Getting this wrong makes every lookup silently answer false.
  assert.equal(makeLoreChecker(dbWithLore('Pesto'))('Pesto'), true);
});

test('names from Stage 0b vision are where the ledger actually reads them', () => {
  // The load-bearing path in production: collectors never see subjectNames,
  // because vision runs after collection. If resolveLane only looked at
  // metrics.subjectNames the ledger would never fire on a real trend.
  const rep = {
    title: 'just vibes',
    lane: LANE_VOLUME,
    preStage: { gemini: { subjectNames: ['Moo Deng'] } },
  };
  const r = resolveLane(rep, { enabled: true, hasLore: makeLoreChecker(dbWithLore('Moo Deng')) });
  assert.equal(r.lane, LANE_NARRATIVE);
  assert.equal(r.reason, 'ledger:Moo Deng');
});

test('the clusterer upgrades a flat trend whose subject carries lore', () => {
  const rep = {
    title: 'just vibes',
    lane: LANE_VOLUME,
    laneReason: 'none',
    preStage: { gemini: { subjectNames: ['Moo Deng'] } },
  };
  upgradeLaneWithLedger(rep, dbWithLore('Moo Deng'));

  assert.equal(rep.lane, LANE_NARRATIVE);
  // …and that upgrade is what changes the routing decision:
  assert.equal(applyLanePriority('save_only', rep), 'priority');
});

test('the upgrade keeps the original reason when the lane is already narrative', () => {
  const rep = {
    title: 'Dog rescued from a lake',
    lane: LANE_NARRATIVE,
    laneReason: 'lexical:event',
    preStage: { gemini: { subjectNames: ['Moo Deng'] } },
  };
  upgradeLaneWithLedger(rep, dbWithLore('Moo Deng'));
  assert.equal(rep.laneReason, 'lexical:event', 'why it got there must not be overwritten');
});

test('a volume trend with no known subject is left alone', () => {
  const rep = {
    title: 'just vibes',
    lane: LANE_VOLUME,
    laneReason: 'none',
    preStage: { gemini: { subjectNames: ['Nobody'] } },
  };
  upgradeLaneWithLedger(rep, dbWithLore('Moo Deng'));
  assert.equal(rep.lane, LANE_VOLUME);
});
