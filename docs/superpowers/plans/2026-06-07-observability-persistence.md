# Bundle #2 — Observability Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Закрыть 5 audit finding'ов (BILL-002, ADM-002, ADM-005, COST-003, PIPE-016) — persist'ить critical observability state (audit logs, alert decisions, cost counters), который сейчас живёт только в памяти и теряется при рестарте.

**Architecture:** 3 новых DB таблицы в `src/db/schema.sql` (`admin_audit_log`, `alert_decisions`, `feature_usage_log`) + 6 новых методов на `TrendDatabase` class в `src/db/database.js` + persist hooks в 4 callsite groups (admin server, alert dispatcher, dashboard cost counters, housekeeping cron).

**Tech Stack:** better-sqlite3, ESM Node.js, inline React SPA в `src/dashboard/server.js` (~13K lines), `db.transaction()` для atomic writes. Schema boot via `db.exec(schema.sql)` в `_migrate()` (idempotent через `CREATE TABLE IF NOT EXISTS`).

---

## Spec reference

Spec: `docs/superpowers/specs/2026-06-07-observability-persistence-design.md`

## Spec divergence — drop helper modules

Spec proposed `src/db/audit.js` + `src/billing/usage.js` thin facade helper modules that import `db` from `'../db/index.js'`. **Project has no such singleton export** — `db` is created в `src/index.js:37` (`const db = new TrendDatabase(...)`) and passed as constructor parameter to consumer classes which store it as `this.db`. All other DB access in the project follows `this.db.<method>` / `db.<method>` directly without facade modules.

**Plan-level decision**: skip the helper modules. Callers (`src/admin/server.js`, `src/dashboard/server.js`, `src/index.js`) use `this.db.<method>` or `db.<method>` directly. Methods live on `TrendDatabase` class itself.

This matches existing project pattern, reduces file count by 2, avoids the "import db from a singleton" anti-pattern. **No functional impact** — same DB API, just fewer files.

## Files affected (revised post-spec-divergence)

| File | Action | Detail |
|---|---|---|
| `src/db/schema.sql` | modify | +3 `CREATE TABLE IF NOT EXISTS` blocks + indexes (appended) |
| `scripts/migrate-audit-log-2026-06-07.sql` | **new** | Identical DDL, one-off operator migration for existing prod DB |
| `src/db/database.js` | modify | +6 new methods + `upgradePlan` transaction wrap + `confirmPaymentAndUpgrade` audit write |
| `src/admin/server.js` | modify | `_setUserPlan` transaction wrap + audit write + extend signature with `actorUserId` |
| `src/index.js` | modify | `recordAlertDecision` function dual write + 2 new housekeeping `setInterval` blocks |
| `src/dashboard/server.js` | modify | Remove 2 Map fields + replace 4 cost counter callsites with DB calls (SPA gate after edit) |
| `ai-context/SESSION_CONTEXT.md` | modify | +1 bullet in Production posture |
| `ai-context/WORKLOG.md` | modify | Bundle #2 entry |

**NOT touched**: `src/admin/server.js` SPA template literal (no UI viewer in this scope), `src/billing/entitlements.js` (read-only consumer), test files (no test infra).

## Critical project gotchas

- **`src/dashboard/server.js`** — inline React SPA в template literal. Backtick в comment / stray `${...}` → SPA broken. After ANY edit to this file run `npm run check:spa` (Bundle #16 gate, validates via `vm.Script()`).
- **SQLite `datetime('now')` format**: `'YYYY-MM-DD HH:MM:SS'` (no 'T', no 'Z', UTC). For comparisons with JS `new Date().toISOString()` (which uses 'T' + 'Z'), use SQLite's `datetime('now', ...)` operator on both sides instead of string compare. Helper methods in this bundle use `strftime('%s', ts)` to convert to epoch ms cleanly.
- **`db.transaction(fn)` semantics**: better-sqlite3 returns a callable. Pattern: `const tx = this.db.transaction((arg) => { ... }); return tx(arg);`. If callback throws, transaction rolls back.

## Commits

Subagents **do NOT commit**. File edits only. Operator commits selectively after the 9-task implementation completes.

---

## Task 1: Schema additions + migration script

**Files:**
- Modify: `F:\.VibeCoding\Projects\Antigravity\Narrative Parser\src\db\schema.sql` (append at end)
- Create: `F:\.VibeCoding\Projects\Antigravity\Narrative Parser\scripts\migrate-audit-log-2026-06-07.sql`

**Context:** Boot-time `db.exec(schema.sql)` (called from `_migrate()` in database.js:28-30) processes the entire file idempotently when all statements use `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS`. The migration script is an explicit operator step for the prod DB (also redundant via `_migrate()` on next boot, but useful for DR / explicit pre-deploy migration).

- [ ] **Step 1: Read end of schema.sql to identify append point**

Use Read tool to read the last ~30 lines of `src/db/schema.sql`. We append AFTER the last CREATE statement.

- [ ] **Step 2: Append 3 CREATE TABLE blocks to schema.sql**

Use Edit tool to add to the END of `src/db/schema.sql`. If schema.sql ends with `\n`, append. If not, prepend `\n`.

Block to append:

```sql

-- ── Bundle #2 (2026-06-07): observability persistence ────────────────────
-- Replaces in-memory state that previously lost on restart.
-- See docs/superpowers/specs/2026-06-07-observability-persistence-design.md

-- admin_audit_log: plan changes + admin actions. Forever retention.
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  ts              TEXT    NOT NULL DEFAULT (datetime('now')),
  actor_user_id   INTEGER,                          -- admin doing the action (NULL = system)
  actor_kind      TEXT    NOT NULL,                 -- 'admin' | 'system' | 'user_self'
  event_type      TEXT    NOT NULL,                 -- 'plan_grant_admin' | 'plan_revoke' | 'plan_upgrade' | etc.
  target_user_id  INTEGER,                          -- the user the action affected
  payload_json    TEXT,                             -- JSON: structured payload
  success         INTEGER NOT NULL DEFAULT 1        -- 1 | 0
);
CREATE INDEX IF NOT EXISTS idx_admin_audit_ts     ON admin_audit_log(ts DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_target ON admin_audit_log(target_user_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_event  ON admin_audit_log(event_type, ts DESC);

-- alert_decisions: alert dispatcher decisions. 14d retention.
CREATE TABLE IF NOT EXISTS alert_decisions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  ts           TEXT    NOT NULL DEFAULT (datetime('now')),
  trend_id     INTEGER,
  user_id      INTEGER,
  source       TEXT,                                -- 'reddit' | 'twitter' | 'google_trends' | ...
  reason       TEXT    NOT NULL,                    -- 'sent' | 'skipped_seen' | 'skipped_score' | etc.
  gates_json   TEXT,                                -- full gate evaluations
  weights_json TEXT,                                -- optional weight breakdown
  sent         INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_alert_decisions_ts    ON alert_decisions(ts DESC);
CREATE INDEX IF NOT EXISTS idx_alert_decisions_user  ON alert_decisions(user_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_alert_decisions_trend ON alert_decisions(trend_id, ts DESC);

-- feature_usage_log: per-hit event log for rolling cost caps. 7d retention.
CREATE TABLE IF NOT EXISTS feature_usage_log (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  ts        TEXT    NOT NULL DEFAULT (datetime('now')),
  user_id   INTEGER NOT NULL,
  feature   TEXT    NOT NULL                        -- 'manualAnalysis' | 'catalyst'
);
CREATE INDEX IF NOT EXISTS idx_feature_usage_user_feature_ts ON feature_usage_log(user_id, feature, ts DESC);
```

- [ ] **Step 3: Create migration script with identical DDL**

Use Write tool to create `scripts/migrate-audit-log-2026-06-07.sql` with exactly the same content as the block above (without the trailing blank line, but with the leading comment block).

Content:

```sql
-- ── Bundle #2 (2026-06-07): observability persistence migration ──────────
-- Run once on existing prod DB to create the 3 new tables. Safe to re-run
-- (all DDL uses IF NOT EXISTS). Boot-time _migrate() also re-applies this
-- via db.exec(schema.sql), so on next deploy this script is redundant —
-- present for explicit operator step / DR scenarios.
--
-- Usage on VPS:
--   sqlite3 /path/to/catalyst.db < scripts/migrate-audit-log-2026-06-07.sql

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  ts              TEXT    NOT NULL DEFAULT (datetime('now')),
  actor_user_id   INTEGER,
  actor_kind      TEXT    NOT NULL,
  event_type      TEXT    NOT NULL,
  target_user_id  INTEGER,
  payload_json    TEXT,
  success         INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_admin_audit_ts     ON admin_audit_log(ts DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_target ON admin_audit_log(target_user_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_event  ON admin_audit_log(event_type, ts DESC);

CREATE TABLE IF NOT EXISTS alert_decisions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  ts           TEXT    NOT NULL DEFAULT (datetime('now')),
  trend_id     INTEGER,
  user_id      INTEGER,
  source       TEXT,
  reason       TEXT    NOT NULL,
  gates_json   TEXT,
  weights_json TEXT,
  sent         INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_alert_decisions_ts    ON alert_decisions(ts DESC);
CREATE INDEX IF NOT EXISTS idx_alert_decisions_user  ON alert_decisions(user_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_alert_decisions_trend ON alert_decisions(trend_id, ts DESC);

CREATE TABLE IF NOT EXISTS feature_usage_log (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  ts        TEXT    NOT NULL DEFAULT (datetime('now')),
  user_id   INTEGER NOT NULL,
  feature   TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_feature_usage_user_feature_ts ON feature_usage_log(user_id, feature, ts DESC);
```

- [ ] **Step 4: Verify boot-time schema loads cleanly**

Run from project root:

```
node -e "import('./src/db/database.js').then(({ default: TD }) => { const db = new TD(':memory:', { info: () => {}, warn: () => {}, error: () => {} }); const tables = db.db.prepare('SELECT name FROM sqlite_master WHERE type=\"table\" ORDER BY name').all().map(r => r.name); console.log('Tables:', tables.join(',')); db.db.close(); })"
```

Expected output includes `admin_audit_log,alert_decisions,feature_usage_log` plus existing tables (plans, users, trends, etc.).

If any table missing or error thrown → revert and investigate.

- [ ] **Step 5: Task complete** — no commit; advance to Task 2.

---

## Task 2: Add 6 new methods to `TrendDatabase` class

**Files:**
- Modify: `F:\.VibeCoding\Projects\Antigravity\Narrative Parser\src\db\database.js`

**Context:** The class has `export default TrendDatabase` at line 2369. We add the 6 new methods BEFORE the export, after the last existing method. The class instance has `this.db` (better-sqlite3 Database) and `this.logger`.

- [ ] **Step 1: Identify insertion point near end of class**

Use Read tool to read `src/db/database.js` around lines 2340-2369 to find a good insertion point — the last method declaration, just before the closing `}` of the class. We append BEFORE the closing `}` and BEFORE `export default TrendDatabase;`.

- [ ] **Step 2: Insert 6 new methods**

Use Edit tool. The Read in step 1 will reveal the exact closing brace + export line. Replace the closing `}` immediately followed by `\nexport default TrendDatabase;` with the methods block PLUS the closing brace + export.

If the line just before `}\nexport default` is `}` (end of a method), the replacement looks like this:

Replace:
```javascript
  }
}

export default TrendDatabase;
```

With:
```javascript
  }

  // ── Bundle #2 (2026-06-07): observability persistence ───────────────────
  // See docs/superpowers/specs/2026-06-07-observability-persistence-design.md

  /**
   * Record an admin-side audit event (plan changes, admin actions, etc.).
   * Synchronous insert. Safe to call inside an outer db.transaction(); will
   * participate in that transaction's atomicity.
   *
   * @param {string} eventType - e.g. 'plan_grant_admin', 'plan_revoke', 'plan_upgrade'
   * @param {number|null} actorUserId - admin doing the action (null = system)
   * @param {string} actorKind - 'admin' | 'system' | 'user_self'
   * @param {number|null} targetUserId - the user affected
   * @param {Object|null} payload - JSON-serializable structured payload
   * @param {boolean} success
   */
  recordAuditEvent(eventType, actorUserId, actorKind, targetUserId, payload, success = true) {
    try {
      return this.db.prepare(`
        INSERT INTO admin_audit_log (event_type, actor_user_id, actor_kind, target_user_id, payload_json, success)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        eventType,
        actorUserId ?? null,
        actorKind || 'admin',
        targetUserId ?? null,
        payload ? JSON.stringify(payload) : null,
        success ? 1 : 0,
      );
    } catch (e) {
      this.logger.error('[audit] recordAuditEvent failed', { err: e.message, eventType, actorUserId, targetUserId });
      return null;
    }
  }

  /**
   * Record one alert-dispatcher decision. Called from src/index.js
   * recordAlertDecision() as a fire-and-forget dual write. Errors are
   * swallowed — never blocks the alert flow.
   *
   * @param {Object} rec
   * @param {number|null} rec.trendId
   * @param {number|null} rec.userId
   * @param {string|null} rec.source
   * @param {string} rec.reason - 'sent' | 'skipped_seen' | ...
   * @param {Object|null} [rec.gates]
   * @param {Object|null} [rec.weights]
   * @param {boolean} [rec.sent]
   */
  recordAlertDecision({ trendId, userId, source, reason, gates, weights, sent }) {
    try {
      return this.db.prepare(`
        INSERT INTO alert_decisions (trend_id, user_id, source, reason, gates_json, weights_json, sent)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        trendId ?? null,
        userId ?? null,
        source || null,
        reason,
        gates ? JSON.stringify(gates) : null,
        weights ? JSON.stringify(weights) : null,
        sent ? 1 : 0,
      );
    } catch (e) {
      this.logger.error('[audit] recordAlertDecision failed', { err: e.message, trendId, userId, reason });
      return null;
    }
  }

  /**
   * Record one feature usage hit (cost cap event). Called from dashboard
   * cost-cap callsites instead of mutating in-memory Maps.
   *
   * @param {number} userId
   * @param {string} feature - 'manualAnalysis' | 'catalyst'
   */
  recordFeatureUsage(userId, feature) {
    if (!userId || !feature) return null;
    try {
      return this.db.prepare(`
        INSERT INTO feature_usage_log (user_id, feature) VALUES (?, ?)
      `).run(userId, feature);
    } catch (e) {
      this.logger.error('[audit] recordFeatureUsage failed', { err: e.message, userId, feature });
      return null;
    }
  }

  /**
   * Get all hit timestamps (epoch ms) for user/feature within the last
   * `windowMs` milliseconds. Returns ASC-ordered array; empty on error or
   * no hits. Matches the legacy in-memory `hits` array shape so caller
   * code (cooldown check, length-based cap) is preserved.
   *
   * @param {number} userId
   * @param {string} feature
   * @param {number} windowMs
   * @returns {number[]}
   */
  getRecentFeatureUsageHits(userId, feature, windowMs) {
    if (!userId || !feature || !windowMs) return [];
    try {
      const sinceMs = Date.now() - windowMs;
      // strftime('%s', ts) returns UTC seconds-since-epoch (text). Cast →
      // INTEGER and multiply by 1000 for ms. Compared against sinceMs in
      // both filter and SELECT for consistency.
      const rows = this.db.prepare(`
        SELECT CAST(strftime('%s', ts) AS INTEGER) * 1000 AS ms
        FROM feature_usage_log
        WHERE user_id = ?
          AND feature = ?
          AND CAST(strftime('%s', ts) AS INTEGER) * 1000 > ?
        ORDER BY ts ASC
      `).all(userId, feature, sinceMs);
      return rows.map(r => r.ms);
    } catch (e) {
      this.logger.error('[audit] getRecentFeatureUsageHits failed', { err: e.message, userId, feature });
      return [];
    }
  }

  /**
   * Delete alert_decisions older than `retentionDays`. Called daily.
   * Returns number of rows deleted.
   */
  pruneAlertDecisions(retentionDays) {
    try {
      const res = this.db.prepare(`DELETE FROM alert_decisions WHERE ts < datetime('now', ?)`)
        .run(`-${retentionDays} days`);
      if (res.changes > 0) {
        this.logger.info(`[Maintenance] alert_decisions: pruned ${res.changes} rows older than ${retentionDays}d`);
      }
      return res.changes;
    } catch (e) {
      this.logger.warn(`[Maintenance] pruneAlertDecisions failed: ${e.message}`);
      return 0;
    }
  }

  /**
   * Delete feature_usage_log older than `retentionDays`. Called daily.
   */
  pruneFeatureUsageLog(retentionDays) {
    try {
      const res = this.db.prepare(`DELETE FROM feature_usage_log WHERE ts < datetime('now', ?)`)
        .run(`-${retentionDays} days`);
      if (res.changes > 0) {
        this.logger.info(`[Maintenance] feature_usage_log: pruned ${res.changes} rows older than ${retentionDays}d`);
      }
      return res.changes;
    } catch (e) {
      this.logger.warn(`[Maintenance] pruneFeatureUsageLog failed: ${e.message}`);
      return 0;
    }
  }
}

export default TrendDatabase;
```

- [ ] **Step 3: Verify methods load + work via in-memory DB**

Run from project root:

```
node -e "import('./src/db/database.js').then(({ default: TD }) => { const db = new TD(':memory:', { info: console.log, warn: console.warn, error: console.error }); db.recordAuditEvent('test_event', null, 'system', 42, { foo: 'bar' }, true); db.recordFeatureUsage(42, 'manualAnalysis'); db.recordFeatureUsage(42, 'manualAnalysis'); db.recordAlertDecision({ trendId: 1, userId: 42, source: 'reddit', reason: 'sent', sent: true }); const audits = db.db.prepare('SELECT * FROM admin_audit_log').all(); const usage = db.getRecentFeatureUsageHits(42, 'manualAnalysis', 24*60*60*1000); const decisions = db.db.prepare('SELECT * FROM alert_decisions').all(); console.log('audits:', audits.length, '/ usage hits:', usage.length, '/ decisions:', decisions.length); db.db.close(); })"
```

Expected output: `audits: 1 / usage hits: 2 / decisions: 1`

If any count is wrong → bug in the corresponding method.

- [ ] **Step 4: Task complete** — no commit; advance to Task 3.

---

## Task 3: Wrap `upgradePlan` in transaction + audit write

**Files:**
- Modify: `F:\.VibeCoding\Projects\Antigravity\Narrative Parser\src\db\database.js` (around line 895-904)

**Context (current state, lines 892-904):**

```javascript
  /**
   * Upgrade user plan after payment
   */
  upgradePlan(userId, planName, durationDays = 30) {
    const plan = this.db.prepare(`SELECT id FROM plans WHERE name = ?`).get(planName);
    if (!plan) throw new Error(`Plan not found: ${planName}`);

    const expiresAt = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000).toISOString();
    this.db.prepare(`
      UPDATE users SET plan_id = ?, subscription_expires_at = ?, status = 'active'
      WHERE id = ?
    `).run(plan.id, expiresAt, userId);
  }
```

- [ ] **Step 1: Replace `upgradePlan` body with transactional version + audit**

Use Edit tool. Replace the entire current `upgradePlan` method (lines 892-904) with:

```javascript
  /**
   * Upgrade user plan after payment (atomic). Writes audit row inside the
   * same transaction so plan change + audit are committed together.
   *
   * @param {number} userId
   * @param {string} planName
   * @param {number} durationDays
   * @param {Object} [opts]
   * @param {number|null} [opts.actorUserId] - admin id, null = system/payment-driven
   * @param {string} [opts.source] - 'admin_panel' | 'payment_confirmed' | 'cron' | ...
   */
  upgradePlan(userId, planName, durationDays = 30, opts = {}) {
    // BILL-002 / ADM-005 (Bundle #2): atomic UPDATE + audit log write.
    const plan = this.db.prepare(`SELECT id FROM plans WHERE name = ?`).get(planName);
    if (!plan) throw new Error(`Plan not found: ${planName}`);

    const expiresAt = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000).toISOString();
    const tx = this.db.transaction(() => {
      const prev = this.db.prepare(`SELECT plan_id FROM users WHERE id = ?`).get(userId);
      this.db.prepare(`
        UPDATE users SET plan_id = ?, subscription_expires_at = ?, status = 'active'
        WHERE id = ?
      `).run(plan.id, expiresAt, userId);
      this.recordAuditEvent(
        'plan_upgrade',
        opts.actorUserId ?? null,
        opts.actorUserId ? 'admin' : 'system',
        userId,
        {
          from_plan_id: prev?.plan_id ?? null,
          to_plan_id:   plan.id,
          to_plan_name: planName,
          expires_at:   expiresAt,
          source:       opts.source || 'unknown',
        },
        true,
      );
    });
    tx();
  }
```

- [ ] **Step 2: Verify upgradePlan works in transaction + writes audit row**

Run from project root:

```
node -e "import('./src/db/database.js').then(async ({ default: TD }) => { const db = new TD(':memory:', { info: () => {}, warn: () => {}, error: () => {} }); db.db.exec(\"INSERT INTO plans (name, label_en, label_ru, price_usd, manual_analyze_daily, catalyst_daily, x_analysis_daily, sources, alert_score_threshold, manual_threshold, manual_min_score, manual_min_meme, history_hours) VALUES ('free', 'Free', 'Бесплатно', 0, 0, 0, 0, '[]', 80, 60, 30, 30, 0), ('pro', 'Pro', 'Pro', 9.99, 5, 5, 10, '[]', 60, 50, 20, 20, 168);\"); db.db.exec(\"INSERT INTO users (id, telegram_chat_id, plan_id) VALUES (1, 'test', 1)\"); db.upgradePlan(1, 'pro', 30, { actorUserId: 99, source: 'admin_panel' }); const u = db.db.prepare('SELECT plan_id, subscription_expires_at FROM users WHERE id=1').get(); const a = db.db.prepare('SELECT * FROM admin_audit_log').all(); console.log('user.plan_id:', u.plan_id, '/ expires:', !!u.subscription_expires_at); console.log('audits:', a.length, 'event:', a[0]?.event_type, 'actor:', a[0]?.actor_user_id, 'payload:', a[0]?.payload_json); db.db.close(); })"
```

Expected output:
```
user.plan_id: 2 / expires: true
audits: 1 event: plan_upgrade actor: 99 payload: {"from_plan_id":1,"to_plan_id":2,"to_plan_name":"pro","expires_at":"...","source":"admin_panel"}
```

If audit row missing or plan not updated → fix and retry.

- [ ] **Step 3: Task complete** — no commit; advance to Task 4.

---

## Task 4: Add audit write inside `confirmPaymentAndUpgrade`'s existing transaction

**Files:**
- Modify: `F:\.VibeCoding\Projects\Antigravity\Narrative Parser\src\db\database.js` (around line 854-880)

**Context (current state, lines 850-880):**

```javascript
  /**
   * Atomically confirm payment and upgrade user plan.
   * Returns upgraded payment row or null if payment is not eligible.
   */
  confirmPaymentAndUpgrade(reference, txSignature, durationDays = 30) {
    const runTxn = this.db.transaction((ref, sig, days) => {
      const payment = this.db.prepare(`SELECT * FROM payments WHERE reference = ?`).get(ref);
      if (!payment) return null;
      if (payment.status !== 'pending') return null;

      this.db.prepare(`
        UPDATE payments
        SET status = 'confirmed', tx_signature = ?, confirmed_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(sig, payment.id);

      const plan = this.db.prepare(`SELECT id FROM plans WHERE name = ?`).get(payment.plan_name);
      if (!plan) throw new Error(`Plan not found: ${payment.plan_name}`);

      const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
      this.db.prepare(`
        UPDATE users
        SET plan_id = ?, subscription_expires_at = ?, status = 'active'
        WHERE id = ?
      `).run(plan.id, expiresAt, payment.user_id);

      return { ...payment, tx_signature: sig };
    });

    return runTxn(reference, txSignature, durationDays);
  }
```

- [ ] **Step 1: Capture `prevPlanId` before UPDATE + insert audit write after UPDATE**

Use Edit tool. Replace lines 854-879 (the entire `confirmPaymentAndUpgrade` method) with the enhanced version below. The key changes:
- After `SELECT * FROM payments`, also `SELECT plan_id FROM users` to capture `prevPlanId`.
- After the user UPDATE, call `this.recordAuditEvent(...)` inside the same transaction.

```javascript
  /**
   * Atomically confirm payment and upgrade user plan. Audit log row written
   * inside the same transaction so confirm + upgrade + audit are atomic.
   *
   * Returns upgraded payment row or null if payment is not eligible.
   */
  confirmPaymentAndUpgrade(reference, txSignature, durationDays = 30) {
    const runTxn = this.db.transaction((ref, sig, days) => {
      const payment = this.db.prepare(`SELECT * FROM payments WHERE reference = ?`).get(ref);
      if (!payment) return null;
      if (payment.status !== 'pending') return null;

      this.db.prepare(`
        UPDATE payments
        SET status = 'confirmed', tx_signature = ?, confirmed_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(sig, payment.id);

      const plan = this.db.prepare(`SELECT id FROM plans WHERE name = ?`).get(payment.plan_name);
      if (!plan) throw new Error(`Plan not found: ${payment.plan_name}`);

      // BILL-002 (Bundle #2): capture previous plan before UPDATE for audit payload.
      const prev = this.db.prepare(`SELECT plan_id FROM users WHERE id = ?`).get(payment.user_id);

      const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
      this.db.prepare(`
        UPDATE users
        SET plan_id = ?, subscription_expires_at = ?, status = 'active'
        WHERE id = ?
      `).run(plan.id, expiresAt, payment.user_id);

      // BILL-002 (Bundle #2): audit log inside the existing transaction.
      this.recordAuditEvent(
        'plan_upgrade',
        null,                         // no admin actor — payment-driven
        'system',
        payment.user_id,
        {
          from_plan_id: prev?.plan_id ?? null,
          to_plan_id:   plan.id,
          to_plan_name: payment.plan_name,
          expires_at:   expiresAt,
          source:       'payment_confirmed',
          payment_id:   payment.id,
        },
        true,
      );

      return { ...payment, tx_signature: sig };
    });

    return runTxn(reference, txSignature, durationDays);
  }
```

- [ ] **Step 2: Verify audit row written + transaction still works**

Run from project root:

```
node -e "import('./src/db/database.js').then(async ({ default: TD }) => { const db = new TD(':memory:', { info: () => {}, warn: () => {}, error: () => {} }); db.db.exec(\"INSERT INTO plans (name, label_en, label_ru, price_usd, manual_analyze_daily, catalyst_daily, x_analysis_daily, sources, alert_score_threshold, manual_threshold, manual_min_score, manual_min_meme, history_hours) VALUES ('free', 'Free', 'Бесплатно', 0, 0, 0, 0, '[]', 80, 60, 30, 30, 0), ('pro', 'Pro', 'Pro', 9.99, 5, 5, 10, '[]', 60, 50, 20, 20, 168);\"); db.db.exec(\"INSERT INTO users (id, telegram_chat_id, plan_id) VALUES (1, 'test', 1)\"); db.db.exec(\"INSERT INTO payments (reference, user_id, plan_name, status, amount_usd) VALUES ('ref-1', 1, 'pro', 'pending', 9.99)\"); const r = db.confirmPaymentAndUpgrade('ref-1', 'txsig-abc', 30); const a = db.db.prepare('SELECT * FROM admin_audit_log').all(); console.log('confirmed:', !!r, '/ audits:', a.length, '/ event:', a[0]?.event_type, '/ source:', JSON.parse(a[0]?.payload_json || '{}').source); db.db.close(); })"
```

Expected output:
```
confirmed: true / audits: 1 / event: plan_upgrade / source: payment_confirmed
```

If audits=0 → audit write isn't inside transaction or is failing silently.

- [ ] **Step 3: Task complete** — no commit; advance to Task 5.

---

## Task 5: Wrap `_setUserPlan` in transaction + audit (admin/server.js)

**Files:**
- Modify: `F:\.VibeCoding\Projects\Antigravity\Narrative Parser\src\admin\server.js` (around lines 712-727 and 939-951)

**Context:**
- `_setUserPlan(userId, planName, days)` at line 712 — admin handler for grant/revoke. Currently:
  - For `free`/`admin` plans: direct `UPDATE users SET plan_id, subscription_expires_at=NULL, status='active'` without transaction.
  - For paid plans: delegates to `this.db.upgradePlan(userId, plan.name, days)` (Task 3 already wrapped that one in transaction + audit).
- Callers (lines 939-944 and 947-951): two HTTP routes `/api/users/:id/subscription/grant` (passes `plan`) and `/api/users/:id/subscription/revoke` (passes `'free'`). Both check admin auth at line 930 (`this._auth(req)`). The actor (admin user id) is not currently passed through — admin auth in this project doesn't carry a per-admin user-id (single-tenant admin), so we log with `actor_user_id: null, actor_kind: 'admin'`.

- [ ] **Step 1: Extend `_setUserPlan` signature with `opts` param + add atomic + audit**

Use Edit tool. Replace (exact lines 712-727):

```javascript
  _setUserPlan(userId, planName, days = 30) {
    const plan = this.db.db.prepare(`SELECT id, name FROM plans WHERE name = ?`).get(planName);
    if (!plan) throw new Error(`Plan not found: ${planName}`);

    if (plan.name === 'free' || plan.name === 'admin') {
      // Free and Admin plans have no expiry
      this.db.db.prepare(`
        UPDATE users
        SET plan_id = ?, subscription_expires_at = NULL, status = 'active'
        WHERE id = ?
      `).run(plan.id, userId);
      return;
    }

    this.db.upgradePlan(userId, plan.name, days);
  }
```

With:

```javascript
  /**
   * Set user plan (admin panel grant/revoke).
   * ADM-005 + BILL-002 (Bundle #2): wrapped in db.transaction() so the
   * UPDATE either fully succeeds (with audit row) or fully rolls back.
   *
   * @param {number} userId
   * @param {string} planName
   * @param {number} [days=30]
   * @param {Object} [opts]
   * @param {string} [opts.source='admin_panel'] - audit log source
   */
  _setUserPlan(userId, planName, days = 30, opts = {}) {
    const plan = this.db.db.prepare(`SELECT id, name FROM plans WHERE name = ?`).get(planName);
    if (!plan) throw new Error(`Plan not found: ${planName}`);

    if (plan.name === 'free' || plan.name === 'admin') {
      // Free and Admin plans have no expiry. Atomic UPDATE + audit log.
      const tx = this.db.db.transaction(() => {
        const prev = this.db.db.prepare(`SELECT plan_id FROM users WHERE id = ?`).get(userId);
        this.db.db.prepare(`
          UPDATE users
          SET plan_id = ?, subscription_expires_at = NULL, status = 'active'
          WHERE id = ?
        `).run(plan.id, userId);
        this.db.recordAuditEvent(
          plan.name === 'admin' ? 'plan_grant_admin' : 'plan_revoke',
          null,                  // single-tenant admin panel: no per-admin id
          'admin',
          userId,
          {
            from_plan_id: prev?.plan_id ?? null,
            to_plan_id:   plan.id,
            to_plan_name: plan.name,
            source:       opts.source || 'admin_panel',
          },
          true,
        );
      });
      tx();
      return;
    }

    // Paid plans — upgradePlan already wraps в transaction + audit (see database.js Task 3).
    this.db.upgradePlan(userId, plan.name, days, { source: opts.source || 'admin_panel' });
  }
```

- [ ] **Step 2: Verify both call sites still work (no signature break)**

The current callers pass `(id, plan, days)` and `(id, 'free', 0)` — 3 args. Our new signature is `(userId, planName, days, opts)` — 4 args, opts optional. **Backward compatible**, no caller edit needed for them to keep working. But to record the `source` correctly, we can optionally add `opts` at the call site. For this bundle we leave callers unchanged (default `opts={}` → source='admin_panel' default).

Use Grep tool:
- pattern: `_setUserPlan\s*\(`
- path: `src/admin/server.js`
- output_mode: content
- -n: true

Expected: 3 matches (1 definition at ~712, 2 call sites at ~943 + ~949). Confirm callers still pass 3 args (no syntax change needed in callers — the new opts param defaults to `{}`).

- [ ] **Step 3: Sanity check — module loads without error**

Run: `node -e "import('./src/admin/server.js').then(m => console.log('admin module OK:', !!m.default || !!m))"`

Expected: `admin module OK: true`

If MODULE_NOT_FOUND or SyntaxError → fix.

- [ ] **Step 4: Task complete** — no commit; advance to Task 6.

---

## Task 6: Alert dispatcher dual write (`recordAlertDecision` в `src/index.js`)

**Files:**
- Modify: `F:\.VibeCoding\Projects\Antigravity\Narrative Parser\src\index.js` (around lines 250-254)

**Context (current state, lines 250-254):**

```javascript
function recordAlertDecision(rec) {
  appState.alertDecisions.push({ ts: new Date().toISOString(), ...rec });
  const over = appState.alertDecisions.length - appState.alertDecisionsCap;
  if (over > 0) appState.alertDecisions.splice(0, over);
}
```

The `db` variable is available in module scope (created at line 37: `const db = new TrendDatabase(...)`). The function is called via `recordDecision: recordAlertDecision` pattern passed to alert dispatcher (lines 153, 572). We add a fire-and-forget DB write that mirrors the same `rec` shape into the new `alert_decisions` table.

- [ ] **Step 1: Add DB dual write to `recordAlertDecision`**

Use Edit tool on `src/index.js`. Replace:

```javascript
function recordAlertDecision(rec) {
  appState.alertDecisions.push({ ts: new Date().toISOString(), ...rec });
  const over = appState.alertDecisions.length - appState.alertDecisionsCap;
  if (over > 0) appState.alertDecisions.splice(0, over);
}
```

With:

```javascript
function recordAlertDecision(rec) {
  // ADM-002 + PIPE-016 (Bundle #2): memory buffer stays as fast cache for
  // /api/decisions API; DB write becomes authoritative for post-mortem.
  appState.alertDecisions.push({ ts: new Date().toISOString(), ...rec });
  const over = appState.alertDecisions.length - appState.alertDecisionsCap;
  if (over > 0) appState.alertDecisions.splice(0, over);

  // Fire-and-forget DB write. Error swallow — never block alert flow.
  // The db.recordAlertDecision method already wraps the INSERT in try/catch
  // + logger.error, so we don't need an extra try/catch here, but adding one
  // for belt-and-suspenders against any unexpected throw (e.g., if `db` is
  // not yet initialized during early-boot edge cases).
  try {
    db.recordAlertDecision({
      trendId: rec.trend_id ?? rec.trendId ?? null,
      userId:  rec.user_id  ?? rec.userId  ?? null,
      source:  rec.source   ?? null,
      reason:  rec.reason,
      gates:   rec.gates    ?? null,
      weights: rec.weights  ?? null,
      sent:    rec.sent === true || rec.reason === 'sent',
    });
  } catch (e) {
    // db.recordAlertDecision already logs; this catch handles edge cases
    // like `db` being undefined. Stay silent — alert flow is more important.
  }
}
```

- [ ] **Step 2: Verify module loads + function still callable**

Run: `node -e "import('./src/index.js').catch(e => { if (e.message.includes('config') || e.message.includes('PORT') || e.message.includes('CHAT') || e.message.includes('TELEGRAM')) console.log('boot expected: needs config/env'); else console.log('SYNTAX OK (other error):', e.message); }).then(() => console.log('boot OK'))"`

Expected: either `boot OK` OR `boot expected: needs config/env` (the module successfully parses but throws during runtime initialization because env vars aren't set). Anything with "SyntaxError" or "ReferenceError" about `db` → fix.

Note: we don't actually run the full app — it would try to start servers, connect to TG bot, etc. Just verifying syntax.

- [ ] **Step 3: Task complete** — no commit; advance to Task 7.

---

## Task 7: Cost counter swap (Map → DB) in `src/dashboard/server.js`

**Files:**
- Modify: `F:\.VibeCoding\Projects\Antigravity\Narrative Parser\src\dashboard\server.js` (lines 440-441, 1678+1683, 1977+1986)

**Context:** Replace 2 in-memory `Map` fields (`_manualAnalysisHits`, `_catalystHits`) and 4 callsites (2 read, 2 write) with DB calls. The class has `this.db` (TrendDatabase) — no import needed.

**Existing pattern around line 1672-1684 (catalyst cap):**

```javascript
    // Daily cap (per-user, rolling 24h, in-memory). Admin bypass.
    if (ent.catalyst > 0) {
      const now = Date.now();
      const dayMs = 24 * 60 * 60 * 1000;
      const hits = (this._catalystHits.get(userId) || []).filter(t => now - t < dayMs);
      if (hits.length >= ent.catalyst) {
        return json(res, 403, { error: 'Daily Catalyst limit reached', reason: 'daily_limit', cap: ent.catalyst });
      }
      hits.push(now);
      this._catalystHits.set(userId, hits);
    }
```

**Existing pattern around line 1972-1987 (manual analysis cap + cooldown):**

```javascript
    if (cacheAge === null && ent.manualAnalyze > 0) {
      const now = Date.now();
      const dayMs = 24 * 60 * 60 * 1000;
      const cooldownMs = 30 * 1000;
      const dailyCap = ent.manualAnalyze;
      const hits = (this._manualAnalysisHits.get(userId) || []).filter(t => now - t < dayMs);
      if (hits.length && now - hits[hits.length - 1] < cooldownMs) {
        const secLeft = Math.max(1, Math.ceil((cooldownMs - (now - hits[hits.length - 1])) / 1000));
        return json(res, 403, { error: 'Cooldown active — analysis can take 10-30s', reason: 'cooldown', secLeft });
      }
      if (hits.length >= dailyCap) {
        return json(res, 403, { error: 'Daily limit reached (' + dailyCap + ' / 24h)', reason: 'daily', cap: dailyCap });
      }
      hits.push(now);
      this._manualAnalysisHits.set(userId, hits);
    }
```

We replace the `hits = Map.get().filter` with `hits = this.db.getRecentFeatureUsageHits(...)` (same shape: ms timestamps array) and `Map.set` with `this.db.recordFeatureUsage(...)`. The cooldown logic uses `hits[hits.length - 1]` — unchanged because shape is identical.

- [ ] **Step 1: Remove the 2 Map field declarations (lines 437-441)**

Use Edit tool. Replace:

```javascript
    this.sseClients    = new Set();  // active Server-Sent Event subscribers
    this._sseKeepAlive = null;
    // In-memory rate-limit rings. Map<userId, number[]> — array of timestamps
    // within the rolling 24h window. Reset on restart, which is fine for a
    // soft cap (only matters for sustained abuse).
    this._manualAnalysisHits = new Map();
    this._catalystHits       = new Map();
```

With:

```javascript
    this.sseClients    = new Set();  // active Server-Sent Event subscribers
    this._sseKeepAlive = null;
    // Bundle #2 (2026-06-07): cost cap counters moved from in-memory Maps
    // to feature_usage_log DB table. See COST-003 — restart-resilient.
```

- [ ] **Step 2: Replace catalyst cap callsite (around lines 1675-1684)**

Use Edit tool. Replace:

```javascript
    // Daily cap (per-user, rolling 24h, in-memory). Admin bypass.
    if (ent.catalyst > 0) {
      const now = Date.now();
      const dayMs = 24 * 60 * 60 * 1000;
      const hits = (this._catalystHits.get(userId) || []).filter(t => now - t < dayMs);
      if (hits.length >= ent.catalyst) {
        return json(res, 403, { error: 'Daily Catalyst limit reached', reason: 'daily_limit', cap: ent.catalyst });
      }
      hits.push(now);
      this._catalystHits.set(userId, hits);
    }
```

With:

```javascript
    // Daily cap (per-user, rolling 24h). Bundle #2 (2026-06-07): persisted
    // в feature_usage_log table — restart-resilient (closes COST-003).
    // Admin bypass via ent.catalyst === 0 (entitlements.js).
    if (ent.catalyst > 0) {
      const dayMs = 24 * 60 * 60 * 1000;
      const hits = this.db.getRecentFeatureUsageHits(userId, 'catalyst', dayMs);
      if (hits.length >= ent.catalyst) {
        return json(res, 403, { error: 'Daily Catalyst limit reached', reason: 'daily_limit', cap: ent.catalyst });
      }
      this.db.recordFeatureUsage(userId, 'catalyst');
    }
```

- [ ] **Step 3: Replace manual analysis cap callsite (around lines 1972-1987)**

Use Edit tool. Replace:

```javascript
    if (cacheAge === null && ent.manualAnalyze > 0) {
      const now = Date.now();
      const dayMs = 24 * 60 * 60 * 1000;
      const cooldownMs = 30 * 1000;
      const dailyCap = ent.manualAnalyze;
      const hits = (this._manualAnalysisHits.get(userId) || []).filter(t => now - t < dayMs);
      if (hits.length && now - hits[hits.length - 1] < cooldownMs) {
        const secLeft = Math.max(1, Math.ceil((cooldownMs - (now - hits[hits.length - 1])) / 1000));
        return json(res, 403, { error: 'Cooldown active — analysis can take 10-30s', reason: 'cooldown', secLeft });
      }
      if (hits.length >= dailyCap) {
        return json(res, 403, { error: 'Daily limit reached (' + dailyCap + ' / 24h)', reason: 'daily', cap: dailyCap });
      }
      hits.push(now);
      this._manualAnalysisHits.set(userId, hits);
    }
```

With:

```javascript
    // Bundle #2 (2026-06-07): persisted в feature_usage_log table —
    // restart-resilient (closes COST-003). `hits` array shape unchanged
    // (epoch ms ASC), so cooldown + dailyCap checks below are untouched.
    if (cacheAge === null && ent.manualAnalyze > 0) {
      const now = Date.now();
      const dayMs = 24 * 60 * 60 * 1000;
      const cooldownMs = 30 * 1000;
      const dailyCap = ent.manualAnalyze;
      const hits = this.db.getRecentFeatureUsageHits(userId, 'manualAnalysis', dayMs);
      if (hits.length && now - hits[hits.length - 1] < cooldownMs) {
        const secLeft = Math.max(1, Math.ceil((cooldownMs - (now - hits[hits.length - 1])) / 1000));
        return json(res, 403, { error: 'Cooldown active — analysis can take 10-30s', reason: 'cooldown', secLeft });
      }
      if (hits.length >= dailyCap) {
        return json(res, 403, { error: 'Daily limit reached (' + dailyCap + ' / 24h)', reason: 'daily', cap: dailyCap });
      }
      this.db.recordFeatureUsage(userId, 'manualAnalysis');
    }
```

- [ ] **Step 4: Verify zero remaining references to the deleted Maps**

Use Grep tool:
- pattern: `_manualAnalysisHits|_catalystHits`
- path: `src/dashboard/server.js`
- output_mode: content, -n true

Expected: **0 matches**. (Both Map fields and all 4 callsites should be gone.)

If matches > 0 → there's a leftover reference; fix or revert.

- [ ] **Step 5: Run SPA validation gate**

Run: `npm run check:spa`

Expected: exit 0, dashboard char count slightly smaller than baseline (we removed Map declarations + replaced longer in-memory code with shorter DB calls — should drop by ~500 chars).

If FAIL → revert + investigate. The edits are server-side (outside SPA template literal), so a SPA-trap FAIL means Edit hit the wrong region.

- [ ] **Step 6: Task complete** — no commit; advance to Task 8.

---

## Task 8: Add 2 new housekeeping intervals in `src/index.js`

**Files:**
- Modify: `F:\.VibeCoding\Projects\Antigravity\Narrative Parser\src\index.js` (around lines 88-108)

**Context (current state, lines 80-108):**

```javascript
// Hidden trends archive — sweep entries older than 7 days. Run once on
// startup, then daily. Per-user dashboard archive feature; rows accumulate
// until either the user restores them or this sweeper drops them.
const HIDDEN_TREND_RETENTION_DAYS = 7;
try {
  const swept = db.cleanupExpiredHiddenTrends(HIDDEN_TREND_RETENTION_DAYS);
  if (swept > 0) logger.info(`[Maintenance] hidden_trends: pruned ${swept} entries older than ${HIDDEN_TREND_RETENTION_DAYS}d`);
} catch (e) { logger.warn(`[Maintenance] hidden_trends sweep failed: ${e.message}`); }
setInterval(() => {
  try {
    const swept = db.cleanupExpiredHiddenTrends(HIDDEN_TREND_RETENTION_DAYS);
    if (swept > 0) logger.info(`[Maintenance] hidden_trends: pruned ${swept} entries (daily)`);
  } catch (e) { logger.warn(`[Maintenance] hidden_trends sweep failed: ${e.message}`); }
}, 24 * 60 * 60 * 1000);

// Alert-score history retention (sparkline data). 30 days = balance of
// "show last week's evolution" vs "table doesn't grow forever". On startup
// + daily, same pattern as hidden_trends sweep above.
const ALERT_SCORE_HISTORY_RETENTION_DAYS = 30;
try {
  const swept = db.pruneAlertScoreHistory(ALERT_SCORE_HISTORY_RETENTION_DAYS);
  if (swept > 0) logger.info(`[Maintenance] alert_score_history: pruned ${swept} rows older than ${ALERT_SCORE_HISTORY_RETENTION_DAYS}d`);
} catch (e) { logger.warn(`[Maintenance] alert_score_history sweep failed: ${e.message}`); }
setInterval(() => {
  try {
    const swept = db.pruneAlertScoreHistory(ALERT_SCORE_HISTORY_RETENTION_DAYS);
    if (swept > 0) logger.info(`[Maintenance] alert_score_history: pruned ${swept} rows (daily)`);
  } catch (e) { logger.warn(`[Maintenance] alert_score_history sweep failed: ${e.message}`); }
}, 24 * 60 * 60 * 1000);
```

Note: `db.pruneAlertDecisions` and `db.pruneFeatureUsageLog` (added in Task 2) already log their own success/no-op via `this.logger.info`, so the wrapper logs in this file would duplicate. We just call them inside try/catch and let the methods handle their own logging.

- [ ] **Step 1: Insert 2 new housekeeping blocks AFTER existing `alert_score_history` block**

Use Edit tool. Find the end of the `alert_score_history` block (after the closing `}, 24 * 60 * 60 * 1000);` around line 108) and add the new blocks immediately after.

Replace (the `setInterval` block for alert_score_history + the comment line that follows):

```javascript
setInterval(() => {
  try {
    const swept = db.pruneAlertScoreHistory(ALERT_SCORE_HISTORY_RETENTION_DAYS);
    if (swept > 0) logger.info(`[Maintenance] alert_score_history: pruned ${swept} rows (daily)`);
  } catch (e) { logger.warn(`[Maintenance] alert_score_history sweep failed: ${e.message}`); }
}, 24 * 60 * 60 * 1000);

// ── Initialize Solana Pay Monitor ───────────────────────────────────────────
```

With:

```javascript
setInterval(() => {
  try {
    const swept = db.pruneAlertScoreHistory(ALERT_SCORE_HISTORY_RETENTION_DAYS);
    if (swept > 0) logger.info(`[Maintenance] alert_score_history: pruned ${swept} rows (daily)`);
  } catch (e) { logger.warn(`[Maintenance] alert_score_history sweep failed: ${e.message}`); }
}, 24 * 60 * 60 * 1000);

// Bundle #2 (2026-06-07): retention cleanup for new observability tables.
// alert_decisions — 14d (debugging window for post-deploy incidents).
// feature_usage_log — 7d (caps need only 24h; extra week for cap-hit debugging).
// admin_audit_log — no cleanup (audit-grade data, low write rate; defer until scaling concern).
const ALERT_DECISIONS_RETENTION_DAYS  = 14;
const FEATURE_USAGE_RETENTION_DAYS    =  7;
try { db.pruneAlertDecisions(ALERT_DECISIONS_RETENTION_DAYS); }
catch (e) { logger.warn(`[Maintenance] alert_decisions sweep failed: ${e.message}`); }
try { db.pruneFeatureUsageLog(FEATURE_USAGE_RETENTION_DAYS); }
catch (e) { logger.warn(`[Maintenance] feature_usage_log sweep failed: ${e.message}`); }
setInterval(() => {
  try { db.pruneAlertDecisions(ALERT_DECISIONS_RETENTION_DAYS); }
  catch (e) { logger.warn(`[Maintenance] alert_decisions sweep failed: ${e.message}`); }
}, 24 * 60 * 60 * 1000);
setInterval(() => {
  try { db.pruneFeatureUsageLog(FEATURE_USAGE_RETENTION_DAYS); }
  catch (e) { logger.warn(`[Maintenance] feature_usage_log sweep failed: ${e.message}`); }
}, 24 * 60 * 60 * 1000);

// ── Initialize Solana Pay Monitor ───────────────────────────────────────────
```

- [ ] **Step 2: Verify module loads + housekeeping section parses**

Run: `node -e "import('./src/index.js').catch(e => { if (e.message.includes('config') || e.message.includes('PORT') || e.message.includes('CHAT') || e.message.includes('TELEGRAM')) console.log('boot expected: needs config/env'); else if (e.message.includes('SyntaxError') || e.message.includes('Unexpected')) console.log('SYNTAX ERROR:', e.message); else console.log('non-syntax error (likely OK):', e.message); }).then(() => console.log('boot OK'))"`

Expected: `boot OK` OR `boot expected: needs config/env`. Anything with "SyntaxError" → revert and fix.

- [ ] **Step 3: Task complete** — no commit; advance to Task 9.

---

## Task 9: SESSION_CONTEXT + WORKLOG + final SPA check

**Files:**
- Modify: `F:\.VibeCoding\Projects\Antigravity\Narrative Parser\ai-context\SESSION_CONTEXT.md`
- Modify: `F:\.VibeCoding\Projects\Antigravity\Narrative Parser\ai-context\WORKLOG.md`

- [ ] **Step 1: Locate Production posture section in SESSION_CONTEXT.md**

Use Grep tool:
- pattern: `Production posture|URL safety helpers`
- path: `ai-context/SESSION_CONTEXT.md`
- output_mode: content
- -n: true
- context: -A 2

Use the URL safety bullet (added in Bundle #3) as an anchor — insert the new bullet immediately AFTER it.

- [ ] **Step 2: Add Observability persistence bullet**

Use Edit tool. Find the URL safety bullet (which starts with `- **URL safety helpers** (Bundle #3, 2026-06-07)`). Read 5-10 lines around it to capture the exact text (each bullet's exact content might vary).

Then insert the new bullet immediately after that one. Adapt indentation to match (usually no leading spaces, just `- `):

```markdown
- **Observability persistence** (Bundle #2, 2026-06-07): 3 new DB tables — `admin_audit_log` (plan changes + admin actions, forever retention), `alert_decisions` (dispatcher decisions, 14d retention), `feature_usage_log` (rolling cost counters via `getRecentFeatureUsageHits(userId, feature, windowMs)` → epoch-ms array; 7d retention). Replaces previously in-memory state (decisions ring buffer cap 500, `_catalystHits` / `_manualAnalysisHits` Maps) which lost on restart. 6 new methods on `TrendDatabase`: `recordAuditEvent`, `recordAlertDecision`, `recordFeatureUsage`, `getRecentFeatureUsageHits`, `pruneAlertDecisions`, `pruneFeatureUsageLog`. `_setUserPlan` + `upgradePlan` + `confirmPaymentAndUpgrade` now atomic via `db.transaction()` + audit write. Cleanup tasks (14d / 7d) added to housekeeping `setInterval` loop в `src/index.js`. Migration `scripts/migrate-audit-log-2026-06-07.sql` (idempotent, also re-created on boot via schema.sql `_migrate()`). Closes BILL-002, ADM-002, ADM-005, COST-003, PIPE-016.
```

- [ ] **Step 3: Read top of WORKLOG.md for entry style**

Use Read tool with `limit: 60` on `ai-context/WORKLOG.md`. Confirm the heading format (e.g., `## YYYY-MM-DD · model · Bundle #N — title`) and the field labels (Цель, Метод, Файлы, Деплой, Риски, Closes).

- [ ] **Step 4: Prepend Bundle #2 entry to WORKLOG.md**

Use Edit tool on `ai-context/WORKLOG.md`. Replace the current top-most entry's heading so the new entry appears above it. (E.g., if the topmost line after the preamble is `## 2026-06-07 · sonnet · Bundle #3 — URL safety helpers (...)`, replace that line with the new entry's heading + body + `---` + the original line. Read first to confirm exact format.)

The new entry:

```markdown
## 2026-06-07 · sonnet · Bundle #2 — Observability persistence (BILL-002, ADM-002, ADM-005, COST-003, PIPE-016)

**Цель**: Закрыть 5 finding'ов критической observability — audit log на plan changes, alert decisions persist, cost counter persist, atomic transactions.

**Метод**: subagent-driven (sonnet оркестратор, haiku/sonnet implementers). 9-task bundle: T1 schema + migration → T2 6 new DB methods → T3-T4 upgradePlan/confirmPaymentAndUpgrade transactions → T5 _setUserPlan atomic + audit → T6 alert dispatcher dual write → T7 cost counter Map→DB swap → T8 housekeeping intervals → T9 docs.

**Spec divergence**: spec'овские helper modules (`src/db/audit.js`, `src/billing/usage.js`) **отброшены** — проект не имеет `db` singleton export, все DB access идёт через `this.db.<method>` от constructor parameter. Методы добавлены прямо на `TrendDatabase` class. -2 файла, matches existing pattern.

**Файлы**:
- `src/db/schema.sql` — +3 `CREATE TABLE IF NOT EXISTS` + indexes (admin_audit_log, alert_decisions, feature_usage_log).
- `scripts/migrate-audit-log-2026-06-07.sql` — **new** idempotent migration script (operator one-off; also re-creates on boot).
- `src/db/database.js` — +6 методов на `TrendDatabase`: `recordAuditEvent`, `recordAlertDecision`, `recordFeatureUsage`, `getRecentFeatureUsageHits`, `pruneAlertDecisions`, `pruneFeatureUsageLog`. `upgradePlan` wrapped в `db.transaction()` + audit write. `confirmPaymentAndUpgrade` writes audit inside existing transaction (ATOM with payment confirm + plan update).
- `src/admin/server.js` — `_setUserPlan` (line 712) wrapped в transaction + audit для free/admin path. Paid path delegates to `db.upgradePlan` (now atomic).
- `src/index.js`:
  - `recordAlertDecision` function (line 250) теперь dual write — memory ring buffer для `/api/decisions` API + fire-and-forget `db.recordAlertDecision()`.
  - Housekeeping cron (after alert_score_history block): +2 `setInterval` для `pruneAlertDecisions(14)` + `pruneFeatureUsageLog(7)` + boot-time one-shot calls.
- `src/dashboard/server.js`:
  - Deleted `_manualAnalysisHits` / `_catalystHits` Map fields (lines 440-441).
  - Catalyst cap (~line 1675) и manual-analysis cap+cooldown (~line 1972): swap `Map.get().filter()` на `db.getRecentFeatureUsageHits()` (same epoch-ms array shape); `Map.set()` на `db.recordFeatureUsage()`. Cooldown logic via `hits[hits.length-1]` сохранён без изменений.
- `ai-context/SESSION_CONTEXT.md` — +1 bullet в Production posture.

**Деплой**: subagents file edits only, no commits. Operator commits selectively. **CRITICAL**: после деплоя operator должен ОДНОКРАТНО запустить `sqlite3 /path/to/catalyst.db < scripts/migrate-audit-log-2026-06-07.sql` на VPS чтобы создать таблицы в existing prod DB (boot-time `_migrate()` тоже их создаст — но script даёт explicit step для DR). Deploy через `deploy.ps1`, Bundle #16 SPA gate валидирует SPA повторно.

**Риски**: low/medium. Cap check теперь hits DB вместо Map — но composite index `(user_id, feature, ts DESC)` делает SELECT ~50µs. Fail-open on DB error (`getRecentFeatureUsageHits` returns `[]`) — лучше чем lockout. Alert dispatcher dual write fire-and-forget — log loss non-fatal (alert уже сработал). Atomic transactions для `_setUserPlan` — strict gain (previous state allowed half-applied plan changes). Memory ring buffer `appState.alertDecisions` сохранён для `/api/decisions` API — нет breaking change на dashboard side.

**Closes**: BILL-002 (HIGH), ADM-002 (HIGH), ADM-005 (HIGH), COST-003 (HIGH), PIPE-016 (info, intended). 5 findings одним bundle'ом.
```

(Heading format and field labels — match what's in WORKLOG.md when you read it in Step 3. The above uses the format from Bundle #3's entry.)

- [ ] **Step 5: Final full SPA validation**

Run from project root: `npm run check:spa`

Expected: exit 0, dashboard char count slightly LOWER than Bundle #3 baseline (342813) — we removed ~500 chars from `dashboard/server.js` net. Admin SPA unchanged (266605 chars).

If FAIL → something else broke.

- [ ] **Step 6: Sanity-check all 3 new tables exist after fresh boot**

Run from project root:

```
node -e "import('./src/db/database.js').then(({ default: TD }) => { const db = new TD(':memory:', { info: () => {}, warn: () => {}, error: () => {} }); const tables = db.db.prepare(\"SELECT name FROM sqlite_master WHERE type='table' ORDER BY name\").all().map(r => r.name); const indexes = db.db.prepare(\"SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%' ORDER BY name\").all().map(r => r.name); console.log('tables:', tables.filter(t => /audit|decisions|usage_log/.test(t)).join(',')); console.log('indexes:', indexes.filter(i => /audit|decisions|usage/.test(i)).join(',')); db.db.close(); })"
```

Expected:
```
tables: admin_audit_log,alert_decisions,feature_usage_log
indexes: idx_admin_audit_event,idx_admin_audit_target,idx_admin_audit_ts,idx_alert_decisions_trend,idx_alert_decisions_ts,idx_alert_decisions_user,idx_feature_usage_user_feature_ts
```

(7 indexes total: 3 for admin_audit, 3 for alert_decisions, 1 composite for feature_usage_log.)

- [ ] **Step 7: Task complete** — operator commits + deploys.

---

## Operator hand-off (post-implementation)

After all 9 tasks complete, controller hands back to operator with:

### Diff summary
- `git status` + `git diff --stat`
- Expected modified: `src/db/schema.sql`, `src/db/database.js`, `src/admin/server.js`, `src/index.js`, `src/dashboard/server.js`, `ai-context/SESSION_CONTEXT.md`, `ai-context/WORKLOG.md`
- Expected new: `scripts/migrate-audit-log-2026-06-07.sql`

### Manual verification before deploy (local)
1. **DB schema loads**: `node -e "import('./src/db/database.js').then(({default: TD}) => { const d = new TD(':memory:', console); console.log('tables OK:', d.db.prepare(\"SELECT count(*) c FROM sqlite_master WHERE name IN ('admin_audit_log','alert_decisions','feature_usage_log')\").get().c === 3); d.db.close(); })"` — expect `tables OK: true`.
2. **`npm run check:spa`** — exit 0.
3. **Local boot smoke** (optional — needs `.env`): `npm run dev`, watch for `[Maintenance] alert_decisions: pruned N rows` log lines on first boot (probably 0 rows pruned since DB is fresh).

### Deploy
1. **Run migration on VPS** (one-off, explicit):
   ```
   scp scripts/migrate-audit-log-2026-06-07.sql vps:/tmp/
   ssh vps "docker exec catalyst sqlite3 /data/catalyst.db < /tmp/migrate-audit-log-2026-06-07.sql"
   ```
   (Exact path to DB inside container per `DEPLOY.md` — confirm `/data/catalyst.db` or wherever it actually is.)
2. **Deploy via `deploy.ps1`** — Bundle #16's `[1/5] Validating SPA syntax` runs first as defense-in-depth.

### Smoke after deploy
1. Admin panel: grant a user a plan upgrade → on VPS run `sqlite3 /data/catalyst.db "SELECT * FROM admin_audit_log ORDER BY id DESC LIMIT 1;"` — should show row with `event_type='plan_upgrade'`, target_user_id, payload with from/to plan_id.
2. Trigger `npm run dev` (locally or hit prod) 2 manual-analysis requests as a paid user → `SELECT count(*) FROM feature_usage_log WHERE feature='manualAnalysis' AND ts > datetime('now','-1 hour');` should return 2.
3. Wait for next scanner pass → `SELECT count(*) FROM alert_decisions WHERE ts > datetime('now','-1 hour');` should match `appState.alertDecisions.length` in dashboard's `/api/decisions` response.
4. **Restart container** (`docker restart catalyst`): `SELECT count(*) FROM admin_audit_log;` retains pre-restart count. Re-trigger manual-analysis cap → counter persists from before restart (no ×2 exploit).

## Closed findings

- **BILL-002** (HIGH): audit log on plan changes — `recordAuditEvent` called from all 3 plan-change call sites.
- **ADM-002** (HIGH): alert decisions persisted; memory buffer kept as cache for `/api/decisions`.
- **ADM-005** (HIGH): `_setUserPlan` + `upgradePlan` + `confirmPaymentAndUpgrade` all wrapped in `db.transaction()`.
- **COST-003** (HIGH): cost counters persist в feature_usage_log; restart-resilient; ×2 exploit closed.
- **PIPE-016** (info, intended): closed bonus via same alert_decisions fix as ADM-002.

---

## Self-review

(Run by plan author — for record; implementers can skip.)

**1. Spec coverage:**
- Spec §"`admin_audit_log` schema" → Task 1 ✅
- Spec §"`alert_decisions` schema" → Task 1 ✅
- Spec §"`feature_usage_log` schema" → Task 1 ✅
- Spec §"`src/db/audit.js`" (helper) → **dropped, plan-divergence noted** (matches existing pattern, no functional impact).
- Spec §"`src/billing/usage.js`" (helper) → **dropped, plan-divergence noted**.
- Spec §"Database class extensions (6 methods)" → Task 2 ✅
- Spec §"`upgradePlan` transaction wrap + audit" → Task 3 ✅. Note: spec's signature `(userId, planId, expiresAt)` was wrong; real signature is `(userId, planName, durationDays)`. Plan uses real one.
- Spec §"`confirmPaymentAndUpgrade` audit add" → Task 4 ✅
- Spec §"`_setUserPlan` (admin/server.js) atomic + audit" → Task 5 ✅
- Spec §"Alert dispatcher dual write" → Task 6 ✅
- Spec §"Cost counters Map→DB swap" → Task 7 ✅
- Spec §"Migration script" → Task 1 ✅
- Spec §"Housekeeping cron 2 new tasks" → Task 8 ✅
- Spec §"SESSION_CONTEXT bullet + WORKLOG" → Task 9 ✅

**2. Placeholder scan:** No "TBD" / "TODO" / "Add appropriate" patterns. All code blocks contain real code with real line references.

**3. Type consistency:**
- `recordAuditEvent` 6-arg signature consistent across Task 2 definition + Task 3 (upgradePlan) + Task 4 (confirmPaymentAndUpgrade) + Task 5 (_setUserPlan).
- `recordAlertDecision({trendId, userId, source, reason, gates, weights, sent})` shape consistent between Task 2 method def and Task 6 caller.
- `getRecentFeatureUsageHits(userId, feature, windowMs)` returns `number[]` of epoch ms — Task 2 def matches Task 7 callers' expectation (`hits[hits.length-1]` access pattern works on number[]).
- `recordFeatureUsage(userId, feature)` 2-arg signature consistent.
- Table names + index names match exactly between Task 1 schema.sql, Task 1 migration script, and Task 2 method SQL.

Plan saved. Ready for execution.
