# Bundle #3 — URL Safety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Закрыть 4 finding'а URL-handling (BOT-001/002, SEC-006, BILL-001): создать `src/utils/url-safety.js` с 3 helper'ами и применить в 5 callsites (1 в TG bot formatter, 2 в dashboard JSX, 2 в plan-gated endpoints).

**Architecture:** Один helper-модуль `src/utils/url-safety.js` экспортит `escHtmlAttr` / `safeUrl` / `safeHref`. Server-side код импортит обычным ESM. Dashboard SPA не может import в template literal — дублируем те же 3 функции inline в `_buildSPA` (established pattern, как `LIFESPAN_VALUES` injection).

**Tech Stack:** Node.js ESM, inline React SPA в `src/dashboard/server.js` (~13K lines), `getPlanEntitlements` helper из `src/billing/entitlements.js`. SPA validator `scripts/check-dashboard-spa.cjs` через `npm run check:spa` (Bundle #16 gate). Без TDD — нет existing test infra в проекте.

---

## Spec reference

Spec: `docs/superpowers/specs/2026-06-07-url-safety-design.md`

## Files affected

| File | Action | Why |
|---|---|---|
| `src/utils/url-safety.js` | **create** | 3 exports, ~35 LOC |
| `src/notifications/formatter.js` | modify | TG bot href escape + protocol whitelist (BOT-001 + BOT-002) |
| `src/dashboard/server.js` | modify | Inline SPA helpers + 2 JSX href safeHref + 2 endpoint plan gates (SEC-006 + BILL-001) |
| `ai-context/SESSION_CONTEXT.md` | modify | +1 bullet в Production posture |
| `ai-context/WORKLOG.md` | modify | Bundle #3 entry |

**NOT touched**: `src/admin/server.js` (admin trusted), `src/billing/entitlements.js` (используем существующий helper), миграции БД.

## Critical project gotcha

`src/dashboard/server.js` это inline React SPA в одном template literal. Любой backtick в комментарии, `\n` в string literal или двойной escape в `new RegExp('...')` ломает SPA → чёрный экран. **После КАЖДОГО edit'a этого файла обязательно**: `npm run check:spa` (запускает `check-dashboard-spa.cjs` + `check-admin-spa.cjs` через vm.Script() — exit 0 если SPA syntactically valid).

## Commits

Subagents **не делают commits**. Только file edits + SPA validation runs. Оператор сам коммитит по завершению всех task'ов одной atomic commit'ой (или нескольких — на его усмотрение).

---

## Task 1: Создать `src/utils/url-safety.js`

**Files:**
- Create: `F:\.VibeCoding\Projects\Antigravity\Narrative Parser\src\utils\url-safety.js`

- [ ] **Step 1: Verify directory exists**

Run: `ls "F:\.VibeCoding\Projects\Antigravity\Narrative Parser\src\utils\"`
Expected: directory exists (other utils live there)

- [ ] **Step 2: Create the file with exact content**

Use Write tool. File: `src/utils/url-safety.js`

```javascript
// URL safety helpers — Bundle #3 (2026-06-07)
//
// Server-side use: import { escHtmlAttr, safeUrl, safeHref } from '../utils/url-safety.js'
//
// Client-side dashboard SPA (src/dashboard/server.js inline template literal):
// the same 3 functions are duplicated inline in `_buildSPA()` because the SPA
// runs in browser and cannot ESM-import. Keep duplicates in sync (current
// versions match this file; quarterly drill can diff them if drift is suspected).

/**
 * Escape a value safe for use inside a double-quoted HTML attribute.
 * Escapes 5 chars: &, ", ', <, >. Coerces non-strings.
 *
 * Use whenever an untrusted string is interpolated into <tag attr="VALUE">.
 *
 * @param {*} s - any value (null/undefined → empty string)
 * @returns {string}
 */
export function escHtmlAttr(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Validate a URL has the http(s) protocol. Returns the original URL string if
 * valid, or null if missing / unparseable / not http(s).
 *
 * Explicitly rejects: javascript:, data:, file:, mailto:, vbscript:, blob:,
 * about:, and any other scheme. Empty string and null/undefined → null.
 *
 * @param {*} url - any value
 * @returns {string|null}
 */
export function safeUrl(url) {
  if (!url) return null;
  try {
    const u = new URL(String(url));
    return /^https?:$/.test(u.protocol) ? String(url) : null;
  } catch {
    return null;
  }
}

/**
 * Combined: validate protocol AND escape for HTML attribute.
 * Returns escaped URL string if valid http(s), or the literal '#' fallback.
 *
 * Use as a drop-in for any untrusted URL going into <a href="...">.
 *
 * @param {*} url - any value
 * @returns {string} escaped safe URL, or '#' fallback
 */
export function safeHref(url) {
  const safe = safeUrl(url);
  return safe ? escHtmlAttr(safe) : '#';
}
```

- [ ] **Step 3: Sanity-check exports via Node REPL**

Run: `node -e "import('./src/utils/url-safety.js').then(m => { console.log(m.safeUrl('javascript:alert(1)'), m.safeUrl('https://example.com'), m.safeHref('javascript:void(0)'), m.escHtmlAttr('\"><script>')); })"`

Expected output (4 values, separated by spaces):
```
null https://example.com # &quot;&gt;&lt;script&gt;
```

If any value is wrong → bug in helper, fix before proceeding.

- [ ] **Step 4: Task complete** — no commit; advance to Task 2.

---

## Task 2: Применить `safeUrl` / `safeHref` в `src/notifications/formatter.js` (BOT-001 + BOT-002)

**Files:**
- Modify: `F:\.VibeCoding\Projects\Antigravity\Narrative Parser\src\notifications\formatter.js`

**Current state (lines 1-6 imports, lines 143-146 the bug):**

```javascript
// Lines 1-6 (top of file):
/**
 * Alert formatter — creates localized messages for Telegram (HTML)
 */
import { getTranslations } from '../i18n/index.js';
import { normalizeLifespan } from '../analysis/lifespan.js';
import { collectSubjectNames, buildSubjectMatchRegex } from '../analysis/subject-names.js';

// Lines 143-146 (the bug):
  if (trend.url) {
    msg += DIV + '\n';
    msg += `🔗 <a href="${trend.url}">${t.alertOpen}</a>`;
  }
```

`trend.url` is interpolated raw — if URL contains `"` Telegram returns 400 (alert silently dropped); if URL is `javascript:...` no Telegram impact but copy-paste danger exists.

- [ ] **Step 1: Add import to top of file**

Use Edit tool on `src/notifications/formatter.js`.

Replace:
```javascript
import { getTranslations } from '../i18n/index.js';
import { normalizeLifespan } from '../analysis/lifespan.js';
import { collectSubjectNames, buildSubjectMatchRegex } from '../analysis/subject-names.js';
```

With:
```javascript
import { getTranslations } from '../i18n/index.js';
import { normalizeLifespan } from '../analysis/lifespan.js';
import { collectSubjectNames, buildSubjectMatchRegex } from '../analysis/subject-names.js';
import { safeUrl, safeHref } from '../utils/url-safety.js';
```

- [ ] **Step 2: Replace the unsafe href block**

Use Edit tool on `src/notifications/formatter.js`.

Replace (exact lines 143-146):
```javascript
  if (trend.url) {
    msg += DIV + '\n';
    msg += `🔗 <a href="${trend.url}">${t.alertOpen}</a>`;
  }
```

With:
```javascript
  // BOT-001 + BOT-002 (Bundle #3): validate protocol AND HTML-attr-escape the URL.
  // If URL is invalid (not http(s) or unparseable) — skip the link entirely.
  // Telegram parse_mode=HTML returns 400 on bad attribute escaping → alert lost;
  // skipping the link is better UX than risking the whole alert being dropped.
  if (trend.url && safeUrl(trend.url)) {
    msg += DIV + '\n';
    msg += `🔗 <a href="${safeHref(trend.url)}">${t.alertOpen}</a>`;
  }
```

- [ ] **Step 3: Verify no other raw `trend.url` interpolation in this file**

Run via Grep tool:
- pattern: `href="\$\{trend\.url\}"`
- path: `src/notifications/formatter.js`
- output_mode: content
- -n: true

Expected: **0 matches** (the only one we just rewrote).

If matches > 0 → there is another site to fix in same file; apply same pattern.

- [ ] **Step 4: Module loads cleanly (no syntax errors from new import)**

Run: `node -e "import('./src/notifications/formatter.js').then(m => console.log('OK:', Object.keys(m).slice(0,3).join(',')))"`

Expected: `OK: formatTelegramAlert,formatTwitterResult,...` (no SyntaxError / no MODULE_NOT_FOUND).

If MODULE_NOT_FOUND for `'../utils/url-safety.js'` → Task 1 file missing or path wrong; investigate.

- [ ] **Step 5: Task complete** — no commit; advance to Task 3.

---

## Task 3: Добавить inline `safeHref` / `safeUrl` / `escHtmlAttr` в SPA template literal

**Files:**
- Modify: `F:\.VibeCoding\Projects\Antigravity\Narrative Parser\src\dashboard\server.js` (around line 7084)

**Context:** Dashboard SPA runs in browser inside `<script>` block embedded in the HTML template literal returned by `_buildSPA()` (line 2623). Server-injected constants (`LIFESPAN_VALUES`, `LOGO_VERSION`, `BOT_USERNAME`) live around lines 7073-7084. We add the URL safety helpers right after these constants, BEFORE the auth-token block (line 7086).

**Current state (lines 7080-7090, target insertion point shown):**

```javascript
const LOGO_VERSION = ${JSON.stringify(this._logoVersion)};
// Bot username injected at HTML render time. Empty string → fallback rendering
// in nav (t.me/ root). Used for the Telegram-bot nav link next to the X icon.
const BOT_USERNAME = ${JSON.stringify(this._botUsername || '')};

// ── Auth token ────────────────────────────────────────────────────────────
// Login is Telegram-bot-only. The bot issues a 6-digit code bound to a session;
// verifying the code returns a 64-hex bearer token that is attached to every
// /api/* request. On 401 we clear the token and show the login screen.
const AUTH_TOKEN_KEY = 'ts_auth_token';
```

- [ ] **Step 1: Insert inline helpers after BOT_USERNAME, before auth token block**

Use Edit tool on `src/dashboard/server.js`.

Replace (exact block — keep formatting precise):
```javascript
const BOT_USERNAME = ${JSON.stringify(this._botUsername || '')};

// ── Auth token ────────────────────────────────────────────────────────────
```

With:
```javascript
const BOT_USERNAME = ${JSON.stringify(this._botUsername || '')};

// ── URL safety helpers (Bundle #3, 2026-06-07) ────────────────────────────
// Client-side duplicate of src/utils/url-safety.js. SPA cannot ESM-import,
// so we duplicate inline. Keep in sync with the server-side module.
function escHtmlAttr(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
function safeUrl(url) {
  if (!url) return null;
  try {
    const u = new URL(String(url));
    return /^https?:$/.test(u.protocol) ? String(url) : null;
  } catch (e) {
    return null;
  }
}
function safeHref(url) {
  const safe = safeUrl(url);
  return safe ? escHtmlAttr(safe) : '#';
}

// ── Auth token ────────────────────────────────────────────────────────────
```

**Critical**: NO backticks inside these helper bodies (the only string literals are `'...'` single-quoted). No `\n` inside. No `new RegExp('...')` double-escapes. This protects the SPA template literal from breaking.

- [ ] **Step 2: Run SPA validation gate**

Run: `npm run check:spa`

Expected output ends with:
```
Dashboard SPA inner OK (~343000 chars)
SPA inner OK (~266000 chars)
SPA OK
```

If FAIL → revert the edit and investigate. Most likely cause: a stray backtick or template-literal `${...}` inside the new block (the helpers don't have any — but check that Edit tool replaced exactly the right region).

- [ ] **Step 3: Task complete** — no commit; advance to Task 4.

---

## Task 4: Применить `safeHref(trend.url)` в 2 JSX usages (SEC-006)

**Files:**
- Modify: `F:\.VibeCoding\Projects\Antigravity\Narrative Parser\src\dashboard\server.js` (line ~9774 feed button, line ~10632 modal source link)

**Context:** React JSX does NOT auto-sanitize `href` against `javascript:` / `data:` schemes. These two sites render `trend.url` directly — adversarial URL in trends DB → user clicks → script runs in dashboard origin → localStorage auth token can be exfiltrated. `safeHref` (now inline in SPA from Task 3) returns `'#'` for bad protocols → inert link.

**Current state #1 (line 9772-9781, feed action button):**

```javascript
      trend.url ? h('a', {
        className: 'feed-action-btn',
        href: trend.url, target: '_blank', rel: 'noopener',
        onClick: e => e.stopPropagation(),
        // Hover-preview tags: only one of these is set (the URL pattern
        // determines which), and only on Twitter/Reddit URLs. TikTok and
        // others have no tag → no preview popup.
        'data-tweet-id':  _twPreviewId,
        'data-reddit-id': _redditPreviewId,
      }, icon('external-link', { size: 11 }), ' ', linkLabel) : null,
```

**Current state #2 (line 10630-10642, modal source link):**

```javascript
            trend.url ? h('a', {
              className: 'trend-link' + srcLinkCls,
              href: trend.url, target: '_blank', rel: 'noopener',
              // Hover-preview tags — only one is set per trend (Twitter or
              // Reddit URLs match their respective regex; other sources
              // skip both).
              'data-tweet-id':  _twModalPreviewId,
              'data-reddit-id': _redditModalPreviewId,
            },
```

- [ ] **Step 1: Replace `href: trend.url` in feed action button (line ~9774)**

Use Edit tool on `src/dashboard/server.js`.

Replace:
```javascript
      trend.url ? h('a', {
        className: 'feed-action-btn',
        href: trend.url, target: '_blank', rel: 'noopener',
```

With:
```javascript
      trend.url ? h('a', {
        className: 'feed-action-btn',
        href: safeHref(trend.url), target: '_blank', rel: 'noopener',
```

- [ ] **Step 2: Replace `href: trend.url` in modal source link (line ~10632)**

Use Edit tool on `src/dashboard/server.js`.

Replace:
```javascript
            trend.url ? h('a', {
              className: 'trend-link' + srcLinkCls,
              href: trend.url, target: '_blank', rel: 'noopener',
```

With:
```javascript
            trend.url ? h('a', {
              className: 'trend-link' + srcLinkCls,
              href: safeHref(trend.url), target: '_blank', rel: 'noopener',
```

- [ ] **Step 3: Verify no other raw `href: trend.url` left in dashboard SPA**

Run via Grep tool:
- pattern: `href:\s*trend\.url\b`
- path: `src/dashboard/server.js`
- output_mode: content
- -n: true

Expected: **0 matches**. (Both should now be `safeHref(trend.url)`.)

Note: `trend.tgMessageUrl` is from our own DB (TG message URL we constructed) — trusted, no wrap needed. Only `trend.url` (user-/scraper-supplied) needs wrapping.

- [ ] **Step 4: Run SPA validation gate**

Run: `npm run check:spa`

Expected: `SPA OK` (dashboard char count drops slightly from Task 3 baseline by ~20 chars or so; admin unchanged).

If FAIL → revert + investigate.

- [ ] **Step 5: Task complete** — no commit; advance to Task 5.

---

## Task 5: Plan gate на `_handleTweetPreview` (BILL-001 part 1)

**Files:**
- Modify: `F:\.VibeCoding\Projects\Antigravity\Narrative Parser\src\dashboard\server.js` (line ~1333)

**Context:** `_handleTweetPreview` fetches Twitter preview content for hover popup. Twitter is paid-plan source (NOT in free.sources). Free user can currently hit this endpoint and get Twitter data they shouldn't have. Add `getPlanEntitlements()` gate.

`getPlanEntitlements` is already imported at line 20 of this file — no new import needed.

**Pattern reference (line 1184 — existing usage):**
```javascript
const planSources = getPlanEntitlements(req.user?.plan_name).sources;
```

**Current state (lines 1333-1339):**

```javascript
  async _handleTweetPreview(req, res, url) {
    const idParam  = url.searchParams.get('id') || '';
    const urlParam = url.searchParams.get('url') || '';
    const id = /^\d{5,25}$/.test(idParam) ? idParam : extractTweetId(urlParam);

    if (!id) return json(res, 400, { error: 'Missing or invalid tweet id' });
```

- [ ] **Step 1: Insert plan gate at the top of `_handleTweetPreview`**

Use Edit tool on `src/dashboard/server.js`.

Replace:
```javascript
  async _handleTweetPreview(req, res, url) {
    const idParam  = url.searchParams.get('id') || '';
    const urlParam = url.searchParams.get('url') || '';
    const id = /^\d{5,25}$/.test(idParam) ? idParam : extractTweetId(urlParam);

    if (!id) return json(res, 400, { error: 'Missing or invalid tweet id' });
```

With:
```javascript
  async _handleTweetPreview(req, res, url) {
    // BILL-001 (Bundle #3): gate hover preview by plan entitlements.
    // Twitter is paid-only (not in free.sources). Reject before any fetch.
    const planSources = getPlanEntitlements(req.user?.plan_name).sources;
    if (!planSources || !planSources.includes('twitter')) {
      return json(res, 403, { error: 'Twitter preview requires a paid plan', reason: 'plan' });
    }

    const idParam  = url.searchParams.get('id') || '';
    const urlParam = url.searchParams.get('url') || '';
    const id = /^\d{5,25}$/.test(idParam) ? idParam : extractTweetId(urlParam);

    if (!id) return json(res, 400, { error: 'Missing or invalid tweet id' });
```

- [ ] **Step 2: Run SPA validation gate**

Run: `npm run check:spa`

Expected: `SPA OK` (server-side edit shouldn't change SPA char count at all — `_handleTweetPreview` lives in the class outside the SPA template).

If FAIL → revert + investigate. This edit is outside the template literal; a failure means Edit replaced wrong region.

- [ ] **Step 3: Task complete** — no commit; advance to Task 6.

---

## Task 6: Plan gate на `_handleRedditPreview` (BILL-001 part 2)

**Files:**
- Modify: `F:\.VibeCoding\Projects\Antigravity\Narrative Parser\src\dashboard\server.js` (line ~1389)

**Context:** Same pattern as Task 5 but for Reddit. Reddit IS in free plan currently — so gate rarely rejects. Added for **consistency / future-proofing**: if free plan ever excludes reddit, code already works without change.

**Current state (lines 1389-1394):**

```javascript
  async _handleRedditPreview(req, res, url) {
    const idParam  = url.searchParams.get('id') || '';
    const urlParam = url.searchParams.get('url') || '';
    const id = /^[a-z0-9]{4,12}$/i.test(idParam) ? idParam : extractRedditPostId(urlParam);

    if (!id) return json(res, 400, { error: 'Missing or invalid reddit post id' });
```

- [ ] **Step 1: Insert plan gate at the top of `_handleRedditPreview`**

Use Edit tool on `src/dashboard/server.js`.

Replace:
```javascript
  async _handleRedditPreview(req, res, url) {
    const idParam  = url.searchParams.get('id') || '';
    const urlParam = url.searchParams.get('url') || '';
    const id = /^[a-z0-9]{4,12}$/i.test(idParam) ? idParam : extractRedditPostId(urlParam);

    if (!id) return json(res, 400, { error: 'Missing or invalid reddit post id' });
```

With:
```javascript
  async _handleRedditPreview(req, res, url) {
    // BILL-001 (Bundle #3): gate hover preview by plan entitlements.
    // Reddit is in free.sources currently → this gate rarely rejects;
    // added for consistency with tweet-preview and as future-proofing if
    // free plan ever excludes reddit.
    const planSources = getPlanEntitlements(req.user?.plan_name).sources;
    if (!planSources || !planSources.includes('reddit')) {
      return json(res, 403, { error: 'Reddit preview requires a paid plan', reason: 'plan' });
    }

    const idParam  = url.searchParams.get('id') || '';
    const urlParam = url.searchParams.get('url') || '';
    const id = /^[a-z0-9]{4,12}$/i.test(idParam) ? idParam : extractRedditPostId(urlParam);

    if (!id) return json(res, 400, { error: 'Missing or invalid reddit post id' });
```

- [ ] **Step 2: Run SPA validation gate**

Run: `npm run check:spa`

Expected: `SPA OK`.

If FAIL → revert + investigate.

- [ ] **Step 3: Verify both handlers now have gates (sanity)**

Run via Grep tool:
- pattern: `planSources.*includes\('(twitter|reddit)'\)`
- path: `src/dashboard/server.js`
- output_mode: content
- -n: true

Expected: **exactly 2 matches** (one for twitter, one for reddit), in `_handleTweetPreview` and `_handleRedditPreview` respectively.

If matches != 2 → at least one gate missing or duplicated; reconcile.

- [ ] **Step 4: Task complete** — no commit; advance to Task 7.

---

## Task 7: SESSION_CONTEXT.md + WORKLOG entry + final full-SPA check

**Files:**
- Modify: `F:\.VibeCoding\Projects\Antigravity\Narrative Parser\ai-context\SESSION_CONTEXT.md`
- Modify: `F:\.VibeCoding\Projects\Antigravity\Narrative Parser\ai-context\WORKLOG.md`

**Context for SESSION_CONTEXT.md:** Append bullet to "Production posture" section. Find that section by Grep'ping for `Production posture` heading. Don't dump full file — use Grep + targeted edit.

**Context for WORKLOG.md:** Add a new entry at the TOP of the file (above the latest entry). Format used in this project (see `ai-context/AGENT_RULES.md` §3): heading + дата · модель · цель · файлы · деплой · риски.

- [ ] **Step 1: Locate Production posture section in SESSION_CONTEXT.md**

Run via Grep tool:
- pattern: `^## .*[Pp]roduction posture|^### .*[Pp]roduction posture`
- path: `ai-context/SESSION_CONTEXT.md`
- output_mode: content
- -n: true

Note the line number of the section heading. Then Read the next ~30 lines from that heading to see the bullet pattern.

- [ ] **Step 2: Add URL safety bullet to Production posture**

Use Edit tool on `ai-context/SESSION_CONTEXT.md`. Find an existing bullet in the Production posture section (likely the "Cert monitoring" or "Deploy gate" bullet from Bundle #16/#17) and add the new bullet directly after it.

Add this exact bullet (preserve indentation pattern of surrounding bullets — usually `- **Name**: description.`):

```markdown
- **URL safety helpers** (Bundle #3, 2026-06-07): `src/utils/url-safety.js` exports `escHtmlAttr()` (5-char HTML attr escape), `safeUrl()` (https/http protocol whitelist via `URL()` constructor), `safeHref()` (combined attr-escape + protocol check, returns `'#'` on invalid). Applied in `formatter.js:145` (TG alert href — skip link entirely if URL invalid), dashboard SPA JSX feed-action button and modal source link. **Client-side dashboard SPA имеет inline duplicate** этих функций после `BOT_USERNAME` injection (cannot ESM-import в template literal — established pattern). Hover preview endpoints `/api/tweet-preview` / `/api/reddit-preview` защищены `getPlanEntitlements()` gate (403 если plan не включает source). Закрыто: BOT-001, BOT-002, SEC-006, BILL-001.
```

- [ ] **Step 3: Read top of WORKLOG.md to see latest entry format**

Use Read tool with `limit: 50` on `ai-context/WORKLOG.md`. Note the heading style of the most recent entry (e.g., `## YYYY-MM-DD — Bundle #N: <title>`) and the field labels (дата, модель, цель, файлы, деплой, риски).

- [ ] **Step 4: Insert Bundle #3 entry at the top of WORKLOG.md**

Use Edit tool on `ai-context/WORKLOG.md`. Replace the existing top-most entry's heading (e.g., `## 2026-06-06 — Bundle #19...`) so that the new entry appears immediately above it.

Pattern (match existing project style — adjust spacing / field labels if newest entry uses slightly different format):

```markdown
## 2026-06-07 — Bundle #3: URL safety helpers

- **Модель**: sonnet (subagent-driven)
- **Цель**: Закрыть 4 finding'а URL-handling — HTML attr escape (BOT-001), protocol whitelist (BOT-002, SEC-006), paywall gate на hover preview (BILL-001).
- **Файлы**:
  - `src/utils/url-safety.js` — **new** (35 LOC, 3 exports: `escHtmlAttr`, `safeUrl`, `safeHref`)
  - `src/notifications/formatter.js` — import + line 145 теперь `if (safeUrl(trend.url))` + `safeHref()` в `<a href>`. Если URL невалиден — линк скипается целиком (лучше тихий no-link чем TG 400 на alert).
  - `src/dashboard/server.js`:
    - Inline duplicate `escHtmlAttr`/`safeUrl`/`safeHref` в `_buildSPA` template (после `BOT_USERNAME` injection) — SPA не может ESM-импортить.
    - `href: safeHref(trend.url)` в feed action button (~9774) и modal source link (~10632).
    - `_handleTweetPreview` (~1333): `getPlanEntitlements().sources.includes('twitter')` gate → 403 если нет.
    - `_handleRedditPreview` (~1389): аналогичный `'reddit'` gate (consistency — reddit пока в free, gate rarely rejects, future-proofing).
  - `ai-context/SESSION_CONTEXT.md` — +1 bullet в Production posture.
- **Деплой**: subagents file edits only, no commits. Оператор сам деплоит через `deploy.ps1` после ревью.
- **Риски**: low. URL constructor throws → `try/catch` returns null → graceful. SPA template literal не задет (helpers без backticks/template syntax). Reddit gate безвреден (reddit в free.sources). TG bot link skip — лучше чем 400. Inline duplicate в SPA — established pattern (LIFESPAN_VALUES, CatMascot FSM), drift отслеживается quarterly drill.
- **Closes**: BOT-001 (HIGH), BOT-002 (HIGH), SEC-006 (MEDIUM), BILL-001 (HIGH). 4 finding'а одним bundle'ом.
```

Note: adjust heading style if the project's latest entry uses different conventions (e.g., bold instead of `##`). Inspect the latest entry first.

- [ ] **Step 5: Final full SPA validation**

Run: `npm run check:spa`

Expected: `SPA OK` (dashboard char count slightly increased from baseline by ~1500 chars due to inline helpers + gate comments; admin unchanged).

- [ ] **Step 6: Sanity-check that the new helper module is importable from both consumer files**

Run: `node -e "import('./src/notifications/formatter.js').then(() => console.log('formatter OK')); import('./src/dashboard/server.js').then(() => console.log('dashboard OK')).catch(e => console.log('dashboard ERR:', e.message))"`

Expected:
```
formatter OK
dashboard OK
```

Note: dashboard server.js does heavy setup on import; if `dashboard ERR: <port already in use>` or similar — that's existing project behavior, not our bug. Only worry if error mentions `url-safety` or `MODULE_NOT_FOUND` for our new file.

- [ ] **Step 7: Task complete** — operator will commit + deploy.

---

## Operator hand-off (post-implementation)

After all 7 tasks complete, controller hands back to operator with:

1. **Diff summary** — `git status` + `git diff --stat` outputs.
2. **What to verify manually before deploy**:
   - `npm run dev` — dashboard loads, no console errors.
   - Free user (logged in via test account if available) hits `/api/tweet-preview?url=https://twitter.com/...` → expect HTTP 403 with body `{"error":"Twitter preview requires a paid plan","reason":"plan"}`.
   - Paid user (or admin) hits same → expect HTTP 200 with tweet data.
   - Spot-check dashboard: open trend modal, click "Source link" — should still work for normal URL (http/https).
3. **Helper unit sanity** (already done in T1/T7 but operator can re-verify):
   ```
   node -e "import('./src/utils/url-safety.js').then(m => { console.log(m.safeUrl('javascript:alert(1)') === null, m.safeUrl('https://example.com'), m.safeHref('javascript:void(0)') === '#', m.escHtmlAttr('\"><script>')); })"
   ```
   Expected: `true https://example.com true &quot;&gt;&lt;script&gt;`
4. **Deploy via `deploy.ps1`** — Bundle #16 SPA gate runs as `[1/5] Validating SPA syntax` and will exit early if anything broke (defense-in-depth).

## Closed findings

- **BOT-001** (HIGH): formatter.js href attribute escape — closed (5-char `safeHref` applied).
- **BOT-002** (HIGH): formatter.js URL protocol whitelist — closed (`safeUrl` rejects non-http(s), link skipped).
- **SEC-006** (MEDIUM): dashboard JSX href javascript:/data: — closed (safeHref returns `'#'` for bad protocols, React renders inert).
- **BILL-001** (HIGH): paywall on /api/tweet-preview + /api/reddit-preview — closed (getPlanEntitlements gate, 403 on miss).

---

## Self-review

(Run by plan author — engineer should skip, this is a record.)

**1. Spec coverage:**
- Spec §"`src/utils/url-safety.js` content" → Task 1 ✅
- Spec §"`src/notifications/formatter.js` change" → Task 2 ✅
- Spec §"Change A — Inline helper" → Task 3 ✅
- Spec §"Change B — 2 JSX usages" → Task 4 ✅
- Spec §"Change C — server-side plan gate" → Task 5 (Tweet) + Task 6 (Reddit) ✅. Note: spec also called for top-of-file `import { safeHref, escHtmlAttr } from '../utils/url-safety.js'` for server-side endpoint use, but the endpoint handlers in Tasks 5+6 use only `getPlanEntitlements` (already imported), not the URL helpers. YAGNI: skipped that import. If a future task needs them server-side, add then.
- Spec §"SESSION_CONTEXT.md update" → Task 7 step 2 ✅
- Spec §"Verification plan — Acceptance criteria" → covered by per-task verification + T7 final ✅
- Spec §"Functional edge case tests" → covered in T1 step 3 + operator hand-off ✅

**2. Placeholder scan:** No "TBD", "TODO", or hand-wavy steps. All code blocks contain real code.

**3. Type consistency:** Helper names `escHtmlAttr` / `safeUrl` / `safeHref` consistent across all tasks (T1 server module, T3 SPA inline, T2/T4 callers). `getPlanEntitlements(req.user?.plan_name).sources` matches existing usage at line 1184 of server.js.

Plan saved. Ready for execution.
