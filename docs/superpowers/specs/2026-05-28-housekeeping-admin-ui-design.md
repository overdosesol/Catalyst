# Housekeeping + Admin UI Maintenance — Design Spec

**Date**: 2026-05-28
**Bundle**: #6 (Tier 3, scaling prep)
**Audit findings closed**: DB-010 (video-cache daily), DB-011 (auth_sessions daily), DB-014 (log rotation), DB-022 (backup TG alert), DB-023 (video cache TTL tighten), PROD-019 (disk guard exposure), ADM-004 (admin maintenance buttons)
**Estimated effort**: ~4h

---

## 1. Goal

Close 7 housekeeping/admin findings in one bundle. Three areas:

1. **Backend daily intervals** — move 3 cleanups from boot-only to daily setInterval (video cache, auth_sessions, logs).
2. **Backup monitoring** — when nightly cron backup fails, send a TG alert to support group.
3. **Admin UI maintenance section** — 4 new on-demand buttons + 1 read-only backup-status widget. Operator-facing tools for ad-hoc maintenance + visibility into backup freshness.

Decisions taken upfront (no clarifying needed — operator delegated tech detail):
- **VACUUM**: manual only via admin button. Not automatic (blocks DB briefly).
- **Backup alert destination**: `SUPPORT_GROUP_ID` env var (already used by Bundle #13 admin-alert).
- **Log rotation**: application-level (inside `Logger.cleanupOldLogs`). No os-side logrotate config.
- **Video cache TTL**: default tightened 7d → 3d (DB-023).
- **Log retention**: 14d default.

---

## 2. Architecture overview

```
src/
├── utils/logger.js          (+1 method: cleanupOldLogs)
├── db/database.js           (+1 method: pruneAuthSessions; refactor existing boot cleanup)
├── notifications/telegram.js  (unchanged — cleanupVideoCache already supports the params we need)
├── admin/server.js          (+4 POST endpoints, +1 GET /api/backup-status field, +5 SPA elements)
└── index.js                 (+3 daily setInterval'ы, by Bundle #2 pattern)

scripts/catalyst-backup.sh   (+trap-based TG alert on failure)
ai-context/                  (+1 SESSION_CONTEXT bullet, +1 WORKLOG entry)
```

No DB schema changes. No new dependencies.

---

## 3. Components

### 3.1 `src/utils/logger.js` — cleanupOldLogs method

Add method to the `Logger` class (current file 47 LOC, no retention logic yet):

```js
  cleanupOldLogs(maxAgeDays = 14) {
    if (!fs.existsSync(this.logDir)) return 0;
    const cutoffMs = Date.now() - maxAgeDays * 86_400_000;
    let removed = 0;
    try {
      for (const name of fs.readdirSync(this.logDir)) {
        if (!name.endsWith('.log')) continue;
        const p = path.join(this.logDir, name);
        try {
          if (fs.statSync(p).mtimeMs < cutoffMs) {
            fs.unlinkSync(p);
            removed++;
          }
        } catch { /* skip unreadable file */ }
      }
    } catch { /* skip unreadable directory */ }
    return removed;
  }
```

Returns count of deleted files. Best-effort — never throws.

### 3.2 `src/db/database.js` — pruneAuthSessions method

The existing boot-only cleanup (lines 453-460) is wrapped in a try, runs once at `_migrate()`. Refactor into a reusable method:

**Step 1**: Add new method (near `pruneFeatureUsageLog`, around line 2570 — same neighborhood as the prune methods from B2 + B10):

```js
  pruneAuthSessions(maxAgeHours = 24) {
    const res = this.db.prepare(
      `DELETE FROM auth_sessions WHERE token IS NULL AND created_at < datetime('now', ?)`
    ).run(`-${maxAgeHours} hours`);
    return res.changes | 0;
  }
```

**Step 2**: Replace the boot-only code at line 453-460 with a call to the new method:

```js
    // Housekeeping — prune anything that's fully expired and has no token.
    // Daily setInterval in src/index.js (Bundle #6) covers ongoing prunes.
    try { this.pruneAuthSessions(24); }
    catch { /* best-effort at boot */ }
```

Behavior preserved (boot prune still runs). Reusable for daily setInterval.

### 3.3 `src/index.js` — 3 new daily setInterval'ы

Insert after Bundle #10 retention block (around line 173, before Solana monitor):

```js
// Bundle #6 (2026-05-28): housekeeping daily loops.
// video-cache       — 3d (DB-010 + DB-023 — tightened from 7d default for disk safety)
// auth_sessions     — 24h (DB-011 — moved from boot-only)
// logs              — 14d (DB-014 — application-level rotation)
const VIDEO_CACHE_RETENTION_DAYS    =  3;
const AUTH_SESSIONS_RETENTION_HOURS = 24;
const LOG_RETENTION_DAYS            = 14;

try {
  telegram.cleanupVideoCache(VIDEO_CACHE_RETENTION_DAYS);
} catch (e) { logger.warn(`[Maintenance] video-cache sweep failed: ${e.message}`); }
try {
  const n = db.pruneAuthSessions(AUTH_SESSIONS_RETENTION_HOURS);
  if (n > 0) logger.info(`[Maintenance] auth_sessions: pruned ${n} rows older than ${AUTH_SESSIONS_RETENTION_HOURS}h`);
} catch (e) { logger.warn(`[Maintenance] auth_sessions sweep failed: ${e.message}`); }
try {
  const n = logger.cleanupOldLogs(LOG_RETENTION_DAYS);
  if (n > 0) logger.info(`[Maintenance] logs: pruned ${n} files older than ${LOG_RETENTION_DAYS}d`);
} catch (e) { logger.warn(`[Maintenance] log rotation failed: ${e.message}`); }

setInterval(() => {
  try { telegram.cleanupVideoCache(VIDEO_CACHE_RETENTION_DAYS); }
  catch (e) { logger.warn(`[Maintenance] video-cache sweep failed: ${e.message}`); }
}, 24 * 60 * 60 * 1000);
setInterval(() => {
  try { db.pruneAuthSessions(AUTH_SESSIONS_RETENTION_HOURS); }
  catch (e) { logger.warn(`[Maintenance] auth_sessions sweep failed: ${e.message}`); }
}, 24 * 60 * 60 * 1000);
setInterval(() => {
  try { logger.cleanupOldLogs(LOG_RETENTION_DAYS); }
  catch (e) { logger.warn(`[Maintenance] log rotation failed: ${e.message}`); }
}, 24 * 60 * 60 * 1000);
```

Note: `telegram.cleanupVideoCache(3)` already exists (line 2283 of telegram.js). The startup call at line 79 currently calls it with `5` — change to use `VIDEO_CACHE_RETENTION_DAYS = 3` constant for consistency.

Actually, replace the existing startup call at line 79 (`try { telegram.cleanupVideoCache(5); } catch {}`) with our new try block above (which uses 3d). Delete the old line.

### 3.4 `scripts/catalyst-backup.sh` — TG alert on failure

Current script uses `set -euo pipefail` + explicit `exit 1` on FATAL conditions (integrity check, missing file, gzip -t fail). Add a `trap` near the top to catch all error exits:

**Step 1**: After line 7 (`set -euo pipefail`), add:

```bash
# Bundle #6 — TG alert on backup failure. Load env (best-effort; secrets at
# /etc/catalyst.env or wherever deploy.sh writes them).
[ -f /etc/catalyst.env ] && set -o allexport && . /etc/catalyst.env && set +o allexport

notify_failure() {
  local exit_code=$?
  # Don't alert on successful exit.
  if [ "$exit_code" -eq 0 ]; then exit 0; fi
  if [ -n "${TG_BOT_TOKEN:-}" ] && [ -n "${SUPPORT_GROUP_ID:-}" ]; then
    curl -s -X POST "https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage" \
      --data-urlencode "chat_id=${SUPPORT_GROUP_ID}" \
      --data-urlencode "text=🚨 Catalyst backup FAILED (exit ${exit_code}) on $(hostname) at $(date -Is)" \
      --data-urlencode "parse_mode=HTML" \
      > /dev/null 2>&1 || true
  fi
  exit "$exit_code"
}

trap notify_failure EXIT
```

The trap fires on any exit. Inside, we check exit code — only alert on non-zero. Best-effort: if curl fails or env vars missing, silently skip (don't fail the backup script trying to alert about failure).

**Env vars resolution**: assumes operator copies `TG_BOT_TOKEN` and `SUPPORT_GROUP_ID` into `/etc/catalyst.env` on VPS. If file missing or vars absent → silent skip.

### 3.5 `src/admin/server.js` — 4 endpoints + stats.backup field + UI

#### 3.5.1 New POST endpoints (4 new)

Add following the same pattern as existing `/api/alerts/cleanup` (line 1027). Locate the route handler block; insert after `/api/alerts/cleanup`:

```js
      if (path === '/api/admin/maintenance/vacuum' && method === 'POST') {
        const t0 = Date.now();
        this.db.db.exec('VACUUM');
        return jsonResponse(res, { elapsedMs: Date.now() - t0 });
      }
      if (path === '/api/admin/maintenance/cleanup-video' && method === 'POST') {
        this.telegram.cleanupVideoCache(3);
        return jsonResponse(res, { ok: true });
      }
      if (path === '/api/admin/maintenance/cleanup-auth' && method === 'POST') {
        const removed = this.db.pruneAuthSessions(24);
        return jsonResponse(res, { removed });
      }
      if (path === '/api/admin/maintenance/rotate-logs' && method === 'POST') {
        const removed = this.logger.cleanupOldLogs(14);
        return jsonResponse(res, { removed });
      }
```

(Exact `jsonResponse` helper signature may differ — implementer should mirror the existing return pattern from `/api/alerts/cleanup`.)

Dependencies to thread: `this.telegram` and `this.logger` must be available on the admin server class. Verify in implementation. (`this.db` already there; B13 passed `logger` too.)

#### 3.5.2 Extend `_getStats` with backup status

Locate the `_getStats()` method. Add a `backup` block to its return object:

```js
    const BACKUP_DIR = '/var/backups/catalyst';
    let backup = { lastBackupAt: null, lastBackupBytes: 0, dirExists: false };
    try {
      if (fs.existsSync(BACKUP_DIR)) {
        backup.dirExists = true;
        const files = fs.readdirSync(BACKUP_DIR)
          .filter(n => n.endsWith('.db.gz'))
          .map(n => ({ n, stat: fs.statSync(path.join(BACKUP_DIR, n)) }))
          .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
        if (files.length > 0) {
          backup.lastBackupAt = files[0].stat.mtimeMs;
          backup.lastBackupBytes = files[0].stat.size;
        }
      }
    } catch { /* best-effort */ }
```

Add `backup` to the returned `stats` object alongside `storage`.

#### 3.5.3 SPA UI changes (inline React in admin/server.js)

In `StatsPage` (around line 4717):

**A) Add 4 new handler functions** next to the existing `cleanupAlerts` (line 4736). Each wraps `api('/api/admin/maintenance/*', 'POST')` with success/error feedback in `maintMsg`:

```js
  const runVacuum = async () => {
    if (!window.confirm('VACUUM блокирует БД на время выполнения. Продолжить?')) return;
    try {
      const r = await api('/api/admin/maintenance/vacuum', 'POST');
      setMaintMsg(`VACUUM завершён за ${r.elapsedMs}ms`);
      setTimeout(()=>setMaintMsg(''), 4000);
      loadStats();
    } catch(e) { setMaintMsg('VACUUM ошибка: ' + e.message); setTimeout(()=>setMaintMsg(''), 4000); }
  };
  const cleanupVideoCache = async () => {
    try {
      await api('/api/admin/maintenance/cleanup-video', 'POST');
      setMaintMsg('Video cache очищен');
      setTimeout(()=>setMaintMsg(''), 3000);
    } catch(e) { setMaintMsg('Ошибка: ' + e.message); setTimeout(()=>setMaintMsg(''), 3000); }
  };
  const cleanupAuthSessions = async () => {
    try {
      const r = await api('/api/admin/maintenance/cleanup-auth', 'POST');
      setMaintMsg(`Auth sessions: удалено ${r.removed}`);
      setTimeout(()=>setMaintMsg(''), 3000);
    } catch(e) { setMaintMsg('Ошибка: ' + e.message); setTimeout(()=>setMaintMsg(''), 3000); }
  };
  const rotateLogs = async () => {
    try {
      const r = await api('/api/admin/maintenance/rotate-logs', 'POST');
      setMaintMsg(`Logs: удалено ${r.removed} файлов`);
      setTimeout(()=>setMaintMsg(''), 3000);
    } catch(e) { setMaintMsg('Ошибка: ' + e.message); setTimeout(()=>setMaintMsg(''), 3000); }
  };
```

**B) Add 4 new buttons** to the existing maintenance card (around line 4828, next to existing `🧹 Очистить старые алерты`):

```js
        React.createElement('button',{className:'btn btn-warning btn-sm',onClick:runVacuum, title:'Сжать БД (VACUUM). Блокирует на ~1с.'}, '💾 VACUUM'),
        React.createElement('button',{className:'btn btn-secondary btn-sm',onClick:cleanupVideoCache, title:'Удалить muxed видео старше 3 дней.'}, '🎞 Video cache'),
        React.createElement('button',{className:'btn btn-secondary btn-sm',onClick:cleanupAuthSessions, title:'Удалить незавершённые auth-сессии старше 24ч.'}, '🔑 Auth sessions'),
        React.createElement('button',{className:'btn btn-secondary btn-sm',onClick:rotateLogs, title:'Удалить лог-файлы старше 14 дней.'}, '📜 Rotate logs'),
```

**C) Add Backup status card** in the `.cards` row (around line 4784, after `Размер БД` card):

```js
      React.createElement('div',{className: 'card ' + (backupCardColor)},
        React.createElement('div',{className:'card-label'},'Бэкап'),
        React.createElement('div',{className:'card-value'}, backupLabel),
        React.createElement('div',{className:'card-sub'}, backupSub)
      ),
```

Compute helpers above the return (after `const paidShare = ...`):

```js
    const backup = stats.backup || {};
    let backupLabel = '⚠ Нет';
    let backupSub = 'Папка ' + (backup.dirExists ? 'пуста' : 'отсутствует');
    let backupCardColor = '';  // empty = default
    if (backup.lastBackupAt) {
      const ageMs = Date.now() - backup.lastBackupAt;
      const ageHours = Math.floor(ageMs / 3_600_000);
      const ageDays = Math.floor(ageHours / 24);
      if (ageHours < 36) {
        backupLabel = ageHours + 'ч назад';
        backupCardColor = 'green';
      } else if (ageDays < 7) {
        backupLabel = '⚠ ' + ageDays + 'д назад';
        backupCardColor = 'yellow';
      } else {
        backupLabel = '🚨 ' + ageDays + 'д назад';
        backupCardColor = 'card-error';
      }
      backupSub = fmtBytes(backup.lastBackupBytes);
    } else if (!backup.dirExists) {
      backupLabel = '🚨 Нет папки';
      backupCardColor = 'card-error';
    }
```

Color thresholds: green = <36h ago, yellow = 36h-7d, red = ≥7d or missing.

**CSS classes**: existing `.card` cards use `card purple|green|blue|yellow` (verified at line 4779-4784). Use `'green'`, `'yellow'`, and `'red'` for the three states. If `red` class doesn't exist in the CSS, implementer should either (a) add a `.card.red { border-color: var(--danger); }` rule to the inline stylesheet (mirror the existing yellow/green/blue defs), or (b) use the existing yellow class for the >=7d state — never both fall back to default. The exact CSS rule is a 2-line addition and trivial.

**SPA gate**: `src/admin/server.js` has inline React template literal. After any edit run `node scripts/check-admin-spa.cjs`.

---

## 4. Data flow

```
Daily setInterval (index.js)
  ├── telegram.cleanupVideoCache(3) → unlink files in data/video-cache/
  ├── db.pruneAuthSessions(24)      → DELETE auth_sessions ...
  └── logger.cleanupOldLogs(14)     → unlink *.log files in /logs/

Admin button POST /api/admin/maintenance/*
  ├── vacuum         → db.db.exec('VACUUM') (manual, ack via timer)
  ├── cleanup-video  → telegram.cleanupVideoCache(3) (manual, force)
  ├── cleanup-auth   → db.pruneAuthSessions(24) (manual, force)
  └── rotate-logs    → logger.cleanupOldLogs(14) (manual, force)

GET /api/stats now includes stats.backup:
  { lastBackupAt: ms, lastBackupBytes: int, dirExists: bool }

scripts/catalyst-backup.sh trap on EXIT:
  exit_code != 0 → curl TG sendMessage to SUPPORT_GROUP_ID
```

---

## 5. Error handling

| Path | On error |
|---|---|
| Daily setInterval prune | log warning, swallow, continue |
| Admin POST /api/admin/maintenance/* | return non-2xx with `{ error: e.message }` (existing pattern) |
| `_getStats` backup field | `try { ... } catch { /* best-effort */ }` — backup={...empty defaults} |
| Backup script trap notify | curl errors silently ignored (avoid alert loop) |

VACUUM lock contention is fine — better-sqlite3 with `busy_timeout=5000` (Bundle #10) will wait up to 5s before returning lock error.

---

## 6. Testing strategy

### 6.1 Manual smoke

- Deploy code.
- Open admin panel → Stats tab → see Бэкап card. Check label color / text matches actual VPS backup state.
- Click each of the 4 new buttons → verify `maintMsg` shows result.
- Wait ~24h → check logs for the 3 new `[Maintenance]` lines (or `if(n>0)` keep silent if nothing to prune).
- Force a backup failure (e.g. rename /var/backups/catalyst to read-only) → next cron run should send TG alert.

### 6.2 No unit tests

No test runner yet. Verification = `node --check` per file + `npm run check:spa` for admin.

### 6.3 SPA gate

After admin/server.js edits — MANDATORY `node scripts/check-admin-spa.cjs`. Inline React template literal can break on small backtick/escape mistakes.

---

## 7. Files changed (summary)

| File | Change |
|---|---|
| `src/utils/logger.js` | +1 method `cleanupOldLogs(maxAgeDays=14)` |
| `src/db/database.js` | +1 method `pruneAuthSessions(hours=24)`; refactor boot cleanup to call it |
| `src/index.js` | +3 startup prune calls + 3 daily setInterval'ы; remove old startup line 79 video cleanup (consolidated into new block) |
| `scripts/catalyst-backup.sh` | +trap notify_failure block after `set -euo pipefail`; +1 env source line |
| `src/admin/server.js` | +4 POST endpoints, +1 backup field in `_getStats`, +4 handler funcs in StatsPage, +4 buttons, +1 Backup card |
| `ai-context/SESSION_CONTEXT.md` | +1 bullet |
| `ai-context/WORKLOG.md` | +1 entry |

No DB schema. No new env vars (re-uses existing `TG_BOT_TOKEN`, `SUPPORT_GROUP_ID`).

---

## 8. Risks

- **VACUUM blocks DB ~1s** at current 10-50MB. Manual button only; explicit confirm prompt; operator sees elapsedMs in response.
- **Backup TG alert env-var dependency** — if `/etc/catalyst.env` missing on VPS, alerts silently skipped. Operator MUST verify the env file exists post-deploy for alerts to work. Verification: `bash -x /usr/local/bin/catalyst-backup.sh` should show env vars loaded.
- **Video TTL 7d → 3d** — users may notice re-mux when replaying older video. Net positive (less disk, infrequent re-mux).
- **Log retention 14d** — if incident postmortem needs >14d, escalate to operator to override before next setInterval tick.
- **`stats.backup.dirExists=false`** on dev (no /var/backups/catalyst locally) — UI shows red 🚨 Нет папки. Cosmetic on dev, intended in production.

---

## 9. Acceptance criteria

- `src/utils/logger.js` has `cleanupOldLogs` method, returns deleted count.
- `src/db/database.js` has `pruneAuthSessions`; the boot-only DELETE block now calls it.
- `src/index.js` has 3 new daily setInterval'ы; old startup `cleanupVideoCache(5)` line gone.
- `scripts/catalyst-backup.sh` has trap-based TG alert that fires on non-zero exit.
- `src/admin/server.js` has 4 new POST endpoints + stats.backup field + 4 buttons + Backup card.
- `node --check` passes on all touched JS files.
- `npm run check:spa` passes (admin SPA).
- No DB migration required.

---

## 10. Out of scope / deferred

- Predictive disk-fill alert (PROD-019 partial — we expose backup status, but predictive logic deferred). Disk guard reactive logic (every 15m) unchanged.
- Backup card row counts for tables other than the existing `trendsCount` / `notificationsCount` — could add `usersCount`, but YAGNI for this bundle.
- Logrotate config on VPS — application-level rotation makes os-side config redundant.
- Pre-emptive video cache size cap (>15GB → aggressive cleanup) — current TTL of 3d should keep disk under ~14GB. Revisit if growth observed.
