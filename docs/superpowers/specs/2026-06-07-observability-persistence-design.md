# Observability Persistence Bundle — Design Spec

**Bundle**: #2 из `docs/audit/INDEX.md` (Tier 2)
**Date**: 2026-06-07
**Author**: brainstorm session (operator + sonnet, operator delegated детали per «решай сам» pattern)
**Status**: Approved scope (Core: persistence + cleanup, no admin UI viewer), ready for writing-plans

---

## Goal

Закрыть 5 audit finding'ов критической observability (audit logs, decisions buffer, usage counters), которые сейчас живут только в памяти и теряются при рестарте. **Three new DB tables** (`admin_audit_log`, `alert_decisions`, `feature_usage_log`) + persist hooks в существующие места + retention cleanup tasks в существующий 24h interval loop.

## Context

### Findings (5)

- **BILL-002** [HIGH]: Plan grant/revoke без audit log. UPDATE `users.plan_id` напрямую без следов. Compromised admin token → бесконечные тихие grant'ы. Multi-admin → конфликты неразрешимы.
- **ADM-002** [HIGH]: `appState.alertDecisions = []` cap 500, restart-reset. Pure in-memory ring buffer. Deploy = всё debugging history alert-dispatcher'а исчезло именно когда нужно (после deploy).
- **ADM-005** [HIGH]: `_setUserPlan` (admin/server.js:712) делает SELECT plan + UPDATE user без `db.transaction()`. Если UPDATE упал — broken state (plan_id changed, subscription_expires_at не set). Плюс нет audit log (overlap with BILL-002).
- **COST-003** [HIGH]: `_manualAnalysisHits` и `_catalystHits` (Map в dashboard/server.js:440-441) очищаются при restart. Юзер с 4/5 manualAnalyze + 3/5 catalyst → restart → счётчик = 0 → может потратить ещё 5+5 → effectively ×2 cap per deploy.
- **PIPE-016** [info, intended]: alert decisions buffer in-memory only — same fix as ADM-002, бонусно закрывается.

### Existing infrastructure

- **DB wrapper**: `better-sqlite3` via class `TrendDatabase` в `src/db/database.js`. `db.transaction()` доступен. `db.exec(schema)` вызывается в `_migrate()` (line 30) — `CREATE TABLE IF NOT EXISTS` идемпотентно безопасно.
- **Schema source**: `src/db/schema.sql` (single file). Прикладные миграции — one-off SQL в `scripts/` (есть прецедент `scripts/migrate-categories-2026-05-08.sql`).
- **Plan changes (where to instrument)**:
  - `_setUserPlan` в `src/admin/server.js:712` — free/admin sets, UPDATE без transaction. NEEDS transaction wrap.
  - `upgradePlan` в `src/db/database.js:895` — paid plan upgrades, UPDATE без transaction. NEEDS transaction wrap.
  - `confirmPaymentAndUpgrade` в `src/db/database.js:854` — payment confirm. **Уже в transaction** (good). Just needs audit log write inside.
- **Alert decisions buffer**: `src/index.js:241` init, `:251` push `{ ts: ISO, ...rec }`, `:252-253` cap enforce via splice. Cap=500.
- **Cost counters**: `_manualAnalysisHits` / `_catalystHits` в dashboard/server.js:440-441 — Maps `userId → [timestamps]`. Rolling 24h via `filter(t => now - t < dayMs)`. Increment via `hits.push(now)` + `map.set(userId, hits)` на `dashboard/server.js:1683` и `:1986`. Read для cap check на `:1678` и `:1977`.
- **Housekeeping cron**: `src/index.js:88-108` — 24h `setInterval` для cleanup. Уже есть `cleanupExpiredHiddenTrends` (7d) и `pruneAlertScoreHistory` (30d) патерны. Добавим туда наши новые cleanup tasks.

### Defense-in-depth и why now

Bundle #3 только что добавил 5 plan-reject 403'ев с `reason: 'plan'` в `dashboard/server.js` — без логирования. Bundle #2 (this) даёт infrastructure куда писать. Symmetric.

---

## Scope

### In-scope

**Schema additions** (3 new tables в `src/db/schema.sql`):
- `admin_audit_log` — admin actions + plan changes + (optional) plan rejects. Forever retention.
- `alert_decisions` — alert dispatcher decisions persistence. 14 days retention.
- `feature_usage_log` — per-hit event log для cost caps. 7 days retention.

**New helper module**: `src/billing/usage.js` — `recordUsage(userId, feature)`, `getUsageCount(userId, feature, sinceMs)`. Replaces direct Map mutations in dashboard/server.js.

**New helper module**: `src/db/audit.js` — `recordAuditEvent(eventType, actorUserId, targetUserId, payload, success)`. Used by admin handlers and plan change sites.

**Persist hooks (call sites)**:
- `_setUserPlan` (admin/server.js:712) — wrap в `db.transaction()` + `recordAuditEvent('plan_grant'|'plan_revoke', ...)`.
- `upgradePlan` (database.js:895) — wrap в `db.transaction()` + `recordAuditEvent('plan_upgrade', ...)`.
- `confirmPaymentAndUpgrade` (database.js:854) — already transactional; add `recordAuditEvent('plan_upgrade', source='payment_confirmed', ...)` inside.
- Alert dispatcher (`src/index.js:251` site): replace in-memory push with `db.recordAlertDecision(...)` call. **Async fire-and-forget** with error swallow — never block alert flow. Keep memory buffer for live API tail (`/api/decisions` endpoint that polls top N), but persist authoritatively to DB.
- Cost cap call sites (dashboard/server.js:1683, :1986): replace `this._catalystHits.set(...)` / `_manualAnalysisHits.set(...)` direct mutations with calls to `recordUsage(userId, 'catalyst')` / `recordUsage(userId, 'manualAnalysis')`. Replace reads (`:1678`, `:1977`) with `getUsageCount(userId, feature, 24*60*60*1000)`.

**Migration script**: `scripts/migrate-audit-log-2026-06-07.sql` — `CREATE TABLE IF NOT EXISTS` для всех 3 таблиц + индексы. Run-once on prod DB, no-op on subsequent boots (because boot-time `db.exec(schema.sql)` is also idempotent).

**Retention cleanup** (in `src/index.js` housekeeping loop near line 88-108): add 2 new 24h interval tasks:
- `db.pruneAlertDecisions(14)` (older than 14 days)
- `db.pruneFeatureUsageLog(7)` (older than 7 days)
- (admin_audit_log: no cleanup в этом bundle — defer).

**Docs**:
- `ai-context/SESSION_CONTEXT.md` — bullet в Production posture о new tables.
- `ai-context/WORKLOG.md` — Bundle #2 entry.

### Out-of-scope

- **Admin UI viewer** для audit logs (operator выбрал Core scope). REST endpoint `/api/audit-log` или JSX page — отложено.
- **Plan-reject logging from dashboard** (5 callsites с `reason: 'plan'`): tempting добавить, но это high-write rate (free user может spam preview). Defer — log только authoritative plan changes (grant/revoke/upgrade).
- **Migration к admin_audit_log retention policy** — defer до scaling concerns.
- **Tests / TDD** — no existing test infra (consistent с предыдущими bundle'ами). SPA gate + manual smoke = verification.
- **`/api/decisions` API change** — keep returning live in-memory buffer for UI compatibility. Decision: DB write is authoritative, memory buffer is cache for fast API reads. **Both writes** stay (memory for API, DB for persistence). Out-of-scope: switching API to DB query (later perf opt if buffer becomes inconsistent).
- **xAnalysis counter** — subagent confirmed только manualAnalysis и catalyst имеют Maps. xAnalysis cap (если есть) tracked elsewhere — out of scope, не трогаем.

---

## Architecture

### Files affected

| File | Action | Detail |
|---|---|---|
| `src/db/schema.sql` | modify | +3 CREATE TABLE IF NOT EXISTS + indexes |
| `scripts/migrate-audit-log-2026-06-07.sql` | new | one-off prod migration (same DDL, safe to re-run) |
| `src/db/database.js` | modify | +3 method classes: `recordAuditEvent`, `recordAlertDecision`, `recordUsage` + `getUsageCount` + `pruneAlertDecisions`, `pruneFeatureUsageLog`. Wrap `upgradePlan` в transaction + audit write. Add audit write to `confirmPaymentAndUpgrade`. |
| `src/db/audit.js` | new | thin facade exports for `recordAuditEvent` (used by admin handlers). ~30 LOC. |
| `src/billing/usage.js` | new | `recordUsage(userId, feature)` + `getUsageCount(userId, feature, sinceMs)`. ~40 LOC. |
| `src/admin/server.js` | modify | `_setUserPlan` (line 712): wrap в transaction + `recordAuditEvent` call. |
| `src/dashboard/server.js` | modify | Replace Map-based cost counter operations (lines 1678, 1683, 1977, 1986) с `recordUsage` / `getUsageCount` calls. Remove `_manualAnalysisHits` / `_catalystHits` Map fields (lines 440-441). |
| `src/index.js` | modify | Alert dispatcher: replace `alertDecisions.push(...)` (line 251) с dual write (memory keeps as cache + `db.recordAlertDecision(...)` async). Housekeeping loop (around 88-108): add `db.pruneAlertDecisions(14)` + `db.pruneFeatureUsageLog(7)`. |
| `ai-context/SESSION_CONTEXT.md` | modify | +1 bullet в Production posture |
| `ai-context/WORKLOG.md` | modify | Bundle #2 entry |

### Files NOT touched

- `src/admin/server.js` (admin SPA template literal) — no UI viewer this bundle.
- Test files — no test infra.
- `src/billing/entitlements.js` — read-only consumer of `usage.js`, no change needed.

---

## Schema

### Table 1: `admin_audit_log`

```sql
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  ts              TEXT    NOT NULL DEFAULT (datetime('now')),
  actor_user_id   INTEGER,                                  -- admin doing the action (NULL if 'system')
  actor_kind      TEXT    NOT NULL,                         -- 'admin' | 'system' | 'user_self'
  event_type      TEXT    NOT NULL,                         -- 'plan_grant' | 'plan_revoke' | 'plan_upgrade' | 'plan_block' | 'plan_reject' | 'preset_save' | 'broadcast_send' | ...
  target_user_id  INTEGER,                                  -- the user the action affected (FK soft, no constraint)
  payload_json   TEXT,                                      -- JSON: { from_plan, to_plan, source: 'admin'|'payment'|'cron', reason, ... }
  success         INTEGER NOT NULL DEFAULT 1                -- 1 | 0
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_ts        ON admin_audit_log(ts DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_target    ON admin_audit_log(target_user_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_event     ON admin_audit_log(event_type, ts DESC);
```

**Why**: BILL-002, ADM-005. Forever retention (low write rate, audit-grade).

### Table 2: `alert_decisions`

```sql
CREATE TABLE IF NOT EXISTS alert_decisions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  ts           TEXT    NOT NULL DEFAULT (datetime('now')),
  trend_id     INTEGER,                                     -- the trend evaluated (FK soft)
  user_id      INTEGER,                                     -- the user the alert targeted (FK soft)
  source       TEXT,                                        -- 'reddit' | 'twitter' | 'google_trends' | ...
  reason       TEXT    NOT NULL,                            -- 'sent' | 'skipped_seen' | 'skipped_score' | 'skipped_quiet' | 'skipped_lifespan' | ...
  gates_json   TEXT,                                        -- full gate evaluations (existing in-memory shape)
  weights_json TEXT,                                        -- optional, weight breakdown
  sent         INTEGER NOT NULL DEFAULT 0                   -- 1 if alert actually dispatched
);

CREATE INDEX IF NOT EXISTS idx_alert_decisions_ts    ON alert_decisions(ts DESC);
CREATE INDEX IF NOT EXISTS idx_alert_decisions_user  ON alert_decisions(user_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_alert_decisions_trend ON alert_decisions(trend_id, ts DESC);
```

**Why**: ADM-002, PIPE-016. Retention: 14 days (debugging window for post-deploy incidents).

### Table 3: `feature_usage_log`

```sql
CREATE TABLE IF NOT EXISTS feature_usage_log (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  ts        TEXT    NOT NULL DEFAULT (datetime('now')),
  user_id   INTEGER NOT NULL,
  feature   TEXT    NOT NULL                                -- 'manualAnalysis' | 'catalyst' | (extensible)
);

CREATE INDEX IF NOT EXISTS idx_feature_usage_user_feature_ts ON feature_usage_log(user_id, feature, ts DESC);
```

**Why**: COST-003. Per-hit event log (matches existing rolling-24h pattern via `WHERE ts > datetime('now', '-1 day')`). Retention: 7 days (caps only need 24h; keep extra week for debugging false-cap-hit reports).

### Indices rationale
- `admin_audit_log`: 3 indexes на ts / target_user_id / event_type — admin dashboard вьюхает по user или event type.
- `alert_decisions`: 3 indexes на ts / user_id / trend_id — same query patterns.
- `feature_usage_log`: 1 composite index `(user_id, feature, ts DESC)` — perfect match для COUNT'a за rolling 24h.

---

## Helper modules

### `src/db/audit.js` (new, ~30 LOC)

```javascript
// Audit log helper — Bundle #2 (2026-06-07).
// Thin facade over db.recordAuditEvent for use from admin/server.js handlers.
//
// Usage:
//   import { recordAuditEvent } from '../db/audit.js';
//   recordAuditEvent({ eventType: 'plan_grant', actorUserId: req.user.id, targetUserId: 123, payload: { from_plan: 'free', to_plan: 'pro' }, success: true });

import { db } from './index.js'; // wherever the singleton TrendDatabase instance is exported

/**
 * Record an admin-side audit event. Synchronous write (low rate, fits in
 * caller's transaction if one is open).
 *
 * @param {Object} opts
 * @param {string} opts.eventType - e.g. 'plan_grant', 'plan_revoke', 'preset_save'
 * @param {number|null} opts.actorUserId - admin doing the action (null = system)
 * @param {string} [opts.actorKind] - 'admin' (default) | 'system' | 'user_self'
 * @param {number|null} [opts.targetUserId] - the user affected
 * @param {Object} [opts.payload] - JSON-serializable structured payload
 * @param {boolean} [opts.success=true]
 */
export function recordAuditEvent({ eventType, actorUserId, actorKind = 'admin', targetUserId = null, payload = null, success = true }) {
  return db.recordAuditEvent(eventType, actorUserId, actorKind, targetUserId, payload, success);
}
```

### `src/billing/usage.js` (new, ~40 LOC)

```javascript
// Feature usage helper — Bundle #2 (2026-06-07).
// Persists every cap-relevant feature hit to feature_usage_log and reads
// rolling-window counts. Replaces the in-memory _catalystHits/_manualAnalysisHits
// Maps that previously lived in dashboard/server.js and lost state on restart.

import { db } from '../db/index.js';

/**
 * Record one feature use. Synchronous DB write; cost is ~1ms.
 * Safe to call from request hot path.
 *
 * @param {number} userId
 * @param {string} feature - 'manualAnalysis' | 'catalyst'
 */
export function recordUsage(userId, feature) {
  if (!userId || !feature) return;
  return db.recordFeatureUsage(userId, feature);
}

/**
 * Count hits for the user/feature within the last `windowMs` milliseconds.
 * Returns 0 if no hits or on DB error.
 *
 * @param {number} userId
 * @param {string} feature
 * @param {number} windowMs - e.g. 24*60*60*1000 for rolling 24h
 * @returns {number}
 */
export function getUsageCount(userId, feature, windowMs) {
  if (!userId || !feature || !windowMs) return 0;
  return db.countFeatureUsageSince(userId, feature, windowMs);
}
```

---

## Database class extensions (in `src/db/database.js`)

Add these methods to `class TrendDatabase`:

```javascript
// === Bundle #2 (2026-06-07): audit log + alert decisions + feature usage ===

recordAuditEvent(eventType, actorUserId, actorKind, targetUserId, payload, success = true) {
  const stmt = this.db.prepare(`
    INSERT INTO admin_audit_log (event_type, actor_user_id, actor_kind, target_user_id, payload_json, success)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  try {
    return stmt.run(
      eventType,
      actorUserId ?? null,
      actorKind || 'admin',
      targetUserId ?? null,
      payload ? JSON.stringify(payload) : null,
      success ? 1 : 0,
    );
  } catch (e) {
    console.error('[audit] recordAuditEvent failed:', e.message, { eventType, actorUserId, targetUserId });
    // Swallow — never block the caller's action on audit log failure.
    return null;
  }
}

recordAlertDecision({ trendId, userId, source, reason, gates, weights, sent }) {
  const stmt = this.db.prepare(`
    INSERT INTO alert_decisions (trend_id, user_id, source, reason, gates_json, weights_json, sent)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  try {
    return stmt.run(
      trendId ?? null,
      userId ?? null,
      source || null,
      reason,
      gates ? JSON.stringify(gates) : null,
      weights ? JSON.stringify(weights) : null,
      sent ? 1 : 0,
    );
  } catch (e) {
    console.error('[audit] recordAlertDecision failed:', e.message, { trendId, userId, reason });
    return null;
  }
}

recordFeatureUsage(userId, feature) {
  const stmt = this.db.prepare(`
    INSERT INTO feature_usage_log (user_id, feature) VALUES (?, ?)
  `);
  try {
    return stmt.run(userId, feature);
  } catch (e) {
    console.error('[audit] recordFeatureUsage failed:', e.message, { userId, feature });
    return null;
  }
}

countFeatureUsageSince(userId, feature, windowMs) {
  const sinceIso = new Date(Date.now() - windowMs).toISOString().replace('T', ' ').slice(0, 19);
  // ^ SQLite default datetime('now') format is 'YYYY-MM-DD HH:MM:SS'; cutoff must match (no 'T', no 'Z').
  const stmt = this.db.prepare(`
    SELECT COUNT(*) AS n
    FROM feature_usage_log
    WHERE user_id = ? AND feature = ? AND ts > ?
  `);
  try {
    const row = stmt.get(userId, feature, sinceIso);
    return row?.n || 0;
  } catch (e) {
    console.error('[audit] countFeatureUsageSince failed:', e.message, { userId, feature });
    return 0;
  }
}

pruneAlertDecisions(retentionDays) {
  const stmt = this.db.prepare(`
    DELETE FROM alert_decisions WHERE ts < datetime('now', ?)
  `);
  const arg = `-${retentionDays} days`;
  try {
    const res = stmt.run(arg);
    if (res.changes > 0) console.log(`[audit] pruned ${res.changes} alert_decisions older than ${retentionDays}d`);
    return res.changes;
  } catch (e) {
    console.error('[audit] pruneAlertDecisions failed:', e.message);
    return 0;
  }
}

pruneFeatureUsageLog(retentionDays) {
  const stmt = this.db.prepare(`
    DELETE FROM feature_usage_log WHERE ts < datetime('now', ?)
  `);
  const arg = `-${retentionDays} days`;
  try {
    const res = stmt.run(arg);
    if (res.changes > 0) console.log(`[audit] pruned ${res.changes} feature_usage_log older than ${retentionDays}d`);
    return res.changes;
  } catch (e) {
    console.error('[audit] pruneFeatureUsageLog failed:', e.message);
    return 0;
  }
}
```

### `upgradePlan` — wrap в transaction + audit write

**Current** (`src/db/database.js:895-902`):
```javascript
upgradePlan(userId, planId, expiresAt) {
  this.db.prepare(`
    UPDATE users SET plan_id=?, subscription_expires_at=?, status='active' WHERE id=?
  `).run(planId, expiresAt, userId);
}
```

**After**:
```javascript
upgradePlan(userId, planId, expiresAt, opts = {}) {
  // BILL-002 / ADM-005 (Bundle #2): atomic UPDATE + audit log write.
  // `opts.actorUserId` = the admin doing this (null = system / payment-driven).
  // `opts.source` = 'admin' | 'payment_confirmed' | 'cron'
  const tx = this.db.transaction(() => {
    const prev = this.db.prepare(`SELECT plan_id FROM users WHERE id=?`).get(userId);
    this.db.prepare(`UPDATE users SET plan_id=?, subscription_expires_at=?, status='active' WHERE id=?`)
      .run(planId, expiresAt, userId);
    this.recordAuditEvent(
      'plan_upgrade',
      opts.actorUserId ?? null,
      opts.actorUserId ? 'admin' : 'system',
      userId,
      { from_plan_id: prev?.plan_id ?? null, to_plan_id: planId, expires_at: expiresAt, source: opts.source || 'unknown' },
      true,
    );
  });
  tx();
}
```

### `confirmPaymentAndUpgrade` — add audit write inside existing transaction

`src/db/database.js:854` уже в transaction. Add внутрь existing block (right after `UPDATE users SET plan_id=...`):

```javascript
// BILL-002 (Bundle #2): audit log inside the existing transaction.
this.recordAuditEvent(
  'plan_upgrade',
  null,                           // no admin actor — payment-driven
  'system',
  userId,
  { from_plan_id: prevPlanId, to_plan_id: planId, expires_at: expiresAt, source: 'payment_confirmed', payment_id: paymentId },
  true,
);
```

---

## `_setUserPlan` (admin/server.js:712) — wrap + audit

**Current** (admin/server.js:712-721):
```javascript
async _setUserPlan(req, res, userId) {
  const { planId } = await readJsonBody(req);
  if (planId === 'free' || planId === 'admin') {
    this.db.db.prepare(`
      UPDATE users SET plan_id=?, subscription_expires_at=NULL, status='active' WHERE id=?
    `).run(planId, userId);
    return json(res, 200, { ok: true });
  }
  // ... (delegates to upgradePlan)
}
```

**After**:
```javascript
async _setUserPlan(req, res, userId) {
  const { planId } = await readJsonBody(req);
  if (planId === 'free' || planId === 'admin') {
    // ADM-005 + BILL-002 (Bundle #2): atomic UPDATE + audit log write.
    const tx = this.db.db.transaction(() => {
      const prev = this.db.db.prepare(`SELECT plan_id FROM users WHERE id=?`).get(userId);
      this.db.db.prepare(`UPDATE users SET plan_id=?, subscription_expires_at=NULL, status='active' WHERE id=?`)
        .run(planId, userId);
      this.db.recordAuditEvent(
        planId === 'admin' ? 'plan_grant_admin' : 'plan_revoke',
        req.user?.id ?? null,
        'admin',
        userId,
        { from_plan_id: prev?.plan_id ?? null, to_plan_id: planId, source: 'admin_panel' },
        true,
      );
    });
    tx();
    return json(res, 200, { ok: true });
  }
  // Pass actor info through to upgradePlan for audit logging.
  this.db.upgradePlan(userId, /*planId, expiresAt computed below*/ ...,
    { actorUserId: req.user?.id, source: 'admin_panel' });
  // ... rest of existing logic
  return json(res, 200, { ok: true });
}
```

(Exact placement в _setUserPlan to be detailed in the plan task; spec just locks the shape.)

---

## Alert dispatcher — dual write

`src/index.js:241-253` current state:
```javascript
appState.alertDecisions = [];
appState.alertDecisionsCap = 500;
// ... elsewhere ...
appState.alertDecisions.push({ ts: new Date().toISOString(), ...rec });
const over = appState.alertDecisions.length - appState.alertDecisionsCap;
if (over > 0) appState.alertDecisions.splice(0, over);
```

**After**:
```javascript
appState.alertDecisions = [];
appState.alertDecisionsCap = 500;
// ... elsewhere ...

// ADM-002 + PIPE-016 (Bundle #2): persist to DB + keep memory cache for fast API reads.
appState.alertDecisions.push({ ts: new Date().toISOString(), ...rec });
const over = appState.alertDecisions.length - appState.alertDecisionsCap;
if (over > 0) appState.alertDecisions.splice(0, over);

// Fire-and-forget DB write. Error swallow — never block alert flow.
try {
  db.recordAlertDecision({
    trendId: rec.trend_id,
    userId: rec.user_id,
    source: rec.source,
    reason: rec.reason,
    gates: rec.gates,
    weights: rec.weights,
    sent: rec.sent || rec.reason === 'sent',
  });
} catch (e) {
  console.error('[audit] alert decision persist failed:', e.message);
}
```

Memory buffer stays for backward compat (existing `/api/decisions` consumes it). DB becomes authoritative source for post-mortem debugging.

---

## Cost counters — replace Maps with `feature_usage_log`

In `src/dashboard/server.js`:

### Remove Map field declarations (lines 440-441)

```javascript
// DELETE:
this._manualAnalysisHits = new Map();
this._catalystHits       = new Map();
```

### Replace read sites

**Line 1678 area** (catalyst hits read):
```javascript
// Before:
const hits = (this._catalystHits.get(userId) || []).filter(t => now - t < dayMs);
if (hits.length >= ent.catalyst) return json(res, 429, { error: 'Daily catalyst cap reached', reason: 'cap' });

// After:
const count = getUsageCount(userId, 'catalyst', dayMs);
if (count >= ent.catalyst) return json(res, 429, { error: 'Daily catalyst cap reached', reason: 'cap' });
```

**Line 1977 area** (manual analysis hits read):
```javascript
// Before:
const hits = (this._manualAnalysisHits.get(userId) || []).filter(t => now - t < dayMs);
if (hits.length >= dailyCap) return json(res, 429, { error: 'Daily manual-analysis cap reached', reason: 'cap' });

// After:
const count = getUsageCount(userId, 'manualAnalysis', dayMs);
if (count >= dailyCap) return json(res, 429, { error: 'Daily manual-analysis cap reached', reason: 'cap' });
```

### Replace write sites

**Line 1683** (catalyst increment):
```javascript
// Before:
hits.push(now);
this._catalystHits.set(userId, hits);

// After:
recordUsage(userId, 'catalyst');
```

**Line 1986** (manual analysis increment):
```javascript
// Before:
hits.push(now);
this._manualAnalysisHits.set(userId, hits);

// After:
recordUsage(userId, 'manualAnalysis');
```

### Add imports at top of `src/dashboard/server.js`

```javascript
import { recordUsage, getUsageCount } from '../billing/usage.js';
```

---

## Migration script

`scripts/migrate-audit-log-2026-06-07.sql` (new) — exact same DDL as in schema.sql, idempotent via `IF NOT EXISTS`. Operator runs once on prod DB (e.g., `sqlite3 /var/lib/catalyst/data/trends.db < scripts/migrate-audit-log-2026-06-07.sql`). Boot-time `db.exec(schema.sql)` also creates tables on first boot post-deploy, so the script is redundant on greenfield — present for explicit operator step / DR scenarios.

Contents identical to the 3 CREATE TABLE + indexes blocks above.

---

## Housekeeping cron — 2 new tasks

`src/index.js` around lines 88-108. Pattern matches existing `cleanupExpiredHiddenTrends` / `pruneAlertScoreHistory`. Insert:

```javascript
// Bundle #2 (2026-06-07): retention cleanup for new audit/decision/usage tables.
const ALERT_DECISIONS_RETENTION_DAYS = 14;
const FEATURE_USAGE_RETENTION_DAYS   = 7;

// One-shot at boot:
db.pruneAlertDecisions(ALERT_DECISIONS_RETENTION_DAYS);
db.pruneFeatureUsageLog(FEATURE_USAGE_RETENTION_DAYS);

// Recurring (every 24h):
setInterval(() => db.pruneAlertDecisions(ALERT_DECISIONS_RETENTION_DAYS), 24*60*60*1000);
setInterval(() => db.pruneFeatureUsageLog(FEATURE_USAGE_RETENTION_DAYS),  24*60*60*1000);
```

(`admin_audit_log` — no cleanup this bundle.)

---

## SESSION_CONTEXT.md update

Add bullet в Production posture (рядом с Bundle #3's URL safety):

```markdown
- **Observability persistence** (Bundle #2, 2026-06-07): 3 new DB tables — `admin_audit_log` (plan changes + admin actions, forever retention), `alert_decisions` (dispatcher decisions, 14d retention), `feature_usage_log` (rolling cost counters, 7d retention). Replaces previously in-memory state which lost on restart. Helpers: `src/db/audit.js` (`recordAuditEvent`), `src/billing/usage.js` (`recordUsage` / `getUsageCount`). `_setUserPlan` + `upgradePlan` now atomic via `db.transaction()` + audit write. Cleanup tasks added to housekeeping `setInterval` loop. Migration `scripts/migrate-audit-log-2026-06-07.sql` (idempotent, also re-created on boot via schema.sql). Closes BILL-002, ADM-002, ADM-005, COST-003, PIPE-016.
```

---

## Verification plan

### Acceptance criteria

**Schema**:
- [ ] `src/db/schema.sql` contains 3 `CREATE TABLE IF NOT EXISTS` blocks для new tables + indexes.
- [ ] `scripts/migrate-audit-log-2026-06-07.sql` exists, identical DDL.
- [ ] Boot: `db.exec(schema)` does not throw on fresh DB or on DB that already has tables.

**Helper modules**:
- [ ] `src/db/audit.js` exists, exports `recordAuditEvent({ ... })`.
- [ ] `src/billing/usage.js` exists, exports `recordUsage(userId, feature)` + `getUsageCount(userId, feature, windowMs)`.
- [ ] Both helpers swallow DB errors via `try/catch` + `console.error`.

**DB class extensions**:
- [ ] `db.recordAuditEvent`, `db.recordAlertDecision`, `db.recordFeatureUsage`, `db.countFeatureUsageSince`, `db.pruneAlertDecisions`, `db.pruneFeatureUsageLog` all present.
- [ ] `upgradePlan` wraps SQL в `db.transaction()` + calls `recordAuditEvent`.
- [ ] `confirmPaymentAndUpgrade` writes audit event inside existing transaction.

**Call sites**:
- [ ] `src/admin/server.js:_setUserPlan` wraps free/admin path в transaction + audit write.
- [ ] `src/index.js:251` alert push has DB dual-write (fire-and-forget try/catch).
- [ ] `src/dashboard/server.js:440-441` Map declarations deleted.
- [ ] `src/dashboard/server.js:1678+1683+1977+1986` use `getUsageCount` / `recordUsage` calls.
- [ ] `src/dashboard/server.js` top imports `recordUsage, getUsageCount` from `../billing/usage.js`.

**Housekeeping**:
- [ ] `src/index.js` housekeeping section runs `pruneAlertDecisions(14)` + `pruneFeatureUsageLog(7)` at boot AND in 24h interval.

**SPA validation gate (CRITICAL)**:
- [ ] After EACH `src/dashboard/server.js` edit: `npm run check:spa` exits 0.
- [ ] Final full SPA check: `npm run check:spa` exits 0.

**Smoke tests (operator after deploy)**:
- [ ] Open admin panel, grant a user plan upgrade → `SELECT * FROM admin_audit_log ORDER BY id DESC LIMIT 1;` shows row with correct event_type/actor/target/payload.
- [ ] Trigger 5 manual-analysis requests rapidly → `SELECT COUNT(*) FROM feature_usage_log WHERE feature='manualAnalysis' AND ts > datetime('now', '-1 hour');` returns 5.
- [ ] Force a scanner pass that emits alert decisions → `SELECT * FROM alert_decisions ORDER BY id DESC LIMIT 5;` shows recent decisions matching what's in `appState.alertDecisions` memory buffer.
- [ ] Restart container → `SELECT COUNT(*) FROM admin_audit_log;` retains pre-restart count. Manual analysis cap counter persists across restart.

### Closed findings

- BILL-002 (audit log on plan changes — admin/payment/system flows all write to admin_audit_log)
- ADM-002 (alert decisions persist to alert_decisions; memory buffer retained as cache)
- ADM-005 (`_setUserPlan` + `upgradePlan` wrapped в `db.transaction()`)
- COST-003 (feature_usage_log persists hits; cap reads via DB, restart-resilient)
- PIPE-016 (closed bonus via same alert_decisions fix as ADM-002)

---

## Risks & mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| DB write latency adds to alert dispatch hot path | low | Fire-and-forget try/catch on `recordAlertDecision`. SQLite local write ~1-2ms. |
| Cap check now hits DB on every request → /api/manual-analysis becomes slower | low | SQLite read with composite index = ~50µs. Negligible. Worst case 100 req/min * 50µs = 5ms/min total. |
| `db.transaction()` failure inside `_setUserPlan` rolls back UPDATE → admin sees error | low | This IS the desired behavior (ADM-005 fix). Better than half-applied state. |
| feature_usage_log fills disk если bot обходит cap | very low | 7d retention + cleanup. Free user can max ~5 hits/day, 200 active users → ~7k rows/week. Tiny. |
| alert_decisions DB write fails silently → no log | medium | Falls back to memory buffer (still works). console.error logs the failure для operator visibility. |
| Migration runs on prod but schema.sql also runs → conflict | very low | Both use `CREATE TABLE IF NOT EXISTS`. Idempotent. |
| Removing `_manualAnalysisHits` Map fields breaks other code referencing them | low | Grep verify zero references outside the lines we touch. Plan task includes verification step. |
| `getUsageCount` returns 0 on DB error → cap suddenly opens | low | Returns 0 = "no hits in window" = request passes. **This is fail-open and bypasses cap on DB outage.** Trade-off: better than fail-closed (which would lock out legit users on transient DB error). Acceptable since DB outages also break the rest of the app. |

---

## Estimated effort

| Component | Time |
|---|---|
| Schema additions + migration script | 20 min |
| `src/db/database.js` 6 new methods + `upgradePlan` + `confirmPaymentAndUpgrade` mods | 45 min |
| `src/db/audit.js` + `src/billing/usage.js` (new helpers) | 20 min |
| `src/admin/server.js:_setUserPlan` transaction + audit | 20 min |
| `src/index.js` alert dispatcher dual write + 2 housekeeping intervals | 20 min |
| `src/dashboard/server.js` 4 callsites + 2 Map deletions + 1 import (+ SPA gate after each edit) | 30 min |
| `SESSION_CONTEXT.md` bullet + WORKLOG entry | 15 min |
| Operator: deploy + smoke (4 verification queries) | 30 min |
| **Total** | **~3.5h** |

Audit estimate был ~4h. Matches.

---

## Open questions

All resolved per operator delegation:

- Q1: 1 unified events table vs 3 per-purpose tables? → **3 per-purpose** (per-table retention, query patterns, write rate isolation).
- Q2: Daily-bucket counter vs event-per-hit log для cost caps? → **Event-per-hit** (matches existing rolling 24h pattern; date-bucket would change UX semantics).
- Q3: Sync vs async alert decision write? → **Async fire-and-forget** (alert already happened; log loss non-fatal).
- Q4: In-memory cache layer на cost counter reads? → **No** (SQLite read 50µs is fast enough; YAGNI).
- Q5: Plan-reject events (5 dashboard 403 sites) — log or not? → **No this bundle** (high-rate spam from anonymous; only log authoritative plan changes).
- Q6: admin_audit_log retention? → **Forever** в this bundle. Defer cleanup до scaling concern.
- Q7: Migrate existing in-memory state to DB at boot (warm-up)? → **No** (greenfield; counters reset on next request, decisions buffer rebuilds organically).
- Q8: Tests / TDD? → **No** (no existing test infra; SPA gates + manual smoke = verification).

---

## Transition

После approve этого spec — invoke `superpowers:writing-plans` для генерации implementation plan с per-task SPA gates (для dashboard/server.js edits) + final operator smoke checklist.
