# Dashboard Iconography Redesign — Design Spec

**Date:** 2026-05-20
**Owner:** skipnick
**Status:** Approved, ready for plan

> **Round 4** in the Catalyst dashboard redesign series.
> Round 1 (`2026-05-19-dashboard-redesign-design.md`): palette + radius tokens + LoginScreen + toasts.
> Round 2: radius migration + density tightening + flatten hovers.
> Round 3 (no separate spec): gradient removal + abyss-black surface scale.
> **Round 4 (this spec): iconography — replace ~90 emoji with SVG icons and disciplined text.**

---

## 1. Goal

Replace every decorative emoji in `src/dashboard/server.js` with a coherent icon system: Lucide-based monochrome inline SVG for chrome and content tags, color-dot + uppercase text for state indicators, plain text + color for sentiment. Push the dashboard further from "AI-generated cheap" toward "trading-desk professional".

## 2. Context

After Rounds 1–3 the dashboard is monochrome, flat, and densely-typed. The remaining "cheap" reading comes from emoji noise: ~90 unique glyphs span flat Unicode, color-emoji rendered by the OS (Apple 3D on macOS, Segoe color on Windows, Twemoji elsewhere), and ASCII fallbacks. They drift in size, weight, anti-aliasing, and tone. Locking iconography to a single visual language closes the redesign loop.

## 3. Principles

### 3.1 One library, one style

- **Lucide** (stroke 2px outline, viewBox `0 0 24 24`) — 95% of icons. De-facto standard for trading/dev tools (Linear, Vercel, Cal.com). MIT-licensed.
- **Phosphor regular** (fill-based, viewBox `0 0 256 256`) — 2 exceptions where Lucide loses clarity: `settings` (gear teeth more pronounced) and `trend` (line with peak more semantic than zigzag). MIT-licensed.
- **Brand SVGs** (sources) — public-domain glyph designs for Reddit / Twitter-X / Google / TikTok / Hash. Drawn from open icon-set conventions, rendered monochrome via `currentColor`. No brand colors — the avatar background colors (already kept as functional) carry brand identity; the glyph carries shape recognition.

### 3.2 Hybrid icon philosophy

Icons accelerate scanning. Where text already carries the signal, the icon is noise.

- **Use SVG** for: action buttons, category content-tags, brand source identifiers, metrics, settings UI, feature flags (locked/manual/catalyst), warnings/errors, alert types, empty states.
- **Use color-dot + uppercase text** for: phase indicators (STRONG / FORMING / EARLY / SATURATED), market stage (LIVE pulsing / OVERHEATED / TOKENIZING spinner).
- **Use text-only with semantic color** for: sentiment (POSITIVE green / NEGATIVE red / NEUTRAL muted). Color carries direction; no glyph needed.
- **Use 2-letter codes** for: language flags (`EN` / `RU` in monospace, no flag emoji).

### 3.3 Inline SVG, single helper

No external library imports — `src/dashboard/server.js` is one inline-React file, no bundle. All ~80 icons live in a `const ICONS` registry, invoked via one `icon(name, opts)` helper. Approximate added weight: 80 icons × ~200 chars = ~16 kB on top of the current ~295 kB template literal.

### 3.4 currentColor everywhere

Every icon renders with `stroke="currentColor"` (Lucide) or `fill="currentColor"` (Phosphor/Brand). Parent text color drives icon color. Theming (pulse green / ink blue / tide cyan) flows through automatically.

## 4. Architecture

### 4.1 Helper + registry

In the JS helpers section of `src/dashboard/server.js` (currently around line ~7700, near `barColor()` / `memeClass()`):

```js
// 2026-05-20 R4 — central icon helper. makeIcon() is a factory that returns
// a render function; each entry in ICONS captures its viewBox and stroke/fill
// style at definition time. icon(name, opts) is the use-site shim.
function makeIcon(viewBox, stroke, ...children) {
  return (props = {}) => {
    const size = props.size != null ? props.size : 14;
    const styleExt = props.style || {};
    return h('svg', {
      width: size, height: size, viewBox,
      ...(stroke
        ? { fill: 'none', stroke: 'currentColor', strokeWidth: 2,
            strokeLinecap: 'round', strokeLinejoin: 'round' }
        : { fill: 'currentColor' }),
      style: { display: 'inline-block', verticalAlign: 'middle',
               flexShrink: 0, ...styleExt },
      'aria-hidden': props['aria-label'] ? undefined : 'true',
      ...Object.fromEntries(Object.entries(props).filter(
        ([k]) => k !== 'size' && k !== 'style'))
    }, ...children);
  };
}

const ICONS = {
  // Brand sources (5)
  reddit:  makeIcon('0 0 24 24', false, h('path', { d: 'M12 0A12 12 0 0 0 0 12...' })),
  twitter: makeIcon('0 0 24 24', false, h('path', { d: 'M18.244 2.25h3.308...' })),
  google:  makeIcon('0 0 24 24', false, h('path', { d: 'M12.545 10.239v3.821...' })),
  tiktok:  makeIcon('0 0 24 24', false, h('path', { d: 'M19.59 6.69a4.83...' })),
  hash:    makeIcon('0 0 24 24', true,
    h('line', { x1: 4, y1: 9, x2: 20, y2: 9 }),
    h('line', { x1: 4, y1: 15, x2: 20, y2: 15 }),
    h('line', { x1: 10, y1: 3, x2: 8, y2: 21 }),
    h('line', { x1: 16, y1: 3, x2: 14, y2: 21 })),

  // Phosphor exceptions (2)
  settings: makeIcon('0 0 256 256', false, h('path', { d: 'M128 80a48 48...' })),
  trend:    makeIcon('0 0 256 256', false, h('path', { d: 'M232 208a8...' })),

  // ...rest are Lucide (stroke true, viewBox 0 0 24 24)
};

function icon(name, opts) {
  const factory = ICONS[name];
  return factory ? factory(opts || {}) : null;
}
```

### 4.2 Use-site pattern

```js
// Before:
h('span', { className: 'feed-action-btn' }, '🔗 Open in X')

// After:
h('span', { className: 'feed-action-btn' },
  icon('external-link', { size: 12 }),
  ' Open in X')
```

```js
// Phase chip — no icon, dot + text:
h('span', { className: 'phase-chip strong' },
  h('span', { className: 'phase-dot' }),  // CSS-coloured ::before alternative
  'STRONG')
```

```js
// Sentiment — pure text, color carries direction:
h('span', { className: 'sentiment-chip positive' }, 'POSITIVE')
```

### 4.3 Object restructure — PHASE_META / CAT_ICONS / SOURCE_ICONS

Existing PHASE_META carries `icon: '🔥'`. After R4:

```js
// Before:
const PHASE_META = {
  strong:    { icon: '🔥', label: 'Strong' },
  forming:   { icon: '🌊', label: 'Forming' },
  early:     { icon: '🌱', label: 'Early' },
  saturated: { icon: '🍂', label: 'Saturated' },
};

// After:
const PHASE_META = {
  strong:    { color: 'var(--accent)',  label: 'Strong' },
  forming:   { color: 'var(--text2)',   label: 'Forming' },
  early:     { color: 'var(--muted)',   label: 'Early' },
  saturated: { color: 'var(--warn)',    label: 'Saturated' },
};
// phase-dot CSS reads `style: { background: PHASE_META[p].color }`
```

```js
// CAT_ICONS — emoji glyph → icon key
const CAT_ICONS = {
  meme:          'image',
  celebrity:     'star',
  animals:       'paw-print',
  tech:          'cpu',
  gambling:      'coins',
  politics:      'landmark',
  entertainment: 'clapperboard',
  gaming:        'gamepad-2',
  sports:        'trophy',
  boring:        'moon',
  other:         'dots-horizontal',
};
// Render: icon(CAT_ICONS[cat], { size: 12 })
```

```js
// SOURCE_ICONS — same, key references brand SVG
const SOURCE_ICONS = {
  reddit:        'reddit',
  twitter:       'twitter',
  google_trends: 'google',
  tiktok:        'tiktok',
  x_trends:      'hash',
};
```

### 4.4 i18n untangling

Several translation strings embed emoji directly:

```js
// Before:
'phase.strong_desc': '🔥 Strong narrative — already viral',
'sort.meme':         '💎 By meme score',
'idle_btn':          '💬 Sign in via Telegram',
```

After R4, emoji come out of strings; JSX renders icon + text side-by-side:

```js
'phase.strong_desc': 'Strong narrative — already viral',
'sort.meme':         'By meme score',
'idle_btn':          'Sign in via Telegram',
// JSX:
h('span', null, icon('flame', { size: 12 }), ' ', t('phase.strong_desc'))
```

Affected i18n keys: ~30 in EN, mirrored in RU = ~60 edits total. Listed exhaustively in implementation plan, not this spec.

### 4.5 SPA-trap discipline

SVG paths are pure numbers + path-commands (`M`, `L`, `C`, `Z`) — no backticks, no `\'`, no `\n`. Risk of breaking the template literal is low. Verify with `node scripts/check-dashboard-spa.cjs` after every commit anyway.

## 5. Inventory — emoji → decision

90+ unique emoji mapped to icon-name, dot, text, or removal. Full table below.

### 5.1 Brand sources

| Emoji | Where | Decision |
|---|---|---|
| `🟠` / `R` | sidebar Reddit, feed avatars | `icon('reddit')` |
| `𝕏` | sidebar Twitter, feed avatars, links | `icon('twitter')` |
| `G` | sidebar Google, links | `icon('google')` |
| `♪` | sidebar TikTok, feed avatars | `icon('tiktok')` |
| `#` | sidebar X Trends, badges | `icon('hash')` |

### 5.2 Categories (CAT_ICONS object)

| Emoji | Category | Lucide name |
|---|---|---|
| `😂` | meme | `image` |
| `⭐` | celebrity | `star` |
| `🐾` | animals | `paw-print` |
| `💻` | tech | `cpu` |
| `🎰` | gambling | `coins` |
| `🏛️` | politics | `landmark` |
| `🎬` | entertainment | `clapperboard` |
| `🎮` | gaming | `gamepad-2` |
| `🏆` | sports | `trophy` |
| `😴` | boring | `moon` |
| `📌` | other | `more-horizontal` (3 dots) |

### 5.3 Phase indicators (PHASE_META)

| Emoji | Phase | Decision |
|---|---|---|
| `🔥` | strong | dot `var(--accent)` + text "STRONG" |
| `🌊` | forming | dot `var(--text2)` + text "FORMING" |
| `🌱` | early | dot `var(--muted)` + text "EARLY" |
| `🍂` | saturated | dot `var(--warn)` + text "SATURATED" |

### 5.4 Sentiment

| Emoji | Value | Decision |
|---|---|---|
| `😊` | positive | text "POSITIVE", color `var(--accent)` |
| `😠` | negative | text "NEGATIVE", color `var(--red2)` |
| `😐` | neutral | text "NEUTRAL", color `var(--muted)` |

### 5.5 Market stage

| Emoji | Stage | Decision |
|---|---|---|
| `🟢` | live | pulsing dot `var(--accent)` + "LIVE" |
| `🔴` | overheated | static dot `var(--red2)` + "OVERHEATED" |
| `🔄` | tokenizing | mini-spinner (CSS) + "TOKENIZING" |

### 5.6 Alert types

| Emoji | Type | Decision |
|---|---|---|
| `📰` | event | `icon('newspaper')` |
| `📈` | trend | `icon('trend')` (Phosphor exception) |
| `🚀` | post | `icon('circle-dot')` (single signal) |
| `✓` | saved | `icon('check')` |

### 5.7 Metrics

| Emoji | Metric | Decision |
|---|---|---|
| `❤️` | likes | `icon('heart')` |
| `💬` | comments | `icon('message-circle')` |
| `🔁` | retweets | `icon('repeat-2')` |
| `👁` | views | `icon('eye')` |
| `⬆️` | upvotes (Reddit) | `icon('arrow-up')` |
| `🏅` | awards (Reddit) | `icon('award')` |

### 5.8 Settings UI

| Emoji | Setting | Decision |
|---|---|---|
| `⚙️` | settings | `icon('settings')` (Phosphor) |
| `🎨` | appearance / theme | `icon('palette')` |
| `🌐` | language | `icon('globe')` |
| `👤` | account | `icon('user')` |
| `🔄` | behavior | `icon('refresh-ccw')` |
| `📦` | archive | `icon('archive')` |
| `📡` | sources | `icon('radio-tower')` |
| `🔔` | alerts | `icon('bell')` |
| `🖼️` | images | `icon('image')` |
| `✨` | animations | `icon('sparkles')` |
| `📐` | density | `icon('rows')` |
| `👁`  | hidden | `icon('eye-off')` |
| `🇺🇸` / `🇷🇺` | language flag | text `EN` / `RU` (monospace) |
| `🚪` | logout | `icon('log-out')` |
| `🏥` | health check | `icon('activity')` |

### 5.9 Feature flags

| Emoji | Flag | Decision |
|---|---|---|
| `🔒` | locked | `icon('lock')` |
| `🧪` | manual / analyze section | `icon('flask-conical')` |
| `🔮` | catalyst | `icon('sparkles')` |
| `🤖` | AI explanation | `icon('bot')` |
| `💎` | premium plan | `icon('gem')` |

### 5.10 Action buttons

| Emoji | Action | Decision |
|---|---|---|
| `✕` | close / dismiss | `icon('x')` |
| `✏️` | edit | `icon('pencil')` |
| `🔗` | external link / open in X | `icon('external-link')` |
| `📨` / `✈️` | send TG | `icon('send')` (paper-plane) |
| `🔍` | search / Analyze (bottom-nav) | `icon('search')` |
| `🔀` | sort | `icon('arrow-up-down')` |
| `🏷️` | category filter | `icon('tag')` |
| `★` / `☆` | favourite save | `icon('star')` (use `fill="currentColor"` variant for saved) |
| `🔥` | feed tab (sidebar bottom-nav) | `icon('flame')` |
| `⭐` | saved tab | `icon('star')` |
| `💹` | market stage label | `icon('line-chart')` |
| `📊` | stats / metrics | `icon('bar-chart-3')` |
| `🎯` | trend scoring (login feature) | `icon('target')` |
| `🧠` | Ask Grok | `icon('brain')` |
| `📋` | copied toast | `icon('clipboard-check')` |
| `👍` / `👎` | feedback | `icon('thumbs-up')` / `icon('thumbs-down')` |

### 5.11 Lifespan

| Emoji | Span | Decision |
|---|---|---|
| `⚡` | flash 1h | `icon('zap')` |
| `📅` | short 1-2d | `icon('calendar')` |
| `🗓` | medium 3-7d | `icon('calendar-days')` |
| `📆` | long weeks+ | `icon('calendar-range')` |

### 5.12 Warnings + empty states

| Emoji | Use | Decision |
|---|---|---|
| `⚠️` | warning | `icon('alert-triangle')` |
| `⛔` | limit exceeded | `icon('ban')` |
| `❌` | error | `icon('x-circle')` |
| `📭` | empty feed | `icon('inbox')` |

### 5.13 Out of scope (already handled in earlier rounds)

- `🐱` nav-logo fallback — already replaced with monogram `C` in Round 1.
- Toast emoji — stripped in Round 1 Task 10; toasts now use SVG icons.
- LoginScreen ambient gradient blobs — removed in Round 3.
- Numbered medal ranks (TOP-1/2/3) — typographic, not emoji.

## 6. Implementation passes

8 passes, each one commit + SPA check. Single file: `src/dashboard/server.js`.

1. **Icon-helper foundation.** Add `makeIcon()`, `ICONS` registry skeleton (just brand + Phosphor exceptions + a handful of Lucide), `icon()` helper. Verify rendering with a single test usage in one place. SPA check.
2. **Brand SVGs (sources).** Replace SOURCE_ICONS object + sidebar source rows + feed-card avatar font-emoji content. Add brand entries to ICONS registry.
3. **Bottom-nav + sidebar phase chips + filter chips.** Replace footer-nav icons, sidebar phase emoji, type chips (EVENT/TREND/POST), category dropdown icons. Restructure PHASE_META to use `color` instead of `icon`.
4. **Feed card.** STRONG/EVENT/POSITIVE chips, like/comment/repeat/view metrics row, Details/Open/Send/Save action buttons.
5. **Settings panel + Account panel.** All settings rows — appearance/theme/language/account/behavior/archive/density. Language flags → text codes.
6. **Analyze panel + TrendModal.** Verdict header, score icons, sentiment chip, market stage indicator, lifespan icons, ask-Grok feature, links section.
7. **Warnings + empty states + toasts.** Empty feed, search-no-results, error toasts, limit-exceeded toast.
8. **i18n string sweep + final grep.** Remove all leading emoji from translation strings (EN + RU). Final `grep` confirms zero standalone emoji outside whitelisted areas. WORKLOG entry.

Each pass is one commit. Reviewer subagent dispatched after every implementation commit (spec compliance + code quality) per the writing-plans / subagent-driven-development conventions.

## 7. Out of scope

- Adding new icon meanings — only replace existing emoji.
- Restyling chip backgrounds/borders — already done in Rounds 1–3.
- Animating new icons — `LIVE` pulsing dot and `TOKENIZING` spinner already designed; no new motion.
- Touching admin SPA (`src/admin/server.js`) — separate spec if/when needed.

## 8. Risks

- **i18n migration is the largest unknown.** ~30 EN strings × 2 langs = ~60 edits. Mistakes here can change visible UX text accidentally. Mitigation: each i18n edit verified by re-rendering the affected screen (mentally or in dev tools).
- **PHASE_META consumers.** `PHASE_META.icon` is read in feed-card PhaseBadge rendering. Replacing `icon` field with `color` requires updating every consumer that referenced the field. Mitigation: grep for `PHASE_META\.\w+\.icon` and `phaseMeta\.icon` before changing the object shape.
- **Helper hot path.** `icon()` is called per-render in many places. Make sure the factory is cheap (it is — just `h('svg', {...}, ...children)`). No memoisation needed.
- **SPA-trap.** Always green so far. SVG paths shouldn't break it. Verify after each commit; revert on red.

## 9. Acceptance

After all 8 passes deployed:

1. `grep` for emoji ranges (`U+1F300-1F9FF`, `U+2600-27BF`, etc.) in `src/dashboard/server.js` returns zero standalone matches outside the whitelist (brand source colors, top-1/2/3 medals — both typographic).
2. Every chip/button/avatar/setting-row renders via one of: `icon(name)`, `phase-dot + text`, or `text + color`.
3. The screenshot of the dashboard matches the `final-preview.html` mockup composition.
4. SPA check green at every commit; CI smoke (if applicable) passes.
5. Operator (skipnick) reads as "Linear / Bloomberg lite" — not "AI-generated".

---

## Appendix A — Lucide license note

Lucide is MIT-licensed (https://github.com/lucide-icons/lucide/blob/main/LICENSE). Inlining SVG path data is permitted with or without attribution; project keeps the MIT notice in `LICENSE` files folder if one is later added. Phosphor is MIT. Brand source SVGs are drawn from public-domain glyph conventions — no Twitter/Reddit/etc. trademark assets used.

## Appendix B — Why not lucide-react / heroicons-react package?

The Catalyst dashboard is inline-React inside a single template literal — no bundler, no `import` statement, no `require()`. External icon libraries would require npm install + module-resolve, which the SPA pipeline doesn't support. Inline SVG keeps the pipeline single-file and zero-runtime.
