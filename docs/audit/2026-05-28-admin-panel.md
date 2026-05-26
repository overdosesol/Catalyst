# Admin panel functionality audit — 2026-05-28

**Scope**: седьмой из 12 этапов. Фокус — функциональность admin SPA (`src/admin/server.js`, ~265K chars inline React, 127.0.0.1:8081, Bearer ADMIN_API_KEY). Реально ли работают 10 табов, корректно ли отображают production state, имеют ли feedback на actions, completeness operational tools. **Не покрыто** (другие этапы): admin auth (этап 1 — verified safe), pipeline correctness (2), billing entitlements (3 — BILL-002 admin-UX angle расширен), cost (4), DB schema (5), dashboard UX (6), TG delivery (8), nginx/Docker/backup (9), cat mascot (10), code quality / SPA-trap (11), docs (12).

**Method**: 5 параллельных haiku-агентов по 13 направлениям + ручная верификация ключевых точек (`wipeManualAll` line 6529 без confirm, `restoreHardcoded` line 6540 с confirm + `String.fromCharCode(10)`, admin auth line 930 для всех `/api/*`, getEffective 3-layer line 6455). Ничего в коде не менялось.

---

## Tab matrix

10 табов + 1 bonus (StatusBar). Carrier `addToast` в admin не используется — оператор получает feedback через inline `setMsg` / `flash` helper.

| # | Tab | Component | Main endpoint(s) | Loading | Error | Empty | Main affordance | Operational completeness |
|---|---|---|---|---|---|---|---|---|
| 1 | 📊 Stats | `StatsPage:4649` | `/api/stats` | ✓ | **✗ silent** | ✓ "Нет данных" | overview + cleanup alerts button | partial — нет DB size view, backup status, log rotation |
| 2 | ⚙️ Сканеры | `ScannersPage:2605` | `/api/scanners`, `/api/scan`, `/api/scanners/pause\|resume`, 5 accordion sections | ✓ | ✓ flash | n/a | Pause / Force-Scan / per-source toggle / Stage 0 / Hot refresh / Junk stats | good (pause+force+config) |
| 3 | 🎛️ Пресеты | `PresetConfigsPage:6407` | `/api/preset-configs` POST | **✗ no skeleton** | ✓ flash | n/a | 3-layer merge view, Wipe manual, Restore hardcoded, per-preset Reset, chip locks | good (3-layer view incl. Debug Inspector pane) |
| 4 | 🔄 Auto-tags | `TagRefreshPage:7283` | `/api/tag-refresh/status`, `/api/tiktok-hashtag-source` | ✓ "Загрузка..." | ✓ flash | ✗ | Status badge, Force refresh, History, Reset breaker | good |
| 5 | 🧪 Ручной анализ | `SubmitPage:5811` | `/api/submit-narrative`, `/api/manual-trends` | ✓ spinner | ✓ inline | ✓ | URL submit, history strip, ManualResultCard | partial — нет cache-hit / cost indicator |
| 6 | 🔔 Алерты | `DecisionsPage:3980` | `/api/alert-decisions` (10s poll) | ✓ | **✗ silent** | ✓ | Decisions buffer view, math panel, gate breakdown, reason chips | partial — in-memory buffer (restart-reset, 500 cap) |
| 7 | 🎓 AI Examples | `ExamplesPage:6014` | `/api/stage1-examples` CRUD | **✗ implicit** | ✓ inline | ✓ | Examples CRUD, kind filter (example/mistake), preview prompt context | good (sync to Stage 1 via `scorer._buildExamplesContext`) |
| 8 | 👥 Пользователи | `UsersPage:2314` | `/api/users?search=&plan=&status=`, `/api/users/{id}/subscription/grant\|revoke`, `/api/users/{id}/status` | ✓ | ✓ inline | ✓ | List + drawer + grant/revoke/block | partial — no pagination (LIMIT 200 hardcoded), no audit log, no delete |
| 9 | 💳 Платежи | `PaymentsPage:2485` | `/api/payments`, `/api/payments/{id}`, `/api/payments/cleanup` | ✓ implicit | ✓ inline | **✗ partial** | Payments list, cleanup button | partial |
| 10 | 🤖 Бот | `BotPage:4785` | `/api/plans`, `/api/feedback-config`, `/api/ai-models`, `/api/broadcasts`, `/api/alert-scheduler`, `/api/hot-refresh` | partial | ✓ multiple msg vars | n/a | 3 sub-tabs: 🧠 AI / 📢 Рассылки / 💰 Планы и фидбек | good (но no broadcast preview, no test-send) |
| bonus | StatusBar | `StatusBar:7181` | `/api/pipeline` (2.5s poll) | ✓ | **✗ silent → component returns null** | n/a | Live pipeline viz, 8 stages, subtitle | good (3 subtitle states implemented) |

**Endpoint matching**: 47 endpoints total (37 top-level + 10 dynamic), все frontend `api(...)` calls корректно map'ятся на backend `_handle*` методы. Нет orphan endpoints, нет missing handlers. ✓

**Critical missing states**:
- **Error**: StatsPage, DecisionsPage, StatusBar — silent fail на 5xx. Operator во время incident смотрит на stale data и не знает что endpoint лежит.
- **Loading skeleton**: PresetConfigsPage, ExamplesPage, PaymentsPage — данные загружаются "in-place" без visual feedback.
- **Empty state**: PaymentsPage, BotPage — что при 0 results?

---

## Primitives consistency

**Namespace usage** (verified via grep):
- `.adm-card` — universal section wrapper, applied across all major pages. Legacy `.broadcast-box` rebranded. ✓ Consistent.
- `.adm-tabs / .adm-tab / .adm-tab-count / .adm-tab-dot` — unified tab strip primitive. ✓ Consistent.
- Page-scoped namespaces: `.dec-*` (DecisionsPage) · `.sb-*` (StatusBar) · `.scfg-*` (ScannerConfigSection) · `.pcfg-*` (PresetConfigsPage) · `.sp-*` (SubmitPage) · `.exp-*` (ExamplesPage). ✓ Isolated, no cross-leak.
- **Inner accordion components** (ScannerConfigSection / PreStageSection / HotRefreshSection / JunkStatsSection) — bare-div, **без** `.adm-card`. Documented invariant в SESSION_CONTEXT.

**Section primitive adoption**: `<Section icon title desc actions>{children}</Section>` определён, готов для refactor — но в реальности **не используется**. Legacy `.adm-card` блоки остаются основной структурой. Заявленный «постепенный refactor» не начат. Низкоприоритетная очистка.

**Theme adaptation**: admin SPA **single dark theme**, без theme switcher. Все цвета через `--bg`, `--text2`, `--ok`, `--err`, `--yellow`, etc — но **нет alternates** (`[data-theme="..."]` selector'ов нет). Operator сидит в loopback-only admin, theme не нужен — acceptable single-theme.

**i18n coverage**: **полное отсутствие i18n** в admin. 0× `t()` calls, ~95 hardcoded RU strings, ~5 hardcoded EN ("ok: true", error keys, etc). Admin operator-only (russian-speaking team), acceptable trade-off, но flag'ну как info (если когда-то понадобится EN-speaking admin).

---

## Operational completeness assessment

«Operator wants to do X — can he via admin UI?» — semantic, не code.

| Operation | Available | How | Limitation |
|---|---|---|---|
| Pause scanner (during cost burn / incident) | ✓ | Scanners → Pause | **Not persisted to DB — restart resets to false** (ADM-007) |
| Force-Scan manually | ✓ | Scanners → Force-Scan | Async fire-and-forget, timestamp updates lazily (PIPE-004 confirm) |
| See last cycle status / current stage | ✓ | StatusBar topbar | Silent fail on `/api/pipeline` 5xx → component disappears |
| See decisions buffer (why trends filtered) | ✓ | Алерты (DecisionsPage) | In-memory 500 cap, **restart-reset — no historical debugging** |
| Change user plan | ✓ | Пользователи → drawer → Grant/Revoke | **Not atomic** (BILL-006), **no audit log** (BILL-002) |
| Search users | ✓ | Пользователи search input | **No pagination, LIMIT 200 hardcoded** |
| Block user | ✓ | Пользователи → drawer → status toggle | Soft only (status='blocked'), no hard delete |
| Delete user | **✗** | — | No button, no endpoint. GDPR concern long-term |
| Send broadcast | ✓ | Бот → Рассылки → composer | **No preview, no test-send, no recipient count confirm** |
| Manage existing broadcasts | ✓ | Бот → Рассылки → history cards | edit/unpin/delete per-broadcast |
| Force tag-refresh | ✓ | Auto-tags → Force refresh (rate-limit 1×/24h) | OK |
| Reset auto-tags circuit breaker | ✓ | Auto-tags → Reset breaker | OK |
| Adjust preset configs (3-layer) | ✓ | Пресеты | Debug Inspector pane shows Defaults/Effective/Draft (no isolated Auto view) |
| Wipe manual preset overrides | ✓ | Пресеты → 🧹 Wipe manual | **NO confirm dialog** (ADM-003), ghost color (not red) |
| Restore hardcoded presets | ✓ | Пресеты → ↩ Restore hardcoded | Has confirm with newlines ✓ |
| Cleanup old alerts (notifications) | ✓ | Stats → Очистить старые алерты | `window.prompt(N days)` — basic UX |
| Cleanup payments | ✓ | Платежи → cleanup button | OK |
| VACUUM DB | **✗** | — | No button. After cleanup DB fragments grow |
| Re-index DB | **✗** | — | No |
| Rotate logs / clear video cache / clear auth_sessions | **✗** | — | No UI — relies on `cleanupVideoCache` only-on-boot (DB-010, DB-011, DB-014) |
| See backup status / last backup time | **✗** | — | No UI (DB-001..004 — backup integrity broken anyway) |
| See DB size / table row counts / growth trend | **✗** | — | No UI. Operator должен через SSH+sqlite3 |
| See per-stage cost (LLM spend / month) | **✗** | — | No UI (COST-009/010 observability gap) |
| See provider failure rate (Gemini/OpenAI/Grok healthcheck) | partial | StatusBar показывает active stage, но не failover counters | (COST-006/008 + PIPE-002 gap) |
| Force reload prompts.js / AI Examples | ✓ partial | AI Examples CRUD → автоматически отражается на Stage 1 prompt | Hot-reload через `_buildExamplesContext`, не require restart |
| Restart Docker container / kill stale process | **✗** | — | SSH-only, не должно быть в admin UI |
| Configure AI provider routing | ✓ | Бот → AI sub-tab | OK |
| Configure feedback weighting | ✓ | Бот → Планы и фидбек sub-tab | OK |

**Verdict**: admin operational completeness **~65%**. Сильно для daily ops (pause, force-scan, plan changes, broadcasts, preset tuning). **Слабо для incident response** — нет backup view, нет DB size, нет per-provider healthcheck, decisions buffer restart-reset, pause state не persist'ится. В случае production incident оператор лезет через SSH в sqlite3 / docker logs / cat /var/backups — что admin был призван заменить.

---

## Summary

**Counts**: 0 critical · **6 high** · 12 medium · 6 low · 6 info · **30 findings total**.

Общее впечатление — admin SPA в рабочем состоянии: 47 endpoints all wire-up корректно, 3-layer preset merge UI наконец mirror'ит production logic (после 16.05 fix), Per-tag locks работают на Reddit + Twitter + TikTok, DecisionsPage даёт детальный math breakdown с gate chips + weights snapshot, StatusBar 8 stages с 3 subtitle states, BotPage 3 sub-tabs (AI/Рассылки/Планы), Auto-tags с force refresh + circuit breaker reset, primitives namespace в порядке (`.adm-*` consistent, page-scoped isolated).

Слабые места — три **silent error states** (StatsPage / DecisionsPage / StatusBar глотают 5xx), **DecisionsPage in-memory buffer** (restart-reset → operator loss debugging history когда нужнее всего), **Wipe manual без confirm dialog** (destructive op рядом с Save → одно accidental click + Save = manual слой обнулён), **Pause state не persist'ится в DB** (deploy/restart resets — operator пауза для incident → deploy fix → scanner auto-resumes = makes incident worse), **maintenance gap** (только cleanup alerts, no VACUUM/log rotation/backup view/DB size), **plan grant/revoke без audit log** (BILL-002 admin angle — невозможно ответить «кто, когда, кому grant'нул pro»).

**Top-3** для разбора в первую очередь:
1. **ADM-001** 3 silent error states (StatsPage / DecisionsPage / StatusBar) — operator во время incident видит stale data и не знает что endpoint лежит
2. **ADM-002** DecisionsPage in-memory buffer (500 cap, restart-reset) — теряет debugging history именно когда она нужна (после restart). Common pattern с COST-003 / PIPE-016
3. **ADM-007** Pause state не persisted to DB — `appState.paused = false` в constructor default; deploy/restart автоматически возобновляет сканирование, которое оператор приостановил для incident response

---

## Findings

### [ADM-001] 3 silent error states (StatsPage / DecisionsPage / StatusBar) — severity: **high**

* **Where**: `src/admin/server.js`:
  * `StatsPage:4649` — load `/api/stats` без error UI
  * `DecisionsPage:3980` + `/api/alert-decisions:3999` — silent на network fail
  * `StatusBar:7181` — `.catch(() => {})` на line 7188, state=null, component returns null (line 7195)
* **Tab**: Stats / Алерты / topbar (global)
* **What**: при `/api` 5xx или network fail — UI silent. StatusBar буквально disappears с экрана (component returns null). DecisionsPage stays with stale data и продолжает poll'ить каждые 10s в пустую. StatsPage остаётся на initial empty state. Нет toast, нет banner, нет «retry» CTA.
* **Operational impact**: оператор во время incident (когда backend трещит) смотрит на admin и видит — либо ничего (StatusBar исчез), либо stale data — и думает что всё OK. Это hide'ит реальный outage. Pattern одинаков с UX-001 (dashboard Feed silent error).
* **Repro**: kill Docker → reload admin → StatusBar исчезает, DecisionsPage `Загрузка...` навсегда.
* **Fix**: error state per page — `setError(e.message)` + render `<ErrorBanner msg={error} onRetry={load}/>`. Один shared `<ErrorBanner>` компонент → apply ко всем 3 местам. ~30 строк.

---

### [ADM-002] DecisionsPage buffer in-memory (500 cap, restart-reset) — severity: **high**

* **Where**: `src/index.js:241-242` (`appState.alertDecisions = []`, `alertDecisionsCap = 500`), `recordAlertDecision()` ring buffer; `src/admin/server.js:1217-1233` (read endpoint)
* **Tab**: Алерты
* **What**: alert-dispatcher decisions buffer — pure in-memory ring (cap 500). На restart полностью clears. Single deploy = всё debugging history исчезло. Если incident happened в течение последних 500 decisions, и оператор restart'ит (например для deploy fix) — следов нет.
* **Operational impact**: incident debugging broken именно когда оно нужно. «Почему этот trend не дошёл до user X 30 минут назад?» — answer lost после restart. 500 entry cap при ~5-10 alerts/cycle × 4 cycles/hour ≈ 20-40 decisions/h = buffer закрывает 12-25 часов в лучшем случае; на activity spike (forced scan, broadcast trigger) забивается за час.
* **Fix**: persistence в DB. Новая table `alert_decisions(id, trend_id, user_id, source, reason, gates_json, weights_json, ts)`. Retention 7-14 дней (analog `hidden_trends`). Записывать через `recordAlertDecision` — async, не блочит dispatch. Endpoint меняется на DB query с pagination. ~80 строк код + миграция.
* **Cross-audit**: COST-003 (in-memory caps restart-reset), PIPE-016 (observability state in-memory), BILL-002 (audit log gap). Один common pattern «admin observability persistence» → unified migration covers ADM-002 + COST-003 + BILL-002.

---

### [ADM-003] Wipe manual без confirm dialog — destructive op без guard — severity: **high**

* **Where**: `src/admin/server.js:6529-6532` (handler), `:6843-6849` (button)
* **Tab**: Пресеты
* **What**: «🧹 Wipe manual» button очищает draft (`setDraft({})`) для **всех 5 пресетов** + показывает flash «будет очищен при Save». Button color — `btn-ghost` (нейтральный gray), **не** destructive red. На последующий Save (line 6594) — тоже без confirm — выполняется `POST /api/preset-configs` с `overrides: {}` → manual layer wiped в DB. Полный sequence: click Wipe → click Save → manual слой обнулён, никаких confirms, можно случайно нажать рядом.
* **Operational impact**: оператор может потерять часы накопленных preset tuning'ов одним accidental click + Save. Сравни с «↩ Restore hardcoded» (line 6540) — там **есть** `window.confirm` с `String.fromCharCode(10)` newlines + чёткое описание consequences. Inconsistency between двумя destructive ops в одной панели.
* **Fix**: добавить `window.confirm` в `wipeManualAll`:
  ```js
  const wipeManualAll = () => {
    const NL = String.fromCharCode(10) + String.fromCharCode(10);
    if (!window.confirm(
      'Очистить manual слой во ВСЕХ 5 пресетах?' + NL +
      'Все ручные правки subreddits / twitter queries / tiktok hashtags / junk weights / alert thresholds / cluster params будут потеряны.' + NL +
      'Auto-overrides и locks НЕ задеваются. Effective упадёт на auto+defaults.'
    )) return;
    setDraft({});
    flash('Manual слой очищен. Нажми Save чтобы применить.', 'ok');
  };
  ```
  + change `btn-ghost` → `btn-danger` (red) для visual consistency с destructive intent.

---

### [ADM-004] Maintenance gap — только cleanup alerts, no VACUUM / log rotation / backup view / DB size — severity: **high**

* **Where**: `src/admin/server.js:4749` (cleanup alerts button), Stats tab — единственный maintenance affordance в admin
* **Tab**: Stats (maintenance card)
* **What**: «🧹 Обслуживание базы» card показывает ОДНУ кнопку «Очистить старые алерты» (prompt N days). После этого никаких других ops:
  * **No VACUUM** — после массового DELETE notifications/trends DB fragments grow, размер файла не уменьшается без VACUUM. Long-term — slow queries + wasted disk.
  * **No log rotation** — `/logs/{date}.log` ~36GB/year accumulation (DB-014).
  * **No video cache cleanup view/trigger** — `cleanupVideoCache` runs только on boot (DB-010 — ~33GB rolling worst-case).
  * **No auth_sessions cleanup** — orphan sessions accumulate between restarts (DB-011).
  * **No backup status view** — last backup time / size / B2 sync status (DB-001..004 — backup integrity отдельно broken).
  * **No DB size / table row counts / growth trend** — operator не видит размеры таблиц, рост notifications etc.
  * **No re-index trigger** — после schema migration / massive deletes.
* **Operational impact**: serious operational gap. Все housekeeping ops — manual через SSH + sqlite3 + cat /var/backups + du -sh /opt/catalyst — что admin был призван заменить. В случае «db slow» / «disk full» / «backup not running» — admin даже не показывает что есть проблема.
* **Fix**: extend maintenance card (~5-7 buttons):
  * VACUUM trigger (`db.exec('VACUUM')` + show before/after size)
  * Rotate logs (move current → archive.gz, truncate)
  * Force cleanup video cache (вне boot loop)
  * Force cleanup auth_sessions
  * **Read-only widgets**: last backup time + size + B2 sync status (parse `/var/log/catalyst-backup-rclone.log`), DB total size + per-table row counts (`SELECT name, sqlite_compileoption_used FROM sqlite_master` + `COUNT(*)` per major table).
  Все ops с confirm dialog. ~150 строк код + 5-6 endpoints.

---

### [ADM-005] Plan grant/revoke без atomic transaction + без audit log (BILL-002+006 admin angle) — severity: **high**

* **Where**: `src/admin/server.js:939-951` (grant/revoke handlers), `_setUserPlan` (line 712-727)
* **Tab**: Пользователи
* **What**: подтверждение existing finding'ов **с admin-UX angle**:
  * **NOT atomic** (BILL-006): `_setUserPlan` делает 2 запроса (SELECT plan + UPDATE user) без транзакции. Если UPDATE упал — user.plan_id changed но subscription_expires_at не set → broken state.
  * **NO audit log** (BILL-002): нет таблицы `admin_audit_log`. Admin UI не показывает «last plan change: 2026-05-22 14:30 by admin@x». Compromised admin token = тихие grants без traceability. Multi-admin team = конфликты неразрешимы.
* **Operational impact**: оператор не может ответить «кто, когда, кому grant'нул pro» при customer dispute или audit request. UI shows current state, не история. Plus broken atomicity = редкие consistency bugs.
* **Fix**: wrap `_setUserPlan` в `db.transaction(() => {...})`. Add `admin_audit_log(id, ts, admin_id, action, target_user_id, before_json, after_json, source_ip)` table. Endpoint `GET /api/admin/audit-log?user_id=X` + UI в UsersPage drawer «📋 История изменений плана» — last 20 actions для этого user'а. ~100 строк + миграция.
* **Cross-audit**: BILL-002 + BILL-006 + ADM-002 → unified «audit_log + decisions_log» persistence migration. Один PR закрывает 3 finding'а.

---

### [ADM-006] No Page Visibility API on polls — burn requests когда tab hidden — severity: **high**

* **Where**: `src/admin/server.js:7191` (StatusBar `setInterval(tick, 2500)`), `:7508-7525` (App nav indicators `setInterval(load, 12000)` + `/api/alert-decisions?filter=skipped&limit=1` каждые 12с)
* **Tab**: topbar + App-level (global)
* **What**: оба polling loop continue running когда admin tab hidden (в фоне). 
  * StatusBar: 24 req/min × 60min × 24h = **~34,560 requests/day** даже когда admin tab unattended (открыт в browser tab но не active).
  * Nav indicators: 5 req/min × 2 endpoints (`/api/pipeline` + `/api/alert-decisions`) = ~14,400 req/day.
  * Combined: **~49K req/day** when admin tab idle.
* **Operational impact**: SQLite read лock contention под нагрузкой scan-cycle (DB-006 — `busy_timeout=0`), wasted CPU/IO на server, log spam. На VPS с минимальными resources это не критично, но в conjunction с DB-013 (save loops без transactions) — pile up. Также: оператор оставляет admin tab открытым на ночь = burn 100% впустую.
* **Fix**: wrap setInterval в `if (document.visibilityState === 'hidden') return;` check внутри tick'а. Или event listener `document.addEventListener('visibilitychange', ...)` который starts/stops interval. ~10 строк.
* **Cross-audit**: dashboard polling если есть — same pattern. Likely overlap с UX backlog.

---

### [ADM-007] Pause state не persisted to DB — restart auto-resumes — severity: **high**

* **Where**: `src/index.js:107` (constructor default `appState.paused = false`), `src/admin/server.js:1467-1474` (pause/resume endpoints only flip in-memory flag)
* **Tab**: Сканеры
* **What**: pause toggle устанавливает `appState.paused = true` **только в памяти**. Нет write в `settings` table. Restart Docker container / deploy / process crash → constructor resets `paused = false` → scanner auto-resumes на следующий scheduler tick.
* **Operational impact**: **критический incident response failure mode**:
  1. Оператор замечает cost burn / Apify rate limit / Gemini quota / LLM provider down.
  2. Жмёт Pause в admin → `appState.paused = true`, scanner stops.
  3. Деплоит fix (`deploy.ps1`) → Docker restart → process restarts → `appState.paused = false` (default).
  4. Scanner auto-resumes → продолжает то же поведение что вызвало incident.
  5. Оператор думает что fix не сработал, не понимает что pause снёсся.

  Сравни с `disabledCollectors` (line 316-322 in index.js) — **persists** в DB setting'е, deploy survives. Pause должна работать так же.
* **Repro**: pause → check `appState.paused === true` → restart `npm start` → check `appState.paused === false`.
* **Fix**: persist в DB `settings.scannerPaused = '1'|'0'`. Constructor reads: `this.appState.paused = db.getSetting('scannerPaused') === '1'`. Pause/resume endpoints write обе in-memory + DB. ~5 строк.

---

### [ADM-008] UsersPage no pagination — break at >200 users — severity: **medium**

* **Where**: `src/db/database.js:145` (`_getAllUsers` hardcoded `LIMIT 200`), `src/admin/server.js:2329` (frontend без pagination params)
* **Tab**: Пользователи
* **What**: hardcoded `LIMIT 200` без `OFFSET`. На текущем масштабе (~5-50 users) OK. При scale (>200) — operator видит first 200, остальные invisible. Нет «load more», нет page indicator, нет «showing 200 of N».
* **Operational impact**: future scaling blocker. Можно случайно загадить prod-DB orphan rows если оператор delete'ит обнаружимых юзеров thinking what's all of them.
* **Fix**: pagination — `?offset=X&limit=50` + page controls + total count returned в response. ~30 строк.

---

### [ADM-009] BotPage sub-tab состояние не persisted — reset to 'ai' on reload — severity: **medium**

* **Where**: `src/admin/server.js:4812` (`useState('ai')` без localStorage)
* **Tab**: Бот (3 sub-tabs)
* **What**: оператор работает в «📢 Рассылки» sub-tab → reload page → переключается на «🧠 AI» (default). При active broadcast composing — lost context.
* **Fix**: `useState(() => localStorage.getItem('adm_bot_subtab') || 'ai')` + setter дёргает `localStorage.setItem`. ~5 строк.

---

### [ADM-010] Broadcast composer — no preview, no test-send, no confirm — severity: **medium**

* **Where**: `src/admin/server.js:5048-5067` (BotPage Рассылки sub-tab)
* **Tab**: Бот → Рассылки
* **What**: composer имеет textarea (HTML), plan_filter dropdown (all/free/test/pro), Send button. На click — POST `/api/broadcast` мгновенно. Нет:
  * **Preview** rendered HTML (parse_mode='HTML' Telegram-style) — оператор не видит как сообщение выглядит для user'а.
  * **Test send** — отправить только себе / admin'ам перед массовой рассылкой.
  * **Recipient count confirm** — нет «Вы собираетесь отправить N юзерам, подтвердите».
* **Operational impact**: broadcast — destructive, irreversible op (хотя есть edit/unpin/delete после), но юзеры уже получили notification. Без preview оператор может отправить broken HTML / typo / wrong plan filter.
* **Fix**: preview pane (render через тот же sanitizer что Telegram использует), test-send checkbox («Только мне»), confirm dialog с count «Отправить сообщение N юзерам плана X?». ~40 строк.

---

### [ADM-011] SubmitPage — no cache-hit indicator, no cost indicator — severity: **medium**

* **Where**: `src/admin/server.js:5811-5988` (SubmitPage)
* **Tab**: Ручной анализ
* **What**: оператор submit'ит URL → response показывает analysis result. Нет visual:
  * **Cache hit vs fresh** — была ли это re-analysis из cross-user cache (TTL 1h, см. WORKLOG 17.05) или actual Stage 1+2 call с LLM-spend.
  * **Cost indicator** — Stage 2 forced (manual всегда forceStage2:true), сколько $ потрачено.
* **Operational impact**: оператор не понимает realную cost. Может delete cached entry → re-submit → не понимает что incurred fresh $5-10 spend.
* **Fix**: badge «🟢 cache» / «🔴 fresh» в ManualResultCard + token/USD counter рядом. Backend уже знает (cross-user cache check + Stage 2 token usage). ~20 строк UI + 1 field в response.

---

### [ADM-012] PresetConfigsPage no loading skeleton — blank during fetch — severity: **medium**

* **Where**: `src/admin/server.js:6407+` (PresetConfigsPage)
* **Tab**: Пресеты
* **What**: первый mount → fetch `/api/preset-configs` → если endpoint slow (>500ms) → UI пустой. Нет skeleton, нет spinner, нет «Загрузка...».
* **Fix**: `if (!data) return <Spinner />`. ~3 строки.

---

### [ADM-013] ExamplesPage no loading skeleton — severity: **medium**

* **Where**: `src/admin/server.js:6014+`
* **Tab**: AI Examples
* **What**: same pattern что ADM-012.
* **Fix**: ~3 строки spinner.

---

### [ADM-014] PaymentsPage missing empty state — severity: **medium**

* **Where**: `src/admin/server.js:2485+`
* **Tab**: Платежи
* **What**: при 0 payments — UI рендерит table headers + пустое body. Нет «Нет платежей за выбранный период».
* **Fix**: `if (data.length === 0) return <EmptyState msg='Нет платежей' />`. ~5 строк.

---

### [ADM-015] Debug Inspector pane — нет isolated Auto layer view — severity: **medium**

* **Where**: `src/admin/server.js:6862-6871` (Debug Inspector — Defaults / Effective / Draft 3-pane)
* **Tab**: Пресеты
* **What**: 16.05 fix добавил Debug Inspector — 3 pane: Defaults, Effective, Draft. **Auto layer показан только implicitly** — оператор должен mental-subtract'ить «Effective - Defaults - Draft = Auto». Это error-prone при complex preset configs.
* **Operational impact**: original bug который spawn'ил 16.05 fix — оператор не видел auto layer → удалял chips думая что auto пустой → ломал production. 4-pane (Defaults / **Auto** / Draft / Effective) полностью решило бы.
* **Fix**: 4-pane layout `gridTemplateColumns: '1fr 1fr 1fr 1fr'`, add `renderInspectorPane(h, 'Auto · ' + tab, data.autoOverrides[tab] || {})`. ~3 строки.

---

### [ADM-016] PII — telegram_chat_id full visible (no maskId) в UsersPage + PaymentsPage — severity: **medium**

* **Where**: `src/admin/server.js:2422` (UsersPage), `:2551` (PaymentsPage)
* **Tab**: Пользователи / Платежи
* **What**: `telegram_chat_id` отображается полностью (e.g. `987654321`). `maskId(chat_id)` helper существует и используется в **логах** (e.g. alert-dispatcher.js:408 → `***4321`), но **не в admin UI**.
* **Operational impact**: admin trusted context (loopback only, через SSH-tunnel) — но если admin screenshot / screen-share / leak — full chat_ids exposed. Telegram chat_id может быть использован для targeted attack (если знаешь bot token — можешь отправить message any user). Defense-in-depth.
* **Fix**: render через `maskId(u.telegram_chat_id)` → показывает `***4321` plus hover/click reveal на полный ID (для actual lookup). ~5 строк + reuse существующего helper'а.

---

### [ADM-017] StatusBar + nav indicators dupe-poll `/api/pipeline` — severity: **medium**

* **Where**: `src/admin/server.js:7188` (StatusBar `/api/pipeline` каждые 2.5с), `:7513` (nav indicators `/api/pipeline` каждые 12с)
* **Tab**: topbar + App
* **What**: два независимых polling loop обращаются к **одному** endpoint. StatusBar 2.5с + nav 12с → за минуту ~29 hits на `/api/pipeline`, без dedup.
* **Operational impact**: 50% wasted requests. Server-side каждый hit reads `appState.cycleStartedAt`, `appState.activeStage`, etc — cheap но multiplied.
* **Fix**: shared global context (`PipelineContext` через React Context). Один poll'er (2.5с — fastest), нав indicators consume same data. ~20 строк refactor.

---

### [ADM-018] PIPE-004 admin-UX angle — Force-Scan timestamp updates async — severity: **medium**

* **Where**: `src/admin/server.js:1085+` (`/api/scan` handler), `src/index.js:365` (`appState.cycleStartedAt` set inside `runScanCycle()`)
* **Tab**: Сканеры
* **What**: оператор жмёт Force-Scan → endpoint returns 200 → button показывает '⏳ Сканирую...' → flash toast 'Сканирование запущено' → 8s timeout сбрасывает button. Но `appState.cycleStartedAt` set'ится только когда `runScanCycle()` actually fires (async after admin endpoint returned). Если scheduler busy / cooldown / какая-то задержка между endpoint и actual scan kick — admin UI showsRunning state, но StatusBar 8 stages не подсвечиваются (lastCycle stale).
* **Operational impact**: confusing UX state. Оператор видит «scanning...» в button но StatusBar не animates → думает что что-то залипло. Может нажать Force-Scan повторно (busy guard есть на line 1089-1090, но visual inconsistency remains).
* **Fix**: write `appState.cycleStartedAt = Date.now()` immediately в admin endpoint **перед** async `runScanCycle()` kick. PIPE-004 уже это flag'нул — это admin UI angle на same issue. Cross-audit overlap.

---

### [ADM-019] Нет delete user button — long-term GDPR concern — severity: **low**

* **Where**: UsersPage — нет button, нет endpoint
* **Tab**: Пользователи
* **What**: оператор может block (status='blocked'), grant/revoke plan, но не delete полностью. Long-term: user requests data deletion (GDPR style) → SSH + raw SQL only.
* **Fix**: либо acceptable (low priority for current ops), либо «🗑 Удалить юзера» button с confirm + cascade (FK=OFF concern — DB-005 — нужно поправить FK first или manual cascade). ~30 строк + careful cascade logic.

---

### [ADM-020] Restore hardcoded ghost color (not red) — severity: **low**

* **Where**: `src/admin/server.js:6851` (`className: 'btn btn-ghost btn-sm'`)
* **Tab**: Пресеты
* **What**: «↩ Restore hardcoded» — destructive op (overrides all manual presets) — но button color `btn-ghost` (нейтральный gray), не destructive red. Confirm dialog есть (good), но visual hint missing.
* **Fix**: `className: 'btn btn-danger btn-sm'` (same change что и ADM-003 для Wipe manual).

---

### [ADM-021] No i18n in admin — 95 hardcoded RU strings — severity: **low**

* **Where**: across `src/admin/server.js`
* **Tab**: all
* **What**: 0× `t()` calls, ~95 hardcoded RU strings, ~5 EN. Admin operator-only (russian-speaking team) — acceptable trade-off сейчас. Future: если когда-то будет EN admin (например support persona) — большой refactor.
* **Fix**: low priority. Add `src/i18n/admin.js` с `getAdminT(lang)` helper. Apply mechanically when needed.

---

### [ADM-022] window.prompt для maintenance cleanup — basic UX — severity: **low**

* **Where**: `src/admin/server.js:4662` (`window.prompt('Удалить алерты старше скольких дней?', '30')`)
* **Tab**: Stats (maintenance)
* **What**: browser native `prompt()` — ugly, не styled, не поддерживает rich UI (slider, validation hint, preview rows count).
* **Fix**: custom modal с number input + slider + «delete N rows» preview. ~30 строк.

---

### [ADM-023] DECISION_LABELS hardcoded — easy to forget update — severity: **low**

* **Where**: `src/admin/server.js:3808-3818` (DECISION_LABELS constant)
* **Tab**: Алерты
* **What**: список reason types для chip labels (sent / threshold / hard_junk / source / alert_type / dedup / daily / cap / send_failed) — hardcoded. `lipsync` и `tiktok_quality` (added later) **не в DECISION_LABELS** — рендерятся как raw reason name без emoji/color.
* **Operational impact**: новые gates в alert-dispatcher не получают label → admin UI showsless polish для свежих gates. Drift between alert-dispatcher gates list (10 gates) and DECISION_LABELS list (9 entries). Minor.
* **Fix**: единый registry в `src/notifications/alert-dispatcher.js` экспортирует GATE_LABELS, admin импортирует. Or simply add `lipsync` + `tiktok_quality` to DECISION_LABELS. ~10 строк.

---

### [ADM-024] PIPE-001 visual angle — firstFail chip correct, expanded row shows all — severity: **low**

* **Where**: `src/admin/server.js:4085-4259` (DecisionsPage math panel)
* **Tab**: Алерты
* **What**: проверено лично — PIPE-001 концерн что admin UI shows wrong firstFail для TikTok с двойным fail (lipsync вместо tiktok_quality) — **частично false alarm**:
  * **Chip-level** (verdict header «Отсеяны · lipsync») — да, показывает first failed gate (lipsync). Это alert-dispatcher level concern (PIPE-001).
  * **Math panel** (expanded row) — показывает **all** gates с их pass/fail status, включая `✗ lipsync` + `✗ tiktok_quality`. Оператор видит both.
* **Operational impact**: оператор может увидеть оба fail'а если разворачивает строку — но в overview/aggregation (reason counts chip row) считается только firstFail. Reason counts будут показывать lipsync для трендов где tiktok_quality тоже failed — distorts aggregation stats.
* **Fix**: либо аннотировать chips «(also failed: tiktok_quality)», либо вообще считать все failed gates в counts (не только firstFail). Cross-audit overlap с PIPE-001 — не дублирую, просто confirm admin-UX angle менее severe чем feared.

---

### [ADM-025] Section primitive defined but not used — adoption progress = 0 — severity: **info**

* **Where**: `src/admin/server.js` — `<Section>` component defined per SESSION_CONTEXT
* **Tab**: cross-cutting
* **What**: «`<Section icon title desc actions>` определён, готов для refactor от `.adm-card`» — но в реальности **0 callsites** Section в коде. Legacy `.adm-card` блоки везде.
* **Fix**: либо начать adoption (~50 строк refactor на 5-10 callsites pages), либо удалить Section если не нужен. Documentation drift.

---

### [ADM-026] Admin single dark theme — no toggle — severity: **info**

* **Where**: admin CSS — нет `[data-theme="..."]` selectors
* **Tab**: all
* **What**: single dark theme. Acceptable для loopback-only operator UI. Flag for awareness.

---

### [ADM-027] 6× window.confirm browser-native — severity: **info**

* **Where**: 6 destructive ops в admin
* **Tab**: cross-cutting
* **What**: все confirm через `window.confirm()` — ugly, не styled, blocking. Custom modal lib (или reuse Sheet primitive из dashboard) дал бы лучший UX. Low priority.

---

### [ADM-028] Stage 1 examples — no import/export — severity: **info**

* **Where**: ExamplesPage
* **Tab**: AI Examples
* **What**: CRUD есть, но нет batch import (JSON/CSV upload) или export (для prompt-engineering iteration вне UI). Future workflow improvement.

---

### [ADM-029] TagRefreshPage "Загрузка..." text instead of skeleton — severity: **info**

* **Where**: `src/admin/server.js:7366`
* **Tab**: Auto-tags
* **What**: показывает text "Загрузка..." если `!data` — minimal UX, acceptable для fast endpoint, но не visual skeleton.
* **Fix**: optional polish.

---

### [ADM-030] ExamplesPage kind tab state lost on reload — severity: **info**

* **Where**: ExamplesPage
* **Tab**: AI Examples
* **What**: оператор переключается на «mistake» tab → reload → возвращается на «example» (default). Same pattern что ADM-009 (BotPage sub-tab). Fix через localStorage.

---

## Verified safe

То что прошло — не пересматривать на следующих этапах:

1. **47 endpoints all wire-up correctly** — все frontend `api(...)` calls map'ятся на backend `_handle*` handlers. Нет orphan endpoints, нет missing handlers.
2. **Admin auth (line 930) protects all `/api/*` routes** — `ADMIN_API_KEY` Bearer header required. Re-verified Stage 1 + здесь.
3. **`/api/scan` admin gate работает на admin server (port 8081)** — отдельно от dashboard `/api/scan` (port 8080, SEC-001 — separate endpoint, separate fix). Admin Force-Scan корректно protected.
4. **3-layer merge UI consistency** — `getEffective` (line 6455) делает identical 3-layer walk что production `getActivePresetConfig`. After 16.05 fix.
5. **/api/preset-configs response complete** — `effective`, `overrides` (manual), `autoOverrides`, `tagsLocked`, `fieldRanges`, `defaults`, `presets`, `groups`.
6. **Debug Inspector pane present** (3-pane: Defaults / Effective / Draft) — оператор может видеть raw blobs.
7. **Per-tag 🔒 lock UI** — Reddit subreddits + Twitter keyword groups + TikTok hashtags (added 2026-05-11) все consistent.
8. **Restore hardcoded confirm correct** — `window.confirm` + `String.fromCharCode(10)` newlines + clear description consequences.
9. **Per-preset Reset confirm** — есть `window.confirm`.
10. **Save flow** — await server, error handling, persistence через response replace.
11. **Pause toggle yellow dot indicator** — реально triggers (line 7555-7556 nav-dot.paused).
12. **StatusBar 3 subtitle states implemented** — paused / running with Stage / lastCycle.
13. **StatusBar mobile wrap (max-width 1100px)** — verified CSS flexDirection: column.
14. **UsersPage drawer single-row state** — `expandedId`, click closes other rows.
15. **UsersPage filter/search wire-up** — search + plan + status параметры передаются в `_getAllUsers`.
16. **UsersPage auto-refresh после grant** — `load()` called immediately после Grant/Revoke success.
17. **Revoke confirm dialog** — есть (downgrade requires confirm).
18. **DecisionsPage math panel detailed** — Σ positive - Σ penalty = score, per-signal breakdown (meme/viral/emergence/twitter/feedback), junk + stale penalty, junk trigger reasons, feedback stats, hard-junk gate reference, stale decay cap reference, trigger source, weights snapshot.
19. **DecisionsPage refresh every 10s** — auto-update.
20. **DecisionsPage reason chip aggregation counts** — built dynamically from `counts` object.
21. **ExamplesPage full CRUD** — Create/Read/Update/Delete + toggle enabled + sync to Stage 1 prompt via `scorer._buildExamplesContext`.
22. **ExamplesPage tab filter** — kind (example vs mistake) works.
23. **SubmitPage history persisted in DB** — global scope, survives restart.
24. **SubmitPage error handling** — input validation + inline error message.
25. **BotPage 3 sub-tabs work** — instant switching, separate render blocks.
26. **Broadcast composer wire-up** — message + plan_filter → `POST /api/broadcast` → response shows {sent, failed}.
27. **Broadcast manage operations** — edit (window.prompt), unpin, delete (window.confirm) per-broadcast.
28. **AI sub-tab dropdowns** — `/api/ai-models` lists available, refresh button works.
29. **Feedback weights controls** — toggle + 4 sliders (admin/pro/test/free).
30. **TagRefreshPage features** — toggle, force button (rate-limit 1×/24h), status badge with countdown, history table, reset-breaker.
31. **Cleanup alerts maintenance** — `window.prompt(N days)` → `POST /api/alerts/cleanup` → response shows deleted counts.
32. **Logs/metrics on /api/pipeline** — StatusBar consumes structured data (cycleStartedAt, activeStage, lastCycle).
33. **Primitives namespace isolated** — `.dec-*` / `.sb-*` / `.scfg-*` / `.pcfg-*` / `.sp-*` / `.exp-*` все scoped, no cross-leak.
34. **Deploy-aware scheduler integration** — `disabledCollectors` IS persisted in DB setting (analog of what ADM-007 needs).
35. **No orphan handlers** — все backend `_handle*` методы called by frontend.

---

## Spec drift (накопительно — 16 items)

К существующим 14 items добавляю 2 новых admin-уровень:

- **SD-1**..**SD-14** — см. предыдущие этапы.
- **SD-15** **Section primitive adoption** — SESSION_CONTEXT § «Admin panel» декларирует «Section primitive определён, готов к использованию для постепенного refactor от `.adm-card` блоков». В реальности **0 callsites** Section в коде, все pages используют legacy `.adm-card`. Либо начать adoption, либо удалить мёртвый primitive из SESSION_CONTEXT. См. ADM-025.
- **SD-16** **Pause persistence drift** — SESSION_CONTEXT § «Production posture» / «Admin panel» не упоминает что pause state в-памяти only. Operator readдет docs, ожидает что pause survives restart (like `disabledCollectors`) — нет. Нужно либо fix (ADM-007), либо явно задокументировать «pause = в-памяти only, restart resets».

Финальный sync-pass по SESSION_CONTEXT планируется после всех 12 этапов.

---

## Cross-audit overlap

«One-fix-many-wins» backlog (расширен до **13 targets** с admin-уровень):

1. **Backup integrity rewrite** (DB-001+002+003+004 + SD-9) — 5 items.
2. **`notifications` migration** (UNIQUE + retention) — PIPE-006 + COST-016 + DB-007 + DB-008 — 4 items.
3. **Schema integrity sweep** (FK=ON + busy_timeout + orphan cleanup + retention loops) — DB-005+006+009+010+011 — 5 items.
4. **`db.transaction` wrap save loops** — DB-013 + COST-007 + TXN-002+003 — 3 items.
5. **`sqliteCutoff` consolidation** — DB-012 + DB-020 + DB-027 + SD-8 — 4 items.
6. **Housekeeping schedule** (logs + video-cache + auth_sessions + monitoring) — DB-010+011+014+022+023 + **ADM-004** (admin UI exposure для same housekeeping) — 6 items.
7. **`/api/scan` admin gate + immediate timestamp** (TRIPLE locked) — SEC-001 + PIPE-004 + BILL-003 + **ADM-018** (admin UX angle) — 4 items.
8. **DB-backed counter table `feature_usage_log`** — BILL-007 + COST-003 — 2 items.
9. **Hover preview plan-check + per-user rate-limit** — BILL-001 + COST-004 — 2 items.
10. **Proactive Google healthcheck + counter reset** — PIPE-002 + COST-006 + COST-008 — 3 items.
11. **Focus trap implementation** — UX-002 + a11y compliance — 5 modal callsites.
12. **(NEW) Admin observability persistence migration** — `alert_decisions` table + `admin_audit_log` table — **ADM-002 + ADM-005 + BILL-002 + COST-003** — 4 items в одной серии (общая «persist in-memory observability state to DB» pattern).
13. **(NEW) Standardized error banner / state** — **ADM-001 (3 silent pages)** + **UX-001 (Feed silent)** — common error UX pattern, единый `<ErrorBanner>` component reused — 4 items.

Admin-specific overlap с предыдущими аудитами:
- **ADM-001 (3 silent error states)** ↔ **UX-001 (Feed silent)** — общий «standardized error UX» pattern → backlog #13.
- **ADM-002 (decisions in-memory)** ↔ **COST-003 + PIPE-016 + BILL-002** — общий «admin observability persistence» pattern → backlog #12.
- **ADM-005 (plan grant atomic + audit log)** = BILL-002 + BILL-006 admin angle — backlog #12.
- **ADM-006 (no Page Visibility)** ↔ dashboard polling — common.
- **ADM-007 (pause not persisted)** — narrow, single-fix.
- **ADM-017 (dupe polling /api/pipeline)** ↔ COST observability — overlap.
- **ADM-018 (Force-Scan timestamp async)** = PIPE-004 admin UX angle → backlog #7.
- **ADM-024 (PIPE-001 visual)** — confirms math panel shows all gates → PIPE-001 downgrade not needed но reason aggregation distortion concern remains.

Если приоритезировать **a11y sprint** (UX) + **backup-rewrite + notifications migration + schema-sweep + admin observability persistence + standardized error banner** — закроется ~20 finding'ов из 7 этапов одной серией PR.

---

## Out of scope / Followups

- **Admin auth** — Stage 1 verified safe (Bearer ADMIN_API_KEY, line 930 protects all /api/*, timing-safe compare).
- **Admin SPA security headers** — SEC-010 mitigated by loopback bind.
- **Pipeline correctness** — Stage 2 (PIPE-001 cross-checked admin UI angle here).
- **Billing entitlements** — Stage 3 (BILL-002+006 cross-checked admin UI angle here).
- **Cost throttling** — Stage 4 (COST-009/010 observability gaps cross-checked).
- **DB schema/retention** — Stage 5 (housekeeping ops cross-checked).
- **Dashboard UX** — Stage 6.
- **TG bot delivery / message format** — Stage 8.
- **Production nginx / backup integrity** — Stage 9.
- **Cat mascot** — Stage 10.
- **Code quality (dead code, SPA-trap protection, Section adoption)** — Stage 11.
- **Documentation polish** — Stage 12.

**Open assumptions** (помечены `⚠ assumes` или `⚠ requires runtime verification`):
- ADM-014 (PaymentsPage empty state) — assume по grep, не runtime-verified открыв с 0 payments в DB.
- ADM-022 (custom modal preferred) — UX preference, не functional defect.
- ADM-026 (single dark theme acceptable) — assume operator preference.

**Followup observability**: ни один subagent не запросил Bash на этом этапе — explicit Read/Grep инструкции в prompt'ах работают consistently. Самое сложное место — confirm PIPE-001 admin angle (нужно было читать DecisionsPage math panel + alert-dispatcher gates list side-by-side) — sonnet agent был бы быстрее haiku здесь.
