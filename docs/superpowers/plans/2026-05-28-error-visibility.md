# Bundle #13 — Error Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Закрыть 5 audit finding'ов visibility (ADM-001, UX-001, BOT-003, PROD-006, BOT-020) — admin TG crash alerts + per-user dispatch isolation + TG 4096 truncate + standardized `<ErrorBanner>` React component для dashboard feed + admin StatsPage/DecisionsPage/StatusBar.

**Architecture:** Single new module `src/notifications/admin-alert.js` (init + notifyAdminCrash + in-memory dedupe). Wired into 4 server-side sites (uncaughtException, unhandledRejection, per-user loop catch, TG 4096 truncate). Inline `<ErrorBanner>` React component duplicated в обоих SPA templates (established pattern from Bundle #3) + wired into 4 fetch sites. NO Sentry / no third-party SaaS — reuse existing `config.support.groupId`.

**Tech Stack:** Node.js ESM, telegraf/node-telegram-bot-api (support bot already), inline React SPA в `src/dashboard/server.js` + `src/admin/server.js`. SPA validator `npm run check:spa` (Bundle #16 gate) после каждого edit'а SPA-template файлов.

---

## Spec reference

Spec: `docs/superpowers/specs/2026-05-28-error-visibility-design.md`

## Files affected

| File | Action | Detail |
|---|---|---|
| `src/notifications/admin-alert.js` | **new** | `initAdminAlerts(bot, config, logger)` + `notifyAdminCrash(error, context)` + dedupe Map. ~75 LOC. |
| `src/index.js` | modify | Add `initAdminAlerts(...)` call after supportBot init (~line 160); rewrite uncaughtException + unhandledRejection handlers (lines 762-763) to call `notifyAdminCrash`. |
| `src/notifications/alert-dispatcher.js` | modify | Wrap loop body at line 176 в try/catch with `notifyAdminCrash` + continue. |
| `src/notifications/telegram.js` | modify | Add `_sendPlainTextChunked(chatId, message, opts)` helper в class. Replace 4 `bot.sendMessage(chatId, message, ...)` callsites within `sendAlertToUser` (line 1233) with the helper. Helper does truncate at 4090 + admin notify. |
| `src/dashboard/server.js` | modify | Add inline `ErrorBanner` component + CSS в SPA template. Replace feed `error-bar` div (line 14295) с `<ErrorBanner>` (gets onRetry callback). SPA gate. |
| `src/admin/server.js` | modify | Add inline `ErrorBanner` component + CSS в admin SPA. Wire into StatsPage / DecisionsPage / StatusBar fetch error states. SPA gate. |
| `ai-context/SESSION_CONTEXT.md` | modify | +1 bullet |
| `ai-context/WORKLOG.md` | modify | Bundle #13 entry |

**NOT touched**: `src/notifications/formatter.js`, `src/support/bot.js` (its `.bot` instance is consumed read-only), DB schema, `package.json`.

## Critical project gotchas

- **`src/dashboard/server.js` + `src/admin/server.js`** — inline React SPA template literals. Backtick в comment / stray `${...}` / new RegExp escape → SPA broken → чёрный экран. After ANY edit run `npm run check:spa` (Bundle #16 gate).
- **Inline ErrorBanner duplication**: SPA не может ESM-import — established pattern (LIFESPAN_VALUES, safeHref from Bundle #3, CatMascot FSM). Drift отслеживается comment + quarterly drill.
- **Don't crash during crash handling**: `notifyAdminCrash` swallows all errors. If admin TG send fails — log + continue. Otherwise cascade crashes possible.

## Commits

Subagents **do NOT commit**. File edits only. Operator commits after all 7 tasks complete.

---

## Task 1: Create `src/notifications/admin-alert.js`

**Files:**
- Create: `F:\.VibeCoding\Projects\Antigravity\Narrative Parser\src\notifications\admin-alert.js`

- [ ] **Step 1: Verify directory exists**

Run: `ls "F:\.VibeCoding\Projects\Antigravity\Narrative Parser\src\notifications\"`
Expected: directory exists, contains `telegram.js`, `alert-dispatcher.js`, `formatter.js`.

- [ ] **Step 2: Create the file with exact content**

Use Write tool. File: `src/notifications/admin-alert.js`. Content (verbatim):

```javascript
// Admin crash alert helper — Bundle #13 (2026-05-28).
//
// Posts crash/error notifications to config.support.groupId via the support
// bot. Used by uncaughtException / unhandledRejection / per-user dispatch
// crashes / TG truncate events.
//
// Init flow: src/index.js calls initAdminAlerts(supportBot.bot, config, logger)
// at boot AFTER supportBot is constructed. Until init is called,
// notifyAdminCrash() is a no-op (logs the gap once at init time).

let _bot = null;
let _groupId = null;
let _logger = console;
const _dedupeMap = new Map(); // fingerprint -> lastSentMs
const _COOLDOWN_MS = 5 * 60 * 1000;
const _ADMIN_MSG_LIMIT = 4000; // leave headroom under TG 4096 plain-text cap

/**
 * Wire the admin-alert module to the support bot instance.
 * Safe to call once at boot from src/index.js. If groupId missing,
 * notifyAdminCrash becomes a no-op (logs once at init).
 *
 * @param {Object|null} supportBot - the underlying bot instance (e.g., supportBot.bot)
 * @param {Object} config - app config (reads config.support.groupId)
 * @param {Object} [logger] - logger with .info/.warn/.error (default: console)
 */
export function initAdminAlerts(supportBot, config, logger) {
  _bot = supportBot || null;
  _groupId = config?.support?.groupId || null;
  _logger = logger || console;
  if (!_groupId) {
    _logger.warn('[admin-alert] No SUPPORT_GROUP_ID configured — crash notifications disabled');
  } else if (!_bot) {
    _logger.warn('[admin-alert] Support bot instance not provided — crash notifications disabled');
  } else {
    _logger.info('[admin-alert] Initialized — crash notifications enabled');
  }
}

function escHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function fingerprint(err) {
  const name = err?.name || 'Error';
  const stack = (err?.stack || '').split('\n').slice(1, 2).join('') || (err?.message || '');
  return `${name}::${stack}`.slice(0, 200);
}

/**
 * Send admin crash notification. Never throws. Dedupes via in-memory Map
 * with 5-min cooldown per fingerprint (errorName + first stack line).
 *
 * @param {Error|string} error
 * @param {Object} [context] - structured payload, JSON.stringify'd safely
 * @returns {Promise<void>}
 */
export async function notifyAdminCrash(error, context = {}) {
  if (!_bot || !_groupId) return; // no-op until initialized

  const err = error instanceof Error ? error : new Error(String(error));
  const fp = fingerprint(err);
  const now = Date.now();
  const lastSent = _dedupeMap.get(fp) || 0;
  if (now - lastSent < _COOLDOWN_MS) return; // suppress duplicate within cooldown

  _dedupeMap.set(fp, now);

  const env = process.env.NODE_ENV || 'unknown';
  const stackLines = (err.stack || '').split('\n').slice(0, 4).join('\n');

  let ctxStr = '';
  try { ctxStr = JSON.stringify(context).slice(0, 500); }
  catch { ctxStr = '(context not serializable)'; }

  let msg =
    `🚨 <code>${escHtml(env)}</code> <b>${escHtml(err.name)}</b>\n` +
    `${escHtml(err.message)}\n\n` +
    `<pre>${escHtml(stackLines)}</pre>\n\n` +
    `Context: <code>${escHtml(ctxStr)}</code>`;

  // Safety: admin alert itself must fit under TG plain-text 4096 limit.
  if (msg.length > _ADMIN_MSG_LIMIT) {
    msg = msg.slice(0, _ADMIN_MSG_LIMIT) + '\n…[truncated]';
  }

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
}

/**
 * Test/debug helper — clears the dedupe Map. Exposed для REPL/manual tests,
 * not used by production code.
 */
export function _resetForTest() {
  _dedupeMap.clear();
}
```

- [ ] **Step 3: Sanity-check exports via Node REPL**

Run from project root:

```
node -e "import('./src/notifications/admin-alert.js').then(m => { console.log('exports:', Object.keys(m).sort().join(',')); m.initAdminAlerts(null, {}, console); console.log('after init w/o bot:', typeof m.notifyAdminCrash); m.notifyAdminCrash(new Error('test'), { foo: 1 }).then(() => console.log('no-op call OK')); })"
```

Expected output (in some order):
```
exports: _resetForTest,initAdminAlerts,notifyAdminCrash
[admin-alert] No SUPPORT_GROUP_ID configured — crash notifications disabled
after init w/o bot: function
no-op call OK
```

If MODULE_NOT_FOUND or SyntaxError → fix.

- [ ] **Step 4: Task complete** — no commit; advance to Task 2.

---

## Task 2: Wire `src/index.js` — initAdminAlerts + replace 2 handlers

**Files:**
- Modify: `F:\.VibeCoding\Projects\Antigravity\Narrative Parser\src\index.js` (line 160 area for init, lines 762-763 for handlers)

**Context:**
- `const supportBot = new SupportBot(config, logger, db);` at line 160 — init goes immediately after.
- Lines 762-763 — current handlers:
  ```javascript
  process.on('uncaughtException',  err => logger.error(`Uncaught exception: ${err.message}`, { stack: err.stack }));
  process.on('unhandledRejection', reason => logger.error(`Unhandled rejection: ${reason}`));
  ```
- The support bot's underlying bot instance is `supportBot.bot` (from `src/support/bot.js:29-30` — `this.token = config.support?.botToken`, the bot is instantiated inside the class).

- [ ] **Step 1: Add import to top of file**

Use Read tool on `src/index.js` lines 1-30 to find the existing imports section. Then Edit to add the new import after the existing notification imports (likely near `import SupportBot from './support/bot.js';`).

Use Edit tool. Find an existing import line as anchor and add the new import after it:

If you find a line like:
```javascript
import SupportBot from './support/bot.js';
```

Replace:
```javascript
import SupportBot from './support/bot.js';
```

With:
```javascript
import SupportBot from './support/bot.js';
import { initAdminAlerts, notifyAdminCrash } from './notifications/admin-alert.js';
```

If `SupportBot` isn't imported via that exact name, use Grep first: `Grep pattern "from.*support/bot" path "src/index.js" output_mode content -n true` to find the actual import line, then anchor the Edit on that.

- [ ] **Step 2: Insert initAdminAlerts call after supportBot construction**

Use Read tool around line 158-165 to confirm:

```javascript
const supportBot = new SupportBot(config, logger, db);
```

is at line 160. Then Edit:

**old_string:**
```javascript
const supportBot = new SupportBot(config, logger, db);
```

**new_string:**
```javascript
const supportBot = new SupportBot(config, logger, db);

// Bundle #13 (2026-05-28): wire admin crash alerts to support bot instance.
// supportBot.bot is the underlying node-telegram-bot-api instance.
initAdminAlerts(supportBot?.bot, config, logger);
```

(If `supportBot.bot` doesn't exist — check `src/support/bot.js` to confirm the property name; it's commonly `.bot` per Node TG patterns.)

- [ ] **Step 3: Replace uncaughtException + unhandledRejection handlers**

Use Edit tool. Replace (verify exact text at lines 762-763):

**old_string:**
```javascript
process.on('uncaughtException',  err => logger.error(`Uncaught exception: ${err.message}`, { stack: err.stack }));
process.on('unhandledRejection', reason => logger.error(`Unhandled rejection: ${reason}`));
```

**new_string:**
```javascript
// Bundle #13 (PROD-006): log + admin TG notification. 5-min dedupe via notifyAdminCrash.
// Note: handlers still don't process.exit — Docker healthcheck handles fatal-state restart.
process.on('uncaughtException', err => {
  logger.error(`Uncaught exception: ${err.message}`, { stack: err.stack });
  notifyAdminCrash(err, { kind: 'uncaughtException' });
});
process.on('unhandledRejection', reason => {
  logger.error(`Unhandled rejection: ${reason}`);
  const err = reason instanceof Error ? reason : new Error(String(reason));
  notifyAdminCrash(err, { kind: 'unhandledRejection' });
});
```

- [ ] **Step 4: Smoke — module parses cleanly**

Run from project root:

```
node -e "import('./src/index.js').then(() => console.log('boot OK')).catch(e => { if (e.message.includes('SyntaxError') || e.message.includes('Unexpected')) console.log('SYNTAX ERROR:', e.message); else console.log('module parsed (runtime expected):', (e.message||'').slice(0,100)); })"
```

Expected: `boot OK` OR `module parsed (runtime expected): ...`. No SyntaxError.

- [ ] **Step 5: Task complete** — no commit; advance to Task 3.

---

## Task 3: Wrap per-user dispatch loop в try/catch (alert-dispatcher.js)

**Files:**
- Modify: `F:\.VibeCoding\Projects\Antigravity\Narrative Parser\src\notifications\alert-dispatcher.js` (around line 176)

**Context:** Loop body for `for (const user of activeUsers)` lacks try/catch — `JSON.parse(user.disabled_sources || '[]')` (~line 190) or any downstream operation can throw → cascade failure для всех subsequent users. BOT-020.

- [ ] **Step 1: Locate the loop**

Use Read tool on `src/notifications/alert-dispatcher.js` around lines 170-220 to see the full loop body. Note the exact opening line `for (const user of activeUsers) {` and the matching closing `}`.

- [ ] **Step 2: Add import at top of file**

Use Read tool on lines 1-10 to find existing imports. Use Edit tool to add the new import after the last existing import in the file.

The exact placement depends on existing imports — anchor your Edit on an existing import line that looks like `import ... from '../...';` or similar.

Add somewhere in the imports block:
```javascript
import { notifyAdminCrash } from './admin-alert.js';
```

- [ ] **Step 3: Wrap loop body в try/catch**

The implementer subagent needs to:

1. Read the entire `for (const user of activeUsers) { ... }` body — capture the exact text from the opening brace to the matching closing brace.
2. Wrap it like:

```javascript
  for (const user of activeUsers) {
    try {
      // ... existing body (verbatim) ...
    } catch (err) {
      logger.error(`[alert-dispatch] per-user crash uid=${user?.id || 'unknown'}: ${err.message}`, { stack: err.stack });
      notifyAdminCrash(err, {
        kind: 'alert-dispatch-per-user',
        userId: user?.id ?? null,
        telegram_chat_id: user?.telegram_chat_id ?? null,
        plan_id: user?.plan_id ?? null,
      });
      // continue to next user
    }
  }
```

**Implementation note**: the existing body uses `continue` statements (e.g., `if (user.status === 'suspended') continue;`). After wrapping в try/catch, these `continue` statements still target the `for` loop (not the try block) — JavaScript semantics preserve this. No changes needed inside the body.

If `logger` isn't in scope in this file — find how it's accessed (likely `this.logger` if inside a class, or imported). Check via Read of lines 1-30 + the function signature where the loop lives.

- [ ] **Step 4: Smoke — module parses**

Run from project root:

```
node -e "import('./src/notifications/alert-dispatcher.js').then(() => console.log('alert-dispatcher OK')).catch(e => { if (e.message.includes('SyntaxError')) console.log('SYNTAX ERROR:', e.message); else console.log('parsed:', (e.message||'').slice(0,100)); })"
```

Expected: `alert-dispatcher OK` or `parsed: ...` without SyntaxError.

- [ ] **Step 5: Task complete** — no commit; advance to Task 4.

---

## Task 4: TG plain-text 4096 truncate (telegram.js)

**Files:**
- Modify: `F:\.VibeCoding\Projects\Antigravity\Narrative Parser\src\notifications\telegram.js` (around lines 1233-1340 — `sendAlertToUser` method)

**Context:** The `sendAlertToUser` method (line 1233) has 4 fallback paths calling `bot.sendMessage(chatId, message, ...)` (lines 1296, 1314, 1321, 1327) for non-video alerts. All hit TG 4096 plain-text limit silently. We extract a single helper method `_sendPlainTextChunked` that does the truncate + admin notify + send. Replace all 4 callsites with the helper.

- [ ] **Step 1: Add import + add helper method**

Use Read tool on lines 1-20 to find existing imports. Add a new import for `notifyAdminCrash`:

Use Edit tool. Anchor on existing imports. Add somewhere in imports block:
```javascript
import { notifyAdminCrash } from './admin-alert.js';
```

- [ ] **Step 2: Add the `_sendPlainTextChunked` helper method to the class**

Use Read tool on lines 1230-1240 to find the class structure (likely `class TelegramNotifier {` or similar). The helper goes as a method inside the class, anywhere; placing it right before `async sendAlertToUser(...)` is fine.

Use Edit tool. Anchor on the line `async sendAlertToUser(trend, user, opts = {}) {` (line 1233 per spec):

**old_string:**
```javascript
  async sendAlertToUser(trend, user, opts = {}) {
```

**new_string:**
```javascript
  /**
   * Send a plain-text TG message, truncating at 4090 chars to avoid the
   * 4096 silent-drop (BOT-003). On truncation, sends full payload to admin
   * support group via notifyAdminCrash for post-mortem.
   *
   * @param {number|string} chatId
   * @param {string} message
   * @param {Object} [opts] - passthrough to bot.sendMessage
   * @param {Object} [ctx] - audit context (userId, telegram_chat_id, trendId)
   */
  async _sendPlainTextChunked(chatId, message, opts = {}, ctx = {}) {
    const TG_PLAIN_LIMIT = 4096;
    const TRUNCATE_AT    = 4090;
    const TRUNCATE_SUFFIX = '\n\n…[truncated, see admin log]';
    let outgoing = message;
    if (typeof message === 'string' && message.length > TG_PLAIN_LIMIT) {
      outgoing = message.slice(0, TRUNCATE_AT) + TRUNCATE_SUFFIX;
      notifyAdminCrash(new Error('alert_truncated'), {
        kind: 'tg_truncate',
        chatId,
        userId: ctx.userId ?? null,
        telegram_chat_id: ctx.telegram_chat_id ?? chatId,
        trendId: ctx.trendId ?? null,
        fullMessageLength: message.length,
        fullMessage: message.slice(0, 8000),
      });
    }
    return this.bot.sendMessage(chatId, outgoing, opts);
  }

  async sendAlertToUser(trend, user, opts = {}) {
```

- [ ] **Step 3: Replace 4 `bot.sendMessage` callsites with the helper**

Within `sendAlertToUser`, there are 4 sendMessage calls that pass `message` as the second arg (the plain alert text body). Find and replace each.

**Site 1 (~line 1296 — sendVideo + plain-message follow-up):**

Use Edit tool. Replace:
```javascript
          if (!fitsInCaption) {
            await this.bot.sendMessage(chatId, message, {
              parse_mode: 'HTML',
              disable_web_page_preview: true,
              reply_to_message_id: sentMsg?.message_id,
            });
          }
```

With:
```javascript
          if (!fitsInCaption) {
            await this._sendPlainTextChunked(chatId, message, {
              parse_mode: 'HTML',
              disable_web_page_preview: true,
              reply_to_message_id: sentMsg?.message_id,
            }, { userId: user?.id, telegram_chat_id: chatId, trendId: trend?.id });
          }
```

**Site 2 (~line 1314 — sendPhoto fallback + plain-message follow-up):**

Use Edit tool. Replace:
```javascript
              if (!fitsInCaption) {
                await this.bot.sendMessage(chatId, message, {
                  parse_mode: 'HTML',
                  disable_web_page_preview: true,
                  reply_to_message_id: sentMsg?.message_id,
                });
              }
```

With:
```javascript
              if (!fitsInCaption) {
                await this._sendPlainTextChunked(chatId, message, {
                  parse_mode: 'HTML',
                  disable_web_page_preview: true,
                  reply_to_message_id: sentMsg?.message_id,
                }, { userId: user?.id, telegram_chat_id: chatId, trendId: trend?.id });
              }
```

**Site 3 (~line 1321 — catch-block fallback):**

Use Edit tool. Replace:
```javascript
            } catch {
              sentMsg = await this.bot.sendMessage(chatId, message, {
                parse_mode: 'HTML',
                disable_web_page_preview: false,
              });
            }
```

With:
```javascript
            } catch {
              sentMsg = await this._sendPlainTextChunked(chatId, message, {
                parse_mode: 'HTML',
                disable_web_page_preview: false,
              }, { userId: user?.id, telegram_chat_id: chatId, trendId: trend?.id });
            }
```

**Site 4 (~line 1327 — no-image fallback):**

Use Edit tool. Replace:
```javascript
          } else {
            sentMsg = await this.bot.sendMessage(chatId, message, {
              parse_mode: 'HTML',
              disable_web_page_preview: false,
            });
          }
```

With:
```javascript
          } else {
            sentMsg = await this._sendPlainTextChunked(chatId, message, {
              parse_mode: 'HTML',
              disable_web_page_preview: false,
            }, { userId: user?.id, telegram_chat_id: chatId, trendId: trend?.id });
          }
```

**Note**: there may also be a 5th `bot.sendMessage` call NOT в `sendAlertToUser` (e.g., for verification codes or other unrelated bot messages). Only replace ones within `sendAlertToUser` that pass the formatted alert `message` variable. Other bot.sendMessage calls (e.g., short status messages) don't need wrapping — they won't hit 4096.

- [ ] **Step 4: Verify only the alert-message sendMessage calls are wrapped**

Use Grep tool:
- pattern: `bot\.sendMessage\(chatId,\s*message,`
- path: `src/notifications/telegram.js`
- output_mode: content
- -n: true

Expected: **0 matches** (all 4 within sendAlertToUser should now use the helper).

If matches > 0 — there's a leftover; either the spec has more sites than expected, or the implementer missed one. Apply the same wrap.

- [ ] **Step 5: Smoke — module parses**

Run from project root:

```
node -e "import('./src/notifications/telegram.js').then(() => console.log('telegram OK')).catch(e => { if (e.message.includes('SyntaxError')) console.log('SYNTAX ERROR:', e.message); else console.log('parsed:', (e.message||'').slice(0,100)); })"
```

Expected: `telegram OK` or `parsed: ...` without SyntaxError.

- [ ] **Step 6: Task complete** — no commit; advance to Task 5.

---

## Task 5: ErrorBanner в dashboard SPA + replace feed error-bar (+SPA gate)

**Files:**
- Modify: `F:\.VibeCoding\Projects\Antigravity\Narrative Parser\src\dashboard\server.js` (line ~7110 for component, line ~14295 for feed wire-up, somewhere in `<style>` block for CSS)

**Context:**
- Bundle #3 added URL safety helpers at line ~7086-7109 (in the SPA template after `BOT_USERNAME` injection). ErrorBanner component goes right after that block.
- Feed already has `error` state (declared at line 13168, set in catch blocks at 13463 + 13502). Current render at line 14295 is a basic `error-bar` div. We replace it with `<ErrorBanner>` (adds retry button + standardized styling).
- The CSS goes inside the existing `<style>` block (search for an existing `.toast` or `.modal` CSS class to anchor).

- [ ] **Step 1: Add ErrorBanner inline component after Bundle #3 helpers**

Use Read tool around lines 7105-7115 of `src/dashboard/server.js` to find the END of Bundle #3's URL safety helpers block (the line right before `// ── Auth token ──...` comment).

Use Edit tool. Anchor on the existing `// ── Auth token ──...` comment + the line before it (which should be the last line of the URL safety helpers block — likely `}` closing `safeHref`).

Find the closing `}` of `safeHref` immediately followed by blank line and `// ── Auth token ──...`. Replace:

**old_string:**
```javascript
function safeHref(url) {
  const safe = safeUrl(url);
  return safe ? escHtmlAttr(safe) : '#';
}

// ── Auth token ────────────────────────────────────────────────────────────
```

**new_string:**
```javascript
function safeHref(url) {
  const safe = safeUrl(url);
  return safe ? escHtmlAttr(safe) : '#';
}

// ── Error banner component (Bundle #13, 2026-05-28) ──────────────────────
// Shared inline error UI. Use as: h(ErrorBanner, { message, onRetry, variant })
// variant: 'error' (red, default) | 'warn' (orange)
function ErrorBanner({ message, onRetry, variant }) {
  const v = variant || 'error';
  return h('div', { className: 'error-banner error-banner-' + v },
    h('span', { className: 'error-banner-icon' }, v === 'error' ? '⚠' : 'ⓘ'),
    h('span', { className: 'error-banner-msg' }, String(message || 'Something went wrong')),
    onRetry ? h('button', { className: 'error-banner-retry', onClick: onRetry }, 'Retry') : null
  );
}

// ── Auth token ────────────────────────────────────────────────────────────
```

**Note**: uses `⚠` (⚠) and `ⓘ` (ⓘ) Unicode escapes to match the file's existing emoji-escape convention (no literal emoji in code).

- [ ] **Step 2: Add CSS for error-banner family**

Use Grep tool on `src/dashboard/server.js`:
- pattern: `\.toast\s*\{|\.modal-section\s*\{`
- output_mode: content
- -n: true
- head_limit: 5

Use one of the matched lines as an anchor — read 15 lines around it to find a clean spot in the `<style>` block.

Then Edit. Find a place inside the `<style>` block (preferably near other notification/banner CSS classes) and add the following CSS block. The Edit `old_string` should be one full CSS rule that's nearby, replaced with itself + the new rules appended.

For example, if you find a CSS rule like `.toast {`, anchor the Edit there. As a concrete example, if `.toast { ... }` ends with a specific closing pattern, anchor on that.

**Add this CSS block somewhere in the `<style>` section (placement near other utility classes preferred):**

```css
    .error-banner {
      display: flex; align-items: center; gap: 8px;
      padding: 10px 14px;
      border-radius: 8px;
      font-size: 13px;
      margin: 8px 0;
    }
    .error-banner-error {
      background: rgba(var(--red-rgb), .08);
      border: 1px solid rgba(var(--red-rgb), .3);
      color: var(--red2);
    }
    .error-banner-warn {
      background: rgba(var(--orange-rgb), .08);
      border: 1px solid rgba(var(--orange-rgb), .3);
      color: var(--orange2);
    }
    .error-banner-icon { font-size: 16px; }
    .error-banner-msg { flex: 1; }
    .error-banner-retry {
      padding: 4px 10px; border-radius: 6px;
      background: transparent;
      border: 1px solid currentColor;
      color: inherit; cursor: pointer; font-size: 12px;
    }
    .error-banner-retry:hover { background: rgba(255,255,255,.05); }
```

**Concrete anchor strategy**: search for the CSS rule `.toast` (which likely exists в dashboard SPA's `<style>`). Read 5 lines around it. Then Edit by replacing one of those rules with itself + the new error-banner block appended.

**Critical**: the CSS block uses NO backticks and NO `${...}` — pure static CSS. Safe for the SPA template literal.

- [ ] **Step 3: Run SPA validation gate**

Run: `npm run check:spa`

Expected: exit 0, dashboard char count slightly HIGHER than Bundle #2 baseline (342813) — added ~1.5KB of new component + CSS.

If FAIL → revert + investigate. Most likely cause: stray backtick or `${...}` in the new CSS or component.

- [ ] **Step 4: Replace feed error-bar (line ~14295) with ErrorBanner**

Use Read tool on `src/dashboard/server.js` lines 14290-14300 to confirm current state:

```javascript
            error ? h('div', { className: 'error-bar', style: { marginBottom: 12 } }, icon('alert-triangle', { size: 13 }), ' ', error) : null,
```

We replace this with `<ErrorBanner>`. The Feed needs an `onRetry` callback that re-triggers the fetch — the feed has `refreshAll` callback at line 13475 (verified during exploration). Use it.

Use Edit tool. Replace:

**old_string:**
```javascript
            error ? h('div', { className: 'error-bar', style: { marginBottom: 12 } }, icon('alert-triangle', { size: 13 }), ' ', error) : null,
```

**new_string:**
```javascript
            error ? h(ErrorBanner, { message: error, onRetry: refreshAll, variant: 'error' }) : null,
```

- [ ] **Step 5: Run SPA validation gate again**

Run: `npm run check:spa`
Expected: exit 0, char count slightly lower than after Step 3 (we replaced a longer error-bar with shorter `<ErrorBanner>` reference).

- [ ] **Step 6: Task complete** — no commit; advance to Task 6.

---

## Task 6: ErrorBanner в admin SPA + wire 3 admin pages (+SPA gate)

**Files:**
- Modify: `F:\.VibeCoding\Projects\Antigravity\Narrative Parser\src\admin\server.js` (admin SPA template — multiple sites)

**Context:** Admin SPA is in `src/admin/server.js` (separate inline React SPA from dashboard). Has 3 pages with silent error states:
- `StatsPage` (line 4678) — admin metrics dashboard
- `DecisionsPage` (line 4009) — alert dispatcher decisions viewer
- `StatusBar` (line 7210) — top-of-page pipeline status indicator

Each page makes an API fetch and currently silently fails on error. We add `ErrorBanner` inline component + wire it into each.

- [ ] **Step 1: Find the right insertion point for the inline ErrorBanner component in admin SPA**

Use Grep tool:
- pattern: `const h = React\.createElement`
- path: `src/admin/server.js`
- output_mode: content
- -n: true
- head_limit: 5

Use the FIRST occurrence (likely around line 2853 per earlier exploration) as the anchor — that's the SPA's main script entry point. Insert the `ErrorBanner` function right after this `const h = React.createElement;` declaration, before any page components.

- [ ] **Step 2: Insert ErrorBanner component**

Read the 5 lines immediately following `const h = React.createElement;` line in admin/server.js. Find a clean insertion point (preferably after the first const declarations, before any function definitions).

Use Edit tool. Find a unique anchor — e.g., a const declaration that exists right after `const h = React.createElement;`. Insert the ErrorBanner immediately after it:

For example, if you find:
```javascript
const h = React.createElement;
const { useState, useEffect, useCallback, useRef } = React;
```

Replace:
```javascript
const h = React.createElement;
const { useState, useEffect, useCallback, useRef } = React;
```

With:
```javascript
const h = React.createElement;
const { useState, useEffect, useCallback, useRef } = React;

// ── Error banner component (Bundle #13, 2026-05-28) ──────────────────────
// Shared inline error UI. Use as: h(ErrorBanner, { message, onRetry, variant })
// Mirror of dashboard SPA's ErrorBanner — keep in sync.
function ErrorBanner({ message, onRetry, variant }) {
  const v = variant || 'error';
  return h('div', { className: 'error-banner error-banner-' + v },
    h('span', { className: 'error-banner-icon' }, v === 'error' ? '⚠' : 'ⓘ'),
    h('span', { className: 'error-banner-msg' }, String(message || 'Something went wrong')),
    onRetry ? h('button', { className: 'error-banner-retry', onClick: onRetry }, 'Retry') : null
  );
}
```

If the exact 2-line anchor doesn't match — adapt to whatever 1-2 unique adjacent lines exist after `const h = React.createElement;`. Read 10 lines around to find a stable anchor.

- [ ] **Step 3: Add error-banner CSS to admin SPA `<style>` block**

Same CSS as Task 5 Step 2 — adapt admin SPA. Use Grep to find a stable anchor in admin's `<style>` block (e.g., `.toast` or `.modal-section`). Insert the same CSS rules (uses `var(--red-rgb)`, `var(--orange-rgb)` which exist in admin theme too — verified by reading theme block).

Add this CSS block (same as dashboard):

```css
    .error-banner {
      display: flex; align-items: center; gap: 8px;
      padding: 10px 14px;
      border-radius: 8px;
      font-size: 13px;
      margin: 8px 0;
    }
    .error-banner-error {
      background: rgba(var(--red-rgb), .08);
      border: 1px solid rgba(var(--red-rgb), .3);
      color: var(--red2);
    }
    .error-banner-warn {
      background: rgba(var(--orange-rgb), .08);
      border: 1px solid rgba(var(--orange-rgb), .3);
      color: var(--orange2);
    }
    .error-banner-icon { font-size: 16px; }
    .error-banner-msg { flex: 1; }
    .error-banner-retry {
      padding: 4px 10px; border-radius: 6px;
      background: transparent;
      border: 1px solid currentColor;
      color: inherit; cursor: pointer; font-size: 12px;
    }
    .error-banner-retry:hover { background: rgba(255,255,255,.05); }
```

**Note**: admin CSS theme may not have `--red-rgb` / `--orange-rgb` vars defined. If `npm run check:spa` passes but visually broken — fall back to hex literals: `rgba(244,33,46,.08)` for red, `rgba(255,167,38,.08)` for orange. **Check via Grep on `src/admin/server.js` for `--red-rgb`** — if absent, use hex literals.

If `--red-rgb` not found in admin SPA: replace `rgba(var(--red-rgb), .08)` → `rgba(244,33,46,.08)` and `border: 1px solid rgba(var(--red-rgb), .3)` → `rgba(244,33,46,.3)` and `color: var(--red2)` → `color: #ff6b6b`. Similar for orange: hex 255,167,38 / color #ffcc80.

- [ ] **Step 4: Run SPA validation gate**

Run: `npm run check:spa`

Expected: exit 0, admin char count slightly HIGHER than baseline (266605 → ~268500 or so).

- [ ] **Step 5: Wire StatsPage error state**

Use Read tool on `src/admin/server.js` lines 4678-4750 to find StatsPage's fetch code. Look for:
- `useState` declarations including loading and possibly error state
- `api(...)` или `fetch(...)` call with `.catch(...)`
- A render section that shows the page content

Pattern to wire in:
1. Add `const [error, setError] = useState(null);` if not already present
2. In the fetch `.catch(...)`, set `setError(err.message || 'Failed to load stats')`
3. At the top of the page render section, add `error ? h(ErrorBanner, { message: error, onRetry: refetchStats, variant: 'error' }) : null,`
4. Define `refetchStats` as a function that clears error + re-runs the fetch.

**Concrete pattern (adapt to actual existing code shape)** — the implementer reads the current StatsPage code, then applies:

```javascript
// Inside StatsPage component (find this pattern, adapt to actual variable names):
const [stats, setStats]   = useState(null);
const [error, setError]   = useState(null);
const [loading, setLoading] = useState(true);
const refetch = useCallback(() => {
  setError(null);
  setLoading(true);
  api('/api/stats').then(s => { setStats(s); setLoading(false); })
    .catch(err => { setError(err.message || 'Failed to load stats'); setLoading(false); });
}, []);
useEffect(() => { refetch(); }, [refetch]);

// In render JSX, near the top:
return h('div', { className: 'admin-page' },
  error ? h(ErrorBanner, { message: error, onRetry: refetch, variant: 'error' }) : null,
  // ... existing content ...
);
```

If StatsPage already has `error` state — just wire the `<ErrorBanner>` render + ensure the catch path sets `error`.

If StatsPage uses `await api(...)` inside an async function — wrap в try/catch with `setError(e.message)` in the catch.

- [ ] **Step 6: Wire DecisionsPage error state**

Same pattern as Step 5, but for DecisionsPage at line 4009. Read the component, find its fetch (likely `/api/decisions` or similar), apply the same `error` state + ErrorBanner render + refetch callback.

- [ ] **Step 7: Wire StatusBar error state**

Same for StatusBar at line 7210. StatusBar is at the top of every page — a full ErrorBanner might be too prominent. Use a more compact display: just render the ErrorBanner with smaller variant if you can, or wrap в `style: { fontSize: 11 }` override. Concrete decision: keep using the same ErrorBanner component but only show when error is set + perhaps without retry button (StatusBar refreshes via SSE):

```javascript
error ? h(ErrorBanner, { message: 'Pipeline status unavailable: ' + error, variant: 'warn' }) : null,
```

(Omit onRetry — StatusBar gets data via SSE; user can refresh page if persistent.)

- [ ] **Step 8: Run SPA validation gate**

Run: `npm run check:spa`

Expected: exit 0. Admin char count slightly higher than after Step 4 (additional error handling + ErrorBanner JSX calls).

- [ ] **Step 9: Verify all 3 pages have ErrorBanner wired**

Use Grep tool:
- pattern: `h\(ErrorBanner,`
- path: `src/admin/server.js`
- output_mode: content
- -n: true

Expected: **at least 3 matches** (one per page: StatsPage, DecisionsPage, StatusBar). Possibly more if pages have multiple fetch sites with separate error states.

If matches < 3 → at least one page missing wire-up; fix.

- [ ] **Step 10: Task complete** — no commit; advance to Task 7.

---

## Task 7: SESSION_CONTEXT + WORKLOG + final SPA check

**Files:**
- Modify: `F:\.VibeCoding\Projects\Antigravity\Narrative Parser\ai-context\SESSION_CONTEXT.md`
- Modify: `F:\.VibeCoding\Projects\Antigravity\Narrative Parser\ai-context\WORKLOG.md`

- [ ] **Step 1: Locate Production posture section in SESSION_CONTEXT.md**

Use Grep tool:
- pattern: `Observability persistence|URL safety helpers|Production posture`
- path: `ai-context/SESSION_CONTEXT.md`
- output_mode: content, -n true, -A 2

Find the most recently-added bullet (likely "Observability persistence" from Bundle #2) — that's our anchor.

- [ ] **Step 2: Add Error visibility bullet after Bundle #2's bullet**

Use Edit tool. Find a unique 1-2 line excerpt from the "Observability persistence" bullet (likely ending with "Closes BILL-002, ADM-002, ADM-005, COST-003, PIPE-016."). Replace it with itself + the new bullet.

Add this bullet:

```markdown
- **Error visibility** (Bundle #13, 2026-05-28): `<ErrorBanner>` shared React component inline в обоих SPA templates (dashboard + admin), wired into 4 critical fetch sites (dashboard feed, admin StatsPage/DecisionsPage/StatusBar). `src/notifications/admin-alert.js` exports `notifyAdminCrash(error, context)` — posts to `config.support.groupId` via support bot, with 5-min dedupe via in-memory Map. Wired into `uncaughtException` / `unhandledRejection` (src/index.js:762-763) + per-user dispatch loop try/catch (src/notifications/alert-dispatcher.js:176) + TG 4096-char truncate (src/notifications/telegram.js `_sendPlainTextChunked` helper, sends full payload to admin для post-mortem). NO Sentry / no third-party SaaS — admin TG group is the destination. Closes ADM-001, UX-001, BOT-003, PROD-006, BOT-020.
```

- [ ] **Step 3: Read top of WORKLOG.md to confirm entry format**

Use Read tool with `limit: 60` on `ai-context/WORKLOG.md`. Confirm the heading format (e.g., `## YYYY-MM-DD · model · Bundle #N — title (FINDING-IDs)`) and field labels.

- [ ] **Step 4: Prepend Bundle #13 entry to WORKLOG.md**

Use Edit tool. Replace the topmost entry's heading (likely `## 2026-06-07 · sonnet · Bundle #2 — Observability persistence ...`) such that the new entry appears immediately above it, separated by `---`.

Adapt heading to match exact style of existing top entry. Body:

```markdown
## 2026-05-28 · sonnet · Bundle #13 — Error visibility (ADM-001, UX-001, BOT-003, PROD-006, BOT-020)

**Цель**: Закрыть 5 high-severity finding'ов visibility — silent admin UI errors, silent feed errors, TG 4096 truncate drop, no admin crash alerts, per-user dispatch cascade.

**Метод**: subagent-driven (sonnet оркестратор, haiku для мехач задач). 7-task bundle: T1 admin-alert.js module → T2 index.js wiring → T3 alert-dispatcher loop try/catch → T4 telegram.js 4096 truncate helper → T5 ErrorBanner в dashboard SPA + feed wire-up → T6 ErrorBanner в admin SPA + 3 page wire-ups → T7 docs. Per-task `npm run check:spa` validation после edit'a SPA templates (T5 + T6).

**Approach decision**: **No Sentry / no third-party SaaS**. Solo-dev масштаб — admin TG group (already configured via `config.support.groupId` for support bot forum-topics) — достаточная destination для crash visibility. Sentry легко reversible later (5-line init + npm install), но defer до реальной потребности.

**Файлы**:
- `src/notifications/admin-alert.js` — **new** (~75 LOC, 3 exports: `initAdminAlerts`, `notifyAdminCrash`, `_resetForTest`). In-memory dedupe Map (fingerprint = errorName + stack first line, 5-min cooldown). Admin message itself truncates if > 4000 chars (avoid recursive 4096 hit).
- `src/index.js`:
  - +1 import + `initAdminAlerts(supportBot?.bot, config, logger)` после supportBot construction (line ~160).
  - `uncaughtException` + `unhandledRejection` handlers (line 762-763) теперь log + `notifyAdminCrash`.
- `src/notifications/alert-dispatcher.js` — `for (const user of activeUsers)` loop (line 176) body wrapped в try/catch с `notifyAdminCrash` + continue. Cascade prevention для BOT-020.
- `src/notifications/telegram.js`:
  - +1 import.
  - New helper method `_sendPlainTextChunked(chatId, message, opts, ctx)` — truncate at 4090 + admin notify с full payload.
  - 4 `bot.sendMessage(chatId, message, ...)` callsites within `sendAlertToUser` (line 1233) заменены на `_sendPlainTextChunked`.
- `src/dashboard/server.js`:
  - Inline `ErrorBanner({message, onRetry, variant})` component после Bundle #3's URL safety helpers (~line 7110).
  - CSS `.error-banner` family добавлен в `<style>` block (red/orange variants, retry button).
  - Feed error-bar (line 14295) заменён на `<ErrorBanner>` с `onRetry: refreshAll`.
- `src/admin/server.js`:
  - Inline duplicate `ErrorBanner` (mirror of dashboard) после `const h = React.createElement` setup.
  - CSS duplicate (may use hex literals если `--red-rgb` не определён в admin theme).
  - 3 page wire-ups: StatsPage (line 4678), DecisionsPage (line 4009), StatusBar (line 7210). Каждая — `error` state + setError в catch + ErrorBanner render. StatusBar — без retry (refresh через SSE).
- `ai-context/SESSION_CONTEXT.md` — +1 bullet в Production posture.

**Деплой**: subagents file edits only. Operator commits selectively + deploys через `deploy.ps1`. Bundle #16 SPA gate (`[1/5] Validating SPA syntax`) валидирует SPA повторно. Требует `SUPPORT_GROUP_ID` env var (уже configured для support bot). Если не set — `notifyAdminCrash` no-op'ит (boot warns once).

**Риски**: low. `notifyAdminCrash` все TG sends в try/catch — не cascade. Dedupe Map unbounded но 5-min retention + per-process restart = capped в практике. ErrorBanner inline duplicate — established pattern (Bundle #3 URL safety, Bundle #2 entitlements). Admin SPA CSS возможно потребует hex literal fallback если `--red-rgb` отсутствует.

**Closes**: ADM-001 (HIGH), UX-001 (HIGH), BOT-003 (HIGH), PROD-006 (HIGH), BOT-020 (HIGH). 5 findings — все HIGH.
```

- [ ] **Step 5: Final full SPA validation**

Run from project root: `npm run check:spa`

Expected: exit 0. Both SPA char counts slightly higher than pre-Bundle-#13 baseline:
- Dashboard: ~342813 (Bundle #2 baseline) + ~1.5KB (ErrorBanner + CSS) - some (feed bar replacement) = ~344000
- Admin: 266605 + ~3KB (ErrorBanner + CSS + 3 wire-ups) = ~269500

If FAIL → investigate; cumulative edits broke something.

- [ ] **Step 6: Sanity-check admin-alert.js module load**

Run from project root:

```
node -e "import('./src/notifications/admin-alert.js').then(m => { console.log('exports:', Object.keys(m).sort().join(',')); m.initAdminAlerts(null, { support: { groupId: null } }, console); m.notifyAdminCrash(new Error('test'), { foo: 'bar' }).then(() => console.log('no-op call returned OK')); })"
```

Expected output:
```
exports: _resetForTest,initAdminAlerts,notifyAdminCrash
[admin-alert] No SUPPORT_GROUP_ID configured — crash notifications disabled
no-op call returned OK
```

- [ ] **Step 7: Task complete** — operator will commit + deploy.

---

## Operator hand-off (post-implementation)

### Diff summary
- `git status` + `git diff --stat`
- Expected modified: `src/index.js`, `src/notifications/alert-dispatcher.js`, `src/notifications/telegram.js`, `src/dashboard/server.js`, `src/admin/server.js`, `ai-context/SESSION_CONTEXT.md`, `ai-context/WORKLOG.md`
- Expected new: `src/notifications/admin-alert.js`

### Pre-deploy verification (local)
1. `npm run check:spa` — exit 0.
2. `node -e "import('./src/notifications/admin-alert.js').then(...)"` (Step 6 above) — exports OK, no-op call OK.
3. `npm run dev` — boot up, look for log line `[admin-alert] Initialized — crash notifications enabled` (assuming SUPPORT_GROUP_ID set). If you see `[admin-alert] No SUPPORT_GROUP_ID configured ...` → check `.env`.

### Deploy
Standard `deploy.ps1`. Bundle #16's `[1/5] Validating SPA syntax` defense-in-depth gate runs first.

### Smoke after deploy
1. **TG admin alert**: trigger an artificial uncaught exception locally (e.g., `throw new Error('test')` in any non-handler) → expect TG message in support group with `🚨` icon, env, error name, stack first 4 lines.
2. **Per-user isolation**: corrupt one user's `disabled_sources` in DB (set to invalid JSON), trigger scanner pass → expect: that user's processing crashes + admin TG alert + OTHER users still get alerts (cascade prevented).
3. **TG 4096 truncate**: trigger an alert with > 4096 chars (long Russian text) → expect: user receives truncated message ending `…[truncated, see admin log]`, admin gets full payload in support group.
4. **Dashboard feed error**: take dashboard endpoint down briefly (kill DB process / disconnect) → reload feed → expect `<ErrorBanner>` with red border + Retry button. Click Retry once DB is up → feed loads.
5. **Admin StatsPage error**: same trick for admin StatsPage → expect ErrorBanner.

## Closed findings

- **ADM-001** (HIGH): admin StatsPage / DecisionsPage / StatusBar error states — closed via ErrorBanner wire-up в admin SPA.
- **UX-001** (HIGH): feed error state — closed via ErrorBanner replacing existing primitive error-bar + retry button.
- **BOT-003** (HIGH): TG 4096 silent drop — closed via `_sendPlainTextChunked` truncate at 4090 + admin payload.
- **PROD-006** (HIGH): no admin crash alerts — closed via `notifyAdminCrash` в uncaughtException + unhandledRejection.
- **BOT-020** (HIGH): per-user dispatch cascade — closed via try/catch wrap в alert-dispatcher.js loop.

---

## Self-review

(Run by plan author — implementers can skip.)

**1. Spec coverage:**
- Spec §"`src/notifications/admin-alert.js`" → Task 1 ✅
- Spec §"Wiring в `src/index.js`" → Task 2 ✅
- Spec §"Wiring в `alert-dispatcher.js`" → Task 3 ✅
- Spec §"Wiring в `telegram.js`" — spec мentioned single line but reality has 4 callsites. Plan extracts helper method + replaces all 4. Task 4 ✅.
- Spec §"ErrorBanner inline component" — Tasks 5 + 6 ✅ (dashboard + admin both get inline duplicate).
- Spec §"Wire-up в 4 callsites" — Task 5 (dashboard feed) + Task 6 (3 admin pages) ✅.
- Spec §"SESSION_CONTEXT bullet + WORKLOG" — Task 7 ✅.
- Spec §"Verification plan" — covered by per-task verification + smoke checklist in operator hand-off.

**2. Placeholder scan:** No "TBD" / "TODO" / "Add appropriate" patterns. All code blocks contain real code. **One soft area**: Task 6 Step 5/6/7 (admin page wire-ups) describes the pattern but says "find this pattern, adapt to actual variable names" — that's inherent because admin pages may have varying error-state shapes already. The PATTERN is concrete; the implementer adapts by reading actual code first. Acceptable for spec-fidelity since the desired end-state is precisely described.

**3. Type consistency:**
- `notifyAdminCrash(error, context)` signature consistent across Task 1 definition + Tasks 2/3/4 callers.
- `ErrorBanner({ message, onRetry, variant })` signature consistent between Task 5 (dashboard) and Task 6 (admin).
- `_sendPlainTextChunked(chatId, message, opts, ctx)` signature consistent across all 4 call sites in Task 4.
- CSS class names `.error-banner` / `.error-banner-error` / `.error-banner-warn` / `.error-banner-icon` / `.error-banner-msg` / `.error-banner-retry` used consistently.

Plan saved. Ready for execution.
