# URL Safety Bundle — Design Spec

**Bundle**: #3 из `docs/audit/INDEX.md` (Tier 2)
**Date**: 2026-06-07
**Author**: brainstorm session (operator + sonnet, operator delegated per «решай сам» pattern)
**Status**: Approved scope (whole #3 as-is), ready for writing-plans

---

## Goal

Закрыть 4 finding'а связанных с URL handling: HTML attribute escaping (BOT-001), protocol whitelist для `<a href>` (BOT-002, SEC-006), и paywall gate на hover preview endpoints (BILL-001). Создать **один** helper-модуль + применить в 5 callsites.

## Context

12-stage audit пометил 4 URL-related finding'а:

- **BOT-001 (HIGH)**: `escHtml()` в `src/notifications/formatter.js:242` escape'ит только 3 char'а (`&`, `<`, `>`), не `"` и `'`. На `formatter.js:145` `trend.url` рендерится в `<a href="${trend.url}">` без attribute-safe escape. Если URL содержит `"` (e.g., query param `?foo="bar"`), Telegram parse_mode=HTML возвращает 400 → alert тихо теряется.
- **BOT-002 (HIGH)**: Тот же `formatter.js:145` не валидирует протокол URL. Если в БД попадёт `javascript:alert(1)` URL — Telegram сам не выполнит JS, но user copy-paste в DevTools console исполнит.
- **SEC-006 (MEDIUM)**: React JSX в `src/dashboard/server.js:9774` (feed button) и `:10632` (modal source link) рендерит `href={trend.url}` без `safeHref()` wrapper. **React НЕ авто-санитизирует href от `javascript:` / `data:`** — это distinct от XSS защиты для text content. Если adversarial URL попадёт в trends table — user clicks → script runs → localStorage token exfiltrated.
- **BILL-001 (HIGH)**: `/api/tweet-preview` (`server.js:1333`) и `/api/reddit-preview` (`:1389`) не проверяют `getPlanEntitlements(req.user.plan).sources` — free user может fetch'ить Twitter preview контент без upgrade на paid plan (Twitter не в free.sources).

**Существующие материалы**:
- `escHtml()` в `formatter.js:242` — 3-char escape, applied везде для text content (works correctly для text)
- `getPlanEntitlements()` — used pervasively для plan checks
- URL regex `/^https?:\/\//i` exists в 2 местах (`url-resolver.js:26`, `dashboard/server.js:1949`) — manual analysis validates на ingestion, но defense-in-depth render-time check отсутствует

**Defense-in-depth principle**: ingestion validation (manual analysis) уже есть, но другие paths (collectors, decisions, migrations, direct inserts) bypass'ят это. Render-time check защищает от ВСЕХ ingestion paths.

---

## Scope

### In-scope

**New file**:
- `src/utils/url-safety.js` (~30 LOC) — exports `escHtmlAttr()`, `safeUrl()`, `safeHref()`

**Modified files**:
- `src/notifications/formatter.js` — import + apply `safeHref()` на line 145 для TG bot href rendering (BOT-001 + BOT-002)
- `src/dashboard/server.js`:
  - Inline `safeHref()` helper в SPA template literal (client-side JSX usage — `_buildSPA` method)
  - Apply `safeHref(trend.url)` в React JSX lines 9774, 10632 (SEC-006)
  - Apply `getPlanEntitlements()` check в `_handleTweetPreview` (1333) и `_handleRedditPreview` (1389) — BILL-001
- `ai-context/SESSION_CONTEXT.md` — короткий bullet в Security / Production posture про URL safety helpers
- `ai-context/WORKLOG.md` — Bundle #3 entry

### Out-of-scope

- **Audit log persistence для billing rejects** — `admin_audit_log` table это Bundle #2 territory
- **Sentry integration / error visibility** для silent TG fails — Bundle #13 territory
- **Tests / TDD** — нет existing test infra; operator выбирал минимум. SPA validation gate + SPA functional smoke = поверка.
- **Centralized URL ingestion validation** (replace per-collector validation) — большой refactor, defer.
- **CSP headers** — defense-in-depth XSS prevention layer, отдельный bundle.

---

## Architecture

### Files affected

| File | Action | Detail |
|---|---|---|
| `src/utils/url-safety.js` | new | 3 exported helpers, ~30 LOC |
| `src/notifications/formatter.js` | modify | Add `import { safeHref }` + apply to line 145 |
| `src/dashboard/server.js` | modify | (a) Add inline `safeHref` в SPA template; (b) replace 2 JSX href usages; (c) add plan check в 2 endpoint handlers; (d) `import { safeHref, escHtmlAttr } from '../utils/url-safety.js'` for server-side endpoint use |
| `ai-context/SESSION_CONTEXT.md` | modify | +1 bullet (Security posture) |
| `ai-context/WORKLOG.md` | modify | Bundle #3 entry |

### Files NOT touched

- `src/admin/server.js` — admin URL safety не в audit findings (admin trusted)
- Test files — нет existing test infra
- Migration files — schema unchanged
- Database — нет new tables

---

## `src/utils/url-safety.js` content

```javascript
// URL safety helpers — Bundle #3 (2026-06-07)
// Server-side use: import { escHtmlAttr, safeUrl, safeHref } from '../utils/url-safety.js'
// Client-side (dashboard SPA): same functions duplicated inline in src/dashboard/server.js _buildSPA template

/**
 * Escape HTML attribute-safe (5-char: & " ' < >).
 * Use for any string interpolated into an HTML attribute value.
 *
 * @param {*} s - any value (coerced to string)
 * @returns {string} escaped string safe for double-quoted HTML attribute
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
 * Validate URL has http(s) protocol. Returns original URL if valid, null otherwise.
 * Rejects javascript:, data:, file:, mailto:, and any other scheme.
 *
 * @param {*} url - any value (coerced to string)
 * @returns {string|null} original URL if http(s), null otherwise
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
 * Returns '#' fallback if URL fails validation — safe to drop into href.
 *
 * Use in any context where untrusted URL is rendered into <a href="..."> attribute.
 *
 * @param {*} url - any value
 * @returns {string} either escaped safe URL, or '#' fallback
 */
export function safeHref(url) {
  const safe = safeUrl(url);
  return safe ? escHtmlAttr(safe) : '#';
}
```

### Note on client-side duplication

`src/dashboard/server.js` is the inline React SPA monolith (~13K lines). The SPA template literal contains client-side JS that runs in browser — cannot `import` from `src/utils/url-safety.js`. So we duplicate the same 3 functions inline в `_buildSPA()` method.

**Duplication justified**: cannot share without bundler; pattern matches existing project (CatMascot FSM duplication, LIFESPAN_VALUES injection, etc.). Acceptable per established architecture.

---

## `src/notifications/formatter.js` change (BOT-001 + BOT-002)

**Current** (line 145):
```javascript
msg += `🔗 <a href="${trend.url}">${t.alertOpen}</a>`;
```

**After**:
```javascript
// Import at top
import { safeHref, safeUrl } from '../utils/url-safety.js';

// Line 145 replaced:
const safeUrlOrNull = safeUrl(trend.url);
if (safeUrlOrNull) {
  msg += `🔗 <a href="${safeHref(trend.url)}">${t.alertOpen}</a>`;
}
// If safeUrl returned null — skip the link entirely (don't render <a href="#">,
// safer to omit; user will still see the rest of the alert).
```

Logic: if URL is invalid (no http/https, or parses to bad URL) — skip rendering the link altogether instead of substituting `#`. For TG alerts, "no link" is better UX than "link to nothing".

---

## `src/dashboard/server.js` changes

### Change A — Inline `safeHref` helper in SPA template literal (client-side)

In `_buildSPA()` method, somewhere в client-side JS section (near other helpers), add:

```javascript
// === URL safety helpers (Bundle #3, 2026-06-07) ===
// Client-side duplicate of src/utils/url-safety.js (cannot import in inline SPA)
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
  } catch {
    return null;
  }
}
function safeHref(url) {
  const safe = safeUrl(url);
  return safe ? escHtmlAttr(safe) : '#';
}
```

Placement: near the top of `_buildSPA` JS section, before any code that uses URLs. Implementation may find an existing "helpers" comment block to anchor near.

### Change B — Apply `safeHref` to 2 JSX usages (SEC-006)

**Line ~9774** (feed action button):
```javascript
// Before:
h('a', { className: 'feed-action-btn', href: trend.url, target: '_blank', rel: 'noopener', ... })
// After:
h('a', { className: 'feed-action-btn', href: safeHref(trend.url), target: '_blank', rel: 'noopener', ... })
```

**Line ~10632** (modal source link):
```javascript
// Before:
h('a', { className: 'trend-link', href: trend.url, target: '_blank', rel: 'noopener', ... })
// After:
h('a', { className: 'trend-link', href: safeHref(trend.url), target: '_blank', rel: 'noopener', ... })
```

If `safeHref` returns `'#'` (bad URL), link is still rendered but clicking does nothing (no JS execution). For React JSX, this is the cleanest pattern — `href="#"` ≈ inert link.

### Change C — Server-side import + plan gate (BILL-001)

**At the top of `src/dashboard/server.js`** (server-side imports, NOT inside SPA template):
```javascript
import { safeHref, escHtmlAttr } from '../utils/url-safety.js';
import { getPlanEntitlements } from '../billing/entitlements.js'; // likely already imported, verify
```

**`_handleTweetPreview()` at ~line 1333**, add at the start of the method (after method signature, before any other logic):
```javascript
async _handleTweetPreview(req, res, url) {
  // BILL-001: gate by plan entitlements
  const planName = req.user?.plan_name || 'free';
  const ent = getPlanEntitlements(planName);
  if (!ent.sources.includes('twitter')) {
    return json(res, 403, { error: 'Twitter preview requires a paid plan', reason: 'plan' });
  }
  // ... existing logic
}
```

**`_handleRedditPreview()` at ~line 1389**, same pattern:
```javascript
async _handleRedditPreview(req, res, url) {
  // BILL-001: gate by plan entitlements (consistency — reddit is in free, so this rarely rejects)
  const planName = req.user?.plan_name || 'free';
  const ent = getPlanEntitlements(planName);
  if (!ent.sources.includes('reddit')) {
    return json(res, 403, { error: 'Reddit preview requires a paid plan', reason: 'plan' });
  }
  // ... existing logic
}
```

Reddit preview rarely rejects because reddit is in free plan. Added for **consistency** — if free plan ever changes to exclude reddit, the gate already works without code change.

---

## SESSION_CONTEXT.md update

В Production posture section добавить bullet (рядом с Deploy gate / Cert monitoring / Secret rotation):

```markdown
- **URL safety helpers**: `src/utils/url-safety.js` exports `escHtmlAttr()` (5-char HTML attr escape), `safeUrl()` (https/http protocol whitelist), `safeHref()` (combined attr-escape + protocol check, returns `'#'` on invalid). Used в `formatter.js:145` (TG bot alert link), dashboard SPA JSX (`<a href={safeHref(trend.url)}>`), и server-side imports. **Client-side dashboard SPA имеет inline duplicate** этих функций (cannot import в template literal — established pattern). Hover preview endpoints (`/api/tweet-preview`, `/api/reddit-preview`) защищены `getPlanEntitlements()` gate (403 если plan не включает source). Bundle #3 (2026-06-07) закрыл BOT-001/002 + SEC-006 + BILL-001.
```

---

## Verification plan

### Acceptance criteria

**New file**:
- [ ] `src/utils/url-safety.js` exists with 3 exported functions: `escHtmlAttr`, `safeUrl`, `safeHref`
- [ ] Functions match spec content (signatures + behavior)

**formatter.js (TG bot)**:
- [ ] Imports `safeHref` / `safeUrl` from `../utils/url-safety.js`
- [ ] Line 145 area: link rendered only if `safeUrl(trend.url)` returns non-null
- [ ] `escHtmlAttr` или `safeHref` used для href attribute value
- [ ] No `<a href="${trend.url}">` raw interpolation remaining

**dashboard/server.js**:
- [ ] Server-side import of `safeHref` / `escHtmlAttr` from `../utils/url-safety.js` (at top of file)
- [ ] Client-side inline `safeHref` / `safeUrl` / `escHtmlAttr` in `_buildSPA` template
- [ ] Line 9774 area: `href: safeHref(trend.url)` (not raw `trend.url`)
- [ ] Line 10632 area: `href: safeHref(trend.url)`
- [ ] `_handleTweetPreview` has `getPlanEntitlements` gate с `twitter` check
- [ ] `_handleRedditPreview` has `getPlanEntitlements` gate с `reddit` check

**SPA validation gate (CRITICAL)**:
- [ ] After EACH `src/dashboard/server.js` edit: `npm run check:spa` exits 0
- [ ] Final full SPA check: `npm run check:spa` exits 0

**Docs**:
- [ ] `ai-context/SESSION_CONTEXT.md` — Production posture bullet about URL safety helpers
- [ ] `ai-context/WORKLOG.md` — Bundle #3 entry

**Operator verification (T-final)**:
- [ ] `npm run dev` starts cleanly
- [ ] Dashboard loads без console errors
- [ ] Trying `/api/tweet-preview?url=...` as free user → 403 (manual curl/browser test)
- [ ] Trying `/api/tweet-preview?url=...` as paid user (via test plan switch если есть) → 200

### Functional edge case tests (manual)

- [ ] `safeUrl('javascript:alert(1)')` → returns `null` (helper unit test optional, via local Node REPL)
- [ ] `safeUrl('https://example.com?q="bad"')` → returns the URL (valid)
- [ ] `escHtmlAttr('"><script>')` → returns `&quot;&gt;&lt;script&gt;` (5-char escape)
- [ ] `safeHref('javascript:void(0)')` → returns `'#'`

(These are sanity checks before deploy; if any fail, the helper has a bug.)

### Closed findings

- BOT-001 (escape 5-char + safeHref на formatter.js:145)
- BOT-002 (protocol whitelist на formatter.js:145)
- SEC-006 (safeHref applied to dashboard JSX lines 9774, 10632)
- BILL-001 (getPlanEntitlements gate on tweet-preview + reddit-preview)

---

## Risks & mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Edit breaks SPA template literal (backtick trap) | medium | `npm run check:spa` after EACH server.js edit. Pattern proven в Bundle #19. |
| Inline helper duplication drifts from `src/utils/url-safety.js` | medium | Comment в обоих местах указывает на other location. Quarterly drill check может включать diff. Defer auto-sync (overkill). |
| URL constructor throws on edge cases | low | `try/catch` wraps it, returns `null` on any throw. Graceful degradation. |
| BILL-001 gate breaks existing free users using reddit-preview | low | Reddit IS в free.sources, gate doesn't reject — sanity-verify entitlements config before deploy. |
| `getPlanEntitlements` returns unexpected shape | very low | Existing helper used pervasively (Bundle #16 didn't break it). Verify return has `.sources` array. |
| TG bot alert with skipped link looks weird | low | Better than 400 error (which silently drops the alert entirely). Operator can visually verify on first paid-user alert. |

---

## Estimated effort

| Component | Time |
|---|---|
| Create `src/utils/url-safety.js` | 15 min |
| `formatter.js` import + line 145 fix | 15 min |
| `dashboard/server.js` Change A (inline helper in SPA) | 20 min + SPA check |
| `dashboard/server.js` Change B (2 JSX href updates) | 15 min + SPA check |
| `dashboard/server.js` Change C (2 endpoint plan gates + server-side import) | 20 min + SPA check |
| `SESSION_CONTEXT.md` bullet | 5 min |
| WORKLOG entry | 10 min |
| Operator: dev server + manual 403/200 test | 15 min |
| **Total** | **~2h** |

Matches audit's ~2h estimate.

---

## Open questions

All resolved per operator delegation:

- Q1: Helper file location (`src/utils/` vs extend `formatter.js`)? → **`src/utils/url-safety.js`** (neutral, future-proof)
- Q2: Client-side duplication (inline в SPA template vs other)? → **Inline duplicate** (cannot import в template literal, established pattern)
- Q3: Skip link vs `'#'` fallback на bad URL? → **Skip link в formatter.js** (TG: nothing better than dud link); **`'#'` fallback в React JSX** (inert link cleaner than removing DOM element)
- Q4: Add `getPlanEntitlements` check to reddit-preview даже хотя reddit в free? → **Yes, для consistency** (future-proof если free plan меняется)
- Q5: Tests / TDD? → **No** (нет existing test infra; SPA gates + manual smoke = verification)

---

## Transition

После approve этого spec — invoke `superpowers:writing-plans` для генерации implementation plan с per-edit SPA gates + final operator smoke.
