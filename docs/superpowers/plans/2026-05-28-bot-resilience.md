# Bot Resilience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Operator policy (CLAUDE.md):** Subagents do NOT make git commits — file edits only. Operator commits the entire bundle once all tasks are done.

**Goal:** Make outbound Telegram sends robust against TG 429 rate-limits and persist `users.status='suspended'` in broadcast loop when users have blocked the bot — closes BOT-006 and BOT-007.

**Architecture:** New ESM utility `src/notifications/telegram-retry.js` exporting `withTelegramRetry(sendFn, opts)`. Helper retries once on HTTP 429 honoring TG's `retry_after` payload (with 60s safety cap). Three callsites use it: `sendAlertToUser` (6 sub-sends), admin broadcast (1 send + new 403 handler), and `notifyAdminCrash` (1 send).

**Tech Stack:** Node.js (ESM, `"type": "module"`), better-sqlite3 (`this.db.db.prepare()`), node-telegram-bot-api (^0.67.0). No new dependencies. No DB migrations.

**Spec:** `docs/superpowers/specs/2026-05-28-bot-resilience-design.md`

---

## File structure

| File | Action | Responsibility |
|---|---|---|
| `src/notifications/telegram-retry.js` | **CREATE** | Pure utility: `withTelegramRetry(sendFn, opts)` — 1-retry on 429 with honor-retry_after |
| `src/notifications/telegram.js` | MODIFY | Import helper; wrap 6 send-sites in `sendAlertToUser` pathway |
| `src/admin/server.js` | MODIFY | Import helper; wrap broadcast send; add 403→suspended in catch |
| `src/notifications/admin-alert.js` | MODIFY | Import helper; wrap support-group send |
| `ai-context/SESSION_CONTEXT.md` | MODIFY | One bullet in Production posture |
| `ai-context/WORKLOG.md` | MODIFY | New top entry |

No test files in this plan — project has no test runner yet. Verification = `node --check` (parser) + `npm run check:spa` for files with inline SPA template (admin/server.js).

---

## Task 1: Create telegram-retry.js utility

**Files:**
- Create: `src/notifications/telegram-retry.js`

- [ ] **Step 1: Create the file with full implementation**

Path: `src/notifications/telegram-retry.js`

```js
// Bot resilience helper — Bundle #15 (2026-05-28).
//
// Wraps any async Telegram send call. On HTTP 429 (rate-limit), reads the
// `retry_after` payload from the TG error and sleeps for that long (capped
// at 60s) before retrying ONCE. Any other error — including 403 (user
// blocked the bot) — re-throws immediately so the caller can decide what
// to do.
//
// Usage:
//   import { withTelegramRetry } from './telegram-retry.js';
//   const sent = await withTelegramRetry(
//     () => bot.sendMessage(chatId, text, opts),
//     { logger: this.logger, label: 'alert-text' }
//   );

const DEFAULT_MAX_RETRIES = 1;          // 1 retry → 2 attempts total
const DEFAULT_RETRY_CAP_MS = 60 * 1000; // 60s safety cap on retry_after
const FALLBACK_RETRY_AFTER_MS = 5000;   // when TG didn't include retry_after

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function is429(err) { return err?.response?.statusCode === 429; }

function extractRetryAfterMs(err, capMs) {
  const r = err?.response?.body?.parameters?.retry_after;
  if (typeof r === 'number' && r > 0) return Math.min(r * 1000, capMs);
  return FALLBACK_RETRY_AFTER_MS;
}

export async function withTelegramRetry(sendFn, opts = {}) {
  const {
    maxRetries = DEFAULT_MAX_RETRIES,
    retryCapMs = DEFAULT_RETRY_CAP_MS,
    logger = null,
    label = 'tg-send',
  } = opts;
  let attempt = 0;
  while (true) {
    try {
      return await sendFn();
    } catch (err) {
      if (!is429(err) || attempt >= maxRetries) throw err;
      attempt++;
      const waitMs = extractRetryAfterMs(err, retryCapMs);
      if (logger?.warn) {
        logger.warn(`[${label}] TG 429 — sleeping ${waitMs}ms before retry ${attempt}/${maxRetries}`);
      }
      await sleep(waitMs);
    }
  }
}
```

- [ ] **Step 2: Verify the file parses**

Run: `node --check src/notifications/telegram-retry.js`
Expected: no output, exit code 0.

- [ ] **Step 3: Verify the module imports correctly**

Run:
```bash
node --input-type=module -e "import('./src/notifications/telegram-retry.js').then(m => console.log(typeof m.withTelegramRetry));"
```
Expected output: `function`

- [ ] **Step 4: Report DONE — do not commit**

Operator commits the whole bundle later.

---

## Task 2: Wire telegram.js — 6 send wraps + import

**Files:**
- Modify: `src/notifications/telegram.js` (top imports + lines 1261, 1321, 1340, 1375, 1385, 1405)

- [ ] **Step 1: Add import at top of file**

Locate the existing imports block (lines 1-20). After the last `import` line (currently `import { notifyAdminCrash } from './admin-alert.js';` at line 20), add:

```js
import { withTelegramRetry } from './telegram-retry.js';
```

- [ ] **Step 2: Wrap `_sendPlainTextChunked` send at line 1261**

Current code (line 1261, last line of the function before the closing brace):
```js
    return this.bot.sendMessage(chatId, outgoing, opts);
```

Replace with:
```js
    return withTelegramRetry(
      () => this.bot.sendMessage(chatId, outgoing, opts),
      { logger: this.logger, label: 'alert-text' }
    );
```

- [ ] **Step 3: Wrap `sendVideo` at line 1321**

Current code (inside `sendAlertToUser`, inside `if (videoUrl && imageUrls.length < 2)` branch):
```js
        try {
          sentMsg = await this.bot.sendVideo(chatId, videoSource, {
            caption: fitsInCaption ? message : undefined,
            parse_mode: 'HTML',
            supports_streaming: true,
          });
```

Replace with:
```js
        try {
          sentMsg = await withTelegramRetry(
            () => this.bot.sendVideo(chatId, videoSource, {
              caption: fitsInCaption ? message : undefined,
              parse_mode: 'HTML',
              supports_streaming: true,
            }),
            { logger: this.logger, label: 'alert-video' }
          );
```

- [ ] **Step 4: Wrap `sendPhoto` fallback at line 1340**

Current code (inside the catch after sendVideo fail):
```js
            try {
              sentMsg = await this.bot.sendPhoto(chatId, fallbackImg, {
                caption: fitsInCaption ? message : undefined,
                parse_mode: 'HTML',
              });
```

Replace with:
```js
            try {
              sentMsg = await withTelegramRetry(
                () => this.bot.sendPhoto(chatId, fallbackImg, {
                  caption: fitsInCaption ? message : undefined,
                  parse_mode: 'HTML',
                }),
                { logger: this.logger, label: 'alert-photo-fallback' }
              );
```

- [ ] **Step 5: Wrap `sendMediaGroup` at line 1375**

Current code (inside `else if (imageUrls.length >= 2)` branch):
```js
          const group = await this.bot.sendMediaGroup(chatId, media, { disable_notification: true });
```

Replace with:
```js
          const group = await withTelegramRetry(
            () => this.bot.sendMediaGroup(chatId, media, { disable_notification: true }),
            { logger: this.logger, label: 'alert-album' }
          );
```

- [ ] **Step 6: Wrap `sendPhoto` fallback at line 1385**

Current code (inside catch after sendMediaGroup fail):
```js
          try {
            sentMsg = await this.bot.sendPhoto(chatId, imageUrls[0], {
              caption: fitsInCaption ? message : undefined,
              parse_mode: 'HTML',
            });
```

Replace with:
```js
          try {
            sentMsg = await withTelegramRetry(
              () => this.bot.sendPhoto(chatId, imageUrls[0], {
                caption: fitsInCaption ? message : undefined,
                parse_mode: 'HTML',
              }),
              { logger: this.logger, label: 'alert-photo-album-fallback' }
            );
```

- [ ] **Step 7: Wrap single-photo `sendPhoto` at line 1405**

Current code (inside `else if (imageUrls.length === 1)` branch):
```js
        try {
          sentMsg = await this.bot.sendPhoto(chatId, imageUrls[0], {
            caption: fitsInCaption ? message : undefined,
            parse_mode: 'HTML',
          });
```

Replace with:
```js
        try {
          sentMsg = await withTelegramRetry(
            () => this.bot.sendPhoto(chatId, imageUrls[0], {
              caption: fitsInCaption ? message : undefined,
              parse_mode: 'HTML',
            }),
            { logger: this.logger, label: 'alert-photo' }
          );
```

- [ ] **Step 8: Verify file parses**

Run: `node --check src/notifications/telegram.js`
Expected: no output, exit code 0.

- [ ] **Step 9: Verify exactly 6 wrap sites**

Run:
```bash
grep -c "withTelegramRetry(" src/notifications/telegram.js
```
Expected output: `7` (1 import line + 6 call sites).

- [ ] **Step 10: Report DONE — do not commit**

---

## Task 3: Wire admin/server.js broadcast (BOT-007) + SPA gate

**Files:**
- Modify: `src/admin/server.js` (top imports + lines 772, 805)

Critical: `src/admin/server.js` carries a huge inline React SPA template literal. After editing, run `npm run check:spa` per CLAUDE.md gotcha.

- [ ] **Step 1: Add import at top of file**

Locate the existing import block at top of file. After the last `import` line, add:

```js
import { withTelegramRetry } from '../notifications/telegram-retry.js';
```

If unsure where the import block ends, find the first non-import top-level statement (function/class/const/export) and insert above it.

- [ ] **Step 2: Wrap broadcast send at line 772**

Current code inside `_broadcast` method:
```js
    for (const u of users) {
      try {
        const sentMsg = await this.bot.sendMessage(u.telegram_chat_id, message, { parse_mode: 'HTML' });
```

Replace the `await this.bot.sendMessage(...)` line with:
```js
        const sentMsg = await withTelegramRetry(
          () => this.bot.sendMessage(u.telegram_chat_id, message, { parse_mode: 'HTML' }),
          { logger: this.logger, label: 'broadcast' }
        );
```

Keep the surrounding `try {`, `for (const u of users) {`, etc. untouched.

- [ ] **Step 3: Extend catch at line 805 with 403 detection**

Current code:
```js
      } catch { failed++; }
```

Replace with:
```js
      } catch (err) {
        if (err?.response?.statusCode === 403) {
          try {
            this.db.db.prepare('UPDATE users SET status = ? WHERE id = ?').run('suspended', u.id);
          } catch { /* ignore secondary failure */ }
        }
        failed++;
      }
```

- [ ] **Step 4: Verify file parses**

Run: `node --check src/admin/server.js`
Expected: no output, exit code 0.

- [ ] **Step 5: Run SPA validator (mandatory per CLAUDE.md)**

Run: `node scripts/check-admin-spa.cjs`
Expected: success message, exit code 0.

If validator fails — STOP, revert your edits, and report the failure with the exact stderr output. Do not proceed to the next task.

- [ ] **Step 6: Verify wrap count**

Run:
```bash
grep -c "withTelegramRetry(" src/admin/server.js
```
Expected output: `2` (1 import + 1 call site).

- [ ] **Step 7: Report DONE — do not commit**

---

## Task 4: Wire admin-alert.js — wrap notifyAdminCrash send

**Files:**
- Modify: `src/notifications/admin-alert.js` (top + line 91)

- [ ] **Step 1: Add import at top of file**

Locate the top of `src/notifications/admin-alert.js`. The file starts with a block comment (lines 1-9) and then `let _bot = null;` at line 11. Insert the import on line 10 (between the comment and the module-state vars):

```js
import { withTelegramRetry } from './telegram-retry.js';
```

- [ ] **Step 2: Wrap `_bot.sendMessage` inside the existing try block (line 91)**

Current code (lines 90-99):
```js
  try {
    await _bot.sendMessage(_groupId, msg, {
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      disable_notification: false,
    });
  } catch (e) {
    // Admin TG send failed — log and swallow. Don't cascade into another crash.
    _logger.warn(`[admin-alert] sendMessage to admin group failed: ${e.message}`);
  }
```

Replace the inner `await _bot.sendMessage(...)` with:
```js
    await withTelegramRetry(
      () => _bot.sendMessage(_groupId, msg, {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        disable_notification: false,
      }),
      { logger: _logger, label: 'admin-crash' }
    );
```

The surrounding `try { ... } catch (e) { _logger.warn(...) }` stays untouched.

- [ ] **Step 3: Verify file parses**

Run: `node --check src/notifications/admin-alert.js`
Expected: no output, exit code 0.

- [ ] **Step 4: Verify wrap count**

Run:
```bash
grep -c "withTelegramRetry(" src/notifications/admin-alert.js
```
Expected output: `2` (1 import + 1 call site).

- [ ] **Step 5: Report DONE — do not commit**

---

## Task 5: ai-context updates (no commit — operator handles)

**Files:**
- Modify: `ai-context/SESSION_CONTEXT.md` (Production posture section)
- Modify: `ai-context/WORKLOG.md` (new top entry)

- [ ] **Step 1: Add Production posture bullet to SESSION_CONTEXT.md**

Open `ai-context/SESSION_CONTEXT.md`. Find the "Production posture" section. Locate the existing bullet about Bundle #13 (Error visibility). Insert a new bullet directly below it:

```markdown
- **Bundle #15 (Bot resilience)** — `src/notifications/telegram-retry.js` `withTelegramRetry(sendFn)` обёртка: 1 retry на TG 429 с honor `retry_after` (cap 60s). Применена в `sendAlertToUser` (6 sites), broadcast loop в `admin/server.js`, и `notifyAdminCrash`. Закрывает BOT-006. Broadcast loop теперь маркирует `users.status='suspended'` на 403 — закрывает BOT-007. BOT-021 (global token bucket) отложен — низкий риск при текущем масштабе.
```

If the location is unclear, search for `Bundle #13` and insert the new bullet on the next line.

- [ ] **Step 2: Add WORKLOG entry on top**

Open `ai-context/WORKLOG.md`. The file starts with a header, then has entries in reverse-chronological order (newest first). Insert a new entry immediately AFTER the header but BEFORE the first existing entry:

```markdown
## 2026-05-28 · sonnet · Bundle #15: Bot resilience — 429 retry + broadcast 403→suspended

**Цель:** Закрыть BOT-006 (TG 429 не honor'ится) и BOT-007 (broadcast 403 не маркирует suspended).

**Файлы:**
- `src/notifications/telegram-retry.js` (new, ~40 LOC ESM) — `withTelegramRetry(sendFn, opts)`: 1 retry на 429, honor `retry_after` (cap 60s), fallback 5s. Non-429 → immediate re-throw.
- `src/notifications/telegram.js` — import + 6 wrap sites в `sendAlertToUser` pathway (sendMessage в `_sendPlainTextChunked`, sendVideo, sendMediaGroup, 3× sendPhoto).
- `src/admin/server.js` — import + wrap broadcast `bot.sendMessage` + extend catch с `UPDATE users SET status='suspended' WHERE id=?` на 403. SPA gate ✅.
- `src/notifications/admin-alert.js` — import + wrap `_bot.sendMessage` в `notifyAdminCrash`.

**Деплой:** не задеплоено. Оператор закоммитит и развернёт через deploy.ps1.

**Риски:** retry cap 60s prevents bot freeze on absurd `retry_after`. 1 retry max prevents storm amplification. 403 теперь auto-suspends в broadcast — мониторим что не помечаем массово легитимных юзеров после первого batch (acceptable since 403 = реально заблокированы).

**Не сделано:** BOT-021 (global token bucket) отложен. При текущем масштабе (5-50 users) шанс 429 низкий; после BOT-006 retry это реактивно покрыто. Реассесс при scaling > 200 users или если 429 retry начнёт срабатывать заметно часто.
```

- [ ] **Step 3: Verify both files saved**

Run:
```bash
grep -c "Bundle #15" ai-context/SESSION_CONTEXT.md
grep -c "Bundle #15" ai-context/WORKLOG.md
```
Both should output `1` or more.

- [ ] **Step 4: Report DONE — do not commit**

Operator will commit all 6 files (telegram-retry.js + 3 src/ + 2 ai-context/) as a single bundle after reviewing.

---

## Final verification (run after all 5 tasks)

- [ ] **Combined parse check**

Run:
```bash
node --check src/notifications/telegram-retry.js && \
node --check src/notifications/telegram.js && \
node --check src/notifications/admin-alert.js && \
node --check src/admin/server.js
```
Expected: all 4 succeed, no output, exit code 0.

- [ ] **Combined SPA check**

Run: `npm run check:spa`
Expected: both dashboard and admin SPA validators pass.

- [ ] **Bundle wrap-count sanity**

Run:
```bash
grep -rn "withTelegramRetry(" src/notifications/ src/admin/server.js
```
Expected counts:
- `src/notifications/telegram-retry.js` — 1 (the `export` line)
- `src/notifications/telegram.js` — 7 (1 import + 6 call sites)
- `src/notifications/admin-alert.js` — 2 (1 import + 1 call site)
- `src/admin/server.js` — 2 (1 import + 1 call site)
- **Total: 12 lines across 4 files.**

- [ ] **Working tree summary**

Run: `git status --short`
Expected: 5 modified files (1 new + 4 modified), no untracked except the new `telegram-retry.js`.

If counts mismatch — re-check the failing task before reporting bundle complete.
