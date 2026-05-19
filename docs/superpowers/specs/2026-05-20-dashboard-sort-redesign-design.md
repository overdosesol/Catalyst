# Dashboard Sort Redesign — Design Spec

**Date:** 2026-05-20
**Owner:** skipnick
**Status:** Approved, ready for plan

> **Round 5** in the Catalyst dashboard redesign series.
> Round 1 (`2026-05-19-dashboard-redesign-design.md`): palette + radius tokens + LoginScreen + toasts.
> Round 2: radius migration + density tightening + flatten hovers.
> Round 3 (no separate spec): gradient removal + abyss-black surface scale.
> Round 4 (`2026-05-20-dashboard-iconography-design.md`): ~90 emoji → SVG icons + dot/text indicators.
> **Round 5 (this spec): SORT control — replace icon-only seg-control with labeled vertical chip list, drop `virality`.**

---

## 1. Goal

Make the Sort control readable at a glance. Drop the 5-icon segmented row in the sidebar (icons without labels, hover-tooltip required to identify each) and replace it with a vertical list of 4 chips, each rendering icon + full text label. Active chip uses accent fill (matches `.badge-catalyst` pattern). Remove the `virality` sort option entirely — it overlaps semantically with `rank` (engagement-based score) and added a 5th opaque button without earning its keep.

## 2. Context

After Round 4 the dashboard moved from emoji to icons. The Sort group in the sidebar (line ~13287 in `src/dashboard/server.js`) was converted icon-for-icon: 5 buttons in a horizontal `seg-group seg-compact` with `title=` tooltips for the labels. The icons themselves (`zap`, `gem`, `waves`, `clock`, `bar-chart-3`) are not self-descriptive for sort criteria — `gem` for "top adoption", `waves` for "top emergence", `bar-chart-3` for "virality" require memorization. Users have to hover each button to discover what it does, then hover again later when they forget.

The component visually reads as a button-bar tool palette, not as "I am sorting my feed by X". Active state is a green tint behind one button, which says "this one is selected" but not "I am sorting by Newest". Side-by-side with the labeled `CategoryDropdown` immediately above, the inconsistency stands out.

Operator feedback (verbatim): *"непонятное и неудобное"*. Confirmed pain points: opaque icons + non-optimal option set (specifically, `virality` is dead weight — `rank` already weights by virality).

## 3. Principles

### 3.1 Text-first for sort criteria

Sorting is a low-frequency, deliberate action. The user picks a sort once, scans the feed, maybe switches once. Optimize for clarity (full label visible without interaction) over compactness (button row).

### 3.2 Chip styling, consistent with siblings

Each option is a chip with a 1px border — the same surface treatment as `.phase-badge` and `.badge-atype-event/trend/post`. Active chip uses the accent-fill pattern from `.badge-catalyst` (`rgba(accent-rgb, .14)` background, `rgba(accent-rgb, .38)` border, `accent` text/icon). No bespoke colors — reuses existing CSS custom properties so theme switches (pulse/ink/tide) Just Work.

### 3.3 Drop dead weight

`virality` and `rank` were too similar — `rank` sorts by the composite `score DESC` which already incorporates virality weighting (see `term.virality` i18n string: *"Engagement-based virality (0-100) — likes, retweets, comments, replies, upvotes plus velocity weighting"*). Two options that produce nearly-identical orderings is confusing, not flexible. Cut.

### 3.4 No tooltip-only labels

Tooltips remain on each chip (via `title=`) for keyboard / accessibility / power-user discovery, but they are no longer the primary label channel. The text inside the chip IS the label.

## 4. Architecture

### 4.1 CSS (new classes)

Added near existing badge styles around line ~3708 in `src/dashboard/server.js`:

```css
.sort-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.sort-chip {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  border-radius: var(--r1);
  background: var(--surface2);
  border: 1px solid var(--border);
  color: var(--text2);
  user-select: none;
  transition: background .12s ease, color .12s ease, border-color .12s ease;
}

.sort-chip:hover {
  background: var(--card);
  color: var(--text);
}

.sort-chip.active {
  background: rgba(var(--accent-rgb), .14);
  border-color: rgba(var(--accent-rgb), .38);
  color: var(--accent);
}

.sort-chip:focus-visible {
  outline: 2px solid rgba(var(--accent-rgb), .5);
  outline-offset: 1px;
}
```

`var(--r1)`, `var(--surface2)`, `var(--border)`, `var(--text2)`, `var(--text)`, `var(--card)`, `var(--accent)`, `var(--accent-rgb)` are all pre-existing theme tokens (see `:root` block around line ~2600). No new tokens introduced.

### 4.2 JSX (replace existing seg-group)

Current (line ~13287–13305):

```js
h('div', { className: 'filter-group' },
  h('div', { className: 'filter-label' }, h('span', null, t('sidebar.sort'))),
  h('div', { className: 'seg-group seg-compact' },
    [
      { v: 'rank',      i: 'zap',          tip: t('sort.rank') },
      { v: 'meme',      i: 'gem',          tip: t('sort.meme') },
      { v: 'emergence', i: 'waves',        tip: t('sort.emergence') },
      { v: 'time',      i: 'clock',        tip: t('sort.time') },
      { v: 'virality',  i: 'bar-chart-3',  tip: t('sort.virality') },
    ].map(o =>
      h('button', {
        key: o.v,
        title: o.tip,
        className: 'seg-btn' + (sort === o.v ? ' active' : ''),
        onClick: () => { setSort(o.v); setOffset(0); }
      }, icon(o.i, { size: 13 }))
    )
  )
)
```

Replacement:

```js
h('div', { className: 'filter-group' },
  h('div', { className: 'filter-label' }, h('span', null, t('sidebar.sort'))),
  h('div', { className: 'sort-list' },
    [
      { v: 'rank',      i: 'zap',   label: t('sort.rank') },
      { v: 'meme',      i: 'gem',   label: t('sort.meme') },
      { v: 'emergence', i: 'waves', label: t('sort.emergence') },
      { v: 'time',      i: 'clock', label: t('sort.time') },
    ].map(o =>
      h('button', {
        key: o.v,
        title: o.label,
        className: 'sort-chip' + (sort === o.v ? ' active' : ''),
        onClick: () => { setSort(o.v); setOffset(0); }
      },
        icon(o.i, { size: 14 }),
        h('span', null, o.label)
      )
    )
  )
)
```

Notes:
- Icon grows from 13px to 14px to better balance the 13px label.
- `key`, `title`, `onClick`, `setOffset(0)` semantics preserved.
- Native `<button>` element retained (focus, keyboard, screenreader) — no `role` override needed.

### 4.3 i18n cleanup

Remove `sort.virality` from both EN (line ~6917) and RU (line ~7347) blocks. The 4 remaining keys (`sort.rank`, `sort.meme`, `sort.emergence`, `sort.time`) stay untouched.

```diff
- 'sort.virality': 'Virality',
- 'sort.virality': 'Виральность',
```

### 4.4 Backend tolerance

`src/dashboard/server.js:1059` currently has:

```js
else if (sortParam === 'virality')  orderBy = 'score DESC';
```

Decision: **keep the branch as dead-tolerant**. Old shared URLs (`?sort=virality`) or stale localStorage values still resolve to a sensible order rather than 500-ing or silently flipping to default. Cost = one comparison + a `// kept for legacy URLs` comment. Low.

### 4.5 Frontend state migration

`useState('rank')` (line ~12246) stays as-is — default sort unchanged.

Audit result (grep `setSort\(`):
- `setSort('rank')` in Reset filters callback (line ~12812) — safe.
- `setSort(o.v)` in chip onClick (line ~13301) — after the redesign, can only fire one of `rank/meme/emergence/time`.

No URL → state read path for `sort` exists. No localStorage persistence for `sort` exists. Therefore **no frontend state migration is required** — a stale `'virality'` value cannot reach the new UI after deploy. The state always starts at `'rank'` on reload.

## 5. Option Inventory

The 4 remaining sort criteria, mapped:

| Value (state) | Icon (Lucide) | EN Label | RU Label | Backend `orderBy` |
| --- | --- | --- | --- | --- |
| `rank` (default) | `zap` | Rank | Рейтинг | `score DESC` composite (default) |
| `meme` | `gem` | Top adoption | Топ adoption | `adoption_score DESC` |
| `emergence` | `waves` | Top emergence | Топ emergence | `emergence_score DESC` |
| `time` | `clock` | Newest | Свежие | `last_seen DESC` |

Removed: `virality` (was `bar-chart-3`, `score DESC` — duplicate of `rank`'s default).

## 6. Edge Cases

- **Legacy URL `?sort=virality`**: backend branch `sortParam === 'virality'` retained, returns `score DESC` (same as old behavior). Frontend `setSort('virality')` would result in no chip being active. If frontend reads sort from URL, normalize at init.
- **Mobile / narrow sidebar**: Vertical chip list grows in height, not width. Fits any sidebar ≥ 180px. Each chip is 30-32px tall; 4 chips = ~130-140px total + the label header — fits well above the BottomNav.
- **Theme switch (pulse/ink/tide)**: All colors use `var(--accent)` / `var(--accent-rgb)`. Switching theme repaints chip active state automatically. Already verified via `.badge-catalyst` which uses the same tokens.
- **Reset filters action** (`setHours(24); setCategory(''); setSource(''); setSort('rank'); setOffset(0)` at line ~12812): unaffected — still resets to `rank`.
- **Active filter pill in feed header** (`hours !== 24 || category || sort !== 'rank'` at line ~13236): unaffected — `rank` still the default sentinel.

## 7. Acceptance Criteria

- 4 chips render vertically in the sidebar Sort group.
- Each chip shows icon + full text label, readable without hover.
- Default active chip is `Rank`/`Рейтинг` on first load and after Reset.
- Clicking a chip:
  - Sets `sort` state to that value.
  - Sets `offset` to 0 (re-fetches feed from page 0).
  - Active accent fill moves to the clicked chip.
- Theme switch (pulse → ink → tide) updates active chip accent color correctly.
- `Virality` no longer appears in the UI in either language.
- `?sort=virality` URLs still load the feed without errors (backend tolerates legacy value).
- SPA syntax check (`node scripts/check-dashboard-spa.cjs`) passes after all edits.
- No `.seg-btn`/`.seg-group`/`.seg-compact` references remain that were tied to the old Sort group (verify by grep; if those classes are used elsewhere, leave them).

## 8. Out of Scope

- Mobile drawer / responsive sidebar collapse — sidebar layout itself isn't changing.
- Adding new sort criteria (e.g. impact, controversy) — discussed and deferred.
- Persisting sort in localStorage across reloads.
- Changing the icon library or icon style — Lucide stroke-2px stays.
- Touching other seg-groups (Window selector, theme switcher, etc.) — they're not painted with the same brush.

## 9. Risks

- **SPA-trap (R4 lessons)**: Editing `server.js` inside the inline template literal — backticks in comments break it. Mitigation: `node scripts/check-dashboard-spa.cjs` after every Edit, no backticks inside JSX-body comments.
- **`.sort-chip` class name collision**: Verify via grep — no current usage.
- **Theme contrast**: `rgba(--accent-rgb, .14)` on `--surface2` may have weak contrast in the `ink` theme (blue on dark blue). Visually verify all 3 themes.
- **Frontend stale `virality`**: Not a risk. Sort state is never persisted (no localStorage, no URL→state path), and `useState('rank')` reinitializes on every page load. After deploy the worst case is one feed re-fetch during the page reload itself.

## 10. File Touch List

- `src/dashboard/server.js`:
  - CSS: add `.sort-list` + `.sort-chip` + states (~6 lines of rules, near line 3708)
  - JSX: replace 5-button `seg-group` block with 4-button `sort-list` (line 13287–13305)
  - i18n: remove `sort.virality` EN (~6917) + RU (~7347)
  - Backend: comment on `sortParam === 'virality'` line 1059 marking it as legacy-tolerance (no code change)
- `ai-context/WORKLOG.md`: new entry at top (R5 sort redesign)
