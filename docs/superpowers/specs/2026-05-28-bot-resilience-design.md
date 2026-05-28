# Bot Resilience — Design Spec

**Date**: 2026-05-28
**Bundle**: #15 (Tier 3, scaling prep)
**Audit findings closed**: BOT-006, BOT-007 (BOT-005 already closed in B13; BOT-021 deferred)
**Estimated effort**: ~1.5h

---

## 1. Goal

Make outbound Telegram sends robust against two known failure modes:

1. **HTTP 429 (rate limit)** — TG returns `retry_after` payload. Currently dropped silently. We add a one-shot retry that honors `retry_after`.
2. **HTTP 403 in broadcast loop** — when a user has blocked the bot, broadcast keeps trying on every subsequent broadcast. Alert dispatcher already marks them `users.status='suspended'`. Mirror that behavior in admin broadcast.

Out of scope (deferred):
- **BOT-021** global token bucket — current per-path pacing (50ms broadcast / 100ms dispatch) below TG 30 msg/s limit at current scale (~5-50 users). Will revisit if traffic grows or after BOT-006 retry proves insufficient.

---

## 2. Architecture overview

New utility module exporting one function:

```
src/notifications/telegram-retry.js
└── withTelegramRetry(sendFn, opts) → result | throws
```

`sendFn` is an async no-arg function. The helper invokes it, intercepts 429 errors, sleeps for `retry_after` seconds (capped), retries once, and re-throws on remaining failures.

Caller responsibilities (kept outside the helper):
- 403 handling (`users.status='suspended'`, `failed++`, etc.) — caller-specific side effects.
- All other error logging / fallbacks — current behavior preserved.

No dependencies. Pure utility. Tested via mocked `sendFn`.

---

## 3. Components

### 3.1 `src/notifications/telegram-retry.js` (new file, ~40 LOC, ESM)

Project is `"type": "module"` (package.json) — all .js files are ESM by default.

```js
const DEFAULT_MAX_RETRIES = 1;          // 1 retry → 2 attempts total
const DEFAULT_RETRY_CAP_MS = 60 * 1000; // 60s safety cap on retry_after
const FALLBACK_RETRY_AFTER_MS = 5000;   // when TG doesn't include retry_after

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
      if (logger?.warn) logger.warn(`[${label}] TG 429 — sleeping ${waitMs}ms before retry ${attempt}/${maxRetries}`);
      await sleep(waitMs);
    }
  }
}
```

### 3.2 `src/notifications/telegram.js` — wire-ups (ESM import + 6 wrap sites)

Add at top of file (after existing imports, ~line 21):
```js
import { withTelegramRetry } from './telegram-retry.js';
```

Wrap each terminal `this.bot.send*` call inside `sendAlertToUser` and its helper. Real callsite line numbers (verified 2026-05-28):

| Line | Call | Notes |
|---|---|---|
| 1261 | `this.bot.sendMessage(chatId, outgoing, opts)` inside `_sendPlainTextChunked` | single send (no chunking loop — truncates >4096) |
| 1321 | `this.bot.sendVideo(chatId, videoSource, {...})` | video branch |
| 1340 | `this.bot.sendPhoto(chatId, fallbackImg, {...})` | fallback after sendVideo fail |
| 1375 | `this.bot.sendMediaGroup(chatId, media, {...})` | album branch |
| 1385 | `this.bot.sendPhoto(chatId, imageUrls[0], {...})` | fallback after sendMediaGroup fail |
| 1405 | `this.bot.sendPhoto(chatId, imageUrls[0], {...})` | single-image branch |

Each wrap looks like:
```js
sentMsg = await withTelegramRetry(
  () => this.bot.sendPhoto(chatId, imageUrls[0], { caption: ..., parse_mode: 'HTML' }),
  { logger: this.logger, label: 'alert-photo' }
);
```

The existing 403-handling catch block at line 1432-1441 stays unchanged — it now triggers only on:
- 429 that failed retry (re-thrown by helper) — falls into `else` branch, logs as generic error
- 403 — runs existing `this.db.updateUser(user.id, 'status', 'suspended')`
- other errors — logs generic

Do NOT wrap any of the dozens of command-handler sends elsewhere in telegram.js (lines 190-1971 outside `sendAlertToUser`). Those are user-initiated replies; retry is unnecessary noise.

### 3.3 `src/admin/server.js` — broadcast loop in `_broadcast` (lines 758-809)

Add import at top of file:
```js
import { withTelegramRetry } from '../notifications/telegram-retry.js';
```

**a)** Wrap the send at line 772:
```js
const sentMsg = await withTelegramRetry(
  () => this.bot.sendMessage(u.telegram_chat_id, message, { parse_mode: 'HTML' }),
  { logger: this.logger, label: 'broadcast' }
);
```

**b)** Extend the catch block at line 805 with 403 detection — closes **BOT-007**:
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

Note: SELECT at line 760-764 returns `u.id` and `u.telegram_chat_id`. We update by primary key `id` (not by `telegram_chat_id`) — same pattern as `this.db.updateUser(user.id, 'status', 'suspended')` in telegram.js:1436.

The `setTimeout(50ms)` throttle at line 804 stays untouched. The pin/unpin/delivery-record blocks at lines 774-801 stay untouched (they have their own inner try/catch).

### 3.4 `src/notifications/admin-alert.js` — `notifyAdminCrash` (line 91)

Add import at top of file (after the existing top-level comment, before the `let _bot = null;` block):
```js
import { withTelegramRetry } from './telegram-retry.js';
```

Wrap the support-group send at line 91 inside the existing `try { ... } catch { swallow }`:
```js
try {
  await withTelegramRetry(
    () => _bot.sendMessage(_groupId, msg, {
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      disable_notification: false,
    }),
    { logger: _logger, label: 'admin-crash' }
  );
} catch (e) {
  _logger.warn(`[admin-alert] sendMessage to admin group failed: ${e.message}`);
}
```

Catch stays as swallow (current behavior — admin alerts are best-effort; if 403 fires on the support group, the operator will notice via other channels).

---

## 4. Data flow

```
[caller] → withTelegramRetry(() => bot.sendX(...))
         │
         ├── success → return result
         │
         ├── catch 429 → extract retry_after → sleep → retry
         │       └── success → return
         │       └── still 429 → re-throw (caller logs + skips)
         │
         └── catch 403/400/network → re-throw (caller side-effects)
                 ├── telegram.js: existing status='suspended' path
                 ├── admin/server.js broadcast: new 403 → status='suspended' + failed++
                 └── admin-alert: swallow
```

---

## 5. Error handling matrix

| Error | Retry? | Caller action |
|---|---|---|
| 429 (rate limit) | yes, 1 retry honoring `retry_after` (cap 60s, fallback 5s) | if retry also fails → caller logs and skips this recipient |
| 403 (user blocked) | no, immediate re-throw | telegram.js: existing `status='suspended'`; admin/server.js: new `status='suspended'`; admin-alert: swallow |
| 400, 500, network, other | no, immediate re-throw | each caller's current behavior preserved |

**Why no retry on non-429 errors:** They indicate semantic (400 = malformed payload) or fundamental (403 = blocked) issues that won't fix themselves on retry. Retrying them risks bot-side rate-limit accumulation.

**Why 1 retry max for 429:** If first retry fails, the system is genuinely overloaded — keep retrying makes it worse. Caller logs and moves on; next send cycle will naturally pace down.

---

## 6. Testing strategy

### 6.1 Unit test (deferred — no test runner in project yet)

When a test runner is added (Bundle #18 or later), add `tests/notifications/telegram-retry.test.js`:

```js
test('429 with retry_after retries once and returns', async () => {
  let calls = 0;
  const sendFn = async () => {
    calls++;
    if (calls === 1) {
      const err = new Error('Too Many Requests');
      err.response = { statusCode: 429, body: { parameters: { retry_after: 0.01 } } };
      throw err;
    }
    return { ok: true };
  };
  const result = await withTelegramRetry(sendFn);
  expect(calls).toBe(2);
  expect(result.ok).toBe(true);
});

test('429 twice in a row → throws after maxRetries', async () => {
  const sendFn = async () => {
    const err = new Error('Too Many Requests');
    err.response = { statusCode: 429, body: { parameters: { retry_after: 0.01 } } };
    throw err;
  };
  await expect(withTelegramRetry(sendFn)).rejects.toThrow('Too Many Requests');
});

test('non-429 error → no retry, immediate throw', async () => {
  let calls = 0;
  const sendFn = async () => {
    calls++;
    const err = new Error('Forbidden');
    err.response = { statusCode: 403 };
    throw err;
  };
  await expect(withTelegramRetry(sendFn)).rejects.toThrow('Forbidden');
  expect(calls).toBe(1);
});
```

Until test infra exists: implementer should manually reason through edge cases in self-review (429 detection, retry_after parsing, cap behavior, non-429 immediate re-throw).

### 6.2 Manual smoke after deploy

- Trigger a broadcast to 5+ users including at least one known-blocked user.
- Verify in logs:
  - 403 errors logged
  - `users.status='suspended'` updated for the blocked user (`SELECT status FROM users WHERE telegram_id = ?`)
- (Optional, hard to reproduce): force a 429 by burst-sending; verify retry log line.

### 6.3 SPA gate

Not applicable — none of the touched files (`telegram.js`, `admin/server.js`, `admin-alert.js`, `telegram-retry.js`) carry inline SPA template literals. `npm run check:spa` not required for this bundle.

---

## 7. Files changed (summary)

| File | Change |
|---|---|
| `src/notifications/telegram-retry.js` | **NEW** — utility, ~40 LOC |
| `src/notifications/telegram.js` | Add ESM import; wrap 6 `this.bot.send*` callsites (lines 1261, 1321, 1340, 1375, 1385, 1405) with `withTelegramRetry` |
| `src/admin/server.js` | Add ESM import; wrap broadcast `this.bot.sendMessage` (line 772); extend catch (line 805) with 403 → `UPDATE users SET status='suspended' WHERE id=?`. Closes **BOT-007** |
| `src/notifications/admin-alert.js` | Add ESM import; wrap support-group `_bot.sendMessage` (line 91) |
| `ai-context/SESSION_CONTEXT.md` | Add bullet under Production posture: «429-retry helper закрывает BOT-006; broadcast 403→suspended закрывает BOT-007» |
| `ai-context/WORKLOG.md` | New top entry |

No DB migrations. No schema changes. No env-var changes.

---

## 8. Risk assessment

- **Retry storms**: cap at 1 retry + 60s cap on `retry_after` prevents infinite waits and feedback loops.
- **Sleep blocking event loop**: `setTimeout`-based promise, non-blocking.
- **Mass status='suspended' from a single 403 storm**: each 403 → 1 row update, idempotent. Worst-case all broadcast targets suspended — acceptable since they did actually block the bot.
- **Race with admin re-activate**: operator can manually flip status back via admin panel; no auto-resurrect logic added.

---

## 9. Acceptance criteria

- `src/notifications/telegram-retry.js` exports `withTelegramRetry`; returns sendFn result on success, retries once on 429, re-throws on second 429 or any non-429 error.
- `sendAlertToUser` per-chunk text send and per-media sends (`sendPhoto` / `sendVideo` / `sendMediaGroup`) use the helper.
- Broadcast loop in `admin/server.js` uses the helper AND sets `users.status='suspended'` on 403 in catch block.
- `notifyAdminCrash` in `admin-alert.js` uses the helper.
- Existing 403 handling in alert-dispatcher path remains functional (no regression).
- `node --check` passes on all touched files.
