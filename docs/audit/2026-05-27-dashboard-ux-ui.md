# Dashboard UX/UI audit — 2026-05-27

**Scope**: шестой из 12 этапов. Фокус — целостность UI дашборда после R1-R7 (5+ итераций редизайна за 2 недели). Theme adaptation, R2 radius / R4 iconography compliance, responsive / mobile, a11y, UX-states, modal sheets, toasts, forms, hover preview, cat mascot R7, i18n parity, базовая frontend perf. **Не покрыто** — admin UI (этап 7), TG-delivery format (8), nginx/Docker (9), cat mascot **deep** behavior (10), code quality / SPA-trap (11), docs (12).

**Method**: 5 параллельных haiku-агентов по 13 направлениям + sample-проверка top findings лично против `src/dashboard/server.js` (lines 7158-7195, 9700-9737, 9858-9872, 11248-11254, 13325-13405). Ничего в коде не менялось.

---

## Component map

Главные UI-компоненты × coverage matrix.

| Component | Theme | Mobile | Loading | Error | Empty | A11y basics |
|---|---|---|---|---|---|---|
| Feed (main list) | ✓ | ✓ collapse | ✓ skeleton | **✗ MISSING** | ✓ | partial |
| TrendModal | ✓ | ✓ width:100vw | ✓ partial | ✓ inline-text | n/a | role=dialog only |
| AnalyzePanel | ✓ | ✓ Sheet | ✓ Stage spinner | ✓ verdict block | ✓ idle | partial |
| Saved tab | ✓ | ✓ | n/a (filter) | n/a | ✓ inbox icon | partial |
| Archive | ✓ | ✓ | ✓ | ✓ inline | ✓ | partial |
| Settings sheet | ✓ | ✓ Sheet | ✗ N/A (sync) | **✗ no error UI** | n/a | role=dialog only |
| Account sheet | ✓ | ✓ Sheet | ✗ N/A | ✗ | n/a | role=dialog only |
| TrendList (top narratives) | ✓ | ✓ collapse | ⚠ unknown | ⚠ unknown | ⚠ unknown | clickable div w/o role |
| Live stats | ✓ | ✓ collapse | ⚠ unknown | ⚠ unknown | ⚠ unknown | partial |
| Sources sidebar | ✓ | ✗ hidden @900px | ⚠ unknown | ⚠ unknown | ⚠ unknown | partial |
| Hover preview (TweetHover) | ✓ | ✗ no-hover | ✓ '⏳' inline | ✓ '⚠' inline | ✗ no fallback | n/a |
| Bottom nav | ✓ | ✓ | n/a | n/a | n/a | button labels OK |
| Login screen | ✓ | ✓ scale 1.1 | ✓ submit spin | ✓ inline-text | n/a | h1 present |
| Cat mascot | ✓ all states | unmount @700px | n/a | n/a | n/a | aria-hidden expected (verify) |
| Toast container | ✓ | ✓ above-nav | n/a | n/a | n/a | live-region? unverified |

Critical gaps: **Feed has NO error UI** (network failure silent), **Settings/Account no error UI** (form submission failures invisible), **TrendList/Live stats/Sources unknown** (not verified — flagged in UX-014).

---

## Theme audit (3 темы)

Реальный contract в коде (`src/dashboard/server.js:7168`):
```js
const SUPPORTED_THEMES = ['pulse', 'ink', 'tide'];
function detectTheme() { ...; return 'pulse'; }  // line 7180
if (theme && theme !== 'pulse') document.body.setAttribute('data-theme', theme);  // line 7186
```

3 темы. **`pulse` = default** (применяется как baseline `:root` rules без attribute selector). **`ink` / `tide`** = alternates через `body[data-theme="X"]` (lines 2726, 2790).

| Theme | applied via | accent | bg | use case | per-CSS coverage |
|---|---|---|---|---|---|
| `pulse` | `:root` baseline | `#4ade80` (green) | `#000000` | **default** | full (baseline) |
| `ink` | `body[data-theme="ink"]` | `#1d9bf0` (X blue) | `#000000` | X-style true black | full |
| `tide` | `body[data-theme="tide"]` | `#4dd4e0` (cyan) | `#0a1622` | navy crypto-terminal | full per agent, **`--surface2` not defined** |

**Hex leaks** (вне theme blocks):
- Brand glyphs (Reddit `#ff4500`, TikTok `#25f4ee/#fe2c55`, Google `#4285f4/#ea4335/#fbbc04/#34a853`) — **intentional**, brand integrity.
- Medals top-1/2/3 gold/silver/bronze — **intentional**.
- `PHASE_META` hardcoded цветами — flagged R1 as **acceptable trade-off** (но это всё-таки theme-blind — фазы выглядят одинаково на pulse и ink).
- 5× hardcoded **5px border-radius** + 1× **8px** где должен быть `var(--r1/r2/r3)` (sharp 2-4px по R2 spec) → UX-008.
- Submit button hardcoded `#1d9bf0` (line ~12408) — может быть intentional CTA emphasis на ink-blue, но не реагирует на pulse green / tide cyan accent → UX-008.

**Theme drift** (накопленный): SESSION_CONTEXT § «Theme system» декларирует **2 темы** (ink default + tide), реальный код **3 темы с pulse default**. Это significant spec drift (см. SD-12).

---

## i18n coverage

EN keys: **89 total** (top-level + nested).
RU keys: **89 total** — exact same structure.

**Parity**: ✓ perfect. Нет missing keys ни в одну сторону, нет empty values.

Hardcoded EN strings вне `t(...)`:
- 2× `aria-label: 'Close'` на lightbox (8927, 11637)
- 1× `'Cancel'` в modal close text (12511)
- 4× в `addToast()` error path (13336, 13348, 13383, 13404)

Total: **7 hardcoded EN strings**. RU юзер видит English на error fail / lightbox close.

Emoji в i18n strings (R4 sweep declared «remove all emoji from i18n», но):
- EN: ⭐ ⏱ ⏳ (4 строки: fav.empty, sidebar.window, hero.scanning, trigger.cooldown)
- RU: ⭐ ⏱ ⏳ ⛔ ❌ (7 строк: fav.empty, sidebar.window, hero.scanning, trigger.daily_limit, trigger.cooldown, trigger.error, trigger.disabled)

Total: **11 emoji-laden translation strings** + 7 inline JSX emoji (waring ⚠, checkboxes ✅⬜). R4 declared complete — **incomplete** in practice.

---

## Summary

**Counts**: 0 critical · 5 high · 9 medium · 8 low · 8 info · **30 findings total**.

Общее впечатление — dashboard UX в неплохой форме после 5+ итераций редизайна: 4 modals корректно реализованы (backdrop + scroll-lock + Esc + click-outside + ✕), R7 cat mascot полностью matches spec (5 idle poses + login pool + triple-click flee + headup sleep + glow blink + login lying paw), i18n parity perfect (89/89), search debounce 250ms, image lazy-loading native везде, stable React keys (по ID, не index), passive scroll listeners, hover preview с flip-positioning и per-user toggle, brand glyphs защищены от theme override, breakpoints layered.

Слабые места — Feed silent на network fail (UX-001 high), **focus trap отсутствует во ВСЕХ modals** (UX-002 high, keyboard a11y broken), R4 iconography sweep incomplete (UX-003 high — 18 visible emoji остались), state-drift по темам (UX-004 high — SESSION_CONTEXT декларирует 2, реально 3 с другим default), 4× hardcoded EN strings в error path (UX-005 high — RU юзер видит English на error), 2 clickable div'а без `role=button` (UX-006 high). Medium набор — отсутствие semantic landmarks / heading hierarchy / skip link / breakpoint documentation, threshold slider не plan-aware, 32× `transition: all` сплошной.

**Top-3** для разбора в первую очередь:
1. **UX-001** Feed error state полностью missing — silent broken UI на network fail
2. **UX-002** No focus trap в modals (Settings/Account/Analyze/TrendModal/Lightbox) — Tab выходит из модала, keyboard nav broken
3. **UX-004** Theme contract drift — код 3 темы default pulse, SESSION_CONTEXT 2 темы default ink → следующие маинтенеры будут смущены

---

## Findings

### [UX-001] Feed error state полностью отсутствует — severity: **high**

* **Where**: `src/dashboard/server.js:13408+` (`fetchData` в FeedView)
* **Scope**: state / Feed component
* **What**: при `GET /api/trends` network fail (или 500 от сервера) — try/catch в `fetchData` глотает ошибку и не выставляет error state. UI показывает либо stale data, либо infinitely loading skeleton, либо пустоту без объяснения. Ни toast, ни inline error banner, ни retry CTA.
* **Repro**: throttle network до offline в DevTools → reload → Feed silent. Или прод-side: nginx 502 от Docker restart → юзер видит loading-skeleton навсегда.
* **Fix**: добавить `errorState` ref/state: `catch(e) { setError(e.message); setTrends([]); }` + render `if (error) → ErrorBanner с Retry button`. Pattern уже использован в AnalyzePanel (line 11398) — переиспользовать.

---

### [UX-002] Focus trap отсутствует во ВСЕХ modals — severity: **high**

* **Where**: Lightbox (8907-8939), TrendModal (10470-10635), Sheet wrapper для Settings/Account/Analyze (11613-11644)
* **Scope**: a11y / modal sheets
* **What**: Esc корректно закрывает все modals, body scroll lock работает, click-outside работает, ✕ button присутствует. **НО Tab key escapes modal**: keyboard юзер открыл модал → Tab → focus уходит на background элементы (которые visually disabled но accessible). Это критическая a11y проблема для screen reader / keyboard-only пользователей.
* **Repro**: открой Settings → Tab многократно → focus уходит на bottom-nav под backdrop'ом.
* **Fix**: реализовать `FocusTrap` hook — снять focus на первый focusable child при mount, на Tab loop'ить first ↔ last, на mount запомнить opener button и вернуть focus туда на unmount. React-aria или custom (~30 lines). Применить ко всем 4 modal wrappers.

---

### [UX-003] R4 iconography sweep incomplete — severity: **high**

* **Where**: `src/i18n/en.js:7265,7380,7401,7442` + `src/i18n/ru.js:7700,7813,7834,7861,7875-7877` + inline JSX `src/dashboard/server.js:9014,9017,11369,12000,12043,12105,12124`
* **Scope**: theme / iconography / R4 contract
* **What**: R4 (2026-05-20) декларировал «emoji removed from i18n values, all glyphs via `icon()`». В реальности:
  * **11 emoji в i18n translation strings** (видимые user'у): ⭐ в `fav.empty`, ⏱ в `sidebar.window`, ⏳ в `hero.scanning` / `trigger.cooldown`, ⛔ в `trigger.daily_limit`, ❌ в `trigger.error` / `trigger.disabled`.
  * **7 emoji inline в JSX render**: ⚠ для error markers (lines 11369, 12000, 12043, 12124), ✅/⬜ для toggle icons (12105), ⏳/⚠ в hardcoded RU strings (9014, 9017 — также hardcoded RU без `t()`, см. UX-005).
* **Repro**: открой dashboard → favourites tab → 'No saved narratives yet — tap ⭐ on any post' — видишь ⭐ emoji, а не SVG.
* **Fix**: пройтись по 18 callsites, заменить emoji на `icon('star'|'clock'|'alert-triangle'|'check-square'|'square'|'x', {size})`. Update i18n strings — оставить только plain text, glyphs приклеить через JSX.

---

### [UX-004] Theme contract drift — SESSION_CONTEXT vs реальность — severity: **high**

* **Where**: `src/dashboard/server.js:7158-7195` (3 themes, pulse default) vs `ai-context/SESSION_CONTEXT.md` § «Theme system» (2 themes, ink default)
* **Scope**: spec drift / theme
* **What**: SESSION_CONTEXT декларирует **2 dark темы** через `body[data-theme="..."]`: `ink` (default, `#000000` + `#1d9bf0`) и `tide` (`#0a1622` + `#4dd4e0`). Реальный код:
  ```js
  const SUPPORTED_THEMES = ['pulse', 'ink', 'tide'];  // 3, not 2
  return 'pulse';  // default is pulse, not ink
  if (theme !== 'pulse') document.body.setAttribute('data-theme', theme);
  ```
  pulse — это `:root` baseline (без attribute selector), green accent `#4ade80`. ink/tide — alternate themes через attribute. Юзер с старым `localStorage.ts_theme === 'ink'` останется на ink (validity check pass), но новые юзеры получают pulse, а не ink.
* **Impact**: следующий developer / agent читает SESSION_CONTEXT, ожидает 2 темы → ломается логика (например, при добавлении new var в `:root` думает что это default ink theme — но на самом деле это pulse green; реализация для ink уйдёт в `[data-theme="ink"]` блок). Также юзер-документация лжёт.
* **Fix**: исправить SESSION_CONTEXT § «Theme system» — таблица должна быть на 3 темы с pulse default + ink/tide alternates. Описать что pulse = `:root` без attribute selector. Или (alternative path): убрать pulse из кода и сделать ink default по факту — но тогда `detectTheme()` line 7180 надо переписать.

---

### [UX-005] 4 hardcoded EN error strings в addToast — severity: **high**

* **Where**: `src/dashboard/server.js:13336, 13348, 13383, 13404`
* **Scope**: i18n / state
* **What**: error path в hide/unhide/favorite/note-save toast'ах — текст hardcoded на английском:
  ```js
  addToast('Hide failed: ' + (e.message || 'unknown error'), 'error');
  addToast('Undo failed: ' + ...);
  addToast('Favorite failed: ' + ...);
  addToast('Note save failed: ' + ...);
  ```
  RU юзер видит English только при ошибке. Все 4 сценария относятся к user actions на feed/modal — error-flow.
* **Impact**: RU юзер на error path видит непонятный English. Lokalization parity 89/89 ломается в edge case.
* **Fix**: добавить ключи `error.hide_failed`, `error.undo_failed`, `error.favorite_failed`, `error.note_failed` в en.js + ru.js с template `{err}`. Заменить hardcoded в 4 callsites.

---

### [UX-006] Clickable divs без `role=button` / `tabIndex` — severity: **high**

* **Where**:
  * `.top-item` — `src/dashboard/server.js:9862` (TrendList top narrative items, clickable открывают TrendModal)
  * `.session-chip` — `src/dashboard/server.js:11252` (Stats chip, clickable открывает stats panel)
* **Scope**: a11y / keyboard nav
* **What**: оба `<div>` имеют `onClick` без `role="button"`, без `tabIndex={0}`, без `onKeyDown` для Enter/Space. Screen reader не объявит как button, keyboard юзер не доберётся Tab'ом, Enter/Space не сработает.
* **Repro**: Tab по dashboard → top-10 narratives skip'аются полностью; session-chip skip'ается.
* **Fix**: либо заменить `<div>` на `<button class="top-item">` (preserve styling), либо добавить:
  ```js
  h('div', { 
    className: 'top-item', 
    role: 'button', 
    tabIndex: 0,
    onClick: ..., 
    onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenTrend(tr); } }
  })
  ```
  + aria-label с trend title.

---

### [UX-007] Threshold slider не plan-aware — severity: **medium**

* **Where**: `src/dashboard/server.js:12022-12044` (AccountPanel threshold range)
* **Scope**: forms / billing
* **What**: range slider для alert threshold показывает одинаковый диапазон всем планам (free/test/pro/admin). По бизнес-логике (см. SESSION_CONTEXT § Бизнес-правила) free план имеет уменьшенный set источников и `historyHours: 72` — было бы консистентно ограничить threshold range или дать визуальный hint «доступно полностью на pro».
* **Impact**: free юзер выставляет threshold = 90 (premium-level signal-to-noise) → реально alerts не приходят с premium источников, юзер не понимает почему. Confusion.
* **Fix**: либо clamp range визуально на free (показать grayed-out portion с 🔒 hint), либо добавить inline note «Threshold выше 70 рекомендован для pro tier». Не блокер — лёгкая UX hint.

---

### [UX-008] Hardcoded radius 5px и 8px вне R2 spec — severity: **medium**

* **Where**: `src/dashboard/server.js` — 5× `border-radius: 5px` на chips/buttons + 1× `border-radius: 8px` на `.analyze-explain-body` right corner
* **Scope**: theme / R2 radius consistency
* **What**: R2 (2026-05-20) проставил `var(--r1)/--r2/--r3` (2/3/4px) везде sharp. Большинство мест compliant, но 6 callsites остались с hardcoded values вне spec. Visual выглядит slightly rounder чем рядом стоящие 3-4px элементы.
* **Repro**: открой dashboard → DevTools → element-inspect chips на feed → найти 5px callsite (chip-like элемент).
* **Fix**: заменить hardcoded на `var(--r2)` (3px) или `var(--r3)` (4px). 6 строк, mechanical replace.

---

### [UX-009] Submit button hardcoded `#1d9bf0` — не theme-react — severity: **medium**

* **Where**: `src/dashboard/server.js:~12408-12410` (login submit button)
* **Scope**: theme / login screen
* **What**: Login submit CTA имеет hardcoded `#1d9bf0` (X-blue) для background. Это ink accent. На pulse и tide темах это не реагирует — submit button остаётся X-blue даже когда вся остальная theme — green/cyan.
* **Impact**: visual inconsistency на pulse/tide. Юзер на pulse видит зелёный accent везде, но submit button outlier.
* **Fix**: `background: var(--accent)`. Если intentional ink-anchor — задокументировать (как PHASE_META acceptable trade-off).

---

### [UX-010] Settings/Account sheets — нет error UI для form submission — severity: **medium**

* **Where**: `src/dashboard/server.js:~11600-12150` (SettingsPanel, AccountPanel)
* **Scope**: state / UX states
* **What**: Settings/Account sheets рендерят формы (threshold slider, language switch, alert types, plan info, logout). Submission делается через мутации (`saveSettings`, etc.). Error path:
  * Threshold save fail → tихо ничего не происходит (или addToast generic если есть)
  * Language switch fail → instant LocalStorage write, но если есть TG-side sync → silent
  * Logout fail → если сервер 500 → юзер залогинен но думает что вышел
* Sheet всегда рендерит «sync» content, нет error banner внутри.
* **Fix**: добавить `errorBanner` slot внутри Sheet header — `if (saveError) → <SheetErrorBanner msg={saveError} />`. Pattern из AnalyzePanel переиспользовать.

---

### [UX-011] Hover preview silently disabled на mobile — severity: **medium**

* **Where**: `src/dashboard/server.js:9151+` (`useTweetHover` hook)
* **Scope**: responsive / mobile
* **What**: hover preview полагается на `onMouseEnter`/`onMouseLeave`. На touchscreen mouseover не срабатывает → preview просто никогда не показывается. Per-user toggle в Settings → Appearance → «👁 Hover preview» виден на мобиле и можно тапать (toggle persists), но фича никогда не работает. Нет tap-to-show альтернативы.
* **Impact**: mobile юзер видит чекбокс «Hover preview» включенный, но фича не работает — confusion. Также теряется UX value на mobile (preview важен на тренде с медиа).
* **Fix**: 
  * Опция A — скрыть toggle на mobile (matchMedia `(hover: hover)`).
  * Опция B — реализовать long-press на trend item → open preview как мини-modal на mobile. Больше работы но реально полезно.

---

### [UX-012] Нет `<main>` / `<nav>` / `<aside>` semantic landmarks — severity: **medium**

* **Where**: top-level dashboard layout (`src/dashboard/server.js:~13700+` App component)
* **Scope**: a11y / structure
* **What**: вся структура через `<div>`. Нет `<main>` для feed, `<nav>` для bottom-nav / sidebar, `<aside>` для right rail / left sidebar, `<header>` для top nav. Screen reader не может skip-by-landmark.
* **Impact**: keyboard / screen reader юзер не может быстро навигировать. Particularly важно для assistive tech.
* **Fix**: заменить top-level `<div>` wrappers на правильные landmarks. Минимум: `<main>` для feed-area, `<nav>` для bottom-nav, `<aside>` для sidebars. Mechanical change, CSS работает по className.

---

### [UX-013] Heading hierarchy — single h1 в login, нет h2-h6 на dashboard — severity: **medium**

* **Where**: `src/dashboard/server.js:12344` (только h1 в LoginScreen)
* **Scope**: a11y / structure
* **What**: дашборд имеет single `<h1>` в login flow и ни одного structural heading на main view. Section titles (Top narratives, Live stats, etc.) рендерятся через `<div className="...">` с CSS-стилями вместо `<h2>` / `<h3>`. Screen reader heading-nav broken.
* **Fix**: rebrand section titles в `<h2>` где они visually уже выглядят как headings: Top narratives, Live stats, Sources list, Saved (когда tab active), Archive title. Minimum 5-6 `<h2>` на main view. CSS work — переопределить дефолт `h2` стили или скопировать существующий className.

---

### [UX-014] TrendList / Live stats / Sources sidebar — UX states не верифицированы — severity: **medium**

* **Where**: TrendList (right panel top narratives), Live stats (right panel), Sources sidebar (left panel)
* **Scope**: state matrix gap
* **What**: автоматическая разведка не нашла explicit loading/error/empty states для этих трёх компонентов. ⚠ requires runtime verification — открыть offline / API 500 / 0 data и посмотреть что рендерится.
* **Possible**: 
  * Sources sidebar при API 500 → пустой sidebar без объяснения.
  * Live stats при 0 trends в окне → может «0/0/0» без context.
  * TrendList при first-load → может рендерить пустой блок до прихода данных.
* **Fix**: проверить вручную, добавить недостающие states. Sources особенно важно — это первое что видит юзер при открытии (top of sidebar).

---

### [UX-015] 32× `transition: all` — broad CSS transitions — severity: **medium**

* **Where**: 32 callsites в CSS-секции `src/dashboard/server.js`
* **Scope**: performance
* **What**: `transition: all` транзитит ВСЕ CSS properties → браузер должен мониторить каждую изменения. На high-frequency elements (cards в feed, nav items, chips) при scroll или hover это вызывает paint cycles на properties которые не должны быть animated.
* **Impact**: на старых девайсах (mobile mid-tier 2-3 года) feed scroll может jank'ать. Не deal-breaker, но waste.
* **Fix**: пройтись по 32 callsites, заменить `transition: all .15s` → `transition: background-color .15s, border-color .15s, color .15s` (или конкретные properties того что реально меняется). Mechanical change.

---

### [UX-016] Breakpoint cascade не задокументирован — severity: **medium**

* **Where**: CSS media queries в `src/dashboard/server.js` — 6 breakpoints
* **Scope**: responsive / docs
* **What**: реальные breakpoints в коде:
  * `1280px` — 3-col grid collapse
  * `1100px` — meta flex-wrap
  * `960px` — card footer adjust
  * `900px` — **sidebar hidden** (`display: none`)
  * `700px` — modal padding, preset grid 3-col, **cat mascot unmount**
  * `600px` — TrendModal width:100vw
* SESSION_CONTEXT § «Dashboard layout» не упоминает breakpoints вообще. CLAUDE.md briefing для Stage 6 говорит только про `700px` — но реально 6 breakpoints с разной семантикой.
* **Impact**: будущий contributor смотрит на CSS, не понимает почему sidebar пропадает на 900px (не 700px). Test matrix incomplete.
* **Fix**: задокументировать в SESSION_CONTEXT § «Dashboard layout» — таблица breakpoint × что меняется. + `:root` CSS vars типа `--bp-md: 900px`, `--bp-sm: 700px` для централизации.

---

### [UX-017] Нет skip link — severity: **low**

* **Where**: top of dashboard layout
* **Scope**: a11y
* **What**: keyboard-юзер при первом Tab после focus в адресной строке должен иметь возможность пропустить repetitive nav и сразу попасть в main content. Стандартная a11y practice — visually-hidden link «Skip to content» который появляется при focus.
* **Fix**: добавить `<a href="#main" className="skip-link">Skip to content</a>` как первый focusable element. CSS: `position: absolute; left: -10000px; &:focus { left: 0; top: 0; ... }`. ~10 строк CSS + JSX.

---

### [UX-018] FavoriteNoteEditor — нет visible 500-char counter — severity: **low**

* **Where**: `src/dashboard/server.js:10191-10202` (FavoriteNoteEditor textarea)
* **Scope**: forms
* **What**: textarea имеет `maxLength: 500` (soft cap в UI, server validates). Но юзер не видит сколько символов уже использовал — счётчика нет. При попытке ввести 501-й символ просто ничего не происходит, что confusing.
* **Fix**: добавить inline counter под textarea: `<span class="char-count">{note.length} / 500</span>` + change to red on > 450.

---

### [UX-019] Hardcoded EN `aria-label="Close"` на Lightbox — severity: **low**

* **Where**: `src/dashboard/server.js:8927, 11637`
* **Scope**: i18n / a11y
* **What**: lightbox / image carousel close button имеет `aria-label: 'Close'` hardcoded. Screen reader-юзеру в RU мode читается «Close».
* **Fix**: `aria-label: t('app.close')` — ключ уже существует в обоих i18n файлах.

---

### [UX-020] Hardcoded `'Cancel'` в modal close — severity: **low**

* **Where**: `src/dashboard/server.js:12511`
* **Scope**: i18n
* **What**: `h('div', {}, 'Cancel')` — modal close button text захардкожен на EN.
* **Fix**: `t('app.cancel')` — нужно добавить ключ в i18n.

---

### [UX-021] Hardcoded RU strings без t() в hover preview — severity: **low**

* **Where**: `src/dashboard/server.js:9014, 9017`
* **Scope**: i18n
* **What**: `'⏳ Загрузка поста...'` и `'⚠ Не удалось загрузить пост'` — hardcoded **Russian** strings в JSX. EN-юзер увидит RU error message.
* **Fix**: добавить ключи `preview.loading`, `preview.error` (с placeholder `{kind}`) + использовать `t(...)`.

---

### [UX-022] Нет history.pushState на open modals — severity: **low**

* **Where**: Settings / Account / Analyze / TrendModal mount/unmount
* **Scope**: modal behavior / mobile
* **What**: открытие модала не push'ит history entry. Browser Back на mobile (где это primary navigation gesture) уводит со страницы вместо закрытия модала. Юзер теряет место в feed.
* **Impact**: mobile UX — потеря места при попытке закрыть модал через системный back gesture.
* **Fix**: на open `history.pushState({ modal: 'settings' }, '')` + listener на `popstate` который закрывает модал если в state. ~20 строк. Имеет edge cases на back-forward race.

---

### [UX-023] Toast close button реализация не подтверждена — severity: **low**

* **Where**: `src/dashboard/server.js:13312-13315` (addToast definition)
* **Scope**: toast / verify
* **What**: agent нашёл `addToast` definition + auto-dismiss 3s, но Toast UI component (с ✕ кнопкой) не виден в grep. Возможно она есть и просто не нашлась, возможно нет. ⚠ requires runtime visual verification — открой toast, попробуй закрыть до auto-dismiss.
* **Fix**: если ✕ нет — добавить (~5 lines). Если есть — проверить что i18n'нутый aria-label.

---

### [UX-024] PHASE_META hardcoded цвета — не theme-adaptive — severity: **low**

* **Where**: PHASE_META map в `src/dashboard/server.js`
* **Scope**: theme
* **What**: фазы (early/forming/strong/peaking/etc) имеют hardcoded RGB цвета (e.g. `#10B981` для live). R1 WORKLOG явно отметил это как acceptable trade-off — фаза-семантика overrides theme aesthetics. Но это всё-таки theme-blind: phase chips выглядят одинаково на pulse green и tide cyan.
* **Impact**: minor visual inconsistency — phase chips не сливаются с theme accent.
* **Fix**: либо переключить на semantic vars (`var(--green)` / `var(--yellow)` / etc — они константны across themes, но это уже текущий подход для других semantic-цветов), либо оставить как acceptable.

---

### [UX-025] No placeholder shimmer на slow image loads — severity: **info**

* **Where**: всё `<img loading="lazy">` callsites (16 в SPA)
* **Scope**: performance / UX states
* **What**: native lazy loading работает, но при slow connection между init и paint картинки — пустой слот (фиксированной высоты или нет — unverified). Скелетон / blur-up / shimmer-placeholder отсутствует.
* **Impact**: на 3G mobile feed карточки прыгают по layout как картинки догружаются.
* **Fix**: CSS `aspect-ratio` на image containers + skeleton-shimmer placeholder. Опционально blur-up через `low-res-data-url` (но требует backend support).

---

### [UX-026] Нет virtualization на feed list — severity: **info**

* **Where**: `src/dashboard/server.js:14351` (`visibleTrends.map(tr => h(FeedCard, ...))`)
* **Scope**: performance / scaling
* **What**: feed рендерит full map() всех trends в state. Pagination 50/page + IntersectionObserver guard приводит к accumulation на каждом `loadMore` — на 1000+ trends DOM граф heavy. Acceptable при текущей кадансе сканов, но скейлится плохо.
* **Fix**: react-window или TanStack Virtual для feed list. Окно ~10 visible cards. Future optimization.

---

### [UX-027] 0 useMemo / 0 memo() — нет granular memoization — severity: **info**

* **Where**: весь dashboard SPA
* **Scope**: performance
* **What**: 13× `useCallback` есть, но `useMemo` и `memo()` нет. FeedCard re-rendering на каждом parent state change (filter change, search change, etc). Не критично сейчас, но granular memoization могла бы помочь на больших списках.
* **Fix**: `memo(FeedCard)` + `useMemo` на expensive derivations (sortedTrends, filteredByCategory). Apply with profiling — premature optimization risk.

---

### [UX-028] External CDN images грузятся напрямую — severity: **info**

* **Where**: feed card images, TrendModal media
* **Scope**: privacy / network
* **What**: video и avatar — proxied через `/video/*` и `/avatar/*` endpoints. **Images НЕ proxied** — грузятся напрямую от twitter.com / reddit.com / etc. Это leak'ит referrer / IP юзера на CDN. Также позволяет CDN tracking dashboard usage patterns.
* **Impact**: minor privacy leak. Также бандвидз free Twitter image hosting может ratelimit'нуть.
* **Fix**: добавить `/image/proxy` endpoint аналогично video/avatar — кеш на disk, regex whitelist на source URL pattern. Defensive, ~50 lines + cleanup loop. Не приоритет.

---

### [UX-029] Стандартные UX-states (Sources/TrendList/Live) — не верифицированы — severity: **info**

См. UX-014 — отдельный finding, не дублирую.

---

### [UX-030] `box-shadow` widespread (40+) — severity: **info**

* **Where**: 40+ CSS rules в `src/dashboard/server.js`
* **Scope**: performance
* **What**: box-shadow на feed-cards / chips / glow / hover-cards / buttons. Box-shadow triggers paint, broader use → больше paint area. Не критично (большинство на focused state или hover, не на every-element), но что-то для будущей оптимизации.
* **Fix**: не нужно сейчас. Future optimization при наблюдении jank'а на старых девайсах.

---

## Verified safe

То что прошло — не пересматривать на следующих этапах:

1. **i18n parity 89/89 perfect** — нет missing keys, нет empty values, exact same structure.
2. **R7 cat mascot полностью matches spec**: 5 idle poses (sitting/cute/headup/staytall/lying), login pool [cute, lying], random initial pose, triple-click flee только в idle на dashboard (disabled на login), headup sleep variant (idleHeadUpAsleep static frame 1), glow blink ~80ms fade на 6 sprites (idleHeadUp без glow поскольку eyes always open), login lying paw drop `bottom: calc(100% - 10px)`, pose cycle через walk-home (5-10 мин dashboard, 60s login timer).
3. **Modal sheets** все 4 (Settings/Account/Analyze/TrendModal): backdrop-blur 14px (3px для TrendModal drawer), body scroll lock через `document.body.style.overflow`, Esc handler explicit, click-outside backdrop close, ✕ button present. Multiple modal stack blocked через exclusive view-state.
4. **Search debounce 250ms** (R1 spec compliant) — `setTimeout(setSearchDebounced, 250)`.
5. **FavoriteNoteEditor** Cmd-Enter save, Esc cancel, autosize 60-160px.
6. **Category dropdown** opens upward, click-outside dismiss, Esc dismiss (R4-compliant).
7. **Language switch** instant swap + localStorage persist (`ts_lang` key) + listener dispatch для UI re-render.
8. **Hover preview** flip-up при no space below, 200ms dismiss on mouseleave + 150ms onCardLeave grace, per-user toggle via `localStorage.ts_prefs_v1.hoverPreview` (default ON), loading/error states inline, hardcoded profile URLs (whitelist `x.com`, `reddit.com`).
9. **Stable React keys** — все `key={trend.id}` (stable IDs), нет anti-pattern `key={index}`.
10. **Image lazy loading** native `loading="lazy"` на всех 16 `<img>` callsites.
11. **Passive event listeners** на scroll/wheel/touchmove — perf-safe.
12. **Single IntersectionObserver** на feed sentinel с in-flight guard (`loadingMore` flag).
13. **Brand glyphs** (Reddit/TikTok/Google/medal colors) — intentionally non-theme-adaptive, correctly preserved.
14. **Theme vars** semantic colors (`--green/--red/--orange/--yellow/--pink/--purple`) константны across themes — OK/error signals не меняют значения.
15. **No `dangerouslySetInnerHTML` / `eval` / `Function()`** (verified в Stage 1 SEC audit, повторное подтверждение).
16. **icon() helper consistency** — SOURCE_ICONS / CAT_ICONS / PHASE_DOT mapings все используют name-strings (не raw SVG / не emoji).
17. **R2 hover compliance** — nav/filters/chips hover flat (color + subtle bg shift), action buttons pillowy (intentional CTA emphasis).
18. **Random initial cat pose** — на mount `useState(function() { return pool[random]; })`, дефолтная поза разная при reload.
19. **Backend** для hover preview (tweet/reddit) — LRU cache + per-tier TTL + live engagement metrics update — verified Stage 4 (COST-004 separately).
20. **Card carousel** failed-image filtering — `Set<failedIndices>` локально + onError handler.

---

## Spec drift (накопительно — 14 items)

К существующим 11 items добавляю 3 новых UI-уровень:

- **SD-1**..**SD-11** — см. предыдущие этапы (Security/Pipeline/Billing/Cost/DB audit reports).
- **SD-12** **Theme contract drift** — SESSION_CONTEXT § «Theme system» декларирует 2 темы (ink default + tide), реальный код 3 темы (`SUPPORTED_THEMES = ['pulse', 'ink', 'tide']`, default = pulse). Pulse — `:root` baseline (без attribute selector), green accent. Это самый visible UI-уровень drift. Стоит исправить SESSION_CONTEXT (или код, если решение — реально иметь 2 темы). См. UX-004.
- **SD-13** **Breakpoint cascade not documented** — реальные media queries `1280/1100/960/900/700/600`, SESSION_CONTEXT упоминает только 700px (cat unmount). 5 missing breakpoints. См. UX-016.
- **SD-14** **R4 iconography sweep claimed complete** — реально 11 emoji в i18n strings + 7 inline JSX emoji всё ещё в render path. WORKLOG entry 2026-05-20 «R4 iconography sweep» mark'нут как complete, но не финально. См. UX-003.

Финальный sync-pass по SESSION_CONTEXT планируется после всех 12 этапов.

---

## Cross-audit overlap

«One-fix-many-wins» backlog (расширен до **11 targets** с DB+UI уровень):

1. **Backup integrity rewrite** (DB-001+002+003+004 + SD-9) — 5 items.
2. **`notifications` migration** (UNIQUE compound + retention) — PIPE-006 + COST-016 + DB-007 + DB-008 — 4 items.
3. **Schema integrity sweep** (FK=ON + busy_timeout + orphan cleanup + retention loops) — DB-005+006+009+010+011 — 5 items.
4. **`db.transaction` wrap save loops** — DB-013 + COST-007 + TXN-002+003 — 3 items.
5. **`sqliteCutoff` consolidation** — DB-012 + DB-020 + DB-027 + SD-8 — 4 items.
6. **Housekeeping schedule** (logs + video-cache + auth_sessions + monitoring) — DB-010+011+014+022+023 — 5 items.
7. **`/api/scan` admin gate + immediate timestamp** (TRIPLE locked) — SEC-001 + PIPE-004 + BILL-003 — 3 items.
8. **DB-backed counter table `feature_usage_log`** — BILL-007 + COST-003 — 2 items.
9. **Hover preview plan-check + per-user rate-limit** — BILL-001 + COST-004 — 2 items.
10. **Proactive Google healthcheck + counter reset на success** — PIPE-002 + COST-006 + COST-008 — 3 items.
11. **(NEW) Focus trap implementation** — UX-002 + a11y compliance (4 modals + Lightbox) — single hook → 5 callsites — 1 fix покрывает all modal a11y.

UX-specific overlap с предыдущими аудитами:
- **UX-003 (R4 incomplete)** ↔ **WORKLOG R4 entry 2026-05-20** declares «complete» — overlap fix: одна passнаsweep по emoji.
- **UX-004 (theme drift)** ↔ **SD-12** — fix SESSION_CONTEXT (или code) — closes UX-004 + SD-12 + UI agent confusion.
- **UX-005 (4 hardcoded EN error toasts)** ↔ **BILL i18n wording inconsistencies** — общий i18n parity sweep закроет оба.
- **UX-006 (clickable divs)** + **UX-002 (focus trap)** + **UX-012/13 (semantic landmarks + heading hierarchy)** + **UX-017 (skip link)** = единый «a11y compliance sprint» — закроет 5 finding'ов одним sweep'ом.
- **UX-028 (image CDN proxying)** ↔ **SEC follow-up** — privacy gap, можно отложить, но overlap с security posture.
- **UX-019/20/21 (hardcoded EN/RU strings) + UX-005** — общий «i18n strict-mode sweep» — закроет 4 items.

---

## Out of scope / Followups

- **Admin panel UX/UI** (`src/admin/server.js`) — этап 7.
- **TG bot message format / parse_mode** — этап 8.
- **nginx/Docker/ufw production posture** — этап 9.
- **Cat mascot deep behavior** (FSM corner cases, listener leaks, Page Visibility freeze edge cases, timer cleanup correctness on unmount) — этап 10. Здесь R7 only visual + general UX verified.
- **SPA-trap protection** (extract inline React, code quality) — этап 11.
- **Documentation polish** — этап 12.

**Open assumptions** (помечены `⚠ assumes` или `⚠ requires runtime verification`):
- UX-014 (TrendList/Live stats/Sources UX states) — нужна live проверка в браузере.
- UX-023 (toast ✕ button) — runtime visual verify.
- UX-022 (history.pushState) — текущее поведение browser back unverified, эффект описан теоретически.

**Followup observability**: agent для CSS/themes хороший inventory дал, но один subagent написал "Pulse/Ink/Tide полностью определены" — что было misleading (pulse — `:root` baseline без attribute selector, не как ink/tide). Это привело к initial confusion. Lesson: для CSS audit'а sample-проверка ручная line-by-line на key files быстрее чем full grep delegate.
