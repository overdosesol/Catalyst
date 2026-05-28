# Housekeeping + Admin UI Maintenance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Operator policy (CLAUDE.md):** Subagents do NOT make git commits — file edits only. Operator commits the entire bundle once all tasks are done.

**Goal:** Close 7 housekeeping/admin findings — daily setInterval'ы for video cache / auth_sessions / logs, TG alert on backup failure, and 4 admin maintenance buttons + Backup status widget.

**Architecture:** Backend gets a `cleanupOldLogs` method on the existing Logger, a `pruneAuthSessions` method on TrendDatabase, and 3 daily setInterval'ы in `src/index.js` (mirroring Bundle #2 + #10 patterns). `scripts/catalyst-backup.sh` gets a `trap` that fires a TG alert on any non-zero exit. Admin server exposes 4 new POST endpoints + a `stats.backup` field; the inline SPA gains 4 maintenance buttons + a Backup status card.

**Tech Stack:** Node.js (ESM, `"type": "module"`), better-sqlite3, node-telegram-bot-api, bash for the backup script. No new deps.

**Spec:** `docs/superpowers/specs/2026-05-28-housekeeping-admin-ui-design.md`

---

## File structure

| File | Action | Responsibility |
|---|---|---|
| `src/utils/logger.js` | MODIFY | +1 method `cleanupOldLogs` |
| `src/db/database.js` | MODIFY | +1 method `pruneAuthSessions`; refactor existing boot cleanup to call it |
| `src/index.js` | MODIFY | -1 old startup line; +3 startup + 3 daily setInterval'ы |
| `scripts/catalyst-backup.sh` | MODIFY | +trap-based TG alert + env source |
| `src/admin/server.js` | MODIFY | +4 POST endpoints; extend `_getStats` with backup info; +SPA changes (handlers + 4 buttons + 1 Backup card) |
| `ai-context/SESSION_CONTEXT.md` | MODIFY | +1 bullet under Production posture |
| `ai-context/WORKLOG.md` | MODIFY | +1 top entry |

No test files (no test runner yet). Verification = `node --check` for JS, `bash -n` for the shell script, `npm run check:spa` for admin SPA.

---

## Task 1: logger.js — cleanupOldLogs method

**Files:**
- Modify: `src/utils/logger.js`

- [ ] **Step 1: Add cleanupOldLogs method**

Open `src/utils/logger.js`. Currently the file (47 LOC) has class `Logger` with: constructor, `_format`, `_write`, `debug`, `info`, `warn`, `error`, and `export default Logger;` at the bottom.

Add a new method INSIDE the class, after `error(msg, data) { ... }` (around line 42) and BEFORE the closing `}` of the class.

Insert:

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

`fs` and `path` are already imported at the top (lines 1-2).

- [ ] **Step 2: Verify parse**

Run: `node --check src/utils/logger.js`
Expected: no output, exit code 0.

- [ ] **Step 3: Verify method exists and exports**

Run:
```bash
node --input-type=module -e "import('./src/utils/logger.js').then(m => { const L = new m.default('info'); console.log(typeof L.cleanupOldLogs); });"
```
Expected stdout: `function`

- [ ] **Step 4: Report DONE — do not commit**

---

## Task 2: database.js — pruneAuthSessions + refactor boot cleanup

**Files:**
- Modify: `src/db/database.js` (lines ~453-460 + new method near line ~2600)

- [ ] **Step 1: Add pruneAuthSessions method**

Locate the prune methods cluster — `pruneTagRefreshHistory` from Bundle #10 (around line 2596-2600). After its closing `}`, add:

```js

  pruneAuthSessions(maxAgeHours = 24) {
    const res = this.db.prepare(
      `DELETE FROM auth_sessions WHERE token IS NULL AND created_at < datetime('now', ?)`
    ).run(`-${maxAgeHours} hours`);
    return res.changes | 0;
  }
```

Same pattern as `pruneAlertDecisions`, `pruneFeatureUsageLog`, and the B10 methods.

- [ ] **Step 2: Refactor existing boot cleanup to call the method**

Find the existing boot-only cleanup (around line 453-460):

```js
    // Housekeeping — prune anything that's fully expired and has no token
    try {
      this.db.prepare(
        `DELETE FROM auth_sessions
         WHERE token IS NULL
           AND created_at < datetime('now', '-1 day')`
      ).run();
    } catch (e) { /* best-effort */ }
```

Replace with:

```js
    // Housekeeping — prune anything that's fully expired and has no token.
    // Daily setInterval in src/index.js (Bundle #6) covers ongoing prunes.
    try { this.pruneAuthSessions(24); }
    catch { /* best-effort at boot */ }
```

Behavior preserved (boot cleanup still runs, same 24h threshold).

- [ ] **Step 3: Verify parse**

Run: `node --check src/db/database.js`
Expected: no output, exit code 0.

- [ ] **Step 4: Verify both changes**

Run:
```bash
grep -n "pruneAuthSessions" src/db/database.js
```
Expected: 2 lines — method declaration (around line 2602) + boot call (around line 455).

Run:
```bash
grep -c "DELETE FROM auth_sessions" src/db/database.js
```
Expected: `1` (only inside the new method; the boot DELETE literal should be gone, replaced by `this.pruneAuthSessions(24)`).

- [ ] **Step 5: Report DONE — do not commit**

---

## Task 3: catalyst-backup.sh — TG alert on failure

**Files:**
- Modify: `scripts/catalyst-backup.sh` (insert after line 7, `set -euo pipefail`)

- [ ] **Step 1: Add env source + trap block**

Open `scripts/catalyst-backup.sh`. Locate line 7: `set -euo pipefail`. Right AFTER it (so new lines become lines 8-22 ish), insert:

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
      > /dev/null 2>&1 || true
  fi
  exit "$exit_code"
}

trap notify_failure EXIT
```

Do NOT remove the existing `BACKUP_DIR=`, `DATE=`, or any other line that follows. Just inserting between line 7 and the rest.

- [ ] **Step 2: Verify shell syntax**

Run: `bash -n scripts/catalyst-backup.sh`
Expected: no output, exit code 0.

If you get a parse error — your insertion broke shell quoting/escape. Investigate.

- [ ] **Step 3: Verify trap registered**

Run:
```bash
grep -n "trap notify_failure EXIT" scripts/catalyst-backup.sh
```
Expected: 1 line.

Run:
```bash
grep -n "notify_failure()" scripts/catalyst-backup.sh
```
Expected: 1 line (the function definition).

- [ ] **Step 4: Self-review**

- Trap is registered via `trap notify_failure EXIT` (EXIT signal — fires on any exit).
- Inside the function, exit-0 case short-circuits (`exit 0` early return).
- curl uses `--data-urlencode` (safe for special chars in text).
- `|| true` after curl prevents curl failure from breaking the script's own exit code propagation.
- `exit "$exit_code"` at the end of the function preserves the original failure code for cron logs.

- [ ] **Step 5: Report DONE — do not commit**

---

## Task 4: index.js — 3 daily setInterval'ы + remove old startup video cleanup

**Files:**
- Modify: `src/index.js` (line 79 + insert after Bundle #10 block ~line 173)

- [ ] **Step 1: Remove the old startup video cleanup line**

Open `src/index.js`. Find this line (around line 79):

```js
try { telegram.cleanupVideoCache(5); } catch {}
```

(Note the surrounding comment may say "Prune muxed video cache on startup (files older than 7 days)" — comment can stay or be deleted; the code line MUST be removed since we're replacing it with a startup call in the new Bundle #6 block.)

DELETE just the `try { telegram.cleanupVideoCache(5); } catch {}` line.

Also DELETE the preceding comment line (`// Prune muxed video cache on startup (files older than 7 days)`) if it's still there — the new block has its own comment block. Keep surrounding code intact.

- [ ] **Step 2: Locate the new insertion point**

Find the Bundle #10 retention block (search for `// Bundle #10 (2026-05-28): retention for notifications`). That block ends with the 4th setInterval around the `pruneTagRefreshHistory` call (will be around line 170-173). The next line is `// ── Initialize Solana Pay Monitor ───...` or a blank line.

Insert the new Bundle #6 block BETWEEN the last B10 setInterval and the Solana Monitor comment.

- [ ] **Step 3: Add the new block**

Insert exactly this:

```js

// Bundle #6 (2026-05-28): housekeeping daily loops.
// video-cache       — 3d  (DB-010 + DB-023 — tightened from 7d default for disk safety)
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

- [ ] **Step 4: Verify parse**

Run: `node --check src/index.js`
Expected: no output, exit code 0.

- [ ] **Step 5: Verify old line removed**

Run:
```bash
grep -c "cleanupVideoCache(5)" src/index.js
```
Expected: `0` (the old line is gone). The new block uses `VIDEO_CACHE_RETENTION_DAYS` (=3) constant instead.

- [ ] **Step 6: Verify new constants added**

Run:
```bash
grep -n "VIDEO_CACHE_RETENTION_DAYS\|AUTH_SESSIONS_RETENTION_HOURS\|LOG_RETENTION_DAYS" src/index.js
```
Expected: ≥3 lines (the 3 const declarations + usages).

- [ ] **Step 7: Report DONE — do not commit**

---

## Task 5: admin/server.js — 4 POST endpoints + stats.backup field

**Files:**
- Modify: `src/admin/server.js` (insert after line 1032 + extend `_getStats`)

**Important**: `src/admin/server.js` carries inline React SPA. After this task we don't need an SPA gate yet because we're only editing route-handler JS (well above the SPA template). T6 covers SPA-affecting changes + the gate.

- [ ] **Step 1: Add 4 new POST endpoint handlers**

Locate the existing `/api/alerts/cleanup` handler at line 1027-1032:

```js
      if (path === '/api/alerts/cleanup' && method === 'POST') {
        const body = await parseBody(req).catch(() => ({}));
        const days = Math.max(1, Math.min(365, Number(body.days || 30)));
        const result = this.db.cleanupAlerts(days);
        return json(res, 200, { ok: true, ...result });
      }
```

Immediately AFTER its closing `}` (line 1032), insert these 4 new handlers:

```js

      if (path === '/api/admin/maintenance/vacuum' && method === 'POST') {
        const t0 = Date.now();
        try {
          this.db.db.exec('VACUUM');
          return json(res, 200, { ok: true, elapsedMs: Date.now() - t0 });
        } catch (e) {
          this.logger.error(`[Maintenance] VACUUM failed: ${e.message}`);
          return json(res, 500, { error: e.message });
        }
      }

      if (path === '/api/admin/maintenance/cleanup-video' && method === 'POST') {
        try {
          if (this.telegram?.cleanupVideoCache) {
            this.telegram.cleanupVideoCache(3);
          }
          return json(res, 200, { ok: true });
        } catch (e) {
          this.logger.error(`[Maintenance] cleanup-video failed: ${e.message}`);
          return json(res, 500, { error: e.message });
        }
      }

      if (path === '/api/admin/maintenance/cleanup-auth' && method === 'POST') {
        try {
          const removed = this.db.pruneAuthSessions(24);
          return json(res, 200, { ok: true, removed });
        } catch (e) {
          this.logger.error(`[Maintenance] cleanup-auth failed: ${e.message}`);
          return json(res, 500, { error: e.message });
        }
      }

      if (path === '/api/admin/maintenance/rotate-logs' && method === 'POST') {
        try {
          const removed = this.logger.cleanupOldLogs(14);
          return json(res, 200, { ok: true, removed });
        } catch (e) {
          this.logger.error(`[Maintenance] rotate-logs failed: ${e.message}`);
          return json(res, 500, { error: e.message });
        }
      }
```

`this.logger`, `this.db`, `this.telegram` are already class properties (constructor at line 103).

- [ ] **Step 2: Extend `_getStats` with backup info**

Locate the `_getStats()` method (search for `_getStats() {` or similar). Read the method to understand its return shape — it builds a `stats` object with fields like `users`, `revenue`, `storage`, etc.

Just before the `return stats;` (or wherever the return is), add:

```js
    // Bundle #6 — Backup status info for admin UI Backup card.
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
    stats.backup = backup;
```

(If `stats` is not the local variable name — use whichever name the existing code uses. If `_getStats` directly returns an object literal, restructure: pull the object into `const stats = { ... }`, then append `stats.backup = backup;`, then `return stats;`.)

Verify `fs` and `path` are already imported at the top of `src/admin/server.js`. They almost certainly are (most server files have them). If not — add `import fs from 'fs';` and `import path from 'path';` at the top.

- [ ] **Step 3: Verify parse**

Run: `node --check src/admin/server.js`
Expected: no output, exit code 0.

- [ ] **Step 4: Verify 4 new routes**

Run:
```bash
grep -n "/api/admin/maintenance/" src/admin/server.js
```
Expected: 4 lines.

- [ ] **Step 5: Verify backup field in _getStats**

Run:
```bash
grep -n "stats.backup\|backup.dirExists\|backup.lastBackupAt" src/admin/server.js
```
Expected: ≥3 lines.

- [ ] **Step 6: Report DONE — do not commit**

(SPA validator deferred to T6 — both T5 and T6 are in admin/server.js but T5 doesn't touch the inline template literal. T6 will run the SPA validator covering both.)

---

## Task 6: admin/server.js SPA — handlers + 4 buttons + Backup card (+ SPA gate)

**Files:**
- Modify: `src/admin/server.js` (inside `StatsPage` function, around line 4717-4828)

**Critical**: this task edits the inline React SPA template literal. After editing, MUST run `node scripts/check-admin-spa.cjs`.

- [ ] **Step 1: Add 4 handler functions in StatsPage**

Open `src/admin/server.js`. Find `StatsPage()` (around line 4717). Find the existing `cleanupAlerts` handler (around line 4736-4745). AFTER that handler's closing `};` (around line 4745), insert these 4 new handlers:

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

- [ ] **Step 2: Add backup card computation block**

Find the existing line near top of the return: `const paidShare = stats.users.total ? Math.round(...) : 0;` (around line 4769). After the `activeShare` computation (around line 4770), add:

```js
    const backup = stats.backup || {};
    let backupLabel = '⚠ Нет';
    let backupSub = 'Папка ' + (backup.dirExists ? 'пуста' : 'отсутствует');
    let backupCardColor = 'yellow';
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
        backupCardColor = 'yellow';
      }
      backupSub = fmtBytes(backup.lastBackupBytes);
    } else if (!backup.dirExists) {
      backupLabel = '🚨 Нет папки';
      backupCardColor = 'yellow';
    }
```

Note on color: we use `yellow` for both warning and danger because the existing CSS only defines `purple/green/blue/yellow` card colors. Adding a new red class is out of scope for this bundle. The emoji prefix (⚠ / 🚨) carries the severity signal.

- [ ] **Step 3: Insert Backup card after Размер БД card**

Find the `Размер БД` card (around line 4784):

```js
      React.createElement('div',{className:'card'},React.createElement('div',{className:'card-label'},'Размер БД'),React.createElement('div',{className:'card-value'},fmtBytes(stats.storage.dbBytes)),React.createElement('div',{className:'card-sub'},stats.storage.trendsCount+' trends · '+stats.storage.notificationsCount+' notifications'))
```

After this line (it's the last entry in the `cards` div before the closing `)`), add a comma + new card. The line will become:

```js
      React.createElement('div',{className:'card'},React.createElement('div',{className:'card-label'},'Размер БД'),React.createElement('div',{className:'card-value'},fmtBytes(stats.storage.dbBytes)),React.createElement('div',{className:'card-sub'},stats.storage.trendsCount+' trends · '+stats.storage.notificationsCount+' notifications')),
      React.createElement('div',{className:'card ' + backupCardColor},React.createElement('div',{className:'card-label'},'Бэкап'),React.createElement('div',{className:'card-value'},backupLabel),React.createElement('div',{className:'card-sub'},backupSub))
```

Make sure the `cards` div closing `)` is now AFTER the new card.

- [ ] **Step 4: Add 4 maintenance buttons next to cleanupAlerts button**

Find the existing `🧹 Очистить старые алерты` button (around line 4828):

```js
        React.createElement('button',{className:'btn btn-danger btn-sm',onClick:cleanupAlerts},'🧹 Очистить старые алерты'),
```

Immediately AFTER this line, add 4 new button lines:

```js
        React.createElement('button',{className:'btn btn-warning btn-sm',onClick:runVacuum, title:'Сжать БД (VACUUM). Блокирует на ~1с.'},'💾 VACUUM'),
        React.createElement('button',{className:'btn btn-secondary btn-sm',onClick:cleanupVideoCache, title:'Удалить muxed видео старше 3 дней.'},'🎞 Video cache'),
        React.createElement('button',{className:'btn btn-secondary btn-sm',onClick:cleanupAuthSessions, title:'Удалить незавершённые auth-сессии старше 24ч.'},'🔑 Auth sessions'),
        React.createElement('button',{className:'btn btn-secondary btn-sm',onClick:rotateLogs, title:'Удалить лог-файлы старше 14 дней.'},'📜 Rotate logs'),
```

Keep the existing surrounding container intact. If the original cleanupAlerts button ends with `,` after its closing `)` — the new buttons fit. If it ends with `)` (no comma), add the comma before inserting.

- [ ] **Step 5: Verify parse**

Run: `node --check src/admin/server.js`
Expected: no output, exit code 0.

If parse fails — your insert broke the template literal or JSX. Revert and re-inspect surrounding code.

- [ ] **Step 6: MANDATORY — run SPA validator**

Run: `node scripts/check-admin-spa.cjs`
Expected: success message, exit code 0.

**If SPA validator fails** — STOP. Revert your edits in T6 (the SPA changes). Report BLOCKED with exact stderr. Almost certainly your insert introduced a backtick or template-literal-breaking sequence. Do not try to "fix" — revert and request guidance.

- [ ] **Step 7: Verify all 4 handlers + 4 buttons + backup card**

Run:
```bash
grep -c "runVacuum\|cleanupVideoCache\|cleanupAuthSessions\|rotateLogs" src/admin/server.js
```
Expected: ≥8 (4 handler declarations + 4 button onClick references).

Run:
```bash
grep -c "backupLabel\|backupCardColor\|backupSub" src/admin/server.js
```
Expected: ≥6 (3 var declarations + 3 usages in the card createElement).

- [ ] **Step 8: Report DONE — do not commit**

---

## Task 7: ai-context updates (no commit — operator handles)

**Files:**
- Modify: `ai-context/SESSION_CONTEXT.md`
- Modify: `ai-context/WORKLOG.md`

- [ ] **Step 1: Add Production posture bullet to SESSION_CONTEXT.md**

Open `ai-context/SESSION_CONTEXT.md`. Find the existing **Bundle #10** bullet (search for `Bundle #10`). Insert a new bullet immediately AFTER it:

```markdown
- **Bundle #6 (Housekeeping + admin UI)** — daily setInterval'ы в `index.js`: video-cache 3d (tightened from 7d), auth_sessions 24h, logs 14d. `src/utils/logger.js` `cleanupOldLogs()` method. `scripts/catalyst-backup.sh` trap-based TG alert на failure (через `SUPPORT_GROUP_ID`). Admin UI Stats tab: 4 новых maintenance buttons (VACUUM / Video / Auth / Logs) + Backup status card с age-based color (зелёный<36ч / жёлтый ≥36ч). Закрывает DB-010/011/014, DB-022/023, PROD-019, ADM-004. Требует `/etc/catalyst.env` на VPS для backup alert'ов.
```

If you can't find "Bundle #10" — locate Production posture and append at end. Report DONE_WITH_CONCERNS describing placement.

- [ ] **Step 2: Add WORKLOG entry on top**

Open `ai-context/WORKLOG.md`. Insert a new entry directly after the file header and BEFORE the current top entry:

```markdown
## 2026-05-28 · sonnet · Bundle #6: Housekeeping + admin UI maintenance — 3 daily prunes + 4 admin buttons + backup widget

**Цель:** Закрыть DB-010 (video-cache daily), DB-011 (auth_sessions daily), DB-014 (log rotation), DB-022 (backup TG alert), DB-023 (video TTL tighten), PROD-019 (disk visibility), ADM-004 (admin maintenance gap).

**Файлы:**
- `src/utils/logger.js` — +1 method `cleanupOldLogs(maxAgeDays=14)`.
- `src/db/database.js` — +1 method `pruneAuthSessions(maxAgeHours=24)`. Boot cleanup refactored to call it.
- `src/index.js` — −1 startup line (old `cleanupVideoCache(5)`); +3 startup prune calls + 3 daily setInterval'ы (по B2 паттерну). Constants: `VIDEO_CACHE_RETENTION_DAYS=3`, `AUTH_SESSIONS_RETENTION_HOURS=24`, `LOG_RETENTION_DAYS=14`.
- `scripts/catalyst-backup.sh` — +env source from `/etc/catalyst.env` + trap-based curl TG sendMessage on non-zero exit. Tg destination: `SUPPORT_GROUP_ID` (re-uses B13 env). Silent skip if vars unset.
- `src/admin/server.js` — +4 POST endpoints `/api/admin/maintenance/{vacuum,cleanup-video,cleanup-auth,rotate-logs}`. `_getStats` теперь включает `stats.backup={lastBackupAt, lastBackupBytes, dirExists}`. SPA: +4 handler funcs в StatsPage, +4 buttons рядом с cleanupAlerts, +Backup status card с age-based color/emoji. SPA gate ✅.

**Деплой:** оператор-driven (deploy.ps1). Дополнительно: убедиться что `/etc/catalyst.env` на VPS содержит `TG_BOT_TOKEN` и `SUPPORT_GROUP_ID` для backup alerts. Иначе alerts silent skipped (не блокирует backup).

**Риски:** VACUUM lock ~1с на текущем размере БД (10-50MB) — manual button с confirm prompt. Video TTL 7d→3d может вызывать re-mux редко replay'ленных видео (acceptable trade-off). Log retention 14d — короче на бОльших инцидентах (operator может override через env).

**Не сделано:** predictive disk-fill alert (PROD-019 частично), explicit logrotate config — application-level cleanup делает ос-side избыточным. Backup card cosmetic 🚨 на dev (нет /var/backups/catalyst локально) — intended.
```

- [ ] **Step 3: Verify**

Run:
```bash
grep -c "Bundle #6" ai-context/SESSION_CONTEXT.md
grep -c "Bundle #6" ai-context/WORKLOG.md
grep -c "^## 2026" ai-context/WORKLOG.md
```

Expected:
- SESSION_CONTEXT: ≥1
- WORKLOG: ≥1
- WORKLOG entry count: 13. WORKLOG is now over soft cap (12). Don't auto-rotate — flag in report.

- [ ] **Step 4: Report DONE_WITH_CONCERNS (WORKLOG at 13 entries — operator should consider rotation per AGENT_RULES §6 before next bundle).**

Or if WORKLOG count is at 12 — report **DONE** straight.

---

## Final verification (run after all 7 tasks)

- [ ] **Combined parse check**

Run:
```bash
node --check src/utils/logger.js && \
node --check src/db/database.js && \
node --check src/index.js && \
node --check src/admin/server.js && \
bash -n scripts/catalyst-backup.sh
```
Expected: all 5 succeed.

- [ ] **SPA gate**

Run: `npm run check:spa`
Expected: both validators pass.

- [ ] **Bundle marker check**

Run:
```bash
grep -rn "Bundle #6 " src/utils/logger.js src/db/database.js src/index.js src/admin/server.js scripts/catalyst-backup.sh ai-context/*.md | head -20
```
Expected: at least 6 occurrences across the touched files.

- [ ] **Endpoint count**

Run:
```bash
grep -c "/api/admin/maintenance/" src/admin/server.js
```
Expected: 4 in route handlers (1 each per endpoint) + 4 in SPA fetch calls = 8 total.

- [ ] **Working tree summary**

Run: `git status --short`
Expected: 6 modified files (logger.js, database.js, index.js, admin/server.js, catalyst-backup.sh, SESSION_CONTEXT.md, WORKLOG.md). Plus 2 docs (spec + plan).

---

## Post-implementation: operator deploy procedure

Operator runs (NOT a subagent task):

1. Verify `/etc/catalyst.env` on VPS contains `TG_BOT_TOKEN` and `SUPPORT_GROUP_ID`. If missing, copy them from the app's `.env` or `docker-compose.yml`. Backup alerts depend on this.
2. Run `deploy.ps1` (the existing deploy script will rsync `scripts/catalyst-backup.sh` to `/usr/local/bin/`).
3. Sanity-check: `bash -x /usr/local/bin/catalyst-backup.sh` should show env vars loaded.
4. Tail logs — first hour should show `[Maintenance] auth_sessions: pruned N` etc. as the daily setInterval'ы fire on startup.
5. Open admin panel → Stats tab → confirm Backup card shows current backup age. Click each new button to smoke-test endpoints.
