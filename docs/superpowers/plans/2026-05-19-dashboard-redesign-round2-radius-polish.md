# Dashboard Redesign Round 2 — Radius + Visual Polish Pass

> **For agentic workers:** Use superpowers:subagent-driven-development to execute task-by-task.

**Goal:** Make the Round 1 redesign actually visible by migrating literal `border-radius` values to the new `--r1/--r2/--r3` token scale, tightening padding/spacing for "trading-desk" density, and removing residual pillowy hover backgrounds.

**Why:** Round 1 defined tokens but didn't sweep existing components to use them. Operator deployed and reported "почти ничего не поменялось" — only colors visibly changed. This round delivers the visceral redesign feel.

**Architecture:** Pure CSS / inline-style sweep through `src/dashboard/server.js`. No new tokens, no new features, no DOM structure changes. Same SPA-trap rules apply.

**Tech Stack:** Single-file edits, `node scripts/check-dashboard-spa.cjs` after each task.

**Round 1 spec:** [`docs/superpowers/specs/2026-05-19-dashboard-redesign-design.md`](../specs/2026-05-19-dashboard-redesign-design.md)

---

## Task 1: Radius migration — left sidebar

**Files:** `src/dashboard/server.js`

**Targets** (CSS rules in the file):
- Sources list items (`.sb-source-*`)
- Phase chips (`.phase-chip`) — base rule (active state already done in Round 1)
- Type chips (`.atype-chip-*`)
- Window buttons (`.win-btn` / `.window-pill`)
- Sort buttons (`.sort-btn`)
- Category dropdown
- Bottom Feed/Saved/Analyze tabs (`.bottom-nav-btn` or similar)

**Action:** Find `border-radius: <N>px` where N ≥ 6, replace:
- N ∈ [6,10] → `var(--r1)` (chips/buttons → 2px)
- N ∈ [11,16] → `var(--r3)` (cards/panels → 4px)
- Pills (999px or 99px) — KEEP as pills only if explicitly designed as pills (e.g. `.live-dot` round badge). Otherwise → `var(--r1)`.

Steps:
1. Grep `border-radius` in lines 2800–3500 (sidebar section)
2. For each match, decide token by context
3. SPA check
4. Commit `feat(dashboard): r2 — sidebar sharp radius migration`

---

## Task 2: Radius migration — header + top bar

**Targets:**
- `.brand` / `.app-header`
- Profile chip (`.profile-chip`)
- Icon buttons (X / TG / settings)
- Search input (`.search-input`)
- "Catalyst" logo container

**Action:** Same migration rules. Most header elements should land on `var(--r1)`.

Commit `feat(dashboard): r2 — header sharp radius`.

---

## Task 3: Radius migration — feed cards + main column

**Targets:**
- Main feed card (`.feed-card` or whatever the wrapper is)
- Card thumbnail (`.feed-thumb` / `.thumb`)
- Card buttons (Details / Source / star / hide)
- Score bars (already accent-colored, but radius)
- Search bar above feed
- Refresh button

**Action:**
- Card itself → `var(--r3)` (4px)
- Thumbnail → `var(--r2)` (3px)
- Buttons → `var(--r1)` (2px)

Commit `feat(dashboard): r2 — feed card sharp radius`.

---

## Task 4: Radius migration — right column (TOP NARRATIVES + LIVE panel)

**Targets:**
- TOP NARRATIVES list container + items
- LIVE stats panel (SIGNALS / ALERTS / AVG SCORE / VELOCITY tiles)
- "sources" indicator row at bottom

**Action:** Container/panels → `var(--r3)`. Inner tiles/items → `var(--r1)` or `var(--r2)`.

Commit `feat(dashboard): r2 — right column sharp radius`.

---

## Task 5: Radius migration — modals + AnalyzePanel + everywhere else

**Targets:**
- AnalyzePanel container + inner blocks
- TrendModal (decisions modal, alert details)
- Settings panel + sub-screens
- Account panel
- Any remaining `border-radius` with values >= 6px not yet migrated

**Action:** Same migration rules. Modal containers → `var(--r3)` max.

```bash
grep -nE "border-radius:\s*(6|7|8|9|10|11|12|13|14|15|16|18|20|24)px" src/dashboard/server.js | head -30
```

Hit all remaining matches.

Commit `feat(dashboard): r2 — final radius sweep`.

---

## Task 6: Density pass — tighten padding + gaps

**Goal:** Reduce visual breathing room across UI to make "trading-desk density" feel actually present.

**Targets** (typical values to tighten — adapt to actual code):

- Sidebar source list items: `padding: 10px 14px` → `padding: 6px 12px`
- Phase / type chip rows: `gap: 8px` → `gap: 6px`
- Feed cards: gap between cards `gap: 12px` → `gap: 8px`
- Feed card internal padding: 16px → 14px (keep readable)
- Right column item padding: 12px → 8px
- Header height: keep, but reduce vertical padding by 4px
- LIVE panel tile padding: 16px → 12px

**Don't tighten:**
- Login screen card (it's centered, looser is fine)
- AnalyzePanel verdict banner (needs space)
- Toast padding (already tight from Round 1)
- Modal content (readability priority)

**Approach:** Read each section's current padding/gap, decide what's worth tightening. Skip if change is < 2px (not worth the risk).

Commit `feat(dashboard): r2 — density tightening`.

---

## Task 7: Remove pillowy hover backgrounds

**Targets:**
- Sidebar item hover (current: full background fill on hover — looks like clicking a pillow)
- Switch to: subtle border emphasis or text color brightening only

Pattern to find:
```css
.sb-source-item:hover { background: rgba(...) }
```

Replace with:
```css
.sb-source-item:hover {
  background: transparent; /* or rgba with much less opacity */
  border-color: var(--border3);
  color: var(--text);
}
```

Same for phase chips, type chips, etc. (where applicable).

**Exceptions:**
- Toast close button hover keeps its surface2 bg (Round 1 design choice)
- Feed card "Details" button hover stays primary
- Login button hover (cyan glow)

Commit `feat(dashboard): r2 — flatten hover states`.

---

## Task 8: Final SPA check + WORKLOG entry

Run `node scripts/check-dashboard-spa.cjs`.

Prepend WORKLOG entry summarizing Round 2 work — link to Round 1 entry, describe 7 commits, note what's now visible vs Round 1 expectations.

Commit `docs(worklog): r2 polish pass — radius migration + density`.

---

## SPA-trap rule (same as Round 1)

After every Edit → `node scripts/check-dashboard-spa.cjs`. Red = revert immediately. Watch for:
- Backticks in CSS comments
- `\'` escapes in EN strings (shouldn't apply this round — we're touching CSS, not i18n)

## Verification checklist (after deploy)

1. Sidebar source items have sharp corners (4px not 12px)
2. Phase / type chip buttons sharp 2px (not pill-like)
3. Feed cards 4px corners, tighter spacing between
4. TOP NARRATIVES sidebar items sharp
5. LIVE panel tiles sharp
6. Header chips sharp
7. Hover on sidebar items → border emphasis, not full background fill
8. Overall feel: denser, more "trading-desk", less "AI-made"
