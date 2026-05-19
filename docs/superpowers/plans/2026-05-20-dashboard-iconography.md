# Dashboard Iconography Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all ~90 emoji in `src/dashboard/server.js` with disciplined SVG icons (Lucide + 2 Phosphor exceptions + 5 brand glyphs), color-dot + text for state indicators, and pure text-with-color for sentiment.

**Architecture:** Single inline `ICONS` registry with `makeIcon()` factory + `icon(name, opts)` helper. All SVG paths inline (no external library). Restructure `PHASE_META`/`CAT_ICONS`/`SOURCE_ICONS` objects to store icon-keys or color values instead of emoji glyphs. Untangle i18n strings — emoji come out of translation values, JSX renders icon + text side-by-side.

**Tech Stack:** Inline React SPA in `src/dashboard/server.js` (~12.5k lines, ~295 kB template literal). One file only. SPA check after every commit: `node scripts/check-dashboard-spa.cjs`.

**Source for SVG paths:** Lucide → https://lucide.dev/icons/<name> · Phosphor regular → https://phosphoricons.com/?q=<name>&weight=regular · Brand glyphs → public-domain simple-icons style.

**Spec:** [`docs/superpowers/specs/2026-05-20-dashboard-iconography-design.md`](../specs/2026-05-20-dashboard-iconography-design.md)

---

## File Structure

| File | Change | Responsibility |
|------|--------|----------------|
| `src/dashboard/server.js` | Modify | Add `makeIcon`/`ICONS`/`icon()` helpers; replace all emoji at use-sites; restructure `PHASE_META`/`CAT_ICONS`/`SOURCE_ICONS`; untangle i18n strings; update phase-dot CSS. |
| `ai-context/WORKLOG.md` | Modify | Append Round 4 entry on top (Task 8). |

No other files touched. No new files created. Tests are SPA check + visual verification + emoji-grep.

---

## SPA-trap discipline (applies to every Task)

After every Edit on `src/dashboard/server.js`:

```bash
node scripts/check-dashboard-spa.cjs
```

Expected output: `Dashboard SPA inner OK (<size> chars)`. Red = revert immediately.

SVG paths are pure numbers + commands (M/L/C/Z) — no backticks, no `\'`, no `\n`. Risk is low but verify anyway.

---

## Task 1: Icon helper foundation + smoke test

**Files:**
- Modify: `src/dashboard/server.js` — add helper block near line ~7715 (after `memeColor()`/`barColor()`, before `fmtVelocity()`)

- [ ] **Step 1: Locate the helpers section.**

Grep for the existing `barColor` declaration:

```bash
grep -n "^function barColor" src/dashboard/server.js
```

Insert the new helper block immediately after the `barColor` function closes (one blank line below).

- [ ] **Step 2: Add `makeIcon` factory + `ICONS` skeleton + `icon()` helper.**

Insert this exact code block:

```js
// ── Icons ────────────────────────────────────────────────────────────────────
// 2026-05-20 (R4): central inline-SVG icon registry. makeIcon() captures
// viewBox + stroke/fill style at definition time. ICONS holds factories
// (one per icon name). icon(name, opts) is the use-site shim — returns
// h('svg', {...}, ...children) or null if name not found.
//
// Style conventions:
//   - Lucide icons     → viewBox '0 0 24 24', stroke=true, currentColor stroke
//   - Phosphor icons   → viewBox '0 0 256 256', stroke=false, currentColor fill
//   - Brand SVGs       → viewBox '0 0 24 24', stroke=false (drawn as filled glyphs)
//
// opts: { size?: number=14, color?: string, style?: object, ...rest }
//   size  → width + height, default 14
//   color → applied via style.color (cascades to currentColor)
//   style → merged on top of base inline-block flex-shrink:0
//   rest  → passed to <svg> (e.g. aria-label, onClick)
function makeIcon(viewBox, stroke, ...children) {
  return (props) => {
    const p = props || {};
    const size = p.size != null ? p.size : 14;
    const styleExt = p.style || {};
    const rest = {};
    for (const k of Object.keys(p)) {
      if (k !== 'size' && k !== 'style' && k !== 'color') rest[k] = p[k];
    }
    return h('svg', {
      width: size, height: size, viewBox,
      ...(stroke
        ? { fill: 'none', stroke: 'currentColor', strokeWidth: 2,
            strokeLinecap: 'round', strokeLinejoin: 'round' }
        : { fill: 'currentColor' }),
      style: {
        display: 'inline-block', verticalAlign: 'middle', flexShrink: 0,
        ...(p.color ? { color: p.color } : {}),
        ...styleExt
      },
      'aria-hidden': p['aria-label'] ? undefined : 'true',
      ...rest
    }, ...children);
  };
}

const ICONS = {
  // — smoke-test entries; populated incrementally by R4 Tasks 2-7 —
  search: makeIcon('0 0 24 24', true,
    h('circle', { cx: 11, cy: 11, r: 8 }),
    h('line', { x1: 21, y1: 21, x2: 16.65, y2: 16.65 })
  ),
  x: makeIcon('0 0 24 24', true,
    h('line', { x1: 18, y1: 6, x2: 6, y2: 18 }),
    h('line', { x1: 6, y1: 6, x2: 18, y2: 18 })
  ),
};

function icon(name, opts) {
  const factory = ICONS[name];
  return factory ? factory(opts) : null;
}
```

- [ ] **Step 3: Run SPA check.**

```bash
node scripts/check-dashboard-spa.cjs
```

Expected: `Dashboard SPA inner OK (<size> chars)` — size grows by ~1.5 kB.

- [ ] **Step 4: Commit.**

```bash
git add src/dashboard/server.js
git commit -m "feat(dashboard): r4 — icon helper foundation"
```

---

## Task 2: Brand SVGs (sources)

Replace Reddit/Twitter-X/Google/TikTok/X-Trends emoji glyphs with brand SVG icons. Update `SOURCE_ICONS` object + sidebar source rows + feed-card avatar render.

**Files:**
- Modify: `src/dashboard/server.js`

- [ ] **Step 1: Add 5 brand icons to `ICONS` registry.**

Find `const ICONS = {` (added in Task 1) and add these entries before the closing `};`:

```js
  // — Brand sources (5) — monochrome glyphs, currentColor —
  reddit: makeIcon('0 0 24 24', false,
    h('path', { d: 'M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 0 1 .042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 0 1 4.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 0 1 .14-.197.35.35 0 0 1 .238-.042l2.906.617a1.214 1.214 0 0 1 1.108-.701zM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 0-.688-.561-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.562-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 0 0-.231.094.33.33 0 0 0 0 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 0 0 .029-.463.33.33 0 0 0-.464 0c-.547.533-1.684.73-2.512.73-.828 0-1.979-.196-2.512-.73a.326.326 0 0 0-.232-.095z' })
  ),
  twitter: makeIcon('0 0 24 24', false,
    h('path', { d: 'M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z' })
  ),
  google: makeIcon('0 0 24 24', false,
    h('path', { d: 'M12.545 10.239v3.821h5.445c-.712 2.315-2.647 3.972-5.445 3.972a6.033 6.033 0 1 1 0-12.064c1.498 0 2.866.549 3.921 1.453l2.814-2.814A9.969 9.969 0 0 0 12.545 2C7.021 2 2.543 6.477 2.543 12s4.478 10 10.002 10c8.396 0 10.249-7.85 9.426-11.748l-9.426-.013z' })
  ),
  tiktok: makeIcon('0 0 24 24', false,
    h('path', { d: 'M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5.8 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1.84-.1z' })
  ),
  hash: makeIcon('0 0 24 24', true,
    h('line', { x1: 4, y1: 9, x2: 20, y2: 9 }),
    h('line', { x1: 4, y1: 15, x2: 20, y2: 15 }),
    h('line', { x1: 10, y1: 3, x2: 8, y2: 21 }),
    h('line', { x1: 16, y1: 3, x2: 14, y2: 21 })
  ),
```

- [ ] **Step 2: Locate `SOURCE_ICONS` object.**

```bash
grep -n "const SOURCE_ICONS" src/dashboard/server.js
```

(Expected: line ~7621.)

- [ ] **Step 3: Replace `SOURCE_ICONS` object value (icon-key strings, not emoji).**

Find the object definition (looks like):

```js
const SOURCE_ICONS = {
  reddit: '🟠', twitter: '𝕏', google_trends: 'G', tiktok: '♪', x_trends: '#'
};
```

Replace with:

```js
// 2026-05-20 R4 — emoji glyphs → icon-name keys. Consumers must call
// icon(SOURCE_ICONS[srcKey], { size }) instead of rendering the string.
const SOURCE_ICONS = {
  reddit:        'reddit',
  twitter:       'twitter',
  google_trends: 'google',
  tiktok:        'tiktok',
  x_trends:      'hash',
};
```

- [ ] **Step 4: Find consumers of `SOURCE_ICONS`.**

```bash
grep -n "SOURCE_ICONS\[" src/dashboard/server.js
```

For every match, the render expression looks like one of:

- `SOURCE_ICONS[src]` (just the string) — must become `icon(SOURCE_ICONS[src], { size: 14 })`
- A JSX child like `h('span', null, SOURCE_ICONS[src])` — same wrap

Edit each callsite so the string is passed through `icon()`. Wrap the result in a containing `<span>` if needed for layout.

- [ ] **Step 5: Locate sidebar source rows.**

```bash
grep -n "sb-source-icon\|sb-source-row" src/dashboard/server.js
```

Find the JSX rendering pattern. The current pattern uses inline emoji literal or `SOURCE_ICONS[...]`. Change the icon-rendering call to:

```js
h('span', { className: 'sb-source-icon' },
  icon(SOURCE_ICONS[src.key] || 'hash', { size: 14 })
)
```

- [ ] **Step 6: Locate `.feed-avatar` content rendering.**

```bash
grep -n "feed-avatar" src/dashboard/server.js | head -20
```

Find the JSX where source emoji is rendered inside the avatar (look for `feed-avatar` className + emoji-string child). Replace:

```js
// Before (example):
h('div', { className: 'feed-avatar ' + sourceKey },
  SOURCE_ICONS[sourceKey] || '?'
)

// After:
h('div', { className: 'feed-avatar ' + sourceKey },
  icon(SOURCE_ICONS[sourceKey] || 'hash', { size: 20 })
)
```

(Avatar size 20 — bigger than sidebar 14 because avatars are 36×36 squares.)

- [ ] **Step 7: SPA check.**

```bash
node scripts/check-dashboard-spa.cjs
```

- [ ] **Step 8: Visual sanity check — grep remaining `🟠`/`𝕏`/`♪` literals.**

```bash
grep -n "'🟠'\|'𝕏'\|'♪'" src/dashboard/server.js
```

Should return zero. If non-empty, replace remaining sites manually.

- [ ] **Step 9: Commit.**

```bash
git add src/dashboard/server.js
git commit -m "feat(dashboard): r4 — brand SVG sources"
```

---

## Task 3: Bottom-nav + sidebar phase chips + filter chips

Replace bottom-nav icons (Feed/Saved/Analyze), restructure `PHASE_META` to use `color` instead of `icon`, add CSS `phase-dot`, restructure type chips (EVENT/TREND/POST), category dropdown (CAT_ICONS).

**Files:**
- Modify: `src/dashboard/server.js`

- [ ] **Step 1: Add Lucide icons used in this task to `ICONS` registry.**

Open `https://lucide.dev/icons/` and copy SVG body content for each. Add these entries to `ICONS = { ... }` before the closing brace (alphabetised within each block is fine):

```js
  // — Bottom-nav (Feed = flame, Saved = star, Analyze = search) —
  flame: makeIcon('0 0 24 24', true,
    h('path', { d: 'M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z' })
  ),
  star: makeIcon('0 0 24 24', true,
    h('polygon', { points: '12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2' })
  ),
  // (search added in Task 1)

  // — Alert-type chips —
  newspaper: makeIcon('0 0 24 24', true,
    h('path', { d: 'M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2' }),
    h('path', { d: 'M18 14h-8' }),
    h('path', { d: 'M15 18h-5' }),
    h('path', { d: 'M10 6h8v4h-8V6Z' })
  ),
  'circle-dot': makeIcon('0 0 24 24', true,
    h('circle', { cx: 12, cy: 12, r: 10 }),
    h('circle', { cx: 12, cy: 12, r: 1 })
  ),
  check: makeIcon('0 0 24 24', true,
    h('polyline', { points: '20 6 9 17 4 12' })
  ),
  // (trend — Phosphor, added below as it has its own viewBox)

  // — Phosphor exception: trend (line-chart-with-peak) —
  trend: makeIcon('0 0 256 256', false,
    h('path', { d: 'M232 208a8 8 0 0 1-8 8H32a8 8 0 0 1-8-8V48a8 8 0 0 1 16 0v94.37l50.34-50.35a8 8 0 0 1 11.32 0L128 116.69l50.34-50.35a8 8 0 0 1 11.32 11.32l-56 56a8 8 0 0 1-11.32 0L96 107.31l-56 56V200h184a8 8 0 0 1 8 8Z' })
  ),

  // — Category content tags (CAT_ICONS) —
  image: makeIcon('0 0 24 24', true,
    h('rect', { x: 3, y: 3, width: 18, height: 18, rx: 2, ry: 2 }),
    h('circle', { cx: 8.5, cy: 8.5, r: 1.5 }),
    h('polyline', { points: '21 15 16 10 5 21' })
  ),
  'paw-print': makeIcon('0 0 24 24', true,
    h('circle', { cx: 11, cy: 4, r: 2 }),
    h('circle', { cx: 18, cy: 8, r: 2 }),
    h('circle', { cx: 20, cy: 16, r: 2 }),
    h('path', { d: 'M9 10a5 5 0 0 1 5 5v3.5a3.5 3.5 0 0 1-6.84 1.045Q6.52 17.48 4.46 16.84A3.5 3.5 0 0 1 5.5 10Z' })
  ),
  cpu: makeIcon('0 0 24 24', true,
    h('rect', { x: 4, y: 4, width: 16, height: 16, rx: 2 }),
    h('rect', { x: 9, y: 9, width: 6, height: 6 }),
    h('line', { x1: 9, y1: 2, x2: 9, y2: 4 }),
    h('line', { x1: 15, y1: 2, x2: 15, y2: 4 }),
    h('line', { x1: 9, y1: 20, x2: 9, y2: 22 }),
    h('line', { x1: 15, y1: 20, x2: 15, y2: 22 }),
    h('line', { x1: 20, y1: 9, x2: 22, y2: 9 }),
    h('line', { x1: 20, y1: 14, x2: 22, y2: 14 }),
    h('line', { x1: 2, y1: 9, x2: 4, y2: 9 }),
    h('line', { x1: 2, y1: 14, x2: 4, y2: 14 })
  ),
  coins: makeIcon('0 0 24 24', true,
    h('circle', { cx: 8, cy: 8, r: 6 }),
    h('path', { d: 'M18.09 10.37A6 6 0 1 1 10.34 18' }),
    h('path', { d: 'M7 6h1v4' }),
    h('path', { d: 'm16.71 13.88.7.71-2.82 2.82' })
  ),
  landmark: makeIcon('0 0 24 24', true,
    h('line', { x1: 3, y1: 22, x2: 21, y2: 22 }),
    h('line', { x1: 6, y1: 18, x2: 6, y2: 11 }),
    h('line', { x1: 10, y1: 18, x2: 10, y2: 11 }),
    h('line', { x1: 14, y1: 18, x2: 14, y2: 11 }),
    h('line', { x1: 18, y1: 18, x2: 18, y2: 11 }),
    h('polygon', { points: '12 2 20 7 4 7' })
  ),
  clapperboard: makeIcon('0 0 24 24', true,
    h('path', { d: 'M20.2 6 3 11l-.9-2.4c-.3-1.1.3-2.2 1.3-2.5l13.5-4c1.1-.3 2.2.3 2.5 1.3Z' }),
    h('path', { d: 'm6.2 5.3 3.1 3.9' }),
    h('path', { d: 'm12.4 3.4 3.1 4' }),
    h('path', { d: 'M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z' })
  ),
  'gamepad-2': makeIcon('0 0 24 24', true,
    h('line', { x1: 6, y1: 11, x2: 10, y2: 11 }),
    h('line', { x1: 8, y1: 9, x2: 8, y2: 13 }),
    h('line', { x1: 15, y1: 12, x2: 15.01, y2: 12 }),
    h('line', { x1: 18, y1: 10, x2: 18.01, y2: 10 }),
    h('path', { d: 'M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.545-.604-6.584-.685-7.258A4 4 0 0 0 17.32 5z' })
  ),
  trophy: makeIcon('0 0 24 24', true,
    h('path', { d: 'M6 9H4.5a2.5 2.5 0 0 1 0-5H6' }),
    h('path', { d: 'M18 9h1.5a2.5 2.5 0 0 0 0-5H18' }),
    h('path', { d: 'M4 22h16' }),
    h('path', { d: 'M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22' }),
    h('path', { d: 'M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22' }),
    h('path', { d: 'M18 2H6v7a6 6 0 0 0 12 0V2Z' })
  ),
  moon: makeIcon('0 0 24 24', true,
    h('path', { d: 'M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z' })
  ),
  'more-horizontal': makeIcon('0 0 24 24', true,
    h('circle', { cx: 12, cy: 12, r: 1 }),
    h('circle', { cx: 19, cy: 12, r: 1 }),
    h('circle', { cx: 5, cy: 12, r: 1 })
  ),

  // — Sort + filter UI —
  tag: makeIcon('0 0 24 24', true,
    h('path', { d: 'M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z' }),
    h('line', { x1: 7, y1: 7, x2: 7.01, y2: 7 })
  ),
  'arrow-up-down': makeIcon('0 0 24 24', true,
    h('path', { d: 'm21 16-4 4-4-4' }),
    h('path', { d: 'M17 20V4' }),
    h('path', { d: 'm3 8 4-4 4 4' }),
    h('path', { d: 'M7 4v16' })
  ),
```

- [ ] **Step 2: Add CSS for `phase-dot` (CSS-only colored circle).**

Grep for `.phase-chip` to find existing chip CSS:

```bash
grep -n "\.phase-chip" src/dashboard/server.js | head -5
```

In the same CSS area, add:

```css
    /* 2026-05-20 R4 — phase-dot: small colored circle prepended inside phase chip.
       Color comes from inline style set to PHASE_META[p].color. STRONG dot
       gets a soft glow to read as "active". */
    .phase-dot {
      width: 5px; height: 5px; border-radius: 50%;
      display: inline-block; flex-shrink: 0;
      background: currentColor;
    }
    .phase-chip-strong .phase-dot,
    .phase-chip.strong .phase-dot { box-shadow: 0 0 5px var(--accent); }
```

- [ ] **Step 3: Restructure `PHASE_META` — replace `icon` field with `color`.**

```bash
grep -n "const PHASE_META" src/dashboard/server.js
```

Find the existing definition (around line ~7683):

```js
const PHASE_META = {
  strong:    { icon: '🔥', label: 'Strong',    /* ...other fields... */ },
  forming:   { icon: '🌊', label: 'Forming',   /* ... */ },
  early:     { icon: '🌱', label: 'Early',     /* ... */ },
  saturated: { icon: '🍂', label: 'Saturated', /* ... */ },
};
```

Replace the `icon: '<emoji>'` field on each entry with `color: '<CSS var>'`. Keep all other fields as-is. Result:

```js
const PHASE_META = {
  strong:    { color: 'var(--accent)', label: 'Strong',    /* ...rest unchanged... */ },
  forming:   { color: 'var(--text2)',  label: 'Forming',   /* ... */ },
  early:     { color: 'var(--muted)',  label: 'Early',     /* ... */ },
  saturated: { color: 'var(--warn)',   label: 'Saturated', /* ... */ },
};
```

- [ ] **Step 4: Find PHASE_META.icon consumers.**

```bash
grep -nE "PHASE_META\[\w+\]\.icon|PHASE_META\.\w+\.icon|phaseMeta\.icon" src/dashboard/server.js
```

For every match, replace the icon expression with a `phase-dot` span. Pattern:

```js
// Before:
h('span', { className: 'phase-chip ' + phase },
  PHASE_META[phase].icon, ' ', PHASE_META[phase].label.toUpperCase()
)

// After:
h('span', {
    className: 'phase-chip ' + phase,
    style: { color: PHASE_META[phase].color }
  },
  h('span', { className: 'phase-dot' }),
  PHASE_META[phase].label.toUpperCase()
)
```

(The `color` inline style cascades to `.phase-dot` via `background: currentColor`.)

- [ ] **Step 5: Restructure `CAT_ICONS` — emoji → Lucide-key strings.**

```bash
grep -n "const CAT_ICONS" src/dashboard/server.js
```

Replace existing object:

```js
// 2026-05-20 R4 — emoji glyphs → Lucide icon-name keys. Render via
// icon(CAT_ICONS[cat], { size }).
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
  other:         'more-horizontal',
};
```

- [ ] **Step 6: Find CAT_ICONS consumers and wrap with `icon()`.**

```bash
grep -n "CAT_ICONS\[" src/dashboard/server.js
```

Every match should now pass through `icon()`. Example transform:

```js
// Before:
h('span', { className: 'cat-icon' }, CAT_ICONS[cat] || '📌')

// After:
h('span', { className: 'cat-icon' },
  icon(CAT_ICONS[cat] || 'more-horizontal', { size: 12 })
)
```

- [ ] **Step 7: Replace bottom-nav button content (sidebar footer Feed/Saved/Analyze).**

Grep `sb-foot-btn` to find the bottom-nav JSX. The current emoji are `🔥` (Feed), `⭐` (Saved), and a search emoji (Analyze). Replace each `h('span', { className: 'sb-foot-ico' }, '<emoji>')` with:

```js
// Feed tab:
h('span', { className: 'sb-foot-ico' }, icon('flame', { size: 16 }))

// Saved tab:
h('span', { className: 'sb-foot-ico' }, icon('star', { size: 16 }))

// Analyze tab:
h('span', { className: 'sb-foot-ico' }, icon('search', { size: 16 }))
```

- [ ] **Step 8: Replace type-chip emojis (EVENT/TREND/POST).**

Grep for `badge-atype-event`, `badge-atype-trend`, `badge-atype-post`. The render uses i18n strings — leave the i18n keys alone here (Task 8 handles those). For now, find the JSX render of the type chip and ensure it uses `icon(ICON_FOR_TYPE)`:

```js
// Before:
h('span', { className: 'badge-atype-' + atype },
  TYPE_EMOJI[atype], ' ', t('badge.alert_type.' + atype)
)

// After:
const TYPE_ICON = { event: 'newspaper', trend: 'trend', post: 'circle-dot', saved: 'check' };
h('span', { className: 'badge-atype-' + atype },
  icon(TYPE_ICON[atype], { size: 11 }), ' ', t('badge.alert_type.' + atype)
)
```

Add `const TYPE_ICON = { ... }` near the existing `TYPE_EMOJI` definition (grep `TYPE_EMOJI` to find it). Leave `TYPE_EMOJI` in place for now — Task 8 removes the dead constant.

- [ ] **Step 9: SPA check.**

```bash
node scripts/check-dashboard-spa.cjs
```

- [ ] **Step 10: Commit.**

```bash
git add src/dashboard/server.js
git commit -m "feat(dashboard): r4 — bottom-nav + sidebar phase chips + filters"
```

---

## Task 4: Feed card chips/metrics/actions

Replace STRONG/EVENT/POSITIVE chips (via PHASE_META + TYPE_ICON), metrics row icons, action buttons.

**Files:**
- Modify: `src/dashboard/server.js`

- [ ] **Step 1: Add metric + action icons to `ICONS` registry.**

Append to `ICONS = { ... }`:

```js
  // — Feed-card metrics —
  heart: makeIcon('0 0 24 24', true,
    h('path', { d: 'M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.29 1.51 4.04 3 5.5l7 7Z' })
  ),
  'message-circle': makeIcon('0 0 24 24', true,
    h('path', { d: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z' })
  ),
  'repeat-2': makeIcon('0 0 24 24', true,
    h('path', { d: 'm2 9 3-3 3 3' }),
    h('path', { d: 'M13 18H7a2 2 0 0 1-2-2V6' }),
    h('path', { d: 'm22 15-3 3-3-3' }),
    h('path', { d: 'M11 6h6a2 2 0 0 1 2 2v10' })
  ),
  eye: makeIcon('0 0 24 24', true,
    h('path', { d: 'M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z' }),
    h('circle', { cx: 12, cy: 12, r: 3 })
  ),
  'eye-off': makeIcon('0 0 24 24', true,
    h('path', { d: 'M9.88 9.88a3 3 0 1 0 4.24 4.24' }),
    h('path', { d: 'M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68' }),
    h('path', { d: 'M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61' }),
    h('line', { x1: 2, y1: 2, x2: 22, y2: 22 })
  ),
  'arrow-up': makeIcon('0 0 24 24', true,
    h('line', { x1: 12, y1: 19, x2: 12, y2: 5 }),
    h('polyline', { points: '5 12 12 5 19 12' })
  ),
  award: makeIcon('0 0 24 24', true,
    h('circle', { cx: 12, cy: 8, r: 6 }),
    h('polyline', { points: '8.21 13.89 7 22 12 19 17 22 15.79 13.88' })
  ),

  // — Feed-card actions —
  'external-link': makeIcon('0 0 24 24', true,
    h('path', { d: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6' }),
    h('polyline', { points: '15 3 21 3 21 9' }),
    h('line', { x1: 10, y1: 14, x2: 21, y2: 3 })
  ),
  send: makeIcon('0 0 24 24', true,
    h('path', { d: 'M22 2 11 13' }),
    h('polygon', { points: '22 2 15 22 11 13 2 9 22 2' })
  ),
  link: makeIcon('0 0 24 24', true,
    h('path', { d: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71' }),
    h('path', { d: 'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71' })
  ),
  pencil: makeIcon('0 0 24 24', true,
    h('path', { d: 'M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z' })
  ),
```

- [ ] **Step 2: Locate feed-card chip rendering.**

```bash
grep -n "feed-card.*phase\|PhaseBadge" src/dashboard/server.js | head -10
```

Find the JSX that renders the STRONG/EVENT/POSITIVE chip row. Update it to use the phase-dot + label pattern (already added to PHASE_META in Task 3 — verify rendering picks up new shape).

- [ ] **Step 3: Locate metrics row (likes/comments/repeats/views).**

```bash
grep -nE "feed-met|metric-row|score-met|tw-prev" src/dashboard/server.js | head -10
```

Find the JSX rendering the metrics row. The current pattern uses emoji literal:

```js
h('span', { className: 'feed-met' }, '❤️ ', likes)
```

Replace with:

```js
h('span', { className: 'feed-met' }, icon('heart', { size: 13 }), ' ', likes)
```

Do the same for `💬` → `message-circle`, `🔁` → `repeat-2`, `👁` → `eye`, `⬆️` → `arrow-up` (Reddit upvotes), `🏅` → `award`.

- [ ] **Step 4: Locate action buttons row (Details/Open/Send TG/Save).**

```bash
grep -n "feed-action-btn\|feed-actions" src/dashboard/server.js | head -10
```

Find the JSX rendering each action button. Replace inline emoji:

```js
// Details button:
h('button', { className: 'feed-action-btn primary' },
  icon('star', { size: 12 }), ' Details'
)

// Open in X / source:
h('a', { className: 'feed-action-btn', href: url },
  icon('external-link', { size: 12 }), ' Open'
)

// Send TG:
h('button', { className: 'feed-action-btn tg' },
  icon('send', { size: 12 }), ' Send'
)

// Save (favourite):
h('button', { className: 'feed-action-btn fav' },
  icon('star', { size: 12, style: isFav ? { fill: 'currentColor' } : {} }), ' Save'
)

// Close / hide:
h('button', { className: 'feed-action-btn close', 'aria-label': 'close' },
  icon('x', { size: 12 })
)
```

- [ ] **Step 5: SPA check.**

```bash
node scripts/check-dashboard-spa.cjs
```

- [ ] **Step 6: Grep verify — feed-card emoji should be gone (besides i18n).**

```bash
grep -nE "feed-card.*[\u{1F300}-\u{1F9FF}\u{2600}-\u{27BF}]" src/dashboard/server.js
```

Should return only matches inside translation strings (handled by Task 8). Other matches → fix now.

- [ ] **Step 7: Commit.**

```bash
git add src/dashboard/server.js
git commit -m "feat(dashboard): r4 — feed card chips + metrics + actions"
```

---

## Task 5: Settings + Account panel

Replace ~15 settings UI emoji with SVG. Language flags 🇺🇸/🇷🇺 → 2-letter "EN"/"RU" text.

**Files:**
- Modify: `src/dashboard/server.js`

- [ ] **Step 1: Add settings-area icons to `ICONS` registry.**

Append:

```js
  // — Settings + account —
  // (settings — Phosphor exception)
  settings: makeIcon('0 0 256 256', false,
    h('path', { d: 'M128 80a48 48 0 1 0 48 48 48 48 0 0 0-48-48Zm0 80a32 32 0 1 1 32-32 32 32 0 0 1-32 32Zm88-29.84q.06-2.16 0-4.32l14.92-18.64a8 8 0 0 0 1.48-7.06 107.21 107.21 0 0 0-10.88-26.25 8 8 0 0 0-6-3.93l-23.72-2.64q-1.48-1.56-3-3L186 40.54a8 8 0 0 0-3.94-6 107.71 107.71 0 0 0-26.25-10.87 8 8 0 0 0-7.06 1.49L130.16 40Q128 40 125.84 40L107.2 25.11a8 8 0 0 0-7.06-1.48 107.6 107.6 0 0 0-26.25 10.88 8 8 0 0 0-3.93 6l-2.64 23.76q-1.56 1.49-3 3L40.54 70a8 8 0 0 0-6 3.94 107.71 107.71 0 0 0-10.87 26.25 8 8 0 0 0 1.49 7.06L40 125.84Q40 128 40 130.16L25.11 148.8a8 8 0 0 0-1.48 7.06 107.21 107.21 0 0 0 10.88 26.25 8 8 0 0 0 6 3.93l23.72 2.64q1.49 1.56 3 3L70 215.46a8 8 0 0 0 3.94 6 107.71 107.71 0 0 0 26.25 10.87 8 8 0 0 0 7.06-1.49L125.84 216q2.16.06 4.32 0l18.64 14.92a8 8 0 0 0 7.06 1.48 107.21 107.21 0 0 0 26.25-10.88 8 8 0 0 0 3.93-6l2.64-23.72q1.56-1.48 3-3L215.46 186a8 8 0 0 0 6-3.94 107.71 107.71 0 0 0 10.87-26.25 8 8 0 0 0-1.49-7.06Zm-16.1-6.5a73.93 73.93 0 0 1 0 8.68 8 8 0 0 0 1.74 5.48l14.19 17.73a91.57 91.57 0 0 1-6.23 15L187 173.11a8 8 0 0 0-5.1 2.64 74.11 74.11 0 0 1-6.14 6.14 8 8 0 0 0-2.64 5.1l-2.51 22.58a91.32 91.32 0 0 1-15 6.23l-17.74-14.19a8 8 0 0 0-5-1.75h-.48a73.93 73.93 0 0 1-8.68 0 8 8 0 0 0-5.48 1.74l-17.78 14.2a91.57 91.57 0 0 1-15-6.23L82.89 187a8 8 0 0 0-2.64-5.1 74.11 74.11 0 0 1-6.14-6.14 8 8 0 0 0-5.1-2.64l-22.58-2.51a91.32 91.32 0 0 1-6.23-15l14.19-17.74a8 8 0 0 0 1.74-5.48 73.93 73.93 0 0 1 0-8.68 8 8 0 0 0-1.74-5.48L40.2 100.45a91.57 91.57 0 0 1 6.23-15L69 82.89a8 8 0 0 0 5.1-2.64 74.11 74.11 0 0 1 6.14-6.14A8 8 0 0 0 82.89 69l2.51-22.58a91.32 91.32 0 0 1 15-6.23l17.74 14.19a8 8 0 0 0 5.48 1.74 73.93 73.93 0 0 1 8.68 0 8 8 0 0 0 5.48-1.74l17.77-14.19a91.57 91.57 0 0 1 15 6.23L173.11 69a8 8 0 0 0 2.64 5.1 74.11 74.11 0 0 1 6.14 6.14 8 8 0 0 0 5.1 2.64l22.58 2.51a91.32 91.32 0 0 1 6.23 15l-14.19 17.74a8 8 0 0 0-1.71 5.48Z' })
  ),
  palette: makeIcon('0 0 24 24', true,
    h('circle', { cx: 13.5, cy: 6.5, r: 0.5, fill: 'currentColor' }),
    h('circle', { cx: 17.5, cy: 10.5, r: 0.5, fill: 'currentColor' }),
    h('circle', { cx: 8.5, cy: 7.5, r: 0.5, fill: 'currentColor' }),
    h('circle', { cx: 6.5, cy: 12.5, r: 0.5, fill: 'currentColor' }),
    h('path', { d: 'M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z' })
  ),
  globe: makeIcon('0 0 24 24', true,
    h('circle', { cx: 12, cy: 12, r: 10 }),
    h('line', { x1: 2, y1: 12, x2: 22, y2: 12 }),
    h('path', { d: 'M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z' })
  ),
  user: makeIcon('0 0 24 24', true,
    h('path', { d: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2' }),
    h('circle', { cx: 12, cy: 7, r: 4 })
  ),
  'refresh-ccw': makeIcon('0 0 24 24', true,
    h('path', { d: 'M3 12a9 9 0 0 1 15-6.7L21 8' }),
    h('path', { d: 'M21 3v5h-5' }),
    h('path', { d: 'M21 12a9 9 0 0 1-15 6.7L3 16' }),
    h('path', { d: 'M8 16H3v5' })
  ),
  archive: makeIcon('0 0 24 24', true,
    h('rect', { x: 2, y: 4, width: 20, height: 5, rx: 2 }),
    h('path', { d: 'M4 9v9a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9' }),
    h('line', { x1: 10, y1: 13, x2: 14, y2: 13 })
  ),
  'radio-tower': makeIcon('0 0 24 24', true,
    h('path', { d: 'M4.9 16.1C1 12.2 1 5.8 4.9 1.9' }),
    h('path', { d: 'M7.8 4.7a6.14 6.14 0 0 0-.8 7.5' }),
    h('circle', { cx: 12, cy: 9, r: 2 }),
    h('path', { d: 'M16.2 4.8c2 2 2.26 5.11.8 7.47' }),
    h('path', { d: 'M19.1 1.9a9.96 9.96 0 0 1 0 14.1' }),
    h('path', { d: 'M9.5 18h5l3 4h-11Z' })
  ),
  bell: makeIcon('0 0 24 24', true,
    h('path', { d: 'M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9' }),
    h('path', { d: 'M10.3 21a1.94 1.94 0 0 0 3.4 0' })
  ),
  sparkles: makeIcon('0 0 24 24', true,
    h('path', { d: 'm12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3L12 3Z' }),
    h('path', { d: 'M5 3v4' }),
    h('path', { d: 'M19 17v4' }),
    h('path', { d: 'M3 5h4' }),
    h('path', { d: 'M17 19h4' })
  ),
  rows: makeIcon('0 0 24 24', true,
    h('rect', { x: 3, y: 3, width: 18, height: 18, rx: 2 }),
    h('line', { x1: 3, y1: 9, x2: 21, y2: 9 }),
    h('line', { x1: 3, y1: 15, x2: 21, y2: 15 })
  ),
  'log-out': makeIcon('0 0 24 24', true,
    h('path', { d: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4' }),
    h('polyline', { points: '16 17 21 12 16 7' }),
    h('line', { x1: 21, y1: 12, x2: 9, y2: 12 })
  ),
  activity: makeIcon('0 0 24 24', true,
    h('polyline', { points: '22 12 18 12 15 21 9 3 6 12 2 12' })
  ),
  gem: makeIcon('0 0 24 24', true,
    h('path', { d: 'M6 3h12l4 6-10 13L2 9Z' }),
    h('path', { d: 'M11 3 8 9l4 13 4-13-3-6' }),
    h('path', { d: 'M2 9h20' })
  ),
  bot: makeIcon('0 0 24 24', true,
    h('rect', { x: 3, y: 11, width: 18, height: 10, rx: 2 }),
    h('circle', { cx: 12, cy: 5, r: 2 }),
    h('path', { d: 'M12 7v4' }),
    h('line', { x1: 8, y1: 16, x2: 8, y2: 16 }),
    h('line', { x1: 16, y1: 16, x2: 16, y2: 16 })
  ),
  clock: makeIcon('0 0 24 24', true,
    h('circle', { cx: 12, cy: 12, r: 10 }),
    h('polyline', { points: '12 6 12 12 16 14' })
  ),
  'bar-chart-3': makeIcon('0 0 24 24', true,
    h('path', { d: 'M3 3v18h18' }),
    h('path', { d: 'M18 17V9' }),
    h('path', { d: 'M13 17V5' }),
    h('path', { d: 'M8 17v-3' })
  ),
  zap: makeIcon('0 0 24 24', true,
    h('polygon', { points: '13 2 3 14 12 14 11 22 21 10 12 10 13 2' })
  ),
  calendar: makeIcon('0 0 24 24', true,
    h('rect', { x: 3, y: 4, width: 18, height: 18, rx: 2, ry: 2 }),
    h('line', { x1: 16, y1: 2, x2: 16, y2: 6 }),
    h('line', { x1: 8, y1: 2, x2: 8, y2: 6 }),
    h('line', { x1: 3, y1: 10, x2: 21, y2: 10 })
  ),
  'calendar-days': makeIcon('0 0 24 24', true,
    h('rect', { x: 3, y: 4, width: 18, height: 18, rx: 2, ry: 2 }),
    h('line', { x1: 16, y1: 2, x2: 16, y2: 6 }),
    h('line', { x1: 8, y1: 2, x2: 8, y2: 6 }),
    h('line', { x1: 3, y1: 10, x2: 21, y2: 10 }),
    h('path', { d: 'M8 14h.01' }),
    h('path', { d: 'M12 14h.01' }),
    h('path', { d: 'M16 14h.01' }),
    h('path', { d: 'M8 18h.01' }),
    h('path', { d: 'M12 18h.01' }),
    h('path', { d: 'M16 18h.01' })
  ),
  'calendar-range': makeIcon('0 0 24 24', true,
    h('rect', { x: 3, y: 4, width: 18, height: 18, rx: 2, ry: 2 }),
    h('line', { x1: 16, y1: 2, x2: 16, y2: 6 }),
    h('line', { x1: 8, y1: 2, x2: 8, y2: 6 }),
    h('line', { x1: 3, y1: 10, x2: 21, y2: 10 }),
    h('path', { d: 'M17 14h-6' }),
    h('path', { d: 'M13 18H7' }),
    h('path', { d: 'M7 14h.01' }),
    h('path', { d: 'M17 18h.01' })
  ),
  lock: makeIcon('0 0 24 24', true,
    h('rect', { x: 3, y: 11, width: 18, height: 11, rx: 2 }),
    h('path', { d: 'M7 11V7a5 5 0 0 1 10 0v4' })
  ),
  'flask-conical': makeIcon('0 0 24 24', true,
    h('path', { d: 'M10 2v7.527a2 2 0 0 1-.211.896L4.72 20.55a1 1 0 0 0 .9 1.45h12.76a1 1 0 0 0 .9-1.45l-5.069-10.127A2 2 0 0 1 14 9.527V2' }),
    h('path', { d: 'M8.5 2h7' }),
    h('path', { d: 'M7 16h10' })
  ),
  brain: makeIcon('0 0 24 24', true,
    h('path', { d: 'M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.98-3A2.5 2.5 0 0 1 9.5 2Z' }),
    h('path', { d: 'M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.98-3A2.5 2.5 0 0 0 14.5 2Z' })
  ),
  target: makeIcon('0 0 24 24', true,
    h('circle', { cx: 12, cy: 12, r: 10 }),
    h('circle', { cx: 12, cy: 12, r: 6 }),
    h('circle', { cx: 12, cy: 12, r: 2 })
  ),
```

- [ ] **Step 2: Find Settings panel rendering.**

```bash
grep -n "settings-row\|SettingsPanel\|sheet-settings" src/dashboard/server.js | head -10
```

For every setting row that renders an inline emoji prefix, replace the emoji with `icon(...)`. Apply the mapping from spec section 5.8:

```js
'⚙️' → icon('settings', { size: 14 })
'🎨' → icon('palette', { size: 14 })
'🌐' → icon('globe', { size: 14 })
'👤' → icon('user', { size: 14 })
'🔄' → icon('refresh-ccw', { size: 14 })
'📦' → icon('archive', { size: 14 })
'📡' → icon('radio-tower', { size: 14 })
'🔔' → icon('bell', { size: 14 })
'🖼️' → icon('image', { size: 14 })
'✨' → icon('sparkles', { size: 14 })
'📐' → icon('rows', { size: 14 })
'👁' → icon('eye-off', { size: 14 })  // hidden
'🚪' → icon('log-out', { size: 14 })
'🏥' → icon('activity', { size: 14 })
'💎' → icon('gem', { size: 14 })
'🤖' → icon('bot', { size: 14 })
'🕐' → icon('clock', { size: 14 })
'📊' → icon('bar-chart-3', { size: 14 })
'🔒' → icon('lock', { size: 14 })
'🧪' → icon('flask-conical', { size: 14 })
'🧠' → icon('brain', { size: 14 })
'🎯' → icon('target', { size: 14 })
```

- [ ] **Step 3: Replace language flags (🇺🇸/🇷🇺) with 2-letter monospace text.**

```bash
grep -n "🇺🇸\|🇷🇺" src/dashboard/server.js
```

For every match in language picker / settings:

```js
// Before:
h('span', null, '🇺🇸 English')

// After:
h('span', { style: { fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, marginRight: 6, color: 'var(--muted)' } }, 'EN'),
h('span', null, ' English')
```

(2-letter code in muted color, label in normal text.)

For the language dropdown options:

```js
const LANGS = [
  { key: 'en', code: 'EN', name: 'English' },
  { key: 'ru', code: 'RU', name: 'Русский' },
];
// Render each:
h('span', null,
  h('span', { className: 'lang-code' }, lang.code), ' ', lang.name)
```

Add CSS for `.lang-code`:

```css
    .lang-code {
      font-family: 'JetBrains Mono', monospace; font-weight: 700;
      font-size: 11px; color: var(--muted);
      padding: 1px 4px; border-radius: 2px;
      background: rgba(255,255,255,.05);
    }
```

- [ ] **Step 4: SPA check.**

```bash
node scripts/check-dashboard-spa.cjs
```

- [ ] **Step 5: Grep verify — settings emoji should be gone.**

```bash
grep -nE "⚙️|🎨|🌐|👤|🔄|📦|📡|🔔|🖼️|✨|📐|🚪|🏥|💎|🤖|🧪|🧠|🎯|🇺🇸|🇷🇺" src/dashboard/server.js
```

Matches outside i18n strings → fix. Matches in i18n → Task 8 will handle.

- [ ] **Step 6: Commit.**

```bash
git add src/dashboard/server.js
git commit -m "feat(dashboard): r4 — settings + account icons"
```

---

## Task 6: Analyze panel + TrendModal

Replace verdict, sentiment, market stage, lifespan icons. Sentiment becomes text-only with color.

**Files:**
- Modify: `src/dashboard/server.js`

- [ ] **Step 1: Add Analyze-panel-specific icons.**

Append to `ICONS`:

```js
  // — Analyze panel + modal —
  'alert-triangle': makeIcon('0 0 24 24', true,
    h('path', { d: 'M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z' }),
    h('line', { x1: 12, y1: 9, x2: 12, y2: 13 }),
    h('line', { x1: 12, y1: 17, x2: 12.01, y2: 17 })
  ),
  ban: makeIcon('0 0 24 24', true,
    h('circle', { cx: 12, cy: 12, r: 10 }),
    h('line', { x1: 4.93, y1: 4.93, x2: 19.07, y2: 19.07 })
  ),
  'x-circle': makeIcon('0 0 24 24', true,
    h('circle', { cx: 12, cy: 12, r: 10 }),
    h('line', { x1: 15, y1: 9, x2: 9, y2: 15 }),
    h('line', { x1: 9, y1: 9, x2: 15, y2: 15 })
  ),
  'line-chart': makeIcon('0 0 24 24', true,
    h('path', { d: 'M3 3v18h18' }),
    h('path', { d: 'm19 9-5 5-4-4-3 3' })
  ),
  'thumbs-up': makeIcon('0 0 24 24', true,
    h('path', { d: 'M7 10v12' }),
    h('path', { d: 'M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H7a3 3 0 0 1-3-3V10.5a2.5 2.5 0 0 1 .74-1.77L13.5 1l.99.99c.32.32.41.83.21 1.25L13 5.88V6' })
  ),
  'thumbs-down': makeIcon('0 0 24 24', true,
    h('path', { d: 'M17 14V2' }),
    h('path', { d: 'M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H17a3 3 0 0 1 3 3v8.5a2.5 2.5 0 0 1-.74 1.77L10.5 23l-.99-.99c-.32-.32-.41-.83-.21-1.25L11 18.12V18' })
  ),
  'clipboard-check': makeIcon('0 0 24 24', true,
    h('rect', { x: 8, y: 2, width: 8, height: 4, rx: 1, ry: 1 }),
    h('path', { d: 'M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2' }),
    h('path', { d: 'm9 14 2 2 4-4' })
  ),
  inbox: makeIcon('0 0 24 24', true,
    h('polyline', { points: '22 12 16 12 14 15 10 15 8 12 2 12' }),
    h('path', { d: 'M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z' })
  ),
  'search-x': makeIcon('0 0 24 24', true,
    h('path', { d: 'm13.5 8.5-5 5' }),
    h('path', { d: 'm8.5 8.5 5 5' }),
    h('circle', { cx: 11, cy: 11, r: 8 }),
    h('path', { d: 'm21 21-4.3-4.3' })
  ),
```

- [ ] **Step 2: Sentiment — text-only with semantic color.**

Grep for sentiment rendering:

```bash
grep -nE "sentiment|😊|😠|😐" src/dashboard/server.js | head -10
```

Add a new constant near the existing sentiment helpers:

```js
// 2026-05-20 R4 — sentiment: pure text + semantic color, no glyph.
// Color carries direction signal (green up / red down / muted flat).
const SENTIMENT_COLOR = {
  positive: 'var(--accent)',
  negative: 'var(--red2)',
  neutral:  'var(--muted)',
};
const SENTIMENT_LABEL = {
  positive: 'POSITIVE',
  negative: 'NEGATIVE',
  neutral:  'NEUTRAL',
};
```

Update render sites — every `😊 Positive` / `😠 Negative` / `😐 Neutral` pattern becomes:

```js
h('span', {
    className: 'sentiment-chip sentiment-' + sent,
    style: { color: SENTIMENT_COLOR[sent] }
  },
  SENTIMENT_LABEL[sent]
)
```

Add CSS for the chip (if not already similar):

```css
    .sentiment-chip {
      display: inline-flex; align-items: center;
      padding: 2px 8px; border-radius: 2px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 10px; font-weight: 700; letter-spacing: .4px;
      background: rgba(255,255,255,.04);
      border: 1px solid currentColor;
      /* color is inline-set from SENTIMENT_COLOR */
    }
```

- [ ] **Step 3: Market stage — dot + text + spinner for tokenizing.**

Grep for market stage:

```bash
grep -nE "MARKET_STAGE|market-stage|🟢.*live\|🔴.*over\|🔄.*token" src/dashboard/server.js | head -10
```

Add CSS for spinner (if not already present):

```css
    .market-spinner {
      width: 8px; height: 8px;
      border: 1.5px solid rgba(245,158,11,.25);
      border-top-color: var(--warn);
      border-radius: 50%;
      animation: market-spin .9s linear infinite;
      flex-shrink: 0; display: inline-block;
    }
    @keyframes market-spin { to { transform: rotate(360deg); } }
    .market-dot {
      width: 6px; height: 6px; border-radius: 50%;
      display: inline-block; flex-shrink: 0;
      background: currentColor;
    }
    .market-dot.pulse { animation: market-pulse 2.4s ease-in-out infinite; }
    @keyframes market-pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50%      { opacity: .55; transform: scale(.85); }
    }
```

Restructure MARKET_STAGE consumers (look for emoji in render). Pattern:

```js
// Before:
h('span', { className: 'market-stage' }, '🟢 LIVE')

// After:
h('span', { className: 'market-stage live', style: { color: 'var(--accent)' } },
  h('span', { className: 'market-dot pulse' }),
  ' LIVE'
)

// Tokenizing:
h('span', { className: 'market-stage tokenizing', style: { color: 'var(--warn)' } },
  h('span', { className: 'market-spinner' }),
  ' TOKENIZING'
)

// Overheated:
h('span', { className: 'market-stage overheated', style: { color: 'var(--red2)' } },
  h('span', { className: 'market-dot' }),
  ' OVERHEATED'
)
```

- [ ] **Step 4: Replace verdict + lifespan + ask-grok + thumbs feedback.**

For each emoji in analyze-panel / modal area, apply the mapping (lifespan ⚡/📅/🗓/📆 → zap/calendar/calendar-days/calendar-range; 🧠 → brain; 👍/👎 → thumbs-up/thumbs-down):

```js
// Verdict high — keep accent border-left, replace 🔥 prefix:
h('div', { className: 'analyze-verdict high' },
  icon('flame', { size: 14, color: 'var(--accent)' }), ' Strong narrative'
)

// Lifespan flash (1h):
h('span', null, icon('zap', { size: 12 }), ' 1h')

// Ask Grok button:
h('button', { className: 'btn ask-grok' },
  icon('brain', { size: 14 }), ' Ask Grok'
)

// Thumbs feedback:
h('button', { className: 'feedback-btn up' }, icon('thumbs-up', { size: 12 }))
h('button', { className: 'feedback-btn down' }, icon('thumbs-down', { size: 12 }))
```

- [ ] **Step 5: SPA check.**

```bash
node scripts/check-dashboard-spa.cjs
```

- [ ] **Step 6: Grep verify — sentiment/market/lifespan emoji should be gone.**

```bash
grep -nE "😊|😠|😐|🟢|🔴|🔄|⚡|📅|🗓|📆|🧠|👍|👎" src/dashboard/server.js
```

Matches outside i18n → fix.

- [ ] **Step 7: Commit.**

```bash
git add src/dashboard/server.js
git commit -m "feat(dashboard): r4 — analyze panel + modal icons"
```

---

## Task 7: Empty states + warnings + remaining UI

Empty feed, search-no-results, error toasts, limit-exceeded, remaining miscellaneous emoji.

**Files:**
- Modify: `src/dashboard/server.js`

- [ ] **Step 1: Empty feed state.**

Grep for empty feed:

```bash
grep -n "empty-feed\|📭" src/dashboard/server.js | head -5
```

Replace the 📭 emoji-icon rendering with `icon('inbox')`:

```js
// Before:
h('div', { className: 'empty-feed-icon' }, '📭')

// After:
h('div', { className: 'empty-feed-icon' }, icon('inbox', { size: 44 }))
```

Note: the icon size jumps to 44 to match the large empty-state visual weight. The CSS for `.empty-feed-icon` already sets opacity .35 which will cascade to currentColor.

- [ ] **Step 2: Empty search state.**

Grep for search-empty:

```bash
grep -n "empty.*search\|🔍" src/dashboard/server.js | head -5
```

Apply same pattern with `icon('search-x', { size: 44 })`.

- [ ] **Step 3: Error/warning/limit toasts.**

Toasts were already converted to SVG in Round 1 Task 9 — verify with:

```bash
grep -nE "addToast.*[\u{1F300}-\u{1F9FF}\u{2600}-\u{27BF}]" src/dashboard/server.js
```

Should return zero. If non-empty, replace embedded emoji in addToast call sites.

- [ ] **Step 4: Limit-exceeded notice / banned actions.**

Grep for `⛔` and `❌`:

```bash
grep -n "⛔\|❌" src/dashboard/server.js
```

Each occurrence outside i18n → wrap with `icon('ban', { size: 12 })` (limit) or `icon('x-circle', { size: 12 })` (error).

- [ ] **Step 5: Warning triangles.**

```bash
grep -n "⚠️" src/dashboard/server.js
```

Each non-i18n match → `icon('alert-triangle', { size: 12 })`.

- [ ] **Step 6: Misc remaining — ✏️ edit, 🏷️ tag, 🔀 sort, ★/☆ favourite.**

```bash
grep -nE "✏️|🏷️|🔀|★|☆" src/dashboard/server.js
```

Apply mapping from spec section 5.10. Patterns:

```js
// Edit pencil:
h('button', null, icon('pencil', { size: 12 }))

// Category tag label:
h('span', null, icon('tag', { size: 12 }), ' Category')

// Sort label:
h('span', null, icon('arrow-up-down', { size: 12 }), ' Sort')

// Favourite (filled when saved):
h('button', { className: 'fav-btn ' + (isSaved ? 'saved' : '') },
  icon('star', { size: 14, style: isSaved ? { fill: 'currentColor' } : {} })
)
```

- [ ] **Step 7: Logo nav fallback (already-done check).**

Confirm Round 1 monogram-C fallback is intact:

```bash
grep -n "monogram\|nav-logo-icon" src/dashboard/server.js | head -5
```

No action if monogram already in place. If 🐱 emoji literal still exists in nav-logo path, replace with monogram (text "C" in JetBrains Mono). See Round 1 Task 12 commit `dac6e64` (Catalyst monogram fallback).

- [ ] **Step 8: SPA check.**

```bash
node scripts/check-dashboard-spa.cjs
```

- [ ] **Step 9: Commit.**

```bash
git add src/dashboard/server.js
git commit -m "feat(dashboard): r4 — empty states + warnings + misc"
```

---

## Task 8: i18n string sweep + WORKLOG + final grep

Strip leading emoji from all i18n translation values (EN + RU). Update JSX consumers to render icons separately. Final grep verifies near-zero emoji outside the whitelist.

**Files:**
- Modify: `src/dashboard/server.js`
- Modify: `ai-context/WORKLOG.md`

- [ ] **Step 1: List all i18n strings containing emoji.**

```bash
grep -nE "^\s*'[\w.]+'\s*:\s*'[^']*[\u{1F300}-\u{1F9FF}\u{2600}-\u{27BF}\u{1F100}-\u{1F1FF}]" src/dashboard/server.js
```

This produces the full list of i18n entries with embedded emoji. Each entry should appear once for EN (around line ~7100) and once for RU (around line ~7530).

- [ ] **Step 2: For each i18n entry, strip the leading emoji + space from the value.**

Example transforms:

```js
// Before:
'phase.strong_desc':   '🔥 Strong narrative — already viral',
'sort.meme':           '💎 By meme score',
'idle_btn':            '💬 Sign in via Telegram',
'right.top_narratives': '⭐🏆 Top narratives',

// After (same key, value with leading emoji stripped):
'phase.strong_desc':   'Strong narrative — already viral',
'sort.meme':           'By meme score',
'idle_btn':            'Sign in via Telegram',
'right.top_narratives': 'Top narratives',
```

Edit each row in EN block + matching row in RU block. Russian values follow the same emoji pattern — strip leading emoji + trailing space from both.

- [ ] **Step 3: For each affected i18n key, update JSX render site to prepend `icon(...)`.**

For every i18n key whose value used to start with emoji, the render site needs to gain an `icon(...)` call. Mapping (use the icon name from the spec inventory):

```js
// Before:
h('span', null, t('phase.strong_desc'))

// After:
h('span', null, icon('flame', { size: 12 }), ' ', t('phase.strong_desc'))
```

Grep for usage of each i18n key to find the render site:

```bash
grep -n "t('phase.strong_desc')" src/dashboard/server.js
```

(Repeat for each affected key.)

Apply the icon name from the spec inventory tables (section 5).

- [ ] **Step 4: Remove now-dead `TYPE_EMOJI` constant (if it still exists from Task 3).**

```bash
grep -n "const TYPE_EMOJI" src/dashboard/server.js
```

If present and no consumers remain (verify via `grep "TYPE_EMOJI\[" src/dashboard/server.js`), delete the declaration.

- [ ] **Step 5: Final emoji grep — whole-file scan.**

```bash
grep -nE "[\u{1F300}-\u{1F9FF}\u{2600}-\u{27BF}\u{1F100}-\u{1F1FF}]" src/dashboard/server.js
```

Expected matches (whitelist):
- TOP-1/2/3 medals (already typographic — emoji-free)
- (nothing else)

Unexpected matches → fix.

- [ ] **Step 6: SPA check.**

```bash
node scripts/check-dashboard-spa.cjs
```

Expected: green. Size should be roughly stable (added SVG bytes ≈ removed emoji bytes).

- [ ] **Step 7: Add WORKLOG entry on top of `ai-context/WORKLOG.md`.**

Prepend (above the Round 3 entry):

```markdown
## 2026-05-20 · sonnet · Dashboard redesign Round 4 — iconography sweep

**Триггер**: после Round 3 (градиенты + abyss-black) дашборд остался монохромным flat, но ~90 эмодзи (категории, фазы, кнопки, settings rows, source glyphs) делали его всё ещё "AI-made". Round 4 закрывает редизайн: SVG icons (Lucide + Phosphor 2 exceptions + 5 brand glyphs), color-dot + text для phase/market state, pure text + color для sentiment.

### Что покрыто

8 коммитов в `src/dashboard/server.js`:

1. **Icon helper foundation** — добавил `makeIcon()` factory + `ICONS` registry skeleton + `icon(name, opts)` shim near JS-helpers section. Smoke icons: `search`, `x`.
2. **Brand SVGs (sources)** — 5 brand glyphs (reddit/twitter/google/tiktok/hash). Переписал `SOURCE_ICONS` объект на icon-key strings, обновил sidebar source rows + feed-card avatar content.
3. **Bottom-nav + sidebar phase chips + filters** — `flame/star/search` для Feed/Saved/Analyze. Restructured `PHASE_META` (icon → color), CSS phase-dot, type chips EVENT/TREND/POST (newspaper/trend/circle-dot), `CAT_ICONS` → Lucide-key strings.
4. **Feed card chips/metrics/actions** — heart/message-circle/repeat-2/eye/arrow-up/award metrics, external-link/send/star/x actions.
5. **Settings + Account** — ~20 settings rows (settings/palette/globe/user/refresh-ccw/archive/radio-tower/bell/image/sparkles/rows/eye-off/log-out/activity/gem/bot/clock/bar-chart-3/lock/flask-conical/brain/target). Language flags 🇺🇸/🇷🇺 → "EN"/"RU" monospace text.
6. **Analyze panel + TrendModal** — verdict icons, sentiment text-only с semantic color, market stage (dot/spinner + text), lifespan calendar-* icons, ask-grok (brain), thumbs feedback.
7. **Empty states + warnings + misc** — inbox/search-x empty states, alert-triangle/ban/x-circle warnings, pencil/tag/arrow-up-down/star для edit/category/sort/favourite.
8. **i18n string sweep + final grep + WORKLOG** — strip leading emoji from EN + RU translation values, update JSX consumers to add icon() separately. Final grep подтверждает zero emoji outside whitelist.

### Файлы

- `src/dashboard/server.js` — основной (one inline-React file).
- `ai-context/WORKLOG.md` — этот entry.

### Архитектура

`ICONS` registry — ~80 icons inline (Lucide stroke + 2 Phosphor fill + 5 brand). Helper `icon(name, opts)` returns `h('svg', ...)` или null. currentColor наследуется от родителя — theming работает автоматически (pulse green / ink blue / tide cyan).

### Деплой

Не деплоил — оператор сам через `deploy.ps1`. SPA check зелёный после каждого коммита.

### Риски

- i18n migration: ~30 EN + 30 RU keys тронуты. Тест: re-render каждого affected screen.
- `PHASE_META.icon` → `.color` change потенциально может пропустить consumer. Final grep `PHASE_META\.\w+\.icon` подтверждает что все consumers перепилены.
- File size: ~295 kB → ~315 kB (~+20 kB inline SVG paths). Template literal вместил без проблем.
```

- [ ] **Step 8: Commit.**

```bash
git add src/dashboard/server.js ai-context/WORKLOG.md
git commit -m "feat(dashboard): r4 — i18n string sweep + WORKLOG"
```

---

## Self-review (already done — see below)

**Spec coverage:**
- Sec 3.1 (one library) → Tasks 2 (brand), 3 (Phosphor trend), 5 (Phosphor settings) ✓
- Sec 3.2 (hybrid philosophy) → Task 3 (phase = dot+text), Task 6 (sentiment = text-only) ✓
- Sec 3.3 (inline SVG single helper) → Task 1 ✓
- Sec 3.4 (currentColor) → Task 1 helper sets stroke/fill to currentColor ✓
- Sec 4.1 (makeIcon + ICONS + icon) → Task 1 ✓
- Sec 4.2 (use-site pattern) → demonstrated in every task ✓
- Sec 4.3 (PHASE_META/CAT_ICONS/SOURCE_ICONS restructure) → Tasks 2, 3 ✓
- Sec 4.4 (i18n untangling) → Task 8 ✓
- Sec 4.5 (SPA-trap) → SPA check step at every task ✓
- Sec 5 inventory → every category mapped in Tasks 2-7 ✓
- Sec 6 passes (8) → 8 tasks ✓
- Sec 7 out of scope → confirmed (login monogram, nav-logo 🐱 already done) ✓
- Sec 8 risks → SPA check + grep verify steps in every task ✓
- Sec 9 acceptance → final grep in Task 8 Step 5 ✓

**Placeholder scan:** No "TBD" / "TODO" / "implement later" anywhere. Every step has actual content or actionable grep/edit instruction. Lucide path data either inline-provided (most-used icons) or sourced from https://lucide.dev/icons/<name> (clearly stated).

**Type consistency:**
- `icon(name, opts)` signature consistent across Tasks 1-7 ✓
- `makeIcon(viewBox, stroke, ...children)` consistent ✓
- `PHASE_META[phase].color` (new shape) used in Tasks 3, 4, 6 consistently ✓
- `CAT_ICONS[cat]` returns string (icon-name key) used through `icon(CAT_ICONS[cat])` consistently ✓
- `SOURCE_ICONS[srcKey]` same pattern as CAT_ICONS ✓
- `SENTIMENT_COLOR` / `SENTIMENT_LABEL` defined in Task 6 ✓
