# Dashboard visual redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Перекатить визуал дашборда из текущего "AI-made / детского" языка в pro/trading-desk стиль через token swap + точечные JSX правки, без структурных изменений и без новых фич.

**Architecture:** Token swap in place. Меняем CSS variables в `:root` (новая тема `pulse` — green primary), переносим текущие X-blue tokens в `body[data-theme="ink"]` (preserve для существующих юзеров), добавляем `--secondary` / `--warn` токены. Дальше точечные правки JSX где цвета захардкожены или цветовое кодирование уровня не совпадает с новой палитрой. LoginScreen + Toasts получают полный визуальный рефакш с заменой эмодзи-иконок на SVG.

**Tech Stack:** Single-file inline-React SPA внутри `src/dashboard/server.js` (~290k char template literal). Никаких build tools, никаких миграций, никаких новых пакетов. Verification = `node scripts/check-dashboard-spa.cjs` после каждого блока (SPA-trap detector). Manual visual verification после крупных коммитов.

**Spec:** [`docs/superpowers/specs/2026-05-19-dashboard-redesign-design.md`](../specs/2026-05-19-dashboard-redesign-design.md)

---

## Critical context for the implementer

### SPA-trap rule (project-wide CLAUDE.md gotcha)

`src/dashboard/server.js` содержит inline-React SPA внутри одного гигантского template literal (`` ` ... ` ``). Любая из этих штук разрушает literal и даёт чёрный экран в браузере:

1. **Backticks (`` ` ``) в комментариях** внутри SPA блока
2. **Двойной escape**: `\'` в EN i18n строках типа `'today's'` — `\\'` интерпретируется как `'` внутри backticks и ломает inner JS
3. **`\n` в строках** для `new RegExp(...)` без правильного escape

**Mitigation:** После КАЖДОГО Edit в `src/dashboard/server.js` запускать:

```bash
node scripts/check-dashboard-spa.cjs
```

Зелёный (`SPA inner OK (N chars)`) — едем дальше. Красный — откатить последний Edit (`git checkout src/dashboard/server.js`) и попробовать другую формулировку.

### EN i18n строки с апострофами

Если EN строка содержит `'` (например `"you'll"`, `"it's"`, `"today's"`), её **value MUST использовать `"..."` double-quotes** в JS объекте, не одинарные. Иначе SPA-trap.

```js
// ❌ ломает SPA:
'analyze.intro': 'today\'s trends'

// ✓ работает:
'analyze.intro': "today's trends"
```

### File structure

Все правки в одном файле — `src/dashboard/server.js`. Плюс WORKLOG entry в конце.

| File | Что меняется |
|---|---|
| `src/dashboard/server.js` | Все CSS variables, theme registration, targeted JSX/CSS fixes, Toasts refactor, LoginScreen refactor, i18n cleanup |
| `ai-context/WORKLOG.md` | Финальный entry на верх |

Никаких новых файлов. Никаких удалений.

### How to verify visually (no test framework)

После коммитов 1-2 (theme tokens) — деплой `deploy.ps1`, открой dashboard, проверь:
- CATALYST badges зелёные
- Никакого визуального explosion'а

После каждого targeted task (3-12) — деплой, открой соответствующую поверхность, верифай по spec'у.

---

## Task 1: Pulse theme tokens (новый default) + Ink theme preservation

**Files:**
- Modify: `src/dashboard/server.js:2577-2629` (current `:root` block)

### Context

Текущий `:root` блок (lines 2577-2629) содержит X-blue palette. Мы:
1. Заменяем его на новые pulse-tokens (green primary)
2. Сразу после `:root` добавляем `body[data-theme="ink"]` блок с **копией старого X-blue palette** + новые `--secondary`/`--warn` токены, чтобы юзеры с `localStorage["ts_theme"]="ink"` остались на синей теме

### Steps

- [ ] **Step 1: Read the current `:root` block to confirm line range**

```bash
sed -n '2570,2630p' "src/dashboard/server.js"
```

Expected: видишь `:root { ... --bg: #000000; ... --accent: #1d9bf0; ... }` блок с `--glass`/`--glass2`/`--gloss-top`/`--gloss-edge` в конце.

- [ ] **Step 2: Replace `:root` block with pulse tokens**

Find this block (around line 2577):

```css
    :root {
      /* --- Ink: default theme (no data-theme attribute) -------------------- */
      --bg:          #000000;
```

through the closing `}` of `:root`. Replace with:

```css
    :root {
      /* --- Pulse: default theme (green primary), pulse-tokens -------------- */
      /* Was Ink (X-blue) before 2026-05-19 redesign — old palette moved to    */
      /* body[data-theme="ink"] below for users who prefer it.                 */
      --bg:          #000000;
      --surface:     #0a0a0a;
      --surface2:    #16181c;          /* NEW — chips/inputs/hover */
      --card:        #0e0f12;
      --card2:       #13151a;
      --card3:       #1a1d22;
      --border:      rgba(239,243,244,.08);
      --border2:     rgba(239,243,244,.14);
      --border3:     rgba(239,243,244,.22);
      --text:        #e7e9ea;
      --text2:       #c4c8cc;
      --muted:       #71767b;
      --dim:         #4d5258;

      /* PRIMARY — green (was #1d9bf0) */
      --accent:      #4ade80;
      --accent2:     #86efac;
      --accent-rgb:  74,222,128;
      --accent-glow: rgba(74,222,128,.16);

      /* SECONDARY — X-blue (was primary, now used for manual/links/external) */
      --secondary:       #1d9bf0;
      --secondary-rgb:   29,155,240;
      --secondary-glow:  rgba(29,155,240,.16);

      /* TERTIARY — amber for saturated/decay/warning */
      --warn:        #f59e0b;
      --warn-rgb:    245,158,11;
      --warn-glow:   rgba(245,158,11,.12);

      /* Radius scale — sharp */
      --r1:          2px;
      --r2:          3px;
      --r3:          4px;

      --glass:       rgba(255,255,255,.03);
      --glass2:      rgba(255,255,255,.055);
      --gloss-top:   inset 0 1px 0 rgba(255,255,255,.04);
      --gloss-edge:  inset 0 0 0 1px rgba(255,255,255,.02);
    }
```

Note: `--card`/`--card2`/`--card3` сохраняем — они нужны для backwards compat (некоторые места рендерят через них). Если в текущем `:root` их нет — пропусти. Прочитай Step 1 output и сохрани все uncomment'нутые keys которых ещё нет в новом блоке.

- [ ] **Step 3: Add `body[data-theme="ink"]` block right after `:root`**

Find this section (was around line 2631):

```css
    /* ── tide — deep navy + cyan/aqua accent ── */
    body[data-theme="tide"] {
```

Insert ABOVE it:

```css
    /* ── ink — preserved X-blue palette for users who liked the old default ── */
    body[data-theme="ink"] {
      --bg:          #000000;
      --surface:     #0a0a0a;
      --surface2:    #16181c;
      --card:        #0e0f12;
      --card2:       #13151a;
      --card3:       #1a1d22;
      --border:      rgba(239,243,244,.08);
      --border2:     rgba(239,243,244,.14);
      --border3:     rgba(239,243,244,.22);
      --text:        #e7e9ea;
      --text2:       #c4c8cc;
      --muted:       #71767b;
      --dim:         #4d5258;

      /* PRIMARY back to X-blue (this theme = "ink") */
      --accent:      #1d9bf0;
      --accent2:     #4cb1ff;
      --accent-rgb:  29,155,240;
      --accent-glow: rgba(29,155,240,.16);

      /* SECONDARY — green demoted */
      --secondary:       #4ade80;
      --secondary-rgb:   74,222,128;
      --secondary-glow:  rgba(74,222,128,.16);

      /* TERTIARY shared across themes */
      --warn:        #f59e0b;
      --warn-rgb:    245,158,11;
      --warn-glow:   rgba(245,158,11,.12);

      --r1:          2px;
      --r2:          3px;
      --r3:          4px;
    }

```

- [ ] **Step 4: Run SPA check**

```bash
node scripts/check-dashboard-spa.cjs
```

Expected: `SPA inner OK (N chars)` where N is similar to before (~290k).

- [ ] **Step 5: Commit**

```bash
git add src/dashboard/server.js
git commit -m "feat(dashboard): introduce pulse theme as new default, preserve ink

Add green primary tokens to :root (was X-blue), move old X-blue
palette to body[data-theme=\"ink\"]. New --secondary / --warn tokens
introduced. New --r1/--r2/--r3 radius scale. Tide theme untouched.

Spec: docs/superpowers/specs/2026-05-19-dashboard-redesign-design.md"
```

---

## Task 2: Register pulse in theme switcher

**Files:**
- Modify: `src/dashboard/server.js:6547-6552` (SUPPORTED_THEMES + THEME_META)
- Modify: `src/dashboard/server.js:6558` (detectTheme default)
- Modify: `src/dashboard/server.js:6564` (applyThemeAttr default exclusion)
- Modify: `src/dashboard/server.js:4067-4074` (theme-swatch previews)

### Context

Theme switcher UI читает из `SUPPORTED_THEMES` массива и `THEME_META` объекта. Дефолт сейчас `'ink'`. После реорга — дефолт становится `'pulse'`, `ink` остаётся как опция.

### Steps

- [ ] **Step 1: Update SUPPORTED_THEMES array and THEME_META**

Find (around line 6547):

```js
const THEME_KEY = 'ts_theme';
const SUPPORTED_THEMES = ['ink', 'tide'];
const THEME_META = {
  ink:  { icon: '⬛', labelEn: 'Ink',  labelRu: 'Чернила' },
  tide: { icon: '🌊', labelEn: 'Tide', labelRu: 'Прилив' },
};
```

Replace with:

```js
const THEME_KEY = 'ts_theme';
const SUPPORTED_THEMES = ['pulse', 'ink', 'tide'];
const THEME_META = {
  pulse: { icon: '⚡', labelEn: 'Pulse', labelRu: 'Импульс' },
  ink:   { icon: '⬛', labelEn: 'Ink',   labelRu: 'Чернила' },
  tide:  { icon: '🌊', labelEn: 'Tide',  labelRu: 'Прилив' },
};
```

- [ ] **Step 2: Update detectTheme default**

Find (around line 6558):

```js
  return 'ink';
}
```

Replace with:

```js
  return 'pulse';
}
```

- [ ] **Step 3: Update applyThemeAttr exclusion**

Find (around line 6564):

```js
    if (theme && theme !== 'ink') document.body.setAttribute('data-theme', theme);
    else document.body.removeAttribute('data-theme');
```

Replace with:

```js
    if (theme && theme !== 'pulse') document.body.setAttribute('data-theme', theme);
    else document.body.removeAttribute('data-theme');
```

(`pulse` теперь живёт в `:root`, не нуждается в attr; `ink` и `tide` — через attr.)

- [ ] **Step 4: Add pulse preview swatch**

Find (around line 4068):

```css
    /* Theme swatch previews — match the actual theme palettes above. Each
       row shows bg / accent / card so the user can preview at a glance. */
    .theme-swatch[data-theme-preview="ink"]   .theme-swatch-dot-bg     { background: #000000; }
```

Insert ABOVE the `ink` lines:

```css
    .theme-swatch[data-theme-preview="pulse"] .theme-swatch-dot-bg     { background: #000000; }
    .theme-swatch[data-theme-preview="pulse"] .theme-swatch-dot-accent { background: #4ade80; }
    .theme-swatch[data-theme-preview="pulse"] .theme-swatch-dot-card   { background: #16181c; }
```

- [ ] **Step 5: Run SPA check**

```bash
node scripts/check-dashboard-spa.cjs
```

Expected: `SPA inner OK (N chars)`.

- [ ] **Step 6: Commit**

```bash
git add src/dashboard/server.js
git commit -m "feat(dashboard): register pulse theme in switcher, flip default

SUPPORTED_THEMES now ['pulse', 'ink', 'tide'] with pulse as default.
detectTheme falls back to 'pulse'. applyThemeAttr skips attr for
pulse (lives in :root). New theme-swatch preview added.

Existing users with localStorage[ts_theme]=ink stay on ink. New
users default to pulse."
```

---

## Task 3: Manual launch — verify themes load

**Files:** none (verification step)

### Context

Это smoke-чек после foundation. Если эти 2 коммита не сломали layout — едем дальше точечно. Если сломали — откатываемся и разбираемся, прежде чем продолжать.

### Steps

- [ ] **Step 1: Deploy**

```powershell
.\deploy.ps1
```

- [ ] **Step 2: Open dashboard in browser, hard refresh (Ctrl+F5)**

- [ ] **Step 3: Verify pulse theme is active**

Ожидание: bg чёрный, CATALYST badges, primary buttons (Details, Analyze), live-dots, scrollbar — **зелёные**. Никакого X-blue для primary элементов. Если ты не выбирал тему — должен быть pulse автоматически.

- [ ] **Step 4: Switch to ink theme via Settings → Theme**

Ожидание: всё что было зелёным становится X-blue (как старый дефолт до редизайна).

- [ ] **Step 5: Switch to tide theme**

Ожидание: navy bg + cyan/aqua accent. Не сломалось.

- [ ] **Step 6: Switch back to pulse**

- [ ] **Step 7: Open browser console — no errors**

Если что-то сломалось — `git revert HEAD HEAD~1` (откат двух коммитов) и разбираемся.

Если всё ОК — `git tag dashboard-redesign-foundation` (опц., backup point).

---

## Task 4: Phase chips re-color (sidebar)

**Files:**
- Modify: `src/dashboard/server.js` (phase chip styles + active state rendering)

### Context

Phase chips (ALL / EARLY / FORMING / STRONG / SATURATED) сейчас разноцветные. Новая схема:

| Phase | Color | Token |
|---|---|---|
| ALL (when active) | green | `--accent` |
| STRONG | green | `--accent` |
| FORMING | white | `--text` |
| EARLY | muted | `--muted` |
| SATURATED | amber | `--warn` |

### Steps

- [ ] **Step 1: Find phase chip styles**

```bash
grep -n "phase-chip\|phase-pill\|\\.phase-" src/dashboard/server.js | head -30
```

Запиши line numbers найденных селекторов.

- [ ] **Step 2: Read the phase-chip CSS block**

Прочитай весь блок где определены `.phase-chip`, `.phase-chip.early`, `.phase-chip.forming`, `.phase-chip.strong`, `.phase-chip.saturated`. Запиши текущий цвет для каждого state.

- [ ] **Step 3: Apply new color schema**

Заменить state-specific цвета. Для каждого селектора `.phase-chip.<state>`:

- `.phase-chip.strong` (или `.phase-chip.active` если используется `data-phase="strong"` pattern) →
  ```css
  color: var(--accent);
  border-color: rgba(var(--accent-rgb), 0.30);
  background: rgba(var(--accent-rgb), 0.10);
  ```
- `.phase-chip.forming` →
  ```css
  color: #fff;
  border-color: rgba(255,255,255,0.20);
  background: rgba(255,255,255,0.06);
  ```
- `.phase-chip.early` →
  ```css
  color: var(--muted);
  border-color: var(--border2);
  background: transparent;
  ```
- `.phase-chip.saturated` →
  ```css
  color: var(--warn);
  border-color: rgba(var(--warn-rgb), 0.30);
  background: rgba(var(--warn-rgb), 0.10);
  ```

Если CSS-классов нет, а цвет проставляется inline через React props — найди place where `phase === 'strong'` ставит цвет, замени на match выше.

- [ ] **Step 4: Run SPA check**

```bash
node scripts/check-dashboard-spa.cjs
```

- [ ] **Step 5: Commit**

```bash
git add src/dashboard/server.js
git commit -m "feat(dashboard): phase chips on new color schema

STRONG=accent, FORMING=white, EARLY=muted, SATURATED=warn.
Removes rainbow phase coloring in favor of disciplined palette
with semantic meaning (only strong/saturated get color emphasis).

Spec section 4.2."
```

---

## Task 5: Type chips — MANUAL → secondary

**Files:**
- Modify: `src/dashboard/server.js` (type chip styles, search "MANUAL" or "type-chip.manual")

### Context

Type chips (EVENT / TREND / POST / MANUAL) — все нейтральные кроме MANUAL, который должен быть cyan (`--secondary`) во всех темах: в pulse это синий, в ink — зелёный (semantic role "external/manual").

### Steps

- [ ] **Step 1: Find MANUAL chip styling**

```bash
grep -n "MANUAL\|type-chip\|manual-chip\|manualSubmitted" src/dashboard/server.js | head -20
```

- [ ] **Step 2: Apply `--secondary` to MANUAL state**

В найденном CSS блоке для MANUAL:

```css
.type-chip.manual,
.type-chip[data-type="manual"] {
  color: var(--secondary);
  border-color: rgba(var(--secondary-rgb), 0.30);
  background: rgba(var(--secondary-rgb), 0.10);
}
```

Подгони селектор под фактически используемый паттерн (классы или data-attr).

- [ ] **Step 3: Найди MANUAL chip в feed-карточке тоже**

`MANUAL`-чип появляется не только в sidebar-фильтре, но и в самой feed-карточке (когда `trend.manualSubmitted === true`). Если для feed-чипа используется другой селектор (e.g. `.feed-chip.manual`) — примени то же правило.

- [ ] **Step 4: Run SPA check**

```bash
node scripts/check-dashboard-spa.cjs
```

- [ ] **Step 5: Commit**

```bash
git add src/dashboard/server.js
git commit -m "feat(dashboard): MANUAL chip uses --secondary (cyan in pulse)

Both sidebar type-filter chip and per-card MANUAL chip now use
the secondary accent token. Semantic role: manual analysis is
'user-triggered/external', not 'AI-found' — gets the secondary
slot in our 70/20/10 palette discipline.

Spec section 4.2, 4.3."
```

---

## Task 6: Feed card — score circles, velocity arrow, action icons

**Files:**
- Modify: `src/dashboard/server.js` (search "meme-num", "score-bar-num", "velocity", "feed-action" classes)

### Context

Feed card сейчас красит score circles разноцветно (high=green, mid=yellow, low=red) — это "светофор" который мы выпиливаем. Все на `var(--accent)`, уровень показываем bar-fill ДЛИНОЙ.

Velocity arrow — текущий рендер красит положительную в зелёный, отрицательную в красный. Negative velocity была удалена week ago. Оставляем: positive → green, zero → muted, нет negative case.

Action icons (star, hide) — `--muted` default, hover → `--text`.

### Steps

- [ ] **Step 1: Find score number rendering**

```bash
grep -n "tier === 'hot'\|tier === 'warm'\|tier === 'cold'\|meme-hero-num\|score-bar-num" src/dashboard/server.js | head -20
```

Найди где `tier = v >= 80 ? 'hot' : v >= 60 ? 'warm' : ... ` и где этот tier применяется через className.

- [ ] **Step 2: Read the tier-color CSS rules**

```bash
grep -n "\\.meme-hero-num\\.hot\|\\.meme-hero-num\\.warm\|\\.meme-hero-num\\.cold\|score-bar.*hot\|score-bar.*cold" src/dashboard/server.js | head -10
```

Запиши line numbers с цветовыми правилами для hot/warm/ok/cold.

- [ ] **Step 3: Unify score number color**

Замени:

```css
.meme-hero-num.hot,
.meme-hero-num.warm,
.meme-hero-num.ok,
.meme-hero-num.cold,
.score-bar-num.hot,
.score-bar-num.warm,
.score-bar-num.ok,
.score-bar-num.cold {
  color: var(--accent);
}
```

(Или какой-то аналог для существующих классов. Цель: все tier'ы → `var(--accent)`.)

- [ ] **Step 4: Уровень показываем через bar-fill длину**

Найди `.score-bar` rendering. Если bar fill уже attribute-driven (style.width = `${v}%`) — длина уже работает. Цвет fill'а — оставляем `var(--accent)`. Если был conditional gradient — убираем, делаем монохром.

- [ ] **Step 5: Velocity arrow color**

```bash
grep -n "velocity\\b\|vel-arrow\|↑.*vel\|↓.*vel" src/dashboard/server.js | head -10
```

Найди rendering. Заменить условие:

```js
// Старое:
color: vel > 0 ? '#4ade80' : vel < 0 ? '#ef4444' : 'var(--muted)'

// Новое (negative case удалён неделю назад):
color: vel > 0 ? 'var(--accent)' : 'var(--muted)'
```

(Подгони под фактическую структуру кода — это может быть inline style или className.)

- [ ] **Step 6: Action icons (star, hide)**

```bash
grep -n "feed-action\|action-icon\|btn-star\|btn-hide" src/dashboard/server.js | head -10
```

Убедись что default color — `var(--muted)`, hover — `var(--text)`. Если уже так — пропустить.

- [ ] **Step 7: Run SPA check**

```bash
node scripts/check-dashboard-spa.cjs
```

- [ ] **Step 8: Commit**

```bash
git add src/dashboard/server.js
git commit -m "feat(dashboard): unify feed card scores on primary accent

Score numbers (Emerge/Meme/Adopt) and the big score readout all use
var(--accent) now. Tier-based rainbow (hot/warm/ok/cold) removed —
level is communicated through bar-fill length, not color. Velocity
arrow: positive=accent, zero=muted (negative case was removed in
previous round). Action icons normalized to muted default.

Spec section 4.3."
```

---

## Task 7: AnalyzePanel — verdict banner, score bars, Ask Grok button

**Files:**
- Modify: `src/dashboard/server.js` (search "analyze-verdict", "verdict-high", "analyze-score-bar", "Ask Grok")

### Context

AnalyzePanel получил redesign week ago — verdict banner + score bars + tags. Сейчас цветовое кодирование разнокласное. Унифицируем:

- `verdict-high` → primary green + glow
- `verdict-mid` → white border + muted glow
- `verdict-low` → amber (`--warn`)
- Score bars (Emergence / Adoption / Story) → fill через `--accent` без variant
- Ask Grok button → `--secondary` (external action)

### Steps

- [ ] **Step 1: Find verdict banner styles**

```bash
grep -n "analyze-verdict\|verdict-high\|verdict-mid\|verdict-low\|verdict_high" src/dashboard/server.js | head -15
```

- [ ] **Step 2: Apply verdict color schema**

В CSS блок для `.analyze-verdict`:

```css
.analyze-verdict.high {
  color: var(--accent);
  border-color: rgba(var(--accent-rgb), 0.35);
  background: linear-gradient(135deg, rgba(var(--accent-rgb), 0.10), rgba(var(--accent-rgb), 0.02));
  box-shadow: 0 0 16px rgba(var(--accent-rgb), 0.18);
}
.analyze-verdict.mid {
  color: var(--text);
  border-color: rgba(255,255,255,0.18);
  background: rgba(255,255,255,0.03);
  box-shadow: 0 0 12px rgba(255,255,255,0.04);
}
.analyze-verdict.low {
  color: var(--warn);
  border-color: rgba(var(--warn-rgb), 0.30);
  background: linear-gradient(135deg, rgba(var(--warn-rgb), 0.06), rgba(var(--warn-rgb), 0.01));
  box-shadow: 0 0 12px rgba(var(--warn-rgb), 0.10);
}
```

(Подгони селектор под фактический паттерн — может быть `[data-verdict="high"]` если используется attr.)

- [ ] **Step 3: Score bars to single accent**

```bash
grep -n "analyze-score-bar\|score-bar-fill\|score-fill" src/dashboard/server.js | head -10
```

Убедись что fill — `var(--accent)`. Если был conditional — выпили.

- [ ] **Step 4: Ask Grok button → secondary**

```bash
grep -n "Ask Grok\|ask-grok\|ask_grok" src/dashboard/server.js | head -10
```

Найди button rendering. Если используется `.btn-primary` — переключи на `.btn-secondary` (создай класс если нет). Класс `.btn-secondary`:

```css
.btn-secondary {
  background: transparent;
  color: var(--secondary);
  border: 1px solid rgba(var(--secondary-rgb), 0.30);
}
.btn-secondary:hover {
  background: rgba(var(--secondary-rgb), 0.06);
  border-color: rgba(var(--secondary-rgb), 0.50);
}
```

- [ ] **Step 5: Forecast Catalyst button — confirm it's primary**

```bash
grep -n "Forecast Catalyst\|forecast-catalyst" src/dashboard/server.js | head -10
```

Должен использовать `.btn-primary` (green). Если уже так — ничего не делать.

- [ ] **Step 6: Run SPA check**

```bash
node scripts/check-dashboard-spa.cjs
```

- [ ] **Step 7: Commit**

```bash
git add src/dashboard/server.js
git commit -m "feat(dashboard): AnalyzePanel verdict + bars on disciplined palette

verdict-high → primary (green+glow), verdict-mid → white border +
muted glow, verdict-low → warn (amber). Score bars (Emergence /
Adoption / Story) unified on primary accent. Ask Grok demoted to
secondary (external action). Forecast Catalyst stays primary.

Spec section 4.4."
```

---

## Task 8: Toasts CSS — sharp, no blur, left-stripe, warn type

**Files:**
- Modify: `src/dashboard/server.js:4270-4319` (`.toasts-wrap` + `.toast` styles)

### Context

Текущий toast — pill (border-radius 999px), backdrop-blur(14px), emoji-icon с tinted-border. Новый — sharp 2px, no blur, left-stripe 2px по типу, SVG icon, новый `warn` type.

### Steps

- [ ] **Step 1: Read current toast CSS**

```bash
sed -n '4270,4320p' src/dashboard/server.js
```

- [ ] **Step 2: Replace `.toast` and type-specific rules**

Find block starting `.toast {` and ending before `@media (max-width: 540px)`. Replace with:

```css
    .toast {
      display: flex; align-items: center; gap: 10px;
      background: #000;
      border: 1px solid var(--border2);
      border-left-width: 2px;
      border-radius: var(--r1, 2px);
      padding: 8px 8px 8px 12px;
      font-size: 12px; font-weight: 500; color: var(--text);
      box-shadow: 0 8px 24px -8px rgba(0,0,0,0.85);
      animation: toastIn .22s cubic-bezier(.21,.62,.32,1.06);
      pointer-events: auto;
      max-width: 460px;
    }
    .toast.info    { border-left-color: var(--secondary); }
    .toast.info    .toast-icon { color: var(--secondary); }
    .toast.success { border-left-color: var(--accent); }
    .toast.success .toast-icon { color: var(--accent); }
    .toast.warn    { border-left-color: var(--warn); }
    .toast.warn    .toast-icon { color: var(--warn); }
    .toast.error   { border-left-color: #ef4444; }
    .toast.error   .toast-icon { color: #ef4444; }
    .toast-icon {
      flex-shrink: 0;
      width: 14px; height: 14px;
      display: inline-flex; align-items: center; justify-content: center;
    }
    .toast-icon svg { width: 14px; height: 14px; }
    .toast-msg { flex: 1; line-height: 1.45; white-space: nowrap; }
    .toast-close {
      flex-shrink: 0;
      display: inline-flex; align-items: center; justify-content: center;
      width: 22px; height: 22px;
      border: 0;
      background: transparent;
      color: var(--dim);
      cursor: pointer;
      border-radius: var(--r1, 2px);
      transition: color .12s, background .12s;
      margin-left: 4px;
    }
    .toast-close:hover { color: #fff; background: var(--surface2); }
    .toast-close svg { width: 12px; height: 12px; }
```

Note: убраны `backdrop-filter`, `border-radius: 999px`, layered box-shadows. Добавлен `.toast.warn` и `.toast-close`.

- [ ] **Step 3: Run SPA check**

```bash
node scripts/check-dashboard-spa.cjs
```

- [ ] **Step 4: Commit**

```bash
git add src/dashboard/server.js
git commit -m "feat(dashboard): toasts CSS to sharp/no-blur/left-stripe

Pill (999px) → sharp 2px radius. backdrop-blur removed (solid bg
on total-black surface). Type tinting via 2px left-stripe instead
of full border. New 'warn' type (amber). New .toast-close style
(22x22 touch-target, muted default, white on hover).

Spec section 4.5."
```

---

## Task 9: Toasts JSX — SVG icons + close button + dismiss handler

**Files:**
- Modify: `src/dashboard/server.js:10037-10054` (`Toasts` component)
- Modify: `src/dashboard/server.js:11789` area (`addToast` definition — add `id` and `dismissToast`)

### Context

Toasts component сейчас рендерит unicode-glyph (`✓` / `✕` / `ℹ`). Меняем на SVG (feather-style). Добавляем close button с `onClick={dismissToast(id)}`. Нужен dismiss handler в parent.

### Steps

- [ ] **Step 1: Read current Toasts component**

```bash
sed -n '10037,10060p' src/dashboard/server.js
```

- [ ] **Step 2: Read current addToast definition**

```bash
sed -n '11785,11805p' src/dashboard/server.js
```

Запиши shape: useState'ы для toast list, addToast handler с setTimeout.

- [ ] **Step 3: Add dismissToast handler near addToast**

Find:

```js
  const addToast = useCallback((msg, type = 'info') => {
```

Replace the block (через закрытие `setToasts(...)` call) with:

```js
  const dismissToast = useCallback((id) => {
    setToasts(prev => prev.filter(x => x.id !== id));
  }, []);
  const addToast = useCallback((msg, type = 'info') => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { id, msg, type }]);
    setTimeout(() => dismissToast(id), 3000);
  }, [dismissToast]);
```

(Подгони к фактической структуре — может быть `useState([])` для toasts, может другой ID gen.)

- [ ] **Step 4: Pass dismissToast to Toasts component**

Find:

```js
h(Toasts, { toasts })
```

(или похожий call site)

Replace with:

```js
h(Toasts, { toasts, onDismiss: dismissToast })
```

- [ ] **Step 5: Refactor Toasts component**

Replace the existing `function Toasts(...)` block:

```js
function Toasts({ toasts, onDismiss }) {
  const ICON_SVG = {
    info: h('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2.5, strokeLinecap: 'round', strokeLinejoin: 'round' },
      h('polyline', { points: '23 4 23 10 17 10' }),
      h('path', { d: 'M20.49 15a9 9 0 1 1-2.12-9.36L23 10' })
    ),
    success: h('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 3, strokeLinecap: 'round', strokeLinejoin: 'round' },
      h('polyline', { points: '20 6 9 17 4 12' })
    ),
    warn: h('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2.5, strokeLinecap: 'round', strokeLinejoin: 'round' },
      h('path', { d: 'M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z' }),
      h('line', { x1: 12, y1: 9, x2: 12, y2: 13 }),
      h('line', { x1: 12, y1: 17, x2: 12.01, y2: 17 })
    ),
    error: h('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2.5, strokeLinecap: 'round', strokeLinejoin: 'round' },
      h('circle', { cx: 12, cy: 12, r: 10 }),
      h('line', { x1: 15, y1: 9, x2: 9, y2: 15 }),
      h('line', { x1: 9, y1: 9, x2: 15, y2: 15 })
    ),
  };
  const CLOSE_SVG = h('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2.5, strokeLinecap: 'round', strokeLinejoin: 'round' },
    h('line', { x1: 18, y1: 6, x2: 6, y2: 18 }),
    h('line', { x1: 6, y1: 6, x2: 18, y2: 18 })
  );
  return h('div', { className: 'toasts-wrap' },
    toasts.map(toast => h('div', { key: toast.id, className: 'toast ' + (toast.type || 'info') },
      h('span', { className: 'toast-icon' }, ICON_SVG[toast.type] || ICON_SVG.info),
      h('span', { className: 'toast-msg' }, toast.msg),
      h('button', {
        className: 'toast-close',
        'aria-label': 'dismiss',
        onClick: () => onDismiss && onDismiss(toast.id),
      }, CLOSE_SVG)
    ))
  );
}
```

- [ ] **Step 6: Run SPA check**

```bash
node scripts/check-dashboard-spa.cjs
```

Это самый рисковый шаг — большой JSX блок с inline-стилями. Если SPA-check падает — внимательно ищи backticks внутри SVG атрибутов или escape'ы в строках.

- [ ] **Step 7: Commit**

```bash
git add src/dashboard/server.js
git commit -m "feat(dashboard): toasts use SVG icons and close button

Replace unicode glyph icons (check/cross/info) with feather-style
SVG. Add dismiss button (22x22, muted default, hover white). New
'warn' type wired through SVG triangle-bang. dismissToast handler
plumbed from parent so onClick closes immediately without waiting
for the 3s auto-dismiss.

Spec section 4.5."
```

---

## Task 10: Strip emoji prefixes from `addToast()` calls

**Files:**
- Modify: `src/dashboard/server.js` (multiple `addToast(...)` call sites)

### Context

Текущая логика `Toasts` детектила leading emoji в `msg` и скрывала auto-icon. После refactor'а все toasts получают SVG-icon из системы — leading emoji в строках становится дублированием. Чистим.

### Steps

- [ ] **Step 1: Find all addToast calls**

```bash
grep -n "addToast(" src/dashboard/server.js | head -50
```

Запиши all line numbers.

- [ ] **Step 2: For each call, inspect the message string**

Особенно ищи toast-ы с префиксами:
- `'⚠ '` / `'⚠️ '`
- `'🔒 '`
- `'⛔ '`
- `'✓ '`
- `'✕ '`
- `'📊 '`
- `'ℹ '` / `'ℹ️ '`

Также проверь i18n строки которые могут передаваться в `addToast`:
```bash
grep -n "addToast(t(" src/dashboard/server.js | head -20
```

Если в i18n у строки эмодзи в начале — её тоже чистим (в обоих языках en/ru).

- [ ] **Step 3: Strip leading emoji from each message**

Пример transformation:

```js
// Старое:
addToast('⚠ hide failed: ' + e.message, 'error');
// Новое:
addToast('Hide failed: ' + e.message, 'error');
```

```js
// Старое (i18n string):
'analyze.locked_toast': '🔒 Manual analysis is available on Test/Pro',
// Новое:
'analyze.locked_toast': 'Manual analysis is available on Test/Pro',
```

Сделай Edit для каждого случая. **Сохраняй capitalization** — после удаления emoji первая буква должна быть upper-case (как обычное предложение).

- [ ] **Step 4: Also clean up Toasts.js auto-icon detection logic (legacy)**

Если в `function Toasts` (теперь refactored) ещё остался `const showAutoIcon = /^[\p{L}\p{N}\s]/u.test(msg);` или похожая логика — удалить, не нужна больше.

- [ ] **Step 5: Run SPA check after EACH Edit**

Особенно после i18n правок — EN строки с апострофами в опасной зоне. После каждого:

```bash
node scripts/check-dashboard-spa.cjs
```

- [ ] **Step 6: Commit**

```bash
git add src/dashboard/server.js
git commit -m "refactor(dashboard): drop emoji prefixes from toast messages

All toasts now get SVG icons from the Toasts component itself —
leading emojis in addToast() calls and i18n strings would
duplicate the visual signal. Cleaned across all call sites and
locale entries.

Spec section 4.5."
```

---

## Task 11: LoginScreen — CSS overhaul (radius, blur, ambient)

**Files:**
- Modify: `src/dashboard/server.js:11170-11225` (LoginScreen inline styles — card + logo tile + ambient bg)

### Context

LoginScreen — большой блок inline-styles внутри `function LoginScreen`. Меняем:
- Card: `border-radius: 20px` → `var(--r3, 4px)`, `backdrop-filter: blur(12px)` → удалить
- Logo tile: `border-radius: 20px` → `var(--r2, 3px)`
- Ambient gradient opacity 0.18/0.10/0.07 → 0.10/0.05/0.04 (более рассеянный)
- Card background: gradient → solid `#000`

### Steps

- [ ] **Step 1: Read LoginScreen styling**

```bash
sed -n '11170,11260p' src/dashboard/server.js
```

- [ ] **Step 2: Replace ambient bg gradient**

Find:

```js
        background:
          'radial-gradient(60% 50% at 18% 22%, rgba(var(--accent-rgb), 0.18) 0%, transparent 60%),' +
          'radial-gradient(50% 40% at 82% 18%, rgba(var(--accent-rgb), 0.10) 0%, transparent 60%),' +
          'radial-gradient(70% 55% at 50% 95%, rgba(var(--accent-rgb), 0.07) 0%, transparent 60%)',
```

Replace with:

```js
        background:
          'radial-gradient(40% 35% at 20% 18%, rgba(var(--accent-rgb), 0.10) 0%, transparent 70%),' +
          'radial-gradient(35% 30% at 80% 85%, rgba(var(--accent-rgb), 0.05) 0%, transparent 70%)',
```

- [ ] **Step 3: Replace card styles**

Find:

```js
        background: 'linear-gradient(180deg, rgba(22,24,28,0.92) 0%, rgba(10,10,10,0.94) 100%)',
        border: '1px solid var(--border, rgba(239,243,244,0.08))',
        borderRadius: '20px',
        padding: '40px 32px 28px',
        boxShadow:
          '0 30px 80px rgba(0,0,0,0.65),' +
          '0 0 0 1px rgba(239,243,244,0.02) inset,' +
          'inset 0 1px 0 rgba(239,243,244,0.04)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
```

Replace with:

```js
        background: '#000',
        border: '1px solid var(--border2, rgba(239,243,244,0.14))',
        borderRadius: '4px',
        padding: '40px 32px 32px',
        boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
```

- [ ] **Step 4: Replace logo tile styles**

Find:

```js
            width: 80, height: 80, borderRadius: 20,
            background: 'radial-gradient(120% 100% at 50% 0%, rgba(var(--accent-rgb), 0.22) 0%, rgba(var(--accent-rgb), 0.05) 60%, transparent 100%)',
            border: '1px solid rgba(var(--accent-rgb), 0.20)',
            boxShadow: '0 0 40px rgba(var(--accent-rgb), 0.18), inset 0 1px 0 rgba(239,243,244,0.05)',
            padding: 10, boxSizing: 'border-box',
```

Replace with:

```js
            width: 64, height: 64, borderRadius: 3,
            background: 'rgba(var(--accent-rgb), 0.06)',
            border: '1px solid rgba(var(--accent-rgb), 0.30)',
            boxShadow: '0 0 20px rgba(var(--accent-rgb), 0.18)',
            padding: 8, boxSizing: 'border-box',
```

- [ ] **Step 5: Run SPA check**

```bash
node scripts/check-dashboard-spa.cjs
```

- [ ] **Step 6: Commit**

```bash
git add src/dashboard/server.js
git commit -m "feat(dashboard): LoginScreen CSS overhaul — sharp + flat

Card radius 20px → 4px. Logo tile 20px → 3px, 80x80 → 64x64.
backdrop-filter removed (solid #000 + sharp border instead).
Ambient gradient opacity 0.18 → 0.10, more diffuse. Box-shadow
simplified (single layered drop, no inset gloss).

Spec section 4.6."
```

---

## Task 12: LoginScreen — paper-plane SVG button + monogram C fallback

**Files:**
- Modify: `src/dashboard/server.js` (LoginScreen JSX — button content + logo onError)
- Modify: `src/dashboard/server.js` (LoginScreen — Telegram button styles, cyan hardcode)

### Context

- Button: убрать 💬 emoji из text content, добавить SVG paper-plane перед текстом
- Button styling: solid cyan `#1d9bf0` (hardcoded — это override secondary token потому что Telegram brand color остаётся blue в обеих темах)
- Logo fallback: 🐱 → monogram `C` в `JetBrains Mono`, green color

### Steps

- [ ] **Step 1: Find the login idle button rendering**

```bash
grep -n "login.idle_btn\|t('login\\.idle_btn'" src/dashboard/server.js | head -5
```

- [ ] **Step 2: Find the button JSX**

Найди `h('button', {...}, t('login.idle_btn'))` или похожее. Прочитай context (5-10 строк вокруг).

- [ ] **Step 3: Replace button styling + add SVG**

Replace button JSX. Example shape — подгони под фактический pattern:

```js
h('button', {
  onClick: startLogin,
  disabled: loading,
  style: {
    width: '100%',
    padding: '11px',
    background: '#1d9bf0',  // hardcode — Telegram brand stays blue in all themes
    color: '#000',
    border: '1px solid #1d9bf0',
    borderRadius: '2px',
    fontSize: '13px',
    fontWeight: 600,
    fontFamily: 'inherit',
    cursor: loading ? 'not-allowed' : 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    transition: 'all .12s',
  },
},
  h('svg', {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2.5,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    style: { width: '14px', height: '14px' },
  },
    h('line', { x1: 22, y1: 2, x2: 11, y2: 13 }),
    h('polygon', { points: '22 2 15 22 11 13 2 9 22 2' })
  ),
  t('login.idle_btn')
)
```

- [ ] **Step 4: Find the logo onError fallback**

```bash
grep -n "🐱\|fallbackEmoji\|logo.*onError" src/dashboard/server.js | head -10
```

Найди в LoginScreen компоненте `onError: (e) => { ... 🐱 ... }` handler.

- [ ] **Step 5: Replace 🐱 fallback with monogram C**

Заменить эмодзи на text node:

```js
onError: (e) => {
  const parent = e.target.parentNode;
  if (!parent) return;
  e.target.remove();
  const monogram = document.createElement('span');
  monogram.textContent = 'C';
  monogram.style.cssText = 'font-family: JetBrains Mono, monospace; font-weight: 700; font-size: 28px; color: var(--accent); line-height: 1;';
  parent.appendChild(monogram);
}
```

(Подгони логику под фактический pattern в коде — возможно используется setState/ref вместо DOM manipulation.)

- [ ] **Step 6: Find code phase button (after idle phase)**

LoginScreen имеет 2 фазы: `idle` (Sign in) и `code` (Enter 6-digit). Code-phase button может содержать `↗ Open bot again` или `Verify`. Проверь — если там тоже эмодзи в text → выпилить и переключить на SVG если нужно.

```bash
grep -n "login.reopen_bot\|login.verify_btn" src/dashboard/server.js | head -5
```

`↗` стрелка — это unicode glyph, не emoji. Оставляем как есть. `login.verify_btn` обычная "Sign in" / "Войти" — без emoji.

- [ ] **Step 7: Run SPA check**

```bash
node scripts/check-dashboard-spa.cjs
```

- [ ] **Step 8: Commit**

```bash
git add src/dashboard/server.js
git commit -m "feat(dashboard): LoginScreen paper-plane SVG button + monogram fallback

Replace embedded 💬 emoji in 'Sign in with Telegram' button with
feather-style paper-plane SVG. Button background hardcoded cyan
(#1d9bf0) — Telegram brand stays blue across themes (intentional
override of --secondary token). Logo PNG-load fallback: 🐱 emoji
swapped to monogram 'C' in JetBrains Mono, green tinted.

Spec section 4.6."
```

---

## Task 13: LoginScreen i18n cleanup — drop subtitle, em-dash, "No passwords"

**Files:**
- Modify: `src/dashboard/server.js:6991-6999` (EN login keys)
- Modify: `src/dashboard/server.js:7421-7429` (RU login keys)
- Modify: `src/dashboard/server.js` (LoginScreen JSX — remove subtitle rendering)

### Context

i18n changes:
- Remove `login.subtitle` key + rendering (no replacement — title alone)
- `login.idle_btn`: drop 💬 emoji (теперь SVG из Task 12) — text-only
- `login.idle_desc`: drop "No passwords here." + em-dash `—`. New text per spec.

### Steps

- [ ] **Step 1: Read current EN login keys**

```bash
sed -n '6991,7000p' src/dashboard/server.js
```

- [ ] **Step 2: Edit EN login keys**

Find:

```js
    'login.subtitle': 'Sign in via Telegram',
    'login.idle_desc': "No passwords here. Auth goes through our Telegram bot — you'll get a one-time code and paste it below.",
    'login.idle_btn': '💬 Sign in with Telegram',
```

Replace with (note double-quotes for `you'll` apostrophe):

```js
    'login.idle_desc': "Sign in via our Telegram bot. You'll get a 6-digit code to paste below.",
    'login.idle_btn': 'Sign in with Telegram',
```

(Полностью удаляем `login.subtitle` строку.)

- [ ] **Step 3: Read current RU login keys**

```bash
sed -n '7421,7430p' src/dashboard/server.js
```

- [ ] **Step 4: Edit RU login keys**

Find:

```js
    'login.subtitle': 'Вход через Telegram',
    'login.idle_desc': 'Мы не храним пароли. Авторизация — через нашего Telegram-бота: ты получишь одноразовый код и введёшь его здесь.',
    'login.idle_btn': '💬 Войти через Telegram',
```

Replace with:

```js
    'login.idle_desc': 'Войди через нашего Telegram-бота. Получишь 6-значный код, чтобы ввести его здесь.',
    'login.idle_btn': 'Войти через Telegram',
```

(Полностью удаляем `login.subtitle` строку. Em-dash убран в новой строке.)

- [ ] **Step 5: Run SPA check IMMEDIATELY (critical step)**

```bash
node scripts/check-dashboard-spa.cjs
```

EN строка с `You'll` apostrophe — самый опасный момент в плане. Double-quoted value (Step 2) должно сработать. Если check падает — проверь что value `"..."` а не `'...'`.

- [ ] **Step 6: Remove subtitle rendering from LoginScreen JSX**

Найди в LoginScreen где `t('login.subtitle')` рендерится:

```bash
grep -n "login.subtitle" src/dashboard/server.js
```

Удалить весь node который рендерит subtitle. Обычно это `h('div', { ... }, t('login.subtitle'))`. Также удалить разделители / spacing если они зависят от наличия subtitle.

- [ ] **Step 7: Run SPA check**

```bash
node scripts/check-dashboard-spa.cjs
```

- [ ] **Step 8: Commit**

```bash
git add src/dashboard/server.js
git commit -m "refactor(dashboard): clean LoginScreen i18n copy

Drop login.subtitle (no replacement — title alone reads cleanly
on the new design). idle_desc rewritten without 'No passwords here'
opener and em-dash. idle_btn loses 💬 prefix (SVG paper-plane
already in the button from prev task).

EN apostrophe in 'you'll' uses double-quoted value to avoid SPA
template-literal trap.

Spec section 4.6."
```

---

## Task 14: WORKLOG entry + final SPA check + manual verification

**Files:**
- Modify: `ai-context/WORKLOG.md` (prepend entry)
- Read: `src/dashboard/server.js` (SPA-check only, no modifications)

### Context

Финальный коммит — журналирование изменений + cumulative SPA check + manual visual pass через всё что мы тронули.

### Steps

- [ ] **Step 1: Run cumulative SPA check**

```bash
node scripts/check-dashboard-spa.cjs
```

Expected: `SPA inner OK (~290k chars)`.

- [ ] **Step 2: Deploy to prod**

```powershell
.\deploy.ps1
```

- [ ] **Step 3: Manual verification checklist**

Открой dashboard, прогон по spec section 8 checklist:

1. [ ] Дефолтная тема — pulse (зелёный). CATALYST badges зелёные.
2. [ ] Settings → Theme switcher показывает pulse / ink / tide. Переключение работает.
3. [ ] Юзер с сохранённой `ink` в localStorage — видит синюю тему.
4. [ ] Feed card: score numbers зелёные, MANUAL chip cyan, SATURATED phase amber.
5. [ ] Login screen: monogram `C` (или PNG логотип), no 💬, cyan button, sharp 4px corners.
6. [ ] Toasts: появляются с SVG-icon + left-stripe + крестик справа. Клик на крестик закрывает.
7. [ ] Auto-dismiss 3s работает.
8. [ ] AnalyzePanel: verdict banner высокий — зелёный, средний — белый, низкий — amber.
9. [ ] `tide` тема — всё работает по-прежнему.
10. [ ] Browser console clean.

Любой fail = `git revert` соответствующего коммита и разбираемся.

- [ ] **Step 4: Write WORKLOG entry**

Prepend к `ai-context/WORKLOG.md` (после header'а, перед предыдущим entry):

```markdown
## 2026-05-19 · sonnet · Dashboard visual redesign (token swap in place)

**Триггер**: оператор сказал "выглядит дёшево / by-an-engineer / AI-made", хочет sharper + дисциплинированную палитру. Опирался на собственный мокап в Claude Design (axiom-style trading-desk вайб).

### Brainstorm + spec
- `/superpowers:brainstorming` → 6 визуальных axes locked (corners B-tight, palette green primary + cyan secondary + amber tertiary, total black bg, шрифты Inter+JBM текущие, density A-spacious, login + toasts полный рефакш)
- Spec: `docs/superpowers/specs/2026-05-19-dashboard-redesign-design.md`
- Approach: Token swap in place (не выносим SPA из template literal, не меняем DOM)

### Реализация (14 коммитов = 13 features + WORKLOG)
1. Pulse :root + Ink body[data-theme="ink"] preservation
2. Theme switcher registration (SUPPORTED_THEMES, default flip, preview swatch)
3. Foundational visual smoke test (no code)
4. Phase chips re-color (STRONG=accent, FORMING=white, EARLY=muted, SATURATED=warn)
5. MANUAL chip → --secondary (cyan in pulse, green in ink)
6. Feed card score numbers unified on --accent (rainbow tier-coloring removed); velocity arrow positive=accent zero=muted
7. AnalyzePanel verdict banner (high/mid/low) + bars + Ask Grok → secondary
8. Toasts CSS: pill → sharp 2px, no blur, left-stripe by type, new warn type
9. Toasts JSX: SVG icons + close button + dismissToast handler
10. addToast() calls — emoji prefixes stripped
11. LoginScreen CSS overhaul (radius/blur/ambient)
12. LoginScreen JSX: paper-plane SVG button + monogram C fallback + cyan hardcode
13. LoginScreen i18n — drop subtitle, em-dash, "No passwords"

### Файлы
- `src/dashboard/server.js` — все коммиты
- `ai-context/WORKLOG.md` — этот entry

### SPA-trap mitigation
- `node scripts/check-dashboard-spa.cjs` после каждого коммита
- EN строки с апострофами (`you'll`) — value в `"..."` double-quotes
- Никаких backticks в комментариях / `\n` escape'ов / `\\'` в строках

### Деплой
- `deploy.ps1` (стандарт, без миграций)
- Существующие юзеры с `ts_theme=ink` в localStorage — остались на синей теме
- Новые юзеры → дефолт `pulse` (зелёный)

### Риски
- Theme switch race condition на первом load'е — `applyThemeAttr` вызывается на DOMContentLoaded. Должен быть OK, но возможен flash на медленных машинах.
- Legacy `addToast('⚠ ...')` calls в любых сторонних модулях — мы прочесали сам `dashboard/server.js`, но если другие файлы импортируют addToast — те эмодзи останутся. Проверка вручную после деплоя.

### Не сделано (future iteration if needed)
- Micro-icons в meta-row карточки (views/likes/shares маленькими SVG)
- Per-source accent line (тонкая 2px полоска brand-цвета слева)
- Activity pulse-dot в углу карточки
Эти 3 опции обсуждались в brainstorm'е как "anti-голость" fallbacks. Решено: смотрим на result после деплоя, если выглядит плоско — заводим отдельный round.
```

- [ ] **Step 5: Commit**

```bash
git add ai-context/WORKLOG.md
git commit -m "docs(worklog): dashboard visual redesign entry

13-commit redesign cycle: token swap (pulse green default + ink
preserved), targeted component fixes, full LoginScreen + Toasts
refactor. Spec + plan in docs/superpowers/."
```

- [ ] **Step 6: Optional — tag the release**

```bash
git tag dashboard-redesign-2026-05-19
git push --tags
```

---

## Self-review

**Spec coverage check:**

| Spec section | Task(s) |
|---|---|
| 3.1 Theme system | Task 1, 2 |
| 3.2 Pulse tokens | Task 1 |
| 3.3 Ink tokens | Task 1 |
| 3.5 Semantic usage rules | Все targeted tasks (4-13) реализуют правила |
| 4.1 Header (PRO badge) | Решено в Task 3 smoke-чек — если PRO via `--accent`, auto-обновился; если hardcoded — в Task 4-7 вылезет визуально. Если оператор увидит PRO зелёным в pulse теме (а должен быть синим/cyan) — отдельный микро-таск после Task 14. |
| 4.2 Sidebar (phase + type + source) | Task 4, 5 |
| 4.3 Feed card (scores + velocity + actions) | Task 6 |
| 4.4 AnalyzePanel (verdict + bars + buttons) | Task 7 |
| 4.5 Toasts | Task 8, 9, 10 |
| 4.6 LoginScreen | Task 11, 12, 13 |
| 4.7 Atoms (buttons/chips/inputs) | Auto через token swap (Task 1). `.btn-secondary` class добавляется в Task 7. |
| 5 Out of scope | Не trogaem (никаких задач) |
| 6 Risk matrix | SPA-check ritual в каждой task |
| 7 Rollout (5 commits) | Расширен до 13 commits (более bite-sized per skill convention) |
| 8 Verification checklist | Task 14 |

**Gap found:** Header PRO badge — spec был осторожен ("if hardcoded — fix"). План не делает explicit task. Если после Task 14 manual verification PRO выглядит зелёным в pulse (но должен secondary cyan) — заведём отдельный mini-task. Уточняем в Task 14 verification list.

**Placeholder scan:** найдено в Task 4 формулировки "если CSS-классов нет — найди inline". Это OK — план не может предсказать все паттерны кода, инструкция "найди и подгони под фактический pattern" универсальна для подобных search-and-replace задач. Не placeholder, а делегированное решение.

**Type consistency:** `dismissToast` называется одинаково в Task 9. `--secondary` / `--secondary-rgb` / `--secondary-glow` consistent в Task 1, 2, 5, 7. `--warn` / `--warn-rgb` / `--warn-glow` consistent. Имена themes (`pulse`/`ink`/`tide`) consistent. Имена tasks ссылаются на стабильные ключи.

**OK, план готов.**

---

## Execution

**Plan complete and saved to `docs/superpowers/plans/2026-05-19-dashboard-redesign.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — я диспатчу свежего sub-agent на каждую task, ревьюю между task'ами, быстрая итерация. Лучше для большого плана как этот (14 tasks).

**2. Inline Execution** — выполняю tasks в этой же сессии через executing-plans, batch с чекпойнтами для твоего ревью.

**Which approach?**
