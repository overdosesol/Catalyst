# Dashboard Sort Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the icon-only 5-button horizontal Sort segmented control in the sidebar with a 4-option vertical chip list (icon + label per chip, accent-fill active state), drop the `virality` option.

**Architecture:** Two CSS classes (`.sort-list` container + `.sort-chip` item, reusing `.phase-badge` neutral pattern + `.badge-catalyst` accent-fill pattern, both already in the stylesheet). JSX swap from `seg-group seg-compact` to `sort-list`. `sort.virality` i18n strings removed from EN + RU. Backend `sortParam === 'virality'` branch kept as legacy-tolerance (marked with comment) so old shared URLs still resolve to a sensible ordering. All edits live in `src/dashboard/server.js` — the inline-React SPA file.

**Tech Stack:** Node.js + inline React (via `h()` from a CDN script tag) — no bundler. Edits via `Edit` on the giant template literal containing CSS + JSX + i18n. `node scripts/check-dashboard-spa.cjs` is the gate: validates the template literal still parses after every edit.

**Spec:** `docs/superpowers/specs/2026-05-20-dashboard-sort-redesign-design.md`

---

## Critical: SPA-Trap Discipline

`src/dashboard/server.js` is a Node HTTP server that ships a giant template literal containing the entire dashboard SPA (HTML + CSS + JSX + JS). A stray backtick anywhere inside the SPA body closes the outer template literal prematurely and produces a blank-page deploy.

**Rules for every edit in this plan:**
1. **No backticks (`) inside the SPA body — especially in comments.** If you want to mention a variable name in a comment, use single or double quotes: `'kind'`, `"kind"`. Never `` `kind` ``.
2. After every Edit, run `node scripts/check-dashboard-spa.cjs` and verify exit code 0 before commit.
3. If the check fails: read its output, find the line, fix the backtick, re-check. Do not commit broken.

This was caught 4 times during R4. Treat it as a hard rule, not a guideline.

---

## File Structure

Single file touched for code: `src/dashboard/server.js`.

| Section | Approximate line | Change |
| --- | --- | --- |
| CSS — after `.phase-badge` block | ~3716 | Add `.sort-list` + `.sort-chip` + states |
| Backend — sort param parser | ~1059 | Add legacy-tolerance comment (no behavior change) |
| i18n — EN `sort.*` block | ~6917 | Remove `'sort.virality': 'Virality',` |
| i18n — RU `sort.*` block | ~7347 | Remove `'sort.virality': 'Виральность',` |
| JSX — sidebar Sort filter group | ~13287–13305 | Replace `seg-group` with `sort-list` chip list |

Other file: `ai-context/WORKLOG.md` (append entry on top).

---

## Task 1: CSS — Add `.sort-list` and `.sort-chip` styles

**Files:**
- Modify: `src/dashboard/server.js:3716` (insert after `.phase-badge` closing brace, before `/* ── Badges ── */`)

**What this delivers:** The CSS for the new chip list, available but not yet rendered (no JSX wired up). Verifies the rules parse, the SPA still loads, no class collisions.

- [ ] **Step 1: Verify no existing `.sort-chip` / `.sort-list` class**

Run:
```bash
grep -n "sort-chip\|sort-list" "src/dashboard/server.js"
```

Expected: no output (the classes don't exist yet).

- [ ] **Step 2: Insert the new CSS block**

Use `Edit` on `src/dashboard/server.js`:

`old_string`:
```
    .phase-badge {
      display: inline-flex; align-items: center; gap: 4px;
      padding: 3px 8px; border-radius: var(--r1);
      font-size: 10px; font-weight: 600; letter-spacing: .2px;
      white-space: nowrap; flex-shrink: 0;
      background: var(--surface2);
      color: var(--text);
      border: 1px solid var(--border);
    }

    /* ── Badges ── */
```

`new_string`:
```
    .phase-badge {
      display: inline-flex; align-items: center; gap: 4px;
      padding: 3px 8px; border-radius: var(--r1);
      font-size: 10px; font-weight: 600; letter-spacing: .2px;
      white-space: nowrap; flex-shrink: 0;
      background: var(--surface2);
      color: var(--text);
      border: 1px solid var(--border);
    }

    /* ── Sort list (sidebar) — 2026-05-20 R5 ──
       Replaced the 5-icon seg-control. Each option is a chip styled like
       .phase-badge / .badge-atype-* (neutral surface2 + 1px border). Active
       chip uses the .badge-catalyst accent-fill pattern. All colors flow
       through theme tokens (--accent / --accent-rgb), so theme switch works. */
    .sort-list {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .sort-chip {
      display: flex; align-items: center; gap: 8px;
      padding: 7px 10px;
      font-size: 13px; font-weight: 500;
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

    /* ── Badges ── */
```

- [ ] **Step 3: SPA syntax check**

Run:
```bash
node scripts/check-dashboard-spa.cjs
```

Expected: exit code 0, message like `dashboard SPA OK`. If it fails (`Unexpected ...` error), inspect the output line number, fix the backtick or syntax issue, re-run before continuing.

- [ ] **Step 4: Verify class is now reachable**

Run:
```bash
grep -n "\.sort-chip\b\|\.sort-list\b" "src/dashboard/server.js"
```

Expected: 5 matches — `.sort-list`, `.sort-chip`, `.sort-chip:hover`, `.sort-chip.active`, `.sort-chip:focus-visible`.

- [ ] **Step 5: Commit**

```bash
git add src/dashboard/server.js
git commit -m "feat(dashboard): r5 — add .sort-list and .sort-chip CSS"
```

---

## Task 2: JSX — Replace `seg-group` Sort block with `sort-list`

**Files:**
- Modify: `src/dashboard/server.js:13286–13305`

**What this delivers:** The sidebar Sort filter renders the 4 new chips with full labels. Active chip = accent fill. Virality button is gone from the UI.

- [ ] **Step 1: Confirm current JSX block matches expected before edit**

Run:
```bash
grep -n "'bar-chart-3'" "src/dashboard/server.js"
```

Expected: a single match around line 13295 (the `virality` row). If multiple matches or different line, stop and reconcile before continuing.

- [ ] **Step 2: Replace the JSX block**

Use `Edit` on `src/dashboard/server.js`:

`old_string`:
```
              // Sort order (segmented icons) — 2026-05-20 R4 — icon-name keys.
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

`new_string`:
```
              // Sort order — 2026-05-20 R5 — vertical chip list with full
              // labels. Each option is a sort-chip styled like phase-badge;
              // active chip uses .badge-catalyst accent-fill tokens. Virality
              // option dropped: it duplicated rank (composite score DESC).
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

**Backtick discipline check before saving:** Scan your `new_string` once more — there must be zero backticks anywhere inside it. Comment text uses plain hyphen-phrases only (no quoted identifiers). If you see one, remove it before applying the Edit.

- [ ] **Step 3: SPA syntax check**

Run:
```bash
node scripts/check-dashboard-spa.cjs
```

Expected: exit code 0. If it fails, the most common cause is a stray backtick in the comment block — open the line shown in the error, remove backticks, re-run.

- [ ] **Step 4: Verify Virality is no longer referenced in the JSX**

Run:
```bash
grep -n "virality" "src/dashboard/server.js"
```

Expected matches:
- Line ~1059: `else if (sortParam === 'virality')  orderBy = 'score DESC';` (backend, untouched — kept as legacy-tolerance, will get a comment in Task 3)
- Line ~6917: `'sort.virality': 'Virality',` (EN i18n, removed in Task 3)
- Line ~7347: `'sort.virality': 'Виральность',` (RU i18n, removed in Task 3)
- Other references in i18n term descriptions (`term.virality`) and modal copy — these describe the *concept* virality, not the sort option. They remain.

If you see `'virality'` as a sort `v:` value or a `bar-chart-3` icon reference, the Edit didn't apply correctly — revert and re-try.

- [ ] **Step 5: Commit**

```bash
git add src/dashboard/server.js
git commit -m "feat(dashboard): r5 — sidebar Sort = vertical chip list (drop virality)"
```

---

## Task 3: Cleanup — Remove `sort.virality` i18n + mark backend branch

**Files:**
- Modify: `src/dashboard/server.js:6917` (EN i18n)
- Modify: `src/dashboard/server.js:7347` (RU i18n)
- Modify: `src/dashboard/server.js:1058–1059` (backend comment only)

**What this delivers:** Dead i18n strings removed. Backend branch gains a comment marking it as legacy-tolerance so future readers don't try to "clean it up" without understanding why it's there.

- [ ] **Step 1: Remove EN `sort.virality` string**

Use `Edit` on `src/dashboard/server.js`:

`old_string`:
```
    'sort.rank': 'Rank',
    'sort.meme': 'Top adoption',
    'sort.emergence': 'Top emergence',
    'sort.time': 'Newest',
    'sort.virality': 'Virality',
    'tooltip.hide_source': 'Hide from feed (visual only)',
```

`new_string`:
```
    'sort.rank': 'Rank',
    'sort.meme': 'Top adoption',
    'sort.emergence': 'Top emergence',
    'sort.time': 'Newest',
    'tooltip.hide_source': 'Hide from feed (visual only)',
```

- [ ] **Step 2: Remove RU `sort.virality` string**

Use `Edit` on `src/dashboard/server.js`:

`old_string`:
```
    'sort.rank': 'Рейтинг',
    'sort.meme': 'Топ adoption',
    'sort.emergence': 'Топ emergence',
    'sort.time': 'Свежие',
    'sort.virality': 'Виральность',
    'tooltip.hide_source': 'Скрыть из фида (визуально)',
```

`new_string`:
```
    'sort.rank': 'Рейтинг',
    'sort.meme': 'Топ adoption',
    'sort.emergence': 'Топ emergence',
    'sort.time': 'Свежие',
    'tooltip.hide_source': 'Скрыть из фида (визуально)',
```

- [ ] **Step 3: Mark backend sort branch as legacy-tolerance**

Use `Edit` on `src/dashboard/server.js`:

`old_string`:
```
    // Sort modes (no per-user personalization — removed 2026-04-27 along with
    // the per-category boost. Rank is now the same global ordering for everyone.)
    let orderBy;
    if      (sortParam === 'time')      orderBy = 'first_seen_at DESC';
    else if (sortParam === 'virality')  orderBy = 'score DESC';
```

`new_string`:
```
    // Sort modes (no per-user personalization — removed 2026-04-27 along with
    // the per-category boost. Rank is now the same global ordering for everyone.)
    // 2026-05-20 R5: dropped the 'virality' UI option (duplicated rank). The
    // branch below is kept as legacy-tolerance so old shared URLs still resolve
    // to a sensible ordering instead of falling through to default.
    let orderBy;
    if      (sortParam === 'time')      orderBy = 'first_seen_at DESC';
    else if (sortParam === 'virality')  orderBy = 'score DESC';
```

- [ ] **Step 4: SPA syntax check**

Run:
```bash
node scripts/check-dashboard-spa.cjs
```

Expected: exit code 0.

- [ ] **Step 5: Verify `sort.virality` is gone from i18n**

Run:
```bash
grep -n "sort.virality" "src/dashboard/server.js"
```

Expected: no output. (Both EN and RU strings removed; the dot is a regex metacharacter but matches a literal dot here too, so both `sort.virality` literal substrings should be gone.)

- [ ] **Step 6: Verify backend `'virality'` branch still exists and is annotated**

Run:
```bash
grep -n "legacy-tolerance" "src/dashboard/server.js"
```

Expected: one match, in the sort modes comment block around line 1057.

- [ ] **Step 7: Commit**

```bash
git add src/dashboard/server.js
git commit -m "chore(dashboard): r5 — drop sort.virality i18n + mark backend branch legacy"
```

---

## Task 4: WORKLOG entry + final verification sweep

**Files:**
- Modify: `ai-context/WORKLOG.md` (prepend new entry at top, after the heading section)

**What this delivers:** Project history captures R5. Final SPA check confirms nothing is broken end-to-end.

- [ ] **Step 1: Final SPA syntax check (sanity)**

Run:
```bash
node scripts/check-dashboard-spa.cjs
```

Expected: exit code 0. If this fails, something from an earlier task is broken — fix before logging.

- [ ] **Step 2: Verify only 4 sort options exist in the JSX list**

Run:
```bash
grep -nE "v: '(rank|meme|emergence|time|virality)'" "src/dashboard/server.js"
```

Expected: 4 matches (rank/meme/emergence/time). No `v: 'virality'` row.

- [ ] **Step 3: Verify `.seg-btn` / `.seg-group` CSS is still defined (other components use it)**

Run:
```bash
grep -nE "^\s*\.seg-(btn|group)\s*\{" "src/dashboard/server.js"
```

Expected: at least 3 matches (the CSS rule definitions are still there — we only stopped using them in the Sort group, other seg-controls like the Window selector and theme switcher still rely on them).

- [ ] **Step 4: Add WORKLOG entry**

Use `Edit` on `ai-context/WORKLOG.md`:

`old_string`:
```
---

## 2026-05-20 · sonnet · Dashboard redesign Round 4 — iconography sweep
```

`new_string`:
```
---

## 2026-05-20 · sonnet · Dashboard redesign Round 5 — Sort control rework

**Триггер**: после R4 фильтр Sort в сайдбаре остался как 5-кнопочный seg-control с одними иконками без подписей. Юзер: «непонятное и неудобное». Иконки (zap/gem/waves/clock/bar-chart-3) для sort-критериев не self-descriptive — каждый раз надо хувер. Плюс `virality` дублировал `rank` по смыслу (оба weighted by score).

### Что покрыто

3 коммита в `src/dashboard/server.js`:

1. **CSS** — добавил `.sort-list` (vertical flex container) + `.sort-chip` (idle: surface2 + neutral border, hover: чуть светлее, active: accent fill rgba(--accent-rgb,.14) + accent border .38 + accent text). Все колор-токены — существующие, theme-switch (pulse/ink/tide) flows through автоматически. Вставлено после `.phase-badge`, перед `── Badges ──`.
2. **JSX** — заменил `seg-group seg-compact` с 5 кнопками-иконками на `sort-list` с 4 button-chip'ами (icon 14px + полный label через `t()`). Active state — class toggle. Virality удалён из массива опций.
3. **Cleanup** — удалил `'sort.virality'` ключи (EN + RU). Backend `sortParam === 'virality'` ветка оставлена как legacy-tolerance с поясняющим комментарием — старые ссылки `?sort=virality` всё ещё резолвятся в `score DESC` (тот же ordering что и был), не ломаются.

### Архитектура

- **CSS pattern reuse**: idle = `.phase-badge` neutral pattern (surface2 + border), active = `.badge-catalyst` accent-fill pattern (rgba accent .14 + .38 border + accent text). Никаких новых токенов.
- **JSX**: native `<button>` остаётся — focus/keyboard/screen-reader без изменений. `title=` остаётся как fallback для tooltip (например для keyboard nav).
- **State**: `useState('rank')` не тронут. `setSort` вызывается только из Reset callback и chip onClick — стейл `'virality'` недостижим.

### Files

- `src/dashboard/server.js` — CSS (~30 строк), JSX block (~13287–13305), i18n EN (~6917) + RU (~7347) удаления, backend comment (~1057).
- `ai-context/WORKLOG.md` — этот entry.

### Деплой

Оператор делает сам через `deploy.ps1`. После деплоя визуально проверить все 3 темы (pulse/ink/tide) — accent цвет на active chip разный, надо убедиться что контраст ОК во всех.

### Риски / followups

- Theme `ink` (синий accent на тёмно-синем `--surface2`) — может быть слабый контраст. Проверить визуально, поднять alpha с .14 → .18 если нужно.
- Если в future захочется добавить новые сорт-критерии (impact, controversy) — просто добавляем элемент в массив, никакой реструктуризации.

---

## 2026-05-20 · sonnet · Dashboard redesign Round 4 — iconography sweep
```

- [ ] **Step 5: Commit WORKLOG**

```bash
git add ai-context/WORKLOG.md
git commit -m "docs(worklog): r5 — Sort control rework entry"
```

- [ ] **Step 6: Final summary check**

Run:
```bash
git log --oneline -5
```

Expected output: top 4 commits are the R5 sequence (CSS / JSX / cleanup / WORKLOG), then R4 follow-up `e8b4c59` underneath.

---

## Self-Review Checklist

Already run by the planner before handing off. For the implementer's awareness:

- **Spec coverage:** Each section of the spec maps to a task — CSS (§4.1) → Task 1; JSX (§4.2) → Task 2; i18n (§4.3) + Backend (§4.4) + state audit confirmation (§4.5) → Task 3; Acceptance gates (§7) → verification steps in Task 4. Edge cases (§6) verified by Task 4 grep steps (no `'virality'` in JSX options, `.seg-btn` CSS retained, backend branch retained).
- **Placeholders:** None — every Edit shows the exact `old_string` / `new_string`, every grep shows the expected output.
- **Type consistency:** Property names match the spec — `v` / `i` / `label` in the option objects, `sort-list` / `sort-chip` / `sort-chip.active` for CSS classes, exactly as used in JSX. Backend variable `sortParam` / `orderBy` unchanged.

## Risks the Implementer Should Know

- **SPA-trap** — see top of plan. Run `node scripts/check-dashboard-spa.cjs` after every Edit, zero tolerance for backticks in SPA-body comments.
- **Edit `old_string` uniqueness** — the EN and RU `sort.*` blocks differ (English vs Cyrillic labels), so the i18n removals in Task 3 will not collide. But verify visually before applying — if anything was hand-edited in between, the surrounding lines may differ.
- **Deploy** — operator deploys via `deploy.ps1` themselves. Do not attempt to deploy from within the plan execution.
