# TG bot + notifications audit — 2026-05-29

**Scope**: восьмой из 12 этапов. Фокус — Telegram main bot (`src/notifications/telegram.js`, ~2390 lines), alert dispatcher (`src/notifications/alert-dispatcher.js`), formatter (`src/notifications/formatter.js`), support bot (`src/support/bot.js`), broadcast pipeline (admin → main bot). **Не покрыто** (другие этапы): security (1 — verified safe, token contained, fetchFile sandboxed), pipeline correctness (2 — PIPE-006 notifications race cross-confirmed), billing (3), cost (4), DB (5 — notifications retention/UNIQUE cross-confirmed), dashboard UX (6), admin panel (7 — broadcast composer cross-checked), nginx/backup (9), cat mascot (10), code quality / SPA-trap (11), docs (12).

**Method**: 6 параллельных haiku-агентов по 13 направлениям + ручная верификация ключевых точек (`escHtml` line 242-245 vs `trend.url` line 145, broadcast composer line 729-778 admin/server.js, support bot `_ensureTopic` + `_creatingTopic` coalescing). Ничего в коде не менялось. Никакого реального TG API не дёргалось.

---

## Command matrix

| Command | Handler | Plan | Cap | Failure UX | Notes |
|---|---|---|---|---|---|
| `/start` | telegram.js:170 | free | — | login link invalid/expired | + auth deep-link (`auth_<sessionId>`); **NO TG language_code auto-detect** (BOT-004) |
| `/start auth_<sessionId>` | :181-205 | free | — | session already verified | **hardcoded RU/EN ternary**, не через t() (BOT-022) |
| `/menu` | :215 | free | — | — | inline keyboard with status badges, plan-aware |
| `/dashboard` | :229 | free | — | — | URL button to web dashboard |
| `/analyze <url>` | :247 | test/pro/admin | 5/100/∞ per 24h | 🔒 plan / ⏳ 30s cooldown / ⛔ daily | help text **hardcoded EN/RU ternary** (BOT-023) |
| bare URL auto-detect | :290-308 | test/pro/admin | same as /analyze | silent-ignore for free | regex `/(https?:\/\/\S+)/i`, free silenced |
| `/top` | :387 | free | — | — | Top trends 3/5/10/20 selector |
| `/skip` (wizard cancel) | :321-328 | n/a | n/a | localized | works mid-wizard only |
| free-text handler (wizard wait) | :312-384 | n/a | 5min auto-cancel | wizard timeout | reason wizard FSM, auto-cleanup lazy on next msg |
| **`/help`** | **— missing** | — | — | — | **BOT-011 — basic CLI UX gap** |
| **`/stop` / `/pause`** | **— missing** | — | — | — | **BOT-012 — only via /menu → toggle_pause** |
| **`/forecast` / `/catalyst`** | **— missing** | — | — | — | **BOT-013 — only via inline button `trigger:`** |
| `/feedback` | — missing | — | — | — | only via vote-on-alert + reason wizard |
| admin commands (force-scan, broadcast) | **— none in bot** | n/a | n/a | n/a | dashboard-only (`/api/admin/*`) |

Reason wizard FSM: vote → reason button shown → user clicks → `_awaitingInput` set → next message captured → save + clear. 5-min timeout (lazy check on next msg, не proactive). `/skip` cancels.

---

## Alert delivery flow

```
[scan-cycle / hot-refresh / manual]
  ↓ trends[] (with alertScore, gates state)
  ↓
alert-dispatcher.dispatchAlerts({trends, source:'scan'|'refresh'|'manual'}):
  for (user of activeUsers)         // **NO outer try/catch** (BOT-005)
    if (user.status === 'suspended') continue           // line 177
    user.disabled_sources = JSON.parse(...)             // ⚠ no try/catch — exception crashes loop
    for (trend of alertCandidates):
      gates: ai_score → threshold → hard_junk → lipsync → tiktok_quality
             → plan_source → source → alert_type → dedup → cap
      firstFail = gates.find(g => !g.passed)
      if (gate fail):
        recordAlertDecision({reason: firstFail.name, gates, ...})  // line 351/363
        continue
      dedupPass = !db.wasNotificationSentToUser(trend._dbId, user.id)  // line 331
      if (!dedupPass): record skip, continue
      [enqueue OR direct] sendTask:
        try:
          await telegram.sendAlertToUser(trend, user, opts)
          db.recordNotification(trend._dbId, 'telegram', user.id)   // line 382 (after success!)
          db.incrementAlertCount(user.id)
          recordAlertDecision({reason:'sent', messageId})
        catch e:
          if (e.response.statusCode === 403):
            db.updateUser(user.id, 'status', 'suspended')           // line 1402-1405
          // NO retry, NO 429 handling (BOT-006)
          recordAlertDecision({reason:'send_failed', ...})
      sleep 100ms (line 441)        // per-trend inline pacing
```

**Race window confirmed (BOT-009 = PIPE-006)**: SELECT pre-check (line 331) → gate eval → enqueue → **async delay** → execute → INSERT (line 382). Two concurrent dispatchers (scan + refresh) both pass line 331, both INSERT — duplicate notification to user. Нет UNIQUE constraint на `(trend_id, user_id, channel)` (PIPE-006/DB-007).

**formatter.formatAlert(trend)** строит HTML message:
- `parse_mode='HTML'` (TG supports: `<b>`, `<i>`, `<u>`, `<s>`, `<code>`, `<pre>`, `<a href>`).
- `escHtml(text)` (line 242-245) escape'ит **только** `&`, `<`, `>` — НЕ `"` и `'`.
- **`trend.url` inject'ится в `<a href="${trend.url}">` БЕЗ escape attribute** (line 145) — BOT-001.

**sendAlertToUser → sendPhoto/sendVideo/sendMediaGroup** (lines 1233-1411):
- Direct URL to TG (no proxy, no pre-download).
- Caption mode if message ≤ 1024 chars, else split into media + follow-up text.
- **Plain text mode НЕ truncate'ится** к 4096 (TG limit) — длинный whyNow + aiExplanation + trigger → 400 от TG, drop (BOT-003).
- Photo 404 fallback: video → photo → text-only.

---

## Bot inventory

| | Main bot | Support bot |
|---|---|---|
| Token env | `TELEGRAM_BOT_TOKEN` | `SUPPORT_BOT_TOKEN` |
| File | `src/notifications/telegram.js` | `src/support/bot.js` |
| Chat IDs handled | individual user DMs + active users from `users` table | individual user DMs + 1 supergroup with topics |
| State storage | `users`, `notifications`, `feedback_votes`, `hidden_trends`, `user_favorites`, `_manualAnalysisHits`, `_awaitingInput`, `_cachedBotUsername` | `support_threads(chat_id PK, topic_id, group_id, username)`, `_creatingTopic` Map |
| Shared with main | n/a | reads `users.language` для lang resolution |
| Graceful disable | if `TELEGRAM_BOT_TOKEN` missing — fail-fast at boot (assume — not verified) | if `SUPPORT_BOT_TOKEN` or `SUPPORT_GROUP_ID` missing → `enabled=false`, main flow продолжает |
| Polling vs webhook | polling (assume based on `node-telegram-bot-api` default) ⚠ unverified | polling (same) |
| Privacy mode @BotFather | normal (commands handling — default OK) | **MUST be OFF** (forum-topics relay needs to see all group messages); SESSION_CONTEXT bootstrap-инвариант |
| User-facing entity | `@<BOT_USERNAME>` (auth, alerts, /menu, /analyze) | `@CatalystSupportbot` (support DM) |
| Auth | bot.getMe() cached `_cachedBotUsername` (BOT-014: no TTL, no refresh) | n/a (only topic relay) |

`_supportUrl()` (telegram.js:768-771) — main bot menu's «Ask Question» button: prefer `config.support.botUsername`, fallback hardcoded `t.me/skipnick`.

---

## Summary

**Counts**: 0 critical · **8 high** · 12 medium · 5 low · 6 info · **31 findings total**.

Общее впечатление — bot infrastructure solid в core areas: i18n RU/EN parity perfect (89/89 keys, re-verified от Stage 6), `escHtml` для 3 key chars применяется к LLM-generated content (whyNow, aiExplanation, title), Ask Grok 6-point prompt идентичен bot ↔ dashboard (14.05 + 16.05 fix held up), photo 404 fallback graceful (video → photo → text), reason wizard FSM с 5-min timeout + /skip + per-key i18n localization, support bot promise-coalescing per chatId защищает от race на forum topic creation, plan-aware buttons + upsell toasts через `getPlanEntitlements` SoT, broadcast composer atomic INSERT-before-send + per-delivery row record + pinned tracking + edit/unpin/delete operations, decisions buffer написания во всех 4 точках flow (before enqueue / send success / send fail / queue full).

Слабые места — **8 high** с serious user-visible impact: `trend.url` НЕ escape'ится attribute → HTML structure injection через single quote in URL (BOT-001); НЕТ protocol whitelist → `javascript:` URLs возможны в `<a href>` (BOT-002, SEC-006 cross-confirmation); plain text > 4096 chars → silent TG 400 drop, alert не доставляется (BOT-003); **per-user loop crash isolation отсутствует** — `JSON.parse(user.disabled_sources)` throw'нул → ВСЯ remaining dispatch loop crashes (BOT-005, cascade failure); 429 от TG не honored — no retry-after, sends dropped (BOT-006); broadcast 403/blocked не записывается в `users.bot_blocked` → каждая broadcast повторно failures для same users (BOT-007); Ask Grok URL length unchecked → Cyrillic prompts at long titles могут exceed 8KB grok.com limit (BOT-008); НЕТ TG `language_code` auto-detect on `/start` → RU users default get EN welcome (BOT-004).

Medium набор — 8 hardcoded EN/RU inline strings (login flow, /analyze help, rate-limit toast, source locked messages — частично duplicated 2× в file), missing /help /stop /forecast commands, bot username caching no TTL + SPA render race, support bot full chat_id в topic header (PII exposure point), broadcast edit/delete beyond 48h silently fail.

**Top-3** для разбора в первую очередь:
1. **BOT-001 + BOT-002** combined: `trend.url` НЕ escape'ится в `<a href>` AND нет protocol whitelist — HTML attribute injection через quote in URL + `javascript:` через adversarial source. Single fix covers both.
2. **BOT-005** Per-user loop crash isolation — outer `for (user of activeUsers)` без try/catch. Один `user.disabled_sources` JSON.parse throw → cascade failure для всех remaining users. Это **silent systematic delivery failure** — ни decisions buffer не пишется, ни alert не идёт.
3. **BOT-003** Plain text > 4096 chars silent drop — TG 400 error caught generically, decision marked 'skipped'. Длинные `whyNow + aiExplanation + triggerText` (особенно с RU expanded translations) могут regular hit это. Alert не доставляется, юзер не знает, оператор видит skipped без 'truncation' гипотезы.

---

## Findings

### [BOT-001] `trend.url` НЕ escape'ится в `<a href="...">` attribute — severity: **high**

* **Where**: `src/notifications/formatter.js:145` (`msg += \`🔗 <a href="${trend.url}">${t.alertOpen}</a>\`;`); `escHtml` definition lines 242-245 (escape only `&`, `<`, `>`).
* **Surface**: formatter (all alerts)
* **What**: `escHtml(text)` экранирует только `&`/`<`/`>`. `"` и `'` НЕ экранируются. Когда `trend.url` (от Reddit / Twitter / TikTok / X Trends collectors — controlled но всё-таки external) содержит `"` в query params → HTML attribute breaks:
  ```html
  <a href="https://example.com?foo="bar"">Open link</a>
  ```
  → Telegram возвращает 400 parse error → alert не доставляется (caught generically, decision 'skipped', user никогда не узнает).
* **User-visible impact**: alerts с broken URLs silently не идут пользователям. На adversarial input — потенциальная HTML injection в TG message (TG не renders attribute JS, но если user copy-paste link в browser console — execute).
* **Repro**: trend с URL `https://x.com/?q="test"&id=123` → формирует `<a href="https://x.com/?q="test"&id=123">` → TG parse error.
* **Fix**: extend `escHtml` или add `escHtmlAttr(s)`:
  ```js
  function escHtmlAttr(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  // line 145:
  msg += `🔗 <a href="${escHtmlAttr(trend.url)}">${t.alertOpen}</a>`;
  ```

---

### [BOT-002] НЕТ protocol whitelist на `<a href>` — `javascript:` URLs возможны — severity: **high**

* **Where**: `src/notifications/formatter.js:145` (same callsite as BOT-001)
* **Surface**: formatter (all alerts)
* **What**: `trend.url` inject'ится в `<a href="...">` без проверки protocol. Если collector / manual analysis пропустит `javascript:` или `data:` URL (например через специально crafted user-submitted URL в /analyze) — bot отправит alert с активной JS-ссылкой. TG не renders JS at click time (browser intercepts), но clipboard copy + paste в DevTools console = execute. Также phishing vector через `data:text/html,<script>...`.
* **User-visible impact**: defense-in-depth gap. Не XSS в TG context, но cross-context vulnerability при user interaction.
* **Cross-audit**: SEC-006 уже flag'нул аналог в dashboard (`<a href={trend.url}>` без `safeHref`). Same root cause, same fix.
* **Fix**: protocol whitelist при render:
  ```js
  const safeUrl = /^https?:\/\//.test(trend.url) ? escHtmlAttr(trend.url) : '#';
  // skip <a> rendering if !safeUrl
  ```

---

### [BOT-003] Plain text > 4096 chars → silent TG 400 drop — severity: **high**

* **Where**: `src/notifications/formatter.js` (no length check), `src/notifications/telegram.js:1266-1269` (caption 1024 split-mode logic only)
* **Surface**: alert delivery
* **What**: caption mode (с photo/video/album) корректно проверяет `message.length <= CAPTION_MAX (1024)` → если превышает, отправляется без caption + follow-up text message. **Но plain text-only alert (no media)** НЕ имеет length check — отправляется как-есть к TG. TG limit 4096 chars text. Длинный `whyNow + aiExplanation + triggerText + engagement metrics + xAnalysis` (особенно RU expanded translations) может достичь это.
* **User-visible impact**: TG возвращает 400 parse error → caught at line 1401-1410 → logged + decision 'send_failed'. Alert НЕ доставляется юзеру. Оператор видит skipped в DecisionsPage без понятной reason.
* **Repro**: synthetic trend с whyNow=2000 chars + aiExplanation=2000 chars + trigger text+sources block → text-only mode (no photo) → > 4096.
* **Fix**: pre-send length check + graceful truncation (tag-safe):
  ```js
  function safeTruncate(html, maxLen) {
    if (html.length <= maxLen) return html;
    // truncate, then close any opened HTML tags
    // ... ~30 lines logic
  }
  // before sendMessage: message = safeTruncate(message, 4090);
  ```
  Или split into multiple messages (more complex).

---

### [BOT-004] НЕТ TG `language_code` auto-detect на `/start` — severity: **high**

* **Where**: `src/notifications/telegram.js:170-178` (`/start` handler), `src/db/database.js` (users.language column TEXT default 'en')
* **Surface**: command handler (/start)
* **What**: `getOrCreateUser(chatId, username)` создаёт user'а с `language = 'en'` (DB default). `msg.from?.language_code` (TG сам отдаёт код языка пользователя) **никогда не читается**. RU юзеры приходят на /start, видят English welcome message, должны вручную найти `/menu → Language → RU`. Onboarding broken для RU audience.
* **User-visible impact**: RU users получают EN welcome → confusion на key acquisition moment → bounce rate. Catalyst is RU-first product (per project context). Major UX regression.
* **Fix** (~5 строк в `/start` handler):
  ```js
  const tgLang = msg.from?.language_code?.startsWith('ru') ? 'ru' : 'en';
  const user = this.db.getOrCreateUser(chatId, msg.from?.username, { defaultLanguage: tgLang });
  // OR: if user just created → update lang from tgLang
  ```

---

### [BOT-005] Per-user dispatch loop crash isolation отсутствует — severity: **high**

* **Where**: `src/notifications/alert-dispatcher.js:176-447` (main dispatch loop)
* **Surface**: alert delivery
* **What**: outer `for (const user of activeUsers)` **НЕ обёрнут в try/catch**. Внутри loop'а:
  * Line 190 (~): `user.disabled_sources = JSON.parse(user.disabled_sources || '[]')` — если column corrupted (например manual SQL mistake, или migration row с invalid JSON) → `JSON.parse` throws → uncaught exception propagates up → entire `dispatchAlerts` call crashes → **все remaining users в этом batch не получают alerts**.
  * Send task (line 378-412) обёрнут в try/catch — exceptions inside isolated. Но top-level user iteration — нет.
* **User-visible impact**: **cascade systematic delivery failure**. One corrupted user.disabled_sources row → 50 users dropped silently per scan cycle. Decisions buffer не пишется (exception fired до recordAlertDecision). Логи показывают exception, но без context "this means N users dropped".
* **Repro**: вручную corrupt `users.disabled_sources` to `'not-json'` для test user → next scan cycle → JSON.parse throws → dispatch crashes.
* **Fix**: wrap user loop body в try/catch + log + continue:
  ```js
  for (const user of activeUsers) {
    try {
      // existing logic
    } catch (e) {
      logger.error(`User ${maskId(user.telegram_chat_id)} dispatch crashed: ${e.message}`);
      continue;
    }
  }
  ```

---

### [BOT-006] НЕТ 429 / retry-after honoring на TG rate-limit — severity: **high**

* **Where**: `src/notifications/telegram.js:1401-1410` (sendAlertToUser catch block), нигде else
* **Surface**: alert delivery, broadcast
* **What**: TG API на rate-limit возвращает HTTP 429 + header `Retry-After: N` (seconds). Catch блок проверяет `error.response?.statusCode === 403` (blocked) и спец-handle'ит, но 429 falls through to generic error log + decision 'send_failed'. Alert dropped, no requeue, no backoff.
* **User-visible impact**: peaks (massive broadcast / hot refresh + scan cycle race) могут пробить bot global cap (30 msg/sec) → wave of 429 → dropped alerts. Юзеры просто не получают сообщения. Mid-broadcast — partial delivery, не recoverable.
* **Fix**: detect 429 + sleep retry-after + retry once:
  ```js
  catch (error) {
    if (error.response?.statusCode === 429) {
      const retryAfter = (error.response?.body?.parameters?.retry_after ?? 5) * 1000;
      await sleep(retryAfter);
      return await this.bot.sendMessage(chatId, ...);  // retry once
    }
    if (error.response?.statusCode === 403) { /* existing */ }
    // ...
  }
  ```

---

### [BOT-007] Broadcast 403/blocked не записывается в `users.bot_blocked` — severity: **high**

* **Where**: `src/admin/server.js:741-777` (`_broadcast` send loop) — на send failure просто `failed++`, нет flag в DB
* **Surface**: broadcast
* **What**: alert dispatcher на 403 правильно ставит `users.status = 'suspended'` (line 1402-1405 telegram.js) → future scan'ы скипают. **Broadcast loop НЕ делает то же самое** — 403 caught generically (line 743), `failed++`, переходит к next user. На следующий broadcast — те же blocked users снова fail. Лимиты впустую расходуются, лог spam.
* **User-visible impact**: blocked users not flagged → каждый broadcast hammer'ит same dead chats → TG может ratelimit'нуть bot (cascade с BOT-006). Также `broadcasts.failed_count` накапливается, метрики искажены.
* **Fix**: в broadcast catch block check 403 → set `users.status = 'suspended'` (или новый column `bot_blocked = 1`):
  ```js
  catch (e) {
    if (e.response?.statusCode === 403) {
      this.db.db.prepare(`UPDATE users SET status = 'suspended' WHERE id = ?`).run(user.id);
    }
    failed++;
  }
  ```

---

### [BOT-008] Ask Grok URL length unchecked (~8KB grok.com limit) — severity: **high**

* **Where**: `src/notifications/telegram.js:32-78` (`buildGrokUrl`), `src/dashboard/server.js:10694-10729` (dashboard equivalent — verified identical)
* **Surface**: inline keyboard (Ask Grok button)
* **What**: 6-point prompt + trend title + URL → `encodeURIComponent` → `https://grok.com/?q=<encoded>`. Кириллица: 3 bytes/char encoded. Long titles (~150 chars EN/RU) + 6-point prompt with «НЕ ПРИДУМЫВАЙ»/«strictly point-by-point» blocks → encoded URL может достичь 8.5-9KB. grok.com limit ~8KB GET URL. Browser truncates → Grok получает broken prompt (cut mid-sentence) → quality degrade или error response.
* **User-visible impact**: feature silently broken для long-title trends in RU. User clicks «🧠 Ask Grok» → Grok response — junk / error. User'у непонятно почему.
* **Fix**: pre-encode length check + fall back to short prompt:
  ```js
  function buildGrokUrl(trend, lang = 'en') {
    const fullPrompt = buildFullPrompt(trend, lang);
    let url = `https://grok.com/?q=${encodeURIComponent(fullPrompt)}`;
    if (url.length > 7500) {  // safe margin under 8KB
      const shortPrompt = buildShortPrompt(trend, lang);  // 1-2 points instead of 6
      url = `https://grok.com/?q=${encodeURIComponent(shortPrompt)}`;
    }
    return url;
  }
  ```
  Same fix needed dashboard side (sync invariant).

---

### [BOT-009] notifications anti-dupe race (PIPE-006 / DB-007 confirm) — severity: **medium**

* **Where**: `src/notifications/alert-dispatcher.js:331` (SELECT pre-check), `:382` (INSERT after send success), `src/db/schema.sql:74-83` (no UNIQUE)
* **Surface**: alert delivery
* **What**: cross-confirm PIPE-006 + DB-007 в admin UX angle. SELECT pre-check → INSERT after send. Two concurrent dispatchers (scan + hot-refresh) both pass SELECT (no row yet), both send, both INSERT → duplicate row → юзер получает alert 2 раза.
* **User-visible impact**: duplicate alerts при race window. Не frequent (race window 100ms-2s typical), но user-visible quality issue.
* **Fix**: migration → `CREATE UNIQUE INDEX idx_notifications_dedup ON notifications(trend_id, user_id, channel)`. INSERT обернуть в `INSERT OR IGNORE`. Common fix с PIPE-006 + DB-007 — backlog #2.

---

### [BOT-010] 8 hardcoded EN/RU strings inline (login, /analyze help, toasts) — severity: **medium**

* **Where**: `src/notifications/telegram.js`:
  * Lines 186-188, 193-195, 200-203 — login deep-link flow (auth_<sessionId>)
  * Lines 256-270 — `/analyze` help text (14-line block ternary)
  * Line 277 — "No URL found in message"
  * Line 412 — "⏳ Slow down!" rate-limit toast
  * Lines 441-443, 466-468 — source-locked messages (**duplicated 2×** in same file)
  * Line 565 — "Plan is unavailable"
  * Lines 605, 619, 627, 636, 654 — X Analysis / Trigger locked fallbacks (`t.xAnalysisLocked || 'X Analysis is...'`)
  * Line 758 — generic "Error"
* **Surface**: commands, callbacks
* **What**: 8+ locations hardcoded `user.language === 'ru' ? 'RU text' : 'EN text'` ternary, не через `t()` helper. RU/EN parity для t() keys — perfect, но эти inline strings — отдельный mini-i18n. Easy to break — единственный source of truth — этот ternary, не shared maps.
* **User-visible impact**: inconsistency between standard alerts (через t()) и edge messages (hardcoded). Future RU/EN parity sweep пропустит эти 8 places.
* **Fix**: ввести keys в `src/i18n/{en,ru}.js`: `auth.linkInvalid`, `auth.linkExpired`, `auth.codeAlreadyVerified`, `analyze.help` (multi-line), `analyze.noUrlFound`, `rate.slowDown`, `source.lockedFree`, `plan.unavailable`, `analysis.lockedFallback`, `error.generic`. Replace inline ternary через `t(...)`. ~20 строк.

---

### [BOT-011] НЕТ `/help` command — severity: **medium**

* **Where**: `src/notifications/telegram.js` — no `bot.onText(/^\/help/)` handler
* **Surface**: commands
* **What**: typical Telegram bot имеет `/help`. Catalyst — нет. Юзер должен догадаться: `/menu`, `/analyze`, `/dashboard`, `/top`, плюс `/start auth_xxx` (специфичная forma). Discovery broken.
* **Fix**: add handler — list commands с краткими описаниями + dashboard link. ~15 строк + i18n keys.

---

### [BOT-012] НЕТ `/stop` / `/pause` / `/unsubscribe` command — severity: **medium**

* **Where**: telegram.js — no command, only `/menu → toggle_pause` (3 clicks)
* **Surface**: commands
* **What**: TG bot convention — `/stop` или `/unsubscribe` для opt-out alerts. У Catalyst — закопано в /menu → Start/Stop button. User'у который хочет паузу — 3 clicks vs 1 command.
* **Fix**: alias `/stop`, `/pause`, `/unsubscribe` → same handler as `toggle_pause` callback. ~10 строк.

---

### [BOT-013] НЕТ `/forecast` / `/catalyst` command — severity: **medium**

* **Where**: telegram.js — `trigger:` callback only (inline button on alert message)
* **Surface**: commands
* **What**: power users могут хотеть запросить Catalyst forecast напрямую (передавая trend URL или ID), не only через inline button on existing alert. Currently impossible.
* **Fix**: `/forecast <trend_url|trend_id>` → resolve trend → execute `_runCatalystForecast(trend)`. Plan-gated same as catalyst entitlement. ~25 строк.

---

### [BOT-014] Bot username caching no TTL, no refresh trigger — severity: **medium**

* **Where**: `src/notifications/telegram.js:2359-2372` (`getBotUsername` → `_cachedBotUsername`)
* **Surface**: bot infrastructure
* **What**: `_cachedBotUsername` set'ится на первом `bot.getMe()` call, **никогда не refresh'ится**. Если username changed via @BotFather mid-runtime → stale forever (до process restart). Также: SPA template inject'ит `BOT_USERNAME` константу при render — если render до getMe() complete → `BOT_USERNAME = ''` → broken X-link / paper-plane button (BOT-015).
* **User-visible impact**: edge case (username change rare), но silent + persistent. Restart fixes.
* **Fix**: TTL 1h refresh + force-refresh on boot before SPA render available:
  ```js
  async getBotUsername(forceRefresh = false) {
    if (!forceRefresh && this._cachedBotUsername && Date.now() < this._cachedBotUsernameExpiresAt) return this._cachedBotUsername;
    const me = await this.bot.getMe();
    this._cachedBotUsername = me.username;
    this._cachedBotUsernameExpiresAt = Date.now() + 60*60*1000;
    return this._cachedBotUsername;
  }
  // index.js boot: await telegram.getBotUsername(); // pre-populate before HTTP servers up
  ```

---

### [BOT-015] SPA template race с bot username — empty string при early render — severity: **medium**

* **Where**: dashboard/server.js SPA template + telegram.js getBotUsername (init order)
* **Surface**: dashboard integration
* **What**: SPA template inject'ит `BOT_USERNAME` константу. Если `bot.getMe()` ещё не resolved при первом dashboard render — константа = `''`. Юзер получает broken paper-plane button (link to `t.me/`).
* **User-visible impact**: первые секунды после deploy / restart — broken TG link на dashboard. Самораздаёт после ~1 second when getMe() resolves, но SPA уже rendered.
* **Fix**: same как BOT-014 — pre-populate `_cachedBotUsername` на boot **до** запуска HTTP servers (`await this.getBotUsername()` в `index.js` init sequence).

---

### [BOT-016] Edit/delete broadcast beyond 48h silently fail — severity: **medium**

* **Where**: `src/admin/server.js:782-832` (broadcast manage), `src/notifications/telegram.js` (bot.editMessageText / deleteMessage)
* **Surface**: broadcast manage
* **What**: TG API limit — `deleteMessage` only within 48h of send. `editMessageText` only within 48h. After that — TG returns 400, catch increments failed (line 818), no graceful UX feedback. Admin clicks Edit, гадает «почему ничего не происходит».
* **Fix**: catch + return reason to admin: «Broadcast too old (>48h), can't edit». ~10 строк + i18n.

---

### [BOT-017] Broadcast atomicity on crash / tab close — severity: **medium**

* **Where**: `src/admin/server.js:729-778` (`_broadcast`)
* **Surface**: broadcast
* **What**: broadcast INSERT в `broadcasts` table happen ДО send loop. Send loop async server-side — admin может закрыть tab, server продолжает. Если server крашнется mid-send → broadcasts row exists, `broadcast_deliveries` partial. Нет recovery / continue logic. Admin не видит «N from M sent, broadcast incomplete».
* **Fix**: `broadcasts.status` column (`pending` → `sending` → `done` | `crashed`). On boot — find `sending` rows older than threshold, mark `crashed`. UI shows status. ~30 строк + migration.

---

### [BOT-018] Support bot — full chat_id в topic header HTML — severity: **medium**

* **Where**: `src/support/bot.js:184-185` (mask in logs), line 216 (FULL chat_id в HTML `<code>` topic header)
* **Surface**: support bot
* **What**: support bot logs mask chat_id как `***XXXX`, **но** topic header в admin supergroup отображает full chat_id внутри `<code>` block. Operator screenshot / screen-share → leaks user chat_ids. Cross-confirmation с ADM-016 (admin UI shows full chat_id) — same pattern, broader exposure.
* **Fix**: mask chat_id в topic header same as logs. Operator может сделать lookup через support_threads table если really нужен full ID. ~5 строк.

---

### [BOT-019] Hardcoded "Cancelled." fallback в reason wizard /skip — severity: **low**

* **Where**: `src/notifications/telegram.js:325` (`tr.feedbackReasonSkipped || 'Cancelled.'`)
* **Surface**: wizard
* **What**: defensive fallback hardcoded EN. RU/EN parity perfect → key всегда existsm, но fallback drift — если key пропадёт в одном языке, RU user видит EN. Minor.
* **Fix**: убрать fallback OR использовать tr.errorGeneric.

---

### [BOT-020] НЕТ admin crash alert via TG — severity: **low**

* **Where**: telegram.js logger.error callsites (lines 757, 1003, 1225, 1939)
* **Surface**: operational
* **What**: критические bot errors (token revoked, ban, mass-failure) logged via logger only — admin узнаёт когда смотрит docker logs. Нет push alert «bot down» в admin TG чат.
* **Fix**: на certain error patterns (403 token, 5xx persistent) → send message to admin chat_ids (plan='admin'). ~20 строк. Lower priority.

---

### [BOT-021] 50ms per-user delay = 20 msg/sec — нет global cap counter — severity: **low**

* **Where**: `src/admin/server.js:775` (broadcast 50ms delay)
* **Surface**: broadcast
* **What**: 50ms = 20 msg/sec, ниже TG global 30 msg/sec — comfortable margin. **Но** при concurrent broadcast + alert dispatch + hot refresh - могут конкурировать за same 30 msg/sec slot. Никакой shared counter / token bucket. Может pile up 429 (BOT-006).
* **Fix**: token bucket shared между alert dispatch / broadcast / support / forecast paths. Сложнее, отложить до BOT-006 fix.

---

### [BOT-022] Login deep-link RU/EN ternary не через t() — severity: **low**

* **Where**: telegram.js:186-188, 193-195, 200-203 (login flow)
* **Surface**: /start auth
* **What**: 3 точки `user.language === 'ru' ? 'RU' : 'EN'`. BOT-010 supersedes — same root cause, subset of 8 locations.

---

### [BOT-023] /analyze help text 14-line hardcoded ternary — severity: **low**

* **Where**: telegram.js:256-270
* **Surface**: /analyze command
* **What**: large 14-line block of RU+EN inline. BOT-010 subset.

---

### [BOT-024] НЕТ Save / Hide inline buttons на bot alerts — feature parity gap — severity: **low**

* **Where**: telegram.js `attachAlertButtons` (line 1428) — only X Analysis, Trigger, Ask Grok, Feedback (👍/👎)
* **Surface**: inline keyboard
* **What**: dashboard alerts имеют ⭐ Save + ✕ Hide buttons. Bot alerts — нет. Pro/Admin user'ы должны на dashboard переходить чтобы save trend. Mobile-first audience может предпочитать всё в TG.
* **Fix**: add `save:<trend_id>` + `hide:<trend_id>` callbacks (plan-aware — show 🔒 для free/test, full для pro/admin). ~40 строк + DB calls (already exist). Future polish.

---

### [BOT-025] Generic "Error" hardcoded (line 758) — severity: **low**

* **Where**: telegram.js:758
* **Surface**: callback handler
* **What**: generic catch block для unknown callback action shows hardcoded `'Error'` toast. Non-localized.
* **Fix**: `t.errorGeneric()` exists in i18n. ~1 line change.

---

### [BOT-026] Decisions buffer edge case — TG timeout after send — severity: **info**

* **Where**: telegram.js sendAlertToUser try/catch
* **Surface**: observability
* **What**: rare edge case — bot sends, message accepted by TG, но response timeout / connection dropped before bot gets confirmation → catch block → decision marked 'send_failed', но message actually delivered. DecisionsPage shows orphaned 'skipped' for what was actually sent. Cross-overlap с ADM-002 (decisions in-memory не помогает здесь — это intrinsic to timeout race).
* **Fix**: probably не worth fixing — low frequency, acceptable observability noise.

---

### [BOT-027] Scheduled broadcasts not supported — severity: **info**

* **Where**: admin/server.js broadcast composer
* **Surface**: broadcast
* **What**: только immediate send. No "send at 09:00 UTC" / cron'ed broadcasts. Future feature.

---

### [BOT-028] Targeted broadcasts by chat_id list — severity: **info**

* **Where**: admin/server.js
* **Surface**: broadcast
* **What**: только plan filter. Не CSV chat_id list для testing на конкретных user'ах. Future feature.

---

### [BOT-029] No emoji/zero-width strip in LLM-generated content — severity: **info**

* **Where**: formatter.js whyNow / aiExplanation passthrough
* **Surface**: formatter
* **What**: LLM (Grok/OpenAI/Gemini) может вернуть zero-width chars / RTL overrides → читаемость alert страдает. Aesthetic risk, не security.
* **Fix**: strip pass на adversarial-looking chars. Не приоритет.

---

### [BOT-030] Polling vs webhook не явно verified — severity: **info**

* **Where**: telegram.js bot init
* **Surface**: bot infrastructure
* **What**: ⚠ assumes polling (default for `node-telegram-bot-api`). Если polling — okay (simple, no public webhook URL). Если webhook — нужен DLQ on failed deliveries. Стоит подтвердить вручную в коде.

---

### [BOT-031] Photo URL → direct Twitter/Reddit CDN (no proxy) — severity: **info**

* **Where**: telegram.js sendPhoto callsites
* **Surface**: photo attachment
* **What**: TG fetches photo от external CDN. Cross-overlap с UX-028 (dashboard images also direct). Privacy/bandwidth angle. Cross-CDN dependence — if Twitter blocks TG IPs → all alerts без photos.
* **Fix**: same pattern as video/avatar proxy в Catalyst. Future polish.

---

## Verified safe

То что прошло — не пересматривать на следующих этапах:

1. **`escHtml`** для 3 key HTML chars (`&`, `<`, `>`) applied to user-controlled content (title, whyNow, aiExplanation, sources, category, sentiment, lifespan, formattedTraffic).
2. **HTML-only mode** — нет MarkdownV2 fallback (avoiding two escape rule confusion).
3. **i18n RU/EN parity 100%** для bot t() keys (72+ unique keys, exact same structure both files) — re-confirm от Stage 6.
4. **Ask Grok 6-point prompt** identical bot ↔ dashboard text (RU + EN variants) — 14.05 + 16.05 fix held. URL length unchecked отдельно (BOT-008).
5. **encodeURIComponent** applied properly для Cyrillic in Ask Grok URL.
6. **`fetchFile(fileId)`** token contained, URL constructed locally, never logged. Deprecated `getFileUrl()` warned. SEC re-confirm.
7. **Plan-aware buttons** — locked icons + upsell toasts через shared `getPlanEntitlements()` SoT.
8. **Photo 404 fallback** — video → photo → text-only graceful degrade.
9. **403 (blocked) → `users.status = 'suspended'`** в alert dispatcher (НЕ в broadcast — BOT-007).
10. **Reason wizard FSM** — 5-min timeout (lazy), /skip cancellation, per-key localized prompts (feedbackReasonPrompt / Saved / Skipped / NoVote / TooLong все в EN+RU).
11. **/menu plan-aware status badges** — live source count, threshold value, alert types count, days remaining, paused dot.
12. **Bare URL auto-detect silent-ignore for free** — confirmed line 304 (`if (manualAnalyze === 0) return;`).
13. **/analyze cap check после cache lookup** — `peekManualAnalysisCache` skips rate-limit on cache hit (proper sequence).
14. **Catalyst forecast claim race** — `db.claimTriggerSearch(trendId, chatId)` atomic DB-level lock (line 1866).
15. **`_renderTriggerMessage`** — handles missing/empty sections gracefully (drivers/risks/sources/window/phase all optional).
16. **Support bot graceful disable** — missing SUPPORT_BOT_TOKEN / SUPPORT_GROUP_ID → enabled=false, main flow продолжает.
17. **Support bot promise-coalescing** (`_creatingTopic` Map) — concurrent first-message from same user → single topic created.
18. **Support bot copyMessage** without 'Forwarded from' header — clean relay.
19. **Support bot reverse path** — admin message_thread_id → support_threads lookup → copyMessage user.
20. **Lang resolution** — `_resolveLang(chatId, fromUser)` reads users.language, fallback to from.language_code, fallback to 'en' (matches SESSION_CONTEXT spec).
21. **Lang sync dashboard → bot** — `users.language` updated в DB на каждом set_lang callback, bot reads fresh on next message (no cache invalidation needed).
22. **Broadcast pinned tracking** — `users.pinned_broadcast_message_id` unpin previous + pin new + update pointer.
23. **Broadcast per-delivery row** — `broadcast_deliveries(broadcast_id, user_id, chat_id, message_id, status)` записывается per success.
24. **Broadcast active status filter** — paused users НЕ получают (line 730-738 `WHERE u.status = 'active'`).
25. **Callback data format short** — `<action>:<param>` под 64 bytes safe.
26. **PII masking in logs** — `maskId(chat_id)` consistently used (`***XXXX`).
27. **`attachXButton` → `attachAlertButtons`** alias (backward-compat).
28. **Decisions buffer write at all 4 points** — gate fail (351/363), send success (385), send fail (405/410), queue full (428).
29. **Per-user alert count incremented only on actual send** (line 383 — `db.incrementAlertCount` only if sent===true).
30. **30s anti-dupe cooldown** для /analyze + bare URL (rolling 24h window check).

---

## Spec drift (накопительно — 18 items)

К существующим 16 items добавляю 2 новых bot-уровень:

- **SD-1**..**SD-16** — см. предыдущие этапы.
- **SD-17** **`getBotUsername` caching** — SESSION_CONTEXT § «Dashboard layout» декларирует «cached в this._botUsername, инжектится в SPA template как BOT_USERNAME константа». В реальности `_cachedBotUsername` (другое имя поля) **без TTL**, **без refresh trigger**, **без pre-populate на boot** → SPA template race + stale username forever если @BotFather change. См. BOT-014 + BOT-015.
- **SD-18** **Bot commands inventory** — SESSION_CONTEXT mentions «/menu, /analyze, /forecast, /start» в casual context, но реально `/forecast` НЕ command (только `trigger:` callback), `/help` `/stop` `/pause` `/unsubscribe` НЕ существуют. Документация overstate'ит. См. BOT-011 + BOT-012 + BOT-013.

Финальный sync-pass по SESSION_CONTEXT планируется после всех 12 этапов.

---

## Cross-audit overlap

«One-fix-many-wins» backlog (расширен до **15 targets** с bot-уровень):

1. **Backup integrity rewrite** — 5 items.
2. **`notifications` migration** (UNIQUE + retention) — PIPE-006 + COST-016 + DB-007 + DB-008 + **BOT-009** = 5 items (одна migration covers all anti-dupe + retention concerns).
3. **Schema integrity sweep** — 5 items.
4. **`db.transaction` wrap save loops** — 3 items.
5. **`sqliteCutoff` consolidation** — 4 items.
6. **Housekeeping schedule + admin UI maintenance** — 6 items.
7. **`/api/scan` admin gate + immediate timestamp** — 4 items.
8. **DB-backed counter table `feature_usage_log`** — 2 items.
9. **Hover preview plan-check + per-user rate-limit** — 2 items.
10. **Proactive Google healthcheck + counter reset** — 3 items.
11. **Focus trap implementation** — 5 modal callsites.
12. **Admin observability persistence migration** (`alert_decisions` + `admin_audit_log`) — 4 items.
13. **Standardized error banner / state** — ADM-001 + UX-001 = 4 items.
14. **(NEW) URL safety bundle** — `safeHref()` + protocol whitelist + attribute escape → **SEC-006 + UX-housing + BOT-001 + BOT-002** = 4 items одним sweep'ом (single helper apply'ed в dashboard `<a>` callsites + formatter line 145).
15. **(NEW) Bot resilience bundle** — per-user dispatch try/catch (BOT-005) + 429 retry-after (BOT-006) + broadcast 403→bot_blocked (BOT-007) + token bucket shared cap (BOT-021) → **4 finding'ов one «bot infrastructure hardening» PR** одним sweep'ом.

Bot-specific overlap с предыдущими аудитами:
- **BOT-009 (notifications race)** = PIPE-006 + DB-007 — single migration covers (backlog #2).
- **BOT-001 + BOT-002 (URL escape + protocol whitelist)** ↔ SEC-006 (dashboard `<a href>`) — same helper для both, single sweep (backlog #14).
- **BOT-018 (support bot full chat_id в topic)** ↔ ADM-016 (admin UI full chat_id) — common «PII masking sweep» pattern, add `maskId()` callsites.
- **BOT-003 (length > 4096 silent drop)** ↔ ADM-001 + UX-001 — общая «silent failure visibility» pattern. ErrorBanner / log+telemetry → backlog #13 extension.
- **BOT-004 (no TG language_code on /start)** — new, not overlap.
- **BOT-008 (Ask Grok URL length)** ↔ dashboard equivalent (same root cause, sync invariant).
- **BOT-014 + BOT-015 (bot username caching)** = SD-17 confirmation.

Если приоритезировать **URL safety bundle (#14) + bot resilience bundle (#15) + notifications migration (#2) + admin observability migration (#12)** — закроется ~17 finding'ов из 8 этапов одной серией PR.

---

## Bot delivery posture verdict

**~70%**.

Что работает хорошо: HTML escape для key chars (~95% paths), photo fallback (video→photo→text), 403 → suspended в alert path, broadcast pinned tracking + per-delivery records, support bot promise coalescing + graceful disable, i18n RU/EN structural parity, plan-aware buttons + upsell, Ask Grok prompt sync bot ↔ dashboard, claim race для Catalyst forecast.

Что брокен: URL attribute escape gap (BOT-001+002), per-user dispatch crash isolation (BOT-005, cascade failure mode), 429 не honored (BOT-006), broadcast не flag'ит blocked (BOT-007), длинные plain text drop'аются silently (BOT-003), RU users получают EN welcome (BOT-004), Ask Grok URL может exceed 8KB grok limit для Cyrillic long titles (BOT-008), bot username caching без TTL/refresh + SPA template race (BOT-014/015), 8 hardcoded EN/RU inline strings (BOT-010).

Sustainable для текущей кадансы (~5-50 users, low frequency broadcasts). При scale (200+ users) или peak load (massive broadcast + concurrent scan) — BOT-005 + BOT-006 + BOT-007 cascade fails станут frequent. Перед scaling — обязательно «bot resilience bundle» fix.

---

## Out of scope / Followups

- **Bot auth** — Stage 1 verified safe (token contained, fetchFile sandboxed, no token leak in URLs, deprecated getFileUrl warned).
- **Pipeline correctness** — Stage 2 (PIPE-006 + PIPE-001 cross-checked).
- **Billing entitlements** — Stage 3 (plan-aware buttons via shared `getPlanEntitlements()`).
- **Cost** — Stage 4 (per-chat 60s cooldown verified, broadcast throttling cross-checked).
- **DB schema** — Stage 5 (notifications UNIQUE + retention overlap).
- **Dashboard UX** — Stage 6.
- **Admin panel** — Stage 7 (BotPage 3 sub-tabs, broadcast composer cross-checked).
- **Production nginx / backup** — Stage 9.
- **Cat mascot** — Stage 10.
- **Code quality (dead code, SPA-trap для server.js)** — Stage 11.
- **Documentation polish** — Stage 12.

**Open assumptions** (`⚠ assumes` / `⚠ requires runtime verification`):
- BOT-030 polling vs webhook — assume polling based on default `node-telegram-bot-api` behavior, not explicitly grep-verified.
- BOT-031 photo direct CDN — verified в коде, но cross-CDN block rate (Twitter blocking TG IPs) — теоретический risk не measurable без data.
- BOT-005 cascade failure — теоретическая на code-read, не runtime-reproduced (`JSON.parse` corruption требует manual SQL).
- BOT-008 Cyrillic URL exceed — оценка размера, не tested против real grok.com behavior.

**Followup observability**: один haiku-agent на «inline keyboards + Ask Grok» занял ~17 минут (1006s) — это outlier vs других 60-100s агентов. Sonnet был бы быстрее на этой задаче (cross-file Ask Grok compare bot ↔ dashboard). Lesson: для cross-file comparison tasks — prefer sonnet.

`escHtml` 3-char escape gap — низковисящий fruit, но widely-applied (~5-10 callsites через formatter). Extending до 5-char escape + protocol whitelist (BOT-001+002) — 1-day refactor, closes 2 high finding'а.
