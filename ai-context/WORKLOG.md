# WORKLOG

## 2026-04-15 (bootstrap)

- Model/session: GPT Codex
- Цель: создать инфраструктуру контекста для мульти-модельной работы
- Изменения:
  - Добавлена папка `ai-context/`
  - Созданы файлы: `AGENT_RULES.md`, `SESSION_CONTEXT.md`, `WORKLOG.md`, `NEXT_STEPS.md`
- Деплой: не требуется
- Примечания:
  - Теперь все агенты должны писать результаты сюда после каждой сессии.

## 2026-04-15 (latest)

- Model/session: GPT Codex
- Цель: финализировать тарифы, UX бота, AI provider switch, и очистить deploy-пайплайн
- Изменения:
  - Планы переведены на `free/test/pro`, удалены legacy-планы `starter/elite`
  - `test` план: $5 на 1 день, one-time, все источники, без X Analysis
  - `pro` план: $100 на 30 дней, все источники
  - Добавлена блокировка повторной покупки `test` по истории confirmed payments
  - Добавлена блокировка `X Analysis` для `test` (callback + уведомление)
  - Обновлены тексты/кнопки в Telegram (`/start` упрощён, `/menu` полный)
  - Добавлено управление рассылками: pin/unpin/delete, история рассылок, управление по конкретному broadcast
  - Добавлено ручное управление пользователями в админке (выдать/снять подписку, бан/разбан)
  - Добавлена очистка алертов через админку + storage guard по свободному месту
  - Добавлено переключение AI provider/model в админке (`/api/ai-config`)
  - Добавлен список моделей по API (`/api/ai-models`) с curated набором
  - Stage 2 `x_search` фиксирован на xAI/Grok даже при выбранном OpenAI для Stage 1
  - Удалены legacy deploy wrappers: `scripts/deploy.sh`, `DEPLOY_NOW.ps1`
- Деплой/проверка:
  - Многократные деплои на `37.1.196.83` через Docker pipeline (`deploy.ps1`)
  - Проверены endpoint'ы: `/api/health`, `/api/ai-config`, `/api/ai-models`, `/api/broadcasts`
  - Проверена изоляция админки: localhost-only bind (`127.0.0.1:8081`)
- Риски/заметки:
  - xAI периодически возвращает `429` (лимит/кредиты), поэтому Stage 2 может пропускаться
  - OpenAI key добавлен в `.env`; рекомендуется ротация секрета после публикации в чате

## 2026-04-15 (handoff update for Claude)

- Model/session: GPT Codex
- Цель: подготовить актуальный handoff-контекст перед переключением на Claude
- Изменения:
  - Обновлён `SESSION_CONTEXT.md` под текущий state runtime и AI pipeline
  - Зафиксировано: Stage 1 = выбранный provider/model, Stage 2 x_search = Grok only
  - Зафиксирован фикс совместимости OpenAI `gpt-5-mini` (ретрай без `temperature`)
  - Зафиксирован актуальный curated список моделей в админке
  - Зафиксировано удаление `ai-context/NEXT_STEPS.md` (по просьбе владельца)
  - Зафиксирован текущий deploy layout: `deploy.ps1` + `deploy.sh`
- Проверка/деплой:
  - Контекстные файлы синхронизированы вручную (без нового деплоя)
- Риски/заметки:
  - xAI кредиты/лимиты могут быть нестабильны (429), что влияет на Stage 2
  - При `AI unavailable` первым делом смотреть `docker logs trendscout-app`

---

## 2026-04-15 (dashboard redesign)

- Model/session: Claude Sonnet 4.6
- Цель: Redisign дашборда — визуал, удобство, функционал не хуже TG-бота. Картинки из источников (OG preview).
- Изменения (файлы):
  - `src/dashboard/server.js`:
    - `_formatTrend()` — добавлено поле `imageUrl` (из `metrics.imageUrl / thumbnailUrl / thumbnail`)
    - `_handlePreview()` — новый endpoint `GET /api/preview?url=` (сервер-сайд fetch og:image)
    - Роутер — добавлен `/api/preview`
    - CSS — добавлены стили: modal/drawer, toast-система, card-image-wrap, search-input, copy-button, kbd shortcuts badge, refresh-badge, shimmer-анимация
    - Новые компоненты: `ImageThumb` (с fallback на `/api/preview`), `TrendModal` (side drawer с картинкой, метриками, ссылками), `Toasts`
    - `TrendCard` — clickable, показывает ImageThumb, copy-кнопка по hover, footer с «↗ открыть детали»
    - `ControlPanel` — принимает `addToast`, health-check через toast вместо `alert()`
    - `App` — добавлены состояния: `modalTrend`, `toasts`, `search`, `refreshAt`; `addToast` helper; `scan` как useCallback; keyboard shortcuts (R/S/Esc); countdown в nav (обновляется каждую секунду); search-фильтр (клиентская сторона); TrendModal и Toasts рендерятся; поиск в toolbar
- Проверка/деплой:
  - Код готов, деплой ждёт запуска `deploy.sh` (или `deploy.ps1`) владельцем
  - Сетевой доступ к серверу из sandbox недоступен
- Риски/заметки:
  - `/api/preview` делает внешний HTTP-запрос с сервера — если og:image нет или сайт блокирует боты, вернётся `{ imageUrl: null }`, карточка покажет emoji-placeholder
  - Keyboard shortcut `S` будет игнорироваться пока input/select в фокусе

---

## 2026-04-15 (sort feature)

- Model/session: Claude Sonnet 4.6
- Цель: добавить сортировку по времени и по топу в дашборд
- Изменения (файлы):
  - `src/dashboard/server.js`:
    - `_handleTrends()` — расширена логика `sort`: теперь поддерживает `meme` (по умолчанию, meme_potential DESC), `time` (first_seen_at DESC), `virality` (score DESC)
    - `App` — добавлен state `sort`, передаётся в API-запрос, select «Сортировка» в toolbar
- Проверка/деплой: ожидает деплоя владельцем
- Риски/заметки: нет

---

## 2026-04-16 (pre-AI signal quality layer)

- Model/session: Claude Sonnet 4.6
- Цель: спроектировать и реализовать pre-AI слой NarrativeClusterer для снижения шума без потери ранних нарративов
- Изменения (файлы):
  - `src/analysis/clusterer.js` (новый файл, ~210 строк):
    - Класс `NarrativeClusterer` с методами: `route()`, `_clusterByJaccard()`, `_fetchHistory()`, `_computeMetrics()`, `_decide()`
    - Кластеризация через Jaccard similarity на word sets (threshold=0.40), без ML/embeddings
    - DB-запрос последних 48ч по LIKE на первые 2 слова нарратива (≤30 строк)
    - Cluster-level метрики: batchSize, uniquePlatforms, batchAuthors, textVariation, dbRecentCount, isNovel, velocity, maxEngagement
    - Routing: `drop` / `save_only` / `stage1` / `priority`
  - `src/index.js`:
    - Добавлен import NarrativeClusterer
    - Добавлен `const clusterer = new NarrativeClusterer(db, logger)`
    - Вставлен Step 2.5 между aggregator и scorer:
      - `clusterer.route(newTrends)` → { priority, toScore, toSave, droppedCount }
      - `toSave` сохраняются напрямую (score=0, без AI)
      - `[...priority, ...toScore]` идут в scorer (priority — первыми в батче)
- Проверка/деплой: ожидает деплоя владельцем
- Риски/заметки:
  - LIKE-запрос по title может давать ложные срабатывания на коротких тайтлах — защита: требуем ≥2 слов для pattern
  - DROP-порог (8 appearances, 1 платформа, velocity<0.15) консервативен — можно снизить до 5 если шума всё ещё много
  - Priority-items идут первыми в батч scorer'а — при xAI 429 они приоритетно обработаются
  - `save_only` items не попадают в алерты (memePotential=0), но видны в дашборде

---

## 2026-04-16 (inference cost optimization)

- Model/session: Claude Sonnet 4.6
- Цель: снизить inference cost без потери качества скоринга
- Изменения (файлы):
  - `src/analysis/scorer.js`:
    - Добавлен метод `_buildFeedbackContext()` — feedback строится один раз на вызов `scoreTrends()`, не повторяется на каждый batch (экономия ~200 tokens × (N_batches-1))
    - `_callResponsesAPI` теперь возвращает `{ text, inputTokens, outputTokens }` вместо plain string
    - `_extractTextFromResponse` переименован в `_extractResponseData` — парсит `data.usage.input_tokens` / `data.usage.output_tokens`
    - `_analyzeBatchStage1` принимает pre-built `systemPrompt` (третий аргумент), накапливает реальные токены в metrics
    - `_stage2DeepDive` возвращает `{ inputTokens, outputTokens }` для аккумуляции
    - `const batchSize = 5` → `batchSize = 8`
    - Stage 2 threshold: 70 → 78
    - Stage 2 cap: max 3 вызова на цикл (`this.stage2MaxCalls = 3`, `.slice(0, 3)`)
    - Stage 2 gate: пропускаем google_trends (`source !== 'google_trends'`)
    - Stage 2 novelty gate: `clusterMetrics?.isNovel !== false` — не гоняем x_search по заведомо старым нарративам
    - Логируется `total_in`/`total_out` (реальные токены) через `this.logger.info()`
  - `src/analysis/prompts.js`:
    - Description truncation: 250 → 100 символов
    - Поле `titleRu` удалено из output spec (требование JSON) и из HARD RULES (правило №2)
    - Поле `isGenuinelyInteresting` удалено из output spec
    - SYSTEM_PROMPT HARD RULE #2 упрощён: «All output fields must be in ENGLISH.»
  - `src/analysis/clusterer.js`:
    - В `_decide()` добавлен engagement gate перед финальным `save_only`: `if (maxEngagement < 200 && batchSize <= 1 && dbRecentCount < 2) return 'save_only'`
    - (gate логически избыточен сейчас, но явно документирует намерение и упростит будущее расширение)
  - `ai-context/SESSION_CONTEXT.md`: обновлён раздел «Важные технические решения»
- Проверка/деплой:
  - Ожидает деплоя владельцем (`deploy.sh` / `deploy.ps1`)
- Риски/заметки:
  - `titleRu` и `isGenuinelyInteresting` убраны из prompt-spec, но scorer.js всё ещё читает `a.titleRu` и `a.isGenuinelyInteresting` для обратной совместимости — если модель их вернёт (старый промпт кэшируется или тест), ничего не сломается
  - batch_size=8 может увеличить риск parse-ошибок на очень длинных ответах; при первых признаках вернуть к 5 или 6
  - Stage 2 cap=3 — при большом числе высокопотенциальных трендов часть не пройдёт x_search; это приемлемо (лучшие 3 по score идут первыми)

---

## TEMPLATE (копировать для новых записей)

### YYYY-MM-DD HH:MM

- Model/session:
- Цель:
- Изменения (файлы):
- Проверка/деплой:
- Риски/заметки:

---

## 2026-04-16 (remove suggestedTicker end-to-end)

- Model/session: GPT Codex
- Цель: полностью удалить тикерную AI-логику (`suggestedTicker`) из пайплайна, хранения и UI
- Изменения (файлы):
  - `src/analysis/prompts.js`: удалено требование поля `suggestedTicker` из Stage 1 prompt; удалена строка `Suggested ticker` из Stage 2 prompt builder
  - `src/analysis/scorer.js`: удалён маппинг `suggestedTicker` из Stage 1 ответа; удалён `suggestedTicker` из `_applyHeuristic()` и `_fallback()`
  - `src/db/database.js`: в `saveTrend()` из `raw_metrics` удалена запись `suggestedTicker`
  - `src/dashboard/server.js`: удалено чтение `metrics.suggestedTicker` в `_formatTrend`; удалены UI-блоки «Тикер» из карточки и modal; удалены CSS-классы `.ticker` и `.ticker-none`
  - `src/notifications/telegram.js`: удалено чтение `suggestedTicker` при формировании top trends
  - `src/i18n/en.js`, `src/i18n/ru.js`: удалён неиспользуемый ключ `alertTickers`
- Проверка/деплой:
  - Выполнен `node --check` для всех изменённых файлов (`prompts.js`, `scorer.js`, `database.js`, `server.js`, `telegram.js`, `en.js`, `ru.js`) — без синтаксических ошибок
  - Выполнен прод-деплой через `deploy.ps1` на `37.1.196.83` (Docker), получен `DEPLOY_SUCCESS`
  - Проверен `GET /api/health` на `http://37.1.196.83:8080/api/health` — `{"ok":true,...}`
  - Проверена запись в БД (`/data/trendscout.db`): в последних строках (`id=419,420`) поле `suggestedTicker` отсутствует; в более старых строках поле остаётся как legacy
- Риски/заметки:
  - Старые записи в БД могут содержать `suggestedTicker` в `raw_metrics`, но новый код это поле не читает и не отображает
