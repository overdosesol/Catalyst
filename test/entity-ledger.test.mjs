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

// The 2026-08-10 prod snapshot: capybara had 20 mentions over 4 days and was
// promoting every capybara post into the narrative lane. It is a species.
test('species names never become entities, however many mentions they get', () => {
  const db = freshDb();
  for (const species of ['Capybara', 'Otter', 'Elephant', 'Bunny', 'Corgi', 'Seagull']) {
    recordEntityMentions(db, [species], 'reddit', dayAgo(5));
    recordEntityMentions(db, [species], 'reddit', dayAgo(3));
    recordEntityMentions(db, [species], 'twitter', dayAgo(1));
    assert.equal(hasLore(db, species), false, `${species} is a species, not a character`);
  }
  assert.equal(db.prepare('SELECT COUNT(*) c FROM entity_ledger').get().c, 0);
});

test('a plural is the same stop word as its singular', () => {
  const db = freshDb();
  recordEntityMentions(db, ['Capybaras', 'Otters', 'box turtles'], 'reddit', dayAgo(1));
  assert.equal(db.prepare('SELECT COUNT(*) c FROM entity_ledger').get().c, 0);
});

test('a species used as the head noun is still a species', () => {
  const db = freshDb();
  const compound = ['grizzly bear', 'chinstrap penguin', 'baby alpaca',
    'german shepherd', 'great blue heron', 'amur leopard'];
  recordEntityMentions(db, compound, 'reddit', dayAgo(1));
  assert.equal(db.prepare('SELECT COUNT(*) c FROM entity_ledger').get().c, 0);
});

test('real subjects survive the stop-list', () => {
  const db = freshDb();
  // chuck and tom holland were the only genuine promotions in the snapshot;
  // moo deng and pesto are the canonical animal characters this exists for.
  const real = ['Chuck', 'Tom Holland', 'Moo Deng', 'Pesto', 'Gus', 'Hagrid'];
  recordEntityMentions(db, real, 'reddit', dayAgo(1));
  assert.equal(db.prepare('SELECT COUNT(*) c FROM entity_ledger').get().c, real.length);
});

// The ledger is shared by every preset. An animal word that reads as a brand,
// a team or a surname elsewhere must stay recordable.
test('animal words that are also real subjects elsewhere are left alone', () => {
  const db = freshDb();
  const ambiguous = ['Black Panther', 'Puma', 'Jaguar', 'Falcon', 'Raven', 'Robin'];
  recordEntityMentions(db, ambiguous, 'twitter', dayAgo(1));
  assert.equal(db.prepare('SELECT COUNT(*) c FROM entity_ledger').get().c, ambiguous.length);
});

test('lookup of an unknown name is false, not a crash', () => {
  assert.equal(hasLore(freshDb(), 'NeverSeen'), false);
});

test('thresholds are exported as constants for calibration', () => {
  assert.equal(LEDGER_MIN_MENTIONS, 3);
  assert.equal(LEDGER_MIN_DISTINCT_DAYS, 2);
  assert.equal(LEDGER_WINDOW_DAYS, 30);
});
