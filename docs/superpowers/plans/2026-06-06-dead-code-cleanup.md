# Dead Code Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- []`) syntax for tracking.

**Goal:** Close 7 dead-code findings (QUAL-005/006/007/011/013 + SD-14/23) by deleting ~24 LOC of unused functions/CSS in `src/dashboard/server.js`, updating 1 stale CSS comment, and adding 2 doc annotations.

**Architecture:** In-place targeted deletions via Edit tool. Every `src/dashboard/server.js` edit followed by `npm run check:spa` (Bundle #16 gate) to catch SPA-trap breakage immediately. YAGNI — no refactoring of non-dead code, no line-ref updates in historical plans.

**Tech Stack:** Edit tool (file changes), `npm run check:spa` (SPA validation), grep (verification).

**Spec reference:** `docs/superpowers/specs/2026-06-06-dead-code-cleanup-design.md`

---

## File Structure

### Files modified
- `src/dashboard/server.js` — 6 edits: 1 comment update + 5 deletions (~24 LOC removed total)
- `ai-context/SESSION_CONTEXT.md` — conditional 1-line fix (useEffect count drift)
- `ai-context/WORKLOG_ARCHIVE.md` — 1 annotation added to R4 entry
- `ai-context/WORKLOG.md` — new Bundle #19 entry (added in T9 by operator)

### Files NOT touched
- `src/admin/server.js`
- `package.json`, deploy scripts
- Audit reports (`docs/audit/`), historical plans (`docs/superpowers/plans/2026-05-20-*`)
- Anything else

---

## Critical SPA safety gate

**After EVERY edit to `src/dashboard/server.js`**:
```bash
npm run check:spa
```
Expected: exit 0, both `Dashboard SPA inner OK (...)` and `SPA inner OK (...)` messages.

If exit 1 → that edit broke the SPA. REVERT that edit immediately via `git checkout -- src/dashboard/server.js`, investigate, fix, re-apply.

---

## Task Order Rationale

T1-T6 are server.js edits. Within those:
1. **T1 first** (CSS comment update) — lowest risk (cosmetic), establishes the SPA validation rhythm
2. **T2-T3** (CSS deletions) — small, isolated CSS blocks
3. **T4-T6** (function deletions) — slightly higher risk (larger blocks, position-sensitive)

T7-T8 are doc edits (no SPA risk).
T9 is operator-driven smoke test + WORKLOG.

If any T1-T6 breaks SPA → STOP, don't proceed to next task until that edit is fixed or reverted.

---

## Task 1: Update CSS theme comment (QUAL-005 + SD-23)

**Files:**
- Modify: `src/dashboard/server.js` (lines ~2636-2638, may have shifted)

- [ ] **Step 1: Find the current CSS theme comment block**

```bash
grep -n "2 dark themes" src/dashboard/server.js
```
Expected: one match around line 2636-2638. Note the line number.

If multiple matches — investigate; we want the THEME SYSTEM block only.
If zero matches — already updated by prior work; mark task DONE_WITH_CONCERNS (no-op).

- [ ] **Step 2: Read the block to confirm content**

```bash
sed -n 'N-2,N+5p' src/dashboard/server.js
```
(Replace N with line number from step 1.)

Expected content (the comment may have been wrapped/edited slightly — match the actual file):
```
/* ===== THEME SYSTEM (rewritten 2026-05-06) =====
   2 dark themes:
     ink   — pure black + X-blue          (default, no data-theme attribute)
     tide  — deep navy + cyan/aqua accent (crypto-terminal vibe)
```

- [ ] **Step 3: Apply Edit**

Use Edit tool with the exact 4-line block as `old_string`. Adjust if the actual file has different whitespace/wording.

`old_string`:
```
/* ===== THEME SYSTEM (rewritten 2026-05-06) =====
   2 dark themes:
     ink   — pure black + X-blue          (default, no data-theme attribute)
     tide  — deep navy + cyan/aqua accent (crypto-terminal vibe)
```

`new_string`:
```
/* ===== THEME SYSTEM (rewritten 2026-05-06) =====
   3 themes:
     pulse — soft graphite (default, :root baseline, no data-theme attribute)
     ink   — pure black + X-blue          (data-theme="ink")
     tide  — deep navy + cyan/aqua accent (data-theme="tide", crypto-terminal vibe)
```

- [ ] **Step 4: Verify Edit applied**

```bash
grep -c "3 themes" src/dashboard/server.js
```
Expected: at least 1.

```bash
grep -c "2 dark themes" src/dashboard/server.js
```
Expected: 0 (old wording gone).

- [ ] **Step 5: SPA validation gate**

```bash
npm run check:spa
```
Expected: exit 0, both `OK` messages.

If exit 1 — REVERT and STOP. Comment-only changes should never break SPA; if they do, something is structurally wrong.

- [ ] **Step 6: Scope check**

```bash
git status --short src/dashboard/server.js
```
Expected: ` M src/dashboard/server.js`.

- [ ] **Step 7: NO COMMIT.**

---

## Task 2: Delete `.toolbar` CSS class (QUAL-007 part 1)

**Files:**
- Modify: `src/dashboard/server.js` (lines ~3421-3425, may have shifted after T1)

- [ ] **Step 1: Find the `.toolbar` CSS rule**

```bash
grep -nE "^\s*\.toolbar\s*\{" src/dashboard/server.js
```
Expected: one match around line 3421. Note line number.

If zero matches — already deleted; skip task.
If multiple matches — investigate (should be only one bare `.toolbar` definition, the others are `.table-toolbar`, `.toolbar-label`, etc.).

- [ ] **Step 2: Read the full block (5 lines)**

```bash
sed -n 'N,N+5p' src/dashboard/server.js
```
(N = line from step 1.)

Expected: a 5-line CSS rule:
```css
.toolbar {
  display: flex;
  ...
}
```

Note the EXACT content for Edit anchor.

- [ ] **Step 3: Apply Edit (delete entire block + leading/trailing blank if any)**

Use Edit tool. `old_string` = the 5-line block from step 2 (verbatim). `new_string` = empty string `""` (deletes the entire block).

If the block is followed by another rule with no blank line — `new_string` should be empty. If followed by a blank line, decide whether to keep that blank (visually nicer) or delete it too. Either is acceptable; prefer keeping if unsure.

- [ ] **Step 4: Verify Edit**

```bash
grep -cE "^\s*\.toolbar\s*\{" src/dashboard/server.js
```
Expected: 0.

```bash
grep -cE "\.table-toolbar|\.toolbar-label|\.toolbar-sep|\.exp-toolbar" src/dashboard/server.js
```
Expected: ≥ 4 (these RELATED classes should NOT have been deleted).

- [ ] **Step 5: SPA validation gate**

```bash
npm run check:spa
```
Expected: exit 0.

If exit 1 — REVERT and STOP.

- [ ] **Step 6: NO COMMIT.**

---

## Task 3: Delete `.kbd` CSS class (QUAL-007 part 2)

**Files:**
- Modify: `src/dashboard/server.js` (line ~4935, may have shifted)

- [ ] **Step 1: Find `.kbd` CSS rule**

```bash
grep -nE "^\s*\.kbd\s*\{" src/dashboard/server.js
```
Expected: one match around line 4935.

- [ ] **Step 2: Read the rule**

```bash
sed -n 'N,N+2p' src/dashboard/server.js
```
(N = line from step 1.)

Expected: 1-line rule like `.kbd { font-family: monospace; ... }` or possibly multi-line. Confirm exact content.

- [ ] **Step 3: Apply Edit**

`old_string` = exact `.kbd` rule from step 2. `new_string` = empty.

- [ ] **Step 4: Verify Edit**

```bash
grep -cE "^\s*\.kbd\s*\{" src/dashboard/server.js
```
Expected: 0.

```bash
grep -c "kbd_hint" src/dashboard/server.js
```
Expected: ≥ 1 (i18n key `right.kbd_hint` should remain — it's different from the class).

- [ ] **Step 5: SPA validation gate**

```bash
npm run check:spa
```
Expected: exit 0.

If exit 1 — REVERT and STOP.

- [ ] **Step 6: NO COMMIT.**

---

## Task 4: Delete `lifespanLabel()` function (QUAL-006 part 1)

**Files:**
- Modify: `src/dashboard/server.js` (line ~8201, may have shifted)

- [ ] **Step 1: Find `lifespanLabel` definition**

```bash
grep -nE "function lifespanLabel|const lifespanLabel|let lifespanLabel" src/dashboard/server.js
```
Expected: one match around line 8201.

- [ ] **Step 2: Read the function body**

```bash
sed -n 'N,N+10p' src/dashboard/server.js
```
(N = line from step 1.)

Note exact function signature + body + closing brace. May be 4-8 lines depending on style.

- [ ] **Step 3: Apply Edit**

`old_string` = exact function definition (signature + body + closing `}`) from step 2.
`new_string` = empty.

If the function is followed by a blank line, decide whether to keep it (preserve grouping with next function) or delete (clean removal). Either acceptable.

- [ ] **Step 4: Verify Edit**

```bash
grep -c "lifespanLabel" src/dashboard/server.js
```
Expected: 0 (function and all references gone — grep validation confirmed 0 callsites; the only mention was the definition itself).

- [ ] **Step 5: SPA validation gate**

```bash
npm run check:spa
```
Expected: exit 0.

If exit 1 — REVERT and STOP. Investigate via `node scripts/check-dashboard-spa.cjs` directly for verbose error.

- [ ] **Step 6: NO COMMIT.**

---

## Task 5: Delete `memeClass()` function (QUAL-006 part 2)

**Files:**
- Modify: `src/dashboard/server.js` (line ~8235, may have shifted)

- [ ] **Step 1: Find `memeClass` definition**

```bash
grep -nE "function memeClass|const memeClass|let memeClass" src/dashboard/server.js
```
Expected: one match around line 8235.

- [ ] **Step 2: Read the function**

```bash
sed -n 'N,N+10p' src/dashboard/server.js
```
(N = line from step 1.)

Note exact signature + body + closing brace.

- [ ] **Step 3: Apply Edit**

`old_string` = exact function from step 2. `new_string` = empty.

- [ ] **Step 4: Verify Edit**

```bash
grep -c "memeClass" src/dashboard/server.js
```
Expected: 0.

- [ ] **Step 5: SPA validation gate**

```bash
npm run check:spa
```
Expected: exit 0.

- [ ] **Step 6: NO COMMIT.**

---

## Task 6: Delete `memeColor()` function (QUAL-006 part 3 + QUAL-011 shadow fix)

**Files:**
- Modify: `src/dashboard/server.js` (line ~8244 for function; line ~9648 has the const, MUST NOT touch)

This is the trickiest task — there are TWO `memeColor` identifiers in the file:
- **Function declaration** at ~line 8244 — DELETE this
- **Const variable** at ~line 9648 (`const memeColor = barColor(meme)`) — KEEP this (used at lines 9778, 9781)

- [ ] **Step 1: Locate BOTH `memeColor` definitions**

```bash
grep -nE "function memeColor|const memeColor|let memeColor" src/dashboard/server.js
```
Expected output:
```
NNNN:function memeColor(...) ...
MMMM:  const memeColor = barColor(meme)...
```

Confirm two distinct lines: one is `function memeColor` (delete), one is `const memeColor` (keep).

- [ ] **Step 2: Read the FUNCTION definition only (~line 8244)**

```bash
sed -n 'N,N+10p' src/dashboard/server.js
```
(N = the `function memeColor` line, NOT the const line.)

Note exact function signature + body + closing brace.

- [ ] **Step 3: Apply Edit — function only**

`old_string` = the EXACT function definition (signature + body + closing `}`).
`new_string` = empty.

**CRITICAL**: do NOT match anything from the `const memeColor` block. The function and const have different structures — function uses `function memeColor(...)` syntax, const uses `const memeColor = barColor(...)`. The `old_string` should ONLY match the function.

- [ ] **Step 4: Verify function is gone, const remains**

```bash
grep -c "^function memeColor\|^  function memeColor\|  function memeColor" src/dashboard/server.js
```
Expected: 0 (function gone).

```bash
grep -c "const memeColor" src/dashboard/server.js
```
Expected: 1 (the const at ~line 9648 still there).

```bash
grep -n "memeColor" src/dashboard/server.js
```
Expected: shows references at lines ~9648 (const), ~9778, ~9781 (usages of the const). The function definition is gone, and the comment at line 8241 (if it was a comment about the function) may also be gone or still there — both acceptable.

- [ ] **Step 5: SPA validation gate**

```bash
npm run check:spa
```
Expected: exit 0.

If exit 1 — REVERT immediately. This task is the most position-sensitive; verify via `node scripts/check-dashboard-spa.cjs` for verbose output.

- [ ] **Step 6: NO COMMIT.**

---

## Task 7: Update SESSION_CONTEXT.md useEffect count (QUAL-013, conditional)

**Files:**
- Modify (conditional): `ai-context/SESSION_CONTEXT.md`

This task is CONDITIONAL — only execute the edit if the drift exists.

- [ ] **Step 1: Check if drift exists**

```bash
grep -nE "8 useEffect|8 use[Ee]ffect" ai-context/SESSION_CONTEXT.md
```

**If zero matches** — no drift to fix (perhaps already resolved by Stage 12 sync-pass). Report DONE_WITH_CONCERNS noting the conditional was a no-op. Skip remaining steps.

**If matches found** — proceed to step 2.

- [ ] **Step 2: Read the surrounding context**

```bash
sed -n 'N-3,N+3p' ai-context/SESSION_CONTEXT.md
```
(N = line from step 1.)

Confirm it's about CatMascot useEffects count. If it's about something else — STOP, the grep matched something unrelated; don't edit.

- [ ] **Step 3: Apply Edit**

`old_string` = the line containing `8 useEffect` (with full context for uniqueness — include the preceding 2-3 words).
`new_string` = same line with `8` replaced by `11`.

Example:
- `old_string`: `CatMascot имеет 8 useEffects`
- `new_string`: `CatMascot имеет 11 useEffects`

(Adjust to actual text in the file.)

- [ ] **Step 4: Verify**

```bash
grep -c "11 useEffect" ai-context/SESSION_CONTEXT.md
```
Expected: ≥ 1.

```bash
grep -c "8 useEffect" ai-context/SESSION_CONTEXT.md
```
Expected: 0 (no stale mentions remain in CatMascot context — if other "8 useEffect" appears in unrelated context, that's a false positive — verify before declaring task done).

- [ ] **Step 5: Scope check**

```bash
git status --short ai-context/SESSION_CONTEXT.md
```
Expected: ` M ai-context/SESSION_CONTEXT.md`.

- [ ] **Step 6: NO COMMIT.**

---

## Task 8: Annotate WORKLOG_ARCHIVE.md R4 entry (SD-14)

**Files:**
- Modify: `ai-context/WORKLOG_ARCHIVE.md` (R4 entry, 2026-05-20 area)

- [ ] **Step 1: Find the R4 dashboard-iconography entry**

```bash
grep -nE "R4|iconography" ai-context/WORKLOG_ARCHIVE.md | head -10
```

Look for the entry header — likely `## 2026-05-20 · sonnet · R4` or similar. Note the line number.

If the R4 entry isn't found in WORKLOG_ARCHIVE — check WORKLOG.md first (maybe it wasn't rotated yet). If neither has R4 — report BLOCKED with details.

- [ ] **Step 2: Read the R4 entry to find a good annotation point**

```bash
sed -n 'N,N+30p' ai-context/WORKLOG_ARCHIVE.md
```
(N = R4 entry start line.)

Look for the **Цель** or **Результат** section, or a line that overstates "iconography sweep complete" / "all emoji replaced" / similar. The annotation should clarify reality.

- [ ] **Step 3: Apply Edit — add annotation**

Use Edit tool. The annotation should clarify partial coverage. Place it as an inline note within the entry (NOT as a separate entry — preserves archive structure).

Option A — annotate inside an existing line:
- Find a line in the entry that overstates completion (e.g., "iconography sweep covers all glyphs")
- Edit to add `(~85% coverage; 18 emoji remain в i18n strings + inline JSX — see UX-003 in Stage 6 audit)` after the overstating phrase

Option B — add a new bullet at the bottom of the entry:
- Find the last bullet in **Файлы** or **Результат** section
- Append: `- **Note (Bundle #19, 2026-06-06)**: iconography sweep covered ~85% of glyphs; 18 emoji remain in i18n strings + inline JSX (per UX-003 Stage 6 audit). Cleanup deferred to future bundle.`

Operator preference: Option B (cleaner, doesn't rewrite original text). Use Option B.

`old_string` = the last line of the R4 entry before the closing `---` separator.
`new_string` = same line + Option B annotation bullet.

- [ ] **Step 4: Verify**

```bash
grep -c "85% coverage\|18 emoji remain\|Bundle #19" ai-context/WORKLOG_ARCHIVE.md
```
Expected: ≥ 1.

- [ ] **Step 5: Scope check**

```bash
git status --short ai-context/WORKLOG_ARCHIVE.md
```
Expected: ` M ai-context/WORKLOG_ARCHIVE.md`.

- [ ] **Step 6: NO COMMIT.**

---

## Task 9: Operator — local smoke test + WORKLOG entry

**Files:**
- No code changes
- Add: WORKLOG entry to `ai-context/WORKLOG.md`

This task is operator-driven.

- [ ] **Step 1: Final full SPA check**

```bash
npm run check:spa
```
Expected: exit 0, both `OK` messages.

This is a final sanity check after all 6 server.js edits combined.

- [ ] **Step 2: Local dev server smoke**

```bash
npm run dev
```

Watch the startup output. Expected: no syntax warnings, no "ReferenceError", server listens on port 8080 (or whatever DASHBOARD_PORT is).

Stop the server (Ctrl+C).

- [ ] **Step 3: Open dashboard in browser**

Open `http://localhost:8080` (or wherever local dev server runs). Quick visual check:
- Page loads without console errors (F12 → Console)
- Theme system works (try toggling pulse / ink / tide via UI if available)
- No obvious visual regression (toolbar areas, font / monospace text where `.kbd` might have been styled)

If any error — investigate before continuing. Likely one of T1-T6 broke something the SPA validator didn't catch.

- [ ] **Step 4: Add WORKLOG entry**

At the top of `ai-context/WORKLOG.md` (right after the `---` separator on line 12, BEFORE the existing top entry), insert this new entry. Adjust dates if implementation happens on a different day.

```markdown
## 2026-06-06 · sonnet · Bundle #19 — Dead code cleanup (QUAL-005/006/007/011/013 + SD-14/23)

**Цель**: удалить мёртвый код в dashboard SPA (~24 LOC) + 1 stale CSS comment update + 2 doc annotations. Tier 2 #19 из `docs/audit/INDEX.md` — самый высокий ROI (7.0) в Tier 2.

**Контекст**: Stage 11 audit пометил функции и CSS классы оставшиеся от прошлых iterations (R4 redesign + ранние UX experiments). Haiku-grep валидация подтвердила 0 actual usages для всех dead items. Pure polish работа после foundation Tier 1 (Bundle #1/#16/#17).

**Метод**: brainstorm (`docs/superpowers/specs/2026-06-06-dead-code-cleanup-design.md`) → 9-task plan (`docs/superpowers/plans/2026-06-06-dead-code-cleanup.md`), subagent-driven T1-T8, operator T9. Per-task SPA validation gate (Bundle #16 `npm run check:spa`) после каждого `src/dashboard/server.js` edit — раннее обнаружение SPA-trap.

**Файлы**:
- `src/dashboard/server.js` (~-24 LOC + ~3 lines updated):
  - Updated CSS theme comment (lines ~2636-2638): "2 dark themes" → "3 themes (pulse default + ink + tide)" — QUAL-005 + SD-23
  - Deleted `.toolbar` CSS class (5 LOC) — QUAL-007 part 1
  - Deleted `.kbd` CSS class (1 LOC) — QUAL-007 part 2
  - Deleted `lifespanLabel()` function (~6 LOC) — QUAL-006 part 1
  - Deleted `memeClass()` function (~6 LOC) — QUAL-006 part 2
  - Deleted `memeColor()` function (~6 LOC) — QUAL-006 part 3 (const `memeColor` на line ~9648 сохранён — used by lines 9778/9781)
- `ai-context/SESSION_CONTEXT.md` (conditional): useEffect count drift fixed if existed (8→11) — QUAL-013
- `ai-context/WORKLOG_ARCHIVE.md`: R4 entry annotation о ~85% coverage / 18 emoji remain (per UX-003) — SD-14

**Verification**:
- SPA check после каждого server.js edit (6 раз) → exit 0
- Final full SPA check → exit 0
- Local dev server startup clean, no syntax warnings
- Browser smoke: dashboard loads, no console errors, theme system works

**Closed findings**:
- QUAL-005 (CSS theme comment updated to 3 themes)
- QUAL-006 (3 dead functions deleted)
- QUAL-007 (2 dead CSS classes deleted)
- QUAL-011 (shadow risk resolved — only const memeColor remains, no function shadow)
- QUAL-013 (useEffect count drift fixed, if applicable)
- SD-14 (WORKLOG_ARCHIVE R4 annotation about partial coverage)
- SD-23 (resolved together with QUAL-005)

**Tier 2 progress**: Bundle #19 closed (first of Tier 2). Tier 2 remaining: #2 audit log persistence (~4h), #3 URL safety (~2h), #11 A11y sprint (~4h), #13 error visibility (~4h). Total ~14h ahead.

**Риски/заметки**:
- SPA validation gate отработал — каждый edit прошёл `npm run check:spa` без revert'ов (если revert'ы случались — фиксируется здесь).
- Const `memeColor` на line ~9648 сохранён — verified не сломан после function delete.
- T7 (SESSION_CONTEXT useEffect) был **conditional**: если drift не было — task no-op (Stage 12 sync-pass возможно уже его починил).
- `docs/superpowers/plans/2026-05-20-dashboard-iconography.md` упоминает "line ~7715" — после ~80 LOC deletes этот reference устарел. Не fix'ил per spec (historical plan).

---
```

- [ ] **Step 5: NO COMMIT (operator decides when to commit Bundle #19 changes).**

---

## Self-Review

After writing the plan, verifying against the spec:

**Spec coverage check:**

| Spec acceptance item | Task | Status |
|---|---|---|
| Delete `lifespanLabel()` | T4 | covered |
| Delete `memeClass()` | T5 | covered |
| Delete `memeColor()` function (NOT const) | T6 | covered (explicit const-stays verification) |
| Delete `.toolbar` CSS | T2 | covered |
| Delete `.kbd` CSS | T3 | covered |
| Update CSS theme comment | T1 | covered |
| SESSION_CONTEXT useEffect count (conditional) | T7 | covered (conditional check first) |
| WORKLOG_ARCHIVE R4 annotation | T8 | covered |
| SPA check after each server.js edit | T1-T6 each have SPA gate | covered |
| Final full SPA check | T9 step 1 | covered |
| Local dev smoke | T9 steps 2-3 | covered |
| WORKLOG entry | T9 step 4 | covered |

All spec items covered.

**Placeholder scan**: No "TBD" / "TODO" / vague directives. Some N-placeholder line numbers are intentional (subagent reads file first to find current N, since edits shift lines).

**Type/name consistency**:
- `npm run check:spa` — consistent SPA validation command
- `memeColor` distinction: "function" vs "const" — explicit throughout
- Closed findings list — consistent across spec, plan, WORKLOG template
- Edit pattern: read → confirm anchor → Edit → verify grep → SPA gate — consistent T1-T6

Plan is self-consistent and matches spec.

---

## Execution Notes

- T1-T8 subagent-driven, T9 operator-driven
- **Per-task model selection**:
  - T1-T6 (server.js edits): sonnet (precise + safety-critical)
  - T7-T8 (doc edits): haiku (mechanical text)
- **Total elapsed time**: ~1h subagent dispatches + ~10 min operator smoke

**Operator preferences honored**:
- No commits by subagents
- SPA gate after each server.js edit (matches Bundle #16 contract)
- No commenting-out blocks deleted (per spec — may be intentional reminders)
- No line-ref updates in historical plans
- Conditional T7 — no false-positive edits if drift already resolved

**Risks acknowledged**:
- If T6 (memeColor function) incorrectly matches the const — verification step explicitly grep-counts const survival. Revert if const goes away.
- If SPA validator itself breaks on a clean code — investigate validator before assuming SPA broke.
- If T7 grep returns false positive on unrelated "8 useEffect" — context-read step catches it.
