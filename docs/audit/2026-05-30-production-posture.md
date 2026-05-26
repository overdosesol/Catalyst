# Production posture audit — 2026-05-30

**Scope**: девятый из 12 этапов. Фокус — production-side infrastructure: graceful shutdown, Docker hygiene, deploy procedure integrity, env validation, secrets, observability, disaster recovery, monitoring. Многое живёт на проде (nginx config, cron, ufw rules, certbot, B2 bucket) — мы flag'аем gaps между declared (SESSION_CONTEXT) и verifiable (репо). **Не покрыто** (другие этапы): application security (1), pipeline (2), billing (3), cost (4), DB schema (5 — backup integrity cross-confirmed), dashboard UX (6), admin UX (7 — maintenance gap cross-confirmed), TG bot (8 — admin crash alerts cross-confirmed), cat mascot (10), code quality (11), docs (12).

**Method**: 4 параллельных haiku-агентов по 7 направлениям (graceful shutdown + Docker, deploy/backup/nginx in-repo, env validation + secrets, observability) + чтение SESSION_CONTEXT § «Production posture» (lines 740-827). Без SSH на прод, без curl на public URL, без cert checker'ов. Статический code review + spec analysis.

---

## Infrastructure inventory

| Component | Declared in spec | In repo? | Verifiable statically? | Notes |
|---|---|---|---|---|
| **Dockerfile** | yes (catalyst-app container) | ✓ yes | ✓ full | `node:20-alpine`, multistage builder+runtime, `USER node`, `tini` as ENTRYPOINT (PID 1 fix), `NODE_OPTIONS=--max-old-space-size=1024` |
| **docker-compose.yml** | yes | ✓ yes | ✓ full | `restart: always`, healthcheck wired, port `127.0.0.1:8080/8081:` loopback, named volumes, custom bridge network, log driver json-file max-size 50m max-file 5 |
| **.dockerignore** | implicit | ✓ yes | ✓ full | comprehensive — excludes node_modules/data/logs/.env/.git/.claude/ai-context/scripts/EvilCatPack |
| **.gitignore** | implicit | ✓ yes | ✓ full | .env excluded ✓ + data/logs/node_modules — но **NO cert/key glob** (`*.pem`/`*.key`/`*.crt`) |
| **deploy.ps1** (Windows) | yes (deploy.ps1/sh — only path) | ✓ yes | ✓ full | ServerAlive options ✓ (R7), EvilCatPack EXCLUDE ✓, no pre-deploy checks, no rollback |
| **deploy.sh** (Linux) | yes | ✓ yes | ✓ full | **MISSING ServerAlive options** (drift!), **EvilCatPack NOT excluded** (drift!), no pre-deploy checks, no rollback |
| **setup_remote.sh** | implicit (run on VPS by deploy) | ✓ yes | ✓ full | Docker auto-install + cleanup + health check post-deploy curl |
| **DEPLOY.md** | yes (runbook) | ✓ yes (341 lines) | ✓ full | Comprehensive sections but **NO restore procedure**, **NO cert renewal SOP**, partial initial setup |
| **scripts/backup.sh** | declared (sqlite3 .backup + gzip + B2 rclone) | ✓ exists | ✓ full | **STUB** — `cp` not `sqlite3 .backup` (DB-001), no `gzip -t` (DB-002), no rclone B2 (DB-003), uses dev path `.data/` not prod `/var/lib/`, NOT integrated в cron |
| **scripts/check-{admin,dashboard}-spa.cjs** | mentioned in CLAUDE.md | ✓ yes | ✓ full | exist but **NEVER called in deploy.ps1/sh** |
| **scripts/status.sh** | not declared | ✓ yes | ✓ full | dev ops debug — **hardcoded port 7357** mismatch с docker-compose 8080 |
| **scripts/migrate-*.sql** | mentioned indirectly | ✓ yes | ✓ full | one-off file (2026-05-08), stale, не auto-run |
| **`/etc/nginx/sites-available/catalyst`** | yes (full spec) | ✗ **NOT IN REPO** | ⚠ SSH-required | spec declares 8 properties (`proxy_buffering off` / `proxy_read_timeout 24h` / 4 X-headers passthrough / Authorization passthrough / set_real_ip_from / real_ip_header), реальный файл unverifiable от агента |
| **`/usr/local/bin/catalyst-backup.sh`** | yes (full spec) | ✗ NOT IN REPO | ⚠ SSH-required | scripts/backup.sh ≠ catalyst-backup.sh — names не совпадают, probably **two different scripts** (один в репо stub, один на проде «правильный» — но не verifiable) |
| **`/etc/cron.d/catalyst-backup`** | implicit (cron 03:30 UTC) | ✗ NOT IN REPO | ⚠ SSH-required | timezone? logging? `MAILTO=`? — unknown |
| **`certbot.timer`** | yes (daily auto-renew) | ✗ NOT IN REPO | ⚠ SSH-required | renewal logs / post-hook reload nginx / expiry alerting — unknown |
| **ufw rules** | yes (deny incoming, allow 22/80/443) | ✗ NOT IN REPO | ⚠ SSH-required | fail2ban / outgoing restrictions — unknown |
| **rclone config** | yes (`/root/.config/rclone/rclone.conf`) | ✗ NOT IN REPO | ⚠ SSH-required | DB-003 — script не реализован, config возможно не существует |
| **`/var/backups/catalyst/`** | yes (retention 14d) | ✗ on prod disk | ⚠ SSH-required | DB-001/002/003 — backup integrity broken, even local copies могут быть corrupted |
| **healthcheck endpoint** | implicit | ✓ yes | ✓ full | `/api/health` on both dashboard (line 633-635) and admin (line 916), Docker healthcheck wired |
| **disk space guard** | declared NOT in SESSION_CONTEXT | ✓ yes (src/index.js:256-312) | ✓ full | **runStorageGuard()** каждые 15m, low 2GB / critical 1GB, cleanup 7d-old alerts + purge 7d-old log files |
| **Logger** | implicit | ✓ yes (`src/utils/logger.js`) | ✓ full | Custom, structured JSON, ISO timestamps, daily file rotation `${date}.log`, level via LOG_LEVEL env (not NODE_ENV) |

**Spec coverage**: 14 in repo / verifiable. **7 components only on prod, unverifiable** (nginx, catalyst-backup.sh, cron, certbot, ufw, rclone, B2 bucket). Major operational risk — single source of truth для critical infrastructure lives outside version control.

---

## Configuration drift map

| # | Spec says | Reality (verifiable from repo) | Severity | Existing flag |
|---|---|---|---|---|
| 1 | Backup `sqlite3 .backup` + gzip + B2 rclone | `scripts/backup.sh` — `cp` + find prune local-only, dev path | HIGH | DB-001/002/003 (CRITICAL severity per DB audit) |
| 2 | `TRUST_PROXY=1` — app reads real-IP | declared, NEVER implemented | MEDIUM | SEC-003 |
| 3 | DEPLOY.md describes `/etc/cron.daily/catalyst-backup` with sqlite3 .backup | scripts/backup.sh is **different** (cp+find), retention 30d not 14d | HIGH | extension of SD-9, SD-10 |
| 4 | nginx config: 8 properties | NOT IN REPO — cannot verify any | HIGH | new — SD-19 |
| 5 | `dashboard.stop(timeoutMs)` Promise drain SSE | ✓ verified (line 565-587 dashboard, 7838-7847 admin) | n/a | verified safe |
| 6 | Re-entry guard + hard-cap 15s | ✓ verified (line 689-700 index.js) | n/a | verified safe |
| 7 | Hard-fail env validation | ✓ verified (config.js:141-143) | n/a | verified safe |
| 8 | `DASHBOARD_API_KEY` real auth | warn-only, no enforce | LOW | SEC-007 |
| 9 | `HOT_REFRESH_LIGHT_*` env keys | used in code (lines 167, 171) but **NOT in .env.example** | MEDIUM | new — SD-20 |
| 10 | deploy.ps1 = deploy.sh (parity) | sh missing ServerAlive + EvilCatPack EXCLUDE | MEDIUM | new — PROD-002 |
| 11 | scripts/backup.sh = `/usr/local/bin/catalyst-backup.sh` | name & content mismatch — two scripts? | HIGH | new — SD-21 |
| 12 | Daily backup off-site B2 | rclone copy NOT in scripts/backup.sh, rclone config unverifiable | HIGH | DB-003 confirm |
| 13 | Restore procedure documented | NOT в DEPLOY.md | HIGH | DB-004 confirm |

**Verifiable drift count**: 7 items confirmed from repo. **Unverifiable**: 6 items requiring SSH access to confirm.

---

## Operational readiness assessment

«Operator wants to do X in incident — does the system support it? Documented? Tested? Has alerting?»

| Operation | Supported? | Documented? | Tested? | Has alerting? |
|---|---|---|---|---|
| Deploy new version | ✓ (deploy.ps1/sh) | ✓ DEPLOY.md | manual every deploy | ✗ deploy success → no notification |
| Rollback to prev version | **✗ NO mechanism** | ✗ | ✗ | ✗ |
| Pause scanner during cost burn | ✓ (admin) | ✓ | yes | ✗ pause state not persisted (ADM-007) |
| Force-scan | ✓ (admin) | ✓ | yes | ✗ |
| Restore DB from backup | ⚠ possible if backup valid | **✗ NOT in DEPLOY.md** (DB-004) | **NEVER** | ✗ no «backup is X days old» indicator |
| Restore from B2 if VPS dies | **✗ rclone B2 not implemented** (DB-003) | ✗ | ✗ | ✗ |
| Cert renewal | assumed certbot.timer auto-runs | ✗ not in DEPLOY.md | unknown | **✗ NO expiry alert** (≤30d/14d/7d) |
| Disk fill incident | ✓ disk guard reactive 15m | partial (in code, not docs) | unknown | ✗ no «disk >80%» pre-emptive alert |
| App crash recovery | ✓ `restart: always` | ✓ | yes (container restart 3-5s) | ✗ no Sentry, no admin TG alert (BOT-020) |
| Bot token revoked | partial (graceful disable for support bot) | ✗ | ✗ | ✗ no detection mechanism |
| Cert expiry < 7 days | unknown | ✗ | ✗ | ✗ |
| Apify quota exhausted | ✓ graceful fail + collector skip | partial | yes | ✗ no provider-side alert integration |
| Pre-deploy SPA syntax error | check-spa.cjs exists | mentioned in CLAUDE.md | **NEVER called в deploy** | ✗ broken SPA reaches prod |
| External error spike (5xx avalanche) | ✗ no monitoring | ✗ | ✗ | ✗ no Sentry / uptime check |
| Memory leak detection | partial (1G hard limit forces restart) | ✗ | ✗ | ✗ |
| DB corruption detection | ✗ no integrity check post-backup | ✗ | ✗ | ✗ no SQLite PRAGMA integrity_check scheduled |
| User-reported issue triage | ✓ via support bot forum-topics | ✓ in SESSION_CONTEXT | live use | ✓ topics auto-create |
| Pre-launch checklist | ✓ DEPLOY.md section 11 (16 items) | ✓ | unknown | n/a |
| Initial server bootstrap | partial (setup_remote.sh Docker install) | partial DEPLOY.md | yes | n/a |

**Verdict**: **~55%** operational readiness. Day-to-day ops solid (deploy, pause, force-scan, broadcasts, preset tuning). **Incident response слабо** — нет restore procedure, нет cert expiry alerting, нет error tracking, нет uptime monitoring. **Disaster recovery практически 0%** — backup script stub, no restore drill, no B2 off-site.

---

## Summary

**Counts**: 0 critical · **9 high** · 13 medium · 5 low · 5 info · **32 findings total**.

Общее впечатление — **infrastructure baseline solid**: Dockerfile с tini (PID 1 fix решён), multistage build, `USER node`, healthcheck wired в docker-compose, port `127.0.0.1` loopback-only, named volumes для DB+logs, restart `always`, resource limits (CPU 1, mem 1G), log driver max-size 50m max-file 5, NODE_OPTIONS память capped, graceful shutdown с SSE drain + re-entry guard + 15s hard-cap + closeAllConnections fallback, hard-fail env validation в production для 3 critical keys (XAI/TG/ADMIN), AbortController на LLM calls, .dockerignore comprehensive, structured JSON logger с PII masking (11 maskId callsites), disk space guard runStorageGuard() реактивная каждые 15m с cleanup 7d-old alerts + log purge, healthcheck endpoint wired в Docker.

Слабые места — **9 high** в трёх кластерах:
1. **Backup contract drift** (PROD-001/005/011): scripts/backup.sh — stub (cp + dev path .data/ + NOT in cron), `/usr/local/bin/catalyst-backup.sh` (declared в spec) NOT в репо, B2 rclone не implemented, restore procedure NOT в DEPLOY.md. Cross-confirm DB-001/002/003/004 (которые уже critical).
2. **Deploy hygiene** (PROD-002/003/004): deploy.sh drift vs deploy.ps1 (missing ServerAlive + EvilCatPack EXCLUDE), no pre-deploy checks (npm test, check-*-spa.cjs validators exist но NEVER called), no rollback mechanism (no backup-before-deploy, no image version pin).
3. **Infrastructure unverifiable** (PROD-007/008): nginx config + cron + certbot + ufw + rclone — NOT IN REPO. Cannot verify spec match. Cert expiry has NO alerting → silent failure → HTTPS dies в 90d.

Plus PROD-006 (no external error tracking + no admin TG crash alerts, BOT-020 cross-confirm) и PROD-009 (TRUST_PROXY drift, SEC-003 prod confirm).

Medium набор — observability gaps (no Prometheus/metrics, no uptime monitor, no log shipping), HOT_REFRESH_LIGHT_* env drift, DASHBOARD_API_KEY decorative, LOG_LEVEL not tied to NODE_ENV (debug может leak в prod), uncaughtException handler logs only не exits (process zombie risk).

**Top-3** для разбора в первую очередь:
1. **PROD-001 + PROD-005 + PROD-011 combined** — backup contract drift trifecta (scripts/backup.sh stub + restore procedure missing + script name mismatch с prod spec). Cross-confirm DB-001/002/003/004. Real catastrophic risk — VPS dies tomorrow, recovery time = unknown.
2. **PROD-003 + PROD-004 combined** — no pre-deploy checks + no rollback. Один broken deploy (backtick в SPA) = service down, no quick revert. Mitigation: check-spa.cjs validators существуют, надо просто **call** их в deploy scripts. Plus version tagging.
3. **PROD-008** — cert renewal has NO expiry alerting. Certbot.timer assumed auto-renew, **никто не узнает если failed**. HTTPS дохнет через 90d тихо. Externally verifiable raz в неделю минимум, но automation nil.

---

## Findings

### [PROD-001] `scripts/backup.sh` — stub, не matches prod spec, не интегрирован в cron — severity: **high**

* **Where**: `scripts/backup.sh` (in repo) vs `/usr/local/bin/catalyst-backup.sh` (declared on prod per SESSION_CONTEXT line 746)
* **Surface**: disaster recovery / backup
* **What**: scripts/backup.sh — простой `cp catalyst.db` → `.backups/` + `find -mtime +30 -delete`. Это **не** соответствует spec:
  * spec говорит `sqlite3 .backup` (locking-aware) — script использует `cp` (corrupt under load — DB-001)
  * spec говорит gzip — отсутствует
  * spec говорит retention 14d — script использует 30d (drift)
  * spec говорит off-site B2 rclone — отсутствует (DB-003)
  * spec говорит `gzip -t` integrity — отсутствует (DB-002)
  * spec говорит prod path `/var/backups/catalyst/` — script использует dev path `.data/`
* **Operational impact**: даже если оператор run'ит scripts/backup.sh manually — получает corrupt-prone .db file в dev location, без off-site copy. Real backup `/usr/local/bin/catalyst-backup.sh` (если existsна проде) — **invisible** для repo-side audits. Cannot verify production really has working backup без SSH.
* **Verifiability**: статически из репо (scripts/backup.sh content), prod script SSH-required.
* **Fix**: либо удалить scripts/backup.sh (dev-only confusion), либо переписать чтобы matchвать `/usr/local/bin/catalyst-backup.sh` (commit prod script в repo как single SoT). Latter — strongly preferred. Закрывает SD-21.

---

### [PROD-002] `deploy.sh` (Linux) drift vs `deploy.ps1` — missing ServerAlive + EvilCatPack — severity: **high**

* **Where**: `deploy.sh` vs `deploy.ps1`
* **Surface**: deploy
* **What**: deploy.ps1 (Windows) has R7 fixes:
  * `-o ServerAliveInterval=30 -o ServerAliveCountMax=10` на scp/ssh (line 51, 86) — prevent connection reset on slow uploads
  * EvilCatPack EXCLUDE (line 30) — 1.1MB raw frames не нужны на проде
  
  deploy.sh has **neither**:
  * No ServerAlive options → slow VPS link → mid-transfer drop, broken deploy
  * EvilCatPack included в archive → 1.1MB inflated upload + waste of disk space на проде
* **Operational impact**: Linux operator (или Mac developer using sh) gets degraded deploy experience. Mid-upload disconnects = broken state mid-deploy. R7 fix только Windows-side.
* **Verifiability**: статически.
* **Fix**: cherry-pick ServerAlive options + EvilCatPack EXCLUDE из .ps1 в .sh. ~5 строк sync.

---

### [PROD-003] Deploy scripts — NO pre-deploy checks — severity: **high**

* **Where**: deploy.ps1 + deploy.sh + setup_remote.sh
* **Surface**: deploy
* **What**: ни один из scripts не runs `npm test`, `npm audit`, `node scripts/check-admin-spa.cjs`, `node scripts/check-dashboard-spa.cjs` перед uploadом. Это особо плохо потому что:
  * **SPA-trap** — `src/dashboard/server.js` и `src/admin/server.js` huge inline React в template literal. Backtick в комментарии / `\n` в string / двойной escape в `new RegExp('...')` → чёрный экран. CLAUDE.md explicit warning. check-*-spa.cjs validators **существуют** в `scripts/`, but **never called** в deploy.
  * `package.json` — no `test`, no `lint` script. Manually run-only.
* **Operational impact**: broken SPA syntax reaches prod. Юзеры видят чёрный экран до next deploy / rollback (которого тоже нет — PROD-004).
* **Fix**: add validators в deploy script BEFORE archive upload:
  ```bash
  node scripts/check-admin-spa.cjs && node scripts/check-dashboard-spa.cjs || { echo "SPA validation failed"; exit 1; }
  ```
  ~5 строк в каждом script.

---

### [PROD-004] NO rollback mechanism — no backup-before-deploy, no image version pin — severity: **high**

* **Where**: deploy.ps1/sh + setup_remote.sh + DEPLOY.md
* **Surface**: deploy / disaster recovery
* **What**: deploy procedure:
  1. zip current repo
  2. scp to /tmp
  3. unzip → docker compose down → build → up -d
  
  **Nothing taken before**:
  * No DB backup before deploy (если migration breaks DB, rollback невозможен)
  * No image version tag (`docker tag catalyst:latest catalyst:$(date +%Y%m%d-%H%M%S)`) — `docker compose down` lose'ит previous image after rebuild
  * No git tag для prev commit на проде
  * No `deploy --rollback` flag
* **Operational impact**: broken deploy (slow LLM call mid-startup / migration bug / SPA syntax bug not caught by PROD-003) → no way back fast. Operator должен manually `git checkout HEAD~1 && deploy` (5-10 min downtime).
* **Fix**: 
  * Pre-deploy hook в setup_remote.sh: `docker tag catalyst:latest catalyst:rollback-$(date +%s)` + `sqlite3 /data/catalyst.db ".backup /backups/pre-deploy-$(date +%s).db"`
  * `deploy.ps1 --rollback` flag → restore image tag + restore DB
  * Document в DEPLOY.md «How to rollback» section
  * ~60 строк infrastructure + docs

---

### [PROD-005] NO restore procedure в DEPLOY.md — disaster recovery undocumented — severity: **high**

* **Where**: `DEPLOY.md`
* **Surface**: disaster recovery
* **What**: DEPLOY.md имеет section 6 «Backups» — описывает создание backup'а (cron, sqlite3 .backup, 14d retention). **НО** нет section «Restore»:
  * Как восстановить /data/catalyst.db из `/var/backups/catalyst/*.db.gz`?
  * Как gunzip + validate integrity (PRAGMA integrity_check)?
  * Как stop container, swap file, restart?
  * Что если local backup тоже corrupt — B2 fetch via rclone?
  * Verification post-restore (row counts, recent timestamps present)?
* **Operational impact**: DB-004 confirm — restore procedure не задокументирована и никогда не тестировалась. В случае catastrophic data loss оператор learns by-doing under pressure.
* **Fix**: add section 6.b «Restore from backup» в DEPLOY.md — 6-7 шагов с конкретными commands. **Plus quarterly restore drill** на staging instance (или dry-run на пустой test container).

---

### [PROD-006] NO external error tracking + NO admin TG crash alerts — silent crashes — severity: **high**

* **Where**: `src/index.js:719-720` (handlers only log), `package.json` (no Sentry/Bugsnag dep)
* **Surface**: observability
* **What**: 
  * `process.on('uncaughtException', e => logger.error(...))` — лог-only, no process.exit, no admin notification. Process может hang в weird state, requests залипают, restart only via Docker healthcheck eventually (3 failed × 30s = ~90s lag).
  * `process.on('unhandledRejection', e => logger.error(...))` — same.
  * BOT-020 cross-confirm — нет admin TG bot crash alerts ни на bot side, ни на main app side.
  * No Sentry / Bugsnag / similar external aggregator → silent errors просто log lines в /logs/{date}.log → operator узнаёт post-mortem через tail.
* **Operational impact**: app crashes → users see 502 → operator не знает до next manual check. Combined с lack uptime monitoring (PROD-012) — outage может длиться часами.
* **Fix**: 
  * Add Sentry: `npm i @sentry/node`, `Sentry.init` в index.js boot, $0/month free tier covers small project. ~10 строк.
  * **Plus** admin TG crash alert: на uncaughtException + critical errors → `telegram.sendMessage(adminChatIds, 'CRASH: ...')`. ~15 строк.
  * Cross-overlap BOT-020 + ADM-001 (silent error states) + UX-001 (Feed silent) = backlog #13 «standardized error visibility».

---

### [PROD-007] nginx config NOT в репо — spec drift unverifiable — severity: **high**

* **Where**: `/etc/nginx/sites-available/catalyst` (declared в SESSION_CONTEXT line 743, NOT in repo)
* **Surface**: infrastructure
* **What**: spec declares 8 nginx properties (`proxy_buffering off` / `proxy_read_timeout 24h` / 4 X-headers / Authorization / `set_real_ip_from` / `real_ip_header`). Реальный nginx config на VPS — **NOT in version control**. Cannot verify spec match, cannot review changes, cannot rollback nginx changes. Single source of truth lives outside git.
* **Operational impact**: 
  * Operator вручную правит nginx config на проде → no history, no review.
  * VPS dies → new VPS bootstrap requires reconstructing nginx config from memory + SESSION_CONTEXT spec.
  * Spec может расходиться с реальностью silently (SD-19).
* **Fix**: commit production nginx config в `scripts/nginx-catalyst.conf` (или `infra/nginx/catalyst.conf`). Document «source of truth — repo. Manual edits на проде запрещены». Periodic SSH diff check `diff /etc/nginx/sites-available/catalyst infra/nginx/catalyst.conf`. ~150 строк config + DEPLOY.md note.

---

### [PROD-008] NO cert expiry alerting — silent HTTPS failure mode — severity: **high**

* **Where**: certbot.timer (assumed runs daily on prod, NOT verifiable)
* **Surface**: infrastructure / certificate
* **What**: spec говорит certbot.timer auto-renews daily. **Если renewal silently fails** (например acme-challenge port 80 blocked временно, или DNS misconfig после change) — cert expires через 90 days. HTTPS dies, browser shows scary warning, всё лежит.
* **Operational impact**: HTTPS goes down ~90d after first failed renewal, operator узнаёт от user complaint OR when сам зашёл на сайт. Worst-case: holidays / vacation → 1+ week outage.
* **Verifiability**: партиал — certbot logs на проде (`/var/log/letsencrypt/letsencrypt.log`) SSH-required. Externally verifiable через `openssl s_client -connect catalystparser.io:443 | openssl x509 -noout -dates` (single-shot check).
* **Fix**: 
  * Уровень 1 (low effort): cron monitor — `scripts/check-cert-expiry.sh` каждый день, alert если ≤30/14/7 days до expiry. ~20 строк bash.
  * Уровень 2: внешний uptime monitor с cert checking (UptimeRobot free tier supports). Alert email/TG.
  * Уровень 3: post-hook на certbot — `--post-hook 'systemctl reload nginx && curl -fsS https://admin-alert-webhook'`.

---

### [PROD-009] TRUST_PROXY declared but NOT implemented (SEC-003 prod confirm) — severity: **high**

* **Where**: `src/config.js:123` (declared, parsed), nowhere implemented; SESSION_CONTEXT line 824 («`TRUST_PROXY=1` — app за nginx, rate-limit'ы читают real-IP через `X-Forwarded-For`»)
* **Surface**: network / rate-limit
* **What**: SEC-003 prod angle confirmation. nginx forwards `X-Forwarded-For` header (per spec line 743 — `set_real_ip_from 127.0.0.1` + `real_ip_header X-Forwarded-For` correctly configured nginx-side). **App никогда не reads `X-Forwarded-For`** → все requests видятся как `127.0.0.1` → per-IP rate-limits фактически global (один user maxes out `10 initiate/5min` для **всех users**).
* **Operational impact**: real DoS scenario — один скрипт от одного user'а исчерпывает auth-initiate quota за 5 минут → блокирует initiate для всего сайта на остаток window. SEC-003 уже flag'нул, здесь cross-confirm с prod angle (nginx is ready, app not).
* **Fix**: implement `TRUST_PROXY` logic — `req.realIp = config.trustProxy ? (req.headers['x-forwarded-for'] || '').split(',')[0].trim() : req.socket.remoteAddress`. Apply ко всем rate-limit Map keys. ~10 строк. **Cross-audit overlap** — потенциально pair с future auth-IP-cap fix через one helper.

---

### [PROD-010] `scripts/status.sh` hardcoded port 7357 ≠ docker-compose 8080 — severity: **medium**

* **Where**: `scripts/status.sh`
* **Surface**: dev ops debug
* **What**: dev script использует `curl :7357/api/health` — docker-compose маппит на 8080. Mismatch — script silently не работает.
* **Fix**: либо update до 8080, либо source from env (`${DASHBOARD_PORT:-8080}`). ~1 line.

---

### [PROD-011] `/usr/local/bin/catalyst-backup.sh` ≠ `scripts/backup.sh` — name mismatch — severity: **medium**

* **Where**: SESSION_CONTEXT line 746 declares `/usr/local/bin/catalyst-backup.sh`, repo has `scripts/backup.sh`
* **Surface**: backup / disaster recovery
* **What**: два script'а с разными именами и разным content. Который **реально** running на проде? Если `/usr/local/bin/catalyst-backup.sh` существует (correctly does sqlite3 .backup + gzip + B2) — он invisible от repo. Если не существует — backup полностью отсутствует.
* **Operational impact**: total uncertainty about real backup state. Operator не может ответить «do we have valid backup?» без SSH.
* **Fix**: standardize. Commit prod script в repo как `scripts/catalyst-backup.sh`, document «deploy copies it to `/usr/local/bin/`». Закрывает PROD-001 + SD-21.

---

### [PROD-012] NO external uptime monitoring — severity: **medium**

* **Where**: -
* **Surface**: observability
* **What**: external ping (UptimeRobot / BetterUptime / Pingdom) на `https://catalystparser.io/api/health` каждые 5 min — не упомянуто в SESSION_CONTEXT, не в DEPLOY.md, скорее всего отсутствует. Downtime может go unnoticed до user complaint.
* **Fix**: setup UptimeRobot free tier (50 monitors free). 5-min interval, Telegram/Slack/email alerts.

---

### [PROD-013] NO Prometheus / metrics endpoint — severity: **medium**

* **Where**: -
* **Surface**: observability
* **What**: `prom-client` not в `package.json`, `/metrics` endpoint не exists. Per-stage timing / per-endpoint latency / per-user request rate — невозможно профилировать. Cost logs are token counts not USD (COST-009).
* **Fix**: future, lower priority. При scaling — needed.

---

### [PROD-014] NO external log shipping — severity: **medium**

* **Where**: docker-compose.yml log driver json-file
* **Surface**: observability
* **What**: logs только в named volume `/logs/{date}.log` + Docker stdout ring buffer 50m × 5. Historical search across N days требует ssh+grep. Если container нужно destroy + recreate — logs survive (named volume), но centralized search невозможен. Если VPS dies — logs lost (нет off-site shipping).
* **Fix**: future polish. Простой path — install `vector` / `promtail` → ship to Loki / Logtail / Papertrail (free tiers exist).

---

### [PROD-015] LOG_LEVEL not tied to NODE_ENV — debug может leak в prod — severity: **medium**

* **Where**: `src/utils/logger.js` (level controlled только LOG_LEVEL env, not NODE_ENV)
* **Surface**: observability / cost
* **What**: если оператор случайно set'ит `LOG_LEVEL=debug` в `.env` на проде — debug logs накапливаются. Disk fill faster + sensitive data exposure risk (debug часто включает request bodies / response samples).
* **Fix**: hard-set production minimum:
  ```js
  const level = process.env.NODE_ENV === 'production' && envLevel === 'debug' ? 'info' : envLevel;
  ```
  Log warning «debug requested in production, downgrading to info». ~3 строки.

---

### [PROD-016] uncaughtException handler — log only, no process.exit — severity: **medium**

* **Where**: `src/index.js:719-720`
* **Surface**: runtime stability
* **What**: handler logs error, **не делает** `process.exit(1)`. Node best practice: после uncaughtException — process state corrupted, exit & restart. `restart: always` в docker-compose автоматически recover'ит. Currently — process может hang в zombie state до Docker healthcheck (3 fails × 30s).
* **Fix**: add `process.exit(1)` после logger.error + brief flush delay:
  ```js
  process.on('uncaughtException', e => {
    logger.error('Uncaught:', e);
    setTimeout(() => process.exit(1), 1000);  // brief flush
  });
  ```

---

### [PROD-017] DASHBOARD_API_KEY decorative (SEC-007 confirm) — severity: **medium**

* **Where**: `src/config.js:151` (warn-only, не hard-fail)
* **Surface**: env validation
* **What**: SEC-007 cross-confirm. Variable declared в `.env.example`, warned if missing, **никогда не validated** против incoming requests. Operator thinks API key protects something — не protects.
* **Fix**: либо remove из .env.example + config (clean up), либо implement real `X-API-Key` middleware check. Currently misleading.

---

### [PROD-018] `HOT_REFRESH_LIGHT_*` env keys NOT в .env.example — severity: **medium**

* **Where**: code uses `HOT_REFRESH_LIGHT_ENABLED`, `HOT_REFRESH_LIGHT_INTERVAL_MINUTES`, .env.example missing
* **Surface**: env validation
* **What**: hot refresh light cycle (60min, image metrics только) controlled этими env vars. New operator не знает что они существуют, defaults run silently.
* **Fix**: add к .env.example с comment про purpose + default. ~3 строки.

---

### [PROD-019] Disk guard reactive 15m interval, no predictive alert — severity: **medium**

* **Where**: `src/index.js:256-312` (runStorageGuard)
* **Surface**: observability
* **What**: good news — disk guard реально existует! Каждые 15m checks free space. Low threshold 2GB → cleanup 7d-old alerts + purge 7d-old logs. Bad news — only **reactive**:
  * No alert «disk usage growth rate suggests fill in N days».
  * If something burns disk быстро (например runaway log spam, cron-broken backup keeps gzipping) — 15m window между checks может быть слишком long.
  * Cleanup может drop legitimate data если frequency > 7d retention.
* **Fix**: add predictive alert via `du -sh` deltas tracked over time. Plus expose в admin UI maintenance card. Cross-overlap ADM-004 (maintenance gap).

---

### [PROD-020] Cost logged в tokens not USD (COST-009 confirm) — severity: **medium**

* **Where**: `src/analysis/scorer.js:726-732`
* **Surface**: observability / cost
* **What**: per-stage token counts logged (stage1 in/out, stage2 in/out). **NO USD conversion** → operator не может ответить «сколько вчера потратили на LLM?» without manual math.
* **Fix**: token×rate mapping per model (lookup table) → log USD inline. ~20 строк + provider rate config.

---

### [PROD-021] Secret rotation procedure undocumented — severity: **medium**

* **Where**: `DEPLOY.md` (no section), `SESSION_CONTEXT.md` (no mention)
* **Surface**: security operations
* **What**: если XAI_API_KEY / TELEGRAM_BOT_TOKEN / ADMIN_API_KEY compromise — нет documented «hot-rotate without downtime» procedure. Current path: edit `.env` на проде → restart container. 3-5s downtime. Acceptable но not documented.
* **Fix**: DEPLOY.md section «Secret rotation» — step-by-step. ~10 строк.

---

### [PROD-022] setup_remote.sh fails if .env missing на VPS — severity: **medium**

* **Where**: `setup_remote.sh:52-59`
* **Surface**: deploy
* **What**: первый deploy на свежий VPS — operator должен manually `scp .env root@vps:/opt/catalyst/.env` ИЛИ deploy.ps1 ловит local .env и scp'ит. Если ни то, ни другое — setup_remote.sh exit 1 без graceful guidance.
* **Fix**: more informative error message + link to DEPLOY.md initial setup section. ~5 строк.

---

### [PROD-023] .gitignore — no explicit `*.pem` / `*.key` / `*.crt` glob — severity: **low**

* **Where**: `.gitignore`
* **Surface**: secrets hygiene
* **What**: defense-in-depth — если когда-нибудь cert-based auth introduced (например внутренний service mesh, mTLS), accidentally commit'нуть private key — risk.
* **Fix**: add `*.pem`, `*.key`, `*.crt`, `cert/`, `keys/` patterns. ~5 lines.

---

### [PROD-024] 2 confusing env pair naming — severity: **low**

* **Where**: `.env.example`
* **Surface**: env hygiene
* **What**: 
  * `APIFY_API` (generic) vs `APIFY_API_KAITO` / `APIFY_API_XQUIK` / `APIFY_API_CLOCKWORKS` / `APIFY_API_APIDOJO` (per-actor) — hierarchy unclear.
  * `OPENROUTER_VISION_MODEL` vs `OPENROUTER_VISION_MODEL_FALLBACK` — asymmetric suffix.
* **Fix**: add prefix grouping comments + maybe rename `APIFY_API` → `APIFY_API_DEFAULT`. Low priority.

---

### [PROD-025] `scripts/migrate-categories-2026-05-08.sql` stale file — severity: **low**

* **Where**: `scripts/migrate-categories-2026-05-08.sql`
* **Surface**: repo hygiene
* **What**: one-off migration file (2026-05-08), уже applied на проде, не auto-run, never used again. Repo clutter.
* **Fix**: remove. Or keep с README note «historical, do not run». ~1 line removal.

---

### [PROD-026] Zombie `/root/Narrative-Parser/` pre-Docker clone — severity: **low**

* **Where**: prod VPS only (declared SESSION_CONTEXT line 754)
* **Surface**: prod hygiene
* **What**: ancient pre-Docker clone (2026-03-29 .. 2026-04-14), к проду не относится. Disk waste + potential confusion если operator случайно edits.
* **Fix**: SSH + `rm -rf /root/Narrative-Parser/`. ~1 command. Document «no longer needed» в SESSION_CONTEXT removal.

---

### [PROD-027] No CAA records mention — DNS-level cert restriction — severity: **low**

* **Where**: DNS provider config (unverifiable from repo)
* **Surface**: certificate / DNS security
* **What**: CAA record restricts which CA can issue certs for domain. Без CAA — любой CA может issue rogue cert если compromise registrar. Defense-in-depth.
* **Fix**: add CAA record `catalystparser.io. CAA 0 issue "letsencrypt.org"`. Single DNS change.

---

### [PROD-028] No HTTP/3 + brotli mentioned (nginx config not in repo) — severity: **info**

* **Where**: nginx config (assumed)
* **Surface**: performance
* **What**: HTTP/2 likely enabled by default nginx, HTTP/3 (QUIC) — newer, requires explicit nginx module. Brotli compression — better than gzip but optional module. Both improve perf but not critical.
* **Fix**: future polish.

---

### [PROD-029] No WAF / Cloudflare DDoS protection — severity: **info**

* **Where**: -
* **Surface**: network / DDoS
* **What**: catalystparser.io directly hits VPS nginx (assume no Cloudflare proxy). Если real DDoS — ufw + nginx limit_req first line, both могут break under sustained attack.
* **Fix**: future — add Cloudflare proxy (free tier covers DDoS protection). Acceptable for current scale.

---

### [PROD-030] SSH key-only auth + fail2ban — assumed but unverifiable — severity: **info**

* **Where**: VPS sshd config (unverifiable)
* **Surface**: SSH security
* **What**: assume key-only + root disabled + fail2ban — standard hardening. Не verified.
* **Verifiability**: SSH-required, или `ssh -v` to see allowed auth methods.

---

### [PROD-031] No blue-green / rolling deploy — accepts 3-5s downtime — severity: **info**

* **Where**: deploy.ps1/sh
* **Surface**: deploy
* **What**: `docker compose down → up -d` имеет 3-5s window 502 for users. Acceptable trade-off для current scale, но future scaling — blue-green / rolling нужен.
* **Fix**: future. Не приоритет.

---

### [PROD-032] AbortController на LLM calls — assume Promise abort после graceful shutdown — severity: **info**

* **Where**: `src/analysis/*.js` (embeddings, gemini-captioner, image-hash)
* **Surface**: graceful shutdown / runtime
* **What**: AbortController pattern в коде для LLM timeouts. **Не проверено** что shutdown handler abort'ит активные LLM calls на SIGTERM — может wait для natural timeout (5-30s), что близко к hard-cap 15s.
* **Fix**: low priority. Maybe wire global AbortController to shutdown signal.

---

## Verified safe

То что прошло — не пересматривать на следующих этапах:

1. **Graceful shutdown trifecta** — SIGTERM/SIGINT handlers (index.js:717-718) + re-entry guard `_shuttingDown` (line 689) + hard-cap 15s (`setTimeout(() => process.exit(1), 15_000).unref()`) + `Promise.allSettled([dashboard.stop(10_000), admin.stop(10_000)])` для parallel drain.
2. **Dashboard.stop** (line 565-587) — Promise drain SSE с 'event: bye' event + `server.close()` + `closeAllConnections()` fallback на timeout.
3. **Admin.stop** (line 7838-7847) — simpler, no SSE, drains in-flight requests с timeout fallback.
4. **Docker tini** — `ENTRYPOINT ["/sbin/tini", "--"]` (Dockerfile line 67) — solves PID 1 problem, SIGTERM forwarded correctly to Node process.
5. **Docker multistage** — builder (`npm ci` + rebuild better-sqlite3) → runtime (COPY --from=builder, `--omit=dev`) — smaller image.
6. **USER node** non-root (Dockerfile line 51) — privilege escalation surface minimized.
7. **Port binding `127.0.0.1`** — loopback only (docker-compose lines 22-23). Public access only через nginx TLS.
8. **Healthcheck wired** — `/api/health` каждые 30s (docker-compose lines 46-51), 10s timeout, 3 retries → Docker auto-restart on persistent failure.
9. **Resource limits** — CPU 1 / mem 1G hard cap (docker-compose lines 32-39).
10. **Named volumes** — `catalyst_data` + `catalyst_logs` (persistent across container recreation).
11. **Custom bridge network** `catalyst` — isolated from default bridge.
12. **Container log driver** json-file max-size 50m max-file 5 = 250MB ring buffer (no unbounded growth для `docker logs`).
13. **NODE_OPTIONS --max-old-space-size=1024** (Dockerfile + docker-compose) — memory cap для Node heap.
14. **AbortController pattern** — LLM calls (embeddings, gemini-captioner, image-hash, url-resolver) wrap'ятся в abort signals + timeout fallback.
15. **DB safety** — single SQLite better-sqlite3 sync, no mid-transaction async interrupt risk. Stage 1 `_aiUnavailable` flag для save_only retry pattern.
16. **Scheduler interrupt safety** — `runScanCycle()` try/catch wrap + finally block persists completion timestamp.
17. **Hard-fail env validation** — XAI_API_KEY + TELEGRAM_BOT_TOKEN + ADMIN_API_KEY в production (config.js:141-143). `process.exit(1)` если missing.
18. **`.env.example` 100% documented** — 53 keys, every key has comment. Required vs optional clear.
19. **Code/env sync** — все used `process.env.*` keys в .env.example (no orphans), HOT_REFRESH_LIGHT_* exception flagged.
20. **`.gitignore` covers** — `.env` + data/ + logs/ + node_modules/.
21. **`.dockerignore` comprehensive** — node_modules / data / logs / .env / .git / .claude / ai-context / scripts / EvilCatPack excluded.
22. **SUPPORT_BOT_TOKEN graceful disable** — verified (config.js:152), missing token не fails main flow.
23. **PII masking** — 11 `maskId` callsites consistent (last 4 chars of chat_id в logs).
24. **Structured JSON logger** — `src/utils/logger.js` with ISO timestamps, daily rotation `${date}.log`.
25. **Disk space guard PRESENT** — `runStorageGuard()` в index.js:256-312, 15m interval, 2GB low / 1GB critical, 7d cleanup alerts + purge 7d logs. Mitigates часть DB-014.
26. **Healthcheck endpoints** — `/api/health` exists на dashboard:633-635 + admin:916, wired в Docker healthcheck.
27. **uncaughtException/unhandledRejection handlers present** (index.js:719-720) — хотя нужен process.exit fix (PROD-016).
28. **DEPLOY.md 341 lines** — comprehensive sections (prerequisites, setup, systemd, nginx, firewall, backups, deploy, health, telegram, ops, checklist, monitoring, future hardening).
29. **Migration runner idempotent** — `_migrate()` в db/database.js использует `addIfMissing()` (PRAGMA table_info check before ALTER).
30. **Cache control** — SPA HTML `no-cache, no-store, must-revalidate` (operator restart shows new UI immediately, no stale caching).
31. **Token rotation safe** — config secrets read on boot, restart = clean re-init.
32. **Apify token in Authorization header** (not URL) — verified Stage 1.

---

## Spec drift (накопительно — 21 items)

К существующим 18 items добавляю 3 новых prod-уровень:

- **SD-1**..**SD-18** — см. предыдущие этапы.
- **SD-19** **nginx config not in version control** — SESSION_CONTEXT § «Production posture» declares 8 nginx properties (proxy_buffering off, proxy_read_timeout 24h, 4 X-headers, Authorization passthrough, set_real_ip_from, real_ip_header), real file `/etc/nginx/sites-available/catalyst` NOT в репо. Single source of truth lives outside git. См. PROD-007.
- **SD-20** **HOT_REFRESH_LIGHT_* env vars not in .env.example** — code uses `HOT_REFRESH_LIGHT_ENABLED` + `HOT_REFRESH_LIGHT_INTERVAL_MINUTES`, .env.example отсутствует. New operator не узнаёт что они существуют. См. PROD-018.
- **SD-21** **Backup script name mismatch** — SESSION_CONTEXT declares `/usr/local/bin/catalyst-backup.sh`, repo has `scripts/backup.sh`. Different names + different content = uncertainty что реально running. См. PROD-001 + PROD-011.

Финальный sync-pass по SESSION_CONTEXT планируется после всех 12 этапов.

---

## Cross-audit overlap

«One-fix-many-wins» backlog (расширен до **17 targets** с prod-уровень):

1. **Backup integrity rewrite** (DB-001+002+003+004 + SD-9/10 + **PROD-001 + PROD-005 + PROD-011 + SD-21**) — теперь **8 items** (включая prod-side: commit catalyst-backup.sh в repo, document restore procedure в DEPLOY.md, integrate в cron, B2 rclone implementation).
2. **`notifications` migration** — 5 items.
3. **Schema integrity sweep** — 5 items.
4. **`db.transaction` wrap save loops** — 3 items.
5. **`sqliteCutoff` consolidation** — 4 items.
6. **Housekeeping schedule + admin UI maintenance** (+ADM-004 + **PROD-019** disk guard predictive alert exposure) — 7 items.
7. **`/api/scan` admin gate + immediate timestamp** — 4 items.
8. **DB-backed counter table `feature_usage_log`** — 2 items.
9. **Hover preview plan-check + per-user rate-limit** — 2 items.
10. **Proactive Google healthcheck + counter reset** — 3 items.
11. **Focus trap implementation** — 5 modal callsites.
12. **Admin observability persistence migration** — 4 items.
13. **Standardized error visibility** (ADM-001 + UX-001 + BOT-003 + **PROD-006** admin TG crash alerts) — 5 items.
14. **URL safety bundle** — 4 items.
15. **Bot resilience bundle** — 4 items.
16. **(NEW) Deploy hardening bundle** — **PROD-002 + PROD-003 + PROD-004** = 3 items одним PR (sync deploy.sh с .ps1 + add SPA validators pre-deploy + add backup-before-deploy + image version tagging + `--rollback` flag).
17. **(NEW) Cert+infrastructure visibility bundle** — **PROD-007 + PROD-008 + PROD-021** = 3 items (commit nginx config + cert expiry monitor + secret rotation SOP) — fixes «infrastructure config outside git» pattern.

Prod-specific overlap с предыдущими аудитами:
- **PROD-001 + PROD-005 + PROD-011 (backup)** ↔ DB-001/002/003/004 — prod-angle confirmation of all backup integrity findings. Same backlog #1.
- **PROD-006 (no Sentry + no TG admin alerts)** ↔ ADM-001 (silent errors) + UX-001 (Feed silent) + BOT-020 (no admin crash alert) = backlog #13 expansion.
- **PROD-008 (cert expiry no alert)** — new, narrow fix.
- **PROD-009 (TRUST_PROXY)** = SEC-003 prod confirm.
- **PROD-015 (LOG_LEVEL drift)** — new.
- **PROD-019 (disk guard reactive)** — extension ADM-004.
- **PROD-020 (cost in tokens not USD)** = COST-009 prod confirm.

Если приоритезировать **backup-rewrite bundle (#1, 8 items) + deploy-hardening (#16, 3 items) + cert+infra visibility (#17, 3 items) + standardized error visibility (#13, 5 items)** — закроется **~19 finding'ов из 9 этапов** одной серией PR. Это самый высокий ROI cluster from cross-audit work.

---

## Operational readiness verdict

**~55%**.

Что работает: container infrastructure baseline solid (tini PID 1 fix, USER node, multistage, healthcheck, resource limits, port loopback, named volumes, restart always, log size cap), graceful shutdown trifecta production-grade (SSE drain + re-entry + 15s hard-cap + Promise.allSettled), hard-fail env validation for 3 critical keys, structured JSON logger + PII masking + disk space guard reactive, healthcheck endpoints wired, AbortController pattern на LLM calls, .gitignore + .dockerignore comprehensive, deploy.ps1 with ServerAlive options + EvilCatPack EXCLUDE, DEPLOY.md 341 lines comprehensive.

Что брокен: **Disaster recovery практически 0%** (PROD-001/005/011 — backup stub + no restore docs + script name mismatch, cross-confirm DB-001/002/003/004). Deploy hygiene слабая (PROD-002/003/004 — sh drift + no pre-checks + no rollback). Infrastructure config outside git (PROD-007 — nginx config not in repo). Cert renewal без alerting (PROD-008). External error tracking absent (PROD-006). TRUST_PROXY documented but not implemented (PROD-009 = SEC-003).

Sustainable для current scale (~5-50 users, low frequency deploys). При scaling — без backup-rewrite + deploy hardening + cert monitoring → unrecoverable disasters становятся inevitable, не если но когда.

---

## Out of scope / Followups

- **App security** — Stage 1 done (TRUST_PROXY prod confirm here, SEC-007 prod confirm).
- **Pipeline** — Stage 2.
- **Billing** — Stage 3.
- **Cost** — Stage 4 (cost USD logging prod confirm).
- **DB schema/retention** — Stage 5 (backup integrity prod confirmation here).
- **Dashboard UX** — Stage 6.
- **Admin UX** — Stage 7 (maintenance gap prod confirmation).
- **TG bot** — Stage 8 (admin TG crash alert prod confirm).
- **Cat mascot** — Stage 10.
- **Code quality (SPA-trap protection extraction, dead code)** — Stage 11.
- **Documentation completeness** — Stage 12.

**Open assumptions** (`⚠ assumes` / `⚠ requires SSH verification`):
- nginx config 8 properties spec match (PROD-007) — unverifiable, SSH-required.
- certbot.timer running daily (PROD-008) — SSH-required.
- ufw rules deny incoming + allow 22/80/443 (assumed safe) — SSH-required.
- fail2ban active for SSH brute-force (PROD-030) — SSH-required.
- B2 bucket actually created + rclone config exists (DB-003) — SSH+B2 console required.
- `/root/.config/rclone/rclone.conf` exists/configured — SSH-required.
- SSH key-only + root disabled — SSH-required.

**Followup observability**: ни один subagent не запросил Bash на этом этапе — explicit Read/Grep инструкции работают consistently. Один subagent (env validation) занял ~65 минут (3924s) — outlier vs других. Возможно встретил большой `.env.example` + множественные cross-references. Sonnet был бы быстрее для multi-file consistency check tasks. Lesson confirmed (после Stage 8 same lesson).

---

## Action items для operator (SSH-required, outside agent scope)

Эти items требуют доступа на VPS, не могут быть verified от агента:

1. SSH + `cat /etc/nginx/sites-available/catalyst` — verify 8 spec properties match.
2. SSH + `systemctl status certbot.timer` — verify daily auto-renew running, `journalctl -u certbot.timer` — verify last successful renewal.
3. SSH + `cat /usr/local/bin/catalyst-backup.sh` — verify actual prod backup script (separate from `scripts/backup.sh`).
4. SSH + `ls -la /var/backups/catalyst/` — verify backups actually being created daily, gzip valid (`gzip -t *.gz`).
5. SSH + `rclone listremotes` — verify B2 remote configured, `rclone ls b2:catalystparser-prod-backups` — verify off-site backup present.
6. SSH + `ufw status verbose` — verify deny incoming + allow 22/80/443, no extra ports.
7. SSH + `systemctl status fail2ban` — verify SSH brute-force protection.
8. SSH + `cat /etc/ssh/sshd_config` — verify `PasswordAuthentication no`, `PermitRootLogin no` (или `prohibit-password`).
9. SSH + `rm -rf /root/Narrative-Parser/` — cleanup zombie pre-Docker clone.
10. External `openssl s_client -connect catalystparser.io:443 | openssl x509 -noout -dates` — verify cert expiry date.
11. External UptimeRobot signup + monitor https://catalystparser.io/api/health 5-min interval.
