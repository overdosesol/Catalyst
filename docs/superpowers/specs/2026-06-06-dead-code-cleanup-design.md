# Dead Code Cleanup — Design Spec

**Bundle**: #19 из `docs/audit/INDEX.md` (Tier 2, highest ROI)
**Date**: 2026-06-06
**Author**: brainstorm session (operator + sonnet, operator delegated decisions)
**Status**: Approved scope (whole #19 as-is, no scope variations), ready for writing-plans

---

## Goal

Удалить ~24 LOC мёртвого кода в `src/dashboard/server.js` (3 функции + 2 CSS класса) + обновить 1 stale CSS comment + 2 documentation drift fixes. Закрывает 7 findings: **QUAL-005, QUAL-006, QUAL-007, QUAL-011, QUAL-013, SD-14, SD-23**. Простой polish-pass, ROI 7.0 (самый высокий в Tier 2).

## Context

Stage 11 audit пометил mёртвый код в dashboard SPA — функции и CSS классы оставшиеся от прошлых iterations (R4 redesign, ранние UX experiments). После 12-stage audit + Bundle #1/#16/#17 (foundation) — pure polish работа. Все finding'и low/medium severity, никаких critical concerns.

Haiku-агент grep-валидацией подтвердил 0 actual usages для всех dead items:
- `memeColor()` (line 8244) — function shadowed by const на line 9648, 0 function callsites
- `memeClass()` (line 8235) — 0 callsites
- `lifespanLabel()` (line 8201) — 0 callsites
- `.toolbar` CSS class (lines 3421-3425) — 0 className references (есть `.table-toolbar`, `.exp-toolbar`, `.toolbar-label`, `.toolbar-sep` — разные классы)
- `.kbd` CSS class (line 4935) — 0 className references (есть `right.kbd_hint` i18n key, не класс)
- CSS theme comment (lines 2636-2638) — заявляет "2 dark themes", реально 3 (pulse default + ink + tide)
- WORKLOG R4 entry (`WORKLOG_ARCHIVE.md`) — overstatement "iconography sweep complete" (реально ~85%, 18 emoji остались)
- SESSION_CONTEXT.md Cat mascot section — useEffect count drift (если упоминается)

**Critical safety constraint**: `src/dashboard/server.js` — это inline React SPA в template literal. Любой edit требует `npm run check:spa` validation (наш Bundle #16 deploy gate). Если SPA сломается — deploy abort'нется.

---

## Scope

### In-scope (7 findings closed)

**Code deletions (`src/dashboard/server.js`)**:
- Delete `lifespanLabel()` function — line ~8201 (~6 LOC)
- Delete `memeClass()` function — line ~8235 (~6 LOC)
- Delete `memeColor()` function — line ~8244 (~6 LOC) — также закрывает QUAL-011 (shadow risk с const на line 9648)
- Delete `.toolbar` CSS class block — lines 3421-3425 (5 LOC)
- Delete `.kbd` CSS class — line 4935 (1 LOC)

**Code comment update (`src/dashboard/server.js`)**:
- Update CSS theme block comment at lines 2636-2638 — "2 dark themes" → "3 themes: pulse (default) + ink + tide" — закрывает QUAL-005 + SD-23

**Documentation updates**:
- `ai-context/WORKLOG_ARCHIVE.md` — пометить R4 entry (2026-05-20 dashboard-iconography) что iconography sweep покрыл ~85%, 18 emoji остались в i18n + inline JSX — закрывает SD-14
- `ai-context/SESSION_CONTEXT.md` — Cat mascot section: исправить useEffect count drift (если описан как 8) на 11 — закрывает QUAL-013

**WORKLOG entry**:
- Add Bundle #19 entry to `ai-context/WORKLOG.md` после implementation

### Out-of-scope

- **Other dead code findings** не из этого набора — есть в audit, но не пометил Bundle #19 (e.g., commented-out blocks, unused imports). Defer.
- **Refactoring** any non-dead code — не моя задача.
- **Bundle docs** обновление (audit reports, plans) — audit/plan files preserve historical accuracy.
- **`docs/superpowers/plans/2026-05-20-dashboard-iconography.md`** — упоминает "line ~7715 после memeColor()". После delete ~80 LOC shifts. **Не fix'ю** — это исторический plan, не living doc; line numbers в historical plans drift natural over time.

---

## Architecture

### Files affected

| File | Action | Lines changed |
|---|---|---|
| `src/dashboard/server.js` | modify | -~24 LOC (deletes) + ~3 lines updated (comment) |
| `ai-context/SESSION_CONTEXT.md` | modify | ~1 line (useEffect count if drift exists) |
| `ai-context/WORKLOG_ARCHIVE.md` | modify | ~1 line added to R4 entry (annotation) |
| `ai-context/WORKLOG.md` | modify | new Bundle #19 entry |

### Files NOT touched

- `src/admin/server.js` — admin SPA, отдельный код, не trogaем
- Other `src/*.js` — нет dead code в этом bundle
- `package.json`, deploy scripts — out of scope
- Audit reports, plan files — historical preservation

### Approach: in-place targeted deletions

YAGNI — никаких rewrites, никаких refactors. Просто delete dead blocks через Edit tool с unique anchors. SPA validation после каждого server.js edit (через `npm run check:spa`).

---

## Targeted edits — details

### Edit 1: CSS theme comment (lines 2636-2638)

**Current** (verified via Read in extraction):
```
/* ===== THEME SYSTEM (rewritten 2026-05-06) =====
   2 dark themes:
     ink   — pure black + X-blue          (default, no data-theme attribute)
     tide  — deep navy + cyan/aqua accent (crypto-terminal vibe)
```

**After**:
```
/* ===== THEME SYSTEM (rewritten 2026-05-06) =====
   3 themes:
     pulse — soft graphite (default, :root baseline, no data-theme attribute)
     ink   — pure black + X-blue          (data-theme="ink")
     tide  — deep navy + cyan/aqua accent (data-theme="tide", crypto-terminal vibe)
```

**Verification**: `npm run check:spa` exits 0 (cosmetic change, won't break SPA parsing).

### Edit 2: Delete `.toolbar` CSS class (lines 3421-3425)

Find the `.toolbar` class definition (5 lines: selector + declarations + closing brace). Delete entire block.

**Anchor for Edit tool**: read the actual lines first (file may have shifted from Edit 1), then provide the exact 5-line `old_string`, `new_string` = empty (or just preserve surrounding newlines).

**Verification**: `npm run check:spa` exits 0.

### Edit 3: Delete `.kbd` CSS class (line 4935)

Single-line CSS rule. Delete it.

**Anchor**: unique single-line CSS rule `.kbd { ... }` content. Read actual line, delete.

**Verification**: `npm run check:spa` exits 0.

### Edit 4: Delete `lifespanLabel()` function (line ~8201)

~6 LOC function. Find via `function lifespanLabel(` or `const lifespanLabel = (` (read to confirm exact syntax). Delete entire function block (signature + body + closing brace).

**Anchor**: function definition with unique signature.

**Verification**: `npm run check:spa` exits 0.

### Edit 5: Delete `memeClass()` function (line ~8235)

~6 LOC function. Same approach.

**Anchor**: `memeClass` definition with unique signature.

**Verification**: `npm run check:spa` exits 0.

### Edit 6: Delete `memeColor()` function (line ~8244)

~6 LOC function. **NOT** the const `memeColor = barColor(meme)` at line 9648 — only the function declaration. Const stays untouched (used at lines 9778, 9781).

**Anchor**: `memeColor` function definition (not const).

**Verification**: `npm run check:spa` exits 0. This ALSO closes QUAL-011 (shadow risk removed — only const remains).

### Edit 7: Update SESSION_CONTEXT.md useEffect count

Find Cat mascot section in `ai-context/SESSION_CONTEXT.md`. If it mentions "8 useEffects" — replace with "11 useEffects". If the count isn't explicitly mentioned in current state — skip this edit (no drift to fix).

Operator notes: per QUAL-013 audit finding, drift exists. Verify via grep first; if count not in current text, drift may have been auto-resolved by Stage 12 sync-pass.

### Edit 8: Annotate WORKLOG_ARCHIVE.md R4 entry

Find the R4 (2026-05-20) dashboard-iconography entry in `ai-context/WORKLOG_ARCHIVE.md`. Add a one-line annotation noting that iconography sweep was partial (~85% coverage), 18 emoji остались в i18n strings + inline JSX (per Stage 6 UX audit finding UX-003).

The annotation goes inside the existing entry as a clarifying note, not as a separate entry (preserves archive structure).

---

## Verification plan

### Acceptance criteria

**Code deletions**:
- [ ] `src/dashboard/server.js`: `function lifespanLabel` no longer exists (`grep -c "function lifespanLabel" src/dashboard/server.js` = 0)
- [ ] `src/dashboard/server.js`: `function memeClass` no longer exists
- [ ] `src/dashboard/server.js`: `function memeColor` no longer exists (but `const memeColor` at line 9648 STILL exists — verify count is exactly 1)
- [ ] `src/dashboard/server.js`: `.toolbar {` CSS rule no longer exists (`grep -c "^.toolbar {" src/dashboard/server.js` = 0; other classes like `.table-toolbar`, `.toolbar-label` unaffected)
- [ ] `src/dashboard/server.js`: `.kbd {` CSS rule no longer exists

**Code updates**:
- [ ] `src/dashboard/server.js` CSS theme comment mentions 3 themes (pulse + ink + tide) — `grep "3 themes" src/dashboard/server.js` ≥ 1

**Doc updates**:
- [ ] `ai-context/SESSION_CONTEXT.md` Cat mascot section: if mentions useEffect count, count = 11 (not 8). If no mention — skip (drift already resolved).
- [ ] `ai-context/WORKLOG_ARCHIVE.md` R4 entry: contains annotation about ~85% coverage + 18 emoji remaining
- [ ] `ai-context/WORKLOG.md`: new Bundle #19 entry at top

**SPA validation gate (CRITICAL)**:
- [ ] After EACH edit to `src/dashboard/server.js`: `npm run check:spa` exits 0
- [ ] Final full SPA check после всех 6 server.js edits: `npm run check:spa` exits 0

**Functional smoke (operator-driven, T-final)**:
- [ ] Local dev server starts without errors (`npm run dev` shows no syntax warnings)
- [ ] Dashboard page loads in browser without console errors
- [ ] No visual regressions (operator visual check)

### Closed findings

- QUAL-005 (CSS theme comment updated to 3 themes)
- QUAL-006 (3 dead functions deleted: lifespanLabel + memeClass + memeColor)
- QUAL-007 (2 dead CSS classes deleted: .toolbar + .kbd)
- QUAL-011 (shadow risk resolved — function deleted, only const remains)
- QUAL-013 (useEffect count drift fixed in SESSION_CONTEXT, if applicable)
- SD-14 (WORKLOG_ARCHIVE R4 annotation about partial coverage)
- SD-23 (resolved together with QUAL-005 — theme comment now accurate)

---

## Risks & mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Edit breaks SPA template literal (backtick trap) | medium | `npm run check:spa` after EACH server.js edit. If exit 1 — revert that edit immediately. Bundle #16 deploy gate also catches at deploy time. |
| Dead item turns out to have hidden usage | very low | Haiku grep validation confirmed 0 actual uses for ALL items. If implementer finds usage during edit — flag as BLOCKED, don't delete. |
| Line numbers shift between edits | medium | Read file before each edit to confirm anchor. Use unique anchor strings (full function signature + 1-2 lines context), not raw line numbers. |
| const `memeColor` at line 9648 also deleted accidentally | medium | EXPLICITLY only delete `function memeColor` declaration. Verify via grep `const memeColor` still exists after edit. |
| `npm run check:spa` itself broken | very low | If check fails — investigate validator before assuming SPA is broken. Bundle #16 verified validators work. |

---

## Estimated effort

| Component | Time |
|---|---|
| Edit 1: CSS theme comment update | 5 min |
| Edit 2: Delete .toolbar CSS | 5 min + check |
| Edit 3: Delete .kbd CSS | 5 min + check |
| Edit 4: Delete lifespanLabel | 5 min + check |
| Edit 5: Delete memeClass | 5 min + check |
| Edit 6: Delete memeColor function | 5 min + check (extra verify const remains) |
| Edit 7: SESSION_CONTEXT useEffect count (conditional) | 3 min |
| Edit 8: WORKLOG_ARCHIVE R4 annotation | 3 min |
| Final full SPA check | 1 min |
| WORKLOG Bundle #19 entry | 10 min |
| Operator: local dev start + visual smoke | 10 min |
| **Total** | **~1h** |

Matches audit's ~1h estimate exactly.

---

## Open questions

All resolved by operator delegation:
- Q1: Whole #19 scope vs subset? → **Whole 7 items** (это уже minimum bundle, no further reduction needed)
- Q2: Touch `docs/superpowers/plans/2026-05-20-dashboard-iconography.md` для line ref drift? → **No** (historical plan, preserve)
- Q3: Refactor any non-dead code while we're here? → **No** (YAGNI)
- Q4: Delete commented-out blocks if encountered? → **No** (commented blocks могут быть intentional reminders; if real dead code — separate bundle)

---

## Transition

После approve этого spec — invoke `superpowers:writing-plans` для генерации implementation plan с пошаговыми задачами + SPA check gates после каждой server.js правки.
