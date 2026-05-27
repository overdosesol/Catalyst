# A11y Sprint Bundle — Design Spec

**Bundle**: #11 из `docs/audit/INDEX.md` (Tier 2)
**Date**: 2026-05-28
**Author**: brainstorm session (operator + sonnet, operator delegated per «решай сам»)
**Status**: Approved scope (approach A — dashboard SPA only, all 7 findings), ready for writing-plans

---

## Goal

Закрыть 7 audit finding'ов accessibility в dashboard SPA: focus trap для 5 modals, semantic landmarks, skip link, heading hierarchy, role+tabIndex+keyDown для 2 clickable divs, `aria-hidden="true"` для CatMascot, расширение `prefers-reduced-motion` media query на CatMascot animations. **NO admin SPA changes** (out of audit scope для этого bundle).

## Context

### Findings (7)

- **UX-002 [HIGH]** — Focus trap отсутствует во ВСЕХ modals. Keyboard Tab escapes modal backdrop → focus уходит на background элементы. 5 modal wrappers (Lightbox, TrendModal, SettingsPanel, AccountPanel, AnalyzePanel) не трапят focus.
- **UX-006 [HIGH]** — 2 clickable divs без `role="button"` / `tabIndex`: `.top-item` (line 9913, TrendList narratives) и `.session-chip` (line 11303, hero Stats chip). Screen reader не announce как button, keyboard Tab skip'ает.
- **UX-012 [MEDIUM]** — Нет semantic landmarks (header/main/nav/aside). Все wrappers через `<div>`. Top-level App JSX: `dashboard-grid` > `left-sidebar` + `main-panel` + `right-panel-sticky` — все divs.
- **UX-013 [MEDIUM]** — Heading hierarchy: только h1 на login (line 12344). Section titles (`right-section-title` — line 9906, `modal-section-label` — lines 10112+10172) рендерятся через `<div>`/`<span>`.
- **UX-017 [LOW]** — Нет skip link. Keyboard user первым focusable должен иметь "Skip to content" → `<main>`.
- **CAT-001 [MEDIUM]** — `.cat-mascot` div без `aria-hidden="true"`. Screen reader announce decorative cat без accessible name. Definition line 12776, JSX render line ~13139.
- **CAT-008 [LOW]** — `prefers-reduced-motion` media query exists (line 5992-5995) но покрывает ТОЛЬКО feed-refresh animation. CatMascot имеет 8+ keyframe animations (`catIdleLoop`, `catCuteLoop`, `catHeadUpLoop`, etc. — lines 3855-4175) которые НЕ под gating.

### Existing infrastructure

- **Dashboard SPA**: `src/dashboard/server.js`, inline React template literal. Root mount at line 14496: `ReactDOM.createRoot(document.getElementById('root')).render(h(App));`. `App` component at line 13199.
- **App top-level JSX** (lines 13199-14495): returns `h('div', { className: 'dashboard-grid' }, leftSidebar, mainPanel, rightPanel, modals...)`. 3 main column divs are landmark candidates.
- **Existing a11y baseline**: 6 `role=` usages (e.g., `role: 'listbox'`, `role: 'dialog'` for sheets at line 11680), 25 `aria-*` usages (e.g., `aria-expanded`, `aria-checked`). **0** `tabIndex`. **0** semantic HTML tags. **0** skip links. **0** focus management code (`focus()` / `useRef`).
- **CatMascot animations** (`.cat-mascot` CSS, lines 3855-4175): 8 keyframe `animation:` rules per FSM state — all infinite loops. Plus `filter: drop-shadow(...)` with red glow.
- **Existing `prefers-reduced-motion`** (line 5992-5995): covers только feed refresh animation (3 selectors).
- **Modals (5 total)**:
  - Lightbox (line 8958, React.Portal, props: `{ src, onClose }`)
  - TrendModal (root JSX line 10530, props: `{ trend, onClose, isAdmin, ... }`, uses `modal-overlay` + `modal-drawer` classes)
  - SettingsPanel (line 11742, props: `{ onBack, onResetHiddenSources, hiddenSourcesCount }`)
  - AccountPanel (line 12183, props: `{ onBack, user, onLogout }`)
  - AnalyzePanel (line 11322, props: `{ onBack, onOpenTrend }`)

### Defense-in-depth

Bundle #3 + #13 added inline helpers (`safeHref`, `ErrorBanner`) в SPA template — same pattern для `useFocusTrap` hook.

---

## Scope

### In-scope

**1. `useFocusTrap(containerRef, isOpen)` hook inline в SPA template** (~50 LOC)
- Placement: после Bundle #13's `ErrorBanner` component (~line 7170 area).
- Behavior:
  - On `isOpen` → `true`: capture `document.activeElement` as opener. Find first focusable in container, focus it.
  - On Tab key in container: cycle focus (last → first). On Shift+Tab: reverse cycle.
  - On `isOpen` → `false`: restore focus to opener.
- Focusable selector: standard `button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])`.

**2. Apply focus trap к 5 modals**
- Each modal: add `const modalRef = useRef(null);` + `useFocusTrap(modalRef, true)` (always open while mounted) + `ref={modalRef}` на root div.
- Modals affected: Lightbox, TrendModal, SettingsPanel, AccountPanel, AnalyzePanel.

**3. Semantic landmarks (UX-012)**
- App root JSX (line ~13199): wrap top-level divs in semantic tags. **NO CSS class changes** — only tag name swap.
- Changes:
  - `<div className="left-sidebar">` → `<aside className="left-sidebar" aria-label="Navigation">`
  - `<div className="main-panel">` → `<main className="main-panel" id="main-content">` (id для skip link target)
  - `<div className="right-panel-sticky">` → `<aside className="right-panel-sticky" aria-label="Top narratives">`
- Outer `<div className="dashboard-grid">` stays as `<div>` (it's a grid layout container, not a landmark).

**4. Skip link (UX-017)**
- Insert as FIRST child of `dashboard-grid` root div (before all panels).
- JSX: `h('a', { href: '#main-content', className: 'skip-link' }, 'Skip to content')`.
- CSS: `position: absolute; left: -9999px; top: 0;` until `:focus` → `left: 8px; top: 8px; padding: 8px 12px; background: var(--card); color: var(--text); z-index: 99999;`.

**5. Heading hierarchy (UX-013)**
- `<span className="right-section-title">` → `<h2 className="right-section-title">` (line 9906).
- `<div className="modal-section-label">` → `<h3 className="modal-section-label">` (lines 10112, 10172 — nested inside modal).
- Keep ALL existing className styling. Browser default heading margins overridden by class CSS (verify SPA gate catches no visual regression — CSS rules use className not tag selectors).

**6. Clickable divs fix (UX-006)**
- `.top-item` (line 9913) — current: `h('div', { key: tr.id, className: 'top-item', onClick: () => onOpenTrend && onOpenTrend(tr) }, ...)`. Add `role: 'button'`, `tabIndex: 0`, `onKeyDown` (Enter/Space).
- `.session-chip` interactive variant (line 11303) — current: `h('div', { className: 'session-chip', style: { cursor: 'pointer' }, onClick: onOpenStats }, ...)`. Same pattern.
- Other `.session-chip` instances (lines 11294, 11297, 11300) — NON-interactive (no onClick) — leave alone.

**7. CatMascot a11y (CAT-001)**
- JSX (line ~13139): add `'aria-hidden': 'true'` к root div.

**8. CatMascot reduced-motion (CAT-008)**
- Extend existing `@media (prefers-reduced-motion: reduce)` block at line 5992-5995. Add:
  ```css
  .cat-mascot,
  .cat-mascot * { animation: none !important; transition: none !important; }
  ```
- Cat still visible (drop-shadow + sprite still renders), just no animation loops.

**9. Docs**
- `ai-context/SESSION_CONTEXT.md` — bullet в Production posture.
- `ai-context/WORKLOG.md` — Bundle #11 entry.

### Out-of-scope

- **Admin SPA a11y** (0 baseline, requires 50+ edits, NOT in finding list). Defer.
- **Color contrast audit** (separate finding territory — UX-005 is i18n strict mode, не contrast).
- **Screen reader live regions** (`aria-live`) — would benefit feed updates but not in findings.
- **Form labels audit** — login form already labeled via existing patterns; not specifically flagged.
- **Tests / axe-core** — нет test infra (consistent с прошлыми bundles).
- **Manual screen reader QA** — operator's discretion post-deploy.

---

## Architecture

### Files affected

| File | Action | Detail |
|---|---|---|
| `src/dashboard/server.js` | modify | (a) `useFocusTrap` hook inline в SPA template after ErrorBanner (~line 7170); (b) 5 modal components add `ref` + `useFocusTrap(ref, true)`; (c) App root JSX top-level divs swap to semantic tags; (d) skip link first child of dashboard-grid; (e) 2 section titles swap to `<h2>`/`<h3>`; (f) 2 clickable divs add role/tabIndex/onKeyDown; (g) CatMascot JSX add `aria-hidden`; (h) CSS: skip-link + extend reduced-motion. |
| `ai-context/SESSION_CONTEXT.md` | modify | +1 bullet |
| `ai-context/WORKLOG.md` | modify | Bundle #11 entry |

**NOT touched**: `src/admin/server.js`, any other source.

---

## Implementation details

### `useFocusTrap` hook (inline в SPA template)

```javascript
// ── Focus trap hook (Bundle #11, 2026-05-28) ────────────────────────────
// useFocusTrap(containerRef, isOpen) — trap Tab cycle inside container
// while isOpen=true. On unmount or isOpen=false, restore focus to the
// element that was focused when the trap was first activated.
//
// Usage: const ref = useRef(null);
//        useFocusTrap(ref, true);
//        ... h('div', { ref, ... }, ...) ...
function useFocusTrap(containerRef, isOpen) {
  const returnRef = useRef(null);
  useEffect(() => {
    if (!isOpen) return;
    returnRef.current = document.activeElement;
    const container = containerRef.current;
    if (!container) return;
    const sel = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const getFocusable = () => Array.from(container.querySelectorAll(sel)).filter(el => el.offsetParent !== null);
    // Focus first focusable on open.
    const initial = getFocusable();
    if (initial.length > 0) initial[0].focus();
    const handler = (e) => {
      if (e.key !== 'Tab') return;
      const focusable = getFocusable();
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    container.addEventListener('keydown', handler);
    return () => {
      container.removeEventListener('keydown', handler);
      if (returnRef.current && typeof returnRef.current.focus === 'function') {
        try { returnRef.current.focus(); } catch (e) { /* element gone */ }
      }
    };
  }, [isOpen]);
}
```

### Modal wiring pattern

For each of 5 modals — inside the component body, add:

```javascript
function TrendModal({ trend, onClose, ... }) {
  const modalRef = useRef(null);
  useFocusTrap(modalRef, true); // always trapped while modal is mounted
  return h('div', { 
    className: 'modal-overlay',
    onClick: e => { if (e.target === e.currentTarget) onClose(); },
  },
    h('div', { 
      className: 'modal-drawer',
      ref: modalRef,
    }, ...)
  );
}
```

Same pattern for Lightbox, SettingsPanel, AccountPanel, AnalyzePanel — attach `ref={modalRef}` to the inner panel/drawer div (the one containing actual focusable content).

### App root JSX semantic swap

Around line 13199, App component returns:

```javascript
// Before:
return h('div', { className: 'dashboard-grid' },
  h('div', { className: 'left-sidebar' }, ...),
  h('div', { className: 'main-panel' }, ...),
  h('div', { className: 'right-panel-sticky' }, ...),
  ...modals...
);

// After:
return h('div', { className: 'dashboard-grid' },
  h('a', { href: '#main-content', className: 'skip-link' }, 'Skip to content'),
  h('aside', { className: 'left-sidebar', 'aria-label': 'Navigation' }, ...),
  h('main', { className: 'main-panel', id: 'main-content' }, ...),
  h('aside', { className: 'right-panel-sticky', 'aria-label': 'Top narratives' }, ...),
  ...modals...
);
```

### Skip link CSS

Added to SPA template `<style>` block:

```css
    .skip-link {
      position: absolute;
      left: -9999px;
      top: 0;
      z-index: 99999;
      padding: 8px 14px;
      background: var(--card);
      color: var(--text);
      border: 1px solid var(--accent);
      border-radius: 6px;
      font-weight: 600;
      font-size: 13px;
      text-decoration: none;
    }
    .skip-link:focus {
      left: 8px;
      top: 8px;
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }
```

### Section title swaps

**Line 9906**:
```javascript
// Before:
h('span', { className: 'right-section-title' }, t('right.top_narratives')),
// After:
h('h2', { className: 'right-section-title' }, t('right.top_narratives')),
```

**Lines 10112 + 10172** (modal-section-label):
```javascript
// Before:
h('div', { className: 'modal-section-label' }, ...),
// After:
h('h3', { className: 'modal-section-label' }, ...),
```

### Clickable div fix pattern

**Line 9913** (`.top-item`):
```javascript
// Before:
h('div', { key: tr.id, className: 'top-item', onClick: () => onOpenTrend && onOpenTrend(tr) },
  ...
)

// After:
h('div', {
  key: tr.id,
  className: 'top-item',
  role: 'button',
  tabIndex: 0,
  onClick: () => onOpenTrend && onOpenTrend(tr),
  onKeyDown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenTrend && onOpenTrend(tr); } },
}, ...)
```

**Line 11303** (interactive `.session-chip`):
```javascript
// Before:
h('div', { className: 'session-chip', style: { cursor: 'pointer' }, onClick: onOpenStats },
  t('hero.stats')
)

// After:
h('div', {
  className: 'session-chip',
  role: 'button',
  tabIndex: 0,
  style: { cursor: 'pointer' },
  onClick: onOpenStats,
  onKeyDown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenStats && onOpenStats(); } },
}, t('hero.stats'))
```

### CatMascot a11y

**Line ~13139** (JSX render):
```javascript
// Before:
return h('div', {
  className: 'cat-mascot',
  'data-state': stateName,
  'data-route': route,
  'data-hidden': !isVisible ? 'true' : undefined,
  onMouseMove: ..., onMouseUp: ...,
  onClick: ...,
});

// After:
return h('div', {
  className: 'cat-mascot',
  'aria-hidden': 'true',
  'data-state': stateName,
  'data-route': route,
  'data-hidden': !isVisible ? 'true' : undefined,
  onMouseMove: ..., onMouseUp: ...,
  onClick: ...,
});
```

### CatMascot reduced-motion extension

**Line 5992-5995** — extend existing media query:

```css
// Before:
@media (prefers-reduced-motion: reduce) {
  .feed-panel.is-refreshing::before { animation: none; transform: scaleX(1); opacity: .5; }
  .feed-list.is-refreshing { opacity: 1; }
}

// After:
@media (prefers-reduced-motion: reduce) {
  .feed-panel.is-refreshing::before { animation: none; transform: scaleX(1); opacity: .5; }
  .feed-list.is-refreshing { opacity: 1; }
  /* CAT-008 (Bundle #11): disable CatMascot FSM animations for motion-sensitive users. */
  .cat-mascot,
  .cat-mascot * { animation: none !important; transition: none !important; }
}
```

---

## SESSION_CONTEXT.md update

```markdown
- **A11y compliance** (Bundle #11, 2026-05-28): focus trap для 5 modals (Lightbox, TrendModal, SettingsPanel, AccountPanel, AnalyzePanel) через inline `useFocusTrap(ref, isOpen)` hook в SPA template. Semantic landmarks (`<main id="main-content">`, `<aside>` x2). Skip link `<a href="#main-content">` first child of dashboard-grid с visible-on-focus CSS. Heading hierarchy: section titles теперь `<h2>` / `<h3>` (CSS class preserved). 2 clickable divs (`.top-item` + interactive `.session-chip`) теперь `role="button"` + `tabIndex={0}` + `onKeyDown` (Enter/Space). CatMascot: `aria-hidden="true"` на root div + `prefers-reduced-motion` extended на cat animations. **Admin SPA not touched** (out of audit scope). Closes UX-002, UX-006, UX-012, UX-013, UX-017, CAT-001, CAT-008.
```

---

## Verification plan

### Acceptance criteria

**Hook + modals**:
- [ ] `useFocusTrap` function defined inline в SPA template после ErrorBanner.
- [ ] All 5 modals use `useFocusTrap(modalRef, true)` + `ref={modalRef}` на inner panel.
- [ ] Manual smoke: open each modal, Tab cycles within modal, Shift+Tab reverse cycles, closing restores focus.

**Semantic landmarks**:
- [ ] App root JSX has `<aside>` + `<main>` + `<aside>` tags (NOT divs).
- [ ] `<main>` has `id="main-content"`.
- [ ] CSS classes unchanged on these elements.

**Skip link**:
- [ ] `<a href="#main-content" class="skip-link">Skip to content</a>` first child of `.dashboard-grid`.
- [ ] CSS: positioned offscreen by default, visible on `:focus`.

**Headings**:
- [ ] `right-section-title` → `<h2>` (line ~9906).
- [ ] `modal-section-label` → `<h3>` (lines ~10112+10172).
- [ ] Visual smoke: section titles look identical (CSS class drives styling).

**Clickable divs**:
- [ ] `.top-item` (line ~9913): role=button, tabIndex=0, onKeyDown.
- [ ] Interactive `.session-chip` (line ~11303): role=button, tabIndex=0, onKeyDown.

**CatMascot**:
- [ ] `aria-hidden="true"` on root div.
- [ ] Reduced-motion CSS extended.

**SPA validation gate (CRITICAL)**:
- [ ] After EACH `src/dashboard/server.js` edit: `npm run check:spa` exit 0.
- [ ] Final full SPA check: exit 0.

**Operator smoke (post-deploy)**:
- [ ] Open dashboard. Tab through page from top — first focus = skip link → second focus = first content control. Click skip link → focus moves to `<main>`.
- [ ] Open Settings modal → Tab cycles inside, Shift+Tab reverse cycles, Esc closes + focus restored to opener.
- [ ] Same for Account, Analyze, Lightbox, TrendModal.
- [ ] Test screen reader (optional): VoiceOver/NVDA announces `<main>` landmark, `<aside>` regions, h2/h3 hierarchy.
- [ ] Browser DevTools → Rendering panel → Emulate `prefers-reduced-motion: reduce` → CatMascot animations stop.
- [ ] Tab onto `.top-item` (any narrative in right sidebar) → press Enter → trend opens.

### Closed findings

- UX-002 (focus trap)
- UX-006 (clickable divs)
- UX-012 (semantic landmarks)
- UX-013 (heading hierarchy)
- UX-017 (skip link)
- CAT-001 (aria-hidden)
- CAT-008 (reduced-motion extension)

---

## Risks & mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Tag swap (div → main/aside) breaks CSS selectors targeting `div.left-sidebar` | low | Project uses class selectors почти везде — verify via Grep `^\s*div\.(left-sidebar|main-panel|right-panel-sticky)` in CSS. Manual visual smoke after each edit. |
| `<h2>`/`<h3>` adds browser default margins → layout shift | low | CSS classes override margins. SPA gate catches no parse issue. Visual smoke catches layout shift if any (operator). |
| `useFocusTrap` focuses element that's hidden behind animation | low | `getFocusable` filters `offsetParent !== null` (excludes display:none and parent-hidden elements). |
| Focus trap breaks if modal content updates mid-trap (e.g., new buttons appear) | low | `getFocusable()` called on each Tab event — fresh DOM query. Acceptable. |
| Edit на SPA template breaks (backtick trap) | medium | `npm run check:spa` after each edit. Proven in 4 prior bundles. |
| Reduced-motion break SPA inline `<style>` block syntax | low | CSS extension is pure static — no backticks, no `${...}`. SPA gate catches. |
| Skip link confuses sighted users if visible by default | low | CSS keeps it offscreen until `:focus`. Standard pattern. |
| New `useRef` calls in modals conflict with existing ref usage | low | Existing dashboard SPA has 0 `useRef` calls (per exploration). Greenfield. |

---

## Estimated effort

| Component | Time |
|---|---|
| `useFocusTrap` hook + SPA gate | 25 min |
| 5 modal ref wirings + SPA gate | 30 min |
| App root semantic swap + skip link + CSS + SPA gate | 25 min |
| 2 section title swaps + SPA gate | 15 min |
| 2 clickable div fixes + SPA gate | 15 min |
| CatMascot aria + reduced-motion CSS + SPA gate | 15 min |
| `SESSION_CONTEXT.md` + WORKLOG entry | 15 min |
| Operator: deploy + manual smoke (5 scenarios) | 30 min |
| **Total** | **~3.5h** |

Audit estimate was ~4h. Matches.

---

## Open questions

All resolved per operator delegation:

- Q1: Admin SPA included? → **No** (out of audit scope; admin has 0 a11y baseline, separate scope).
- Q2: Focus trap library (focus-trap-react, focus-trap, etc.) или roll-own? → **Roll-own** inline hook (~50 LOC; matches inline duplication pattern of Bundle #3 + #13).
- Q3: Skip link text — Russian or English? → **English "Skip to content"** (matches international a11y convention; assistive tech often expects English keywords). Could add i18n later.
- Q4: All `.session-chip` instances or only interactive one? → **Only interactive one** (line 11303 — has `onClick`). Display-only chips (lines 11294-11300) — leave alone.
- Q5: Heading levels — h2 for right-section, h3 for modal-section? → **Yes** (right-section is page-level, modal-section is nested). Login h1 stays as h1.
- Q6: All CatMascot transitions or only animations? → **Both** (`animation: none !important; transition: none !important;`) — comprehensive reduced-motion.
- Q7: Tests / TDD? → **No** (no existing test infra; SPA gate + manual smoke = verification).

---

## Transition

После approve этого spec — invoke `superpowers:writing-plans` для генерации implementation plan с per-task SPA gates.
