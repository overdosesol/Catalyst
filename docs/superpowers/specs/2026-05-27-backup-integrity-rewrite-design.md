# Backup Integrity Rewrite — Design Spec

**Bundle**: #1 из `docs/audit/INDEX.md` (Tier 1, foundation)
**Date**: 2026-05-27
**Author**: brainstorm session (operator + sonnet)
**Status**: Approved, ready for writing-plans

---

## Goal

Закрыть оставшиеся critical/high gaps в backup integrity слое: добавить integrity checks (gzip + PRAGMA), задокументировать restore procedure, закоммитить prod-скрипт в репо, прогнать первый manual drill.

## Context — почему этот bundle первым

Audit-серия 2026-05-22..06-02 пометила DB-слой как **RED** (4 critical из 5 в проекте). После прямой проверки prod-инфры (см. brainstorm transcript 2026-05-27) реальное состояние оказалось мягче, чем audit заявлял:

| Finding (audit claim) | Реальное состояние на prod | Действие |
|---|---|---|
| DB-001 — `cp` вместо `sqlite3 .backup` | **Уже использует `sqlite3 .backup`** | closed (false-positive audit) |
| DB-002 — нет `gzip -t` integrity check | **Действительно нет** | **fix** |
| DB-003 — B2 не имплементирован | **rclone copy в `b2:catalystparser-prod-backups`, 21 файл ~149MB, lifecycle 30d+1d** | closed (false-positive audit) |
| DB-004 — restore не задокументирован, не тестировался | **DEPLOY.md без restore section, drill никогда не делался** | **fix** |
| PROD-001 — backup contract drift | **Prod-скрипт жив, но не в репо** | **fix** |
| PROD-005 — DEPLOY.md без recovery sections | **Совпадает с DB-004** | **fix (same edit)** |
| PROD-011 — backup script name mismatch | **Prod `/usr/local/bin/catalyst-backup.sh` vs repo `scripts/backup.sh` стаб** | **fix** |
| SD-9 — B2 declared, not implemented | **Implemented, но не виден в git** | **fix (через коммит prod-скрипта)** |
| SD-21 — backup script name mismatch | **Совпадает с PROD-011** | **fix (same)** |

**Итого реально открыто**: 2 critical + 3 high + 2 SD = 7 finding'ов.

## Bonus findings (из brainstorm-сессии, не было в audit)

Дополнительно обнаружены при прямом чтении prod-скрипта:

1. `set -o pipefail` отсутствует — rclone copy за tee всегда даёт exit 0, провал тихо
2. `PRAGMA integrity_check` не вызывается — corrupt source DB бэкапится как-есть, через 14d retention хорошие бэкапы удаляются
3. Failure notification отсутствует (out of scope, deferred to Bundle #15)
4. Logrotate для `/var/log/catalyst-backup*.log` отсутствует (out of scope, deferred to Bundle #6)
5. Lock-file (`flock`) отсутствует (out of scope, низкий риск при cron daily)

В bundle входят 1 и 2 (1 + 3 строки кода, риск ноль).

## Дополнительные fixes из code-quality review (применены в implementation)

Code-quality reviewer обнаружил что **`set -o pipefail` сам по себе НЕ ловит `rclone | tee`** — `tee` exit code (всегда 0) доминирует, ошибка rclone проскакивает. Это нивелировало основную цель quick-win 1. Также найдены три других gap'а. Все четыре fix'нуты:

| # | Fix | Severity | Lines added |
|---|---|---|---|
| RF-1 | `rclone copy ... \| tee ...` → `rclone copy ... >> log 2>&1` (прямой редирект, exit code пробрасывается) | CRITICAL | -1 / +1 |
| RF-2 | Validate `VOLUME_NAME` / `VOLUME_PATH` / DB file existence (3 guards с FATAL exits) | IMPORTANT | +3 guards |
| RF-3 | `stat -c%s` sanity check после `.backup` — fail если < 4096 байт (`.backup` имеет silent-success failure modes) | IMPORTANT | +6 lines |
| RF-4 | `ls -lh \| awk` → `du -sh \| cut -f1` (locale-stable size reporting) | NICE | -1 / +1 |

**Итого в финальном скрипте 7 hardening фишек** (3 из spec + 4 review-driven). Все mechanical fixes, не вводят новых dependencies, не меняют интерфейс/cron-контракт.

---

## Scope

### In-scope

- **Code**:
  - Создать `scripts/catalyst-backup.sh` = текущий prod-скрипт + 3 quick-wins
  - Удалить `scripts/backup.sh` (старый stub)
  - Обновить `deploy.ps1` и `deploy.sh` — добавить sync prod-скрипта на VPS

- **Docs**:
  - DEPLOY.md §6.5 Restore from backup (пошаговая)
  - DEPLOY.md §6.6 Quarterly restore drill (мануальная procedure)
  - `ai-context/SESSION_CONTEXT.md` — обновить Production posture: скрипт версионируется
  - `ai-context/WORKLOG.md` — entry с описанием bundle + closed findings list

- **Verification**:
  - Прогнать deploy на prod, убедиться что скрипт легло на VPS
  - Дождаться хотя бы одного успешного cron-прогона новой версии (03:30 UTC)
  - Прогнать manual drill, записать счётчики в WORKLOG

### Out-of-scope

- Failure notification (TG bot пинг) — Tier 2 Bundle #15
- Logrotate config — Tier 3 Bundle #6
- Scripted drill automation (`scripts/restore-drill.sh`) — после первого ручного, если решим автоматизировать
- Lock-file через flock — отложено
- Rewrite на Node — отвергнуто как over-engineering (см. Approach 3)

---

## Architecture

### Approach: minimal invasion (Approach 1 из brainstorm)

Targeted patches к existing prod-скрипту. Никаких новых lib-модулей, никаких abstractions, никаких новых runtime-зависимостей. Скрипт остаётся монолитом ~35 строк bash.

**Альтернативы отвергнуты**:
- Approach 2 (lib): over-engineering для 30 строк bash, YAGNI
- Approach 3 (Node rewrite): новый runtime в backup-path = новый failure mode, тестировать сложнее

### File map после фикса

| File | Status | Responsibility |
|---|---|---|
| `scripts/catalyst-backup.sh` | new | Production daily backup. Source of truth для prod, deploy syncs to `/usr/local/bin/catalyst-backup.sh` |
| `scripts/backup.sh` | deleted | Старый stub (dev-only, не использовался) |
| `deploy.ps1` | modified | Добавлен блок sync backup script (scp + chmod) |
| `deploy.sh` | modified | То же что `deploy.ps1`, sh версия |
| `DEPLOY.md` | modified | Новые секции §6.5 Restore + §6.6 Drill |
| `ai-context/SESSION_CONTEXT.md` | modified | Production posture: scripts/catalyst-backup.sh in repo, deploy syncs |
| `ai-context/WORKLOG.md` | modified (entry added) | Bundle #1 entry + first drill log line |

---

## Script changes (scripts/catalyst-backup.sh)

### Base — текущий prod-скрипт

```bash
#!/bin/bash
set -e
BACKUP_DIR=/var/backups/catalyst
DATE=$(date +%Y-%m-%d_%H-%M)
mkdir -p "$BACKUP_DIR"

VOLUME_NAME=$(docker inspect -f '{{ range .Mounts }}{{ if eq .Destination "/data" }}{{ .Name }}{{ end }}{{ end }}' catalyst-app)
VOLUME_PATH=$(docker volume inspect -f '{{ .Mountpoint }}' "$VOLUME_NAME")

sqlite3 "${VOLUME_PATH}/catalyst.db" ".backup '${BACKUP_DIR}/catalyst_${DATE}.db'"
gzip "${BACKUP_DIR}/catalyst_${DATE}.db"

find "$BACKUP_DIR" -name 'catalyst_*.db.gz' -mtime +14 -delete

BACKUP_FILE="${BACKUP_DIR}/catalyst_${DATE}.db.gz"
rclone copy "$BACKUP_FILE" b2:catalystparser-prod-backups/ --log-level INFO 2>&1 | tee -a /var/log/catalyst-backup-rclone.log

SIZE=$(ls -lh "${BACKUP_DIR}/catalyst_${DATE}.db.gz" | awk '{print $5}')
echo "$(date -Is) backup OK: catalyst_${DATE}.db.gz ($SIZE)"
```

### Quick-win 1: `set -o pipefail`

**Проблема**: `rclone copy ... 2>&1 | tee -a /var/log/...` — exit code пайпа = exit code tee (всегда 0). Если rclone падает (B2 недоступен, креды протухли, network), `set -e` не сработает, скрипт скажет «backup OK».

**Фикс**: добавить `set -o pipefail` в шапку:

```bash
#!/bin/bash
set -euo pipefail
```

(Также добавлен `-u` для undefined vars — defensive, ловит typos в переменных.)

### Quick-win 2: PRAGMA integrity_check pre-backup

**Проблема**: если БД на проде уже corrupt, `sqlite3 .backup` радостно скопирует corrupt. Через 14 дней retention хорошие бэкапы удалятся, останутся только corrupt → catastrophic data loss.

**Фикс**: перед `.backup` вызвать integrity check на source DB:

```bash
INTEGRITY=$(sqlite3 "${VOLUME_PATH}/catalyst.db" "PRAGMA integrity_check;")
if [ "$INTEGRITY" != "ok" ]; then
  echo "$(date -Is) FATAL: source DB integrity_check failed: $INTEGRITY" >&2
  exit 1
fi
```

При фейле — скрипт падает с exit 1, cron логирует, **вчерашний хороший бэкап остаётся в /var/backups/catalyst/** (не перезаписывается, не удаляется retention'ом). Оператор узнаёт по тому что cron-лог покажет FATAL.

### Quick-win 3: `gzip -t` integrity check

**Проблема**: если `gzip` сжал криво (диск переполнен, partial write, rare bug) — corrupt `.db.gz` уезжает на B2 как «успешный бэкап». При восстановлении узнаёшь что архив битый.

**Фикс**: после `gzip` сразу проверить:

```bash
gzip "${BACKUP_DIR}/catalyst_${DATE}.db"
gzip -t "${BACKUP_DIR}/catalyst_${DATE}.db.gz" || {
  echo "$(date -Is) FATAL: gzip integrity check failed for ${BACKUP_DIR}/catalyst_${DATE}.db.gz" >&2
  rm -f "${BACKUP_DIR}/catalyst_${DATE}.db.gz"
  exit 1
}
```

При фейле — удаляем corrupt архив (чтобы не уехал на B2 следующим rclone), exit 1, cron логирует.

### Финальная версия скрипта (after code review fixes)

```bash
#!/bin/bash
# Catalyst production daily backup
# Source of truth: scripts/catalyst-backup.sh in repo
# deploy.{sh,ps1} syncs it to /usr/local/bin/catalyst-backup.sh on VPS
# Invoked by cron: /etc/cron.d/catalyst-backup at 03:30 UTC daily

set -euo pipefail

BACKUP_DIR=/var/backups/catalyst
DATE=$(date +%Y-%m-%d_%H-%M)
mkdir -p "$BACKUP_DIR"

# Discover the catalyst-app /data volume mount path on host
VOLUME_NAME=$(docker inspect -f '{{ range .Mounts }}{{ if eq .Destination "/data" }}{{ .Name }}{{ end }}{{ end }}' catalyst-app)
[ -n "$VOLUME_NAME" ] || { echo "$(date -Is) FATAL: could not find /data mount for catalyst-app container" >&2; exit 1; }

VOLUME_PATH=$(docker volume inspect -f '{{ .Mountpoint }}' "$VOLUME_NAME")
[ -n "$VOLUME_PATH" ] || { echo "$(date -Is) FATAL: could not resolve volume path for $VOLUME_NAME" >&2; exit 1; }

[ -f "${VOLUME_PATH}/catalyst.db" ] || { echo "$(date -Is) FATAL: DB file not found at ${VOLUME_PATH}/catalyst.db" >&2; exit 1; }

# Pre-backup integrity check on source DB.
INTEGRITY=$(sqlite3 "${VOLUME_PATH}/catalyst.db" "PRAGMA integrity_check;")
if [ "$INTEGRITY" != "ok" ]; then
  echo "$(date -Is) FATAL: source DB integrity_check failed: $INTEGRITY" >&2
  exit 1
fi

# Hot backup using sqlite3 on host (locking-aware; safe even while app writes)
sqlite3 "${VOLUME_PATH}/catalyst.db" ".backup '${BACKUP_DIR}/catalyst_${DATE}.db'"

# Sanity: .backup can silently exit 0 with empty/missing dest in some failure modes
BACKUP_SIZE=$(stat -c%s "${BACKUP_DIR}/catalyst_${DATE}.db" 2>/dev/null || echo 0)
if [ "$BACKUP_SIZE" -lt 4096 ]; then
  echo "$(date -Is) FATAL: backup file missing or suspiciously small ($BACKUP_SIZE bytes)" >&2
  rm -f "${BACKUP_DIR}/catalyst_${DATE}.db"
  exit 1
fi

# Compress + verify gzip integrity.
gzip "${BACKUP_DIR}/catalyst_${DATE}.db"
gzip -t "${BACKUP_DIR}/catalyst_${DATE}.db.gz" || {
  echo "$(date -Is) FATAL: gzip integrity check failed for ${BACKUP_DIR}/catalyst_${DATE}.db.gz" >&2
  rm -f "${BACKUP_DIR}/catalyst_${DATE}.db.gz"
  exit 1
}

# Local retention: keep 14 days
find "$BACKUP_DIR" -name 'catalyst_*.db.gz' -mtime +14 -delete

# Off-site copy to Backblaze B2 (B2 lifecycle: 30d hide + 1d delete)
# NOTE: direct >> redirect (not `| tee`) — tee swallows rclone exit code under pipefail
BACKUP_FILE="${BACKUP_DIR}/catalyst_${DATE}.db.gz"
rclone copy "$BACKUP_FILE" b2:catalystparser-prod-backups/ --log-level INFO >> /var/log/catalyst-backup-rclone.log 2>&1

SIZE=$(du -sh "$BACKUP_FILE" | cut -f1)
echo "$(date -Is) backup OK: catalyst_${DATE}.db.gz ($SIZE)"
```

Diff vs prior prod: ~+25 строк (7 hardening features + комментарии). Verified live on prod 2026-05-26 — manual run succeeded, file uploaded to B2.

---

## Deploy integration

### Текущее состояние

`deploy.ps1` / `deploy.sh` копируют app code + .env на VPS, но НЕ трогают backup-скрипт. Скрипт живёт только на VPS, ни во VCS, ни в deploy pipeline.

### После фикса

Добавить в обе версии deploy блок sync backup script:

**deploy.ps1** (powershell):
```powershell
# Sync production backup script (single source of truth: scripts/catalyst-backup.sh)
Write-Host "Syncing catalyst-backup.sh to VPS..."
scp "$repoRoot\scripts\catalyst-backup.sh" "root@${VPS_HOST}:/usr/local/bin/catalyst-backup.sh"
ssh "root@${VPS_HOST}" "chmod +x /usr/local/bin/catalyst-backup.sh"
```

**deploy.sh** (bash, симметрично):
```bash
echo "Syncing catalyst-backup.sh to VPS..."
scp scripts/catalyst-backup.sh root@"${VPS_HOST}":/usr/local/bin/catalyst-backup.sh
ssh root@"${VPS_HOST}" "chmod +x /usr/local/bin/catalyst-backup.sh"
```

**Placement**: блок должен быть **до** запуска `docker compose up` (чтобы если deploy упадёт на app-rebuild, backup-скрипт всё равно остался синхронизирован).

**Idempotency**: scp всегда копирует, chmod всегда выполняется. Если скрипт не менялся — никаких side effects.

**Cron не меняется**: `/etc/cron.d/catalyst-backup` продолжает вызывать `/usr/local/bin/catalyst-backup.sh` как раньше.

---

## DEPLOY.md §6.5 Restore from backup

Новая секция, ~30 строк markdown. Структура:

```markdown
## 6.5. Restore from backup

Когда нужно: БД на проде сломалась / удалилась / прод-VPS погиб (восстанавливаем на новом).

### Step 1: Choose backup source

**Локальный (если VPS жив, БД сломалась)**:
```bash
ls -lh /var/backups/catalyst/
# Выбери последний catalyst_*.db.gz
```

**Off-site (если VPS погиб, восстанавливаем на новом)**:
```bash
# На новом VPS — настрой rclone с тем же B2 bucket
rclone ls b2:catalystparser-prod-backups/
rclone copy b2:catalystparser-prod-backups/catalyst_YYYY-MM-DD_HH-MM.db.gz /tmp/
```

### Step 2: Verify archive integrity

```bash
gzip -t /tmp/catalyst_YYYY-MM-DD_HH-MM.db.gz
# Exit code 0 = OK. Иначе — пробуй предыдущий бэкап.
```

### Step 3: Extract

```bash
gunzip -k /tmp/catalyst_YYYY-MM-DD_HH-MM.db.gz
# -k чтобы оставить .gz исходник на всякий случай
mv /tmp/catalyst_YYYY-MM-DD_HH-MM.db /tmp/restore.db
```

### Step 4: Verify DB integrity

```bash
sqlite3 /tmp/restore.db "PRAGMA integrity_check;"
# Должно быть "ok"
```

### Step 5: Stop container

```bash
docker compose stop app
```

### Step 6: Replace DB file (safe variant — сохраняем старый)

```bash
# Discover volume mount path (та же логика что в backup-скрипте)
VOLUME_NAME=$(docker inspect -f '{{ range .Mounts }}{{ if eq .Destination "/data" }}{{ .Name }}{{ end }}{{ end }}' catalyst-app)
VOLUME_PATH=$(docker volume inspect -f '{{ .Mountpoint }}' "$VOLUME_NAME")

# Save current ownership before move (для восстановления после)
ORIG_OWNER=$(stat -c '%u:%g' "$VOLUME_PATH/catalyst.db")

# Move broken files в сторону (не удаляем!)
TS=$(date +%s)
mv "$VOLUME_PATH/catalyst.db"     "$VOLUME_PATH/catalyst.db.broken-$TS"
mv "$VOLUME_PATH/catalyst.db-wal" "$VOLUME_PATH/catalyst.db-wal.broken-$TS" 2>/dev/null || true
mv "$VOLUME_PATH/catalyst.db-shm" "$VOLUME_PATH/catalyst.db-shm.broken-$TS" 2>/dev/null || true

# Put restored DB в место старой, восстановить ownership
cp /tmp/restore.db "$VOLUME_PATH/catalyst.db"
chown "$ORIG_OWNER" "$VOLUME_PATH/catalyst.db"
```

**Note**: UID/GID берётся со старого файла, не хардкодим. Если контейнер запускается под non-root user (TBD в Dockerfile review) — ownership сохранится корректно.

### Step 7: Start container

```bash
docker compose start app
docker compose logs -f app  # убедись что стартовал без ошибок
```

### Step 8: Smoke check

- `curl https://catalyst.example.com/api/health` → 200
- Открыть дашборд → видны trends/users из бэкапа
- Telegram бот → команда `/start` → отвечает

### Step 9: После подтверждения работы

Удалить `.broken-*` файлы из volume и `/tmp/restore.db`. Записать в WORKLOG.
```

---

## DEPLOY.md §6.6 Quarterly restore drill

Новая секция, ~20 строк markdown.

```markdown
## 6.6. Quarterly restore drill

Цель: убедиться что бэкапы реально восстанавливаемы, до того как реальная беда. Раз в квартал, ~20 минут.

### Procedure

1. Взять самый свежий бэкап с **B2** (а не локальный — drill имитирует «VPS умер, есть только B2»):

```bash
rclone copy b2:catalystparser-prod-backups/$(rclone lsf b2:catalystparser-prod-backups/ | tail -1) /tmp/drill/
```

2. Проверить gzip integrity:

```bash
gzip -t /tmp/drill/*.db.gz
```

3. Распаковать:

```bash
gunzip /tmp/drill/*.db.gz
```

4. Прогнать PRAGMA integrity_check:

```bash
sqlite3 /tmp/drill/*.db "PRAGMA integrity_check;"
# Должно быть "ok"
```

5. Прогнать row counts по ключевым таблицам:

```bash
sqlite3 /tmp/drill/*.db "
SELECT 'users',         COUNT(*) FROM users
UNION ALL SELECT 'trends',        COUNT(*) FROM trends
UNION ALL SELECT 'notifications', COUNT(*) FROM notifications
UNION ALL SELECT 'payments',      COUNT(*) FROM payments;
"
```

Глазами сверь — цифры разумные? Растут с прошлого drill?

6. Очистка:

```bash
rm -rf /tmp/drill/
```

7. Запись в WORKLOG:

```
## YYYY-MM-DD · drill · OK · users=NNN trends=NNN alerts=NNN events=NNN
```

Если на любом шаге что-то не сошлось — паника, проверь предыдущий бэкап / разбирайся почему гниёт.
```

---

## SESSION_CONTEXT.md update

Производственная секция Production posture (поищем по тексту):

**Before**:
> Daily backup (`/usr/local/bin/catalyst-backup.sh`): cron 03:30 UTC. Discover'ит mountpoint... [текущий текст]

**After**:
> Daily backup: cron 03:30 UTC. Source of truth: `scripts/catalyst-backup.sh` в репо, `deploy.{sh,ps1}` копирует на VPS в `/usr/local/bin/catalyst-backup.sh` при каждом deploy. Discover'ит mountpoint named volume `catalyst_data` через `docker inspect`, **PRAGMA integrity_check на исходной БД**, `sqlite3 .backup` (locking-aware), gzip → `/var/backups/catalyst/`, **gzip -t verify**. Local retention 14 дней. Off-site copy на Backblaze B2 (`b2:catalystparser-prod-backups`, ~$0.03/мес), `rclone copy` после gzip, лог `/var/log/catalyst-backup-rclone.log`. B2 lifecycle: hide files after 30 days + delete 1 day later. rclone config в `/root/.config/rclone/rclone.conf` (root-only, не в git). Скрипт использует `set -euo pipefail` — провал rclone не тонет в tee. Restore procedure: DEPLOY.md §6.5. Quarterly drill: DEPLOY.md §6.6.

---

## Acceptance criteria

Bundle #1 closed, когда все пункты OK:

### Code & deploy

- [ ] `scripts/catalyst-backup.sh` в репо, содержит финальную версию (см. секцию Script changes)
- [ ] `scripts/backup.sh` удалён из репо
- [ ] `deploy.ps1` содержит блок sync backup script (до docker compose up)
- [ ] `deploy.sh` содержит симметричный блок sync backup script
- [ ] Прогнан `./deploy.ps1 prod` (или sh), без ошибок
- [ ] Ssh-проверка: `cat /usr/local/bin/catalyst-backup.sh` на VPS показывает свежую версию (с pipefail, PRAGMA, gzip -t)
- [ ] Дождались хотя бы одного ночного cron-прогона (03:30 UTC) после deploy, `cat /var/log/catalyst-backup.log` показывает `backup OK` без ошибок

### Docs

- [ ] DEPLOY.md §6.5 Restore from backup написан, шаги 1-9
- [ ] DEPLOY.md §6.6 Quarterly drill написан, шаги 1-7
- [ ] `ai-context/SESSION_CONTEXT.md` Production posture обновлён (текст из секции выше)
- [ ] `ai-context/WORKLOG.md` — entry о Bundle #1 (дата, файлы, closed findings, drill результат)

### Verification — first drill (acceptance gate)

Прогнать DEPLOY.md §6.6 procedure от начала до конца. Результат:

- [ ] gzip -t OK
- [ ] PRAGMA integrity_check = `ok`
- [ ] Row counts получены, выглядят разумно
- [ ] WORKLOG записал drill OK строку с цифрами

### Closed findings

В финальном WORKLOG entry перечислить closed:
- DB-002 (gzip -t added)
- DB-004 (restore documented + first drill passed)
- PROD-001 (script versioned in repo)
- PROD-005 (DEPLOY.md restore section added)
- PROD-011 (script name unified: `catalyst-backup.sh`)
- SD-9 (B2 contract now matches: declared + implemented + versioned)
- SD-21 (script name resolved)

### Bonus quick-wins (informational, не отдельная acceptance gate)

- `set -euo pipefail` добавлен
- PRAGMA integrity_check pre-backup добавлен

---

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Deploy с новым скриптом сломает cron (синтаксис, права) | Сначала прогнать новый скрипт руками на VPS: `bash /usr/local/bin/catalyst-backup.sh`. Только после успешного ручного прогона дать cron'у запуститься ночью. |
| PRAGMA integrity_check возьмёт время на больших БД | На текущем размере (~9 MB gzipped ≈ 50-80 MB raw) — секунды. Если БД вырастет до GB — пересмотреть, но это далеко. |
| `set -u` (undefined vars) поломает рабочую логику | Проверить весь скрипт глазами на использование переменных через `${VAR:-default}` если нужно. В текущей версии всё определено. |
| Restore drill уронит дашборд | Drill **только распаковывает в /tmp/drill/**, никак не трогает прод-БД. Безопасно. |
| Первый деплой нового скрипта попадёт на cron-окно | deploy.ps1 запускают днём, cron в 03:30 UTC — гарантированный gap. |

---

## Estimated effort

- Script changes: 30 минут
- Deploy.ps1/sh update: 30 минут
- DEPLOY.md §6.5 + §6.6: 1 час
- SESSION_CONTEXT update: 15 минут
- Deploy + monitor first cron run: 30 минут (асинхронно, ждать ночь)
- First drill execution: 20-30 минут

**Total**: ~3-4 часа active work + 1 ночь ожидания cron-прогона.

---

## Open questions

Все решены в brainstorm-сессии 2026-05-27. Перечень для записи:

- Q1: Scope (Core / Core+Quick-wins / Full hardening)? → **Core + Quick-wins**
- Q2: Drill formalization (manual / scripted / automated)? → **Manual**
- Q3: Deploy sync strategy (auto / separate command / docs only)? → **Auto (every deploy)**
- Q4: Approach (minimal invasion / lib / Node rewrite)? → **Minimal invasion (Approach 1)**

---

## Out-of-scope (для будущих bundles)

- **Bundle #15 (Tier 2, Bot resilience)** — failure notification: при exit != 0 cron-скрипта TG бот пингует оператора
- **Bundle #6 (Tier 3, Housekeeping)** — logrotate для `/var/log/catalyst-backup*.log`
- **Будущий polish** — `scripts/restore-drill.sh` если ручной drill окажется хлопотным
- **Будущий polish** — `flock` lock-file (риск двойного cron-запуска низкий, но не нулевой)
- **Будущий polish** — pre-backup disk space check

---

## Transition

После approve этого spec — invoke `superpowers:writing-plans` для генерации implementation plan с пошаговыми задачами (bite-sized, TDD-friendly где применимо, exact file paths + code blocks).
