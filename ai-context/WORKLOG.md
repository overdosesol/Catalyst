# WORKLOG

Активный журнал — **последние ~10 entries**. Всё что старше переезжает в
[`WORKLOG_ARCHIVE.md`](./WORKLOG_ARCHIVE.md) (правило `AGENT_RULES.md §6`).

Append на верх — новейшие сверху, старейшие снизу. Порог в 10 — мягкий:
если несколько entries относятся к одному PR/дню, можно временно держать
до 12 без архивации. Полная история — в git.

---

## 2026-05-02 (Admin StatusBar — pipeline в топбаре)

**Цель**: убрать декоративные шилды (RUNNING / age / preset) из топбара админки и перенести туда live-pipeline визуализацию (раньше была отдельной секцией только в ScannersPage).

### Изменения (`src/admin/server.js`)

- **StatusBar переписан** (~110 строк): теперь содержит логику бывшего `PipelineFlow` — polls `/api/pipeline` каждые 2.5с, рендерит 8 stage-нод + 7 wires в горизонтальный ряд справа от заголовка.
  - Левая часть: **🔄 Пайплайн** + subtitle с динамическим состоянием (`Live — Stage 1...` / `Последний цикл 12с назад (за 4.3с)` / `⏸ Сканер на паузе`).
  - Правая часть: компактные ноды (54×46 px, icon + count) + thin wires.
  - Active-нода: glow + pulse animation. Done-нода: muted accent border.
  - Active-wire: gradient sweep + shadow + opacity pulse.
  - Tooltip на ноде: `Stage 1 · gpt-5.4-mini` (показывает реальную модель цикла).
- **`PipelineFlow` компонент удалён** (~117 строк) — логика переехала в StatusBar.
- **`<PipelineFlow />` render из ScannersPage удалён** — теперь видна на каждой странице через топбар.
- **`.pflow-*` CSS удалён** (~27 правил, 27 строк).
- **`.shell-badge` CSS удалён** (бывшие шилды) — заменён `.sb-node / .sb-wire / .sb-head / .sb-pipeline / .sb-live-dot / .sb-paused` namespace.
- **`.topbar-actions` CSS удалён** — больше не нужен.
- **Responsive**: при `max-width: 1100px` топбар flex-direction column → пайплайн оборачивается под заголовком (на узких экранах).

### Проверка
- `node --check src/admin/server.js` ✓
- `scripts/check-admin-spa.cjs` ✓ (182366 chars, −2851 vs предыдущая)
- File: 5746 → 5679 строк (−67)

### Риски / заметки
- Polling вырос с 8с до 2.5с — но это та же частота что была у standalone PipelineFlow раньше, нет роста нагрузки vs PR-3 baseline.
- На очень узких экранах (<900px) ноды могут чуть наезжать друг на друга — wire `min-width:8px` это компенсирует, но если будет некомфортно, можно понизить до 6px.

---

## 2026-05-02 (Admin полный refactor — 4 фазы)

**Цель**: владелец заказал «улучшим админку полностью — добавим то чего не хватает, уберём лишнее, можно подкорректировать визуал, но не клонируя дашборд». PreStage не трогать.

Файл `src/admin/server.js`: 5895 → 5746 строк (-149 net; в реале вырезано ~330 строк мусора + добавлено ~180 строк новой функциональности).

### Фаза 1 — Cleanup (-280 строк дохлого кода)

- **`FilterProfilesSection`** (компонент + `_getFilterProfiles`/`_setFilterProfiles` методы + 4 импорта из `filter-profiles.js` + `FILTER_PRESET_META` const + `/api/filter-profiles` GET/POST handler) — мёртвое с PR-2, вынесли всё.
- **Дубликат-карточка «Управление рассылкой»** в BotPage (3464-3483): broken paste с кнопками `sendBroadcast` где должно быть `manageBroadcast`. Удалён.
- **4 unused user endpoints**: `PUT /api/users/:id`, `/users/:id/extend`, `/users/:id/block`, `/users/:id/unblock` — заменены `/subscription/grant|revoke` + `/status` ещё в PR-2.
- **«Очистить алерты»** перенесён с PaymentsPage на StatsPage в новую карточку **🧹 Обслуживание базы** (red-tinted .maintenance-card). Платежи != алерты — был семантический мисматч.
- **CSS-токены**: добавлены `--text3 / --muted / --border2 / --border3 / --accent-rgb / --accent-glow / --gloss-top / --shadow-card / --radius-*` в `:root`. До этого использовались, но не определялись → тихо ломали цвета в 6+ местах.

### Фаза 2 — Визуал и единые примитивы

- **Палитра**: оставлен характерный teal `#14b8a6`, добавлены `--accent-soft #5eead4`, `--accent-tint`, полные `*-rgb` тройки для всех state-цветов, full muted ramp (`--text2/3 / --muted / --dim`), full border ramp. Радиусы и shadow токенизированы.
- **`.card` hover-lift**: subtle `translateY(-1px)` + brighter border на ховере. Раньше карточки были полностью статичны.
- **Единый `.adm-tabs / .adm-tab / .adm-tab-count / .adm-tab-dot`**: свернули `exp-tabs` (ExamplesPage) и `pcfg-tabs` (PresetConfigsPage) в один namespace. Модификаторы `.bordered` (нижний border) и `.capitalize` (для preset-табов).
- **`<Section>` примитив** (~20 строк): обёртка с `icon`/`title`/`desc`/`actions`/`children`. CSS-классы `.adm-card-head / -title / -title-ico / -desc / -actions`. `broadcast-box` массово переименован в `adm-card` (15 usages) — он используется как universal section wrapper, имя теперь корректное.
- **DecisionsPage инлайн-стили → классы**: было ~100 inline `style={{...}}` блоков (нечитаемо). Извлечён `.dec-*` namespace (~26 правил): `.dec-card.sent/.skipped`, `.dec-row1`, `.dec-time/title/verdict`, `.dec-meta-row`, `.dec-atype-chip.event/.trend/.post`, `.dec-eng-chip`, `.dec-gate-chip.passed/.failed`, `.dec-breakdown`. JSX стал в 2× компактнее, перестилизация теперь тривиальна.

### Фаза 3 — Переструктурирование

- **BotPage → 3 под-таба**: 7 разнородных карточек (AI / Broadcast / Manage / History / Plans / Feedback weights / Recent reasons) на 450 строк прокрутки → 3 фокусированных вью через `subTab` state и `.adm-tabs.bordered` стрип. Карточки получили guards `subTab === 'ai|broadcasts|plans' && ...`.
- **`<StatusBar>`** в `<main>` topbar: пингует `/api/pipeline` + `/api/scanner-config` каждые 8 сек, показывает `🟢 RUNNING / ⏸ PAUSED / 🟡 IDLE` шилд + время с последнего цикла + active preset + текущий stage. Клик по live-state-шилду переходит на Сканеры. Использует осиротевший `.shell-badge` + добавлены state-варианты `.running` / `.paused`.
- **Live-индикаторы в сайдбаре**: poll каждые 12 сек в App. Жёлтый pulsing dot на табе «Сканеры» когда сканер на паузе. Numeric badge на табе «Алерты» с количеством решений в буфере. CSS `.nav-dot` (с `nav-pulse` keyframes) + `.nav-badge` (accent-tinted pill).

### Фаза 4 — Полишинг

- **«Краткие выводы» в StatsPage снесён**: filler-текст + дублировал данные «Размер БД» из верхних KPI. Active rate / Paid share / Доход lifetime инлайнены в карточку «Срез по хранению и метрики». `stats-bottom-grid` сменил layout с 2-col на 1-col.
- **UsersPage action-column → row-expand drawer**: 5 контролов в 420px-wide колонке (overflow на ноутах) → одна `⚙` кнопка на строку, клик открывает drawer-row снизу с двумя группами «Подписка» (plan select + days input + Выдать/Снять) и «Статус» (Заблокировать/Разблокировать). State `expandedId` (только одна строка открыта). CSS `.row-open / .row-drawer / .user-actions / .user-actions-group / .user-actions-label`.
- **Theme switcher** — пропущен. Админка по дизайну операторский тёмный инструмент, light-тема дала бы little value за большое количество правок CSS.

### Проверка
- `node --check src/admin/server.js` ✓
- `scripts/check-admin-spa.cjs` ✓ (185217 chars)
- Все 9 страниц open-able через нав, no JSX errors

### Риски / заметки
- StatusBar полит каждые 8 сек = ~2× HTTP вызова на цикл. Минимум на сервере.
- Sidebar polling каждые 12 сек = ~1.5× в минуту, очень мало.
- BotPage subTab state in-memory — при смене таба обнуляется. Если оператору важно «зашёл — продолжил с того где был», добавить sessionStorage-пост позже (не критично).
- `<Section>` компонент **определён**, но не использован внутри pages — это будущий шаг рефакторинга. На существующие adm-card он не влияет.

---

## 2026-05-02 (Source icons — настоящие SVG-логотипы)

**Цель**: владелец хотел оригинальные бренд-логотипы в `.source-icon` чипах. Letter-marks (R/G/𝕏/♪/#) хороши, но не выглядят как настоящие лого. Делаем inline SVG.

### Изменения (`src/dashboard/server.js`)

- **Новая константа `SOURCE_LOGOS`** рядом с `SOURCE_ICONS` (~line 4862): single-color SVG paths из simpleicons.org public-domain набора.
  - **reddit**: оригинальный Snoo (alien-голова в круге, ушки + глазки + улыбка)
  - **google_trends**: G-mark (single-color shape Google G)
  - **twitter**: X glyph (canonical post-rebrand X mark)
  - **tiktok**: music note silhouette с характерным «d»-хвостом
  - **x_trends**: hashtag (`#`) — что трендится в X
  - Все с `fill="currentColor"` → берут цвет от родительского чипа (per-data-src CSS color).
- **Компонент `SourceMark({ src, fallback })`** (~line 5070): рендерит `<span class="src-mark-svg" dangerouslySetInnerHTML="<svg>...</svg>" />` если SVG доступен; fallback на letter-mark из `SOURCE_ICONS`.
- **CSS `.src-mark-svg`** (~line 1990):
  - `width/height: 60%` от родителя (16px в 26px чипе, 22px в 38px feed-avatar)
  - Twitter X glyph чуть меньше (56%) — он от природы тонкий и высокий, оптически смотрится крупнее.
  - Feed-avatar: 58% (в более крупном чипе хочется немного breathing room).
- **Render-сайты**:
  - `.source-icon` в sidebar source-list — `SourceMark` напрямую.
  - `.feed-avatar` в `TrendCard` — `SOURCE_LOGOS[src] ? SourceMark : srcIco` (чтобы для unknown source осталась emoji-fallback).
- **Не трогал**: inline usage в top-narratives meta (`SOURCE_ICONS[tr.source]`), telegram-keyboard, ManualHistory hero — там текстовый glyph rendered inline, SVG был бы overkill.

### Проверка
- `node --check src/dashboard/server.js` ✓
- `scripts/check-dashboard-spa.cjs` ✓ (175582 chars, +3375 vs предыдущая)

### Риски / заметки
- `dangerouslySetInnerHTML` с приходом из локальной const-таблицы — XSS-чисто (никакого user-input). React's tree теперь рендерит `<span><svg>...</svg></span>`.
- Backticks в SVG strings отсутствуют → SPA-template-literal trap не сработал. Все SVG-paths написаны как single-line single-quoted строки в JS object literal.
- SVG paths занимают ~3KB символов в SPA bundle — приемлемо для 5 brands. Альтернатива (отдельный endpoint `/api/icons/<src>.svg`) добавила бы 5 round-trips на загрузку дашборда.

---

## 2026-05-02 (Source icons — letter-marks + remove eye glyph)

**Цель**: улучшить иконки источников в сайдбаре (и в pulse-rows справа); убрать смайлик глаза `👁/🙈` который при hover'е перекрывал счётчик постов справа.

### Изменения (`src/dashboard/server.js`)

- **`SOURCE_ICONS` global** (line ~4855): emoji → brand letter-marks.
  - `🟠 → R` (Reddit)
  - `🔍 → G` (Google)
  - `𝕏 → 𝕏` (Twitter/X — оставлен)
  - `🎵 → ♪` (TikTok)
  - `📈 → #` (X Trends — хэштег = что трендится)
  - Letter-marks read как brand glyphs, рендерятся crisp на любом размере, не зависят от font-эмодзи stack'а.
- **CSS `.source-icon` + `.pulse-icon`** (синхронно):
  - Размер 22→26 px, font-weight 600→800, font-size 12→13.5 px (16 px для `♪` чтобы выровнять оптически).
  - Per-data-src `color` в brand-цвете: reddit `#ff5800`, google `#4285f4`, twitter `#fff`, tiktok `#ff2469`, x_trends `#1d9bf0`.
  - Border alpha поднят (`.25 → .36-.42`) для чёткого контура.
  - `box-shadow: var(--gloss-top)` — лёгкий highlight сверху.
  - `.source-item:hover .source-icon { transform: scale(1.05) }` — едва заметная анимация hover'а (без layout shift).
- **`.source-eye` удалён**:
  - CSS-правило (~5 строк) убрано.
  - `<span className='source-eye'>` из render'а в источниках удалён.
  - Замена-сигнал не нужен: `.source-item.off { opacity: .5 }` + `.source-item.off .source-icon { filter: grayscale(1) }` уже визуально показывают off-state. Раньше глаз `👁` приземлялся прямо на цифру счётчика postов (тот тоже `position: absolute; right: 8px`).

### Проверка
- `node --check src/dashboard/server.js` ✓
- `scripts/check-dashboard-spa.cjs` ✓ (172207 chars)

### Риски / заметки
- `SOURCE_ICONS` используется глобально (TrendCard avatar, modal, pulse-rows, top sources strip, telegram-keyboard). Letter-marks отлично смотрятся в `.feed-avatar` (brand-gradient bg + white letter), inline в top-narratives meta тоже читабельно (`R · phase · 50 vrl`).
- Не trogал `SOURCE_LABELS` / `SOURCE_LINK_LABELS` — это полные имена («Reddit», «Twitter/X»), они отдельная роль.
- Fallback `'📡'` оставлен — если в БД появится новый source, не сломается.

---

## 2026-05-02 (Dashboard sidebar — кастомный dropdown категорий)

**Цель**: улучшить визуал внутри секции **КАТЕГОРИЯ** в сайдбаре дашборда + поменять эмодзи возле названия. Старая реализация — нативный `<select>`, у которого открытая option-панель полностью paint'ится chromium UA (тёмная синева на скриншоте) и игнорирует CSS. Не вписывался в X-style monochrome тему.

### Изменения (`src/dashboard/server.js`)

- **Эмодзи**: `📂 Категория` → `🏷️ Категория` (RU + EN i18n). Bookmark-tag тематически точнее под «category».
- **Новый компонент `CategoryDropdown`** (~70 строк) рядом с `PhaseBadge` (~line 4968):
  - Trigger-button показывает текущую категорию: `🏷️ icon + label + ▾`. На placeholder — `◆ + "Все категории"` в muted-цвете.
  - Click → animated `cat-dd-panel` (slide-in 140ms): «Все категории» reset-row + divider + список реальных категорий из `CAT_ICONS`.
  - Click-outside (mousedown) и Esc закрывают; useEffect привязан к `[open]`.
  - Active option: `var(--accent-glow)` фон + accent left-border + `✓` справа.
  - Hover: лёгкий white-alpha overlay + scale(1.08) на иконке.
- **CSS namespace `.cat-dd-*`** (~110 строк, после блока `select`):
  - `.cat-dd-trigger` — gloss-top shine, accent-glow при `.open`, rotated caret. Caret `▴` (закрыт) → `▾` после 180deg flip (открыт).
  - `.cat-dd-panel` — **открывается ВВЕРХ** (`bottom: calc(100% + 5px)`) потому что `CategoryDropdown` сидит в самом низу sidebar-а рядом с BottomNav. Падающее вниз меню перекрывало бы footer. z-index 50, max-height 320px со styled scrollbar (thin, accent thumb), shadow `0 -12px 40px` (свет сверху). Animation `cat-dd-slide-up` — слайд снизу вверх.
  - `.cat-dd-opt` — accent left-border ::before, scale-on-hover icon.
- **Замена в render**: `h('select', ...)` → `h(CategoryDropdown, { value, onChange, categories: Object.keys(CAT_ICONS) })`.

### Проверка
- `node --check src/dashboard/server.js` ✓
- `scripts/check-dashboard-spa.cjs` ✓ (171905 chars, +2927 vs предыдущая)

### Риски / заметки
- Native `<select>` стиль (`select { ... }` в CSS) **остался** — используется в других местах (e.g. админ-формы, settings panel). Не трогал.
- z-index 50 может конфликтовать только с modal sheet (`backdrop-filter`); modal перекрывает sidebar полностью, поэтому конфликта быть не должно.
- Mobile/touch: click-outside через `mousedown` работает на touch-устройствах (chrome/safari fire mousedown perevent default).

---

## 2026-05-01 (Dashboard sidebar — multi-select для фазы и типа)

**Цель**: в окнах **ФАЗА** и **ТИП** в сайдбаре дашборда сделать одновременный выбор нескольких чипов. Старое поведение — только один чип активен; клик на новый сбрасывал предыдущий. Чип «Все» остаётся exclusive — клик по нему всегда сбрасывает множество в пустое состояние.

### Изменения (`src/dashboard/server.js`)

**Серверная сторона** (`_handleTrends`):
- `?phase=early` → `?phase=early,forming,strong` (CSV); невалидные значения отфильтровываются.
- SQL: было `JSON_EXTRACT(...) = ?`, стало `IN (?,?,...)` — параметры пушатся динамически.
- Backwards-compat: одиночное значение `?phase=early` парсится как массив с одним элементом → ведёт себя идентично прежнему.

**Клиентский state**:
- `phase` (string) → `phases` (отсортированная CSV-строка, `''` = все). Persist в `localStorage.ts_phase_filter`.
- `alertTypeFilter` (string) → `alertTypes` (отсортированная CSV-строка, `''` = все). Persist в `localStorage.ts_alert_type_filter`. Старые single-value entries остаются валидными как 1-элементный CSV.

**Сайдбар-чипы** (обе секции):
- Чип «Все» (`◆`) активен когда CSV пустой; клик — сбрасывает CSV.
- Каждый цветной чип (early/forming/strong/saturated, event/trend/post) теперь toggle: добавляет/убирает свой ключ из CSV.
- Отрисовка через IIFE внутри `h('div', { className: 'sidebar-phase' }, ...)` — IIFE возвращает массив элементов (React flattens), а manual-only chip остался отдельным sibling-аргументом.

**Visible feed**:
- `visibleTrends` для alert-types фильтрует через `Set(alertTypes.split(','))`. Wildcard для legacy-rows без `alertType` сохранён.
- Phase-фильтр уходит на сервер через query (как раньше), просто многозначный.

**Reset-link** (`Сбросить`):
- Активен если CSV непустой (или manual-toggle включён в случае alert-type секции).
- Очищает CSV + localStorage + (для phase) сбрасывает `offset`.

### Проверка
- `node --check src/dashboard/server.js` ✓
- `scripts/check-dashboard-spa.cjs` ✓ (168978 chars, +2620 vs предыдущая версия)

### Риски / заметки
- Деплой не делал — пользователь триггерит через `.\deploy.ps1`.
- Backwards-compat для localStorage: сохранённые старые ключи (`'event'`, `'early'`) парсятся как 1-элементный CSV. Сброс не нужен.
- Сервер тоже принимает single-value (`?phase=early`) — старые bookmarks/clients не сломаются.

---

## 2026-05-01 (X Trends collector — новая платформа)

**Цель**: добавить X Trends (trending hashtags / topics с x.com) как **5-ю платформу** в pipeline, наравне с Reddit / Twitter / TikTok / Google Trends. Со своим коллектором, своим source-id (`x_trends`), своими per-preset настройками и UI-секцией.

**Принципиальное отличие от существующего Twitter collector'а** (`src/collectors/twitter.js`):
- Twitter collector делает **TWEET SEARCH** через Apify-актёров `kaitoeasyapi` / `xquik` (отдельные tweets)
- X Trends collector делает **TRENDS LIST** через `karamelo/twitter-trends-scraper` (топики/хэштеги)

### Источник данных

- **Apify actor**: `karamelo~twitter-trends-scraper` ($0.29 / 1000 results, 5★, 1.1K юзеров)
- **Стоимость**: ~30 трендов × 48 запусков/день × $0.00029 ≈ **$13/мес** (default refresh 30 мин)
- **Country**: hardcoded `United States` (English priority — единственный язык в US-trends списке)
- **Output shape (от актёра)**: `{ trend, time, timePeriod, volume }` — `volume` чаще всего пустая строка (X не экспонит публично), поэтому `minTweetVolume` фильтр **не реализован** — полагаемся на `rank` (array index) + AI-скоринг

### Архитектура коллектора (`src/collectors/x-trends.js`, ~210 строк)

- Class `XTrendsCollector extends BaseCollector`
- **Internal refresh timer** (`setInterval`, default 30 мин, `X_TRENDS_REFRESH_MINUTES` env) — decoupled от scanner cycle (~90 сек). Тренды реально обновляются раз в 15-30 минут, нет смысла дёргать чаще
- **Cache в памяти** `_cache: { fetchedAt, items }` — последний успешный Apify-результат
- **Dedup map** `_emitted: Map<slug, ts>` с TTL 6 часов. Re-emit если тренд исчезал и появился снова (signal of resurgence). Cap размера через GC старых ключей
- **`_inFlight` mutex** — coalesce concurrent refreshes (timer + sync fallback)
- **`startRefreshTimer()`** запускается в `index.js` constructor сразу после регистрации в `collectors[]`
- **`collect()`** на каждом scanner-cycle: читает per-preset config (`enabled` / `topN`), берёт top-N из cache, фильтрует через `_emitted`, возвращает diff
- **`stopRefreshTimer()`** — для graceful shutdown (пока не используется, но готово)

### Schema — `sources.xtrends` namespace

В `preset-config.js` добавлены 2 поля:
- `xtrends.enabled` (int 0/1) — per-preset toggle. UI рендерит как slider 0..1 (можно потом на toggle переписать, но с таким же эффектом)
- `xtrends.topN` (int 5-50, step 5) — сколько верхних трендов брать с каждого fetch

**Per-preset defaults**:

| Preset | enabled | topN | Reasoning |
|---|---|---|---|
| general | 1 | 20 | broad cast |
| animals | 1 | 10 | животные редко в top trends |
| culture | 1 | 25 | мемы спайкают быстро |
| celebrities | 1 | 25 | celebs часто доминируют |
| events | 1 | 30 | события flood'ят trending |

### Item shape для pipeline

```js
{
  source: 'x_trends',
  externalId: 'xtrends-us-<slug>-<YYYYMMDDHH>',  // hourly bucket → DB-dedup catches re-emits within hour
  title: 'Good Friday',                            // raw trend name
  description: 'Trending #1 on X in United States (Live).',
  url: 'https://x.com/search?q=Good%20Friday&src=trend',
  author: 'x_trends',                              // pseudo to satisfy downstream code
  timestamp: <ISO>,
  metrics: { rank: 1, country: 'United States', timePeriod: 'Live', tweetVolume: null }
}
```

Идёт через **тот же** pipeline что обычные посты: `Aggregator → cheapDedup → PreStage → Clusterer → Stage 1 → Stage 2 → alert-loop`. Никаких изменений в scorer/clusterer/prompts — Stage 1 видит обычный item, скорит memePotential по title. Stage 2 (Grok x_search) делает deep-dive на топик при passing.

### Wiring во все компоненты

- **`src/index.js`**: импорт + `new XTrendsCollector(config, logger, db)` + если `enabled` → `collectors.push(...)` + `startRefreshTimer()`
- **`src/dashboard/server.js`**:
  - `_handleSources` → массив включает `'x_trends'`
  - `SOURCE_ICONS['x_trends'] = '📈'`
  - `SOURCE_LABELS['x_trends'] = 'X Trends'`
  - `SOURCE_LINK_LABELS['x_trends'] = '📈 X Trends'`
  - CSS `.feed-avatar.x_trends`: linear-gradient `#1d9bf0 → #0a0a0a` (X-blue + ink)
  - CSS `.source-item[data-src="x_trends"]` + `.pulse-row[data-src="x_trends"]` — синяя tint
  - URL ведёт на x.com → переиспользуем `trend-link-twitter` className
  - `sourceOrder` (Stats) включает x_trends
  - Refactored hardcoded source-icon mapping в analyze hero на `SOURCE_ICONS[]` lookup (заодно убрана дубликация)
- **`src/notifications/telegram.js`**: `_sourcesKeyboard` allSources массив включает `'x_trends'`
- **`src/i18n/{ru,en}.js`**: `sourceNames.x_trends = 'X Trends'`
- **`src/admin/server.js`** SPA `SourcesAccordion`: новый sub-section `📈 X Trends` (4-й, перед Google Trends) — banner с описанием и стоимостью + 2 PSlider'а (enabled / topN)

### Env vars (`.env.example`)

Новый блок «X TRENDS»:
```
X_TRENDS_ENABLED=1               # global kill switch
X_TRENDS_REFRESH_MINUTES=30      # 5-onwards. Lower = fresher / pricier
X_TRENDS_COUNTRY=United States   # also: 'United Kingdom', 'Worldwide', 'Japan'
APIFY_X_TRENDS_ACTOR_ID=karamelo~twitter-trends-scraper
APIFY_X_TRENDS_KEY=              # optional, falls back to APIFY_API_KEY
```

### Smoke-test (на реальных sample-данных от оператора)

```
[XTrends] refreshed: 5 trends from United States
source: x_trends
  externalId: xtrends-us-goodfriday-2026050111
  title: Good Friday
  description: Trending #1 on X in United States (Live).
  url: https://x.com/search?q=Good%20Friday&src=trend
  metrics: { rank: 1, country: 'United States', timePeriod: 'Live', tweetVolume: null }
... (4 more)
Re-collect (dedup test): 0 items (expected: 0)
```

Парсер корректно обрабатывает trends с пустыми volume, dedup отрабатывает на повторном вызове.

### Operational notes

- **Если actor лёг / 429**: `_refresh()` логирует warn, `collect()` возвращает старый cache (или [] если cache пуст). pipeline продолжает работать без X Trends
- **Hourly externalId bucketing**: тот же тренд в том же часу = тот же ID → DB-dedup catches. Через час → новый ID, тренд может re-enter pipeline (ловим resurgence)
- **In-memory `_emitted` survives только в рамках процесса**. После рестарта Docker'а первый цикл может re-emit-нуть тренды что были до. Не страшно — DB hourly-bucket externalId всё равно их свяжет
- **Stale cache fallback**: если timer заглох (host suspend/resume, etc) и cache старше 2× refresh interval, `collect()` делает sync refresh inline. Защита на edge cases

### Проверка

- `node --check` × 6 файлов: OK
- `check-admin-spa.cjs`: 190 755 chars (+983 от X Trends UI)
- `check-dashboard-spa.cjs`: 166 333 chars (+86 от source labels)
- Smoke-test парсера на реальных данных: PASS
- Round-trip preset-config validator: defaults стрипаются до `{}`

**Деплой**: `.\deploy.ps1` → через ~5 секунд Apify-запрос, через ~30 сек первые items в pipeline, через ~90 сек первые `x_trends` карточки в дашбоде с источником `📈 X Trends`.

---

## 2026-05-01 (per-preset pipeline configs — PR-1/2/3 + Grok-audited tuning)

**Цель**: до этой работы каждый из 5 пресетов (`general/animals/culture/celebrities/events`) имел только per-preset junk-filter (через старый `filterProfiles`). Всё остальное — alert thresholds / weights / stale decay / cluster-similarity / коллекторские источники — было либо глобальным, либо хардкодом в `.js` файлах. Цель: **полностью per-preset pipeline tuning** через единый JSON-блоб + admin UI.

**Архитектура** (3 PR'а в одной сессии):

### PR-1 — Foundation

**Новый модуль** `src/analysis/preset-config.js` (~470 → 540 строк после PR-1 helper'ов):
- `PRESET_KEYS` — `['general', 'animals', 'culture', 'celebrities', 'events']`
- `PRESET_GROUPS` — `['sources', 'junk', 'alerts', 'cluster']` (порядок аккордеонов в UI)
- `PRESET_FIELD_RANGES` — метаданные полей: тип (`int`/`float`/`list`), min/max/step, label/desc для UI, флаг `positive: true` для weight-полей которые входят в Σ ≤ 1.0 budget
- `DEFAULT_PRESET_CONFIGS` — полные defaults для всех 5 пресетов. Структура:
  ```
  { <preset>: {
      sources: { reddit: {...}, twitter: {...}, tiktok: {...}, googletrends: {} },
      junk:    { politicsPenalty, kpopPenalty, ... },
      alerts:  { thresholds: {...}, weights: {...}, stale: {...} },
      cluster: { simThreshold, weightEmbedding, ... }
  } }
  ```
- `resolvePresetConfig(preset, overrides)` — deep-merge defaults + per-preset patch (immutable, frozen defaults preserved)
- `getActivePresetConfig(db)` — one-stop helper для consumer'ов: читает active preset из settings + резолвит
- `validatePresetOverrides(input)` — strict validation: range-check каждого leaf, drop полей равных default (compact blob), assert Σ POSITIVE ≤ 1.0 для `alerts.weights` и `cluster`
- `readPresetOverrides(db)` — tolerant JSON-read из settings
- `getEffectivePresetConfigs(overrides)` — таблица для UI

**DB миграция** (`src/db/database.js`, marker `presetConfigsMigratedV1`):
- One-shot: читает legacy `filterProfiles` + 13 глобальных `alertThreshold`/`alertWeight*`/`alertStaleDecay*`/`alertHardJunkStop`/`maxAlertsPerCycle`/`minScoreToSave`
- Если значение отличается от defaults → копирует во ВСЕ 5 пресетов (preserve existing operator behavior)
- Прогон через `validatePresetOverrides` → стрипает совпавшие с new defaults (compact blob)
- Legacy глобальные ключи **не удаляются** — остаются как fallback на время transition

**Endpoints** (`src/admin/server.js`):
- `GET /api/preset-configs` → `{ defaults, effective, overrides, fieldRanges, presets, groups }`
- `POST /api/preset-configs` `{ overrides }` — гейт через существующий `X-Admin-Key` (admin server и так operator-only by design — не нужен отдельный custom gate)
- `_getPresetConfigs()` / `_setPresetConfigs(body)` helpers, параллель к существующим filterProfiles

**Минимальный UI** (PR-1 ship): `PresetConfigsPage` с tab strip пресетов + большой JSON textarea redactor для overrides + read-only inspector panes (defaults / effective / overrides). Заменён в PR-3 на полноценный UI.

### PR-2 — Consumer wiring

**Все читатели переключены на резолвер**:

| Файл | Что меняется |
|---|---|
| `analysis/scorer.js` | `loadAlertWeights(db)` теперь читает per-preset (`alerts.weights/.stale/.thresholds.alertHardJunkStop`). Backward-compat: без `db` → DEFAULT_ALERT_WEIGHTS |
| `analysis/clusterer.js` | constructor больше **не** читает `clusterSimThreshold`/`clusterWeight*` — снапшотятся в `_refreshClusterParams()` в начале каждого `route()`. Junk-filter call site строит `{ [activePreset]: cfg.junk }` blob из preset-config'а вместо чтения legacy `filterProfiles` |
| `collectors/reddit.js` | `_resolveRedditConfig()` per-cycle: `subreddits` / `minUpvotes` / `postsPerSubreddit` из preset config. Env-overrides (`config.reddit.*`) сохранены приоритетом |
| `collectors/twitter.js` | `_getQueries()` читает `sources.twitter.queries` per-preset. Env-override `customQueries` приоритетен |
| `collectors/tiktok.js` | `_getHashtags()` читает `sources.tiktok.hashtags` per-preset. Попутно фикс pre-existing бага: старые `PRESET_HASHTAGS` имели keys `general/animals/ai/elon/sports` — не матчили `PRESET_KEYS`, culture/celebrities/events падали в `general` |
| `index.js` (alert-loop) | `alertThreshold` (floor), `maxAlertsPerCycle`, `minScoreToSave` читаются из active preset config (`getActivePresetConfig(db).alerts.thresholds.*`) |

**Cleanup global allowed-lists** (атомарно с consumer wiring):

- Admin `_setScannerConfig` allowed-list trimmed: убраны 13 полей (`alertThreshold`, `minScoreToSave`, `maxAlertsPerCycle`, `alertHardJunkStop`, 6×`alertWeight*`, 3×`alertStaleDecay*`). Оставлены только orthogonal global knobs: `twitterMaxAgeHours`, `rescoreCooldownHours`, `stage2Threshold`, `stage2MaxCalls`
- Admin `_getScannerConfig` GET shape — те же поля убраны из ответа
- Dashboard `_handleSettings*` allowed-list — убран `alertThreshold` / `minScoreToSave` / `maxAlertsPerCycle`. User-level `users.alert_threshold` через `/api/user/threshold` остался (per-user, не глобальный)

**UI cleanup в `ScannerConfigSection`**:
- Удалены 4 sub-секции (Alerts thresholds / Weights / Stale decay / Storage)
- Заменены на единый banner «Алерты, веса, stale-decay, junk и cluster — теперь в табе Пресеты»
- `FilterProfilesSection` removed из `ScannersPage` рендеринга (компонент остался в файле для возможного rollback)
- `JunkStatsSection` оставлен — observability полезна

### PR-3 — Полноценный admin UI

**`PresetConfigsPage` переписан с нуля** (~600 строк UI + ~50 строк CSS):
- **Tab strip** — 5 пресетов, override-индикатор `●` если есть overrides
- **4 раскрывающихся аккордеона** (`<details>`) на активный пресет:
  - **📡 Sources** (открыт по дефолту): per-platform sub-sections — Reddit (chip-input subreddits + 2 sliders) / Twitter (chip-input queries) / TikTok (chip-input hashtags) / Google Trends (placeholder)
  - **🚫 Junk filter**: 6 sliders
  - **🔔 Alerts** с 3 саб-секциями: Thresholds (4 sliders) / Weights (5 budget-clamped + SumMeter + junk multiplier отдельно) / Stale decay (3 sliders)
  - **🧬 Cluster**: 2 простых slider'а + 4 budget-clamped weight slider'а с SumMeter
- **Component primitives**:
  - `PSlider` — slider row с override-dot + reset-to-default `↺` button
  - `BudgetSlider` — clamps onChange к remaining budget (Σ positive ≤ 1.0). Показывает `⛔` когда atLimit
  - `PChips` (через `ChipInputBox`) — chip-input для list fields с Enter/blur/Backspace
  - `SumMeter` — live read-only Σ для budget группы (получает `getEffective` через prop drilling)
- **Draft mutators**: `setLeaf` walks/creates path в draft, drops leaf если value == default, GC empty parent objects вверх по chain
- **Actions row**: Save / Reload / Reset preset «X» / Clear ALL
- **Debug fallback** в `<details>`: 3 inspector pane'а (defaults / effective / draft) для активного пресета

**CSS**: новый namespace `.pcfg-*` (.pcfg-tabs / .pcfg-accordion / .pcfg-row / .pcfg-chip / .pcfg-budget / etc) — параллельно `.scfg-*`, без коллизий.

### Post-Grok-audit tag/slider tuning

После завершения PR-1/2/3 — **массовое обновление дефолтов** через `DEFAULT_PRESET_CONFIGS`:

**Структурное**: убраны shared константы `DEFAULT_ALERTS` + `DEFAULT_CLUSTER` (раньше все 5 пресетов делили identical alerts + cluster). Каждый пресет получил полный самодостаточный набор.

**Tuning rationale per preset**:
- **general**: broad net, mixed lifespan, balanced weights
- **animals**: slow lifespan (cute capybara stays cute), low density, **meme-dominant** (memePotential=0.45). phash heavy в кластере (visual matching), gentle stale-decay (per-hour=1, grace=48h, cap=20)
- **culture**: short lifespan (memes die fast), very high density, **meme-dominant** (0.45), phash + embedding equally heavy в кластере (0.40 каждый), aggressive stale-decay
- **celebrities**: short lifespan, very high density, **virality-dominant** (0.30). Strict junk-multiplier (0.55) — celeb-noise floods otherwise
- **events**: hours-long lifespan (news rots), medium density, **emergence-dominant** (0.35). embedding+entity heavy в кластере (event = many framings of same news), very aggressive stale-decay (per-hour=5, grace=6h, cap=60), short cluster window (timePenaltyHours=6)

**Σ POSITIVE invariant**: для `alerts.weights` (5 positive) и `cluster.*` (4 positive) во всех 5 пресетах = **ровно 1.00**. Validated automated.

**Sources update** (post-Grok аудит):
- **Reddit general**: убраны `interestingasfuck` + `Damnthatsinteresting` + `BeAmazed` (overlap / low activity), добавлены `funny` + `mildlyinteresting` + `wholesomememes`
- **Reddit animals**: добавлены `FunnyAnimals` + `AnimalMemes` (рост 2024-2025)
- **Reddit culture**: добавлены `ContagiousLaughter` + `HolUp` + `196` (свежие meme-сабы). `TikTokCringe` оставлен (Grok хотел убрать — но это ценный TikTok→Reddit propagation signal)
- **Reddit celebrities**: убран `hiphopheads` (overlap с popheads), добавлены `kpop` + `Deuxmoi` (доминируют 2026)
- **Reddit events**: убран `UpliftingNews` (feel-good, не события), добавлен `nottheonion` (странные real events)
- **Twitter culture**: убраны устаревшие 2023-2024 queries `(cancel OR ratio OR main character)` и `(gen z OR boomer)`, добавлены свежий gen-z slang `(skibidi OR delulu OR rizz OR brainrot OR mewing)` + cross-platform `(tiktok OR reels OR fyp) (viral OR trending)`
- **Twitter celebrities**: убраны конкретные имена `(elon OR trump OR drake OR kanye)` (cooling / политика), добавлены актуальные K-pop группы `(bts OR blackpink OR straykids OR seventeen OR twice)` + targeted `(kpop OR k-pop OR idol) (drama OR comeback OR scandal)`
- **Twitter events**: добавлен `(trump OR election OR debate OR primary)` для 2026 election cycle
- **TikTok general**: **полная замена** — было 100% crypto (`memecoin/solana/cryptomeme`) → стало generic viral (`fyp/viral/trending/foryou/funny/...`). Это был критический баг — TikTok general не ловил generic TikTok контент
- **TikTok все остальные**: точечные обновления (добавлены `dogsoftiktok` для animals, `pov`+`brainrot` для culture, `bts`+`blackpink` для celebrities, `aivideo`+`severeweather` для events)

### Поведенческие изменения после PR'ов

| Пресет | Что заметно меняется |
|---|---|
| **general** | TikTok перестаёт давать только crypto-контент → generic viral |
| **animals** | Reddit min_upvotes 5000→3000 (animal subs мельче), threshold 60→55, meme weight 0.35→0.45, stale grace 24→48h |
| **culture** | minScoreToSave 0→10 (экономим DB), threshold 60→65 (строже), AI ловит свежий gen-z slang, stale decay 2x faster |
| **celebrities** | X queries переключились на K-pop (BTS/BlackPink доминируют 2026), threshold 60→70 (строжайший), junk-multiplier 0.50→0.55 |
| **events** | threshold 60→50 (ловим раньше breaking news), maxAlertsPerCycle 0→10 (cap), stale decay 2.5× агрессивнее, cluster timeWindow 24h→6h |

### Operator-only гейт

**Уточнение архитектуры**: PR-1/2/3 endpoints (`/api/preset-configs` GET/POST) живут на **admin server** (port 8081), который и так гейтится через `X-Admin-Key` env var — single shared key. Это **архитектурно operator-only by design** (только тот у кого есть env-key, обычно через SSH-tunnel). Никакого дополнительного custom-middleware не нужно — отличается от dashboard server (port 8080) где есть multi-user auth с TG-linked accounts (вплоть до `plan='admin'` users — но они в admin server **не попадают**).

### Файлы тронутые в этой работе

**Новые**:
- `src/analysis/preset-config.js`

**Сильно модифицированы**:
- `src/analysis/scorer.js` (loadAlertWeights переключён)
- `src/analysis/clusterer.js` (cluster knobs + junk через preset-config)
- `src/collectors/{reddit,twitter,tiktok}.js` (sources через preset-config)
- `src/db/database.js` (миграция `presetConfigsMigratedV1`)
- `src/admin/server.js` (+`PresetConfigsPage` UI ~600 строк, +endpoints, -4 sub-sections в ScannerConfigSection)
- `src/dashboard/server.js` (cleanup `_handleSettings*`)
- `src/index.js` (alert-loop читает per-preset)

### Trap caught

В PR-3 **дважды** трапнулся на backticks-в-комментариях внутри SPA template literal:
- `\`formatValue\` overrides the default display` → SyntaxError `Unexpected identifier 'formatValue'`
- `siblings is an array of` (оригинал был `\`siblings\``) → SyntaxError `Unexpected identifier 'siblings'`

Поймано `node --check`, замена backticks на plain text. **Урок переподтверждён**: внутри `_spa()` — НИКОГДА backticks даже в JSDoc/комментариях. Этот файл (preset-config) не имеет outer template literal так что ему backticks безопасны — но admin/server.js внутри `_spa()` — нет.

### Проверка финального state

| Что | Результат |
|---|---|
| `node --check` × 7+ файлов | OK |
| `check-admin-spa.cjs` | OK (189 772 chars после PR-3, +17K от UI) |
| `check-dashboard-spa.cjs` | OK |
| Σ positive weights × 5 presets × 2 groups (alerts + cluster) | 10/10 = exactly 1.00 |
| Round-trip (DEFAULT_PRESET_CONFIGS → validator) | OK — стрипается до `{}` |
| Behavior parity smoke (no-db / empty-preset / override-routing) | 6/6 PASS |
| End-to-end UI save flow (chip-input + slider + budget-clamp) | OK |

---

## 2026-05-01 (post-theme polish: bars / surfaces / Account / TG-threshold rename)

**Цель**: после rewrite темы остались разрозненные «осколки» midnight-палитры (синие тинты в overlay'ях/барах) и слишком яркие серые поверхности. Плюс нужно было привести в порядок Account-панель (overflow тогглов, кричащий accent-gradient на hero) и переименовать слайдер «Чувствительность алертов» — он управляет только TG-пушами, не фидом.

**Изменения** (все в `src/dashboard/server.js`):

### Bars + overlays — привязка к theme tokens

- **`.nav` (top bar)**: было хардкод `linear-gradient(rgba(12,12,22,.96) → rgba(8,8,15,.92))` (синеватый midnight-tint), стало `linear-gradient(var(--surface) → var(--bg))` — на ink это `#0a0a0a → #000000`, незаметная elevation, тема-агностично
- **`.statusbar` (bottom bar)**: тот же фикс, mirrored gradient `var(--bg) → var(--surface)` (снизу чуть приподнимается)
- **`.sheet-overlay` (modal backdrop)**: было `background: rgba(4,6,14,.55)` + `backdrop-filter: blur(14px) saturate(1.1)` — синий тинт + saturate boost'ил остаточную синь из контента под блюром. Стало `rgba(0,0,0,.62)` + только `blur(14px)`. Нейтральный blackout на любой теме.

### Surfaces — выравнивание яркости

Юзер указал что центральные карточки фида и блоки правой колонки выглядят ярко-серыми относительно тёмного сайдбара. Корень — массовое использование `var(--card)` (#16181c) для surface'ов:

- **`.feed-card`**: было `linear-gradient(var(--card2) → var(--card))` (#1c1f24 → #16181c, заметно серое). Стало `var(--surface)` (#0a0a0a) + `box-shadow: var(--gloss-top)` — карточки матчат сайдбар, только 1px border их выделяет
- **`.feed-card:hover`**: `linear-gradient(rgba(255,255,255,.04), rgba(255,255,255,.015))` — soft white-alpha overlay (X-приём), даёт лифт без сдвига оттенка. Раньше было `linear-gradient(--card3 → --card2)` — тоже серое
- **`.right-section`**: `var(--card)` → `var(--surface)`. Right-panel секции теперь матчат feed-panel + сайдбар
- **`.settings-card`**: `var(--card)` → `var(--surface)`. Карточки в Account/Settings sheets теперь не выделяются ярко-серым

### AccountPanel — общая чистка

Юзер прислал скрин: тоггл-боксы алерт-типов выезжали за границу карточки, текст обрезался. Корень — `Row` primitive рендерил label + control в горизонтальную flex с `flex-shrink: 0` на control'е, контент длиннее ширины не ужимался.

- **`Row` primitive получил `stacked` prop**: side-by-side по дефолту (как было); `stacked: true` → `flex-direction: column`, control во всю ширину снизу label'а. Применён в AlertTypesRow
- **CSS overflow-страховка глобально**:
  - `.setting-row`, `.setting-control`, `.setting-label` — везде `min-width: 0` (canonical fix для flex с длинным текстом)
  - `.setting-control`: `flex-shrink: 0 → 1` + `max-width: 100%`
  - `.atype-toggle-group`/`.atype-toggle`/`.atype-toggle-label`: `min-width: 0` + `width: 100%` + `overflow-wrap: break-word`
- **Тексты тогглов сокращены**:
  - «Событие — конкретный триггер (кто-то что-то сделал/сказал)» → «Событие — конкретный триггер»
  - «Тренды — нарратив набирает обороты на разных платформах» → «Тренды — на нескольких платформах»
  - EN аналогично
- **`.account-hero`**: убран `background: linear-gradient(135deg, rgba(--accent-rgb, .09), --card 70%)` (электрически-синий диагональ от accent) → plain `var(--surface)`. Аватар остаётся единственным цветным focal point карточки
- **`.account-avatar-big`**: убран жирный `2px solid rgba(--accent-rgb, .5)` border + цветной accent-glow → 1px subtle ring + нейтральный `box-shadow: 0 2px 10px rgba(0,0,0,.4)`. Глянцевый, но не кричащий

### TG-threshold rename (Variant A)

Юзер заметил что слайдер «Чувствительность алертов» ничего не делает в дашбоде — он управляет только TG-пушами через alert-loop в `src/index.js`. Дашбод-фид показывает все Stage-1 трейнды независимо. Старое имя создавало впечатление общего фильтра.

- **Title**: «Чувствительность алертов» → «Порог Telegram-алертов» (RU). EN: «Alert sensitivity» → «Telegram alert threshold»
- **Desc**: явно добавлено «На фид в дашбоде НЕ влияет — для этого есть фильтр Adoption в сайдбаре»
- **Icon**: 🎯 → ✈️ (paper plane намекает на Telegram-scope)
- **Логика не тронута** — сервер-сайд `_handleUserThresholdPost` пишет в `users.alert_threshold` как было; гейт в alert-loop читает оттуда

**Trap stuck twice**:
1. Backtick в JSDoc: `// stacked:true for...` — сломал outer literal с `Unexpected identifier 'stacked'`. Поймано `node --check`, заменил на `stacked:true` без backticks
2. Backtick в комменте про cache-bust в logo-handler секции — поймано в прошлой итерации

**Проверка**: `check-dashboard-spa.cjs` green после каждого подхода. Финальный размер 166247 chars.

**Деплой**: `.\deploy.ps1` + Ctrl+F5. Старые темы в localStorage автоматически вылетят в дефолтный ink.

---

## 2026-05-01 (theme system rewrite — X-style monochrome)

**Цель**: 7 ярких тем (midnight/teal/abyss/violet/acid/sunset/cyberpunk) с разноцветными акцентами заменить на 4 минималистичные в стиле X (Twitter): один акцент-цвет, монохромная палитра, глянцевые поверхности.

**Старые темы выпилены** (`midnight/teal/abyss/violet/acid/sunset/cyberpunk`). Юзеры с сохранённой старой темой получают дефолт `ink` через validity-check в `detectTheme` — миграция не нужна.

**Новые темы** (4 шт, все в `:root` + `body[data-theme="..."]` блоки):

| Theme   | bg        | accent    | use case                                |
|---------|-----------|-----------|------------------------------------------|
| `ink`   | `#000000` | `#1d9bf0` | дефолт. X true-black + X-blue             |
| `dim`   | `#15202b` | `#1d9bf0` | X dim-mode (синевато-графитовый)          |
| `slate` | `#0e0f10` | `#ffffff` | Apple-style нейтральный графит, белый акцент |
| `mono`  | `#0d0d0d` | `#b8b8b8` | чистый grayscale, без хроматики           |

**Дизайн-принципы**:
- Один accent-цвет на тему, экономно (никаких rainbow-палитр)
- Borders translucent white at low alpha (`rgba(239,243,244,.08-.22)`) вместо tint'а от accent
- Семантические state-цвета (green/red/orange/yellow) **константны** во всех темах — OK/error не должны менять hue от темы
- **Glossy effects**: добавлены два token'а в `:root`:
  - `--gloss-top: inset 0 1px 0 rgba(255,255,255,.04)` — лёгкий top-edge highlight (свет на верхней грани)
  - `--gloss-edge: inset 0 0 0 1px rgba(255,255,255,.02)` — общий edge-glow
- `.feed-card` теперь рендерится с `linear-gradient(180deg, var(--card2), var(--card))` background + `box-shadow: var(--gloss-top)` — карточка читается как глянцевая, не плоская

**Файлы изменены**: `src/dashboard/server.js`:
- `:root` block переписан (lines ~1531-1576) — палитра X-ink + новые tokens
- 6 старых `body[data-theme="..."]` блоков удалены (~1578-1770) → заменены на 3 новых (`dim`/`slate`/`mono`, ink в :root)
- `.theme-swatch[data-theme-preview="..."]` блоки переписаны под новые имена (24 строки → 12)
- `SUPPORTED_THEMES` + `THEME_META` + `detectTheme` дефолт обновлены
- `.feed-card` background теперь gradient + gloss-top

**Проверка**:
- `node --check` green
- `check-dashboard-spa.cjs` green (164763 chars, было ~170K — палитра компактнее благодаря удалению 4 темных блоков)

**Деплой**: `.\deploy.ps1` + Ctrl+F5. Юзеры со старыми темами в localStorage автоматически переключатся на дефолтный `ink` при следующей загрузке.

---
