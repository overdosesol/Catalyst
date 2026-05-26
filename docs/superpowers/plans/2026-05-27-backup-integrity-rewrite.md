# Backup Integrity Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Закрыть оставшиеся critical/high backup-related findings (DB-002, DB-004, PROD-001/005/011, SD-9/21) добавлением integrity checks в prod backup-скрипт, версионированием скрипта в репо, документацией restore procedure + первым ручным drill.

**Architecture:** Minimal-invasion approach — targeted patches к existing prod-скрипту (`set -euo pipefail`, `PRAGMA integrity_check`, `gzip -t`), новый файл `scripts/catalyst-backup.sh` как source of truth, deploy.ps1/sh автосинхронит его на VPS в `/usr/local/bin/`. Plus два новых раздела в DEPLOY.md (restore + drill procedures).

**Tech Stack:** Bash, SQLite, gzip, rclone (Backblaze B2), PowerShell (deploy.ps1), Docker, cron.

**Spec reference:** `docs/superpowers/specs/2026-05-27-backup-integrity-rewrite-design.md`

---

## File Structure

### Files created
- `scripts/catalyst-backup.sh` — production backup script (one source of truth, ~37 lines bash)

### Files deleted
- `scripts/backup.sh` — старый dev-stub (cp-based, не использовался в prod)

### Files modified
- `deploy.ps1` — добавлен блок sync backup script на VPS (~4 строки)
- `deploy.sh` — симметричный sync блок
- `DEPLOY.md` — новые секции §6.5 (Restore) + §6.6 (Quarterly drill)
- `ai-context/SESSION_CONTEXT.md` — обновлена production posture секция (one paragraph)
- `ai-context/WORKLOG.md` — entry о Bundle #1

### Files NOT touched
- `src/server.js`, `src/admin/server.js` — не трогаем, SPA validators не нужны
- Schema/DB files — read-only access (drill только read)
- `docker-compose.yml`, `Dockerfile` — backup-логика снаружи контейнера

---

## Task Order Rationale

1. Core script (T1) — самый важный, делает всё остальное полезным
2. Stub cleanup (T2) — расчищаем чтобы не было путаницы
3. Deploy sync (T3, T4) — позволяет prod подхватывать изменения
4. Docs (T5, T6) — критично для restore сценария
5. SESSION_CONTEXT (T7) — чтоб новые сессии знали правду
6. Deploy + verify (T8) — выкатываем + проверяем cron-прогон
7. Drill (T9) — final acceptance gate

T1-T7 можно делать в одной серии PR'ов, T8-T9 требуют живой VPS + ожидание ночи (cron 03:30 UTC).

---

## Task 1: Create `scripts/catalyst-backup.sh`

**Files:**
- Create: `scripts/catalyst-backup.sh`

- [ ] **Step 1: Write the new script file**

Создать файл `scripts/catalyst-backup.sh` с следующим содержимым:

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
VOLUME_PATH=$(docker volume inspect -f '{{ .Mountpoint }}' "$VOLUME_NAME")

# Pre-backup integrity check on source DB.
# If source already corrupt — fail without overwriting yesterday's good backup.
INTEGRITY=$(sqlite3 "${VOLUME_PATH}/catalyst.db" "PRAGMA integrity_check;")
if [ "$INTEGRITY" != "ok" ]; then
  echo "$(date -Is) FATAL: source DB integrity_check failed: $INTEGRITY" >&2
  exit 1
fi

# Hot backup using sqlite3 on host (locking-aware; safe even while app writes)
sqlite3 "${VOLUME_PATH}/catalyst.db" ".backup '${BACKUP_DIR}/catalyst_${DATE}.db'"

# Compress + verify gzip integrity. Если архив битый — удалить и упасть.
gzip "${BACKUP_DIR}/catalyst_${DATE}.db"
gzip -t "${BACKUP_DIR}/catalyst_${DATE}.db.gz" || {
  echo "$(date -Is) FATAL: gzip integrity check failed for ${BACKUP_DIR}/catalyst_${DATE}.db.gz" >&2
  rm -f "${BACKUP_DIR}/catalyst_${DATE}.db.gz"
  exit 1
}

# Local retention: keep 14 days
find "$BACKUP_DIR" -name 'catalyst_*.db.gz' -mtime +14 -delete

# Off-site copy to Backblaze B2 (B2 lifecycle rule handles its own retention: 30d hide + 1d delete)
BACKUP_FILE="${BACKUP_DIR}/catalyst_${DATE}.db.gz"
rclone copy "$BACKUP_FILE" b2:catalystparser-prod-backups/ --log-level INFO 2>&1 | tee -a /var/log/catalyst-backup-rclone.log

SIZE=$(ls -lh "$BACKUP_FILE" | awk '{print $5}')
echo "$(date -Is) backup OK: catalyst_${DATE}.db.gz ($SIZE)"
```

- [ ] **Step 2: Make it executable**

```bash
chmod +x scripts/catalyst-backup.sh
```

Verify:
```bash
ls -l scripts/catalyst-backup.sh
```
Expected: `-rwxr-xr-x ... scripts/catalyst-backup.sh`

- [ ] **Step 3: Syntax check (no execution)**

```bash
bash -n scripts/catalyst-backup.sh
```

Expected: exit code 0, no output (means bash parsing succeeded).

If you have `shellcheck` installed (optional):
```bash
shellcheck scripts/catalyst-backup.sh
```

Expected: no errors. `set -u` warnings on `${VAR}` без default — это OK, у нас все vars defined ранее в скрипте.

- [ ] **Step 4: Commit**

```bash
git add scripts/catalyst-backup.sh
git commit -m "feat(backup): add prod backup script to repo with integrity checks

Versions the production backup script that previously lived only on VPS.
Adds three integrity hardening features over the prior prod version:
- set -euo pipefail (rclone failures no longer hidden by tee)
- PRAGMA integrity_check on source DB (no overwriting good backups with corrupt)
- gzip -t verify after compression (no corrupt archives uploaded to B2)

Closes part of Bundle #1 (DB-002 partial, PROD-001 partial, SD-9 partial).
See docs/superpowers/specs/2026-05-27-backup-integrity-rewrite-design.md"
```

---

## Task 2: Delete `scripts/backup.sh` stub

**Files:**
- Delete: `scripts/backup.sh`

- [ ] **Step 1: Confirm the stub exists and is what we expect**

```bash
cat scripts/backup.sh
```

Expected: a short bash script that does `cp` of `.data/catalyst.db` to `.backups/`. If you see anything else (e.g. it's been edited) — stop and ask the operator before deleting.

- [ ] **Step 2: Delete the file**

```bash
git rm scripts/backup.sh
```

Verify:
```bash
ls scripts/backup.sh 2>&1
```
Expected: `ls: cannot access 'scripts/backup.sh': No such file or directory`

- [ ] **Step 3: Verify nothing in repo references the old path**

```bash
grep -rn "scripts/backup.sh" .
```
Expected: no matches (or only matches inside `WORKLOG_ARCHIVE.md` historical notes — those are fine, history doesn't need rewriting).

If `package.json` or `deploy.{ps1,sh}` mentioned `scripts/backup.sh` — also fix that reference now.

- [ ] **Step 4: Commit**

```bash
git commit -m "chore(backup): remove unused scripts/backup.sh stub

The dev cp-based stub was never used in prod (cron calls /usr/local/bin/catalyst-backup.sh).
The new scripts/catalyst-backup.sh is the single source of truth.

Closes part of Bundle #1 (PROD-011, SD-21 — name unification)."
```

---

## Task 3: Update `deploy.ps1` to sync backup script

**Files:**
- Modify: `deploy.ps1` (insert block before line 86 — the ssh execution call)

- [ ] **Step 1: Read current deploy.ps1 to confirm insertion point**

```bash
sed -n '80,90p' deploy.ps1
```

Expected: you should see scp calls finishing (around line 75 — `$SETUP_FILE`) and then the ssh execution block around line 86. The insertion point is **AFTER all existing scp calls but BEFORE the ssh executes** the remote setup.

- [ ] **Step 2: Find the exact line where ssh executes**

```bash
grep -n "ssh -o StrictHostKeyChecking" deploy.ps1
```

Expected output: line ~86 with `ssh -o StrictHostKeyChecking=no -o ServerAliveInterval=30 ...`

Note the line number — call it `$SSH_LINE`.

- [ ] **Step 3: Insert sync block**

Edit `deploy.ps1`. **Just before** the line `$remoteCmd = "mkdir -p '$RemoteDir' && REMOTE_DIR=...` (around line 85), insert:

```powershell
# === Sync production backup script (single source of truth: scripts/catalyst-backup.sh) ===
Write-Host "Syncing catalyst-backup.sh to VPS..."
scp -o StrictHostKeyChecking=no "scripts/catalyst-backup.sh" "${Server}:/usr/local/bin/catalyst-backup.sh"
if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: failed to scp catalyst-backup.sh"; exit 1 }
ssh -o StrictHostKeyChecking=no $Server "chmod +x /usr/local/bin/catalyst-backup.sh"
if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: failed to chmod catalyst-backup.sh"; exit 1 }
Write-Host "Backup script synced."
# === End backup sync ===

```

(Note the blank line at the end — to visually separate from the next block.)

- [ ] **Step 4: PowerShell syntax check**

```bash
pwsh -Command "Get-Command -Syntax (Get-Content -Raw deploy.ps1)" 2>&1 | head -5
```

If `pwsh` not available locally, alternative — open the file in editor and visually check the inserted block has correct PowerShell syntax (no smart quotes, `$Server` and `$LASTEXITCODE` referenced correctly).

Better validation:
```bash
pwsh -NoProfile -Command "& { . ./deploy.ps1 -Server 'root@dummy-host' -WhatIf } 2>&1" | head -20
```

Expected: script starts but eventually fails to connect to `dummy-host` — that's fine, we're only testing parsing. Errors about ssh/scp are OK, errors about `ParseError` or `MissingEndCurlyBrace` are NOT OK.

If pwsh isn't installed at all on dev machine, skip this step — operator will verify on actual deploy.

- [ ] **Step 5: Commit**

```bash
git add deploy.ps1
git commit -m "feat(deploy): sync catalyst-backup.sh to VPS via deploy.ps1

Every deploy now copies scripts/catalyst-backup.sh -> /usr/local/bin/catalyst-backup.sh
on the VPS and ensures it's executable. Idempotent — unchanged file is just re-copied.

Eliminates the drift between repo-version and prod-version of the backup script.

Closes part of Bundle #1 (PROD-001, SD-9)."
```

---

## Task 4: Update `deploy.sh` (symmetric)

**Files:**
- Modify: `deploy.sh` (insert block before line 34 — the ssh execution call)

- [ ] **Step 1: Read current deploy.sh**

```bash
sed -n '30,38p' deploy.sh
```

Expected: scp of setup_remote.sh around line 33, ssh execution at line 34.

- [ ] **Step 2: Insert sync block**

Edit `deploy.sh`. **Just before** the line `ssh -o StrictHostKeyChecking=no "$SERVER" "REMOTE_DIR='$REMOTE_DIR' bash /tmp/catalyst_setup.sh"`, insert:

```bash
# === Sync production backup script (single source of truth: scripts/catalyst-backup.sh) ===
echo "Syncing catalyst-backup.sh to VPS..."
scp -o StrictHostKeyChecking=no scripts/catalyst-backup.sh "$SERVER:/usr/local/bin/catalyst-backup.sh"
ssh -o StrictHostKeyChecking=no "$SERVER" "chmod +x /usr/local/bin/catalyst-backup.sh"
echo "Backup script synced."
# === End backup sync ===

```

Note: `deploy.sh` likely uses `set -e` at top (verify with `head -3 deploy.sh`) — if so, any scp/ssh failure will abort deploy automatically, no need for explicit exit checks.

- [ ] **Step 3: Syntax check**

```bash
bash -n deploy.sh
```

Expected: exit 0, no output.

- [ ] **Step 4: Commit**

```bash
git add deploy.sh
git commit -m "feat(deploy): sync catalyst-backup.sh to VPS via deploy.sh

Symmetric to deploy.ps1 change in previous commit. Linux operators get the
same auto-sync behavior."
```

---

## Task 5: Add `DEPLOY.md` §6.5 Restore from backup

**Files:**
- Modify: `DEPLOY.md` (insert §6.5 before line 208 — the `---` separator)

- [ ] **Step 1: Confirm insertion point**

```bash
sed -n '204,212p' DEPLOY.md
```

Expected:
```
204: For off-host backups, push the dump to S3/Backblaze/your-NAS via rsync or
205: `aws s3 cp`. Avoid copying the file directly while the bot is running —
206: SQLite WAL mode tolerates it but `sqlite3 ".backup"` is safer.
207:
208: ---
209:
210: ## 7. ...
```

Insertion point: **after line 206 (the period ending §6 text), before line 208 (the `---`)**.

- [ ] **Step 2: Insert §6.5 section**

Place the cursor after line 206 (the line ending with `safer.`) and add:

```markdown

### 6.5. Restore from backup

Когда нужно: БД на проде сломалась / удалилась / прод-VPS погиб и восстанавливаем на новом.

**Step 1 — Choose backup source**

Локальный (если VPS жив):
```bash
ls -lh /var/backups/catalyst/
# Выбери последний catalyst_*.db.gz
```

Off-site (если VPS погиб):
```bash
# На новом VPS — настрой rclone с тем же B2 bucket
rclone ls b2:catalystparser-prod-backups/
rclone copy b2:catalystparser-prod-backups/catalyst_YYYY-MM-DD_HH-MM.db.gz /tmp/
```

**Step 2 — Verify archive integrity**

```bash
gzip -t /tmp/catalyst_YYYY-MM-DD_HH-MM.db.gz
# Exit 0 = OK. Иначе — пробуй предыдущий бэкап.
```

**Step 3 — Extract**

```bash
gunzip -k /tmp/catalyst_YYYY-MM-DD_HH-MM.db.gz
mv /tmp/catalyst_YYYY-MM-DD_HH-MM.db /tmp/restore.db
```

**Step 4 — Verify DB integrity**

```bash
sqlite3 /tmp/restore.db "PRAGMA integrity_check;"
# Должно быть "ok"
```

**Step 5 — Stop container**

```bash
cd /opt/catalyst
docker compose stop app
```

**Step 6 — Replace DB file (safe variant — сохраняем старый)**

```bash
# Discover volume mount path (same logic as backup script)
VOLUME_NAME=$(docker inspect -f '{{ range .Mounts }}{{ if eq .Destination "/data" }}{{ .Name }}{{ end }}{{ end }}' catalyst-app)
VOLUME_PATH=$(docker volume inspect -f '{{ .Mountpoint }}' "$VOLUME_NAME")

# Save current ownership so we can restore it
ORIG_OWNER=$(stat -c '%u:%g' "$VOLUME_PATH/catalyst.db")

# Move broken files aside (don't delete them yet)
TS=$(date +%s)
mv "$VOLUME_PATH/catalyst.db"     "$VOLUME_PATH/catalyst.db.broken-$TS"
mv "$VOLUME_PATH/catalyst.db-wal" "$VOLUME_PATH/catalyst.db-wal.broken-$TS" 2>/dev/null || true
mv "$VOLUME_PATH/catalyst.db-shm" "$VOLUME_PATH/catalyst.db-shm.broken-$TS" 2>/dev/null || true

# Put restored DB into place, restore ownership
cp /tmp/restore.db "$VOLUME_PATH/catalyst.db"
chown "$ORIG_OWNER" "$VOLUME_PATH/catalyst.db"
```

**Step 7 — Start container**

```bash
docker compose start app
docker compose logs -f app  # check startup is clean
```

**Step 8 — Smoke check**

- `curl https://catalystparser.io/api/health` → 200
- Открой дашборд в браузере → видны trends/users из бэкапа
- Telegram бот → `/start` → отвечает

**Step 9 — Cleanup after confirmed success**

```bash
rm "$VOLUME_PATH"/catalyst.db.broken-*
rm "$VOLUME_PATH"/catalyst.db-wal.broken-* 2>/dev/null || true
rm "$VOLUME_PATH"/catalyst.db-shm.broken-* 2>/dev/null || true
rm /tmp/restore.db /tmp/catalyst_*.db.gz
```

Запиши в `ai-context/WORKLOG.md`: дата, причина, какой бэкап восстанавливали, smoke check result.

```

(End of §6.5 block.)

- [ ] **Step 3: Verify markdown structure**

```bash
grep -n "^### 6.5" DEPLOY.md
grep -n "^---" DEPLOY.md
```

Expected: `### 6.5. Restore from backup` появилась перед строкой с `---` (которая теперь сдвинулась вниз).

- [ ] **Step 4: Commit**

```bash
git add DEPLOY.md
git commit -m "docs(deploy): add §6.5 Restore from backup procedure

9-step restore procedure covering both local-disk and B2 off-site sources.
Includes integrity verification, safe DB file replacement (keeps broken aside),
smoke check, and cleanup.

Closes part of Bundle #1 (DB-004 partial, PROD-005 partial)."
```

---

## Task 6: Add `DEPLOY.md` §6.6 Quarterly drill

**Files:**
- Modify: `DEPLOY.md` (insert §6.6 immediately after §6.5)

- [ ] **Step 1: Confirm §6.5 was added**

```bash
grep -n "^### 6.5\|^### 6.6\|^---" DEPLOY.md | head -10
```

Expected: §6.5 present, no §6.6 yet, then `---` separator further down.

- [ ] **Step 2: Insert §6.6 section**

Right after the §6.5 "Запиши в WORKLOG..." line, **before** the `---`, insert:

```markdown

### 6.6. Quarterly restore drill

Цель: убедиться что бэкапы реально восстанавливаемы **до** того как реальная беда. Раз в квартал, ~20 минут.

**Step 1 — Pull the latest backup from B2** (имитируем «VPS умер, есть только B2»)

```bash
mkdir -p /tmp/drill
LATEST=$(rclone lsf b2:catalystparser-prod-backups/ | sort | tail -1)
rclone copy "b2:catalystparser-prod-backups/$LATEST" /tmp/drill/
echo "Drill file: /tmp/drill/$LATEST"
```

**Step 2 — Verify gzip integrity**

```bash
gzip -t /tmp/drill/*.db.gz
```

Expected: exit 0, no output.

**Step 3 — Extract**

```bash
gunzip /tmp/drill/*.db.gz
```

**Step 4 — Run PRAGMA integrity_check**

```bash
sqlite3 /tmp/drill/*.db "PRAGMA integrity_check;"
```

Expected: `ok`. Anything else — паника, проверь предыдущие бэкапы.

**Step 5 — Row counts across core tables**

```bash
sqlite3 /tmp/drill/*.db "
SELECT 'users',         COUNT(*) FROM users
UNION ALL SELECT 'trends',        COUNT(*) FROM trends
UNION ALL SELECT 'notifications', COUNT(*) FROM notifications
UNION ALL SELECT 'payments',      COUNT(*) FROM payments;
"
```

Глазами сверь — цифры разумные? Растут с прошлого drill?

**Step 6 — Cleanup**

```bash
rm -rf /tmp/drill/
```

**Step 7 — Record result in WORKLOG**

```markdown
## YYYY-MM-DD · drill · OK · users=NNN trends=NNN notifications=NNN payments=NNN
```

Если на любом шаге что-то не сошлось — паника: проверь предыдущий бэкап, разбирайся почему БД гниёт.

```

- [ ] **Step 3: Verify markdown**

```bash
grep -n "^### 6.5\|^### 6.6\|^---" DEPLOY.md | head -10
```

Expected: both `### 6.5` and `### 6.6` present, then `---`.

- [ ] **Step 4: Commit**

```bash
git add DEPLOY.md
git commit -m "docs(deploy): add §6.6 Quarterly restore drill procedure

7-step manual drill that operator runs once a quarter to verify backups
are actually restorable (not just exist). Pulls latest from B2, verifies
integrity at archive + DB + row count levels, records to WORKLOG.

Closes part of Bundle #1 (DB-004 partial)."
```

---

## Task 7: Update `ai-context/SESSION_CONTEXT.md` Production posture

**Files:**
- Modify: `ai-context/SESSION_CONTEXT.md` (replace one bullet point around line 748)

- [ ] **Step 1: Find the exact bullet**

```bash
grep -n "Daily backup" ai-context/SESSION_CONTEXT.md
```

Expected: a single match around line 748 (or nearby — file may have shifted slightly).

```bash
sed -n '745,760p' ai-context/SESSION_CONTEXT.md
```

You'll see a bullet starting with `**Daily backup**` (a multi-line bullet). Read it fully so you know exactly what to replace.

- [ ] **Step 2: Replace the bullet**

Use Edit tool. The OLD text (multi-line) starts with `- **Daily backup** (` and ends with `(root-only).` — replace the entire bullet with:

```markdown
- **Daily backup**: cron 03:30 UTC (`/etc/cron.d/catalyst-backup`). Source of truth: `scripts/catalyst-backup.sh` в репо, `deploy.{sh,ps1}` копирует его в `/usr/local/bin/catalyst-backup.sh` на VPS при каждом deploy (idempotent). Скрипт: discover'ит mountpoint named volume `catalyst_data` через `docker inspect`, **PRAGMA integrity_check** на исходной БД (если corrupt — fail без перезаписи вчерашнего хорошего бэкапа), `sqlite3 .backup` (locking-aware), gzip → `/var/backups/catalyst/`, **gzip -t verify** (если архив битый — удалить + fail). Local retention 14 дней. Off-site: `rclone copy` на Backblaze B2 (`b2:catalystparser-prod-backups`, ~$0.03/мес), лог `/var/log/catalyst-backup-rclone.log`. B2 lifecycle: hide files after 30 days + delete 1 day later (auto-cleanup). rclone config в `/root/.config/rclone/rclone.conf` (root-only, не в git). Скрипт использует `set -euo pipefail` — провал rclone не тонет в `tee`. **Restore procedure**: DEPLOY.md §6.5. **Quarterly drill**: DEPLOY.md §6.6.
```

- [ ] **Step 3: Verify replacement**

```bash
grep -A1 "Daily backup" ai-context/SESSION_CONTEXT.md | head -3
```

Expected: should see the new wording (mentions "Source of truth", "PRAGMA integrity_check", "gzip -t verify", "set -euo pipefail", DEPLOY.md §6.5/§6.6).

- [ ] **Step 4: Commit**

```bash
git add ai-context/SESSION_CONTEXT.md
git commit -m "docs(session): update Production posture backup paragraph

Reflects new state after Bundle #1:
- Script versioned in scripts/catalyst-backup.sh
- Deploy syncs to /usr/local/bin/ on every deploy
- PRAGMA integrity_check + gzip -t verify + set -euo pipefail
- Pointers to DEPLOY.md §6.5/§6.6 for restore/drill procedures

Closes part of Bundle #1 (SD-9 — B2 contract now matches docs + code)."
```

---

## Task 8: Deploy & verify cron run (operator-driven)

This task involves the production VPS. The operator runs it; agent only verifies output if asked.

**Files:**
- No files modified in this task — purely deployment + verification

- [ ] **Step 1: Operator runs deploy**

On the dev machine:
```powershell
./deploy.ps1
```

Expected output: "Syncing catalyst-backup.sh to VPS..." → "Backup script synced." → followed by the rest of the deploy.

If you see `ERROR: failed to scp catalyst-backup.sh` — abort, fix the issue (likely a missing file or ssh-key problem) before continuing.

- [ ] **Step 2: SSH-verify that new script landed**

```bash
ssh root@37.1.196.83 "cat /usr/local/bin/catalyst-backup.sh | head -10"
```

Expected: you should see `set -euo pipefail` in the second-or-third line (this is the marker that the new version is live; old version had only `set -e`).

If you see only `set -e` — the sync didn't work. Investigate.

- [ ] **Step 3: Manual prod-script test run**

Trigger the script manually (don't wait for cron):

```bash
ssh root@37.1.196.83 "bash /usr/local/bin/catalyst-backup.sh"
```

Expected output: ends with `<date> backup OK: catalyst_YYYY-MM-DD_HH-MM.db.gz (NNN MB)`. No FATAL lines. Exit code 0.

Verify the resulting file exists:
```bash
ssh root@37.1.196.83 "ls -lh /var/backups/catalyst/ | tail -3"
```

Expected: newest backup is the one you just made manually (timestamp matches).

Verify B2 received it:
```bash
ssh root@37.1.196.83 "rclone ls b2:catalystparser-prod-backups/ | tail -3"
```

Expected: same fresh backup file on B2.

- [ ] **Step 4: Wait for the cron run**

Cron fires at 03:30 UTC. Do nothing — just wait until next morning.

- [ ] **Step 5: Verify cron-driven run was clean**

```bash
ssh root@37.1.196.83 "tail -20 /var/log/catalyst-backup.log"
```

Expected: the most recent entry shows `<03:30 timestamp> backup OK: ...`. No FATAL or error markers.

Also verify rclone log:
```bash
ssh root@37.1.196.83 "tail -5 /var/log/catalyst-backup-rclone.log"
```

Expected: rclone copy succeeded for the latest backup.

- [ ] **Step 6: Add Bundle #1 entry to WORKLOG**

Add at top of `ai-context/WORKLOG.md` (under the `---` after the intro):

```markdown
## 2026-05-27 · sonnet · Bundle #1 — Backup integrity rewrite

**Цель**: закрыть оставшиеся critical/high backup findings из 12-stage audit'а (DB-002, DB-004, PROD-001/005/011, SD-9/21) добавлением integrity checks, версионированием prod-скрипта в репо, документацией restore procedure + первым ручным drill.

**Контекст**: brainstorm-сессия выявила что 2 из 4 DB critical уже закрыты на prod (sqlite3 .backup используется, B2 rclone работает). Реально открыто: gzip integrity check, PRAGMA pre-check, restore docs, script versioning. См. `docs/superpowers/specs/2026-05-27-backup-integrity-rewrite-design.md`.

**Файлы**:
- `scripts/catalyst-backup.sh` (new) — prod backup script с pipefail + PRAGMA + gzip -t
- `scripts/backup.sh` (deleted) — старый dev stub, не использовался
- `deploy.ps1`, `deploy.sh` (modified) — sync block копирует скрипт на VPS при deploy
- `DEPLOY.md` (modified) — новые секции §6.5 Restore + §6.6 Quarterly drill
- `ai-context/SESSION_CONTEXT.md` (modified) — production posture backup paragraph переписан

**Деплой/проверка**: deploy прошёл, ssh-cat /usr/local/bin/catalyst-backup.sh показал новую версию (set -euo pipefail). Manual prod test → backup OK. Ночной cron 03:30 UTC прошёл без ошибок. Лог чистый.

**Closed findings (audit series)**:
- DB-002 (gzip -t integrity check added)
- DB-004 (restore documented in DEPLOY.md §6.5 + drill documented in §6.6)
- PROD-001 (backup script now versioned in repo, deploy syncs to VPS)
- PROD-005 (DEPLOY.md restore section added — was missing critical section)
- PROD-011 (script name unified: scripts/catalyst-backup.sh on both sides)
- SD-9 (B2 declared + implemented + documented + versioned — drift resolved)
- SD-21 (script name mismatch resolved by deletion of stub + new canonical file)

**Bonus quick-wins** (не были в audit, найдены в brainstorm):
- `set -o pipefail` добавлен (rclone failures больше не тонут в tee)
- `PRAGMA integrity_check` pre-backup (corrupt source DB не перезаписывает хорошие бэкапы)

**Drill**: см. следующий entry (отдельная WORKLOG строка от Task 9).

**Риски/заметки**: prod-скрипт теперь авто-переписывается каждым deploy. Если кто-то поправит вручную на VPS — следующий deploy перезатрёт (это by design — git = single source of truth).

---
```

- [ ] **Step 7: Commit WORKLOG**

```bash
git add ai-context/WORKLOG.md
git commit -m "docs(worklog): record Bundle #1 — Backup integrity rewrite

Documents the bundle execution: scope, files touched, deploy verification,
closed findings list (DB-002/004, PROD-001/005/011, SD-9/21).
Drill result will be a separate entry."
```

---

## Task 9: First manual restore drill (acceptance gate)

**Files:**
- Modify: `ai-context/WORKLOG.md` (add drill entry)

- [ ] **Step 1: Operator follows DEPLOY.md §6.6 step-by-step**

Open `DEPLOY.md` at §6.6 and run every step on the VPS (or your dev machine if rclone is configured there).

Note results as you go:
- gzip -t exit code: __
- PRAGMA integrity_check output: __
- users count: __
- trends count: __
- notifications count: __
- payments count: __

- [ ] **Step 2: Sanity check the numbers**

Do they look reasonable?
- `users` — должно быть приблизительно равно количеству зарегистрированных users (помнишь сколько примерно)
- `trends` — растёт каждый день, должно быть много
- `notifications` — должно расти со временем, но не аномально
- `payments` — мало (только реальные платежи)

If anything looks WAY off — investigate before proceeding (maybe wrong backup file, maybe schema changed and some table is empty/missing).

- [ ] **Step 3: Add drill entry to WORKLOG**

At top of `ai-context/WORKLOG.md` (above the Bundle #1 entry from Task 8), add:

```markdown
## 2026-05-28 · drill · OK · users=<N> trends=<N> notifications=<N> payments=<N>

Acceptance drill для Bundle #1. Pull самого свежего бэкапа с B2 → gzip -t OK → gunzip → PRAGMA integrity_check = ok → row counts (см. выше). Бэкап восстанавливаем. Bundle #1 closed.

Источник: `b2:catalystparser-prod-backups/catalyst_<DATE>_<TIME>.db.gz` (NNN MB)
Длительность drill: ~<X> минут.

---
```

(Replace `<N>`, `<DATE>`, `<TIME>`, `<X>` with real values.)

Note: use date 2026-05-28 (or whenever drill is actually executed) — this might be a different day from the Bundle #1 implementation entry.

- [ ] **Step 4: Commit**

```bash
git add ai-context/WORKLOG.md
git commit -m "docs(worklog): first restore drill — Bundle #1 acceptance gate

Drill executed per DEPLOY.md §6.6. All integrity checks passed,
row counts reasonable. Bundle #1 fully closed.

This is the proof that backups are actually restorable, not just exist."
```

- [ ] **Step 5: Mark Bundle #1 as DONE**

(No code change — just confirm to operator that Bundle #1 acceptance criteria from spec are all checked off.)

---

## Self-Review

After writing this plan, review against the spec:

**Spec coverage check:**

| Spec acceptance item | Task | Status |
|---|---|---|
| `scripts/catalyst-backup.sh` in repo with quick-wins | T1 | covered |
| `scripts/backup.sh` deleted | T2 | covered |
| `deploy.ps1` sync block | T3 | covered |
| `deploy.sh` sync block | T4 | covered |
| Deploy prod success | T8 step 1 | covered |
| SSH verify script on VPS | T8 step 2 | covered |
| Cron run clean after deploy | T8 step 5 | covered |
| DEPLOY.md §6.5 Restore | T5 | covered |
| DEPLOY.md §6.6 Drill | T6 | covered |
| SESSION_CONTEXT update | T7 | covered |
| WORKLOG entry Bundle #1 | T8 step 6 | covered |
| First drill executed | T9 step 1 | covered |
| All 4 verification items in drill | T9 step 2-3 | covered |
| Closed findings recorded | T8 step 6 | covered |

All spec items have a corresponding task.

**Placeholder scan**: No "TBD", "TODO", or vague directives. Some `<placeholder>` markers exist intentionally (real values to fill in at run-time — counts, timestamps) — these are correct usage, not plan failures.

**Type/name consistency**: 
- `scripts/catalyst-backup.sh` referenced consistently
- `$Server` (PS) / `$SERVER` (sh) hostname vars used per existing convention
- `/usr/local/bin/catalyst-backup.sh` is the prod path everywhere
- `users / trends / notifications / payments` core tables used in drill consistently with verified schema

Plan is self-consistent and matches spec exactly.

---

## Execution Notes

- T1-T7 may all be done in one session (~3 hours work, mostly file edits + commits).
- T8 requires real prod deploy + overnight wait for cron (asynchronous, low time-on-task).
- T9 requires ~20 minutes of operator focus + recording results.
- **Total elapsed time**: ~1-2 days (calendar), ~4 hours active.

If any step fails (deploy errors, cron logs FATAL, drill PRAGMA != ok) — STOP, investigate, do not proceed to next task. The spec's risks table covers the main scenarios.

**Operator preferences honored**:
- Commits include `Co-Authored-By` line ONLY if subagent-driven workflow specifies — manually-driven by operator, plain commits OK.
- Deploy is operator-driven, agent does not call `./deploy.ps1`.
- No SPA validators relevant (no src/server.js or src/admin/server.js touched).
- WORKLOG rotation policy (`AGENT_RULES.md §6`) — after both T8 + T9 entries added, total active entries should still be ≤12. If above 12, run rotation per §6 in a separate PR.

---

## Post-implementation note (2026-05-27)

**T1 final script differs from Step 1 expected content above.** Code-quality review during implementation found that `set -o pipefail` alone does NOT catch `rclone | tee` failures (tee always exits 0, dominates pipe). This invalidated the spec's primary quick-win 1 mechanism. Four additional fixes were applied:

| # | Fix | Severity |
|---|---|---|
| RF-1 | `rclone copy ... \| tee log` → `rclone copy ... >> log 2>&1` (direct redirect, exit code propagates) | CRITICAL |
| RF-2 | Validate VOLUME_NAME / VOLUME_PATH / DB file existence (3 guards) | IMPORTANT |
| RF-3 | `stat -c%s` sanity check after `.backup` (fail if < 4096 bytes) | IMPORTANT |
| RF-4 | `ls -lh \| awk` → `du -sh \| cut -f1` (locale-stable) | NICE |

**Source of truth for final script**: see `docs/superpowers/specs/2026-05-27-backup-integrity-rewrite-design.md` "Финальная версия скрипта (after code review fixes)" section. Verified live on prod 2026-05-26 — manual prod run succeeded, file uploaded to B2 (`catalyst_2026-05-26_19-47.db.gz, 9.2M`).

Also: T3 was post-review-fixed to use `Join-Path $LOCAL_DIR "scripts\catalyst-backup.sh"` (CWD-independence) + colored Write-Host for consistency. T5 §6.5 Step 1 had rclone-config-setup pointer added (DR fast-path). DEPLOYMENT_SUMMARY.txt was updated by T2 subagent (broken refs to deleted `scripts/backup.sh` → new `scripts/catalyst-backup.sh`) — accepted as sensible scope-creep.
