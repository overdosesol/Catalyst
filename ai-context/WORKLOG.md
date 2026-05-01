# WORKLOG

Активный журнал — **последние ~10 entries**. Всё что старше переезжает в
[`WORKLOG_ARCHIVE.md`](./WORKLOG_ARCHIVE.md) (правило `AGENT_RULES.md §6`).

Append на верх — новейшие сверху, старейшие снизу. Порог в 10 — мягкий:
если несколько entries относятся к одному PR/дню, можно временно держать
до 12 без архивации. Полная история — в git.

---

## 2026-05-02 (Dashboard polish — hide btn / archive UX / sources fix / layout)

Серия мелких follow-up'ов после крупных правок выше.

### `.feed-hide-btn` — квадратный + не перекрывает теги
- Был круглый (`border-radius: 50%`) 24×24, top:6 right:6. Перекрывал самый правый бейдж (POST/STRONG/category) при hover.
- Стал 22×22 + `border-radius: 5px` (как у `.badge`), top:9 right:9, font-size 11. Читается как часть chip-row.
- `.feed-badges` получил `margin-right: 28px` — резерв под кнопку, бейджи теперь сдвигаются влево.

### Settings sheet
- `.settings-actions` — `justify-content: flex-end → center`. Кнопка «↺ Reset all settings» теперь по центру нижнего ряда модала.

### Archive UX
- **Collapsible** — `<ArchiveCard>` теперь по дефолту закрыт. Заголовок-кнопка с caret `▸` (rotate 90° при open). Body с fade-in анимацией.
- **Lazy load** — `useEffect(() => { if (open && items === null) load(); })` — fetch `/api/trends/hidden` срабатывает только при первом open. Юзер не открывает архив → API вообще не дёргается.
- **Clear archive сверху** — кнопка перенесена из `.archive-actions` (footer) в `.archive-actions-top` (выше списка).

### Layout — адаптация под отсутствие нижней полосы
4 места в CSS вычитали `28px` (бывшая высота statusbar) из `100vh`. Убрал везде:
- `.layout` `min-height: calc(100vh - 50px - 28px)` → `calc(100vh - 50px)`
- `.sidebar` (sticky) → `calc(100vh - 50px)`
- `.main` (feed scroll) → `calc(100vh - 50px)`
- `.dashboard-grid` → `calc(100vh - 50px)`

Результат — sidebar / лента / правая колонка тянутся до низа экрана без 28px пустой полосы.

### Sources в правой колонке — undefined-фикс
- Endpoint `/api/sources` отдаёт поле `source`, не `id`. Мой render использовал `s.id` → `SOURCE_ICONS[undefined]` → fallback `📡` для всех 5 пилл, в title было `undefined`.
- Заменил `s.id` → `s.source` (key, title, lookup).
- Завернул glyph в `<span class="right-sources-glyph">` — добавил CSS с brand-цветом per-source через `[title^="Reddit"]/[title^="Twitter"]/...` (Reddit оранжевый #ff5800, TikTok #ff2469, Google #4285f4, X Trends #1d9bf0). Off-state — `var(--dim)`.

### Проверка
- `node --check src/dashboard/server.js` ✓
- `scripts/check-dashboard-spa.cjs` ✓ (186333 chars)

### Trap caught
Backtick в JSDoc-комментарии внутри SPA — `with \`open\` so` сломал outer literal с `Unexpected identifier 'open'`. Поймано `node --check`, заменил на `with the open flag so`. **Урок переподтверждён** (см. SESSION_CONTEXT § «Ловушка server.js»): внутри `_spa()` НИКОГДА не писать backtick даже в комментариях.

---

## 2026-05-02 (TrendModal cleanup + статусбар → правую колонку)

**Цель**: 6 точечных правок в дашборде по запросу владельца:
1. Убрать «↳ Быстрая stage-1 подсказка...» в TriggerSection
2. Убрать подписи возле фазы нарратива («Сильный сигнал — действуй быстро» и т.д.)
3. Сделать Story hook красивее в стиле дашборда
4. Виральность → метрики поста (👁 ❤️ 💬 🔁 без надписей)
5. Перенести фазу нарратива в head модала рядом с другими бейджами, без заголовка
6. Убрать нижнюю полоску, sources перенести в правую колонку Activity, переименовать Activity → Live

### Изменения (`src/dashboard/server.js`)

**Server**:
- `_formatTrend` теперь добавляет `engagement: { views, likes, comments, reposts }` — унифицированная shape per-source: Twitter `views/likes/replies/retweets`, TikTok `plays/likes/comments/shares`, Reddit `upvotes` в slot views (UI рендерит ⬆️), `comments`. Manual-analysis synth shape тоже зеркалит engagement.

**TrendModal**:
- **Head**: добавлен `<PhaseBadge>` рядом с alertType / category / source. Старая labelled-секция «🧭 Narrative phase» удалена. Subtitle с phaseHint больше не рендерится.
- **Story hook** вынесен из `ScoreBar.sub` в отдельный блок `.story-hook`: accent left-border + soft gradient, italic body, big quote marks (Georgia serif). Читается как pull-quote, а не как sub-label слайдера.
- **Virality cell** (`modal-stat`): теперь рендерит engagement metrics через `.modal-engagement` (2-column emoji-grid). Если ни одного counter'а > 0 — fallback на старое число `trend.score`. `fmtCount` сжимает в `1.2M`/`45K`. Reddit использует `⬆️` вместо `👁`.

**TriggerSection** (`src/dashboard/server.js`):
- Удалён блок `t('trigger.help_quick')` — болтливая фраза, которую владелец просил убрать.

**RightPanel**:
- Принимает `sources` и `scanning` props.
- Activity-секция: title теперь `🟢 Live` (или `OFFLINE` при паузе) с pulsing-dot вместо «📊 Activity». Под cells добавлен sub-block `.right-sources` с pill-листом источников (emoji + status-dot, off-state приглушён opacity 0.4).
- i18n: `right.activity` → «🟢 Live», добавлены `right.sources_label/active/kbd_hint`.

**App-level**:
- Удалён `<StatusBar>` рендер (sources + signals + alerts + kbd-hints перенесены в right panel).
- Передаются `sources` + `scanning` в `<RightPanel>`.

**Cleanup dead code** (раз уж заходили):
- Функция `StatusBar` целиком удалена (~40 строк).
- CSS `.statusbar*` целиком удалён (~50 строк).
- i18n keys `status.signals/alerts/sources/updating/kbd.refresh/kbd.close` удалены (RU + EN).
- i18n keys `trigger.help_quick`, `story.hook_label`, `modal.phase` удалены (RU + EN, не вызываются после фикса).
- `.undo-toast bottom: 64px → 24px` (статусбар больше не занимает место внизу).

**CSS (новое)**:
- `.modal-engagement` + `.modal-engagement-item/-ico/-num` — 2-col grid, JetBrains Mono, tabular-nums.
- `.story-hook` + `.story-hook-mark/-text` — pull-quote с accent border-left и Georgia-quotes.
- `.right-live-dot` (+ `.paused`) — green/red pulsing dot для Activity-title.
- `.right-sources/-head/-label/-count/-list/-pill/-dot` — sub-block в Activity-секции.

### Проверка
- `node --check src/dashboard/server.js` ✓
- `scripts/check-dashboard-spa.cjs` ✓ (185042 chars; было ~183500 до правок, +1.5K от новых блоков, минус ~80 строк dead-code)

### Риски / заметки
- **Engagement counts для legacy-rows**: метрики хранятся в `raw_metrics` JSON, поля типа `views/plays/likes/comments/upvotes/retweets/shares`. Старые row'ы без какого-то поля → `null` → не рендерится pill. Если все четыре null — fallback на `trend.score`. Никогда не покажет «0».
- **Reddit upvotes в slot views**: использовал ⬆️ вместо 👁 чтобы не вводить в заблуждение (Reddit views недоступны через API). Альтернатива — вообще скрыть views для Reddit и оставить только likes/comments — но `upvotes` это и есть «likes-эквивалент» для Reddit, лучше показать.
- **Mobile responsive**: на узких экранах `.modal-engagement` остаётся 2-col grid (4 metrics в 2×2). При совсем маленьких modal-stat ширинах может ужаться — `font-size: 12px` + `gap: 4px 10px` справляются. Если будет криво — переключим на flex-wrap.
- **Sources в right panel**: на узких screen-ах right-panel сворачивается в `display: none` (responsive @media). Тогда sources вообще не видны — но и раньше при таком layout юзер мобильный, статусбар тоже скрывался при `bottom-nav` overlay. Acceptable.
- **PhaseBadge в head**: модал-head на узких screen-ах flex-wrap'ит чипсы, фаза становится в новый ряд. Не критично, читабельно.

---

## 2026-05-02 (Per-user hide alert + архив в дашборде)

**Цель**: дать юзеру кнопку «скрыть алерт» (✕ в правом верхнем) на каждой карточке, скрытие per-user и server-side. В настройках — секция «Архив» со списком скрытых, кнопка «Вернуть» у каждого, retention 7 дней с автоудалением.

### Storage (`src/db/database.js`)

Новая таблица `hidden_trends(trend_id, chat_id, hidden_at)` + UNIQUE(trend_id, chat_id) + 2 индекса. Зеркалит `feedback_votes`-схему.

Хелперы:
- `hideTrend(trendId, chatId)` — INSERT OR REPLACE (upsert hidden_at)
- `unhideTrend(trendId, chatId)` — DELETE
- `getHiddenTrendIdsByChat(chatId, retentionDays=7)` — для feed-фильтра
- `getHiddenTrendsByChat(chatId, retentionDays=7, limit=200)` — JOIN с trends для архив-листа
- `clearHiddenTrendsByChat(chatId)` — wipe-all
- `cleanupExpiredHiddenTrends(retentionDays=7)` — для maintenance loop

### Maintenance (`src/index.js`)

Добавлен один на startup + ежедневный `setInterval(24h)` вызов `cleanupExpiredHiddenTrends(7)` рядом с существующим `cleanupVideoCache`.

### Endpoints (`src/dashboard/server.js`)

4 новых, все требуют auth (`req.user.telegram_chat_id`):
- `POST /api/trends/:id/hide` → INSERT
- `POST /api/trends/:id/unhide` → DELETE
- `GET  /api/trends/hidden` → `{ trends: [...with hiddenAt], retentionDays }`
- `POST /api/trends/hidden/clear` → wipe + return cleared count

`_handleTrends` дополнен server-side фильтром: `AND id NOT IN (?,?,...)` для скрытых ID текущего юзера. Параметризованный — до 999 элементов на statement (за 7 дней нереально упереться).

### UI (`src/dashboard/server.js` SPA)

**FeedCard** — добавлен опциональный prop `onHide`. Если передан — рендерится `<button.feed-hide-btn>✕</button>` с `position:absolute; top:6px; right:6px`. Hover-only: `opacity:0` по дефолту, `1` при `:hover` родителя. На touch-устройствах `@media (hover:none)` показывает с `opacity:.6` (иначе кнопка недоступна без hover).

**App-level state**:
- `localHidden: Set<id>` — оптимистично скрытые на клиенте до следующего fetch'а. Сбрасывается в `fetchData`/`refreshAll` после успешного refresh — server становится authoritative и Restore из архива работает корректно.
- `pendingUndo: { trend, expiresAt }` — single-instance bottom undo toast, 5s window. Второй hide перебивает предыдущий toast.
- `hideTrend(trend)` — добавляет в `localHidden` → POST → если 4xx/5xx, откатывает локальное скрытие + error-toast.
- `undoHide(trend)` — убирает из `localHidden` + dismiss toast → POST /unhide.

**UndoToast** (`.undo-toast`) — отдельный namespace от существующего top-right `.toast` system (разные цели: actionable undo vs informational notifications). Bottom-center, 5s, с кнопкой «Отменить»/«Undo».

**ArchiveCard** — новая секция в `SettingsPanel` после «Behavior». Fetches `/api/trends/hidden` на mount, рендерит список с `archive-row { icon | title+meta | restore-btn }`. Footer — `clear archive` с `confirm()`. Каждый restore: POST /unhide + удаляет из локального items list. На следующем `fetchData` основной фид подтянет восстановленный трейнд (localHidden очищается).

**i18n**: 9 новых ключей (`feed.hide_btn_tip`, `toast.alert_hidden`, `toast.undo`, `archive.title/desc/empty/restore/clear_all/clear_confirm/count/loading`) в обоих языках.

**CSS**:
- `.feed-hide-btn` — circle 24×24 с red-tint hover
- `.undo-toast`, `.undo-toast-btn`, `@keyframes undo-toast-slide-up`
- `.archive-list/.archive-row/.archive-row-icon/.archive-row-body/.archive-row-title/.archive-row-meta/.archive-row-btn/.archive-empty/.archive-actions`

### Проверка
- `node --check` × 3 (database, dashboard, index) ✓
- `scripts/check-dashboard-spa.cjs` ✓ (183850 chars)

### Риски / заметки
- **Race**: hide POST идёт параллельно с любым активным fetchData. Если fetchData завершится раньше POST'а, server вернёт трейнд (ещё не записал hidden) → localHidden скроет. Если POST успеет первый — server отфильтрует на следующем fetch'е. Окно <500ms, пользователь не заметит.
- **Откат при 5xx**: hideTrend ловит ошибку и убирает из localHidden, но user уже видел исчезновение карточки → она вернётся. Error-toast говорит почему. Acceptable UX.
- **Retention изменить**: hard-coded 7 в db helpers и index.js. Вынесем в env/setting если запросят.
- **Archive list cap**: `LIMIT 200` в SQL. Выше 200 не берём — UI становится неуютным. Если будут жалобы — пагинация.
- **Touch devices**: `@media (hover:none) { opacity:.6 }` — кнопка всегда видима, но приглушённая. Ровно так делает Twitter в Web.

---

## 2026-05-02 (Nano admin toggle — фикс: 401 → запись в БД не происходила)

**Симптом**: владелец видел Nano-блок (Тема/Сущности/Слэнг) в админке «Ручной анализ» при, казалось бы, выключенном тумблере. После выкл. тумблера и нового submit:
- В docker logs: обычный `[NanoClassifier] N trends in ...ms` (а не ожидаемый `[NanoClassifier] skipped — disabled via admin panel`)
- В БД: `SELECT * FROM settings WHERE key='nanoEnabled'` → пусто (запись вообще не появилась)
- `curl /api/prestage/nano` → `Unauthorized`

**Корень**: `PreStageSection` ([admin/server.js:2530, 2540](../src/admin/server.js)) использовал голый `fetch('/api/prestage/nano...')` **без `X-Admin-Key` header**. Все остальные admin endpoint'ы идут через хелпер `api()` ([1797](../src/admin/server.js#L1797)) который добавляет ключ. На GET `r.json()` парсил `{error:'Unauthorized'}` → `d.enabled === undefined` → `setNanoEnabled(false)` → UI рендерил тумблер как OFF, **но в БД ничего не записал**. На POST `r.ok=false` → throw → `setErr` (но юзер не видит ошибку, только OFF-состояние тумблера).

Поскольку DB-row отсутствует, `getSetting('nanoEnabled', '1')` возвращает default `'1'` → `_isAdminEnabled() = true` → nano запускается на каждом цикле и каждом manual submit. Ровно то что наблюдал владелец.

### Изменения (`src/admin/server.js`)
- `PreStageSection.useEffect` — `fetch('/api/prestage/nano')` → `api('/api/prestage/nano')`
- `PreStageSection.toggleNano` — `fetch('/api/prestage/nano/toggle', { method:'POST' })` → `api('/api/prestage/nano/toggle', 'POST')`
- Добавлен комментарий с описанием почему bare `fetch` тут — баг

### Проверка
- `node --check src/admin/server.js` ✓
- `scripts/check-admin-spa.cjs` ✓ (182520 chars)

### После деплоя проверить
1. БД должна получить запись после клика по тумблеру: `sqlite3 /data/catalyst.db "SELECT * FROM settings WHERE key='nanoEnabled'"`
2. В docker logs после следующего цикла / manual submit при OFF-тумблере: `[NanoClassifier] skipped — disabled via admin panel`
3. В админке «Ручной анализ» новый submit при OFF-тумблере → блок «Nano (gpt-5.4-nano)» НЕ должен рендериться

### Заметки
- **История past-анализов** (карточки в strip'е) — будет всегда показывать Nano-данные если они были собраны до отключения. Это корректное поведение: `raw_metrics.preStage` сохраняется при скоринге как снимок, его не трогаем
- **Manual-analysis cache** (1h TTL): после фикса — если URL анализировался при ON-тумблере, в течение часа cache hit вернёт старый результат с nano. Не критично — TTL короткий, через час свежий submit будет уважать выкл. тумблера. Если хочется forceful invalidation на флипе — надо импортировать `clearManualAnalysisCache` в admin server и звать в обработчике toggle. Не делал в этом PR

---

## 2026-05-02 (Gemini captioner — fix пустого output: safety + thinking)

**Симптом** (от владельца): Gemini никогда не работает — ни в обычном пайплайне, ни в ручном анализе. Логи писали про cooldown / лимиты Google. **Ключевая улика**: в Google AI Studio dashboard видны **только input requests, output ноль**. Значит запрос доходит до Google, тратит input-токены, но возвращает пустой text.

**Корневая причина**: 2 фактора одновременно

1. **Default safety thresholds Gemini 2.5 Flash** режут ответ для memes/reddit/twitter контента → `finishReason: SAFETY`, `text=''`. Мы это ловили общим warn'ом «empty text», но **не логировали `finishReason` / `safetyRatings` / `promptFeedback`** — поэтому корневая причина была невидима.
2. **Dynamic thinking** в Gemini 2.5 Flash (включён by default). Без явного `thinkingConfig.thinkingBudget=0` thinking-токены могут съедать output-budget → пустой `text` при ненулевом `candidatesTokenCount`.

**Изменения** (`src/analysis/gemini-captioner.js`)

- **`safetySettings: BLOCK_NONE`** для всех 4 категорий (HARASSMENT / HATE_SPEECH / SEXUALLY_EXPLICIT / DANGEROUS_CONTENT). Мы description-preprocessor, не контент-хост — нет смысла гасить ответы для мемов
- **`generationConfig.thinkingConfig.thinkingBudget = 0`** — отключаем thinking для vision captioner'а (он не нужен)
- **`generationConfig.maxOutputTokens = 1024`** — явный потолок (было undefined, что делало результат непредсказуемым)
- **Расширенный warn при empty text**: теперь логируем `finishReason`, `promptFeedback.blockReason`, `safetyRatings` (>=MEDIUM или blocked), `tokens=in+out`. Если ещё раз случится — будет видно ЧТО именно блокирует
- **User-Agent** добавлен в HEAD/GET при скачивании медиа. Reddit `v.redd.it` и часть Twitter video CDN режут default Node-UA. Использован тот же Chrome UA что в reddit collector

### Проверка
- `node --check src/analysis/gemini-captioner.js` ✓

### Follow-up: длина videoSummary через промпт (после первого деплоя)

После того как фикс заработал, владелец заметил что `videoSummary` режется посреди слова в админке. Корень — hardcoded `slice(0, 250)` в коде vs `≤200 chars` в промпте. Перенёс контроль длины из кода в промпт:

- **Промпт переформулирован**: `≤200 chars` → `2-3 complete sentences` (для videoSummary), `≤300 chars` → `1-2 complete sentences` (для visualCaption)
- **Добавлен CRITICAL LENGTH RULE**: «every field must be a COMPLETE thought ending with proper punctuation. Never cut mid-sentence or mid-word»
- **Slice'ы в коде** оставлены как safety-net против runaway-моделей: 250→800 (videoSummary), 400→800 (visualCaption), 200→600 (visibleText). Mood остался 60 (1-3 слова — никогда не больше)
- **OpenRouter fallback ветка** синхронизирована (те же лимиты)

### Риски / заметки
- **`BLOCK_NONE` через API**: для большинства аккаунтов это валидно (gemini-2.5-flash, generative-language API). Если проект включён в особые ограничения — придётся вернуть `BLOCK_ONLY_HIGH`. Симптом — 400 INVALID_ARGUMENT с упоминанием `safety_settings`. Логи теперь это покажут
- **Не трогал** Reddit `_bestImage` баг (пункт 3 возвращает `reddit_video_preview.fallback_url` = видео-URL, не картинка) — после safety-fix Google native video должен работать, fallback на постер задействуется реже. Если после деплоя останутся проблемы с reddit-видео фолбэком — править отдельным PR
- **Не трогал** cooldown counter — он считает все возвраты null от `_tryGoogleMedia` как Google failure (включая локальные download/sniff fail). После safety-fix частота null упадёт, но архитектурно counter мис-диагностирует. Backlog
- **Длина текстов** в Stage 1 prompt (`prompts.js:127-129`) — теперь visualCaption/videoSummary в `detail` строке могут быть длиннее. Не критично (Stage 1 batch promp всё равно 8-10K токенов суммарно), но если надо экономить — добавить trim там же

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

