# DB Constraints + Retention Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Operator policy (CLAUDE.md):** Subagents do NOT make git commits — file edits only. Operator commits the entire bundle once all tasks are done.

**Goal:** Enforce DB foreign keys (`PRAGMA foreign_keys=ON`), add a UNIQUE compound index on `notifications(trend_id, channel, user_id)`, switch `recordNotification` to `INSERT OR IGNORE`, add 4 daily retention prunes (notifications 30d, feedback_votes 90d, x_analysis_history 90d, tag_refresh_history 365d). Closes DB-005, DB-007, DB-008, DB-009 + bonus `busy_timeout=5000`.

**Architecture:** Operator-run SQL migration script (orphan sweep + notifications dedup + UNIQUE INDEX, transaction-wrapped, idempotent) — then code changes flip PRAGMA on in the DB constructor + add 4 prune methods + 4 daily setInterval'ы. Mirrors Bundle #2 + Bundle #16 deploy-gate pattern.

**Tech Stack:** Node.js (ESM, `"type": "module"`), better-sqlite3 ^12.8.0, no new deps. No new tables.

**Spec:** `docs/superpowers/specs/2026-05-28-db-constraints-retention-design.md`

---

## File structure

| File | Action | Responsibility |
|---|---|---|
| `scripts/migrate-db-constraints-2026-05-28.sql` | **CREATE** | Operator runs once on VPS: orphan sweep + notifications dedup + UNIQUE INDEX |
| `src/db/schema.sql` | MODIFY | +1 UNIQUE INDEX line for fresh installs (line ~86) |
| `src/db/database.js` | MODIFY | +2 PRAGMA (line ~23-24), +1 `OR IGNORE` (line ~1502), +4 prune methods (near pruneFeatureUsageLog ~line 2570) |
| `src/index.js` | MODIFY | +4 startup prune calls + 4 daily setInterval'ы (after Bundle #2 block ~line 129) |
| `ai-context/SESSION_CONTEXT.md` | MODIFY | +1 bullet in Production posture |
| `ai-context/WORKLOG.md` | MODIFY | +1 top entry |

No test files (no test runner yet). Verification = `node --check` for JS files + grep counts + manual SQL inspection.

---

## Task 1: Create migration SQL script

**Files:**
- Create: `scripts/migrate-db-constraints-2026-05-28.sql`

- [ ] **Step 1: Create the file with full SQL**

Path: `scripts/migrate-db-constraints-2026-05-28.sql`

Contents:

```sql
-- Bundle #10 — DB constraints + retention. Run BEFORE deploying the new code.
-- Idempotent: safe to re-run on already-migrated DBs (all DELETEs are no-ops
-- when 0 orphans exist; CREATE INDEX uses IF NOT EXISTS).
--
-- Required ORDER: this script must run BEFORE the new database.js with
-- foreign_keys=ON. Running it AFTER would trigger CASCADE side-effects.
--
-- Usage on VPS:
--   sqlite3 /path/to/catalyst.db < scripts/migrate-db-constraints-2026-05-28.sql

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

- [ ] **Step 2: Verify file exists and is well-formed**

Run: `ls -la scripts/migrate-db-constraints-2026-05-28.sql`
Expected: file exists, non-zero size.

- [ ] **Step 3: Sanity-check SQL with sqlite3 parser (dry run, no DB)**

Run:
```bash
sqlite3 :memory: ".read scripts/migrate-db-constraints-2026-05-28.sql"
```
Expected: errors about missing tables (`trends`, `users`, `notifications`, etc.) — that's fine, the in-memory DB has no schema. The point is that SQL syntax parses (no "syntax error" or "near ..." messages).

If you see actual SQL syntax errors (not "no such table") — fix the SQL.

- [ ] **Step 4: Report DONE — do not commit**

---

## Task 2: Add UNIQUE INDEX to schema.sql (fresh installs)

**Files:**
- Modify: `src/db/schema.sql` (around line 86)

- [ ] **Step 1: Locate notifications indexes**

Open `src/db/schema.sql`. Find these two existing lines (currently around lines 85-86):
```sql
CREATE INDEX IF NOT EXISTS idx_notifications_trend ON notifications(trend_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user  ON notifications(user_id);
```

- [ ] **Step 2: Add UNIQUE INDEX immediately after**

Insert a new line directly after `idx_notifications_user`:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_dedup ON notifications(trend_id, channel, user_id);
```

Final 3 lines (in order):
```sql
CREATE INDEX IF NOT EXISTS idx_notifications_trend ON notifications(trend_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user  ON notifications(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_dedup ON notifications(trend_id, channel, user_id);
```

- [ ] **Step 3: Verify**

Run:
```bash
grep -n "idx_notifications_dedup" src/db/schema.sql
```
Expected output: 1 line, around the line 87 area.

- [ ] **Step 4: Report DONE — do not commit**

---

## Task 3: PRAGMA additions + INSERT OR IGNORE in database.js

**Files:**
- Modify: `src/db/database.js` (lines 22-25, 1501-1502)

- [ ] **Step 1: Add 2 PRAGMA lines after WAL**

Open `src/db/database.js`. Find the constructor (around line 11-26). Currently lines 22-24 read:

```js
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this._migrate();
```

Replace those 3 lines with (inserting 2 new PRAGMA lines BETWEEN the WAL pragma and `_migrate`):

```js
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');    // Bundle #10 — DB-005: enforce FK declarations
    this.db.pragma('busy_timeout = 5000');  // Bundle #10 — 5s lock-wait on concurrent writes
    this._migrate();
```

Order: `foreign_keys` MUST be set BEFORE `_migrate()` so the schema apply runs with enforcement on. (CREATE TABLE IF NOT EXISTS and ALTER ADD COLUMN don't violate FKs.)

- [ ] **Step 2: Switch recordNotification to INSERT OR IGNORE**

Find `recordNotification` method (around line 1501). Currently:

```js
  recordNotification(trendId, channel, userId = null) {
    this.db.prepare(`INSERT INTO notifications (trend_id, channel, user_id) VALUES (?, ?, ?)`).run(trendId, channel, userId);
  }
```

Replace with:

```js
  recordNotification(trendId, channel, userId = null) {
    this.db.prepare(`INSERT OR IGNORE INTO notifications (trend_id, channel, user_id) VALUES (?, ?, ?)`).run(trendId, channel, userId);
  }
```

Only the SQL string changes: `INSERT INTO` → `INSERT OR IGNORE INTO`.

- [ ] **Step 3: Verify parse**

Run: `node --check src/db/database.js`
Expected: no output, exit code 0.

- [ ] **Step 4: Verify PRAGMA additions**

Run:
```bash
grep -n "foreign_keys = ON\|busy_timeout = 5000" src/db/database.js
```
Expected: 2 lines, both around line 24-25.

- [ ] **Step 5: Verify INSERT OR IGNORE**

Run:
```bash
grep -n "INSERT OR IGNORE INTO notifications" src/db/database.js
```
Expected: 1 line, around line 1502.

- [ ] **Step 6: Report DONE — do not commit**

---

## Task 4: Add 4 prune methods to database.js

**Files:**
- Modify: `src/db/database.js` (insert after `pruneFeatureUsageLog`, around line 2570)

- [ ] **Step 1: Locate insertion point**

Open `src/db/database.js`. Find `pruneFeatureUsageLog` method (around line 2558-2570). Just after its closing brace `}` (around line 2570), add 4 new methods:

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

**Critical**: column names are NOT all `created_at`:
- `notifications.sent_at` (schema.sql)
- `feedback_votes.created_at` (database.js:131)
- `x_analysis_history.at` (database.js:377) — short name, not `created_at`
- `tag_refresh_history.ts` (database.js:396) — short name, not `created_at`

Get these wrong and the DELETE will fail at runtime with "no such column".

- [ ] **Step 2: Verify parse**

Run: `node --check src/db/database.js`
Expected: no output, exit code 0.

- [ ] **Step 3: Verify all 4 methods are present**

Run:
```bash
grep -n "pruneNotifications\|pruneFeedbackVotes\|pruneXAnalysisHistory\|pruneTagRefreshHistory" src/db/database.js
```
Expected: 4 lines (one per method declaration).

- [ ] **Step 4: Verify correct column names in each query**

Run:
```bash
grep "sent_at < datetime\|created_at < datetime\|WHERE at < datetime\|WHERE ts < datetime" src/db/database.js | tail -8
```
Expected: 4 unique lines showing the column references in the 4 DELETE statements.

If any line says `pruneXAnalysisHistory` paired with `created_at` (wrong) or `pruneTagRefreshHistory` paired with `created_at` (wrong) — fix the column name.

- [ ] **Step 5: Report DONE — do not commit**

---

## Task 5: Add 4 retention intervals to index.js

**Files:**
- Modify: `src/index.js` (insert after Bundle #2 block, around line 129)

- [ ] **Step 1: Locate insertion point**

Open `src/index.js`. Find the Bundle #2 retention block — search for the comment line:
```js
// Bundle #2 (2026-06-07): retention cleanup for new observability tables.
```

That block ends with a `setInterval(...)` on `pruneFeatureUsageLog` (currently around line 128). The next line is `// ── Initialize Solana Pay Monitor ─...`. Insert the new block BETWEEN those (between line 128 and the Solana Monitor section).

- [ ] **Step 2: Add the new retention block**

Insert exactly this block:

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

- [ ] **Step 3: Verify parse**

Run: `node --check src/index.js`
Expected: no output, exit code 0.

- [ ] **Step 4: Verify all 4 retention constants**

Run:
```bash
grep "_RETENTION_DAYS" src/index.js | tail -8
```
Expected: at least 4 NEW constant declarations (in addition to the 2 from Bundle #2: `ALERT_DECISIONS_RETENTION_DAYS` and `FEATURE_USAGE_RETENTION_DAYS`).

- [ ] **Step 5: Verify 4 setInterval blocks added**

Run:
```bash
grep -c "24 \* 60 \* 60 \* 1000" src/index.js
```
Expected: count went UP by 4 (was N before Task 5, should be N+4 now).

- [ ] **Step 6: Report DONE — do not commit**

---

## Task 6: ai-context updates

**Files:**
- Modify: `ai-context/SESSION_CONTEXT.md` (Production posture section)
- Modify: `ai-context/WORKLOG.md` (new top entry)

- [ ] **Step 1: Add Production posture bullet to SESSION_CONTEXT.md**

Open `ai-context/SESSION_CONTEXT.md`. Find the existing Bundle #15 bullet (search for `Bundle #15`). Insert a new bullet IMMEDIATELY AFTER it:

```markdown
- **Bundle #10 (DB constraints + retention)** — `PRAGMA foreign_keys=ON` + `busy_timeout=5000` в `src/db/database.js` constructor. UNIQUE compound index `idx_notifications_dedup ON (trend_id, channel, user_id)` + `recordNotification` теперь `INSERT OR IGNORE`. 4 новых retention loop'a в `index.js`: notifications 30d, feedback_votes 90d, x_analysis_history 90d, tag_refresh_history 365d. Закрывает DB-005/007/008/009. Migration: `scripts/migrate-db-constraints-2026-05-28.sql` запускается оператором на VPS перед deploy.
```

If you can't find a "Bundle #15" bullet exactly — locate any Production posture section and append the bullet at its end. Report DONE_WITH_CONCERNS describing placement.

- [ ] **Step 2: Add WORKLOG entry on top**

Open `ai-context/WORKLOG.md`. The file header sits at the top; entries follow in reverse-chronological order (newest first). Insert a new entry BETWEEN the file header and the current top entry:

```markdown
## 2026-05-28 · sonnet · Bundle #10: DB constraints + retention — FK=ON + notifications UNIQUE + 4 prune loops

**Цель:** Закрыть DB-005 (FK enforcement), DB-007 (notifications duplicate race), DB-008 (notifications growth), DB-009 (3 audit-style tables retention).

**Файлы:**
- `scripts/migrate-db-constraints-2026-05-28.sql` (new) — idempotent: orphan sweep (11 tables) + notifications dedup + `CREATE UNIQUE INDEX idx_notifications_dedup`. Запускается оператором на VPS перед deploy через `sqlite3 catalyst.db < ...`. Транзакционно, можно re-run.
- `src/db/schema.sql` — +1 `CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_dedup` для fresh installs.
- `src/db/database.js` — constructor: +2 PRAGMA (`foreign_keys = ON`, `busy_timeout = 5000`). `recordNotification` → `INSERT OR IGNORE`. +4 prune methods (`pruneNotifications` 30d / `pruneFeedbackVotes` 90d / `pruneXAnalysisHistory` 90d / `pruneTagRefreshHistory` 365d).
- `src/index.js` — +4 startup prune calls + 4 daily setInterval'ы (по B2 паттерну).

**Деплой:** оператор-driven. Order: (1) backup DB, (2) `sqlite3 < migration.sql`, (3) `PRAGMA foreign_key_check` (expect 0), (4) `deploy.ps1`.

**Риски:** FK=ON может ломать existing parent-delete code paths если orphans есть. Migration sweep'ит orphans перед PRAGMA flip. `busy_timeout=5000` — concurrent writes теперь блокируются до 5с вместо immediate `SQLITE_BUSY` (net positive при текущем write volume).

**Не сделано:** VACUUM/log rotation/video cache cleanup (Tier 3 #6). Explicit `ON DELETE CASCADE` дополнения на FK без cascade — out of scope. Unit tests prune-методов — defer to B18 QA infra.
```

- [ ] **Step 3: Verify**

Run:
```bash
grep -c "Bundle #10" ai-context/SESSION_CONTEXT.md
grep -c "Bundle #10" ai-context/WORKLOG.md
grep -c "^## 2026" ai-context/WORKLOG.md
```

Expected:
- SESSION_CONTEXT: ≥1
- WORKLOG: ≥1
- WORKLOG entry count: 12 (was 11 after B15, +1)

If WORKLOG count is at 13+ — soft cap (12) hit. Don't auto-rotate. Just report DONE_WITH_CONCERNS noting "WORKLOG at N entries, rotation recommended per AGENT_RULES §6". Operator decides.

- [ ] **Step 4: Report DONE — do not commit**

Operator commits the whole bundle later (6 files: 1 new SQL + 4 modified src + 1 schema.sql + 2 ai-context).

---

## Final verification (run after all 6 tasks)

- [ ] **Combined parse check**

Run:
```bash
node --check src/db/database.js && node --check src/index.js
```
Expected: both succeed, no output, exit code 0.

- [ ] **SQL sanity**

Run:
```bash
sqlite3 :memory: ".read scripts/migrate-db-constraints-2026-05-28.sql"
```
Expected: errors about missing tables only ("no such table: trends" etc.). No "syntax error" messages.

- [ ] **Bundle summary check**

Run:
```bash
grep -n "Bundle #10" src/db/database.js src/db/schema.sql src/index.js scripts/migrate-db-constraints-2026-05-28.sql ai-context/*.md
```
Expected: at least 4 lines (one per source file + ai-context files). Bundle #10 marker present in all touched files.

- [ ] **Working tree summary**

Run: `git status --short`
Expected: 1 new file (`scripts/migrate-db-constraints-2026-05-28.sql`), 5 modified files. Plus 2 docs (spec + plan) if not yet committed.

If anything mismatches — re-check the failing task before reporting bundle complete.

---

## Post-implementation: operator deploy procedure

Operator runs (NOT a subagent task):

1. Backup DB:
   ```bash
   ssh vps "cp /path/to/catalyst.db /path/to/catalyst.db.pre-b10-$(date +%Y%m%d)"
   ```
2. Run migration:
   ```bash
   ssh vps "sqlite3 /path/to/catalyst.db < /path/to/migrate-db-constraints-2026-05-28.sql"
   ```
   (Or upload script then run — depends on deploy.ps1 rsync flow.)
3. Verify:
   ```bash
   ssh vps "sqlite3 /path/to/catalyst.db 'PRAGMA foreign_key_check;'"
   ```
   Expected: zero rows. If rows returned — STOP, investigate orphans before deploy.
4. Deploy:
   ```powershell
   .\deploy.ps1
   ```
5. Tail logs — first startup should log 4 prune lines (each may be `0 rows` on first run).

If logs show errors about `foreign_keys=ON` or `no such column` after deploy — bot will likely crash. Have backup ready to rollback.
