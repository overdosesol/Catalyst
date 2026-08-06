/**
 * Entity ledger — lore detection from our own database, at zero cost.
 *
 * The case this exists for: a photo of a capybara with no caption. The post
 * carries no story, but the SUBJECT has one — and we already know that,
 * because the name has been passing through our pipeline for weeks.
 *
 * Names arrive from Stage 0b (`subjectNames`) and Stage 1 (`subjectName`).
 * Crucially `save_only` trends are persisted WITH their PreStage data, so
 * names accumulate even from posts that were never scored.
 *
 * Not Stage 2: that one verifies live spread over x_search, costs money, is
 * capped at 3 calls, and is gated behind `memePotential >= threshold` — an
 * underrated post never reaches it. This runs before scoring, for everything.
 */

export const LEDGER_MIN_MENTIONS      = 3;   // two mentions are coincidence
export const LEDGER_MIN_DISTINCT_DAYS = 2;   // the load-bearing one: spread over time
export const LEDGER_WINDOW_DAYS       = 30;  // animal characters run for months
const MIN_NAME_LENGTH = 3;

/**
 * Common pet names and generic words that would otherwise fuse unrelated
 * posts into one fake entity. Grow this by observation, not by imagination.
 */
const STOP_NAMES = new Set([
  'bella', 'luna', 'max', 'charlie', 'lucy', 'daisy', 'buddy', 'milo', 'coco',
  'dog', 'cat', 'puppy', 'kitten', 'animal', 'pet', 'baby',
  'tiktok', 'reddit', 'twitter', 'youtube', 'instagram',
]);

export function normalizeEntityName(raw) {
  return String(raw ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isRecordable(normalized) {
  return normalized.length >= MIN_NAME_LENGTH && !STOP_NAMES.has(normalized);
}

/** Idempotent — called from _migrate() on every boot. */
export function createEntityLedgerSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS entity_ledger (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL,
      source      TEXT,
      seen_at     TEXT NOT NULL,
      seen_day    TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_entity_ledger_name ON entity_ledger(name, seen_at);
  `);
}

export function recordEntityMentions(db, names, source, seenAtIso = new Date().toISOString()) {
  if (!Array.isArray(names) || names.length === 0) return 0;
  const stmt = db.prepare(
    `INSERT INTO entity_ledger (name, source, seen_at, seen_day) VALUES (?, ?, ?, ?)`
  );
  let written = 0;
  for (const raw of names) {
    const name = normalizeEntityName(raw);
    if (!isRecordable(name)) continue;
    stmt.run(name, String(source || 'unknown'), seenAtIso, seenAtIso.slice(0, 10));
    written++;
  }
  return written;
}

/**
 * Lore = enough mentions, spread over enough distinct days, inside the window.
 *
 * Distinct days matter more than raw count: three mentions in one afternoon
 * are one burst; three mentions across three weeks are an accumulated story.
 *
 * NB: `seen_at` is written as a full ISO string here, never as a SQLite
 * CURRENT_TIMESTAMP value — so the lexicographic comparison below is safe.
 * Mixing the two formats is the classic trap in this codebase (space < 'T');
 * if this column ever gains a DEFAULT CURRENT_TIMESTAMP, use sqliteCutoff().
 */
export function hasLore(db, rawName) {
  const name = normalizeEntityName(rawName);
  if (!isRecordable(name)) return false;

  const cutoff = new Date(Date.now() - LEDGER_WINDOW_DAYS * 86_400_000).toISOString();
  const row = db.prepare(`
    SELECT COUNT(*) AS mentions, COUNT(DISTINCT seen_day) AS days
    FROM entity_ledger
    WHERE name = ? AND seen_at >= ?
  `).get(name, cutoff);

  return (row?.mentions ?? 0) >= LEDGER_MIN_MENTIONS
      && (row?.days ?? 0)     >= LEDGER_MIN_DISTINCT_DAYS;
}
