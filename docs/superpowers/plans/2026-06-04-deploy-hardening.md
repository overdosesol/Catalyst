# Deploy Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- []`) syntax for tracking.

**Goal:** Закрыть QUAL-001 + PROD-002 + PROD-003: вызвать существующие SPA validators обязательно перед каждым деплоем + sync drift между `deploy.ps1` (Windows) и `deploy.sh` (Linux).

**Architecture:** Minimal invasion — добавить `"check:spa"` npm script + новая `[1/5]` валидационная фаза в обе версии deploy + cherry-pick ServerAlive флагов и exclude списка из `.ps1` в `.sh`. Никакого нового кода, только integration существующих validators в защитный пайплайн.

**Tech Stack:** Node.js (validators), PowerShell + Bash (deploy), npm scripts, scp/ssh.

**Spec reference:** `docs/superpowers/specs/2026-06-04-deploy-hardening-design.md`

---

## File Structure

### Files modified
- `package.json` — add 2 npm scripts (`check:spa` + `check` umbrella)
- `deploy.ps1` — insert pre-archive validation phase + renumber 5 phase labels [1/4]→[1/5]..[4/4]→[5/5]
- `deploy.sh` — insert pre-archive validation block + renumber 5 phase labels + add `ServerAliveInterval/CountMax` to 4 scp calls + extend zip exclude list (4 new entries)
- `DEPLOY.md` — add ~5 lines about pre-deploy validation gate (location: in the deploy section, near description of the deploy command)
- `ai-context/SESSION_CONTEXT.md` — add 1 bullet about deploy gate (location: in the Production posture/Deploy area)
- `ai-context/WORKLOG.md` — new top entry для Bundle #16

### Files NOT touched
- `scripts/check-dashboard-spa.cjs` — already works, don't touch
- `scripts/check-admin-spa.cjs` — same
- `scripts/catalyst-backup.sh` — Bundle #1 territory
- `setup_remote.sh` — out of scope (would only be touched in PROD-004 rollback feature)
- `src/server.js`, `src/admin/server.js` — not changing app code, just deploy guard

---

## Task Order Rationale

1. **T1 (package.json)** — first, because deploy scripts will call `npm run check:spa`. If this isn't in place, T2/T3 will fail when tested.
2. **T2 (deploy.ps1)** — Windows version next (operator's primary platform).
3. **T3 (deploy.sh)** — Linux version with all drift fixes consolidated.
4. **T4 (DEPLOY.md)** — docs after code, so docs reflect final state.
5. **T5 (SESSION_CONTEXT.md)** — same reasoning.
6. **T6 (negative test, operator-driven)** — proof that validators actually catch real SPA bugs. Done before real deploy.
7. **T7 (real deploy + WORKLOG, operator-driven)** — final acceptance gate.

T1-T5 are subagent-driven file edits. T6-T7 are operator-driven (involve VPS or intentional code break).

---

## Task 1: Add npm scripts to `package.json`

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Read current `package.json` scripts section**

Run:
```bash
grep -A4 "\"scripts\"" package.json
```

Expected output (approximately):
```json
"scripts": {
  "start": "node src/index.js",
  "dev": "node --watch src/index.js"
},
```

If the scripts section already contains `check:spa` or `check` — stop, this task is already done.

- [ ] **Step 2: Add the two new scripts**

Use Edit tool. The `old_string` is:

```json
  "scripts": {
    "start": "node src/index.js",
    "dev": "node --watch src/index.js"
  },
```

The `new_string` is:

```json
  "scripts": {
    "start": "node src/index.js",
    "dev": "node --watch src/index.js",
    "check:spa": "node scripts/check-dashboard-spa.cjs && node scripts/check-admin-spa.cjs",
    "check": "npm run check:spa"
  },
```

Notes:
- The exact indentation depends on what's already in the file (likely 2 spaces). Preserve it.
- The trailing comma after the last entry must NOT be added (JSON forbids it). The closing `},` already has the comma.

- [ ] **Step 3: Verify the JSON is still valid**

Run:
```bash
node -e "console.log(JSON.parse(require('fs').readFileSync('package.json', 'utf8')).scripts)"
```

Expected output: an object that includes `check:spa` and `check`.

If you see `SyntaxError` — the JSON is malformed; check for missing commas, mismatched quotes, etc.

- [ ] **Step 4: Verify the new scripts work**

Run:
```bash
npm run check:spa
```

Expected output (approximately):
```
> ... > node scripts/check-dashboard-spa.cjs && node scripts/check-admin-spa.cjs
Dashboard SPA inner OK (NNNN chars)
SPA inner OK (NNNN chars)
```

Exit code: 0.

Then:
```bash
npm run check
```

Expected: same output (alias). Exit code: 0.

- [ ] **Step 5: NO COMMIT.** Operator commits later.

---

## Task 2: Update `deploy.ps1` — insert validation phase + renumber

**Files:**
- Modify: `deploy.ps1` (insert block before line 21, renumber 5 phase labels)

- [ ] **Step 1: Read current phase labels**

Run:
```bash
grep -n "\[[0-9]/[0-9]\]" deploy.ps1
```

Expected output (approximately):
```
21:Write-Host "[1/4] Building archive..." -ForegroundColor Yellow
48:Write-Host "[2/4] Uploading archive..." -ForegroundColor Yellow
61:    Write-Host "[3/4] Uploading .env..." -ForegroundColor Yellow
69:    Write-Host "[3/4] .env not found locally, keeping server .env" -ForegroundColor Yellow
74:Write-Host "[4/4] Running remote Docker setup..." -ForegroundColor Yellow
```

Five lines to renumber, plus one new block to insert.

- [ ] **Step 2: Insert new `[1/5]` phase BEFORE the current `[1/4] Building archive` block**

The current line 21 is `Write-Host "[1/4] Building archive..." -ForegroundColor Yellow`. We're inserting a block of 8 lines BEFORE it.

Use Edit tool. The `old_string` is:

```powershell
Write-Host "[1/4] Building archive..." -ForegroundColor Yellow
```

The `new_string` is:

```powershell
Write-Host "[1/5] Validating SPA syntax..." -ForegroundColor Yellow
npm run check:spa
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: SPA validation failed. Fix syntax issues before deploying." -ForegroundColor Red
    exit 1
}
Write-Host "   SPA OK" -ForegroundColor Green
Write-Host ""
Write-Host "[2/5] Building archive..." -ForegroundColor Yellow
```

(This both inserts the new phase AND renumbers the first existing phase, in a single Edit call.)

- [ ] **Step 3: Renumber the remaining 4 phase labels**

Four separate Edit calls (each one targets a unique line that's specific enough not to need extra context):

Edit 1:
- `old_string`: `Write-Host "[2/4] Uploading archive..." -ForegroundColor Yellow`
- `new_string`: `Write-Host "[3/5] Uploading archive..." -ForegroundColor Yellow`

Edit 2:
- `old_string`: `    Write-Host "[3/4] Uploading .env..." -ForegroundColor Yellow`
- `new_string`: `    Write-Host "[4/5] Uploading .env..." -ForegroundColor Yellow`

Edit 3:
- `old_string`: `    Write-Host "[3/4] .env not found locally, keeping server .env" -ForegroundColor Yellow`
- `new_string`: `    Write-Host "[4/5] .env not found locally, keeping server .env" -ForegroundColor Yellow`

Edit 4:
- `old_string`: `Write-Host "[4/4] Running remote Docker setup..." -ForegroundColor Yellow`
- `new_string`: `Write-Host "[5/5] Running remote Docker setup..." -ForegroundColor Yellow`

- [ ] **Step 4: Verify all phase labels were renumbered**

Run:
```bash
grep -n "\[[0-9]/[0-9]\]" deploy.ps1
```

Expected output (exactly):
```
21:Write-Host "[1/5] Validating SPA syntax..." -ForegroundColor Yellow
29:Write-Host "[2/5] Building archive..." -ForegroundColor Yellow
56:Write-Host "[3/5] Uploading archive..." -ForegroundColor Yellow
69:    Write-Host "[4/5] Uploading .env..." -ForegroundColor Yellow
77:    Write-Host "[4/5] .env not found locally, keeping server .env" -ForegroundColor Yellow
82:Write-Host "[5/5] Running remote Docker setup..." -ForegroundColor Yellow
```

(Line numbers may shift +8 from the insertion; the IMPORTANT part is that all phase labels are now `[X/5]` not `[X/4]`, and `[1/5]` is the validation phase.)

If any `[X/4]` remains — that line was missed. Fix it.

- [ ] **Step 5: PowerShell syntax check**

If `pwsh` is available locally:
```powershell
pwsh -NoProfile -Command "$errors = $null; $null = [System.Management.Automation.Language.Parser]::ParseFile('deploy.ps1', [ref]$null, [ref]$errors); if ($errors) { $errors | ForEach-Object { Write-Output $_ }; exit 1 }; Write-Output 'OK'"
```

Expected output: `OK`.

If `pwsh` is not available — skip this step; operator will catch any syntax error on real deploy.

- [ ] **Step 6: Verify no other changes**

Run:
```bash
git diff --stat deploy.ps1
```

Expected: ~10-12 lines changed (8 inserted + 5 renumbers).

- [ ] **Step 7: NO COMMIT.**

---

## Task 3: Update `deploy.sh` — insert validation + renumber + ServerAlive + exclude sync

**Files:**
- Modify: `deploy.sh` (multiple targeted edits)

This is the biggest task in the plan — three logical groups of edits (validation block, ServerAlive flags on 4 scp calls, exclude list).

- [ ] **Step 1: Read current phase labels in deploy.sh**

Run:
```bash
grep -n "\[[0-9]/[0-9]\]" deploy.sh
```

Expected output:
```
13:echo "[1/4] Архивация проекта..."
21:echo "[2/4] Загрузка архива на сервер..."
25:  echo "[3/4] Загрузка .env..."
28:  echo "[3/4] .env локально не найден, оставляю серверный .env"
32:echo "[4/4] Запуск remote setup..."
```

5 lines to renumber + 1 new block + 4 scp calls + 1 exclude list extension.

- [ ] **Step 2: Insert new `[1/5]` phase BEFORE the current `[1/4] Архивация` block**

Use Edit tool.

`old_string`:
```bash
echo "[1/4] Архивация проекта..."
rm -f "$TMP_ARCHIVE"
cd "$LOCAL_DIR"
zip -qr "$TMP_ARCHIVE" . \
  -x "node_modules/*" "data/*" "logs/*" ".git/*" ".env"
```

`new_string`:
```bash
echo "[1/5] Validating SPA syntax..."
npm run check:spa
echo "   SPA OK"
echo ""

echo "[2/5] Архивация проекта..."
rm -f "$TMP_ARCHIVE"
cd "$LOCAL_DIR"
zip -qr "$TMP_ARCHIVE" . \
  -x "node_modules/*" "data/*" "logs/*" ".git/*" ".env" \
     ".claude/*" "posts/*" "ai-context/*" "EvilCatPack/*"
```

This single Edit does three things:
1. Inserts the new `[1/5] Validating SPA syntax...` block (4 new lines + blank)
2. Renumbers `[1/4] Архивация` → `[2/5] Архивация`
3. Extends the zip exclude list with 4 new entries (`.claude/*`, `posts/*`, `ai-context/*`, `EvilCatPack/*`)

`set -e` is at top of `deploy.sh` (line 2), so a failing `npm run check:spa` will exit 1 and abort. No explicit error check needed.

- [ ] **Step 3: Renumber remaining 4 phase labels**

Edit 1:
- `old_string`: `echo "[2/4] Загрузка архива на сервер..."`
- `new_string`: `echo "[3/5] Загрузка архива на сервер..."`

Edit 2:
- `old_string`: `  echo "[3/4] Загрузка .env..."`
- `new_string`: `  echo "[4/5] Загрузка .env..."`

Edit 3:
- `old_string`: `  echo "[3/4] .env локально не найден, оставляю серверный .env"`
- `new_string`: `  echo "[4/5] .env локально не найден, оставляю серверный .env"`

Edit 4:
- `old_string`: `echo "[4/4] Запуск remote setup..."`
- `new_string`: `echo "[5/5] Запуск remote setup..."`

- [ ] **Step 4: Add ServerAlive flags to 4 scp calls**

The 4 scp calls in `deploy.sh` currently use only `-o StrictHostKeyChecking=no`. Add `-o ServerAliveInterval=30 -o ServerAliveCountMax=10` to each.

Edit 1 — archive scp:
- `old_string`: `scp -o StrictHostKeyChecking=no "$TMP_ARCHIVE" "$SERVER:/tmp/catalyst.zip"`
- `new_string`: `scp -o StrictHostKeyChecking=no -o ServerAliveInterval=30 -o ServerAliveCountMax=10 "$TMP_ARCHIVE" "$SERVER:/tmp/catalyst.zip"`

Edit 2 — .env scp:
- `old_string`: `  scp -o StrictHostKeyChecking=no "$LOCAL_DIR/.env" "$SERVER:/tmp/catalyst.env"`
- `new_string`: `  scp -o StrictHostKeyChecking=no -o ServerAliveInterval=30 -o ServerAliveCountMax=10 "$LOCAL_DIR/.env" "$SERVER:/tmp/catalyst.env"`

Edit 3 — setup_remote.sh scp:
- `old_string`: `scp -o StrictHostKeyChecking=no "$LOCAL_DIR/setup_remote.sh" "$SERVER:/tmp/catalyst_setup.sh"`
- `new_string`: `scp -o StrictHostKeyChecking=no -o ServerAliveInterval=30 -o ServerAliveCountMax=10 "$LOCAL_DIR/setup_remote.sh" "$SERVER:/tmp/catalyst_setup.sh"`

Edit 4 — catalyst-backup.sh scp:
- `old_string`: `scp -o StrictHostKeyChecking=no "$BACKUP_SCRIPT" "$SERVER:/usr/local/bin/catalyst-backup.sh"`
- `new_string`: `scp -o StrictHostKeyChecking=no -o ServerAliveInterval=30 -o ServerAliveCountMax=10 "$BACKUP_SCRIPT" "$SERVER:/usr/local/bin/catalyst-backup.sh"`

- [ ] **Step 5: Verify all phase labels were renumbered**

Run:
```bash
grep -n "\[[0-9]/[0-9]\]" deploy.sh
```

Expected: 6 lines, all `[X/5]`, starting with `[1/5] Validating SPA syntax...`. No `[X/4]` remaining.

- [ ] **Step 6: Verify ServerAlive flags applied to all 4 scp calls**

Run:
```bash
grep -c "ServerAliveInterval=30" deploy.sh
```

Expected: `4`.

```bash
grep -c "^scp\|^  scp" deploy.sh
```

Expected: `4` (matching count to ServerAlive count).

- [ ] **Step 7: Verify zip exclude list extended**

Run:
```bash
grep -A1 "node_modules" deploy.sh | head -5
```

Expected output should show `.claude/*`, `posts/*`, `ai-context/*`, `EvilCatPack/*` in the continuation line of the zip command.

Or more directly:
```bash
grep -c "EvilCatPack" deploy.sh
```

Expected: `1`.

- [ ] **Step 8: Bash syntax check**

Run:
```bash
bash -n deploy.sh
```

Expected: exit code 0, no output.

If you see any parsing error — review the inserted blocks and fix syntax (likely a stray quote or missing line continuation backslash).

- [ ] **Step 9: NO COMMIT.**

---

## Task 4: Update `DEPLOY.md` with pre-deploy validation note

**Files:**
- Modify: `DEPLOY.md` (add ~5 lines about new deploy gate)

- [ ] **Step 1: Find the appropriate section to add the note**

Run:
```bash
grep -n "^## \|^### " DEPLOY.md | head -20
```

Look for a section about running the deploy script — likely §2 (Deploy / Quick start) or §3 (Manual deploy steps). Pick the section that describes "how to deploy" and that's where the gate-note belongs (operator reads about deploy → sees the new gate immediately).

If you can't find an obvious section, fall back to adding the note immediately after the FIRST description of `./deploy.ps1` or `./deploy.sh` in the file.

- [ ] **Step 2: Insert the note**

Use Edit tool. Find a unique anchor near the deploy description and add the note right after.

For example, if the file has a line like `Run \`./deploy.ps1\` from project root.`, the Edit could be:

`old_string`:
```
Run `./deploy.ps1` from project root.
```

`new_string`:
```
Run `./deploy.ps1` from project root.

**Pre-deploy validation gate** (since Bundle #16, 2026-06-04): Deploy скрипт автоматически вызывает `npm run check:spa` ДО архивации. Если в inline React SPA (`src/dashboard/server.js` или `src/admin/server.js`) есть syntax error — backtick в комментарии внутри template literal, `\n` в строке, double-escape в regex — validator ловит это и abort'ит deploy. Сломанный SPA до прода не доходит.

Manual local check (быстрая проверка перед commit): `npm run check:spa` или `npm run check`.
```

If the exact `old_string` above doesn't appear in DEPLOY.md verbatim — read the file, find the closest equivalent (e.g., a section header for "Deploy" + first paragraph), and insert the note in a similar logical place. The CONTENT of the note above is what matters; the exact location can vary by a few lines.

- [ ] **Step 3: Verify**

Run:
```bash
grep -n "Pre-deploy validation gate" DEPLOY.md
```

Expected: exactly 1 match.

```bash
grep -c "npm run check:spa" DEPLOY.md
```

Expected: at least 1 (the new section). May be 2 if there's a "Manual local check" line too.

- [ ] **Step 4: NO COMMIT.**

---

## Task 5: Update `ai-context/SESSION_CONTEXT.md` with deploy gate line

**Files:**
- Modify: `ai-context/SESSION_CONTEXT.md` (add 1 bullet)

- [ ] **Step 1: Find the Production posture / Deploy section**

Run:
```bash
grep -n "Production posture\|Deploy\|^## \|^### " ai-context/SESSION_CONTEXT.md | head -20
```

Look for a section that lists deploy-related details (likely "Production posture" or "Production / Deploy"). This is where the new bullet belongs.

- [ ] **Step 2: Add the new bullet**

Use Edit tool. Find a logical anchor (e.g., end of a bullet list about deploy infrastructure) and insert the new bullet immediately after.

If the section has a bullet like:
```
- **Daily backup**: ... (the one Bundle #1 just rewrote)
```

The Edit could append a new bullet right after the daily backup line. Read the file to find the exact end of the relevant bullet, then:

`old_string`: <the last few words of the bullet that comes BEFORE where you want to insert>

`new_string`: <same text> + newline + the new bullet:

```
- **Deploy gate**: `deploy.{ps1,sh}` обязательно прогоняет `npm run check:spa` (вызывает `scripts/check-dashboard-spa.cjs` + `scripts/check-admin-spa.cjs`) ДО архивации. Validators ловят SPA-trap (backticks в комментариях, escape sequences, double-escape regex) до того как broken SPA достигнет prod. Bundle #16 (2026-06-04) закрыл QUAL-001 + PROD-002/003.
```

If the file structure is different (e.g., uses different bullet markers or has different sections), adapt the placement but keep the content identical.

- [ ] **Step 3: Verify**

Run:
```bash
grep -n "Deploy gate" ai-context/SESSION_CONTEXT.md
```

Expected: exactly 1 match.

```bash
grep -c "Bundle #16" ai-context/SESSION_CONTEXT.md
```

Expected: at least 1.

- [ ] **Step 4: NO COMMIT.**

---

## Task 6: Operator — negative test (synthetic SPA break)

**Files:**
- Temporarily modify and revert: one of the SPA template files (`src/dashboard/server.js` or `src/admin/server.js`)

This task is operator-driven because it involves an intentional break + revert. Doing it safely needs human oversight. **Subagents should NOT do this** — risk of leaving repo in broken state.

- [ ] **Step 1: Confirm validators currently pass on clean code**

Run:
```bash
npm run check:spa
```

Expected: exit 0, both `OK` messages.

- [ ] **Step 2: Introduce a synthetic SPA syntax break**

Pick a comment near the top of `src/dashboard/server.js` SPA template literal (a comment INSIDE the `_buildSPA` method's template string). Add a backtick inside the comment text.

Example, find a line like:
```javascript
// Some inline comment about the dashboard
```

Inside the SPA template literal, and change it to:
```javascript
// Some inline `comment` about the dashboard
```

(Adding backticks inside a comment that's already inside a template literal will trigger the parser bug we're protecting against.)

**IMPORTANT**: Make this change in a place you can easily revert (git checkout).

- [ ] **Step 3: Run validator — confirm it catches the break**

Run:
```bash
npm run check:spa
```

Expected: exit 1, error message identifying the syntax error (likely `SyntaxError: Unexpected token`).

If validator says `OK` and exits 0 — that's a problem; the trap wasn't detected. Investigate the validator logic before continuing.

- [ ] **Step 4: Revert the synthetic break**

Run:
```bash
git checkout -- src/dashboard/server.js
```

Or if you edited admin instead:
```bash
git checkout -- src/admin/server.js
```

Verify it's clean:
```bash
git status src/dashboard/server.js src/admin/server.js
```

Expected: no changes (clean working tree for those files).

- [ ] **Step 5: Confirm validators pass again**

Run:
```bash
npm run check:spa
```

Expected: exit 0, both `OK` messages.

- [ ] **Step 6: Record in WORKLOG**

(Will be combined with T7 WORKLOG entry — don't write separate entry now.)

---

## Task 7: Operator — real prod deploy + WORKLOG entry

**Files:**
- No code changes
- Add: WORKLOG entry to `ai-context/WORKLOG.md`

- [ ] **Step 1: Run deploy**

```powershell
./deploy.ps1
```

Or on Linux:
```bash
./deploy.sh
```

Expected: deploy starts, first phase shown is `[1/5] Validating SPA syntax...`, then `SPA OK`, then `[2/5] Building archive...`, etc. Deploy completes successfully.

If `[1/5] Validating SPA syntax...` is NOT shown — Task 2/3 didn't apply correctly. Stop, investigate.

If `SPA validation failed` appears — there's a real syntax issue in the SPA right now (was hidden because validators weren't called). Don't deploy; fix the SPA issue.

- [ ] **Step 2: Verify deploy succeeded**

```bash
ssh root@37.1.196.83 "curl -sf http://127.0.0.1:8080/api/health"
```

Expected: `200 OK` or similar response. (Or check via browser at the prod URL.)

- [ ] **Step 3: Add WORKLOG entry**

At the top of `ai-context/WORKLOG.md` (right after the `---` on line 12, BEFORE the existing top entry), insert this new entry. The entry text below uses placeholder dates — replace with real dates if the deploy doesn't happen on 2026-06-04.

```markdown
## 2026-06-04 · sonnet · Bundle #16 — Deploy hardening (QUAL-001 + PROD-002/003)

**Цель**: интегрировать существующие SPA validators в обязательный deploy gate + sync drift между deploy.ps1 и deploy.sh. Tier 1 #16 из `docs/audit/INDEX.md`.

**Контекст**: validators (`scripts/check-dashboard-spa.cjs`, `scripts/check-admin-spa.cjs`) существовали с момента когда backtick traps срабатывали 3 раза за неделю, но никогда не вызывались автоматически. Audit пометил это QUAL-001 (CRITICAL) — defensive infra без integration. PROD-003 — этот же gap с прод-стороны. PROD-002 — `.sh` отстал от `.ps1` (нет ServerAlive flags, нет EvilCatPack/.claude/posts/ai-context в exclude).

**Метод**: brainstorm → spec (`docs/superpowers/specs/2026-06-04-deploy-hardening-design.md`) → 7-task plan (`docs/superpowers/plans/2026-06-04-deploy-hardening.md`), subagent-driven для T1-T5, operator-driven для T6-T7.

**Файлы**:
- `package.json` (+2 lines) — `"check:spa"` chain + `"check"` umbrella alias
- `deploy.ps1` (+8 lines) — новая `[1/5] Validating SPA syntax` phase + renumber [1/4]..[4/4] → [2/5]..[5/5]
- `deploy.sh` (~+12 lines) — симметричная `[1/5]` phase + ServerAlive flags на 4 scp calls + zip exclude расширен 4 entries (.claude, posts, ai-context, EvilCatPack)
- `DEPLOY.md` (+5 lines) — note о pre-deploy validation gate
- `ai-context/SESSION_CONTEXT.md` (+1 bullet) — Deploy gate в Production posture

**Verification**:
- Positive: `npm run check:spa` локально → exit 0, оба validators OK
- Negative: synthetic backtick-in-comment break в `src/dashboard/server.js` → `npm run check:spa` exit 1 (validators реально ловят bug). Revert clean.
- Real deploy: `./deploy.ps1` показал `[1/5] Validating SPA syntax... SPA OK` → продолжил архивацию → завершился успешно.

**Closed findings**:
- QUAL-001 (validators integrated в deploy gate)
- PROD-002 (deploy.sh symmetric с deploy.ps1 — ServerAlive + exclude list)
- PROD-003 (pre-deploy validation now mandatory)

**Не закрыто (deferred)**:
- PROD-004 (rollback feature) — out of scope Bundle #16, отдельный mini-PR на ~3-4h. Включает image tagging + DB backup hook + `--rollback` flag.

**Риски/заметки**:
- Если validator сам падает (bug в check-*-spa.cjs) — блокирует deploy. Fallback: оператор может разово закомментить `npm run check:spa` блок в deploy.ps1/sh.
- `npm` теперь required на dev машине для deploy. Раньше можно было deploy без node (только scp/ssh). Если этот constraint когда-то станет issue — можно перенести check'и в `setup_remote.sh` (но смысл валидации = до отправки на прод, поэтому local-only).
- Phase renumber [1/4] → [1/5] — внутренние UX labels, никто на них не парсится.

**Tier 1 progress**: Bundle #1 (backup integrity) + Bundle #16 (deploy hardening) closed. Tier 1 backlog: #18 QA infrastructure (~3h) + #17 cert visibility (~3h) остались.

---
```

- [ ] **Step 4: NO COMMIT (operator decides when to commit all Bundle #16 changes).**

---

## Self-Review

After writing the plan, verifying against the spec:

**Spec coverage check:**

| Spec acceptance item | Task | Status |
|---|---|---|
| `package.json` has `"check:spa"` + `"check"` | T1 | covered |
| `npm run check:spa` exits 0 on current code | T1 step 4 | covered |
| `npm run check` works via alias | T1 step 4 | covered |
| `deploy.ps1` has `[1/5] Validating SPA syntax...` phase | T2 step 2 | covered |
| `deploy.ps1` aborts at non-zero exit | T2 step 2 (LASTEXITCODE check) | covered |
| `deploy.sh` symmetric validation block | T3 step 2 | covered |
| `deploy.sh` has ServerAlive flags on 4 scp calls | T3 step 4 | covered |
| `deploy.sh` zip exclude includes .claude / posts / ai-context / EvilCatPack | T3 step 2 | covered |
| `DEPLOY.md` mentions pre-deploy validation | T4 | covered |
| `SESSION_CONTEXT.md` reflects deploy gate | T5 | covered |
| WORKLOG entry for Bundle #16 | T7 step 3 | covered |
| Positive test (npm run check:spa exits 0) | T1 step 4 + T6 step 1 + T7 step 1 | covered |
| Negative test (synthetic break detected) | T6 | covered |
| Real deploy with new phase visible | T7 step 1 | covered |

All spec items have a corresponding task.

**Placeholder scan**: No "TBD", "TODO", or vague directives. Some `<placeholder>` markers (e.g., `<NNNN>` for char count in validator output) are intentional — actual values appear at runtime.

**Type/name consistency**:
- `"check:spa"` and `"check"` script names consistent everywhere
- `npm run check:spa` (not `npm test`, not `npm run check-spa`) — same form everywhere
- `[1/5]`, `[2/5]`, `[3/5]`, `[4/5]`, `[5/5]` — sequential phase labels, all consistent
- `ServerAliveInterval=30 -o ServerAliveCountMax=10` — same flag set on all 4 scp calls

Plan is self-consistent and matches spec exactly.

---

## Execution Notes

- T1-T5 can be done sequentially by subagents (~30-40 min total elapsed via subagent dispatches + reviews).
- T6 + T7 require operator (intentional break + revert, then real prod deploy with verification).
- **Total elapsed time**: ~1.5h active.

**Operator preferences honored**:
- No commits by subagents (operator commits later)
- Deploy is operator-driven
- No SPA validator EDIT — only INVOKE existing ones
- SESSION_CONTEXT update follows `AGENT_RULES §7` (state, not change)

**Risks acknowledged**:
- If `npm run check:spa` itself breaks (false positive), deploy is blocked until operator manually fixes or temporarily disables the gate
- If `npm` isn't on the dev machine, deploy can't run — known constraint, documented
