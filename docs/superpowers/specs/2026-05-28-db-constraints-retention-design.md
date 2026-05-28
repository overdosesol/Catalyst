# DB Constraints + Retention — Design Spec

**Date**: 2026-05-28
**Bundle**: #10 (Tier 3, scaling prep)
**Audit findings closed**: DB-005 (FK=ON), DB-007 (notifications UNIQUE compound), DB-008 (notifications retention), DB-009 (feedback_votes / x_analysis_history / tag_refresh_history retention)
**Bonus**: `busy_timeout=5000` (mentioned in INDEX summary; one-line addition next to FK pragma)
**Estimated effort**: ~3h

---

## 1. Goal

Three coupled DB integrity improvements + one retention pass:

1. **Enforce foreign key constraints** (DB-005) — `PRAGMA foreign_keys = ON`. Existing FK declarations in schema.sql are currently no-ops; CASCADE deletes are silently broken. We sweep orphans first (so PRAGMA flip doesn't reject existing rows on parent delete), then turn enforcement on.
2. **Prevent duplicate notifications** (DB-007 + PIPE-006 race) — `CREATE UNIQUE INDEX idx_notifications_dedup ON notifications(trend_id, channel, user_id)`. Dedup existing duplicates first. Switch `recordNotification` to `INSERT OR IGNORE`.
3. **Bound notifications growth** (DB-008) — daily prune at 30d.
4. **Bound 3 audit-style tables** (DB-009):
   - `feedback_votes` — 90d
   - `x_analysis_history` — 90d
   - `tag_refresh_history` — 365d (audit-log-ish, longer floor)

Bonus: `PRAGMA busy_timeout = 5000` — 5s wait on lock contention instead of immediate `SQLITE_BUSY`. One-line addition.

---

## 2. Architecture overview

```
src/db/
├── schema.sql            (+1 line: UNIQUE INDEX for fresh installs)
├── database.js           (+2 PRAGMA lines, +4 prune methods, +1 OR IGNORE)
scripts/
└── migrate-db-constraints-2026-05-28.sql  (NEW — operator runs on VPS before deploy)
src/
└── index.js              (+4 prune intervals, mirrored on Bundle #2 pattern)
ai-context/               (+1 SESSION_CONTEXT bullet, +1 WORKLOG entry)
```

Migration script is **operator-driven** (matches Bundle #2 + Bundle #16 deploy gate pattern). Runs once on VPS in a single transaction; idempotent on re-run.

---

## 3. Components

### 3.1 `scripts/migrate-db-constraints-2026-05-28.sql` (new file)

```sql
-- Bundle #10 — DB constraints + retention. Run BEFORE deploying the new code.
-- Idempotent: safe to re-run on already-migrated DBs (all DELETEs are no-ops
-- when 0 orphans exist; CREATE INDEX uses IF NOT EXISTS).
--
-- Required ORDER: this script must run BEFORE the new database.js with
-- foreign_keys=ON. Running it AFTER would attempt CASCADE side-effects.

BEGIN TRANSACTION;

-- 1. Orphan sweep (pre-FK=ON). Each DELETE is a no-op if 0 orphans.
DELETE FROM notifications        WHERE trend_id   NOT IN (SELECT id FROM trends);
DELETE FROM notifications        WHERE user_id IS NOT NULL AND user_id NOT IN (SELECT id FROM users);
DELETE FROM feedback_votes       WHERE trend_id   NOT IN (SELECT id FROM trends);
DELETE FROM hidden_trends        WHERE trend_id   NOT IN (SELECT id FROM trends);
DELETE FROM user_favorites       WHERE trend_id   NOT IN (SELECT id FROM trends);
DELETE FROM user_favorites       WHERE user_id    NOT IN (SELECT id FROM users);
DELETE FROM alert_score_history  WHERE trend_id   NOT IN (SELECT id FROM trends);
DELETE FROM x_analysis_history   WHERE trend_id   NOT IN (SELECT id FROM trends);
DELETE FROM broadcast_deliveries WHERE broadcast_id NOT IN (SELECT id FROM broadcasts);
DELETE FROM broadcast_deliveries WHERE user_id    NOT IN (SELECT id FROM users);
DELETE FROM payments             WHERE user_id    NOT IN (SELECT id FROM users);

-- 2. Notifications duplicate cleanup — keep oldest row per (trend_id, channel, user_id).
--    Required before UNIQUE INDEX or CREATE INDEX will fail with "UNIQUE constraint violation".
DELETE FROM notifications
WHERE id NOT IN (
  SELECT MIN(id) FROM notifications GROUP BY trend_id, channel, user_id
);

-- 3. UNIQUE compound index (closes DB-007 + PIPE-006 race window).
CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_dedup
  ON notifications(trend_id, channel, user_id);

COMMIT;

-- Verification queries (operator runs manually after the script):
--   SELECT COUNT(*) FROM notifications;
--   SELECT COUNT(*) FROM (SELECT 1 FROM notifications GROUP BY trend_id, channel, user_id HAVING COUNT(*)>1);  -- expect 0
--   PRAGMA foreign_key_check;  -- expect 0 rows
```

If the operator runs this and any `DELETE` reports a non-trivial count (>100 orphans for any table), investigate — that hints at code paths that should have been deleting cascadingly but weren't.

### 3.2 `src/db/schema.sql` — UNIQUE INDEX for fresh installs

Add after the existing notifications indexes (around lines 85-86):

```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_dedup
  ON notifications(trend_id, channel, user_id);
```

Duplicates the migration-script line — that's intentional. Fresh DBs apply schema.sql directly, never run the migration. `IF NOT EXISTS` makes the duplicate safe on already-migrated DBs.

### 3.3 `src/db/database.js` — PRAGMA + INSERT OR IGNORE + 4 prune methods

#### 3.3.1 Constructor PRAGMA additions (line 22-24)

```js
this.db = new Database(dbPath);
this.db.pragma('journal_mode = WAL');
this.db.pragma('foreign_keys = ON');    // Bundle #10 — DB-005
this.db.pragma('busy_timeout = 5000');  // Bundle #10 — 5s lock-wait
this._migrate();
```

Order: `foreign_keys` set BEFORE `_migrate()` so the schema apply runs with enforcement on. (Idempotent CREATE TABLEs and ALTER ADD COLUMNs don't violate FKs.)

#### 3.3.2 `recordNotification` — `INSERT OR IGNORE` (line 1501-1502)

```js
recordNotification(trendId, channel, userId = null) {
  this.db.prepare(`INSERT OR IGNORE INTO notifications (trend_id, channel, user_id) VALUES (?, ?, ?)`).run(trendId, channel, userId);
}
```

`OR IGNORE` makes a second insert with the same `(trend_id, channel, user_id)` a silent no-op instead of a constraint-violation throw. This is the correct semantics — sendmessage IS idempotent (duplicate alert detection upstream).

#### 3.3.3 Four new prune methods (add after `pruneFeatureUsageLog` from B2)

Real timestamp columns (verified from current CREATE TABLEs):

| Table | Column | Type |
|---|---|---|
| `notifications` | `sent_at` | `DATETIME DEFAULT CURRENT_TIMESTAMP` (schema.sql) |
| `feedback_votes` | `created_at` | `DATETIME DEFAULT CURRENT_TIMESTAMP` (database.js:131) |
| `x_analysis_history` | `at` | `DATETIME DEFAULT CURRENT_TIMESTAMP` (database.js:377) |
| `tag_refresh_history` | `ts` | `DATETIME DEFAULT CURRENT_TIMESTAMP` (database.js:396) |

```js
pruneNotifications(retentionDays = 30) {
  const res = this.db.prepare(
    `DELETE FROM notifications WHERE sent_at < datetime('now', ?)`
  ).run(`-${retentionDays} days`);
  return res.changes | 0;
}

pruneFeedbackVotes(retentionDays = 90) {
  const res = this.db.prepare(
    `DELETE FROM feedback_votes WHERE created_at < datetime('now', ?)`
  ).run(`-${retentionDays} days`);
  return res.changes | 0;
}

pruneXAnalysisHistory(retentionDays = 90) {
  const res = this.db.prepare(
    `DELETE FROM x_analysis_history WHERE at < datetime('now', ?)`
  ).run(`-${retentionDays} days`);
  return res.changes | 0;
}

pruneTagRefreshHistory(retentionDays = 365) {
  const res = this.db.prepare(
    `DELETE FROM tag_refresh_history WHERE ts < datetime('now', ?)`
  ).run(`-${retentionDays} days`);
  return res.changes | 0;
}
```

**Pattern note:** uses the same `datetime('now', ?)` + JS template-string parameter style as `pruneAlertDecisions` / `pruneFeatureUsageLog` from Bundle #2 (database.js:2541-2569). SQLite's `datetime('now', '-N days')` produces `'YYYY-MM-DD HH:MM:SS'` matching the `CURRENT_TIMESTAMP` format on timestamp columns — comparison is lexicographically correct. Avoids the `toISOString()` trap (CLAUDE.md gotcha).

### 3.4 `src/index.js` — 4 new prune intervals

Add after the Bundle #2 block (around line 129), following the same B2 pattern (startup call + daily setInterval, each wrapped in try/catch):

```js
// Bundle #10 (2026-05-28): retention for notifications + 3 audit-style tables.
// notifications        — 30d  (DB-008)
// feedback_votes       — 90d  (DB-009 — votes lose forecasting value after 3mo)
// x_analysis_history   — 90d  (DB-009 — X virality snapshots, debugging window)
// tag_refresh_history  — 365d (DB-009 — audit log of preset reloads, low write rate)
const NOTIFICATIONS_RETENTION_DAYS   =  30;
const FEEDBACK_VOTES_RETENTION_DAYS  =  90;
const X_ANALYSIS_RETENTION_DAYS      =  90;
const TAG_REFRESH_RETENTION_DAYS     = 365;

try {
  const n = db.pruneNotifications(NOTIFICATIONS_RETENTION_DAYS);
  if (n > 0) logger.info(`[Maintenance] notifications: pruned ${n} rows older than ${NOTIFICATIONS_RETENTION_DAYS}d`);
} catch (e) { logger.warn(`[Maintenance] notifications sweep failed: ${e.message}`); }
try {
  const n = db.pruneFeedbackVotes(FEEDBACK_VOTES_RETENTION_DAYS);
  if (n > 0) logger.info(`[Maintenance] feedback_votes: pruned ${n} rows older than ${FEEDBACK_VOTES_RETENTION_DAYS}d`);
} catch (e) { logger.warn(`[Maintenance] feedback_votes sweep failed: ${e.message}`); }
try {
  const n = db.pruneXAnalysisHistory(X_ANALYSIS_RETENTION_DAYS);
  if (n > 0) logger.info(`[Maintenance] x_analysis_history: pruned ${n} rows older than ${X_ANALYSIS_RETENTION_DAYS}d`);
} catch (e) { logger.warn(`[Maintenance] x_analysis_history sweep failed: ${e.message}`); }
try {
  const n = db.pruneTagRefreshHistory(TAG_REFRESH_RETENTION_DAYS);
  if (n > 0) logger.info(`[Maintenance] tag_refresh_history: pruned ${n} rows older than ${TAG_REFRESH_RETENTION_DAYS}d`);
} catch (e) { logger.warn(`[Maintenance] tag_refresh_history sweep failed: ${e.message}`); }

setInterval(() => {
  try { db.pruneNotifications(NOTIFICATIONS_RETENTION_DAYS); }
  catch (e) { logger.warn(`[Maintenance] notifications sweep failed: ${e.message}`); }
}, 24 * 60 * 60 * 1000);
setInterval(() => {
  try { db.pruneFeedbackVotes(FEEDBACK_VOTES_RETENTION_DAYS); }
  catch (e) { logger.warn(`[Maintenance] feedback_votes sweep failed: ${e.message}`); }
}, 24 * 60 * 60 * 1000);
setInterval(() => {
  try { db.pruneXAnalysisHistory(X_ANALYSIS_RETENTION_DAYS); }
  catch (e) { logger.warn(`[Maintenance] x_analysis_history sweep failed: ${e.message}`); }
}, 24 * 60 * 60 * 1000);
setInterval(() => {
  try { db.pruneTagRefreshHistory(TAG_REFRESH_RETENTION_DAYS); }
  catch (e) { logger.warn(`[Maintenance] tag_refresh_history sweep failed: ${e.message}`); }
}, 24 * 60 * 60 * 1000);
```

---

## 4. Deploy procedure

1. **Operator**: backup DB on VPS (already done by Bundle #1 cron — but optional manual `cp catalyst.db catalyst.db.pre-b10`).
2. **Operator**: run `sqlite3 catalyst.db < scripts/migrate-db-constraints-2026-05-28.sql` on VPS. Inspect:
   - `SELECT COUNT(*) FROM notifications;` (expect roughly same as before, minus duplicates)
   - `PRAGMA foreign_key_check;` (expect 0 rows — orphan sweep was thorough)
3. **Operator**: deploy via `deploy.ps1` (or `deploy.sh`).
4. **Operator**: tail logs — first startup will log prune counts.

If `PRAGMA foreign_key_check` returns rows after migration → bot will crash on first DELETE that touches those parent rows. STOP the deploy and investigate.

---

## 5. Risks

- **FK=ON breaks existing app behavior** if code somewhere does a parent delete that previously left orphans alive. Audit doesn't flag any such code path. We mitigate by running `PRAGMA foreign_key_check` post-migration. Worst case: revert by setting `foreign_keys = OFF` in constructor (no migration revert needed, orphans stay deleted).
- **busy_timeout=5000** — under heavy concurrent write contention, ops can now block up to 5s instead of immediately throwing `SQLITE_BUSY`. Net positive at current write volume (~few writes/sec). Will need revisit at 100+ writes/sec.
- **30d notifications retention** — at ~3M rows/year @ 100 users (audit projection), 30d window = ~250k rows. SQLite handles that easily. DELETE in one statement on indexed `sent_at` is fast (<100ms).
- **INSERT OR IGNORE silent dedup** — if some upstream caller relies on `recordNotification` throwing on duplicate, they break. Audit confirms no such callers. Behavior is the *intended* semantic: idempotent recording.
- **CASCADE side effects from FK=ON** — declared CASCADE rules (alert_score_history → trends) now actually trigger. This is desirable. Trends-deletion code paths should not need adjustment.

---

## 6. Testing strategy

### 6.1 Manual smoke (post-deploy)

After deploy:
- Wait one minute, check startup logs for 4 prune lines (each may report `0 rows` on first run — fine, no data older than the threshold yet).
- Trigger an alert pipeline (or wait for natural alert): confirm `recordNotification` works (no errors).
- Manually insert a duplicate notification via REPL: `db.prepare('INSERT OR IGNORE INTO notifications VALUES (?,?,?,?,?,?)').run(...).changes` should be `0` for a duplicate row.

### 6.2 No unit tests in this bundle

No test runner exists yet (Bundle #18). All verification = manual + `node --check` for parse.

### 6.3 SPA gate

Not applicable — none of the touched files carry inline SPA templates. `database.js`, `schema.sql`, `index.js` are backend-only.

---

## 7. Files changed (summary)

| File | Change |
|---|---|
| `scripts/migrate-db-constraints-2026-05-28.sql` | **NEW** — operator runs manually before deploy |
| `src/db/schema.sql` | +1 UNIQUE INDEX (fresh installs) |
| `src/db/database.js` | +2 PRAGMA lines, +4 prune methods, +1 `OR IGNORE` |
| `src/index.js` | +4 startup prune calls + 4 daily setInterval'ы |
| `ai-context/SESSION_CONTEXT.md` | +1 bullet under Production posture |
| `ai-context/WORKLOG.md` | +1 top entry |

No DB schema-changing ALTER beyond the migration script.

---

## 8. Acceptance criteria

- `scripts/migrate-db-constraints-2026-05-28.sql` exists, is idempotent, wrapped in a transaction, has verification queries in comments.
- `src/db/database.js` constructor sets both new PRAGMAs after WAL, before `_migrate()`.
- `recordNotification` uses `INSERT OR IGNORE`.
- Four prune methods exist on TrendDatabase with correct column references (`sent_at`, `created_at`, `at`, `ts`).
- `src/index.js` has 4 new startup calls + 4 new setInterval blocks following B2 pattern.
- `src/db/schema.sql` adds UNIQUE INDEX for fresh installs.
- `node --check` passes on all touched JS files.
- No SPA gate needed.

---

## 9. Deferred / out of scope

- VACUUM / log rotation / video cache cleanup (DB-010, DB-011, DB-014, PROD-019, ADM-004, DB-022/023) — these belong to Tier 3 Bundle #6 «Housekeeping + admin UI maintenance».
- Schema migration to add explicit `ON DELETE CASCADE` to FK declarations that don't have it — audit recommendation but not in this bundle's scope. Most FK consumers don't rely on cascade today.
- QA tests for prune methods — defer to Bundle #18 QA infra.
