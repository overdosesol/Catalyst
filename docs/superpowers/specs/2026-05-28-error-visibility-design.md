# Error Visibility Bundle — Design Spec

**Bundle**: #13 из `docs/audit/INDEX.md` (Tier 2)
**Date**: 2026-05-28
**Author**: brainstorm session (operator + sonnet, operator delegated per «решай сам»)
**Status**: Approved scope (approach A — no Sentry, admin TG alerts + ErrorBanner + per-user isolation + TG 4096 truncate), ready for writing-plans

---

## Goal

Закрыть 5 audit finding'ов — silent error states в UI + delivery + crash visibility. **No Sentry / no third-party SaaS** (solo-dev масштаб). Использовать существующий support bot infrastructure (`config.support.groupId`) для admin crash alerts. Inline `<ErrorBanner>` React component в обоих SPA templates. Per-user dispatch loop crash isolation. TG plain-text 4096 truncate с admin-side post-mortem dump.

## Context

### Findings (5)

- **ADM-001 [HIGH]** — 3 silent error states в admin (StatsPage / DecisionsPage / StatusBar). При `/api` 5xx или network fail — UI silent. StatusBar буквально исчезает. Operator во время incident видит stale data → hides реальный outage.
- **UX-001 [HIGH]** — Feed error state отсутствует. При `GET /api/trends` network fail — `.catch()` глотает ошибку. UI показывает либо stale data, либо infinitely loading skeleton, либо пустоту. Ни toast, ни inline banner.
- **BOT-003 [HIGH]** — TG plain text > 4096 chars silent drop. Длинные `whyNow + aiExplanation + triggerText` (особенно RU) hit'ят 4096 limit → TG возвращает 400 → alert не доставляется. Юзер не знает, операtor видит только `[skipped]` в логах.
- **PROD-006 [HIGH]** — Нет external error tracking + нет admin TG crash alerts. `process.on('uncaughtException', ...)` (src/index.js:762) и `process.on('unhandledRejection', ...)` (line 763) только логируют — нет admin notification. Process может hang weird state, restart только через Docker healthcheck (~90s lag).
- **BOT-020 [HIGH]** — Per-user loop crash isolation отсутствует. `src/notifications/alert-dispatcher.js:176` — `for (const user of activeUsers)` без try/catch вокруг body. Внутри `JSON.parse(user.disabled_sources)` может throw → cascade failure для всех remaining users. Silent systematic delivery failure.

### Existing infrastructure

- **Support bot**: `src/support/bot.js` уже использует `config.support.groupId` для forum-topics (user message → topic в admin group). Loaded at line 29-30 (`this.token`, `this.groupId`). `this.bot.sendMessage(this.groupId, ...)` pattern на line 177-181.
- **uncaughtException handler**: `src/index.js:762` — `process.on('uncaughtException', err => logger.error(...))`. Log-only, no admin alert.
- **unhandledRejection handler**: `src/index.js:763` — same.
- **Per-user dispatch loop**: `src/notifications/alert-dispatcher.js:176` — `for (const user of activeUsers) { ... }` без try/catch wrapper.
- **TG send sites**: `src/notifications/telegram.js:1238` (`bot.sendVideo` + plain `bot.sendMessage` fallback). Already has caption-length check (`CAPTION_MAX = 1024`, line 1268). BUT plain `bot.sendMessage(chatId, message)` для non-video alerts (~line 1311) — NO length check, hits 4096 silent drop.
- **AnalyzePanel inline error pattern**: `src/dashboard/server.js:11380` — `error ? h('span', { className: 'analyze-error' }, '⚠ ' + error) : null`. Simple inline span, не banner. Visual reference для ErrorBanner.
- **Silent fail patterns**: dashboard SPA has many `.catch(() => { setData([]); setLoading(false); })` blocks (e.g., line 10457 alert history, etc.) — sites that need ErrorBanner wire-up.

---

## Scope

### In-scope

**1. ErrorBanner React component (inline in both SPA templates)**

- Inline duplicate в `src/dashboard/server.js` (after the existing helpers block we added in Bundle #3, ~line 7110 area)
- Inline duplicate в `src/admin/server.js` (after admin SPA's React import setup)
- Function shape: `function ErrorBanner({ message, onRetry, variant })` returning `h('div', { className: 'error-banner' + variant }, ...)`
- CSS: уже есть `--red`, `--orange`, `--surface` CSS vars в обоих themes. Banner — rounded box с red border + alert icon + message + retry button.
- Variants: `'error'` (red, default) / `'warn'` (orange).

**2. ErrorBanner wire-up в 5 callsites**

- **Dashboard Feed** (UX-001): replace silent `.catch()` в feed fetch with `setError(...)` + render `<ErrorBanner message=... onRetry={refetch} />` when feed fetch fails.
- **Admin StatsPage** (ADM-001 part 1): same pattern.
- **Admin DecisionsPage** (ADM-001 part 2): same.
- **Admin StatusBar** (ADM-001 part 3): same, but smaller variant (inline, не full banner).
- (Other silent-fail sites in dashboard — sparkline, alert history, etc. — могут остаться silent для now; они secondary UI, не critical path. Scope creep avoided.)

**3. Admin crash alert helper (`src/notifications/admin-alert.js` — new module)**

- Exports `notifyAdminCrash(error, context)` — sends formatted message to `config.support.groupId` via the support bot instance.
- Dedupe: in-memory `Map<fingerprint, lastSentTs>` with 5-min cooldown. Fingerprint = `error.name + ':' + first line of stack` (or `error.message` если no stack).
- Telegram message shape: `🚨 <code>${env}</code> ${error.name}\n${escHtml(error.message)}\n\n<pre>${escHtml(stackFirst3Lines)}</pre>\n\nContext: ${escHtml(JSON.stringify(context))}`
- Returns Promise; never throws (swallows TG send errors via `.catch(() => {})` — admin TG failure shouldn't cascade into another crash).

**4. Wire admin alerts into 3 sites**

- `src/index.js:762` — `uncaughtException` handler: also call `notifyAdminCrash(err, { kind: 'uncaughtException' })`.
- `src/index.js:763` — `unhandledRejection` handler: same with `kind: 'unhandledRejection'`.
- `src/notifications/alert-dispatcher.js:176` — wrap loop body в try/catch: log + `notifyAdminCrash(e, { kind: 'alert-dispatch-per-user', userId: user.id, telegram_chat_id: user.telegram_chat_id })` + continue.

**5. TG plain text 4096 truncate (BOT-003)**

- В `src/notifications/telegram.js:1311` area (plain `bot.sendMessage` для non-video alerts) — check `message.length > 4090`.
- Truncate at 4090 chars + suffix `\n\n…[truncated, see admin log]`.
- Send full payload to admin TG via `notifyAdminCrash(new Error('alert_truncated'), { kind: 'tg_truncate', userId, telegram_chat_id, fullMessageLength: message.length, fullMessage: message.slice(0, 8000) })` — admin sees full payload for post-mortem.
- Note: alternative would be splitting into 2 TG messages but spec'овски operator chose truncate (split fragments narrative).

**6. SUPPORT_GROUP_ID env var visibility**

- Ensure `config.support.groupId` is read at boot.
- If missing — log warning at boot but don't crash. `notifyAdminCrash` becomes no-op when groupId not set.

**7. Docs**

- `ai-context/SESSION_CONTEXT.md` — bullet в Production posture about error visibility.
- `ai-context/WORKLOG.md` — Bundle #13 entry.

### Out-of-scope

- **Sentry / Bugsnag / external error aggregator** — operator delegated → skipped per «no third-party SaaS» reasoning. Easily reversible later (5-line init + npm install).
- **Per-source loop isolation в collectors** (reddit/twitter/tiktok) — same pattern would apply, но scope creep. Defer to separate bundle if needed.
- **Error persistence в `admin_audit_log`** (Bundle #2 table) — could log crashes as `event_type: 'crash'`, но TG alerts уже cover post-mortem visibility. YAGNI.
- **Other silent-fail sites в dashboard** — sparkline, alert history, etc. Not critical UX. Scope creep.
- **Tests** — нет existing test infra (consistent с предыдущими bundles).
- **Admin UI viewer for crash log** — нет crash log persistence; viewing happens through TG group history.
- **Rate-limit на admin notifications beyond 5-min cooldown** — out of scope; if dedupe insufficient operator manually mutes support group.

---

## Architecture

### Files affected

| File | Action | Detail |
|---|---|---|
| `src/notifications/admin-alert.js` | **new** | `notifyAdminCrash(error, context)` + dedupe Map + `init(supportBotInstance)` accessor pattern. ~60 LOC. |
| `src/index.js` | modify | Wire `notifyAdminCrash` into `uncaughtException` + `unhandledRejection` handlers (lines 762-763) + pass support bot instance to module init. |
| `src/notifications/alert-dispatcher.js` | modify | Wrap loop body (line 176) в try/catch + `notifyAdminCrash`. |
| `src/notifications/telegram.js` | modify | Insert 4096 truncate check before plain `bot.sendMessage(...)` (~line 1311). |
| `src/dashboard/server.js` | modify | Add inline `ErrorBanner` component в SPA template (after Bundle #3's URL safety helpers, ~line 7110) + wire into Feed fetch error state. |
| `src/admin/server.js` | modify | Add inline `ErrorBanner` component в admin SPA (mirror dashboard's inline) + wire into StatsPage / DecisionsPage / StatusBar fetch error states. |
| `ai-context/SESSION_CONTEXT.md` | modify | +1 bullet |
| `ai-context/WORKLOG.md` | modify | Bundle #13 entry |

### Files NOT touched

- `src/notifications/formatter.js` — message construction unchanged (we truncate AT SEND, not in formatter).
- `src/support/bot.js` — support bot kept distinct; admin-alert module accesses its `.bot` instance through init wiring (see "Wiring" section).
- `package.json` — no new deps. (Sentry deferred.)
- DB schema — no changes.

---

## Design: `src/notifications/admin-alert.js`

```javascript
// Admin crash alert helper — Bundle #13 (2026-05-28).
// Posts crash/error notifications to config.support.groupId via the support
// bot. Used by uncaughtException / unhandledRejection / per-user dispatch
// crashes / TG truncate events.
//
// Init flow: src/index.js calls initAdminAlerts(supportBotInstance, config)
// at boot. Until init is called, notifyAdminCrash() is a no-op (logs once).

let _bot = null;
let _groupId = null;
let _logger = console;
const _dedupeMap = new Map(); // fingerprint -> lastSentMs
const _COOLDOWN_MS = 5 * 60 * 1000;

/**
 * Wire the admin-alert module to the support bot instance.
 * Safe to call once at boot from src/index.js. If groupId missing,
 * notifyAdminCrash becomes a no-op (logs the gap once).
 */
export function initAdminAlerts(supportBot, config, logger) {
  _bot = supportBot;
  _groupId = config?.support?.groupId || null;
  _logger = logger || console;
  if (!_groupId) {
    _logger.warn('[admin-alert] No SUPPORT_GROUP_ID configured — crash notifications disabled');
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
 * with 5-min cooldown per fingerprint.
 *
 * @param {Error|string} error
 * @param {Object} [context] - structured payload, JSON.stringify'd safely
 */
export async function notifyAdminCrash(error, context = {}) {
  if (!_bot || !_groupId) return; // no-op until initialized

  const err = error instanceof Error ? error : new Error(String(error));
  const fp = fingerprint(err);
  const now = Date.now();
  const lastSent = _dedupeMap.get(fp) || 0;
  if (now - lastSent < _COOLDOWN_MS) return; // suppress dup within cooldown

  _dedupeMap.set(fp, now);

  const env = process.env.NODE_ENV || 'unknown';
  const stackLines = (err.stack || '').split('\n').slice(0, 4).join('\n');

  let ctxStr = '';
  try { ctxStr = JSON.stringify(context).slice(0, 500); }
  catch { ctxStr = '(context not serializable)'; }

  const msg =
    `🚨 <code>${escHtml(env)}</code> <b>${escHtml(err.name)}</b>\n` +
    `${escHtml(err.message)}\n\n` +
    `<pre>${escHtml(stackLines)}</pre>\n\n` +
    `Context: <code>${escHtml(ctxStr)}</code>`;

  try {
    await _bot.sendMessage(_groupId, msg, {
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      disable_notification: false,
    });
  } catch (e) {
    // Admin TG send failed — log and swallow. Don't cascade.
    _logger.warn(`[admin-alert] sendMessage to admin group failed: ${e.message}`);
  }
}

// Test/debug helper — exposed for unit checks that we don't run, but easy
// to invoke from REPL.
export function _resetForTest() {
  _dedupeMap.clear();
}
```

### Wiring в `src/index.js`

Around boot section (where support bot is instantiated — verify exact lines during implementation):

```javascript
import { initAdminAlerts, notifyAdminCrash } from './notifications/admin-alert.js';

// ... existing code ...

// After supportBot = new SupportBot(...); init:
initAdminAlerts(supportBot?.bot, config, logger);

// At line 762-763, replace existing handlers with admin-alert calls:
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

### Wiring в `alert-dispatcher.js`

Around line 176 (the `for (const user of activeUsers)` loop body):

```javascript
import { notifyAdminCrash } from './admin-alert.js';

// ... in the dispatch function ...

for (const user of activeUsers) {
  try {
    if (user.status === 'suspended') continue;
    // ... existing loop body unchanged ...
  } catch (err) {
    logger.error(`[alert-dispatch] per-user crash uid=${user.id}: ${err.message}`, { stack: err.stack });
    notifyAdminCrash(err, {
      kind: 'alert-dispatch-per-user',
      userId: user.id,
      telegram_chat_id: user.telegram_chat_id,
      plan_id: user.plan_id,
    });
    // continue to next user
  }
}
```

### Wiring в `telegram.js` (BOT-003 truncate)

Around line 1311 (plain `bot.sendMessage` для non-video). Verified exact placement during implementation.

```javascript
import { notifyAdminCrash } from './admin-alert.js';

const TG_PLAIN_LIMIT = 4096;
const TG_TRUNCATE_AT = 4090;
const TRUNCATE_SUFFIX = '\n\n…[truncated, see admin log]';

// Inside the non-video send path, BEFORE bot.sendMessage(chatId, message, ...):
let outgoingMessage = message;
if (message.length > TG_PLAIN_LIMIT) {
  outgoingMessage = message.slice(0, TG_TRUNCATE_AT) + TRUNCATE_SUFFIX;
  notifyAdminCrash(new Error('alert_truncated'), {
    kind: 'tg_truncate',
    userId,                                  // captured from outer scope
    telegram_chat_id: chatId,
    fullMessageLength: message.length,
    fullMessage: message.slice(0, 8000),     // first 8KB to admin for diagnosis
  });
}

await this.bot.sendMessage(chatId, outgoingMessage, {
  parse_mode: 'HTML',
  disable_web_page_preview: true,
  reply_to_message_id: sentMsg?.message_id,
});
```

### ErrorBanner inline component

**В dashboard SPA template** (`src/dashboard/server.js`, after Bundle #3's URL safety helpers, ~line 7110):

```javascript
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
```

**CSS** (added to the existing `<style>` block в обоих SPA templates):

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

**В admin SPA template** (`src/admin/server.js`, after the admin React setup): inline duplicate of the same `ErrorBanner` function (admin SPA uses `const h = React.createElement` separately).

### Wire-ups in dashboard Feed (UX-001)

The Feed fetch site — needs identification during implementation. Pattern:

```javascript
// Before:
api('/api/trends?...').then(setData).catch(() => setData([]));

// After:
const [feedError, setFeedError] = useState(null);
const refetchFeed = useCallback(() => {
  setFeedError(null);
  api('/api/trends?...').then(setData).catch(err => setFeedError(err.message || 'Failed to load feed'));
}, [/* deps */]);

// In render:
feedError ? h(ErrorBanner, { message: 'Failed to load trends: ' + feedError, onRetry: refetchFeed }) : null,
// ... existing feed rendering ...
```

Same pattern for Admin StatsPage / DecisionsPage / StatusBar.

---

## SESSION_CONTEXT.md update

```markdown
- **Error visibility** (Bundle #13, 2026-05-28): `<ErrorBanner>` shared React component inline в обоих SPA templates (dashboard + admin) + wired into 5 critical fetch sites (feed, admin StatsPage/DecisionsPage/StatusBar). `src/notifications/admin-alert.js` exports `notifyAdminCrash(error, context)` — posts to `config.support.groupId` via support bot, with 5-min dedupe via in-memory Map. Wired into `uncaughtException` / `unhandledRejection` (src/index.js) + per-user dispatch loop try/catch (src/notifications/alert-dispatcher.js) + TG 4096-char truncate (src/notifications/telegram.js, sends full payload to admin для post-mortem). NO Sentry / no third-party SaaS — admin TG group is the destination. Closes ADM-001, UX-001, BOT-003, PROD-006, BOT-020.
```

---

## Verification plan

### Acceptance criteria

**New file**:
- [ ] `src/notifications/admin-alert.js` exists, exports `initAdminAlerts`, `notifyAdminCrash`, `_resetForTest`.
- [ ] Dedupe Map clears via `_resetForTest()` (manual REPL check).

**index.js**:
- [ ] Imports `initAdminAlerts` + `notifyAdminCrash`.
- [ ] Calls `initAdminAlerts(supportBot?.bot, config, logger)` after support bot init.
- [ ] `uncaughtException` handler calls `notifyAdminCrash`.
- [ ] `unhandledRejection` handler calls `notifyAdminCrash`.

**alert-dispatcher.js**:
- [ ] Loop body wrapped в try/catch.
- [ ] catch calls `logger.error` + `notifyAdminCrash` + continues to next user.

**telegram.js**:
- [ ] Constants `TG_PLAIN_LIMIT = 4096`, `TG_TRUNCATE_AT = 4090` defined.
- [ ] Non-video send path checks `message.length > TG_PLAIN_LIMIT` and truncates.
- [ ] Calls `notifyAdminCrash` with full payload when truncating.

**dashboard/server.js + admin/server.js**:
- [ ] `ErrorBanner` function inline в both SPA templates.
- [ ] CSS for `.error-banner` family added to both `<style>` blocks.
- [ ] Wired into: dashboard Feed, admin StatsPage, admin DecisionsPage, admin StatusBar.

**SPA validation gate (CRITICAL)**:
- [ ] After EACH `src/dashboard/server.js` или `src/admin/server.js` edit: `npm run check:spa` exit 0.
- [ ] Final full SPA check: exit 0.

**Smoke (operator after deploy)**:
- [ ] Trigger feed `/api/trends` failure (e.g., kill DB connection or stop dashboard temporarily) → expect ErrorBanner with Retry button.
- [ ] Kill backend process via `kill -SEGV` or trigger artificial uncaughtException → expect admin TG message in support group.
- [ ] Stop one user's processing (e.g., corrupt `disabled_sources` JSON in DB for one user) → expect: that user's alerts skipped, admin TG alert, OTHER users still get alerts (cascade prevented).
- [ ] Generate alert with > 4096 chars (e.g., via long Russian whyNow text) → expect: user receives truncated message with `…[truncated]` suffix; admin gets full payload in support group.

### Functional edge cases (manual sanity)

- [ ] `notifyAdminCrash(err, ctx)` called 100 times rapidly with same err → admin gets exactly 1 TG message (dedupe works).
- [ ] `notifyAdminCrash(err)` before `initAdminAlerts()` called — no-op, no throw.
- [ ] `notifyAdminCrash(new Error('a'.repeat(10000)))` — message escaped, sent without TG 4096 error (admin alert itself shouldn't be > 4096; truncate inside notifyAdminCrash if needed).

### Closed findings

- ADM-001 (3 silent error states — closed via ErrorBanner wire-ups in admin StatsPage/DecisionsPage/StatusBar).
- UX-001 (Feed error state — closed via ErrorBanner in dashboard Feed).
- BOT-003 (TG 4096 truncate — closed via telegram.js length check + admin payload).
- PROD-006 (no admin crash alerts — closed via `notifyAdminCrash` in uncaughtException + unhandledRejection).
- BOT-020 (per-user loop isolation — closed via try/catch wrap in alert-dispatcher.js).

---

## Risks & mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| `notifyAdminCrash` itself fails → cascade crash | low | All TG sends wrapped в try/catch, swallow + log. `notifyAdminCrash` returns Promise that never rejects. |
| Admin TG group spam (10k errors/sec → 10k messages) | medium | 5-min dedupe per fingerprint. Worst case if 1000 unique errors fire — admin still gets 1000 messages but only 1 per fingerprint per 5 min. Acceptable. |
| `_dedupeMap` grows unbounded → memory leak | low | Map cleared per-process restart. Worst case 100MB if 1M unique fingerprints — never realistic. Acceptable. Future: LRU cap if needed. |
| `support bot` not configured → notifications dropped silently | medium | Log warn at init time so operator notices the gap. Don't crash boot. |
| Edit на dashboard SPA template breaks (backtick trap) | medium | `npm run check:spa` after each `src/dashboard/server.js` + `src/admin/server.js` edit. Proven Bundle #19 / #3 pattern. |
| TG truncate loses info | low | Admin gets full payload in support group → post-mortem possible. End user sees truncated alert with explicit `…[truncated]` indicator. |
| `Retry` button on ErrorBanner triggers infinite loop (refetch fails → banner re-shown → user clicks → ...) | very low | Each retry is user-initiated click. No auto-retry. Acceptable. |
| Dedupe Map shared across all admin alerts | low | Single Map keyed by err name + stack first line. Different errors → different fingerprints → separate messages. By design. |

---

## Estimated effort

| Component | Time |
|---|---|
| Create `src/notifications/admin-alert.js` | 30 min |
| Wire `index.js` (init + 2 handlers) | 15 min |
| Wire `alert-dispatcher.js` (try/catch) | 15 min |
| Wire `telegram.js` (truncate + admin notify) | 20 min |
| `ErrorBanner` component + CSS в dashboard SPA + SPA gate | 30 min |
| ErrorBanner duplicate в admin SPA + SPA gate | 20 min |
| Wire feed error state в dashboard | 25 min |
| Wire admin StatsPage / DecisionsPage / StatusBar error states + SPA gate | 30 min |
| `SESSION_CONTEXT.md` + WORKLOG entry | 15 min |
| Operator: deploy + manual smoke (4 scenarios) | 30 min |
| **Total** | **~3.5h** |

Audit estimate was ~4h. Matches.

---

## Open questions

All resolved per operator delegation:

- Q1: Sentry yes/no? → **No** (solo-dev scale, admin TG sufficient, no third-party dep).
- Q2: TG long message — split vs truncate? → **Truncate** (split fragments narrative for end user; admin gets full payload).
- Q3: ErrorBanner — separate file or inline in SPA template? → **Inline** в обоих (cannot ESM-import в SPA, established pattern).
- Q4: Per-source loop isolation в collectors? → **Out of scope** (defer; same pattern would apply but not in this bundle).
- Q5: Crash log persistence в admin_audit_log? → **No** (TG group covers post-mortem; YAGNI).
- Q6: Admin notify rate limit beyond 5-min cooldown? → **No** (dedupe sufficient; if insufficient operator mutes group).
- Q7: Tests / TDD? → **No** (no existing test infra; SPA gate + manual smoke = verification).

---

## Transition

После approve этого spec — invoke `superpowers:writing-plans` для генерации implementation plan с per-task SPA gates (для dashboard/server.js + admin/server.js edits) + final operator smoke checklist.
