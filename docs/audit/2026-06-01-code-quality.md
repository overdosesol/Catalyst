# Code quality sweep — 2026-06-01

**Scope**: одиннадцатый из 12 этапов. Фокус — качество кода: SPA-trap protection enforcement, dead code, comment drift после R1-R7 sweep'ов, file/function size health, error handling consistency, magic numbers, naming inconsistencies, lint/test coverage, import hygiene. **Не покрыто**: все previous этапы (1-10), документация / SESSION_CONTEXT final sync-pass / WORKLOG cleanup (Stage 12). Architectural-level refactoring decisions (split server.js на modules) — out of scope как «реальная работа», только flagging.

**Method**: 5 параллельных haiku-агентов по 11 направлениям (SPA validators + lint + tests, dead code inventory, comment drift map, file+function size + monolith health, naming + magic numbers + i18n unused) + ручная sample-проверка ключевых файлов (`scripts/check-*-spa.cjs`, `package.json`, `.eslintrc*` glob). Все 5 агентов отстрелились без retry. Один (file+function size) занял ~3 min — acceptable для cross-file counts. Не запускал lint / format / tests.

---

## File size map

**Total src/ LOC: ~40,043 lines**. Top-2 files = **52.6% of entire codebase**.

| Rank | File | Lines | % project | Notes |
|---|---|---|---|---|
| 1 | `src/dashboard/server.js` | **13,682** | **34.2%** | inline React SPA + handlers + CSS + i18n usage. _buildSPA() = 82% of file |
| 2 | `src/admin/server.js` | **7,355** | **18.4%** | inline React admin SPA + handlers. _spa() = 79% of file |
| 3 | `src/notifications/telegram.js` | 2,176 | 5.4% | bot + alert send + commands + callbacks |
| 4 | `src/db/database.js` | 2,158 | 5.4% | SQLite wrapper + migrations + helpers |
| 5 | `src/analysis/scorer.js` | 1,480 | 3.7% | Stage 1 LLM pipeline |
| 6 | `src/analysis/gemini-captioner.js` | 1,248 | 3.1% | image / video captioning |
| 7 | `src/refresh/tag-refresher.js` | 1,161 | 2.9% | auto-tags FSM |
| 8 | `src/analysis/clusterer.js` | 923 | 2.3% | similarity-based merging |
| 9 | `src/analysis/preset-config.js` | 872 | 2.2% | 3-layer merge logic |
| 10 | `src/collectors/tiktok.js` | 726 | 1.8% | TikTok Apify collector |

Single-developer maintainable: yes (operator знает all). Multi-developer / new contributor onboarding: **blocked by monolith**. server.js change → diff diff diff in 13K-line file = high cognitive load + git conflicts.

---

## Function size map

| Rank | Function | Where | ~Lines | Notes |
|---|---|---|---|---|
| 1 | **`_buildSPA()`** | `dashboard/server.js:2624` | **~11,828** | huge template literal: HTML+CSS+JSX inline. ~2K lines CSS + ~1.5K HTML + ~8.3K inline React. Single function = 82% of file. |
| 2 | **`_spa()`** | `admin/server.js:1627` | **~6,224** | same pattern: ~1.2K CSS + ~0.8K HTML + ~4.2K React. 79% of file. |
| 3 | `_migrate()` | `db/database.js:28` | ~250 | schema patching loop |
| 4 | `clusterTrends()` | `analysis/clusterer.js` | ~300 | similarity matrix |
| 5 | `computeAlertScore()` | `analysis/scorer.js:240` | ~250 | inline conditionals |
| 6 | `dispatchAlerts()` | `notifications/alert-dispatcher.js` | ~400 | gates + multi-user loop |
| 7 | `runScanCycle()` | `index.js` | ~150 | main orchestrator |
| 8 | `_handleManualAnalysis()` | `dashboard/server.js:1930` | ~150 | URL submit + Stage 1/2 |
| 9 | `_handleTrendFeedback()` | `dashboard/server.js:1536` | ~90 | vote + reason wizard |
| 10 | `deepMerge()` (preset) | `analysis/preset-config.js` | ~100-150 | 3-layer merge |

**Top-2** _buildSPA() + _spa() — **~18,000 lines combined**. Single edit risks SPA-trap (PROD-003/004 + CRITICAL severity).

**DashboardServer class**: 40 `_handleXxx` route methods + ~9 utility helpers = ~49 methods. Lines 415-2620 are infrastructure, 2624-14452 is _buildSPA().
**AdminServer class**: ~20 `_handleXxx` + ~12 helpers = ~32 methods.

---

## Dead code inventory

После R-итераций:

| # | Item | Where | Status | Severity |
|---|---|---|---|---|
| 1 | `memeColor()` function | `dashboard/server.js:8244` | **DEAD** — 0 callsites, shadowed by `const memeColor` on line 9648 (same name!) | medium (shadow bug risk) |
| 2 | `memeClass()` function | `dashboard/server.js:8235` | **DEAD** — 0 callsites | low |
| 3 | `lifespanLabel()` function | `dashboard/server.js:8201` | **DEAD** — 0 callsites | low |
| 4 | `.toolbar` CSS class | `dashboard/server.js:3421` | **DEAD** — 0 className references | low |
| 5 | `.kbd` CSS class | `dashboard/server.js:4935` | **DEAD** — 0 className references | low |
| 6 | `SOURCE_LOGOS` map | — | **CLEAN** — fully removed in R4 (line 8128 historical comment OK) | n/a |
| 7 | `sort.virality` i18n key | — | **CLEAN** — removed in R5, backend legacy-tolerant | n/a |
| 8 | `.analyze-trace` / `.analyze-pill` CSS | — | **CLEAN** — fully removed (line 8128 historical comment OK) | n/a |
| 9 | `MARKET_STAGE_UI[stage].icon` field | — | **CLEAN** — fully migrated to `.kind` field (R4 cleanup complete) | n/a |
| 10 | `dangerouslySetInnerHTML` | — | **0 callsites** — verified safe (SEC re-confirm). Line 8730 historical comment marking removal OK | n/a |
| 11 | i18n keys sample (20 keys checked) | en.js / ru.js | **20/20 used** — no unused keys in sample | n/a |
| 12 | Unused imports (5 files sampled) | analysis/aggregator.js, embeddings.js, clusterer.js, scorer.js, junk-filter.js | **0/5 unused** — all imports referenced | n/a |
| 13 | CSS classes (10 sampled) | dashboard/server.js | **8/10 used** — 2 dead found (.toolbar, .kbd) | low |

**Dead totals**: 3 dead functions + 2 dead CSS classes in `dashboard/server.js`. Combined ~50-100 LOC. **Lower than feared after 7 redesign iterations** — R-cleanups were thorough.

---

## Comment drift map

| # | Where | Comment says | Reality | Status |
|---|---|---|---|---|
| 1 | `dashboard/server.js:2636-2638` (CSS block header) | «2 dark themes: ink (default) + tide» | **3 themes (pulse default + ink + tide)** per `SUPPORTED_THEMES` line 7168 + return 'pulse' line 7180 | **STALE** — drift |
| 2 | `dashboard/server.js:7158-7159` (JS theme comment) | «3 dark themes. Applied via data-theme. pulse is default» | matches реализация | ✓ correct |
| 3 | CatMascot component implied count | WORKLOG / SESSION_CONTEXT declare 8 useEffects | **11 useEffects** (SD-22 already flagged) | drift |
| 4 | `dashboard/server.js:12279-12294` (LoginScreen ambient blob) | mentions «R3 removed ambient radial blobs» | historical record, accurate | ✓ correct (tombstone OK) |
| 5 | `dashboard/server.js:13312-13316` (addToast) | auto-dismiss `setTimeout(..., 3000)` | matches Stage 6 spec (3000ms) | ✓ correct |
| 6 | `notifications/telegram.js` bot commands | comments declare 5 commands (start, menu, dashboard, top, analyze) | matches реализация | ✓ correct |
| 7 | Cat mascot pose count comments | declares 5 dashboard + 2 login | matches IDLE_POSES* constants | ✓ correct |
| 8 | File-top comments (server.js, admin/server.js, telegram.js) | endpoint lists + functional summaries | accurate | ✓ correct |
| 9 | `dashboard/server.js:8730` | mentions removed `dangerouslySetInnerHTML` (R4 sweep) | 0 callsites — historical record | ✓ correct (tombstone OK) |
| 10 | `TODO` / `FIXME` / `XXX` / `HACK` markers | grep across src/ | **0 matches** | ✓ clean |

**Total stale comments**: 1 (CSS block line 2636 «2 themes»). Plus SD-22 (useEffect count) is documentation-side drift, not code-side. Surprisingly clean after R1-R7 churn.

---

## Lint / format / test coverage

| Component | Status |
|---|---|
| `package.json` test script | ✗ **MISSING** (no `"test"`) |
| `package.json` lint script | ✗ **MISSING** |
| `package.json` format script | ✗ **MISSING** |
| `package.json` check script | ✗ **MISSING** (validators exist но never called) |
| `package.json` engines.node | ✗ **NOT PINNED** |
| `package.json` devDependencies | **0** (empty `{}`) |
| `.eslintrc*` / `eslint.config.*` | ✗ **MISSING** from root |
| `.prettierrc*` | ✗ **MISSING** |
| `.husky/` pre-commit hook | ✗ **MISSING** |
| `lint-staged` config | ✗ **MISSING** |
| `test/` или `tests/` или `__tests__/` directory | ✗ **MISSING** |
| Test files anywhere (`*.test.js`, `*.spec.js`) | ✗ **NONE** (only inside node_modules deps) |
| Test runner (mocha / vitest / jest / node:test) | ✗ **NONE** |
| `.github/workflows/*.yml` (CI) | ✗ **NONE** |
| Other CI configs (.gitlab-ci, .circleci, etc) | ✗ **NONE** |
| `scripts/check-dashboard-spa.cjs` | ✓ present (50 LOC) — calls `_buildSPA()` + `vm.Script()` — catches SyntaxError. Exit 1 on fail. **Never invoked in scripts/hooks/CI** |
| `scripts/check-admin-spa.cjs` | ✓ present (64 LOC) — calls `_spa()` + `vm.Script()`. **Never invoked** |

**QA infrastructure verdict**: **~5%**. Two validators exist as standalone scripts. Zero linting, zero tests, zero CI, zero pre-commit hooks. Single operator working alone has been holding all quality bars manually. **Major operational gap for any contributor scaling**.

---

## Summary

**Counts**: **1 critical** · **5 high** · 9 medium · 5 low · 4 info · **24 findings total**.

Общее впечатление — Catalyst — **2-year mature solo project с tight inner coherence**: dead code mostly cleaned after R-sweeps (3 functions + 2 CSS classes lingering, ~50-100 LOC total — surprisingly low for 7 redesign iterations), comments mostly accurate (только 1 stale CSS block declaring «2 themes»), naming patterns consistent (10/10 boolean sample, _prefixed semantics consistent, snake_case→camelCase mapping clear), imports clean (0/5 unused in sample), 0 TODO/FIXME/HACK markers, ESM standard in src/ + CJS for scripts/.cjs properly separated, encapsulated DashboardServer/AdminServer classes with ~49/32 methods respectively, СAT_TIMINGS demonstrates good constant-registry pattern.

Слабые места — **1 critical + 5 high**, кластером в три области:

1. **SPA-trap validators infrastructure dead** (QUAL-001 critical): scripts exist, but **0 invocation points** (no `npm run`, no pre-commit, no CI, no deploy). Next backtick in comment → backslash-n in string → SyntaxError → black screen prod. Validators были созданы после 3 ловушек за неделю, ничего не предотвращают.

2. **Zero QA infrastructure** (QUAL-002 high): no lint, no tests, no pre-commit, no CI, no format. Operator-only code quality. After 2 years, technical debt accumulates silently — first new contributor hits massive friction.

3. **Monolith server.js / admin/server.js** (QUAL-003 + QUAL-004 high, x2): 13,682 + 7,355 lines = 52.6% of entire codebase в 2 файлах. Single _buildSPA() = 82% of dashboard file (~11,828 lines). _spa() admin = 79% (~6,224 lines). Any change has high blast radius. Refactor blocked by no bundler choice, but extractable items exist (CSS to static file, constants to separate JS, route handlers to modules).

Plus QUAL-005 (CSS comment line 2636 «2 dark themes» stale → may mislead future contributor).

Medium набор — dead memeColor() / memeClass() / lifespanLabel() functions + .toolbar / .kbd CSS classes (~50-100 LOC), magic numbers not centralized (5min auth has 3 different literal forms `5*60*1000` / `5*60_000` / `300_000` в 3 callsites), `engines.node` not pinned, _buildSPA() / _spa() longest single-function in codebase (~18K LOC combined), memeColor shadow risk (function line 8244 + const line 9648 same name — currently no callers but bug-prone if revived).

**Top-3** для разбора в первую очередь:
1. **QUAL-001 CRITICAL** — SPA validators dead в infrastructure. PROD-003/004 cross-confirm с code-side angle: где validators ДОЛЖНЫ быть вызваны (deploy + pre-commit + CI). Three integration points. Без этого validators useless.
2. **QUAL-002 HIGH** — Zero QA infra (no lint / tests / CI / pre-commit). 2-year project = technical debt без visibility. Next contributor faces wall.
3. **QUAL-003 + QUAL-004 HIGH** — server.js / admin.js монолит. Cognitive load + refactor friction. Не immediate bug, но blocks any scale beyond solo developer.

**Technical debt verdict**: **HIGH** (~70%). Code itself relatively clean for 2-year project, but **infrastructure debt is severe**: no QA tooling, monolith blocks refactor, validators unused.

**Maintainability verdict**: **~40%**. Solo developer OK (operator knows all). Larger team contributing impossible без QA infra. Sustainable for current scale, breaks at scale.

---

## Findings

### [QUAL-001] SPA validators dead — never invoked anywhere — severity: **critical**

* **Where**: `scripts/check-dashboard-spa.cjs` + `scripts/check-admin-spa.cjs` (present) vs `package.json` (no script) + `.husky/` (missing) + `.github/workflows/` (missing) + `deploy.ps1`/`deploy.sh` (not called)
* **Category**: SPA-trap protection / infrastructure
* **What**: оба validator scripts existуют (50 + 64 LOC each), оба вызывают `_buildSPA()` / `_spa()` и пропускают output через `vm.Script()` — catches SyntaxError на backticks-in-comments / `\n`-in-strings / double-escape-regex. Exit code 1 on fail. **НО**: zero integration points. CLAUDE.md внутри предупреждает оператора вызывать manually after editing server.js. **Manual = forgotten**. Backtick traps fired 3 раза за неделю (per WORKLOG) → validators были built для прevention, но не предотвращают ничего.
* **Repro/impact**: 
  1. Edit `dashboard/server.js` — add backtick в comment внутри inline React template literal
  2. Forget to run `node scripts/check-dashboard-spa.cjs` manually
  3. Commit → push → deploy
  4. Production SPA = black screen (SyntaxError) or partial render. Operator не узнает до user complaint
* **Cross-audit overlap**: PROD-003 (no pre-deploy checks) + PROD-004 (no rollback). Code-side angle here — **where validators SHOULD be invoked**.
* **Fix** (3 integration points, ~30 lines combined):
  1. **package.json scripts**:
     ```json
     "check:spa": "node scripts/check-dashboard-spa.cjs && node scripts/check-admin-spa.cjs",
     "test": "npm run check:spa"
     ```
  2. **deploy.ps1/sh** (cross-confirm PROD-003): add `npm run check:spa` BEFORE archive upload. Fail-fast on non-zero exit.
  3. **Optional** pre-commit hook via `.husky/pre-commit`:
     ```sh
     #!/bin/sh
     npm run check:spa
     ```
     + `npm install -D husky` + `npx husky init`. Catches at commit time before push.
  
  Cross-overlap с backlog #16 (deploy hardening bundle) — добавь check:spa в deploy script.

---

### [QUAL-002] Zero QA infrastructure — no lint / tests / CI / pre-commit / format — severity: **high**

* **Where**: `package.json` (5 deps + 0 devDeps + only start/dev scripts), missing `.eslintrc*` / `.prettierrc*` / `.husky/` / `.github/workflows/`
* **Category**: lint / test / format / CI
* **What**: 
  * No ESLint config → no static check для unused vars, undefined identifiers, accidental globals, missed `await`s, etc.
  * No Prettier → style inconsistency over time.
  * No tests anywhere (no `test/` dir, no test runner in deps, no `npm test`).
  * No pre-commit hooks → manual review only.
  * No CI workflows → no automated PR checks.
  * `engines.node` not pinned → developer machine может differ от prod Docker (Node 20-alpine).
* **Repro/impact**: 2-year project — technical debt accumulates without visibility. New contributor:
  * Doesn't know which `let`/`const` style team prefers (no Prettier)
  * Can't run `npm test` to verify nothing broke (no tests)
  * Pushes code that immediately breaks prod (no CI gate)
  * Inconsistent string quotes / trailing commas across PRs
* **Fix**: 5-step setup, ~3 hour total work. Не blocker for current solo ops, **mandatory** для scaling beyond solo:
  1. `npm i -D eslint @eslint/js prettier` — install
  2. `npx eslint --init` — generate `eslint.config.js`. Pick: ES2024 / module / no framework / JSON output / strict.
  3. `echo '{"semi":true,"singleQuote":true,"printWidth":100}' > .prettierrc.json`
  4. Add scripts: `"lint": "eslint src/"`, `"format": "prettier --write src/"`
  5. `.github/workflows/ci.yml` (15 lines) — run `npm run check:spa + lint + test` on push.
  6. Pin `"engines": { "node": ">=20.0.0 <21.0.0" }`
* **Cross-audit overlap**: PROD-003/004 (deploy hygiene). Same domain — infra QA.

---

### [QUAL-003] `src/dashboard/server.js` monolith — 13,682 lines (34.2% of codebase) — severity: **high**

* **Where**: `src/dashboard/server.js` (full file)
* **Category**: monolith / refactor blocker
* **What**: 
  * 13,682 LOC. _buildSPA() alone = ~11,828 lines (82% of file).
  * Contains: REST handlers (40 _handleXxx methods, lines 415-2620), inline React SPA (template literal at line 2624-14452: ~2K CSS + ~1.5K HTML + ~8.3K JSX/JS).
  * Any change has wide diff blast — git conflicts, hard code review, IDE struggle.
  * SPA-trap (QUAL-001) lives here because of template literal monolith.
* **Repro/impact**:
  * New contributor opens file → vscode lags / freezes on huge syntax tree.
  * Search для `addToast` callsite returns ~40 matches без context — hard to locate.
  * Single backtick in middle of JSX template = entire prod broken.
* **Fix** (architectural — major effort, ~1 week):
  1. **Extract SPA HTML / CSS / JSX → static assets**. Serve `assets/dashboard.html` + `assets/dashboard.css` + `assets/dashboard-app.js` instead of dynamic template literal. Adds bundler-step (esbuild / vite) but unlocks IDE highlighting + Prettier + ESLint inside SPA code.
  2. **Extract route handlers → `src/dashboard/routes/`** (auth.js, trends.js, settings.js, media.js). Each exports handler functions; main server.js mounts them via lookup table. ~1.5K LOC stays as infra (auth check, body parser, error handler), routes go separate.
  3. **Extract constants → `src/dashboard/constants.js`** (icon maps, phase metadata, timings). ~500-1000 LOC reduction.
  
  After refactor: server.js ~3K LOC (only infra), SPA assets static, routes modular. **Massive maintainability win** but requires bundler choice (currently zero build step).
* **Acceptable for now**: solo dev OK. Mandatory before team scaling.

---

### [QUAL-004] `src/admin/server.js` monolith — 7,355 lines (18.4% of codebase) — severity: **high**

* **Where**: `src/admin/server.js`
* **Category**: monolith / refactor blocker
* **What**: same pattern as QUAL-003. `_spa()` = ~6,224 lines (79% of file). 20 _handleXxx + 12 helpers + admin SPA inline template.
* **Fix**: same approach as QUAL-003. Lower priority (admin loopback-only, smaller surface). Можно сделать вторым после dashboard refactor.

---

### [QUAL-005] CSS comment line 2636 declares «2 dark themes» — stale post-R1 pulse default — severity: **medium**

* **Where**: `src/dashboard/server.js:2636-2638` (CSS block header comment)
* **Category**: comment drift
* **What**: CSS block at line 2636 says `/* ===== THEME SYSTEM (rewritten 2026-05-06) ===== 2 dark themes: ink (default, no data-theme attribute) tide (deep navy + cyan/aqua accent) */`. Реально 3 темы (pulse + ink + tide), default = pulse (line 7180 `return 'pulse';`). JS comment at line 7158 correctly declares 3 themes — но CSS-side comment stale. Cross-overlap UX-004 + SD-12.
* **Repro/impact**: developer modifying theme CSS reads stale block header, assumes ink default → adds rules to `body[data-theme="ink"]` thinking it covers default users. Actually pulse is default (no attribute), ink only applies when user explicit-switches. Bug introduced.
* **Fix**: update comment to «3 dark themes: pulse (default, :root baseline, no data-theme attribute) · ink (data-theme="ink", X-blue) · tide (data-theme="tide", navy + cyan)». ~3 lines.

---

### [QUAL-006] Dead `memeColor()` / `memeClass()` / `lifespanLabel()` functions — severity: **medium**

* **Where**: 
  * `memeColor()` — `dashboard/server.js:8244`, 0 callsites
  * `memeClass()` — `dashboard/server.js:8235`, 0 callsites
  * `lifespanLabel()` — `dashboard/server.js:8201`, 0 callsites
* **Category**: dead code
* **What**: 3 functions defined но never called. `memeColor()` особо problematic — same name shadowed by `const memeColor` on line 9648 (constant takes precedence in scope, function becomes unreachable). Bug-prone if someone tries to revive (subtle name collision).
* **Total dead LOC**: ~50-80 lines combined.
* **Fix**: delete all 3 functions. ~80 LOC reduction. Trivial. Likely declared as «dead, удалю отдельно» in WORKLOG 2026-05-20 R3 — already pre-flagged for removal.

---

### [QUAL-007] Dead CSS classes `.toolbar` (line 3421) + `.kbd` (line 4935) — severity: **low**

* **Where**: `dashboard/server.js:3421` (.toolbar) + `:4935` (.kbd)
* **Category**: dead code (CSS)
* **What**: 2 CSS class definitions без single JSX `className` reference. Likely leftover from earlier UI iterations.
* **Fix**: delete CSS rules. ~10-20 LOC reduction.

---

### [QUAL-008] Magic numbers not centralized — 3 different literal forms for 5-min auth window — severity: **medium**

* **Where**: `5 * 60 * 1000` (db/database.js), `5 * 60_000` (utils/rate-limiter.js), `300_000` (notifications/alert-scheduler.js)
* **Category**: magic numbers
* **What**: same constant (5 minutes), 3 different literal representations across files. Plus `7 * 24 * 3600_000` (7-day retention, 1 callsite), `60 * 60 * 1000` (1h, 8+ callsites partially centralized via TWEET_PREVIEW_TTL_MS / REDDIT_PREVIEW_TTL_MS), TG 4096 hardcoded as `3800` trim (no const), TG 1024 caption (local const CAPTION_MAX only).
* **Repro/impact**: if changing 5-min auth window to 10-min — grep `5*60*1000` won't find `300_000` callsite. Bug introduced.
* **Fix**: central `src/constants.js` with named exports (`AUTH_WINDOW_MS = 5 * 60 * 1000`, `ONE_HOUR_MS`, `ONE_DAY_MS`, `WEEK_MS`, `TG_MESSAGE_MAX`, `TG_CAPTION_MAX`). Import where needed. ~30 LOC + N callsite updates. CAT_TIMINGS already demonstrates good pattern — extend to other domains.

---

### [QUAL-009] `engines.node` not pinned in package.json — severity: **medium**

* **Where**: `package.json` (no `"engines"` field)
* **Category**: env hygiene
* **What**: Docker uses `node:20-alpine` (pinned in Dockerfile), но developer running `npm install` или `node src/index.js` локально может use Node 18 / 22 / 23 — `better-sqlite3` native bindings, `undici` features, `import` semantics differ across versions.
* **Repro/impact**: developer creates feature on Node 18 using older `fetch` semantic → works locally → breaks on prod Node 20.
* **Fix**: add `"engines": { "node": ">=20.0.0 <21.0.0" }`. `npm install` warns если mismatch. ~3 lines.

---

### [QUAL-010] `_buildSPA()` / `_spa()` longest single functions — ~18,000 combined LOC — severity: **medium**

* **Where**: `dashboard/server.js:2624` (_buildSPA), `admin/server.js:1627` (_spa)
* **Category**: function size
* **What**: 2 functions = ~50% of total project LOC each. Architecturally — template literal returning HTML page. По sense — собирающий monoblock. Cognitive cost для editing высокий. SPA-trap (QUAL-001) is byproduct.
* **Fix**: see QUAL-003 + QUAL-004 (extract HTML / CSS / JS to static assets). Same fix covers both. Долгий refactor.

---

### [QUAL-011] `memeColor` function (line 8244) + `const memeColor` (line 9648) — name shadow — severity: **low**

* **Where**: `dashboard/server.js:8244` (function) + `:9648` (const, same name)
* **Category**: naming / dead code subset
* **What**: function defined, then later `const memeColor = ...` declared with same identifier. In JavaScript hoisting + scope, `const` takes precedence after its declaration line. Function effectively unreachable. Bug-prone if function later revived (operator might fix function but const still shadows).
* **Fix**: either rename function to `memeColorLegacy` or just delete (covered by QUAL-006).

---

### [QUAL-012] Zero devDependencies in package.json — severity: **low**

* **Where**: `package.json` — `devDependencies: {}`
* **Category**: dependency hygiene
* **What**: empty `devDependencies` block. All 5 deps are prod runtime (`better-sqlite3`, `dotenv`, `node-telegram-bot-api`, `sharp`, `undici`). Zero tooling deps (no eslint, prettier, vitest, husky, lint-staged).
* **Fix**: depends on QUAL-002. Adding QA tools → fills devDependencies appropriately.

---

### [QUAL-013] SD-22 useEffect count drift (declared 8, реально 11) — code-side surface — severity: **low**

* **Where**: SESSION_CONTEXT + WORKLOG (documentation side); no in-code comment упоминающий «N useEffects» found by agent search
* **Category**: comment drift / spec drift confirmation
* **What**: SESSION_CONTEXT § «Cat mascot» declares 8 useEffects in CatMascot. Реально 11 (verified Stage 10). Code-side — no inline comment counter found (good, no in-code drift to fix). Stage 12 sync-pass needs to update SESSION_CONTEXT only.
* **Fix**: Stage 12 documentation update. No code change here.

---

### [QUAL-014] No JSDoc / TypeScript types — severity: **info**

* **Where**: entire `src/`
* **Category**: code documentation
* **What**: function signatures untyped. JSDoc absent. New developer must read implementation to understand parameter types / return shapes.
* **Fix**: future. Add JSDoc to top-50 most-used functions. Or migrate to TypeScript (substantial work).

---

### [QUAL-015] No request/response schema validation — severity: **info**

* **Where**: 40+ _handleXxx methods
* **Category**: API contracts
* **What**: each handler manually parses `req.body` / serializes response. No Zod / joi validation. Inconsistent error shapes potentially.
* **Fix**: future. Zod adoption pattern, ~1 schema per endpoint.

---

### [QUAL-016] No structured admin audit log — severity: **info**

* **Where**: admin actions (preset configs, user overrides)
* **Category**: observability (overlap with BILL-002 / ADM-005)
* **What**: cross-confirm BILL-002 + ADM-005 — admin actions logged to stderr but не into queryable DB table. Code-side: no `admin_audit_log` insert call after destructive ops.
* **Fix**: backlog #12 (admin observability persistence migration).

---

### [QUAL-017] Auth window literal `5 * 60 * 1000` not in central registry — severity: **info**

* **Where**: see QUAL-008 (auth window has 3 different literal forms)
* **Category**: magic numbers
* **What**: subset of QUAL-008.

---

## Verified safe

То что прошло — не пересматривать:

1. **0 TODO / FIXME / XXX / HACK markers** в `src/` — clean (was scanned, none found).
2. **0 `dangerouslySetInnerHTML` callsites** — SEC re-confirm. Line 8730 historical comment OK (tombstone).
3. **0 `eval(` / `Function(` callsites** — re-confirm SEC.
4. **SOURCE_LOGOS fully removed** post-R4 (replaced SOURCE_ICONS). Line 8128 historical comment OK.
5. **`sort.virality` i18n key fully removed** post-R5. Backend legacy-tolerant (line 1123 dashboard).
6. **`.analyze-trace` / `.analyze-pill` CSS fully removed** post-R5 AnalyzePanel redesign.
7. **`MARKET_STAGE_UI[stage].icon` fully migrated to `.kind`** field post-R4. Clean.
8. **20/20 sample i18n keys all used** via `t()` calls.
9. **5/5 sample files have 0 unused imports** (aggregator, embeddings, clusterer, scorer, junk-filter).
10. **Boolean naming consistent** — 10/10 `is*` sample, 10/10 `has*` sample, *Enabled pattern consistent.
11. **`_prefixed` methods semantically private** — 5/5 sample have only internal callsites.
12. **snake_case (DB) → camelCase (JS) mapping explicit** in `_trendSnapshot` (database.js) and similar.
13. **ESM standard in src/** (`"type": "module"` in package.json), CJS for scripts/.cjs properly separated.
14. **8/10 sample CSS classes used** in JSX. 2 dead found (QUAL-007).
15. **CAT_TIMINGS** centralized constants for cat domain — good pattern to extend.
16. **DashboardServer / AdminServer class encapsulation** — methods organized, ~49 / ~32 respectively, prefix conventions consistent.
17. **Comments mostly accurate post-R1-R7** — 1 stale (CSS block), all others verified accurate.
18. **File-top JSDoc** present and accurate (dashboard/server.js, admin/server.js, telegram.js).
19. **Toast 3000ms auto-dismiss** matches spec (line 13315).
20. **Bot commands 5/5 declared** match реализация.
21. **Cat pose counts** match constants (IDLE_POSES_DASHBOARD 5, IDLE_POSES_LOGIN 2).
22. **Validators detection logic** — both call live `_buildSPA()` / `_spa()` and pass through `vm.Script()` — catches SyntaxError on backticks / `\n` / regex double-escape. Sound technique.
23. **`getActivePresetConfig` vs `getEffectivePresetConfigs` vs `getEffective`** — actually different purposes (runtime / config UI / local helper), naming is appropriate per semantic boundaries.
24. **`isTrendSeen` vs `wasNotificationSentToUser`** — different abstraction levels (trend-level dedup vs user-level dedup). Naming appropriate.
25. **`recordNotification`** sole API for notification record — no `markAlertSent` duplicate exists.
26. **`_setUserPlan` wraps `upgradePlan`** — different abstraction levels (admin handler vs DB primitive), naming acceptable.
27. **`memeColor()` function dead** confirmed safe to remove (0 callsites, shadowed const).
28. **R-cleanups thorough** — surprisingly little dead code accumulation despite 7 redesigns в 2 weeks.

---

## Spec drift (накопительно — 23 items)

К существующим 22 items добавляю 1 новый code-quality-уровень:

- **SD-1**..**SD-22** — см. предыдущие этапы.
- **SD-23** **CSS theme comment drift** — `dashboard/server.js:2636-2638` CSS block header declares «2 dark themes: ink (default) + tide». Реально 3 themes (pulse default + ink + tide). JS-side comment at line 7158 corrected, CSS-side never updated. Subset of SD-12 (theme contract drift) but code-side specifically. Fix in QUAL-005.

Final sync-pass для всех 23 spec drift items планируется Stage 12.

---

## Cross-audit overlap

«One-fix-many-wins» backlog (не radically расширен — code-quality findings overlap с infrastructure backlog):

1. **Backup integrity rewrite** — 8 items.
2. **`notifications` migration** — 5 items.
3. **Schema integrity sweep** — 5 items.
4. **`db.transaction` wrap save loops** — 3 items.
5. **`sqliteCutoff` consolidation** — 4 items.
6. **Housekeeping schedule + admin UI maintenance** — 7 items.
7. **`/api/scan` admin gate + immediate timestamp** — 4 items.
8. **DB-backed counter table `feature_usage_log`** — 2 items.
9. **Hover preview plan-check + per-user rate-limit** — 2 items.
10. **Proactive Google healthcheck + counter reset** — 3 items.
11. **A11y compliance sprint** — 7 items.
12. **Admin observability persistence migration** — 4 items.
13. **Standardized error visibility** — 5 items.
14. **URL safety bundle** — 4 items.
15. **Bot resilience bundle** — 4 items.
16. **Deploy hardening bundle** (extended) — PROD-002 + PROD-003 + PROD-004 + **QUAL-001 (call validators в deploy + pre-commit)** = **4 items одним PR**.
17. **Cert + infrastructure visibility bundle** — 3 items.
18. **(NEW) QA infrastructure bootstrap** — **QUAL-002 + QUAL-009 + QUAL-012** + установка eslint + prettier + husky + lint-staged + GitHub Actions CI workflow = **3 items в один setup PR** (~3 hours setup work). Foundational for any future contributor.
19. **(NEW) Dead code cleanup pass** — **QUAL-006 (3 dead functions) + QUAL-007 (2 dead CSS) + QUAL-011 (memeColor shadow) + QUAL-005 (CSS comment drift) + QUAL-013 (cat useEffect drift, SESSION_CONTEXT only)** = **5 items одним cleanup PR** (~30 LOC removed + 5 comments fixed). Trivial but consolidates final pre-Stage-12 cleanup.

Code-quality specific overlap:
- **QUAL-001 (validators dead)** = PROD-003/004 code-side angle → backlog #16 extension.
- **QUAL-005 (CSS theme comment)** = SD-23 (subset of SD-12 theme contract drift). Fixed during Stage 12 sync-pass + here as code-side update.
- **QUAL-008 (magic numbers)** — new, narrow. Future polish.
- **QUAL-013 (useEffect count)** = SD-22.
- **QUAL-016 (admin audit log code-side)** = BILL-002 + ADM-005 → backlog #12.

Если приоритезировать **#16 Deploy hardening (включая QUAL-001 validator integration) + #18 QA infra bootstrap + #19 Dead code cleanup pass** — **10 finding'ов** одной серией PR (deploy + QA + cleanup). Закладывает foundation для post-Stage-12 операций.

---

## Out of scope / Followups

- **All previous этапы (1-10)** — done.
- **Documentation / SESSION_CONTEXT final sync-pass** — Stage 12 (23 spec drift items accumulated).
- **Architecture-level refactoring** (split server.js, add bundler) — flagged как QUAL-003/004/010 but not in audit scope. Major effort, separate planning.

**Open assumptions** (`⚠ assumes`):
- File line counts via Grep `output_mode: count` — accurate but estimates for function ranges (longest functions don't have AST-perfect boundaries).
- Dead code sample (10 CSS classes, 5 imports, 20 i18n keys) — representative но не exhaustive. Full inventory would need AST parser.
- Magic number callsite counts — Grep-based, не AST-validated.

**Followup observability**:
- Один subagent (file + function size + monolith) — ~3 min. Counts были accurate, refactor opportunities thoughtful. Sonnet would have been faster but haiku results sufficient.
- Two subagents very thorough (dead code + naming/magic numbers) — ~4-8 min each. Acceptable.

Stage 11 closes code quality sweep. Code itself **clean for 2-year solo project** (R-cleanups thorough, 0 markers, 0 unused imports sample). **Infrastructure debt severe** — Stage 11 highest-priority finding is QUAL-001 critical (validators dead) cross-overlap PROD-003/004. Two PRs (deploy hardening + QA infra) close ~10 finding'ов across 3 этапов.

After Stage 12 sync-pass — accumulated 23 spec drift items finalize, project ready for next development cycle.
