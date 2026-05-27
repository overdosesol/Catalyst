# WORKLOG

Активный журнал — **последние ~10 entries**. Всё что старше переезжает в
[`WORKLOG_ARCHIVE.md`](./WORKLOG_ARCHIVE.md) (правило `AGENT_RULES.md §6`).

Append на верх — новейшие сверху, старейшие снизу. Порог в 10 — мягкий:
если несколько entries относятся к одному PR/дню, можно временно держать
до 12 безархивации. Полная история — в git.

Если задача мелкая, например передвинуть кнопку в дашборде или изменить немного текст в промпте для llm, можно сразу не записывать в WORKLOG, а подождать пока накопится около 5 мелких правок или 1 большая и записать всё вместе.

---

## 2026-06-07 · sonnet · Bundle #2 — Observability persistence (BILL-002, ADM-002, ADM-005, COST-003, PIPE-016)

**Цель**: Закрыть 5 finding'ов критической observability — audit log на plan changes, alert decisions persist, cost counter persist, atomic transactions.

**Метод**: subagent-driven (sonnet оркестратор, haiku для мехач задач, sonnet для SPA-trap territory). 9-task bundle: T1 schema + migration → T2 6 new DB methods → T3-T4 upgradePlan/confirmPaymentAndUpgrade transactions → T5 _setUserPlan atomic + audit → T6 alert dispatcher dual write → T7 cost counter Map→DB swap → T8 housekeeping intervals → T9 docs. Per-task verification via Node REPL in-memory DB tests + `npm run check:spa` после edit'a dashboard/server.js (T7).

**Spec divergence**: spec'овские helper modules (`src/db/audit.js`, `src/billing/usage.js`) **отброшены** — проект не имеет singleton `db` export (создаётся в `src/index.js:37`, передаётся как ctor param). Все DB calls через `this.db.<method>` / `db.<method>`. Методы добавлены прямо на `TrendDatabase` class. -2 файла, matches existing pattern.

**T7 bonus**: implementer обнаружил 2 пропущенных в плане Map references (lines 1703 + 2065 — `shouldShowUsageCounter` readout paths). Применил тот же DB swap, иначе runtime TypeError. Scope расширен с 3 edit'ов до 5.

**Файлы**:
- `src/db/schema.sql` — +3 `CREATE TABLE IF NOT EXISTS` + indexes (admin_audit_log, alert_decisions, feature_usage_log).
- `scripts/migrate-audit-log-2026-06-07.sql` — **new** idempotent migration script (operator one-off; также re-creates on boot).
- `src/db/database.js` — +6 методов на `TrendDatabase`: `recordAuditEvent`, `recordAlertDecision`, `recordFeatureUsage`, `getRecentFeatureUsageHits`, `pruneAlertDecisions`, `pruneFeatureUsageLog`. `upgradePlan` wrapped в `db.transaction()` + audit write. `confirmPaymentAndUpgrade` writes audit inside existing transaction (atomic с payment confirm + plan update).
- `src/admin/server.js` — `_setUserPlan` wrapped в transaction + audit для free/admin path. Paid path делегирует на `db.upgradePlan` (уже atomic от T3).
- `src/index.js`:
  - `recordAlertDecision` function dual write — memory ring buffer для `/api/decisions` API + fire-and-forget `db.recordAlertDecision()`.
  - Housekeeping cron: +2 `setInterval` для `pruneAlertDecisions(14)` + `pruneFeatureUsageLog(7)` + boot-time one-shot calls.
- `src/dashboard/server.js`:
  - Удалены `_manualAnalysisHits` / `_catalystHits` Map fields.
  - 5 callsites swap: catalyst cap (~1670) + manual-analysis cap+cooldown (~1972) + 2 usage counter readouts (~1703 + ~2065).
- `ai-context/SESSION_CONTEXT.md` — +1 bullet в Production posture.

**Деплой**: subagents file edits only, no commits. Operator commits selectively. **CRITICAL**: после деплоя operator должен ОДНОКРАТНО запустить миграцию на VPS — `sqlite3 /path/to/catalyst.db < scripts/migrate-audit-log-2026-06-07.sql` (boot-time `_migrate()` тоже их создаст, но script даёт explicit DR step). Deploy через `deploy.ps1`, Bundle #16 SPA gate валидирует SPA повторно.

**Риски**: low/medium. Cap check теперь hits DB вместо Map — но composite index `(user_id, feature, ts DESC)` делает SELECT ~50µs. Fail-open on DB error (`getRecentFeatureUsageHits` returns `[]`) — better than lockout. Alert dispatcher dual write fire-and-forget — log loss non-fatal. Atomic transactions для `_setUserPlan` — strict gain (previous state allowed half-applied plan changes). Memory ring buffer `appState.alertDecisions` сохранён для `/api/decisions` API — нет breaking changes на dashboard side.

**Closes**: BILL-002 (HIGH), ADM-002 (HIGH), ADM-005 (HIGH), COST-003 (HIGH), PIPE-016 (info, intended). 5 findings одним bundle'ом.

---

## 2026-06-07 · sonnet · Bundle #3 — URL safety helpers (BOT-001, BOT-002, SEC-006, BILL-001)

**Цель**: Закрыть 4 finding'а URL-handling — HTML attr escape (BOT-001), protocol whitelist (BOT-002, SEC-006), paywall gate на hover preview (BILL-001).

**Метод**: subagent-driven (sonnet оркестратор, haiku для мехач задач). 7-task bundle: T1 helpers → T2 formatter → T3-T6 dashboard SPA edits (4 JSX hrefs + 2 preview endpoints) → T7 docs. Per-task `npm run check:spa` validation gate (Bundle #16 SPA-trap defense) после каждого `src/dashboard/server.js` edit.

**Файлы**:
- `src/utils/url-safety.js` — **new** (~50 LOC, 3 exports: `escHtmlAttr`, `safeUrl`, `safeHref`).
- `src/notifications/formatter.js` — import + line 145 теперь `if (safeUrl(trend.url))` + `safeHref()` в `<a href>`. Если URL невалиден — линк скипается целиком (лучше тихий no-link чем TG 400 на alert).
- `src/dashboard/server.js`:
  - Inline duplicate `escHtmlAttr`/`safeUrl`/`safeHref` в `_buildSPA` template после `BOT_USERNAME` injection (SPA не может ESM-импортить).
  - `href: safeHref(...)` применён к 4 JSX hrefs: feed action button (~9799), modal source link (~10657), X-trends top tweets (~10753), AnalyzeResult hero (~11419). Quality reviewer обнаружил 2 дополнительных миссы поверх изначальных 2 audit'ных — расширили scope чтобы полностью закрыть SEC-006.
  - `_handleTweetPreview` (~1334): `getPlanEntitlements().sources.includes('twitter')` gate → 403 если нет.
  - `_handleRedditPreview` (~1396): аналогичный `'reddit'` gate (consistency — reddit пока в free, gate rarely rejects, future-proofing).
- `ai-context/SESSION_CONTEXT.md` — +1 bullet в Production posture.

**Деплой**: subagents file edits only, no commits. Оператор сам деплоит через `deploy.ps1` после ревью. Bundle #16 SPA gate (`[1/5] Validating SPA syntax`) в deploy script повторно проверит SPA как defense-in-depth.

**Риски**: low. URL constructor throws → `try/catch` returns null → graceful. SPA template литерал не задет (helpers без backticks/template syntax, валидатор подтвердил после каждой правки). Reddit gate безвреден (reddit в free.sources). TG bot link skip — лучше чем 400. Inline duplicate в SPA — established pattern (LIFESPAN_VALUES, CatMascot FSM), drift отслеживается quarterly drill (DEPLOY.md §6.6).

**Closes**: BOT-001 (HIGH), BOT-002 (HIGH), SEC-006 (MEDIUM), BILL-001 (HIGH). 4 finding'а одним bundle'ом.

---

## 2026-06-06 · sonnet · Bundle #19 — Dead code cleanup (QUAL-005/006/007/011 + SD-23 + chained dead const)

**Цель**: удалить мёртвый код в dashboard SPA (~24 LOC + chained 8 LOC bonus) + 1 stale CSS comment update + 1 doc annotation. Tier 2 #19 из `docs/audit/INDEX.md` — самый высокий ROI Tier 2 (7.0).

**Контекст**: Stage 11 audit пометил функции и CSS классы от прошлых iterations (R4 redesign + ранние UX experiments). Haiku-grep валидация подтвердила 0 actual usages для всех dead items до старта. Pure polish после foundation Tier 1 (Bundle #1/#16/#17 closed).

**Метод**: brainstorm (`docs/superpowers/specs/2026-06-06-dead-code-cleanup-design.md`) → 9-task plan (`docs/superpowers/plans/2026-06-06-dead-code-cleanup.md`), subagent-driven T1-T8, operator T9. Per-task `npm run check:spa` validation gate (Bundle #16 deploy gate) после каждого `src/dashboard/server.js` edit — раннее обнаружение SPA-trap. **6 server.js edits, все прошли SPA check без revert'ов.**

**Файлы**:
- `src/dashboard/server.js` (~-35 LOC + ~3 lines updated):
  - **T1** Updated CSS theme comment: "2 dark themes" → "3 themes (pulse default + ink + tide)" — QUAL-005 + SD-23
  - **T2** Deleted `.toolbar` CSS class (+ orphan section comment) — QUAL-007 part 1
  - **T3** Deleted `.kbd` CSS class — QUAL-007 part 2 (kbd_hint i18n key preserved — 2 usages)
  - **T4** Deleted `lifespanLabel()` function — QUAL-006 part 1
  - **T4.5** Bonus: deleted chained dead const `LIFESPAN_KEYS` (used only by deleted `lifespanLabel`) + its introducing comment. `LIFESPAN_VALUES` preserved (still imported + injected в SPA template)
  - **T5** Deleted `memeClass()` function — QUAL-006 part 2
  - **T6** Deleted `memeColor()` function (NOT const at line ~9617 — explicit verify const stays) — QUAL-006 part 3 + closes QUAL-011 (shadow risk resolved, only const remains)
- `ai-context/WORKLOG_ARCHIVE.md` (+1 bullet): annotation к R4 entry о partial coverage (~85% glyphs, 18 emoji остались per UX-003) — SD-14

**T7 (SESSION_CONTEXT useEffect count) — no-op**: drift не было (Stage 12 sync-pass уже резолвил это, либо документ изначально не упоминал точное число). Bonus discovery: реальный count в CatMascot = **14 useEffects** (audit assumed 11, actual differs). Out of scope, не правил.

**Verification**:
- SPA check (`npm run check:spa`) после каждого из 6 server.js edits → exit 0, без revert'ов
- Final cross-file review (sonnet): 7/7 checks pass — dead items count 0, live items count preserved, SPA OK, scope clean, diff sanity OK
- Char count baseline: Dashboard SPA 342963 → 342072 chars (≈ -1KB после deletes), Admin SPA unchanged 266605 chars

**Closed findings**:
- QUAL-005 (CSS theme comment updated to 3 themes)
- QUAL-006 (3 dead functions deleted: lifespanLabel, memeClass, memeColor)
- QUAL-007 (2 dead CSS classes deleted: .toolbar, .kbd)
- QUAL-011 (shadow risk resolved — function gone, only const memeColor remains)
- SD-14 (WORKLOG_ARCHIVE R4 annotation о ~85% coverage)
- SD-23 (resolved together с QUAL-005)
- **Bonus**: chained dead const `LIFESPAN_KEYS` (8 LOC) — not in audit, found by T4 subagent

**Не закрыто (deferred)**:
- QUAL-013 (useEffect count drift) — no-op в SESSION_CONTEXT, drift не existed. Bonus discovery (audit 11 vs actual 14) — отдельный mini-bundle если operator захочет.
- T9 operator smoke (final `npm run check:spa`, `npm run dev` startup, browser smoke) — ждёт operator.

**Tier 2 progress**: Bundle #19 closed (first из 5 Tier 2 bundles). Tier 2 remaining: #2 audit log persistence (~4h), #3 URL safety (~2h), #11 A11y sprint (~4h), #13 error visibility (~4h). Tier 2 total ~14h ahead.

**Риски/заметки**:
- SPA validation gate (Bundle #16) отработал идеально — каждый edit прошёл check:spa без откатов. Это validates наш design choice (T6 deploy hardening) — validators реально ловят bugs до того как они уйдут в прод.
- `const memeColor` at line ~9617 explicitly verified survived T6 delete. Usages on lines ~9747, ~9750 preserved.
- Chained dead code pattern: subagent T4 предупредил о LIFESPAN_KEYS становящемся dead после `lifespanLabel` delete. T4.5 cleanup'ил same session. Pattern для будущих bundles: после function delete grep всё что только эта функция использовала.
- `docs/superpowers/specs/2026-06-06-*.md` + `docs/superpowers/plans/2026-06-06-*.md` — planning artifacts, untracked. Operator может включить в commit Bundle #19 или оставить как pending.

---

## 2026-06-05 · sonnet · Bundle #17 — Cert + infra visibility (PROD-007/008/021 + DOC-003/004 + port drift)

**Цель**: версионировать prod nginx config в репо, добавить cert expiry monitoring + cron, задокументировать cert renewal + secret rotation SOPs. Tier 1 #17 из `docs/audit/INDEX.md`.

**Контекст**: prod nginx config жил только на VPS (`/etc/nginx/sites-available/catalyst`) → drift unrecoverable. HTTPS мог тихо умереть на 90д (нет alerting'а). Secret rotation был 1-liner stub в DEPLOY.md §10. Operator принёс prod nginx через `ssh cat` — bonus discovered drift в DEPLOY.md §4 (пример port 7357 vs real 8080, admin tunnel 8080 vs real 8081). Закрыли заодно.

**Метод**: brainstorm (`docs/superpowers/specs/2026-06-05-cert-infra-visibility-design.md`) → 7-task plan (`docs/superpowers/plans/2026-06-05-cert-infra-visibility.md`), subagent-driven T1-T6, operator-driven T7. Operator выбрал «Минимум» scope per Bundle #16 pattern (TG bot pings + auto-deploy nginx + external uptime monitor + DR section deferred).

**Файлы**:
- `scripts/nginx-catalyst.conf` (new, 56 lines) — exact prod copy + source-of-truth header (Bundle #17, manual sync procedure). Содержание: `server_name catalystparser.io www.catalystparser.io`, `proxy_pass http://127.0.0.1:8080`, certbot-managed TLS, set_real_ip_from 127.0.0.1, 4 X-headers + Authorization passthrough, HTTP→HTTPS redirect
- `scripts/check-cert-expiry.sh` (new, mode 100755) — bash + openssl s_client external check, exit 1 если < 14 дней (WARN_DAYS=14), exit 2 если fetch fails, log в `/var/log/catalyst-cert.log` через tee
- `DEPLOY.md` — port drift fix 4 + 1 bonus места (dashboard 7357→8080, admin 8080→8081, nginx proxy_pass пример, ssh tunnel пример, firewall comment) + new §4.2 TLS certificate renewal verification (~70 lines: install snippet, daily auto-check, manual verification, if-renewal-failed, nginx config in repo note) + new §10.1 Secret rotation (~50 lines: 12-key schedule table + 6-step per-key procedure + 5-step incident response)
- `ai-context/SESSION_CONTEXT.md` (+3 bullets, line 750) — Production posture: nginx config, Cert monitoring, Secret rotation — все ref на Bundle #17

**Деплой/проверка (T7 operator-driven)**:
- `scp scripts/check-cert-expiry.sh root@vps:/usr/local/bin/` + chmod +x → success
- Cron entry `/etc/cron.daily/catalyst-cert-check` создан, chmod +x → success
- Manual test: `ssh root@vps "/usr/local/bin/check-cert-expiry.sh catalystparser.io"` → `OK: catalystparser.io cert valid for 68 days (expires Aug 3 15:20:52 2026 GMT)`, exit 0. Comfortable margin (68 >> 14).
- nginx diff `ssh ... cat /etc/nginx/sites-available/catalyst` vs `scripts/nginx-catalyst.conf` → only diffs: новый header comment (intended) + cosmetic whitespace cleanup. Content semantically identical.

**Closed findings (audit series)**:
- PROD-007 (nginx config теперь в репо как `scripts/nginx-catalyst.conf`, manual sync задокументирован в DEPLOY.md §4.2)
- PROD-008 (daily cert expiry check via cron — warn если < 14д, верифицирован live: 68 days margin)
- PROD-021 (secret rotation полностью задокументирован в DEPLOY.md §10.1: 12-key schedule + per-key procedure + incident response)
- DOC-003 (DEPLOY.md §4.2 full cert renewal verification SOP)
- DOC-004 (DEPLOY.md §10.1 full secret rotation SOP)

**Bonus** (discovered during brainstorm, not in audit):
- DEPLOY.md §4 port drift: dashboard 7357→8080, admin 8080→8081, proxy_pass example, ssh tunnel example. **+1 subagent-discovered**: firewall comment line ("# DO NOT open 7357, 8080" → "8080, 8081"). 5 fix'ов total.

**Не закрыто (deferred)**:
- TG bot pings при cert expiry — Bundle #15 (Bot resilience) territory
- Auto-deploy nginx config через `deploy.{ps1,sh}` — требует `sudo nginx -t && systemctl reload nginx` логику; defer как риск сломать prod при broken config
- External uptime monitor (UptimeRobot/BetterStack) — operator может настроить отдельно при желании
- DR section в DEPLOY.md (VPS погиб целиком) — большой scope, отдельный bundle

**Tier 1 progress**: **Tier 1 fully closed** — Bundle #1 + #16 + #17. Все 5 critical audit'а серии разрешены (DB-001/003 false-positive, DB-002+004 Bundle #1, QUAL-001 Bundle #16). Operational readiness восстановлен. Tier 2 next: 5 bundles общим ~15h — #2 audit log persistence, #3 URL safety, #11 A11y compliance, #13 error visibility, #19 dead code cleanup.

**Риски/заметки**:
- T1 subagent потерял ` # managed by Certbot` коммент на `return 404;` строке (likely markdown rendering quirk при копировании из prompt). Controller post-fix'нул через targeted Edit. Cosmetic only — certbot CLI might re-add марк при следующем renewal.
- `scripts/nginx-catalyst.conf` теперь source of truth — если кто-то правит `/etc/nginx/sites-available/catalyst` на VPS вручную, drift молчит. Mitigation defer (можно добавить quarterly diff в drill procedure).
- Cert check использует GNU `date -d` — на BSD упадёт. Catalyst prod = Debian/Ubuntu (GNU), OK.
- В случае cron MAILTO not configured, operator проверяет `/var/log/catalyst-cert.log` руками. Pattern documented в §4.2.

---

## 2026-06-04 · sonnet · Bundle #16 — Deploy hardening (QUAL-001 + PROD-002/003)

**Цель**: интегрировать существующие SPA validators в обязательный deploy gate + sync drift между deploy.ps1 и deploy.sh. Tier 1 #16 из `docs/audit/INDEX.md` master backlog.

**Контекст**: validators (`scripts/check-dashboard-spa.cjs`, `scripts/check-admin-spa.cjs`) существовали с тех пор как backtick traps срабатывали 3 раза за неделю, но никогда не вызывались автоматически. Audit пометил это QUAL-001 (CRITICAL) — defensive infra без integration. PROD-003 — этот же gap с прод-стороны. PROD-002 — `.sh` отстал от `.ps1` (нет ServerAlive flags на scp, нет EvilCatPack/.claude/posts/ai-context в zip exclude).

**Метод**: brainstorm (`docs/superpowers/specs/2026-06-04-deploy-hardening-design.md`) → 7-task plan (`docs/superpowers/plans/2026-06-04-deploy-hardening.md`), subagent-driven для T1-T5, operator-driven для T7. T6 (synthetic negative test) skip'нут оператором — positive test уже показал что validators реально импортируют SPA и валидируют (342963 chars dashboard, 266605 chars admin).

**Файлы**:
- `package.json` (+2 lines) — `"check:spa"` chain + `"check"` umbrella alias
- `deploy.ps1` — новая `[1/5] Validating SPA syntax` phase + renumber [1/4]..[4/4] → [2/5]..[5/5]
- `deploy.sh` — симметричная `[1/5]` phase + ServerAlive flags на 4 scp calls + zip exclude расширен 4 entries (`.claude/*`, `posts/*`, `ai-context/*`, `EvilCatPack/*`)
- `DEPLOY.md` (+~6 lines в §7) — note о pre-deploy validation gate
- `ai-context/SESSION_CONTEXT.md` (+1 bullet) — Deploy gate в Production posture

**Verification**:
- Positive: `npm run check:spa` локально → exit 0, оба validators OK
- Cross-file review (sonnet): 8/8 checks pass — naming consistent, phases симметричны, ServerAlive 4/4, exclude list complete, docs cross-referenced
- Real deploy: `./deploy.ps1` показал `[1/5] Validating SPA syntax... → Dashboard SPA inner OK → SPA inner OK → SPA OK` → продолжил архивацию → завершился успешно

**Closed findings**:
- QUAL-001 (validators integrated в deploy gate) — **CRITICAL → resolved**
- PROD-002 (deploy.sh symmetric с deploy.ps1 — ServerAlive + exclude list)
- PROD-003 (pre-deploy validation now mandatory)

**Не закрыто (deferred)**:
- PROD-004 (rollback feature) — отдельный mini-PR на ~3-4h. Включает image tagging + DB backup hook + `--rollback` flag. Out of scope текущего bundle (operator выбрал «Минимум»).

**Series milestone**: после Bundle #16 **все 5 critical** из 12-stage audit разрешены. DB-001/003 = false-positive audit (prod уже OK), DB-002+DB-004 = Bundle #1, QUAL-001 = Bundle #16. Critical-free posture восстановлен.

**Bonus**: subagent fix T3 (deploy.ps1) добавил `Join-Path $LOCAL_DIR` (CWD-independence) + colored Write-Host для consistency с соседними блоками — улучшение из code review, не было в исходном spec.

**Риски/заметки**:
- Если validator сам падает (bug в check-*-spa.cjs) — блокирует deploy. Fallback: оператор может разово закомментить `npm run check:spa` блок в deploy.{ps1,sh}.
- `npm` теперь required на dev машине для deploy. Раньше можно было deploy без node (только scp/ssh).
- Phase renumber [1/4] → [1/5] — внутренние UX labels, никто на них не парсится.
- T6 (synthetic negative test) skip'нут оператором as nice-to-have, не блокер.

**Tier 1 progress**: Bundle #1 + Bundle #16 closed. Остались: #18 QA infrastructure (~3h) + #17 cert visibility (~3h).

---

## 2026-06-03 · sonnet · Bundle #1 — Backup integrity rewrite (T1-T7 implementation)

**Цель**: закрыть оставшиеся critical/high backup findings из 12-stage audit (DB-002, DB-004, PROD-001/005/011, SD-9/21). Brainstorm → spec → plan → subagent-driven implementation → operator deploy + drill. Tier 1 #1 из `docs/audit/INDEX.md` master backlog.

**Контекст**: brainstorm-сессия (`docs/superpowers/specs/2026-05-27-backup-integrity-rewrite-design.md`) выявила что 2 из 4 DB critical уже закрыты на prod — `sqlite3 .backup` использовался, B2 rclone крутил с 6 мая (149 MB, 21 файл). Audit ошибся в обвинении «B2 не имплементирован» — он видел только репо-стаб `scripts/backup.sh`, не prod-скрипт. Реальная проблема: prod-скрипт не в репо + три hardening gap'а.

**Метод**: 9-task план (`docs/superpowers/plans/2026-05-27-backup-integrity-rewrite.md`), subagent-driven-development для T1-T7, operator-driven для T8-T9. Per-task spec compliance + code quality reviews. Code-quality reviewer на T1 нашёл что `set -o pipefail` сам по себе НЕ ловит `rclone | tee` — это invalidated quick-win 1 spec; добавлено 4 review-driven fixes.

**Файлы**:
- `scripts/catalyst-backup.sh` (new, 56 lines) — prod backup, **7 hardening features**:
  1. `set -euo pipefail`
  2. Volume discovery validation (3 guards: VOLUME_NAME / VOLUME_PATH / DB file)
  3. PRAGMA integrity_check на исходной БД
  4. stat -c%s sanity check после .backup (fail если < 4096 байт)
  5. gzip -t verify после компрессии
  6. Direct `>> log 2>&1` (не `| tee` — экранирует exit code rclone)
  7. `du -sh` вместо `ls -lh | awk` (locale-stable)
- `scripts/backup.sh` (deleted) — dev stub, не использовался в prod
- `deploy.ps1` (+10 lines) — sync block с `$LOCAL_DIR`-relative path + colored output
- `deploy.sh` (+8 lines) — симметричный bash sync block
- `DEPLOY.md` (+158 lines) — §6.5 Restore from backup (9 шагов, включая pointer на rclone config setup), §6.6 Quarterly drill (7 шагов с реальными именами таблиц users/trends/notifications/payments из schema.sql)
- `ai-context/SESSION_CONTEXT.md` (line 748) — backup paragraph переписан под новую реальность
- `DEPLOYMENT_SUMMARY.txt` — refs `scripts/backup.sh` → `scripts/catalyst-backup.sh` (subagent T2 заодно починил, accepted as sensible scope-creep)

**Деплой/проверка (T8)**: `./deploy.ps1` прошёл, ssh `head -10` на VPS показал новую версию с `set -euo pipefail`. Manual prod run: `bash /usr/local/bin/catalyst-backup.sh` → `backup OK: catalyst_2026-05-26_19-47.db.gz (9.2M)` без FATAL. B2 listing подтвердил upload (9617244 bytes). Ночной cron 03:30 UTC прогон — verify утром.

**Drill (T9)**: ждёт оператора (DEPLOY.md §6.6, ~20 мин). Acceptance gate для Bundle.

**Closed findings (audit series)**:
- DB-002 (gzip -t integrity check)
- DB-004 (restore documented + drill procedure; первый drill — T9)
- PROD-001 (backup script versioned в репо, deploy syncs)
- PROD-005 (DEPLOY.md restore section)
- PROD-011 (script name unified: `scripts/catalyst-backup.sh`)
- SD-9 (B2 declared + implemented + documented + versioned — drift resolved)
- SD-21 (script name mismatch resolved)

**Bonus** (не из audit, найдено в brainstorm/review): 4 hardening fixes выше (RF-1..RF-4).

**Counts subagent-driven (T1-T7)**: 7 implementer dispatches + 1 fix-up loop on T1 + 3 spec/code reviews + 1 final cross-file review. Models: sonnet для T1/T3/T4/T7 (script edge cases + deploy scripts + SESSION_CONTEXT precision); haiku для T2/T5/T6 (mechanical edits).

**Риски/заметки**:
- Prod-скрипт теперь авто-переписывается каждым deploy — если правишь руками на VPS, следующий deploy перезатрёт (by design: git = single source of truth).
- DB-001 + DB-003 = false-positive audit (фиксов не требовалось, prod уже OK).
- 3 minor notes от final reviewer оставлены defer: (1) deploy.sh sync block без `[X/Y]` step-маркера; (2) SESSION_CONTEXT formula «tee глушит exit code» для cold reader темная; (3) формальная codepath verify утром после cron-прогона.
- Tier 1 progress: Bundle #1 done (after T9). Next per INDEX.md: #16 deploy hardening (QUAL-001 + PROD-002/003/004, ~2h), затем #18 QA infra (~3h), #17 cert visibility (~3h).

---

## 2026-06-02 · opus · Documentation + spec drift resolution (этап 12/12 — series finale)

**Цель**: финальный этап серии — полный пересмотр документации (README, DEPLOY.md, CLAUDE.md, ai-context/*, .env.example, docs/superpowers/*, docs/audit/*) + финальный пас по 23 spec drift items с propose resolution для каждого. Создание master integration backlog для оператора. Только review + propose, никаких файлов не правил, не коммитил, не deployил.

**Scope (13 направлений)**: README · DEPLOY.md · CLAUDE.md · ai-context/AGENT_RULES.md · ai-context/SESSION_CONTEXT.md · ai-context/WORKLOG.md + ARCHIVE · .env.example · docs/superpowers/specs/* · docs/superpowers/plans/* · docs/audit/* (11 prior reports) · package.json · 23 spec drift resolution proposals · cross-audit final integration.

**Метод**: 5 параллельных haiku-агентов (all 11 audit reports + SD extraction, SESSION_CONTEXT vs SD matching, README+DEPLOY+CLAUDE analysis, env+package+AGENT_RULES+WORKLOG inventory, superpowers specs+plans inventory) + manual integration writing 2 documents.

**Файлы создал**:
- `docs/audit/2026-06-02-documentation-spec-drift.md` — Stage 12 report (~750 строк). Documentation inventory (13 files), Coverage gaps (5 critical DEPLOY.md sections missing, README absent, SESSION_CONTEXT §7 violations), Spec drift resolution table (all 23 SD items × category × where × effort), 20 DOC-XXX findings + 25 verified safe items.
- `docs/audit/INDEX.md` — master integration backlog (~600 строк). Series overview, 12 reports table, verdicts dashboard (per layer GREEN/AMBER/RED), Priority backlog (Tier 1-4, 19 bundles), Spec drift sync queue, Lessons learned, What's next operator workflow.

**Counts Stage 12**: 0 critical · **4 high** · 7 medium · 5 low · 4 info · **20 total** + 23 SD resolution proposals.

**Series-wide totals (all 12 stages)**:
- **~291 findings** suммарно
- **5 critical** (4 DB backup integrity cluster + 1 SPA validators dead)
- **57 high** · **99 medium** · **65 low** · **67 info**
- **23 spec drift items** accumulated
- **19 «one-fix-many-wins» bundle targets** consolidated
- **~500+ verified-safe** items (foundation для next-year audit)

**Top-3 worst Stage 12 (все high)**:
1. **DOC-002 + DOC-003 + DOC-004 + DOC-016** combined — DEPLOY.md missing 4 critical operational sections (restore procedure / cert renewal SOP / secret rotation SOP / DR section). Cross-confirm PROD-005/008/021 + DB-004. **One PR ~2h closes 4 findings + 4 cross-audit items**.
2. **DOC-005** SESSION_CONTEXT state-vs-change protocol violations — 30+ date-stamped change narratives в Tag auto-refresh + Scoring sections, violates AGENT_RULES §7. ~45 min careful edit, restores compliance.
3. **DOC-001** README.md missing — public surface = 0. Acceptable пока private operator-only repo, critical если repo open. ~30 min create.

**Verdicts dashboard (всех 12 layers)**:
- 🟢 GREEN (5): Security, Pipeline, Billing, Dashboard UX, Cat mascot R7
- 🟡 AMBER (6): Cost, Admin, TG bot, Production, Code quality, Documentation
- 🔴 RED (1): **Database health** (4 critical backup integrity cluster)

**Overall**: 🟡 AMBER — production safe для current scale, multiple actionable risks queue до scaling.

**Cross-audit overlap — 19 bundle targets organized по 4 tiers**:

**Tier 1: foundation** (~12 hours, ~20 findings closed):
- #1 Backup integrity rewrite (8 items): DB-001..004 + SD-9/10/21 + PROD-001/005/011
- #16 Deploy hardening (4 items): PROD-002/003/004 + QUAL-001
- #18 QA infrastructure bootstrap (3 items): QUAL-002/009/012
- #17 Cert + infra visibility (5 items): PROD-007/008/021 + DOC-003/004

**Tier 2: high-ROI cleanup** (~15 hours, ~28 findings):
- #2 Observability persistence migration (5 items): BILL-002 + ADM-002/005 + COST-003 + PIPE-016
- #3 URL safety bundle (4 items): BOT-001/002 + SEC-006 + BILL-001
- #11 A11y compliance sprint (7 items): UX-002/006/012/013/017 + CAT-001/008
- #13 Standardized error visibility (5 items): ADM-001 + UX-001 + BOT-003/020 + PROD-006
- #19 Dead code cleanup pass (7 items): QUAL-005/006/007/011/013 + SD-14/23

**Tier 3: scaling prep** (~12h, ~19 findings): bot resilience #15, rate-limit #8, housekeeping #6, DB constraints #10

**Tier 4: polish** (~11h, ~28 findings): sqliteCutoff #5, db.transaction #4, /api/scan triple #7, hover preview #9, theme sync #12, i18n strict #14, README+DEPLOY doc PR #20

**All 4 tiers**: ~50 hours work-days, closes **~95 findings (~33% of all 291)**. Remaining 196 findings — isolated low/info polish + verified-safe baseline.

**Spec drift 23 items — resolution breakdown**:
- 15 items resolvable purely through SESSION_CONTEXT / WORKLOG edits — **Stage 12 sync-pass ~2-3 hours single session**
- 5 items need paired code + doc fix — bundled с existing backlog targets
- 3 items pure code fixes (pause persist, nginx commit, CSS comment) — quick PRs

**Verified safe Stage 12** (25 items): CLAUDE.md accurate · AGENT_RULES.md 7 sections solid · SESSION_CONTEXT size 557 lines on-target · cross-references all valid · DEPLOY.md happy-path comprehensive · DEPLOY.md examples accurate · .env.example 100% documented (53 keys) · package.json description accurate · package.json license set (ISC) · WORKLOG format consistency across 20 entries · WORKLOG_ARCHIVE properly formatted · Superpowers naming 100% compliant · Plans→Specs cross-links 5/5 · 3/4 specs fully implemented · docs/audit naming 100% compliant · cross-audit references resolve · SD-9 backup docs accurate (drift is code) · SD-10 retention accurate · SD-14 R4 emoji partial documented · SD-16 pause docs accurate · SD-17 caching docs accurate · SD-20 HOT_REFRESH in SESSION_CONTEXT · 0 broken cross-refs.

**Lessons learned (от 12-стейдж серии)**:
1. **Hybrid strategy «audit all then fix» was correct** — 50+ cross-audit overlap pairs discovered, ~33% findings закрываются через bundles.
2. **Critical findings концентрированы в defensive infrastructure** — 5 critical all в 2 areas (backup + SPA validators), не в application logic.
3. **8 of 12 stages clean (0 critical)** — production posture fundamentally solid.
4. **Verified safe sections** (~500+ items) — foundation для next-year audit.
5. **Severity calibration drift** — early stages over-severity, mid-stages calibrated.
6. **Spec drift accumulates faster than code** — 15 of 23 pure doc-side; need periodic sync-pass.
7. **Inline React SPA monolith** — blocks team scaling, must fix before > solo.
8. **Haiku-агенты consistently effective** — 70-80% of grep work.
9. **Documentation surface inversely correlated с quality** — smaller doc = easier accurate.
10. **SPA-trap defensive code emerged** but never integrated — common «built defense, not integrated defense» pattern.

**Деплой/проверка**: не деплоил. Не коммитил. Не ходил на прод.

**Риски/заметки финальные**:
- **WORKLOG ротация overdue** (DOC-013) — 21 entries now (20 was over, + Stage 12 final = 21). Per AGENT_RULES §6 — rotate entries 13-21 (R-development pre-audit-series + Stage 12) к ARCHIVE. Keep 12 active (audit stages 1-11 + final). Operator decides timing. Mechanical 10-min copy-paste.
- **DOC-001 README** — самый низковисящий high. ~30 min create. Closes public surface gap.
- **Tier 1 PR sequence** — рекомендуется в порядке: backup rewrite (#1, 4h, all 4 critical resolved) → deploy hardening (#16, 2h, SPA-trap prevention) → QA infra (#18, 3h, foundation) → cert+infra visibility (#17, 3h, includes DEPLOY.md missing sections). **Day 1 = 6h closes 12 finding's + RED → GREEN на DB layer**.
- **Stage 12 sync-pass** — отдельная 2-3 hour session SESSION_CONTEXT update. Closes 15 SD items одной серией. Restore §7 compliance (remove 30+ date-stamped narratives из Tag refresh + Scoring sections).
- **Audit series stage prompts** in `docs/audit/PROMPT-stage-*.txt` — historical artifact, operator може удалить после finalize если не нужны.
- **One subagent (sprite delivery) Stage 10 — partial gap** — covered through manual sample reads. Lesson noted для future audit: «return findings, не суб-делегируй» в haiku prompts.
- **Series-wide cost estimate**: ~50-60 hours total agent + operator time. Cheaper than one major production incident.
- **Post-fix re-audit**: через 3-6 months single-stage smoke pass, не full 12-stage series. Focus areas: backups verified (DR drill), monitoring coverage, новые features added.

**Series COMPLETE**. Operator review pending для INDEX.md → choose Tier 1 first PR.

---

## 2026-06-01 · opus · Code quality sweep (этап 11/12)

**Цель**: одиннадцатый чекап — качество кода: SPA-trap protection enforcement, dead code, comment drift после R1-R7 sweep'ов, file/function size health, error handling, magic numbers, naming inconsistencies, lint/test coverage. Только review, не правил, не коммитил.

**Scope (13 направлений)**: SPA-trap validators + lint + tests · dead code inventory · comment drift map · server.js монолит health · error handling patterns · magic numbers · naming consistency · file/function size · imports/module hygiene · lint/format coverage · test coverage · logging patterns · cross-audit reverse traces.

**Out of scope**: все previous этапы (1-10) done · документация / SESSION_CONTEXT final sync-pass / WORKLOG ротация — Stage 12 · architectural refactoring (split server.js + bundler) — flagged but не in audit scope.

**Метод**: 5 параллельных haiku-агентов (SPA validators+lint+tests, dead code inventory, comment drift map, file+function size+monolith, naming+magic numbers+i18n unused) + ручная sample-проверка (`scripts/check-*-spa.cjs`, `package.json`, eslint/prettier glob). Все 5 без retry. Не запускал реально lint / format / tests.

**Файлы**:
- `docs/audit/2026-06-01-code-quality.md` — новый, полный отчёт. В начале — File size map (top-10 by lines, dashboard/server.js 13,682 + admin/server.js 7,355 = **52.6% of project**), Function size map (top-10 longest, _buildSPA() 11,828 + _spa() 6,224), Dead code inventory (3 dead functions + 2 dead CSS classes), Comment drift map (1 stale CSS comment, 0 TODO/FIXME markers), Lint/format/test coverage (∅ — zero QA infra).

**Counts**: **1 critical** · **5 high** · 9 medium · 5 low · 4 info · **24 total** + 1 новый spec drift (накопительно 23) + расширенный «one-fix-many-wins» backlog до 19 targets.

**Top-3 worst**:
1. **QUAL-001 CRITICAL** — **SPA validators dead в infrastructure**. `scripts/check-{dashboard,admin}-spa.cjs` existует (50 + 64 LOC each, call _buildSPA/_spa + vm.Script() catches SyntaxError) но **0 invocation points** — нет в package.json scripts, нет в .husky pre-commit, нет в CI workflows, нет в deploy.ps1/sh. **Cross-confirm PROD-003/004 с code-side angle**: где validators ДОЛЖНЫ быть вызваны. Backtick trap fired 3 раза за неделю по WORKLOG, validators ничего не предотвращают.
2. **QUAL-002 HIGH** — **Zero QA infrastructure**. 0 lint, 0 tests, 0 pre-commit hooks, 0 CI workflows, 0 prettier, `engines.node` not pinned, 0 devDependencies. 2-year project = silent technical debt accumulation. Sustainable for solo operator, **wall for any contributor scaling**.
3. **QUAL-003 + QUAL-004 HIGH (×2)** — server.js (13,682 lines, 34.2% of project) + admin/server.js (7,355 lines, 18.4%). Combined 52.6% of codebase in 2 files. _buildSPA() alone = 82% of dashboard file. Cognitive load + refactor friction + SPA-trap byproduct.

**Прочие high**: QUAL-005 CSS comment line 2636 declares «2 dark themes» (реально 3, pulse default) — stale post-R1.

**Прочие medium (9)**: QUAL-006 dead memeColor()/memeClass()/lifespanLabel() functions (~50-100 LOC), QUAL-007 dead .toolbar / .kbd CSS classes, QUAL-008 magic numbers not centralized (5min auth has 3 different literal forms `5*60*1000` / `5*60_000` / `300_000`), QUAL-009 engines.node not pinned, QUAL-010 _buildSPA()/_spa() longest single functions ~18K LOC combined, QUAL-011 memeColor function/const shadow (bug-prone).

**Technical debt verdict**: **HIGH (~70%)**. Code itself relatively clean for 2-year project (R-cleanups thorough — only 3 dead functions + 2 dead CSS classes ~80 LOC total, 0 TODO/FIXME markers, 0/5 sample files имеют unused imports, 20/20 sample i18n keys used). **Infrastructure debt severe**: no QA tooling, validators unused, monolith blocks refactor.

**Maintainability verdict**: **~40%**. Solo operator OK (operator knows all). Larger team contributing impossible без QA infra. Sustainable for current scale, breaks at scale.

**Cross-audit overlap (расширен до 19 targets)**:

Новые code-quality-уровень:
- **#18 QA infrastructure bootstrap** — QUAL-002 + QUAL-009 + QUAL-012 + install eslint + prettier + husky + lint-staged + GitHub Actions CI = **3 items одним setup PR** (~3 hours). Foundational.
- **#19 Dead code cleanup pass** — QUAL-006 (3 dead funcs) + QUAL-007 (2 dead CSS) + QUAL-011 (shadow) + QUAL-005 (CSS comment drift) + QUAL-013 (cat useEffect drift, SESSION_CONTEXT only) = **5 items одним cleanup PR** (~30 LOC removed + 5 comments fixed). Pre-Stage-12 cleanup.

Расширены existing:
- **#16 Deploy hardening bundle** — +**QUAL-001 (call validators в deploy + pre-commit)** = теперь **4 items одним PR** (PROD-002 + PROD-003 + PROD-004 + QUAL-001).

Если приоритезировать **#16 Deploy hardening (с QUAL-001) + #18 QA infra bootstrap + #19 Dead code cleanup** — **10 finding'ов из 3 этапов** одной серией PR (deploy + QA + cleanup). Foundation для post-Stage-12 development cycles.

**Spec drift (накопительно 23)**: добавился 1 code-quality-уровень:
- **SD-23** CSS theme comment drift (dashboard/server.js:2636-2638 CSS block declares «2 themes», реально 3). Subset of SD-12 theme contract drift, code-side specifically. Fix in QUAL-005.

Stage 12 sync-pass нужно update SESSION_CONTEXT для всех 23 items.

**Verified safe** (28 items, по 13 разделам отчёта): 0 TODO/FIXME/XXX/HACK markers in src/ ✓ · 0 dangerouslySetInnerHTML / eval() callsites ✓ · SOURCE_LOGOS / sort.virality / .analyze-trace+pill / MARKET_STAGE_UI.icon fully removed post-R-cleanups ✓ · 20/20 sample i18n keys used ✓ · 5/5 sample files clean imports ✓ · 8/10 sample CSS classes used ✓ · 10/10 boolean naming (is*/has*/Enabled) consistent ✓ · _prefixed methods semantically private (5/5) ✓ · snake_case (DB) → camelCase (JS) mapping explicit ✓ · ESM in src/ + CJS in scripts/.cjs properly separated ✓ · 8/10 CSS classes used, comments mostly accurate post-R1-R7 (только 1 stale CSS block) ✓ · file-top JSDoc accurate ✓ · toast 3000ms matches ✓ · 5/5 bot commands accurate ✓ · cat pose counts match ✓ · CAT_TIMINGS demonstrates good central registry pattern ✓ · DashboardServer/AdminServer encapsulation ~49/~32 methods ✓ · validators detection logic sound (vm.Script catches SyntaxError) ✓ · `getActivePresetConfig` vs `getEffectivePresetConfigs` vs `getEffective` — different purposes, naming appropriate ✓ · `isTrendSeen` vs `wasNotificationSentToUser` — different abstraction levels ✓ · `recordNotification` sole API ✓ · `_setUserPlan` wraps `upgradePlan` — different abstraction levels ✓ · R-cleanups thorough.

**Деплой/проверка**: не деплоил. Не коммитил. Не запускал реально lint/format/tests.

**Риски/заметки**:
- QUAL-001 critical (validators dead) — самый низковисящий fix: 3 integration points, ~30 LOC. Add `"check:spa"` script в package.json, add `npm run check:spa` в deploy.ps1/sh (backlog #16), optional pre-commit hook. Prevents next backtick trap reaching prod. Cross-overlap PROD-003.
- QUAL-002 (zero QA) — 5-step setup ~3 hours. eslint + prettier + husky + lint-staged + GitHub Actions CI. Backlog #18. Foundation для contributor scaling. Mandatory if team grows.
- QUAL-003/004 (monolith) — long-term architectural. Cannot fix in single PR. Acceptable for current solo ops. Если scale → must.
- QUAL-005 (CSS comment) — 3 lines edit. Include в backlog #19 (dead code cleanup).
- QUAL-006 (3 dead functions + memeColor shadow) — ~80 LOC trivial delete.
- QUAL-008 (magic numbers) — 1 central `src/constants.js` + N callsite updates. ~30 LOC. Future polish.
- Code itself surprisingly clean post R1-R7 churn. Dead code only ~50-100 LOC. Comments mostly accurate (только 1 CSS block stale). R-cleanups были thorough.
- Stage 12 next: WORKLOG ротация (11 entries now + Stage 12 = 12, мы на лимите), SESSION_CONTEXT sync для 23 spec drift items.

---

## 2026-05-31 · opus · Cat mascot R7 deep-dive (этап 10/12)

**Цель**: десятый чекап — behavioral deep-dive R7 cat mascot. FSM corner cases, listener/timer memory safety, sprite delivery, login mount, glow keyframes, positioning, mobile unmount, a11y, prefers-reduced-motion, race conditions. Decorative feature без stakes (data/cost = 0), но самая свежая фича + сложный FSM (5 idle poses + walk-cycle + sleep + reactive forecast). Stage 6 visual-level «matches spec» расширен до behavioral. Только review, не правил.

**Scope (13 направлений)**: FSM corner cases · listener/timer memory safety · localStorage error paths · sprite delivery + cache · speed multipliers + timings · per-state positioning · walking direction + reverse · glow blink sync · login cat mount · event integration · visibility gate · deploy + asset pipeline · a11y.

**Out of scope**: security (1 — sprite endpoint regex re-confirmed safe), pipeline (2), plans (3), cost (4), DB (5), general UX (6 — visual level done, поведенческий уровень здесь), admin UI (7), TG bot (8), production (9 — asset deploy verified), code quality / SPA-trap (11), docs (12).

**Метод**: 4 параллельных haiku-агентов (FSM state-flow + corner cases, listener/timer memory safety, sprite + CSS + positioning + glow, login mount + visibility + a11y) + ручная sample-проверка ключевых точек (sprite handler line 642+ regex, JSX line 13139-13146 a11y attrs, prefers-reduced-motion grep на line 5954, Glob `assets/cats/*.png` для file existence). 3/4 агентов отстрелились clean, 1 (sprite + CSS + positioning) делегировал sub-agents но не consolidated — covered through other 3 agents + manual sample reads. Lesson noted: explicitly tell haiku-агентам «return findings, не суб-делегируй».

**Файлы**:
- `docs/audit/2026-05-31-cat-mascot-r7.md` — новый, полный отчёт. В начале — FSM diagram (ASCII state-graph with все transitions + triggers + sticky states), Listener/timer inventory table (11 useEffects × add/remove/paired/setTimer/clearTimer/notes), Sprite + asset map (9 sprites × frame count × animation × glow keyframe).

**Counts**: 0 critical · **0 high** · 4 medium · 9 low · 7 info · **20 total** + 1 новый spec drift (накопительно 22) + backlog #11 (a11y compliance sprint) расширен до 7 items.

**Top-3 worst (все medium — no critical, no high)**:
1. **CAT-001** `aria-hidden="true"` absent on decorative `.cat-mascot` div (line 13139-13146) — screen reader announces decorative element с no accessible name → AT confusion. 1-line fix, cross-overlap UX-002/006 backlog (a11y compliance sprint #11).
2. **CAT-002** Page Visibility tab-hide during walk — `.cat-paused` class freezes CSS animations, **но state machine setTimeouts continue ticking**. After 30s+ tab hidden → return → visual misalignment (cat «teleports» between sprite frames, transform frozen но state moved on).
3. **CAT-003** Triple-click landed in transitionTo-queued moment — `setStateName('walkingLeft')` (onCatClick) + pending `setStateName(idle)` (from FSM transitionTo) batch — React last-wins, visual stutter possible. Race window ~16ms, rare.

**Прочие medium**:
- **CAT-004** initially flag'нут (resize >100px during walk pending transitionTo не cancelled) → **на верификации downgraded to low / false positive** — React cleanup runs on dep change BEFORE new effect, timer cleared properly via useEffect #11 cleanup line 13130.

**Behavioral robustness verdict**: **~92%**. FSM correctly state-machine'ed (no infinite loops, all transitions have exit conditions, sticky states properly held), race conditions handled via React's setState batching, walk-through cycle chains через transitionTo с per-state cleanup, login pool separate timer от dashboard walk-through.

**Memory safety verdict**: **clean**. ✓ Все 6 activity listeners paired (line 12968-12970 add ↔ line 12974-12976 remove, same options). ✓ All 11 useEffects cleanups run on unmount. ✓ Component unmounts полностью на `isOff=true` (line 13137 `return null`). ✓ No accumulating listeners after N rapid toggle cycles. ✓ All timers stored в closure-captured `let` IDs или useRef, cleared in cleanup.

**Cross-audit overlap (backlog targets — no new, but #11 expanded)**:

**Backlog #11 «a11y compliance sprint»** расширен с 5 items до **7 items**:
- UX-002 focus trap (5 modals + Lightbox)
- UX-006 clickable divs role=button (.top-item, .session-chip)
- UX-012 semantic landmarks (`<main>`, `<nav>`, `<aside>`)
- UX-013 heading hierarchy (h2-h6 на dashboard)
- UX-017 skip link
- **CAT-001 aria-hidden на cat-mascot div** (NEW)
- **CAT-008 prefers-reduced-motion для cat animations** (NEW, extends existing media query line 5954)

Один a11y sprint sweep закрывает 7 finding'ов из 2 этапов одним PR. ~50-80 строк CSS + JSX changes.

CAT-002 + CAT-003 (FSM corner cases) — narrow cat-specific, no overlap with other audits.

**Spec drift (накопительно 22)**: добавился 1 cat-уровень:
- **SD-22** useEffect count drift — SESSION_CONTEXT § «Cat mascot» декларирует **8 useEffects**, реально **11** в коде (post-R7 expansion: split visibility gate в 2 [matchMedia + localStorage], forecast-loading separate from FSM, page visibility separate from resize). SESSION_CONTEXT not updated.

**Verified safe** (35 items, по 13 разделам отчёта): `_handleCatSprite` anchored regex SEC re-confirm, 9/9 sprite PNG present (Glob verified), all 11 useEffects listener pairs properly add/remove same named handler refs, all timer cleanups via closure-captured IDs OR re-dep cycle, 6 activity listeners passive/default correctly paired, inactivity timer clears+rearms on activity (line 12934-12935), rapid toggle leak test clean (component unmounts полностью), FSM transitions chained via transitionTo с per-state cleanup, forecastWatching priority > sleep verified, inactivity differentiates idleHeadUp→idleHeadUpAsleep vs other idle→idleSleeping, walk-through scheduler only from idle (line 12857), login pose cycle separate 60s timer (line 12872-12883), login `<CatMascot route="login">` mount LoginScreen card line 12530 без UI overlap, login → dashboard transition clean re-mount, matchMedia modern API (`addEventListener`), localStorage try/catch на errors, triple-click flee guards (`isIdlePose` + `!isLoginRoute`), 1500ms window, `cursor: default` (Easter-egg hidden), `pointer-events: none` base / dashboard override `auto`, HOME_X_PX=97 used, login paw dangle `bottom: calc(100% - 10px)`, login speed multipliers +10%/+30%, `.cat-paused` class on visibility hide, CAT_TIMINGS complete 11 values, resize threshold 100px intentional anti-jitter, deploy.ps1 EvilCatPack EXCLUDE Stage 9 confirm, no infinite loops в FSM, idleHeadUp glow removed intentional, 6 glow keyframes present.

**Деплой/проверка**: не деплоил. Не коммитил. Cat mascot — pixel-art decorative, не functional code path.

**Риски/заметки**:
- CAT-001 (aria-hidden) — самый низковисящий fix, 1 line. Включи в a11y compliance sprint (backlog #11) — закрывает 7 items одним PR.
- CAT-002 (Page Visibility race) — реальная visual edge case, но frequency low (требует tab-switch mid-walk + длительное hidden). Если фиксить — clearTimeout всех state-flow timers на visibilitychange hide, requeue on visible. ~15 строк. Optional polish.
- CAT-003 (triple-click race) — теоретическая 16ms window race. В practice — synthetic, юзер не precision-timed. Можно skip.
- CAT-004 initially flagged but downgraded — React useEffect cleanup runs BEFORE new effect on dep change. Timer cleared properly.
- CAT-008 (prefers-reduced-motion) — extends existing media query at line 5954 (для feed-panel-refresh). Same pattern что `.cat-paused` class (line 4169-4173). ~5 lines CSS.
- SESSION_CONTEXT sync (final pass Stage 12) — accumulated 22 spec drift items now. Sprawling enough для dedicated polish session: theme drift (SD-12), breakpoint cascade (SD-13), R4 emoji sweep (SD-14), Section primitive adoption (SD-15), pause persistence (SD-16), bot username caching (SD-17), bot commands inventory (SD-18), nginx config out of git (SD-19), HOT_REFRESH_LIGHT_* env (SD-20), backup script name (SD-21), useEffect count (SD-22).
- Один subagent (sprite delivery + CSS) делегировал sub-agents но не consolidated. Lesson learned: explicitly tell haiku-agents «return findings, не sub-delegate». Manual sample reads filled gap.

**Sprite agent partial gap** (covered manually): cache-bust strategy `_catSpritesVersion` (max-mtime) verified by reading line 642+, 9/9 PNG files present (Glob verified), 6 glow keyframes confirmed via cross-references from FSM/listener agents, `prefers-reduced-motion` exists in codebase line 5954 (для feed-panel only — extension needed для cat-mascot).

---

## 2026-05-30 · opus · Production posture audit (этап 9/12)

**Цель**: девятый чекап — production-side infrastructure: graceful shutdown, Docker hygiene, deploy procedure, env validation, secrets, observability, disaster recovery, monitoring. Многое живёт на проде (не в репо) — flag'аем gaps между declared spec и verifiable repo state. Только review, ничего не правил, не коммитил, не ходил на прод.

**Scope (12 направлений)**: graceful shutdown + signals + Docker init / Docker hygiene / nginx + backup config в репо / env validation + secrets / deploy.ps1+sh integrity / observability + monitoring / operational readiness + DR.

**Out of scope**: app security (1 done, TRUST_PROXY prod confirm здесь), pipeline (2), billing (3), cost (4 — USD logging confirm), DB schema (5 — backup integrity cross-confirm), dashboard UX (6), admin UX (7 — maintenance gap cross-confirm), TG bot (8 — admin crash alert cross-confirm), cat mascot (10), code quality (11), docs (12).

**Метод**: 4 параллельных haiku-агентов (graceful shutdown + Docker, deploy/backup/nginx in-repo, env validation + secrets, observability + monitoring) + чтение SESSION_CONTEXT § «Production posture» (lines 740-827). Без SSH на прод, без curl на public URL, без external cert checker'ов. Статический code review + spec analysis + repo grep. Все 4 агента без retry.

**Файлы**:
- `docs/audit/2026-05-30-production-posture.md` — новый, полный отчёт. В начале — Infrastructure inventory (22 components × declared / in-repo / verifiable), Configuration drift map (13 items × spec vs reality), Operational readiness assessment (19 ops × supported / documented / tested / has alerting).

**Counts**: 0 critical · **9 high** · 13 medium · 5 low · 5 info · **32 total** + 3 новых spec drift (накопительно 21) + расширенный «one-fix-many-wins» backlog до 17 targets.

**Top-3 worst (все high)**:
1. **PROD-001 + PROD-005 + PROD-011 trifecta** — backup contract drift confirmation (scripts/backup.sh = `cp` stub в dev path + не в cron + script name mismatch с `/usr/local/bin/catalyst-backup.sh` + no restore procedure в DEPLOY.md). Cross-confirm DB-001/002/003/004 (которые уже critical в DB audit). Real catastrophic risk — VPS dies, recovery time = unknown.
2. **PROD-003 + PROD-004 combined** — no pre-deploy checks (check-spa.cjs validators существуют но NEVER called) + no rollback (no backup-before-deploy, no image version tag). Один broken deploy (SPA backtick) = service down без quick revert.
3. **PROD-008** — cert renewal has NO expiry alerting. certbot.timer assumed auto-renew, если silently fails → HTTPS dies через 90d. Operator узнаёт от user complaint OR when сам зашёл.

**Прочие high (6)**:
- **PROD-002** deploy.sh drift vs deploy.ps1 (missing ServerAlive options + missing EvilCatPack EXCLUDE).
- **PROD-006** NO external error tracking (Sentry) + NO admin TG crash alerts → silent crashes, process zombie до Docker healthcheck восстановит.
- **PROD-007** nginx config NOT в репо — spec drift unverifiable (single source of truth lives outside git, 8 spec properties cannot be validated).
- **PROD-009** TRUST_PROXY declared but NOT implemented (SEC-003 prod confirm) — rate-limits фактически global per nginx single-IP, не per-user.

**Прочие medium (13)**: PROD-010 status.sh hardcoded port mismatch, PROD-012 no external uptime monitor, PROD-013 no Prometheus metrics endpoint, PROD-014 no external log shipping, PROD-015 LOG_LEVEL not tied to NODE_ENV (debug может leak в prod), PROD-016 uncaughtException handler log-only no process.exit (zombie risk), PROD-017 DASHBOARD_API_KEY decorative (SEC-007 confirm), PROD-018 HOT_REFRESH_LIGHT_* not в .env.example, PROD-019 disk guard reactive 15m no predictive alert, PROD-020 cost logged в tokens не USD (COST-009 confirm), PROD-021 secret rotation undocumented, PROD-022 setup_remote.sh fails ungraceful если .env missing.

**Operational readiness verdict**: **~55%**. Container infrastructure baseline solid (~85%), graceful shutdown production-grade (~90%), env validation hard-fail ✓. Слабо: deploy hygiene (~50%), backup integrity (~10%), disaster recovery (~0%), observability (~30%). Sustainable for current scale, has serious gaps for incident response / scaling.

**Cross-audit overlap (расширен до 17 targets)**:

Новые prod-уровень:
- **#16 Deploy hardening bundle** — PROD-002 + PROD-003 + PROD-004 = sync deploy.sh с .ps1 + add SPA validators pre-deploy + add backup-before-deploy + image version tagging + `--rollback` flag = **3 items одним PR**.
- **#17 Cert + infrastructure visibility bundle** — PROD-007 + PROD-008 + PROD-021 = commit nginx config в repo + cert expiry monitor + secret rotation SOP = **3 items одним sweep'ом**.

Расширены existing:
- **#1 Backup integrity rewrite** — +PROD-001 + PROD-005 + PROD-011 + SD-21 = теперь **8 items** (включая prod-side: commit catalyst-backup.sh в repo, document restore procedure, integrate в cron, B2 rclone impl).
- **#13 Standardized error visibility** — +PROD-006 (Sentry + admin TG crash alerts) = **5 items** (ADM-001 + UX-001 + BOT-003 + BOT-020 + PROD-006).
- **#6 Housekeeping schedule** — +PROD-019 (disk guard predictive + admin UI exposure) = **7 items**.

Prod-specific overlap:
- **PROD-001/005/011** ↔ DB-001/002/003/004 = #1 backup-rewrite (теперь 8 items).
- **PROD-006** ↔ ADM-001 + UX-001 + BOT-020 = #13 standardized error visibility.
- **PROD-008** — narrow fix, не overlap.
- **PROD-009** = SEC-003 prod confirm.
- **PROD-019** ↔ ADM-004 (maintenance gap) = #6 extension.
- **PROD-020** = COST-009 prod confirm.

Если приоритезировать **backup-rewrite (#1, 8 items) + deploy-hardening (#16, 3 items) + cert+infra visibility (#17, 3 items) + standardized error visibility (#13, 5 items)** = **~19 finding'ов из 9 этапов** одной серией PR. Самый высокий ROI cluster from cross-audit work.

**Spec drift (накопительно 21)**: добавились 3 prod-уровень:
- **SD-19** nginx config not in version control (8 spec properties unverifiable).
- **SD-20** HOT_REFRESH_LIGHT_* env keys used in code but not в .env.example.
- **SD-21** Backup script name mismatch (`scripts/backup.sh` ≠ `/usr/local/bin/catalyst-backup.sh`).

**Verified safe** (по 12 разделам отчёта, 32 items): graceful shutdown trifecta (SIGTERM/INT handlers + re-entry guard + 15s hard-cap + Promise.allSettled), dashboard.stop Promise SSE drain + closeAllConnections, admin.stop simpler drain, **Docker tini ENTRYPOINT** (PID 1 fix решён), multistage build, USER node non-root, port 127.0.0.1 loopback, healthcheck wired Docker, restart always, resource limits (CPU 1, mem 1G), named volumes (catalyst_data + catalyst_logs), custom bridge network, log driver max-size 50m max-file 5, NODE_OPTIONS=--max-old-space-size=1024, AbortController на LLM calls, DB single-SQLite sync safety, hard-fail env validation 3 critical keys в production, .env.example 100% documented (53 keys), code/env sync (no orphans), .gitignore covers .env+data+logs+node_modules, .dockerignore comprehensive, SUPPORT_BOT_TOKEN graceful disable verified, PII masking 11 maskId callsites, structured JSON logger, **disk space guard PRESENT** (runStorageGuard 15m interval, cleanup 7d alerts + log purge — mitigates часть DB-014), healthcheck endpoints, uncaughtException handlers present (нужно process.exit fix), DEPLOY.md 341 lines comprehensive, migration runner idempotent via PRAGMA table_info, deploy.ps1 ServerAlive options + EvilCatPack EXCLUDE (R7 fixes hold), check-spa.cjs validators exist (нужно invoke в deploy).

**Action items для operator (SSH-required, outside agent scope)**: 11 items в отчёте — verify nginx config matches spec, certbot.timer status, prod backup script content, B2 bucket existence, ufw rules, sshd config, cleanup zombie /root/Narrative-Parser/, external cert expiry check, UptimeRobot signup.

**Деплой/проверка**: не деплоил. Не коммитил. Не ходил на прод (no SSH, no curl public URL, no external cert checker).

**Риски/заметки**:
- PROD-001/005/011 (backup) overlap DB-001..004 → backlog #1 теперь **8 items** одной серией PR закрывает 5 этапов worth of backup integrity concerns. Priority №1.
- PROD-003 (no pre-deploy checks) — самый низковисящий high. `check-*-spa.cjs` already exist, просто add call в deploy.ps1/sh. ~5 строк per script.
- PROD-007 (nginx config not in repo) — большая operational gap. Commit prod nginx config в `infra/nginx/catalyst.conf` + DEPLOY.md note «source of truth — repo». ~150 строк config + docs.
- PROD-008 (cert expiry no alert) — cron monitor `scripts/check-cert-expiry.sh` daily (~20 lines bash) ИЛИ UptimeRobot external (free tier supports cert checking). Simple operational win.
- PROD-009 = SEC-003 prod confirmation. Backlog не extended (single TRUST_PROXY fix покрывает SEC-003 + auth IP rate-limit), но noting cross-confirm для completeness.
- PROD-019 (disk guard PRESENT) — discovered хорошее. Already mitigates часть DB-014 (log rotation). Closing gap admin UI exposure (ADM-004) — future polish.
- Один subagent (env validation) занял 65 min — outlier. Sonnet better for multi-file consistency checks. Lesson re-confirmed.

---

## 2026-05-29 · opus · TG bot + notifications audit (этап 8/12)

**Цель**: восьмой чекап — Telegram main bot (`src/notifications/telegram.js` ~2390 lines), alert dispatcher, formatter, support bot, broadcast pipeline. Команды, доставка, HTML формат, multi-user dispatch, fail handling, plan checks, message-level UX. Только review, ничего не правил, не коммитил, не дёргал real TG API.

**Scope (13 направлений)**: alert delivery end-to-end / formatter HTML escape + corrupt risk / commands + plan gating / inline keyboards + Ask Grok URL / broadcast + support bot / reason wizard + bot i18n / bot inventory + failure modes / + cross-bot Ask Grok sync verification.

**Out of scope**: security (1 — verified safe, token contained), pipeline correctness (2 — PIPE-006 cross-confirmed), billing (3), cost (4 — broadcast throttling cross-checked), DB (5 — notifications UNIQUE+retention overlap), dashboard UX (6), admin panel (7 — BotPage cross-checked), production (9), cat mascot (10), code quality (11), docs (12).

**Метод**: 6 параллельных haiku-агентов (delivery dispatcher, formatter HTML escape, commands + gating, inline keyboards + Ask Grok, broadcast + support bot, bot i18n) + ручная верификация ключевых точек (escHtml 3-char gap line 242-245 + trend.url unescaped line 145, broadcast 50ms loop line 775, support bot _ensureTopic + _creatingTopic coalescing). Все 6 отстрелились без retry. Один agent (inline keyboards + Ask Grok cross-file compare) занял 17 min — sonnet был бы быстрее.

**Файлы**:
- `docs/audit/2026-05-29-tg-bot-notifications.md` — новый, полный отчёт. В начале — Command matrix (10 commands + 4 missing), Alert delivery flow diagram (full path с failure branches), Bot inventory table (main vs support: tokens, chats, state, polling/webhook, privacy mode, graceful disable).

**Counts**: 0 critical · **8 high** · 12 medium · 5 low · 6 info · **31 total** + 2 новых spec drift (накопительно 18) + расширенный «one-fix-many-wins» backlog до 15 targets.

**Top-3 worst (все high)**:
1. **BOT-001 + BOT-002 combined** — `trend.url` НЕ escape'ится attribute в `<a href="${trend.url}">` (line 145 formatter.js, `escHtml` covers only `&`/`<`/`>` not `"`/`'`) + НЕТ protocol whitelist (`javascript:` URLs possible). HTML structure injection + cross-context XSS (clipboard paste в browser console). Single fix covers both (safeHref + escHtmlAttr helpers). Cross-overlap с SEC-006 (dashboard equivalent).
2. **BOT-005** Per-user dispatch loop crash isolation отсутствует — outer `for (user of activeUsers)` без try/catch. `user.disabled_sources` JSON.parse throw → cascade failure для ВСЕХ remaining users в batch. **Silent systematic delivery failure** — ни decisions buffer, ни alert. Test: corrupt 1 row, lose 50 alerts/cycle.
3. **BOT-003** Plain text > 4096 chars silent TG 400 drop — caption mode правильно split'ит к 1024, но plain text-only branch НЕ truncate'ит. Длинные `whyNow + aiExplanation + triggerText` (RU expansion 30%+) могут regular hit. Alert dropped, decision 'send_failed' без 'truncation' гипотезы.

**Прочие high (5)**:
- **BOT-004** НЕТ TG `language_code` auto-detect на /start → RU users default get EN welcome. Major onboarding regression для RU-first product.
- **BOT-006** НЕТ 429 / retry-after honored — failed sends просто dropped, no requeue. Peak load (massive broadcast + concurrent scan) → wave of drops.
- **BOT-007** Broadcast 403/blocked НЕ записывается в `users.bot_blocked` → каждый broadcast hammer'ит same dead chats. Лимиты впустую, метрики искажены. Alert dispatcher правильно ставит `status='suspended'`, broadcast — нет.
- **BOT-008** Ask Grok URL length unchecked (~8KB grok.com limit) → Cyrillic prompts at long titles + 6-point block могут exceed → URL truncated → broken prompt to Grok. Sync fix нужен и в dashboard (14.05/16.05 invariant).

**Прочие medium (12)**: BOT-009 notifications anti-dupe race (PIPE-006/DB-007 confirm), BOT-010 8 hardcoded EN/RU inline strings (login flow + /analyze help + rate-limit toast + source locked × 2 duplicates), BOT-011/12/13 missing /help /stop /forecast commands, BOT-014/15 bot username caching no TTL + SPA template race, BOT-016 broadcast edit/delete > 48h silently fail, BOT-017 broadcast atomicity on crash (no status column), BOT-018 support bot full chat_id в topic header HTML (ADM-016 cross-overlap).

**Bot delivery posture verdict**: **~70%**. Sustainable для текущего scale (5-50 users, low frequency broadcasts). При scale (200+ users) или peak load — BOT-005+006+007 cascade fails станут frequent. Перед scaling — обязательно «bot resilience bundle» fix.

**Cross-audit overlap (расширен до 15 targets)**:

Новые «one-fix-many-wins» targets:
- **#14 URL safety bundle** — `safeHref()` + protocol whitelist + escHtmlAttr → **SEC-006 + BOT-001 + BOT-002 + dashboard `<a>` callsites** = 4 items одним helper'ом (apply в dashboard + formatter line 145).
- **#15 Bot resilience bundle** — per-user dispatch try/catch (BOT-005) + 429 retry-after (BOT-006) + broadcast 403→bot_blocked (BOT-007) + shared token bucket (BOT-021) = **4 finding'ов в один «bot infrastructure hardening» PR**.

Также extended existing targets:
- **#2 notifications migration** — +BOT-009 = 5 items (PIPE-006 + COST-016 + DB-007 + DB-008 + BOT-009 — single UNIQUE migration covers all anti-dupe + retention concerns).
- **#13 Standardized error banner / state** — +BOT-003 silent drop visibility (общая «silent failure observability» pattern).

Bot-specific overlap:
- **BOT-001 + BOT-002 (URL safety)** ↔ SEC-006 (dashboard `<a href>` без safeHref) — common fix через #14.
- **BOT-018 (support bot chat_id)** ↔ ADM-016 (admin UI chat_id) — common «PII masking sweep».
- **BOT-014 + BOT-015 (bot username caching)** = SD-17.
- **BOT-008 (Ask Grok URL length)** — bot side, нужен dashboard cross-fix (sync invariant).
- **BOT-009** = PIPE-006 + DB-007 admin angle confirm.

Если приоритезировать **URL safety bundle (#14) + bot resilience bundle (#15) + notifications migration (#2) + admin observability migration (#12)** — закроется ~17 finding'ов из 8 этапов одной серией PR.

**Spec drift (накопительно 18)**: добавились 2 bot-уровень:
- **SD-17** getBotUsername caching без TTL/refresh + SPA template race (SESSION_CONTEXT декларирует cached в this._botUsername — реально `_cachedBotUsername`, не pre-populated на boot, не refreshable). BOT-014 + BOT-015.
- **SD-18** Bot commands inventory drift — SESSION_CONTEXT упоминает /forecast как command в casual context, реально только inline button. /help /stop /pause НЕ существуют. BOT-011/12/13.

**Verified safe** (30 items, по 13 разделам): escHtml для 3 key chars правильно applied (whyNow/aiExplanation/title/sources/category/sentiment), HTML-only mode (нет MD/HTML mix), i18n RU/EN parity 100% (72+ unique keys both files), Ask Grok 6-point prompt identical bot ↔ dashboard (14.05+16.05 hold up), encodeURIComponent for Cyrillic, fetchFile token contained (SEC re-confirm), plan-aware buttons + upsell через getPlanEntitlements SoT, photo 404 fallback (video→photo→text), 403 → suspended в alert dispatcher, reason wizard FSM 5min + /skip + per-key i18n, /menu plan-aware status badges (live source count + threshold + days remaining + paused dot), bare URL silent-ignore for free (line 304), /analyze cap check после cache lookup (proper sequence), Catalyst forecast claim race (DB-level atomic lock line 1866), _renderTriggerMessage handles missing/empty sections, support bot graceful disable, _creatingTopic promise coalescing (concurrent first-msg → single topic), copyMessage без 'Forwarded from', reverse path message_thread_id → support_threads → copyMessage user, _resolveLang fallback chain (users.language → from.language_code → 'en'), lang sync dashboard→bot immediate via DB, broadcast pinned tracking (unpin previous + pin new + update pointer), broadcast per-delivery row in broadcast_deliveries, broadcast active status filter (paused users skipped), callback_data format short under 64 bytes, maskId(chat_id) consistently в logs, attachXButton → attachAlertButtons alias, decisions buffer write at all 4 points (gate fail / send success / send fail / queue full), per-user alert count incremented only on send success, 30s anti-dupe cooldown rolling 24h window.

**Деплой/проверка**: не деплоил. Не коммитил. Не дёргал TG API.

**Риски/заметки**:
- BOT-005 (per-user crash isolation) — 5-line fix (wrap user loop body try/catch + log + continue). Самый низковисящий high — закрывает silent systematic failure mode.
- BOT-001 + BOT-002 — one helper (safeHref) применить в 2 callsites (dashboard + formatter:145). Не критично сейчас (collectors controlled), но defense-in-depth для adversarial sources / future ingestion.
- BOT-003 (length truncation) — нужна tag-safe truncation (закрытие открытых тегов). ~30 строк logic. Alternative: split into multiple messages (более сложно).
- BOT-004 (TG language_code) — 5 строк fix в /start, прямой UX win для RU users.
- BOT-008 (Ask Grok URL) — нужно sync fix bot + dashboard (invariant). Short-prompt fallback OR field truncation. Test cyrillic real cases.
- One subagent (inline keyboards + Ask Grok cross-file compare) занял 17 min — outlier vs других 60-100s. Sonnet был бы быстрее для cross-file tasks. Lesson noted.
- broadcasts.failed_count накапливается без bot_blocked flag → BOT-007 fix необходим перед scaling.
- BOT-009 (anti-dupe race) — single UNIQUE migration в backlog #2 closes 5 finding'ов (PIPE-006 + COST-016 + DB-007 + DB-008 + BOT-009).

---

## 2026-05-28 · opus · Admin panel functionality audit (этап 7/12)

**Цель**: седьмой чекап — функциональность admin SPA (`src/admin/server.js`, ~265K chars, 127.0.0.1:8081, Bearer ADMIN_API_KEY). Реально ли работают 10 табов, корректно ли отображают prod state, имеют feedback, completeness operational tools. Только review, ничего не правил, не коммитил.

**Scope (13 направлений)**: tab matrix (10 tabs) / 3-layer merge UI accuracy / UsersPage + plan grant/revoke / DecisionsPage / Pause + Force-Scan + StatusBar + live nav indicators / Bot tab (3 sub-tabs) + ExamplesPage + SubmitPage + Maintenance / primitives consistency + theme + i18n / operational completeness assessment.

**Out of scope**: admin auth (этап 1 verified safe), pipeline correctness (2 — PIPE-001 cross-checked), billing (3 — BILL-002+006 admin angle расширен), cost (4), DB (5), dashboard UX (6 — comparison reference), TG delivery (8), nginx/backup (9), cat mascot (10), code quality / SPA-trap / Section adoption (11), docs (12).

**Метод**: 5 параллельных haiku-агентов на code analysis (tab matrix + endpoints, 3-layer merge + presets UI, Users + Decisions, Pause/Scan/StatusBar/indicators, Bot/Examples/Submit/Maintenance) + ручная верификация ключевых точек (wipeManualAll line 6529 без confirm, restoreHardcoded line 6540 с confirm + String.fromCharCode(10), admin auth line 930, getEffective 3-layer line 6455). Все 5 агентов отстрелились без retry — explicit Read/Grep инструкция работает consistently.

**Файлы**:
- `docs/audit/2026-05-28-admin-panel.md` — новый, полный отчёт. В начале — Tab matrix (10 tabs + StatusBar × component/endpoint/loading/error/empty/main affordance/operational completeness), Primitives consistency section (.adm-* namespace usage, Section adoption = 0), Operational completeness assessment table (operator wants X — can he? Y/N/partial).

**Counts**: 0 critical · **6 high** · 12 medium · 6 low · 6 info · **30 total** + 2 новых spec drift (накопительно 16) + расширенный «one-fix-many-wins» backlog до 13 targets.

**Top-3 worst (все high)**:
1. **ADM-001** 3 silent error states (StatsPage / DecisionsPage / StatusBar) — operator во время incident видит stale data или ничего (StatusBar literally returns null on 5xx). Hide'ит реальный outage. Pattern одинаков с UX-001 (dashboard Feed silent error).
2. **ADM-002** DecisionsPage buffer in-memory (500 cap, restart-reset) — debugging history теряется именно когда нужнее (после restart для deploy fix). Single deploy = всё лог evaporates. 500-cap покрывает ~12-25h в лучшем случае.
3. **ADM-007** **Pause state не persisted в DB** — `appState.paused = false` в constructor default. Restart Docker/deploy/process crash → auto-resumes scanning. **Критический incident response failure mode**: оператор pause для incident → deploys fix → scanner auto-resumes → продолжает то поведение что вызвало incident.

**Прочие high**:
- **ADM-003** Wipe manual button БЕЗ confirm dialog + ghost color — одно accidental click + Save = manual слой обнулён. Сравни с Restore hardcoded (line 6540) — там confirm есть. Inconsistency между двумя destructive ops в одной панели.
- **ADM-004** Maintenance gap — только cleanup alerts. NO VACUUM / NO log rotation / NO video cache trigger / NO auth_sessions cleanup / NO backup status / NO DB size / NO re-index. Все housekeeping = manual через SSH+sqlite3. Admin был призван это заменить.
- **ADM-005** Plan grant/revoke без atomic + без audit log (BILL-002+006 admin UI angle) — admin не может ответить «кто/когда/кому grant'нул pro». Compromised admin token = тихие grants без traceability.
- **ADM-006** No Page Visibility API на polls — StatusBar 2.5s + nav 12s = ~49K req/day когда tab idle в фоне.

**Прочие medium (12)**: ADM-008 UsersPage no pagination (LIMIT 200), ADM-009 BotPage sub-tab не persisted (resets to 'ai' on reload), ADM-010 broadcast без preview/test-send/recipient count confirm, ADM-011 SubmitPage без cache-hit / cost indicator, ADM-012/13/14 missing loading skeletons (PresetConfigs, Examples) + missing empty (Payments), ADM-015 Debug Inspector нет isolated Auto layer (только Defaults/Effective/Draft 3-pane, original 16.05 bug восстанавливается), ADM-016 telegram_chat_id full visible в UsersPage+Payments (no maskId), ADM-017 StatusBar + nav indicators dupe-poll /api/pipeline, ADM-018 Force-Scan timestamp async (PIPE-004 admin UX angle).

**Operational completeness verdict**: **~65%**. Сильно для daily ops (pause/force-scan/plan changes/broadcasts/preset tuning). **Слабо для incident response** — нет backup view, нет DB size, нет per-provider healthcheck, decisions restart-reset, pause не persists. Во время production incident operator лезет через SSH в sqlite3 / docker logs / cat /var/backups — что admin был призван заменить.

**Cross-audit overlap (расширен до 13 targets)**:

Новые «one-fix-many-wins» targets:
- **#12 Admin observability persistence migration** — `alert_decisions` table + `admin_audit_log` table → закрывает ADM-002 + ADM-005 + BILL-002 + COST-003 (4 items одной серией). Общая «persist in-memory observability state to DB» pattern.
- **#13 Standardized error banner / state** — ADM-001 (3 silent pages) + UX-001 (Feed silent) → common error UX pattern, единый `<ErrorBanner>` component reused = 4 items.

Также extended existing targets:
- **#6 Housekeeping schedule** — +ADM-004 (admin UI exposure для same housekeeping = читать last backup time / VACUUM trigger / log rotation status). 6 items total.
- **#7 `/api/scan` admin gate + immediate timestamp** — +ADM-018 (admin UX angle на same async). 4 items total (SEC-001 + PIPE-004 + BILL-003 + ADM-018).

Verified что **admin Force-Scan /api/scan на port 8081 protected** (line 930 auth check) — separate от dashboard /api/scan port 8080 (SEC-001 concern). Не overlapping despite shared path name.

PIPE-001 cross-check — admin DecisionsPage math panel (line 4085-4259) shows **all** failed gates в expanded view, включая обе lipsync + tiktok_quality. Reason chip header показывает first-fail (lipsync), но оператор может развернуть и увидеть оба. Reason aggregation counts всё равно distort'ятся (count'ит только firstFail) — concern remains, severity lower than initially feared.

**Spec drift (накопительно 16)**: добавились 2 admin-уровень:
- **SD-15** Section primitive adoption = 0 (SESSION_CONTEXT декларирует «готов к использованию», в коде 0 callsites — все .adm-card).
- **SD-16** Pause persistence drift (SESSION_CONTEXT не упоминает что pause в-памяти only; operator ожидает persist like disabledCollectors).

**Verified safe** (по 13 разделам отчёта): 47 endpoints all wire-up correctly (нет orphan / missing), admin auth line 930 protects all /api/*, /api/scan (admin port 8081) properly protected, 3-layer merge UI consistent после 16.05 fix (getEffective == getActivePresetConfig), /api/preset-configs response complete (effective + autoOverrides + overrides + tagsLocked + fieldRanges + defaults + presets + groups), Debug Inspector 3-pane present, Per-tag locks Reddit+Twitter+TikTok consistent, Restore hardcoded confirm с String.fromCharCode(10) correct, Per-preset Reset confirm есть, Save flow await server + error handling + persistence, Pause yellow dot indicator working, StatusBar 3 subtitle states + mobile wrap @1100, UsersPage drawer single-row + auto-refresh after grant + revoke confirm, DecisionsPage math panel detailed (Σ positive - Σ penalty, per-signal breakdown, junk + stale + feedback + hard-junk + weights snapshot), 10s auto-refresh, reason chip dynamic aggregation, ExamplesPage full CRUD + sync to Stage 1 via _buildExamplesContext, SubmitPage history persisted in DB, BotPage 3 sub-tabs work, broadcast manage ops (edit/unpin/delete per-broadcast), AI dropdowns + feedback weights controls, TagRefreshPage features (toggle + force + status + history + reset breaker), cleanup alerts ops, primitives namespace isolated.

**Деплой/проверка**: не деплоил. Не коммитил.

**Риски/заметки**:
- ADM-007 (pause persistence) — самый низковисящий critical fix: 5 строк. Persist в DB setting'е `scannerPaused`, constructor reads on boot. Cargo cult от existing `disabledCollectors` pattern.
- ADM-002 (decisions buffer DB-persist) + ADM-005 (audit log table) могут идти одной серией PR с общей миграцией (`admin_audit_log` + `alert_decisions` tables) → закрывают 4 finding'а сразу.
- ADM-001 (3 silent error states) + UX-001 (Feed silent) — common pattern, единый `<ErrorBanner>` component reusable across admin+dashboard. ~30 строк.
- ADM-004 (maintenance gap) большой scope — extend Stats maintenance card до 5-7 buttons (VACUUM, logs rotate, video cache, auth_sessions, backup status widget, DB size widget). ~150 строк + 5-6 endpoints. Высокий ROI для incident response.
- ADM-003 (Wipe manual confirm) — 10 строк fix, prevents accidental data loss. Применить тот же `String.fromCharCode(10)` pattern что Restore hardcoded.
- PIPE-001 admin-UX angle (ADM-024) частично false alarm — math panel показывает all gates. Reason aggregation distortion остаётся минор-концерном.
- Admin auth не пересматривал (Stage 1 verified safe) — re-confirm что line 930 protects all routes including new endpoints если добавляются.
- Operational completeness ~65% — admin предназначен для daily ops, для incident response слабоват. Если приоритезировать ADM-001+002+004+007 — operational completeness sale до ~85% в одной серии.

---

## 2026-05-27 · opus · Dashboard UX/UI audit (этап 6/12)

**Цель**: шестой чекап — целостность UI дашборда после R1-R7 (5+ итераций редизайна за 2 недели). Theme adaptation, R2 radius / R4 iconography compliance, responsive / mobile, a11y, UX-states, modal sheets, toasts, forms, hover preview, cat mascot R7, i18n parity, базовая frontend perf. Только review, ничего не правил, не коммитил.

**⚠️ ВАЖНО**: этот audit вернул **state drift на theme system** (SESSION_CONTEXT декларирует 2 темы, реально 3 с другим default) — следующий developer / agent будет confused. SD-12 — major.

**Scope (13 направлений)**: theme audit / R2 radius + density / R4 iconography sweep / responsive + mobile breakpoints / a11y basics / UX states matrix / modal sheets behavior / forms+inputs / toasts / hover preview / cat mascot R7 / i18n EN↔RU parity / frontend perf basics.

**Out of scope**: admin UI (этап 7), TG delivery (8), nginx/Docker (9), cat mascot deep FSM (10), SPA-trap protection (11), docs (12).

**Метод**: 5 параллельных haiku-агентов на code analysis (CSS/themes, i18n/icons, UX states+a11y, responsive+cat mascot, hover+perf) + sample-проверка топ findings лично (line 7158-7195 для SUPPORTED_THEMES, 9700-9737 + 9858 + 11252 для a11y, 13325-13405 для hardcoded EN strings). Все 5 агентов отстрелились без retry — explicit Read/Grep инструкция в prompt'е помогла.

**Файлы**:
- `docs/audit/2026-05-27-dashboard-ux-ui.md` — новый, полный отчёт. В начале — Component map (15 components × theme/mobile/loading/error/empty/a11y), Theme audit с реальным contract'ом (3 темы, не 2), i18n coverage table.

**Counts**: 0 critical · 5 high · 9 medium · 8 low · 8 info · **30 total** + 3 новых spec drift (накопительно 14) + расширенный «one-fix-many-wins» backlog до 11 targets.

**Top-3 worst (все high)**:
1. **UX-001** Feed error state ПОЛНОСТЬЮ missing — `fetchData` глотает ошибку, на network fail UI silent (либо stale data, либо infinitely loading, либо пустота без объяснения).
2. **UX-002** Focus trap отсутствует во ВСЕХ 4 modals + Lightbox — Tab выходит из модала на background элементы. Keyboard / screen reader a11y broken.
3. **UX-004** **Theme contract drift** — код декларирует 3 темы (`SUPPORTED_THEMES = ['pulse', 'ink', 'tide']`, default pulse), SESSION_CONTEXT декларирует 2 (ink default + tide). Pulse = `:root` baseline без attribute selector. Самый visible UI-уровень drift.

**Прочие high**:
- **UX-003** R4 iconography sweep INCOMPLETE — 11 emoji в i18n strings (⭐⏱⏳⛔❌) + 7 inline JSX emoji (⚠✅⬜) остались. WORKLOG R4 entry mark'нут как complete, но реально нет.
- **UX-005** 4 hardcoded EN error toasts (lines 13336/13348/13383/13404) — `addToast('Hide failed:...', 'error')`. RU юзер видит English только на error path.
- **UX-006** 2 clickable `<div>` без `role=button` / `tabIndex` — `.top-item` (9862, top narratives clickable) и `.session-chip` (11252, stats chip). Tab skip'ает, Enter не работает.

**Прочие medium (9)**: UX-007 threshold slider не plan-aware, UX-008 hardcoded radius 5px/8px вне R2 spec (6 callsites), UX-009 login submit hardcoded `#1d9bf0` (не theme-react), UX-010 Settings/Account sheets без error UI для form submission, UX-011 hover preview silently disabled на mobile (no tap fallback), UX-012 нет `<main>`/`<nav>`/`<aside>` semantic landmarks, UX-013 heading hierarchy missing (только h1 на login, нет h2-h6), UX-014 UX states не верифицированы для TrendList/Live stats/Sources (`⚠ requires runtime verification`), UX-015 32× `transition: all` broad CSS transitions, UX-016 breakpoint cascade `1280/1100/960/900/700/600` не задокументирован.

**Cross-audit overlap (значительно расширен — 11 targets)**:

Новый «one-fix-many-wins» target #11:
- **Focus trap implementation** (UX-002) — single hook applied к 4 modals + Lightbox → 1 fix покрывает all modal a11y.

UI-specific overlap с предыдущими этапами:
- **UX-003 (R4 incomplete)** ↔ WORKLOG R4 entry — declared complete, не финально → один sweep pass.
- **UX-004 (theme drift)** = SD-12.
- **UX-005 + UX-019 + UX-020 + UX-021 (4 hardcoded EN/RU strings)** — общий «i18n strict-mode sweep» → 4 items.
- **UX-002 + UX-006 + UX-012/13 + UX-017 (skip link)** = единый «a11y compliance sprint» → 5 finding'ов одним sweep'ом.

Если приоритезировать **a11y sprint + R4 final pass + theme docs fix** — закрывается ~10 finding'ов одной серией PR.

**Spec drift (накопительно 14)**: добавились 3 новых UI-уровень:
- **SD-12** Theme contract drift (SESSION_CONTEXT 2 темы vs реальность 3 темы) — самый visible UI-уровень.
- **SD-13** Breakpoint cascade not documented (6 breakpoints в коде, в SESSION_CONTEXT упомянут только 700).
- **SD-14** R4 iconography sweep claimed complete (11 + 7 = 18 emoji visible all'еще).

**Verified safe** (по 13 разделам отчёта, не пересматривать в след. этапах): i18n parity 89/89 perfect (нет missing keys, нет empty values), R7 cat mascot полностью matches spec (5 idle poses + login pool + random init + triple-click flee + headup sleep + glow blink + login lying paw + walk-driven pose cycle), 4 modals все с backdrop+scroll-lock+Esc+click-outside+✕, multiple modal stack blocked, search debounce 250ms, FavoriteNoteEditor Cmd-Enter+Esc+autosize, category dropdown opens upward + click-outside + Esc, language switch instant + localStorage persist, hover preview flip-up + 200ms dismiss + per-user toggle + loading/error states + whitelist URLs, stable React keys (по ID не index), native image lazy loading на 16 callsites, passive scroll listeners, single IntersectionObserver с in-flight guard, brand glyphs intentionally non-theme-adaptive, semantic colors константны across themes, no dangerouslySetInnerHTML/eval/Function (re-verified), icon() helper consistency (SOURCE_ICONS/CAT_ICONS/PHASE_DOT все name-strings), R2 hover compliance (nav/filters flat, actions pillowy), random initial cat pose.

**Деплой/проверка**: не деплоил. Не коммитил.

**Риски/заметки**:
- UX-014 (TrendList / Live stats / Sources UX states) — `⚠ requires runtime verification`. 3 sidebar/right-panel компонента не верифицированы. Открой dashboard offline → посмотри что рендерится.
- UX-022 (history.pushState на modals) и UX-023 (toast ✕ button) — теоретические findings, нужна live проверка.
- SD-12 (theme drift) — нужно решить: fix SESSION_CONTEXT под реальность (3 темы) ИЛИ переписать `detectTheme()` под 2 темы по spec. Если переписать код — миграция localStorage `ts_theme === 'pulse'` → `ink` потребуется.
- UX-003 (R4 incomplete) — 11 i18n + 7 JSX emoji. Не приоритет, но обещание «R4 complete» в WORKLOG нужно исправить.
- One subagent сказал "Pulse/Ink/Tide полностью определены" — misleading в части pulse (нет `[data-theme="pulse"]` selector'а — pulse это `:root` baseline). Lesson: для CSS audit'а sample-line-by-line быстрее чем full grep delegate.
- A11y sprint (focus trap + clickable divs + landmarks + skip link + heading hierarchy) — 5 finding'ов за один sweep. Если фиксить — приоритет №1 в UX-backlog.
- UX-001 (Feed error state) — самое user-visible high. 1 ErrorBanner component + try/catch hook → quick fix.

---

