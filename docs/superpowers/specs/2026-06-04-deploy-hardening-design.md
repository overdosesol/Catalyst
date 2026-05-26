# Deploy Hardening — Design Spec

**Bundle**: #16 из `docs/audit/INDEX.md` (Tier 1, foundation)
**Date**: 2026-06-04
**Author**: brainstorm session (operator + sonnet, operator delegated detail decisions)
**Status**: Approved scope (Минимум), ready for writing-plans

---

## Goal

Закрыть QUAL-001 + PROD-002 + PROD-003 = три finding'а через минимально-инвазивное hardening deploy-пайплайна: вызов уже существующих SPA validators перед каждым деплоем + sync drift между `deploy.ps1` и `deploy.sh`. **PROD-004 (rollback feature) намеренно вынесен из этого bundle** — это отдельный mini-feature на ~3-4h, заслуживает своего PR.

## Context

12-stage audit пометил `QUAL-001` как **CRITICAL** (единственный critical в code-quality слое) — validators существуют в репо, но не вызываются нигде. По WORKLOG, SPA backtick traps срабатывали 3 раза за неделю до создания validators. После создания — defensive code is in place but не интегрирован в защитный flow. PROD-003 — этот же gap с production angle. PROD-002 — drift между `.ps1` (Windows, имеет R7 fixes) и `.sh` (Linux, отстал).

Сейчас:
- `scripts/check-dashboard-spa.cjs` (50 LOC) — валидирует inline React SPA из `src/dashboard/server.js`, exit 1 на syntax errors
- `scripts/check-admin-spa.cjs` (64 LOC) — то же для `src/admin/server.js`
- `package.json scripts`: только `start` + `dev`, нет `check:spa`
- `deploy.ps1`: 4 фазы [1/4]..[4/4], никаких pre-archive validation
- `deploy.sh`: то же + отстал — нет `ServerAliveInterval/CountMax` flags, нет EvilCatPack / .claude / posts / ai-context в zip exclude

После: validators обязательно прогоняются ДО архивации deploy, симметричное поведение `.ps1` и `.sh`.

---

## Scope

### In-scope

**Code**:
- `package.json` — add `"check:spa"` script (concrete validator chain) + `"check"` umbrella alias (forward-compat для будущих lint/test хуков)
- `deploy.ps1` — add pre-archive validation phase, fail-fast at non-zero exit. Renumber phases [1/4]..[4/4] → [1/5]..[5/5]
- `deploy.sh` — symmetric pre-archive validation; sync ServerAlive flags from `.ps1`; sync zip exclude list (.claude, posts, ai-context, EvilCatPack)

**Docs**:
- `DEPLOY.md` — add note про pre-deploy SPA validation в существующую секцию о deploy (короткая параграфская правка)
- `ai-context/SESSION_CONTEXT.md` — add line: "Deploy теперь обязательно прогоняет `npm run check:spa` перед архивацией"
- `ai-context/WORKLOG.md` — entry о Bundle #16

**Verification**:
- Local: прогнать `npm run check:spa` — exit 0 на текущем коде
- Negative test: внести синтетический syntax error в SPA template, прогнать `npm run check:spa` — exit 1 (revert после)
- Prod deploy: успешно прошёл новой [1/5] validation фазой

### Out-of-scope

- **PROD-004 (rollback feature)** — отдельный PR. Включает image tagging + DB backup hook + `--rollback` flag + DEPLOY.md §8. Estimated 3-4h, требует отдельный brainstorm.
- **`.husky/pre-commit`** — earlier catch на стороне dev машины. Adds husky dep, не критично если deploy hook надёжно ловит. Можно добавить позже.
- **CI infrastructure** (GitHub Actions / similar) — проект сейчас без CI. Bundle #16 не вводит CI, оставляем deploy-hook как единственный gate.
- **`npm test`, `npm lint`** — testing/linting infrastructure отсутствует (`devDependencies = {}`). Tier 1 Bundle #18 (QA infrastructure bootstrap) рассматривает это отдельно.

---

## Architecture

### Files affected

| File | Action | Lines changed |
|---|---|---|
| `package.json` | modify | +2 (check:spa + check) |
| `deploy.ps1` | modify | +8-10 (new [1/5] phase + renumber) |
| `deploy.sh` | modify | +10-12 (validation block + ServerAlive flags + exclude sync) |
| `DEPLOY.md` | modify | +5-8 (deploy section note) |
| `ai-context/SESSION_CONTEXT.md` | modify | +1 (deploy line) |
| `ai-context/WORKLOG.md` | modify | new entry |

### `package.json` changes

**Current**:
```json
"scripts": {
  "start": "node src/index.js",
  "dev": "node --watch src/index.js"
}
```

**After**:
```json
"scripts": {
  "start": "node src/index.js",
  "dev": "node --watch src/index.js",
  "check:spa": "node scripts/check-dashboard-spa.cjs && node scripts/check-admin-spa.cjs",
  "check": "npm run check:spa"
}
```

**Why `check` alias**:
- `npm run check` — natural mnemonic для devs
- Zero-cost forward compat: когда добавятся `lint`, `test` — расширяется как `"check": "npm run check:spa && npm run lint && npm test"`. Deploy скрипты не правим.

### `deploy.ps1` changes

**Insert new [1/5] phase at line ~21** (before existing [1/4] Building archive):

```powershell
Write-Host "[1/5] Validating SPA syntax..." -ForegroundColor Yellow
npm run check:spa
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: SPA validation failed. Fix syntax issues before deploying." -ForegroundColor Red
    exit 1
}
Write-Host "   SPA OK" -ForegroundColor Green
Write-Host ""
```

**Renumber existing phases**:
- `[1/4] Building archive...` → `[2/5] Building archive...`
- `[2/4] Uploading archive...` → `[3/5] Uploading archive...`
- `[3/4] Uploading .env...` → `[4/5] Uploading .env...`
- `[4/4] Running remote Docker setup...` → `[5/5] Running remote Docker setup...`

### `deploy.sh` changes

**Three things**:

1. **Pre-archive validation** (symmetric to .ps1, but bash-style):

```bash
echo "[1/5] Validating SPA syntax..."
npm run check:spa
echo "   SPA OK"
echo ""
```

(`set -e` already aborts on non-zero exit, so explicit check unnecessary. But if needed for clearer error: `npm run check:spa || { echo "ERROR: SPA validation failed."; exit 1; }`)

2. **ServerAlive flags** на scp calls (cherry-pick from .ps1):

Currently `.sh` line ~22:
```bash
scp -o StrictHostKeyChecking=no "$TMP_ARCHIVE" "$SERVER:/tmp/catalyst.zip"
```

Becomes:
```bash
scp -o StrictHostKeyChecking=no -o ServerAliveInterval=30 -o ServerAliveCountMax=10 "$TMP_ARCHIVE" "$SERVER:/tmp/catalyst.zip"
```

Same pattern для `.env` scp + `setup_remote.sh` scp + `catalyst-backup.sh` scp (added в Bundle #1).

3. **Zip exclude sync** (currently `-x "node_modules/*" "data/*" "logs/*" ".git/*" ".env"`):

Add to exclude list: `.claude/*`, `posts/*`, `ai-context/*`, `EvilCatPack/*`.

Final exclude:
```bash
zip -r "$TMP_ARCHIVE" . \
  -x "node_modules/*" "data/*" "logs/*" ".git/*" ".env" \
     ".claude/*" "posts/*" "ai-context/*" "EvilCatPack/*"
```

Renumber phases в `.sh` так же, как в `.ps1`.

### `DEPLOY.md` change

Add note в существующую deploy section (probably around line 30-50 where deploy command is described):

```markdown
**Pre-deploy validation**: Deploy скрипт автоматически вызывает `npm run check:spa` ДО архивации.
Если в inline React SPA (`src/dashboard/server.js` или `src/admin/server.js`) есть syntax error —
backtick в комментарии внутри template literal, `\n` в строке, double-escape в regex — validator
ловит это и abort'ит deploy. Сломанный SPA до прода не доходит.

Manual local check: `npm run check:spa` (или `npm run check` umbrella).
```

### `SESSION_CONTEXT.md` change

В Production posture / Deploy section добавить (короткий пункт):

```markdown
- **Deploy gate**: `deploy.{ps1,sh}` обязательно прогоняет `npm run check:spa` (вызывает `scripts/check-dashboard-spa.cjs` + `scripts/check-admin-spa.cjs`) ДО архивации. Validators ловят SPA-trap (backticks в комментариях, escape sequences, double-escape regex) до того как broken SPA достигнет prod. Bundle #16 (2026-06-04) закрыл QUAL-001 + PROD-002/003.
```

---

## Verification plan

### Acceptance criteria

**Code & integration**:
- [ ] `package.json` имеет `"check:spa"` (concrete chain) и `"check"` (umbrella)
- [ ] `npm run check:spa` локально → exit 0, оба validators report `OK`
- [ ] `npm run check` локально → то же (через alias)
- [ ] `deploy.ps1` имеет `[1/5] Validating SPA syntax...` phase до archive build
- [ ] `deploy.sh` симметрично
- [ ] `deploy.sh` имеет `-o ServerAliveInterval=30 -o ServerAliveCountMax=10` на всех 4 scp calls
- [ ] `deploy.sh` zip exclude содержит `.claude/*`, `posts/*`, `ai-context/*`, `EvilCatPack/*`

**Docs**:
- [ ] `DEPLOY.md` упоминает pre-deploy SPA validation
- [ ] `ai-context/SESSION_CONTEXT.md` отражает новый deploy gate
- [ ] `ai-context/WORKLOG.md` имеет Bundle #16 entry

**Verification (acceptance gates)**:

- [ ] **Positive test**: `npm run check:spa` на текущем чистом коде → exit 0. Оба `OK` сообщения.
- [ ] **Negative test (synthetic break)**: внести намеренный syntax error в один из SPA template literals — например, добавить строку `// regex test \/ pattern` в комментарий внутри template (этот pattern в WORKLOG ранее ломал validators). Прогнать `npm run check:spa` — должен exit 1 с явным error message. **Revert** synthetic error.
- [ ] **Real deploy**: `./deploy.ps1` (operator-driven) показывает `[1/5] Validating SPA syntax...` → `SPA OK` → continues to `[2/5] Building archive...`. Full deploy completes.

### Closed findings

- QUAL-001 (validators were dead infra — now integrated в deploy gate)
- PROD-002 (deploy.sh drift — ServerAlive + exclude list synced)
- PROD-003 (no pre-deploy checks — now mandatory gate)

---

## Risks & mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| `npm run check:spa` сам падает (validator bug) и блокирует deploy | low | Validators verified рабочие при manual test; negative test catches their breakage |
| `npm` отсутствует на dev машине | very low | Если dev не имеет node/npm, он deploy в принципе не запустит (deploy.sh не зависит от node но deploy конфликтит без node для check) |
| False positive (validator говорит fail, но SPA на самом деле OK) | medium | Operator может разово закомментить `npm run check:spa` блок в deploy и push manual. Не идеально, но fallback есть. |
| Renumber phases ([1/4] → [1/5]) ломает чьи-то external scripts/grep | very low | Внутренние phase labels, никто на них не парсится |
| `.claude/` exclude — operator вдруг хочет deployить claude config | very low | `.claude/settings.local.json` — это harness state, не нужен на VPS. Никакого reason to deploy. |

---

## Estimated effort

| Component | Time |
|---|---|
| `package.json` edit + local `npm run check:spa` test | 5 min |
| `deploy.ps1` insertion + renumber + PowerShell syntax check | 20 min |
| `deploy.sh` insertion + ServerAlive + exclude + `bash -n` check | 20 min |
| `DEPLOY.md` + `SESSION_CONTEXT.md` updates | 15 min |
| Negative test (synthetic SPA break + revert) | 10 min |
| WORKLOG entry | 10 min |
| Operator real deploy + verify | 15 min |
| **Total** | **~1.5h** |

Within audit's ~2h estimate.

---

## Open questions

All resolved by operator delegation. Summary:
- Q1: Scope (Минимум / Средний / Полный)? → **Минимум** (operator explicit choice)
- Q2: Husky pre-commit? → **No** (out of scope per Минимум)
- Q3: CI infrastructure? → **No** (out of scope per Минимум)
- Q4 (sonnet-decided): `"check"` umbrella alias? → **Yes** (zero-cost forward compat)
- Q5 (sonnet-decided): `.sh` exclude list — sync just EvilCatPack or all 4 missing? → **All 4** (full symmetry с .ps1 = no future drift)
- Q6 (sonnet-decided): Phase renumber [1/4] → [1/5] or insert [0/4]? → **Renumber** (cleaner UX, [0/4] feels like a hack)

---

## Out-of-scope (для будущих bundles)

- **PROD-004 (rollback)** — отдельный mini-feature, ~3-4h
- **`.husky/pre-commit`** — earlier catch локально, optional
- **CI infrastructure** — GitHub Actions / similar
- **Bundle #18 (QA infra bootstrap)** — adds `npm test`, eslint, prettier, devDependencies
- **`npm lint`, `npm test`** — depend on Bundle #18

---

## Transition

После approve этого spec — invoke `superpowers:writing-plans` для генерации implementation plan с пошаговыми задачами.
