import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';

import {
  createEntityLedgerSchema,
  recordEntityMentions,
  hasLore,
  normalizeEntityName,
  LEDGER_MIN_MENTIONS,
  LEDGER_MIN_DISTINCT_DAYS,
  LEDGER_WINDOW_DAYS,
} from '../src/db/entity-ledger.js';

const freshDb = () => {
  const db = new Database(':memory:');
  createEntityLedgerSchema(db);
  return db;
};
const dayAgo = (n) => new Date(Date.now() - n * 86_400_000).toISOString();

test('schema creation is idempotent — it runs on every boot', () => {
  const db = freshDb();
  assert.doesNotThrow(() => createEntityLedgerSchema(db));
  assert.doesNotThrow(() => createEntityLedgerSchema(db));
});

test('names are normalized so casing and punctuation do not split an entity', () => {
  assert.equal(normalizeEntityName('  Moo Deng '), normalizeEntityName('moo deng'));
  assert.equal(normalizeEntityName('Pesto!'), normalizeEntityName('Pesto'));
});

test('three mentions across two days count as lore', () => {
  const db = freshDb();
  recordEntityMentions(db, ['Janet'], 'reddit', dayAgo(5));
  recordEntityMentions(db, ['Janet'], 'reddit', dayAgo(5));
  recordEntityMentions(db, ['Janet'], 'twitter', dayAgo(1));
  assert.equal(hasLore(db, 'Janet'), true);
});

test('three mentions on a single day are a spike, not lore', () => {
  const db = freshDb();
  const today = dayAgo(0);
  for (let i = 0; i < 3; i++) recordEntityMentions(db, ['Spike'], 'twitter', today);
  assert.equal(hasLore(db, 'Spike'), false);
});

test('two mentions are never enough', () => {
  const db = freshDb();
  recordEntityMentions(db, ['Pair'], 'reddit', dayAgo(9));
  recordEntityMentions(db, ['Pair'], 'reddit', dayAgo(2));
  assert.equal(hasLore(db, 'Pair'), false);
});

test('mentions older than the window stop counting', () => {
  const db = freshDb();
  recordEntityMentions(db, ['Old'], 'reddit', dayAgo(LEDGER_WINDOW_DAYS + 5));
  recordEntityMentions(db, ['Old'], 'reddit', dayAgo(LEDGER_WINDOW_DAYS + 4));
  recordEntityMentions(db, ['Old'], 'reddit', dayAgo(LEDGER_WINDOW_DAYS + 3));
  assert.equal(hasLore(db, 'Old'), false);
});

test('stop-listed and too-short names are never recorded', () => {
  const db = freshDb();
  for (const junk of ['Bella', 'Luna', 'Max', 'ab', '', null]) {
    recordEntityMentions(db, [junk], 'reddit', dayAgo(1));
  }
  const rows = db.prepare('SELECT COUNT(*) c FROM entity_ledger').get();
  assert.equal(rows.c, 0);
});

test('lookup of an unknown name is false, not a crash', () => {
  assert.equal(hasLore(freshDb(), 'NeverSeen'), false);
});

test('thresholds are exported as constants for calibration', () => {
  assert.equal(LEDGER_MIN_MENTIONS, 3);
  assert.equal(LEDGER_MIN_DISTINCT_DAYS, 2);
  assert.equal(LEDGER_WINDOW_DAYS, 30);
});
