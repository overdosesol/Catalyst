# SESSION CONTEXT

Обновляется после каждой значимой сессии.

## Проект

- Название: TrendScout (Narrative Parser)
- Назначение: мониторинг трендов + алерты в Telegram/Discord
- Прод: Docker deployment

## Текущий runtime (на момент последнего апдейта)

- Dashboard: `http://37.1.196.83:8080`
- Admin: `127.0.0.1:8081` (через SSH tunnel)
- Основной деплой: `deploy.ps1`
- Linux/macOS deploy entrypoint: `deploy.sh`

## Бизнес-правила (актуально)

- Планы: `free`, `test`, `pro`
- `test`: $5, 1 день, one-time на аккаунт, все источники включены, X Analysis недоступен
- `pro`: $100, 30 дней
- Alerts: безлимит для всех планов (`alert_limit = -1`)

## Важные технические решения

- Единый Docker flow (без параллельного PM2 runtime)
- Деплой-файлы упрощены: `deploy.ps1` (Windows) и `deploy.sh` (Linux/macOS), `DEPLOY_NOW.ps1` удалён
- Admin API закрыт с внешнего доступа (localhost-only bind)
- Dashboard API только по `X-API-Key` header
- Query auth (`?apiKey=`, `?key=`) убран
- В админке добавлено управление AI provider/model (`xAI` / `OpenAI`) через `GET/POST /api/ai-config`
- В админке добавлен список моделей по API (`GET /api/ai-models`) с curated-фильтрацией
- Stage 1 scoring использует выбранный provider/model, Stage 2 `x_search` принудительно через Grok (xAI, `grok-4-1-fast-non-reasoning`)
- Для OpenAI `gpt-5-mini` добавлен авто-ретрай без `temperature` (иначе модель отвечает 400)
- Тикерная логика удалена end-to-end: `suggestedTicker` больше не запрашивается у AI, не сохраняется в `raw_metrics`, не выводится в dashboard/telegram
- В рассылке алертов введён двухступенчатый gate:
  - `memePotential >= max(user.alert_threshold, global alertThreshold)`
  - `score (virality) >= global viralityThreshold`
- `alertThreshold` из dashboard теперь реально применяется как global floor (раньше фактически не участвовал в send-loop)
- Добавлен глобальный setting `viralityThreshold` (default: 70), доступен в dashboard settings API/UI
- **NarrativeClusterer** (pre-AI слой): Aggregator → Clusterer → Scorer; Jaccard threshold=0.40; routing: `priority`/`stage1`/`save_only`/`drop`; low-engagement singleton gate: maxEngagement<200 && batchSize<=1 && dbRecentCount<2 → save_only
- **Inference cost optimizations (v3.1)**:
  - Feedback context строится один раз на цикл в `_buildFeedbackContext()`, не на каждый batch
  - `_callResponsesAPI` возвращает `{ text, inputTokens, outputTokens }` (реальные токены из `data.usage`)
  - Stage 1 batch size: 5 → 8
  - Stage 2 gate: threshold 70 → 78, cap 3 вызова на цикл, skip google_trends, novelty gate (`clusterMetrics.isNovel !== false`)
  - Prompt: description truncated 250 → 100; поля `titleRu` и `isGenuinelyInteresting` удалены из output spec
  - Логируется `total_in`/`total_out` (реальные токены) после каждого цикла

## AI модели (UI curated)

- xAI: `grok-4-1-fast-non-reasoning`, `grok-4-fast-non-reasoning`, `grok-4.20-0309-non-reasoning`, `grok-3-mini`
- OpenAI: `gpt-4.1-mini`, `gpt-4.1`, `gpt-4o-mini`, `gpt-4o`, `gpt-5-mini`, `gpt-5`

## Контекст-файлы

- Используются: `ai-context/AGENT_RULES.md`, `ai-context/SESSION_CONTEXT.md`, `ai-context/WORKLOG.md`
- `ai-context/NEXT_STEPS.md` удалён (по решению владельца)

## Известные нюансы

- Если Telegram показывает старые кнопки/тексты, нужен повторный вызов меню (`/menu`) или обновление сообщения.
- Коллекторы могут быть отключены через admin settings; проверяй `disabledCollectors`.
- xAI API может отдавать `429` при исчерпании кредитов; в UI используется curated fallback для списка xAI-моделей.
- Если в алерте видно `🤖 AI unavailable`, проверь логи scorer (чаще всего это upstream API error или fallback после 400/429).
- В исторических строках `trends.raw_metrics` может оставаться legacy-поле `suggestedTicker`; для новых записей поле больше не пишется.
- Для быстрого снижения шума рекомендованный порядок: сначала поднять `viralityThreshold` (70 -> 75), затем при необходимости `alertThreshold`.
