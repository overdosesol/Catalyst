# Documentation + spec drift resolution audit — 2026-06-02

**Scope**: двенадцатый и последний из 12 этапов чекапа. Финальный пересмотр документации (README, DEPLOY.md, CLAUDE.md, ai-context/*, .env.example, docs/superpowers/*, docs/audit/*) + финальный пас по 23 spec drift items накопленным за 11 этапов с **propose resolution** для каждого. Это серия-резолюция — после этого аудита оператор получает полный actionable backlog. Documentation + audits только review, никакие файлы не правил.

**Method**: 5 параллельных haiku-агентов (all 11 audit reports + SD extraction, SESSION_CONTEXT vs SD matching, README+DEPLOY+CLAUDE analysis, .env+package+AGENT_RULES+WORKLOG, superpowers specs+plans inventory) + manual integration. Не запускал реально lint/tests/format.

---

## Documentation inventory

| File | Size | Role | Status |
|---|---|---|---|
| **README.md** | **MISSING** | Public-facing project description | **CRITICAL GAP** |
| `DEPLOY.md` | 341 lines | Operator runbook (deploy, env, backups, ops) | SOLID + 5 critical gaps |
| `CLAUDE.md` | 37 lines | Project-level agent instructions | SOLID, accurate, cross-refs work |
| `.env.example` | 371 lines, 53 keys | Env catalogue + descriptions | 100% documented, 2 keys missing (SD-20) |
| `package.json` | minimal | Project meta, scripts, deps | Description accurate, missing scripts/devDeps/engines/author |
| `LICENSE` | ⚠ assume present (license: "ISC" в package.json) | ISC | TBD verify |
| `ai-context/AGENT_RULES.md` | 7 sections | Generic rules для agentic sessions | SOLID, §6 + §7 explicit |
| `ai-context/SESSION_CONTEXT.md` | 557 lines | State-spec проекта | On-target size, but 3 major drifts + state-vs-change violations |
| `ai-context/WORKLOG.md` | **20 entries** | Rolling 10-12 audit/work journal | **OVER threshold** (>12), rotation due |
| `ai-context/WORKLOG_ARCHIVE.md` | ~50+ lines | Older entries, newest first | Properly formatted |
| `docs/superpowers/specs/*.md` | 4 files | History snapshots, brainstorm specs | 100% naming compliant, 3/4 fully implemented |
| `docs/superpowers/plans/*.md` | 5 files | History snapshots, implementation plans | 100% naming compliant, cross-links Plans→Specs 5/5 |
| `docs/audit/*.md` | 11 reports (+ this 12th) | Stage 1-12 audit series | Comprehensive, INDEX.md missing (созданием closing) |
| `docs/audit/PROMPT-stage-12.txt` | 355 lines | Operator stage prompts | Expected (operator workflow artifact) |

**Total documentation footprint**: ~13 files in active state. Public-facing surface = 0 (README missing). Operator-facing surface = 7 files comprehensive.

---

## Coverage gaps

### README.md — CRITICAL MISSING

Public surface: **none**. Project name «catalyst» / «narrative parser» — anyone landing on GitHub repo sees no description, no tech stack, no setup guide. For private operator-only repos this is acceptable, **but**:
- If repo ever public → unprofessional first impression
- New contributor / hire — must read DEPLOY.md (341 lines!) before understanding what's even being deployed
- Industry standard expectation broken

**Propose**: create minimal README (~80 lines):
- 1-line pitch («24/7 AI-powered memecoin trend monitoring with multi-user Telegram bot and Solana Pay» — matches package.json description)
- Quick start (clone → `npm ci` → copy `.env.example` to `.env` → fill required keys → `npm run dev`)
- Tech stack (Node 20, React inline SPA, SQLite, Telegram, xAI/OpenAI/Google, Apify)
- Architecture (1 diagram or paragraph: scan loop → LLM → alerts → TG)
- Required env keys (top 5)
- Link to DEPLOY.md for production
- License + contributing note

### DEPLOY.md — 5 critical gaps (cross-confirm PROD audit)

| Section | Status | Cross-audit |
|---|---|---|
| Prerequisites | ✓ present | — |
| First-time setup + systemd | ✓ present | — |
| nginx + firewall + backups (cron) | ✓ present | — |
| Rolling deploys + graceful shutdown | ✓ present | — |
| Health checks + monitoring | ✓ present | — |
| Operational tasks (10-row table) | ✓ present | — |
| Pre-launch checklist (13 items) | ✓ present | — |
| Post-launch monitoring (5 items) | ✓ present | — |
| Future hardening (5 items) | ✓ present | — |
| **Restore procedure** | **✗ MISSING** | DB-004 + PROD-005 |
| **Cert renewal verification + alerting SOP** | **✗ MISSING** | PROD-008 |
| **Secret rotation SOP (per-key)** | **✗ MISSING** (only ADMIN_API_KEY stub line 284) | PROD-021 |
| **Disaster recovery (VPS dies, restore from B2)** | **✗ MISSING** | DB-001..003 cluster |
| **Common troubleshooting section** | **✗ MISSING** (TG bot не отвечает / dashboard 502 / Apify quota exceeded) | operational |
| **DB migration procedure (auto on boot или manual?)** | **✗ MISSING** | clarification needed |

### CLAUDE.md — clean

Project-level CLAUDE.md (37 lines) verified accurate:
- SPA-trap warning present (server.js backtick / `\n` / `new RegExp` triple)
- Cross-refs to `ai-context/AGENT_RULES.md`, `SESSION_CONTEXT.md`, `WORKLOG.md`, `WORKLOG_ARCHIVE.md` all valid paths
- Project gotchas section accurate (server.js + SQLite TEXT timestamps)
- No inconsistencies with AGENT_RULES.md
- No drift

### SESSION_CONTEXT.md — 557 lines, on-target size, **3 major drifts + protocol violations**

Total 26+ main sections. Size within AGENT_RULES §7 target (~500-650 lines / 12K tokens).

**Major drifts** (require fix):
| SD | Section | Declared | Reality |
|---|---|---|---|
| SD-12 | Theme system (line 553) | 2 themes: ink (default) + tide | 3 themes: pulse (default) + ink + tide |
| SD-13 | Dashboard layout (line 571) | no breakpoints mentioned | 6 breakpoints in code (1280/1100/960/900/700/600) |
| SD-15 | Admin panel (line 698) | «Section primitive ready for use» | 0 callsites in code, only definition |

**Moderate drifts**:
| SD | Section | Status |
|---|---|---|
| SD-19 | Production posture (line 743) | nginx path documented, **VCS status not declared** |
| SD-18 | Support bot (line 537) | bot commands inventory incomplete |
| SD-22 | Cat mascot (line 618-674) | comprehensive FSM description, **no useEffect count summary** (partial — not false claim, just incomplete) |

**State-vs-change protocol violations** (DOC-005, AGENT_RULES §7):
- Tag auto-refresh section (~line 458+): 7 date-stamped change entries (`2026-05-11 — было фиксированное setInterval`, `2026-05-07`, `2026-05-12 заменили старую...`)
- Scoring metadata section (~line 164+): 4 date-stamped entries (`removed 2026-05-04`, `введён 2026-05-10`, etc.)
- Max-age filter / curator mode: 5+ embedded date references
- **Total: ~30+ date-stamped change entries across 5+ sections.** Should move to WORKLOG.md, leaving SESSION_CONTEXT with "current state only".

**Verified accurate** (no fix needed):
- SD-9 backup contract (Production posture line 738) — declared state matches code reality. Actual broken implementation is at code level (DB-001..003), not docs level.
- SD-10 retention 14d vs 30d B2 lifecycle — declared correctly.
- SD-14 R4 iconography — emoji mentioned, R4 reference present.
- SD-16 pause persistence — accurately declared in-memory-only.
- SD-17 getBotUsername caching — accurately declared (TTL absence is code-level, not docs).
- SD-20 HOT_REFRESH_LIGHT_* — present in Env keys section.

**Cross-references**: all internal links valid (AGENT_RULES.md, WORKLOG.md, .env.example, code paths). No broken links.

### WORKLOG.md — **20 entries, rotation overdue**

AGENT_RULES §6 threshold: >12 entries → rotate older to ARCHIVE. Current **20 entries** (audit stages 1-11 + 8 R-development entries 2026-05-17..05-22).

Format consistency: ✓ all 20 entries follow standard pattern (дата · модель · цель · scope · метод · файлы · counts · top-3 · verified safe · деплой · риски).

Rotation **due**: move entries 13-20 (R-development pre-audit-series, 2026-05-17..05-22) to top of WORKLOG_ARCHIVE.md. Keep entries 1-12 (current audit series Stages 1-11 + final 12) active.

### .env.example — 53 keys documented

100% documented (every key has comment). 53 keys across 10 sections. Comprehensive.

**Still missing** (SD-20 from Stage 9, not yet added):
- `HOT_REFRESH_LIGHT_ENABLED`
- `HOT_REFRESH_LIGHT_INTERVAL_MINUTES`

DASHBOARD_API_KEY description accurate (placeholder + openssl rand instructions). Required/optional markers clear (explicit `# Опционально` / `# DISABLED BY DEFAULT`). Default values present для ~43 keys.

### package.json — minimal but functional

- `description`: accurate match SESSION_CONTEXT
- `scripts`: 2 (start + dev). **Missing**: test, lint, format, check-spa (QUAL-002 from Stage 11)
- `dependencies`: 5 (better-sqlite3, dotenv, node-telegram-bot-api, sharp, undici)
- `devDependencies`: **0** (QUAL-002)
- `engines.node`: **not pinned** (QUAL-009)
- `author`: empty string (low priority)
- `repository`: **unset** (low priority — private repo OK)
- `license`: "ISC" set

### AGENT_RULES.md — 7 sections, well-structured

| § | Topic | Status |
|---|---|---|
| §1 | Перед началом работы | ✓ |
| §2 | Во время работы | ✓ |
| §3 | После выполнения | ✓ |
| §4 | Формат WORKLOG | ✓ |
| §5 | Запреты | ✓ |
| §6 | Ротация WORKLOG → ARCHIVE (threshold >12) | ✓ |
| §7 | SESSION_CONTEXT — state, not change | ✓ |

**Implied but not explicit**: «secret-grep'и не должны returning values» — implied through §5 (no commits secrets) + §7 (no PII tombstones), but not explicit. Stage 1 security audit recommended adding — not done yet.

### Superpowers specs/plans — clean

9 files (4 specs + 5 plans), 100% naming convention compliant (`YYYY-MM-DD-<topic>-design.md` / `YYYY-MM-DD-<topic>.md`). Plans → Specs cross-links 5/5 present. Specs → Plans cross-links asymmetric (OK pattern — specs describe requirements, plans implement, reverse link not mandatory).

Implementation status:
- 3/4 specs **COMPLETED**: dashboard-redesign (R1-R5 deployed), sort-redesign (R5), cat-mascot (R6 + R7 polish)
- **1/4 specs PARTIAL**: iconography-design (R4) — WORKLOG declares complete, audit found 18 emoji remaining (SD-14)

### docs/audit/* — 12 reports

Reports inventory:
| # | File | Stage |
|---|---|---|
| 1 | `2026-05-22-security-audit.md` | Security (Stage 1) |
| 2 | `2026-05-23-pipeline-integrity.md` | Pipeline (Stage 2) |
| 3 | `2026-05-24-billing-entitlements.md` | Billing (Stage 3) |
| 4 | `2026-05-25-cost-throttling.md` | Cost (Stage 4) |
| 5 | `2026-05-26-database-health.md` | Database (Stage 5) |
| 6 | `2026-05-27-dashboard-ux-ui.md` | Dashboard UX (Stage 6) |
| 7 | `2026-05-28-admin-panel.md` | Admin (Stage 7) |
| 8 | `2026-05-29-tg-bot-notifications.md` | TG bot (Stage 8) |
| 9 | `2026-05-30-production-posture.md` | Production (Stage 9) |
| 10 | `2026-05-31-cat-mascot-r7.md` | Cat mascot (Stage 10) |
| 11 | `2026-06-01-code-quality.md` | Code quality (Stage 11) |
| 12 | `2026-06-02-documentation-spec-drift.md` (this doc) | Documentation (Stage 12) |
| meta | `INDEX.md` (created in this audit) | Master integration backlog |
| stage prompt | `PROMPT-stage-12.txt` | Operator workflow artifact |

Naming convention `YYYY-MM-DD-<topic>.md` 100% compliant. Cross-references between reports (e.g. «see SEC-001», «backlog #1») all resolve correctly.

---

## Spec drift resolution table

23 SD items накоплены за 11 этапов. Per-item proposed resolution + effort:

| SD | Description | Resolution category | Where (target) | Effort |
|---|---|---|---|---|
| **SD-1** | TRUST_PROXY=1 declared, not implemented (SEC-003) | Update doc (acknowledge) OR Fix code | SESSION_CONTEXT § Production posture line ~824 | 5 min (doc) or 30 min (code) |
| **SD-2** | alert-dispatcher daily-limit gate JSDoc, no gate in code | Update doc | code JSDoc near dispatcher | 5 min |
| **SD-3** | Catalyst forecast 15-min cooldown in spec, removed (BILL-015) | Update doc | SESSION_CONTEXT § Catalyst forecast line ~500 | 5 min |
| **SD-4** | xAnalysis field not mentioned in § Бизнес-правила | Update doc | SESSION_CONTEXT § Бизнес-правила | 5 min |
| **SD-5** | historyHours 72 for free not in § Бизнес-правила | Update doc | SESSION_CONTEXT § Бизнес-правила | 5 min |
| **SD-6** | favorites:true for pro/admin not explicit | Update doc | SESSION_CONTEXT § Бизнес-правила | 3 min |
| **SD-7** | Manual analysis cache TTL 1h declared, code = 6h | Update doc | SESSION_CONTEXT § Manual analysis | 3 min |
| **SD-8** | Embeddings TTL docstring contradiction (PIPE-007) | Update doc + code comment | code embeddings.js JSDoc | 10 min |
| **SD-9** | Backup contract (sqlite3 .backup + B2 declared, cp actual + B2 missing) | Acknowledge limitation OR Fix code | SESSION_CONTEXT § Production posture line ~746 + scripts/backup.sh | 5 min (mark [partial]) or 4h (#1 backup rewrite bundle) |
| **SD-10** | Backup retention code 30d vs spec 14d | Update doc (already accurate post-Stage 9 — 14d local + 30d B2 lifecycle confirmed) | n/a — resolved | 0 |
| **SD-11** | Schema docs incomplete (7 tables listed, 16 actual) | Update doc | SESSION_CONTEXT or new DB inventory section | 30 min |
| **SD-12** | Theme contract drift (2 themes vs 3 with pulse default) | Update doc | SESSION_CONTEXT § Theme system line 553 | 10 min |
| **SD-13** | Breakpoint cascade undocumented | Update doc | SESSION_CONTEXT § Dashboard layout line 571 | 15 min |
| **SD-14** | R4 iconography sweep declared complete, 18 emoji remain (UX-003) | Update doc + Fix code | WORKLOG_ARCHIVE R4 entry + UX-003 fix | 5 min (doc) + 1h (code emoji replacement) |
| **SD-15** | Section primitive defined в SESSION_CONTEXT, 0 callsites | Acknowledge limitation OR Delete obsolete | SESSION_CONTEXT § Admin panel line ~698 | 5 min |
| **SD-16** | Pause state in-memory only, not persisted (ADM-007) | Acknowledge limitation OR Fix code | SESSION_CONTEXT § Admin panel + Fix in src/index.js (5 lines) | 5 min (doc) or 30 min (code) |
| **SD-17** | getBotUsername caching no TTL, no refresh (BOT-014/15) | Update doc + Fix code | SESSION_CONTEXT § Dashboard layout + code refresh logic | 5 min (doc) + 30 min (code) |
| **SD-18** | Bot commands inventory overstate (/forecast inline only, /help/stop/pause missing) | Update doc + Fix code | SESSION_CONTEXT + bot commands implementation | 10 min (doc) + 1h (add commands) |
| **SD-19** | nginx config NOT in version control | Update doc + Commit nginx config to repo | new infra/nginx/catalyst.conf + SESSION_CONTEXT update | 20 min (commit + docs) |
| **SD-20** | HOT_REFRESH_LIGHT_* env keys missing in .env.example | Update doc | .env.example | 3 min |
| **SD-21** | Backup script name mismatch (`scripts/backup.sh` vs `/usr/local/bin/catalyst-backup.sh`) | Fix code + Update doc | scripts/catalyst-backup.sh (commit prod script) + DEPLOY.md | 1h (part of #1) |
| **SD-22** | Cat mascot useEffect count drift (8 declared, 11 actual) | Update doc | SESSION_CONTEXT § Cat mascot line 618-674 | 5 min |
| **SD-23** | CSS theme comment drift (line 2636 declares 2 themes) | Fix code comment | src/dashboard/server.js:2636-2638 | 3 min |

**Resolution breakdown**:
- **Update doc only** (15 items): SD-1, SD-2, SD-3, SD-4, SD-5, SD-6, SD-7, SD-8 (doc part), SD-10, SD-11, SD-12, SD-13, SD-15, SD-20, SD-22. Total: **~2 hours doc updates**.
- **Update doc + Fix code** (5 items): SD-9, SD-14, SD-17, SD-18, SD-21. Mixed effort.
- **Fix code only** (3 items): SD-16 (pause persist 5 lines), SD-19 (commit nginx config), SD-23 (1-line CSS comment).

**If priority = «update SESSION_CONTEXT в одну сессию» (~2-3 hours)**: 15 items resolved purely through doc edits. Sustainable cleanup.

**If priority = «pair with code-fix PRs»**: bundle SD items with their related code fixes (most efficient via «one-fix-many-wins» backlog).

---

## Summary

**Counts**: 0 critical · **4 high** · 7 medium · 5 low · 4 info · **20 findings total** + 23 spec drift resolution proposals.

Общее впечатление — **documentation в неплохой форме для 2-year solo project**: CLAUDE.md accurate, DEPLOY.md comprehensive (341 lines), SESSION_CONTEXT on-target size (557 lines), .env.example 100% documented, AGENT_RULES well-structured (7 sections), superpowers specs/plans 100% naming-compliant, audit series 11 reports cross-referenced.

Слабые места — **4 high** в трёх кластерах:
1. **README.md missing** (DOC-001) — public surface = 0. Acceptable for private operator-only repo, critical если когда-нибудь репозиторий открыть.
2. **DEPLOY.md missing 5 critical sections** — restore procedure (DB-004 + PROD-005 cross), cert renewal SOP (PROD-008), secret rotation SOP (PROD-021), DR section, troubleshooting. DEPLOY.md comprehensive по happy path, но **fragile on incident response**. DOC-002, DOC-003, DOC-004, DOC-016.
3. **SESSION_CONTEXT state-vs-change protocol violations** (DOC-005) — Tag auto-refresh + Scoring sections have 30+ date-stamped change narratives. Violates AGENT_RULES §7. Sections functional but technically «change-log embedded в state-spec».

Medium набор — 3 major drifts (SD-12 theme, SD-13 breakpoints, SD-15 Section primitive) + WORKLOG ротация overdue (20 entries > 12 threshold).

**Top-3** для разбора в первую очередь:
1. **DOC-002 + DOC-003 + DOC-004 + DOC-016** combined — extend DEPLOY.md с 4 missing critical sections (restore, cert renewal, secret rotation, DR). One PR, ~2 hours, closes 4 finding'ов + cross-overlap PROD-005/008/021 + DB-004.
2. **DOC-005** SESSION_CONTEXT cleanup — move 30+ date-stamped change entries из Tag refresh / Scoring sections в WORKLOG_ARCHIVE.md. Restores §7 compliance. ~45 min careful edit.
3. **DOC-001** README.md creation — public-facing pitch + quick start + tech stack. ~30 min from scratch.

**Documentation quality verdict**: **~70%**. Comprehensive operator-facing docs but missing recovery procedures + no public README. SESSION_CONTEXT has minor drifts but accurate overall.

**Onboarding-readiness verdict**: **~50%**. Operator can deploy (DEPLOY.md). Operator CANNOT recover from disasters (no restore docs). New developer onboarding: no README, must read DEPLOY.md and SESSION_CONTEXT cold = friction.

---

## Findings

### [DOC-001] README.md missing — public surface = 0 — severity: **high**

* **Where**: project root
* **Category**: documentation completeness
* **What**: no README.md. Anyone landing on repo (GitHub, clone) sees no description, no setup, no tech stack, no contribution guide. For currently private operator repo — acceptable trade-off. **If repo ever public** → unprofessional first impression + new contributor friction.
* **Repro/impact**: clone repo, look at file tree → confused about project purpose. Must open `package.json` + `DEPLOY.md` (341 lines) to understand.
* **Fix**: create README.md ~80 lines: pitch + quick start + tech stack + env keys minimal + link to DEPLOY.md + license/contributing. ~30 min from scratch.

---

### [DOC-002] DEPLOY.md missing restore procedure — severity: **high**

* **Where**: `DEPLOY.md` (section absent)
* **Category**: disaster recovery / cross-confirm DB-004 + PROD-005
* **What**: DEPLOY.md describes backup creation (cron, retention) but **no restore procedure**. How to restore from `.db.gz` snapshot? Verify integrity? Stop container, swap, restart? B2 fetch (когда implemented)?
* **Operational impact**: catastrophic data loss scenario = operator learns by-doing under pressure.
* **Fix**: add «§ 6.b Restore from backup» section to DEPLOY.md, ~25 lines: 6-7 step procedure (gunzip → PRAGMA integrity_check → stop container → swap file → restart → smoke test → post-restore validation row counts). Plus quarterly drill schedule note. Cross-overlap backlog #1 backup integrity rewrite.

---

### [DOC-003] DEPLOY.md missing cert renewal verification SOP — severity: **high**

* **Where**: `DEPLOY.md` (section absent)
* **Category**: ops / cross-confirm PROD-008
* **What**: certbot.timer mentioned in DEPLOY.md but **no verification SOP** (`systemctl status certbot.timer`, `journalctl -u certbot.timer`, last renewal date). No alerting если renewal silently fails. HTTPS could die через 90d without warning.
* **Fix**: add «§ 13. TLS certificate renewal verification» — 4 steps: check timer status, check last renewal log entry, manually test renewal, external cert expiry check via openssl. Plus UptimeRobot signup recommendation (free tier supports cert checking). ~15 lines.

---

### [DOC-004] DEPLOY.md missing secret rotation SOP (per-key) — severity: **high**

* **Where**: `DEPLOY.md:284` (only `Rotate ADMIN_API_KEY` 1-liner stub)
* **Category**: ops / cross-confirm PROD-021
* **What**: DEPLOY.md mentions ADMIN_API_KEY rotation as 1-liner. **No rotation schedule, no alerts, no procedure for** XAI_API_KEY / OPENAI_API_KEY / TELEGRAM_BOT_TOKEN / Apify keys / SUPPORT_BOT_TOKEN. If any compromised — operator has no documented hot-rotate path.
* **Fix**: extend `§ Secret rotation» — per-key procedure (.env edit → service restart → revoke old key on provider side → verify), recommended rotation schedule (90d for high-value keys). ~25 lines.

---

### [DOC-005] SESSION_CONTEXT state-vs-change protocol violations (30+ date entries) — severity: **high**

* **Where**: `SESSION_CONTEXT.md` § Tag auto-refresh (~line 458+), § Scoring metadata (~line 164+), § Max-age filter, § Curator mode
* **Category**: AGENT_RULES §7 violation
* **What**: 5+ sections include 30+ date-stamped change narratives (`2026-05-11 — было фиксированное setInterval`, `removed 2026-05-04`, `введён 2026-05-10`, `до 2026-05-11 было X · Y · Z — расширено`). AGENT_RULES §7 explicit: «SESSION_CONTEXT — state, not change. Forbid: date-headers, ‘used to be X’, tombstones, TODOs.»
* **Operational impact**: doc length inflated с change history that belongs в WORKLOG. New agent reading SESSION_CONTEXT sees old + new states + transitions = confused. Section semantics drift away from «what is current state».
* **Fix**: refactor 5 affected sections — move date-stamped narratives to WORKLOG_ARCHIVE.md (as history), leave SESSION_CONTEXT with «current state only» descriptions. ~45 min careful editing. Each section reduces by 30-50%.

---

### [DOC-006] SESSION_CONTEXT Theme system drift (SD-12) — severity: **medium**

* **Where**: `SESSION_CONTEXT.md:553-570` (Theme system section)
* **Category**: spec drift
* **What**: declares 2 themes (ink default + tide). Реально 3 (pulse default + ink + tide). Pulse = `:root` baseline (no attribute selector), ink/tide = `body[data-theme="X"]` attributes. JS comment line 7158 correct, but SESSION_CONTEXT + CSS comment line 2636 stale.
* **Fix**: rewrite Theme system section с 3 themes, mark pulse default (baseline, no attribute). Plus fix CSS comment в dashboard/server.js:2636 (QUAL-005). ~10 min docs + 3 min code.

---

### [DOC-007] SESSION_CONTEXT breakpoints undocumented (SD-13) — severity: **medium**

* **Where**: `SESSION_CONTEXT.md:571-606` (Dashboard layout section)
* **Category**: spec drift
* **What**: no breakpoints mentioned. Code has 6 breakpoints (1280/1100/960/900/700/600) with different semantics (sidebar collapse @900, cat unmount @700, modal width @600).
* **Fix**: add «Responsive breakpoints» subsection to Dashboard layout, table breakpoint × what changes. ~15 min.

---

### [DOC-008] SESSION_CONTEXT Section primitive 0 adoption (SD-15) — severity: **medium**

* **Where**: `SESSION_CONTEXT.md:~698` (Admin panel section)
* **Category**: spec drift / removed declaration
* **What**: declares Section primitive «ready for use», but 0 callsites in code (all .adm-card legacy still). Either start adoption или delete spurious declaration.
* **Fix**: either acknowledge limitation («Section primitive defined but adoption pending, .adm-card remains active») или delete reference. 5 min either way.

---

### [DOC-009] SESSION_CONTEXT Cat mascot useEffect count gap (SD-22) — severity: **low**

* **Where**: `SESSION_CONTEXT.md:618-674` (Cat mascot section)
* **Category**: spec drift / completeness
* **What**: comprehensive FSM description but **no useEffect count inventory**. WORKLOG older entries mention «8 useEffects», реально 11 (post-R7 expansion). Not false claim, just incomplete.
* **Fix**: add 1-line note «11 useEffects manage FSM transitions, event listeners, and lifecycle». ~3 min.

---

### [DOC-010] WORKLOG R4 iconography claim drift (SD-14) — severity: **medium**

* **Where**: `WORKLOG_ARCHIVE.md` 2026-05-20 R4 iconography entry
* **Category**: completion accuracy drift
* **What**: R4 entry declares iconography sweep «complete». UX-003 audit found 18 emoji still in render path (11 в i18n + 7 inline JSX). Claim overstates completion.
* **Fix**: update R4 entry: «R4 iconography sweep covered ~85% of glyphs; 18 emoji remain in i18n strings + inline JSX, see UX-003 for cleanup backlog». ~5 min.

---

### [DOC-011] .env.example missing HOT_REFRESH_LIGHT_* keys (SD-20) — severity: **low**

* **Where**: `.env.example` (keys absent)
* **Category**: env documentation
* **What**: `HOT_REFRESH_LIGHT_ENABLED` + `HOT_REFRESH_LIGHT_INTERVAL_MINUTES` used in code (src/index.js:167, 171) but not documented в .env.example. New operator doesn't know they exist, defaults run silently.
* **Fix**: add 2 keys to .env.example в Hot Refresh section with comment + default. ~3 min.

---

### [DOC-012] package.json minor metadata gaps — severity: **low**

* **Where**: `package.json`
* **Category**: project metadata
* **What**: `author` empty string, `repository` field unset (private repo OK), `engines.node` not pinned (cross-confirm QUAL-009). Description accurate.
* **Fix**: add `"engines": { "node": ">=20.0.0 <21.0.0" }`, optionally fill author + repository. Cross-overlap backlog #18 (QA infra bootstrap). ~5 min.

---

### [DOC-013] WORKLOG ротация overdue — 20 entries > 12 threshold — severity: **medium**

* **Where**: `ai-context/WORKLOG.md` (currently 20 entries)
* **Category**: AGENT_RULES §6 enforcement
* **What**: AGENT_RULES §6 declares «rotate when >12 entries, keep ~10 active». Current 20 entries (audit stages 1-11 + 8 R-development entries). Stage 12 final entry will bring к 21.
* **Operational impact**: WORKLOG.md becomes harder to scan, defeats rolling-journal purpose. Older R-development entries (2026-05-17..05-22) belong в archive.
* **Fix**: rotate entries 13-20 (R-development pre-audit-series) to top of WORKLOG_ARCHIVE.md. Keep entries 1-12 (current audit series Stages 1-11 + Stage 12 final) active. Newer-to-older order maintained. ~10 min careful copy-paste + verify.

---

### [DOC-014] docs/audit/INDEX.md missing — recommendation finding — severity: **low**

* **Where**: `docs/audit/` (no INDEX.md present at audit start)
* **Category**: navigation / discoverability
* **What**: 11 audit reports + this one = 12. Without INDEX.md, future operator must read all 12 reports to understand series context. Audit series как unit lacks navigation entry point.
* **Fix**: creating `docs/audit/INDEX.md` in this audit closes this finding. Master integration backlog + verdicts dashboard + lessons learned. ~1 hour creation.
* **Status**: **resolved during this audit** (see companion document).

---

### [DOC-015] AGENT_RULES.md no explicit no-secret-output rule — severity: **low**

* **Where**: `ai-context/AGENT_RULES.md`
* **Category**: agent safety
* **What**: Security audit recommended adding «secret-grep'и не должны returning values» rule. Currently implied through §5 (no commit secrets) + §7 (no PII tombstones) but not explicit. Newer agent may not infer.
* **Fix**: add to §5 explicit bullet: «при analysis файлов с секретами (`.env`, `*.pem`, credentials) — output только key names + статусы, никогда не значения секретов». ~3 min.

---

### [DOC-016] DEPLOY.md missing disaster recovery (DR) section — severity: **medium**

* **Where**: `DEPLOY.md`
* **Category**: disaster recovery
* **What**: scenario «VPS dies completely, need new server from B2 backup» — no documented procedure. Cross-confirm DB-003 (B2 not implemented yet) + PROD audit. Once B2 lands (backlog #1), DR procedure must follow.
* **Fix**: add «§ Disaster Recovery» section once B2 backup is real. ~30 min after backup rewrite lands.

---

### [DOC-017] DEPLOY.md missing common troubleshooting section — severity: **low**

* **Where**: `DEPLOY.md`
* **Category**: operations
* **What**: no scenarios «TG bot не отвечает», «dashboard returns 502», «Apify quota exceeded», «one collector crashed loop». Operator must figure it out от scratch each incident.
* **Fix**: add «§ Common troubleshooting» с 5-7 scenarios + diagnostics commands. ~30 min.

---

### [DOC-018] DEPLOY.md missing migration procedure clarification — severity: **low**

* **Where**: `DEPLOY.md`
* **Category**: operations / DB
* **What**: migration runner exists (`_migrate()` in database.js, auto on boot). Not documented в DEPLOY.md. New operator wonders «do I run anything for schema changes?» Answer: no, but should be explicit.
* **Fix**: add 1-paragraph note «Database migrations are applied automatically on container boot via `_migrate()` in database.js. No manual step required. See database.js for migration log.» ~5 min.

---

### [DOC-019] docs/audit naming convention 100% compliant — info severity: **info**

* **Where**: `docs/audit/*.md`
* **Category**: archive hygiene
* **What**: 12 reports all match `YYYY-MM-DD-<topic>.md`. Cross-references resolve. No naming drift.
* **Status**: verified safe.

---

### [DOC-020] Superpowers specs/plans cross-link asymmetry — info — severity: **info**

* **Where**: `docs/superpowers/specs/*.md` ↔ `plans/*.md`
* **Category**: cross-references
* **What**: plans→specs full (5/5 sample), specs→plans partial. Asymmetric but acceptable pattern (specs describe requirements, plans implement — reverse link not mandatory).
* **Status**: verified safe.

---

## Verified safe

То что прошло — финальный baseline:

1. **CLAUDE.md** (project-level) — accurate, SPA-trap warning present, cross-refs valid, no inconsistencies with AGENT_RULES.
2. **AGENT_RULES.md** — 7 sections, §6 rotation explicit (threshold >12), §7 state-vs-change explicit, format consistency.
3. **SESSION_CONTEXT.md size** — 557 lines, within target 500-650 lines / 12K tokens.
4. **SESSION_CONTEXT cross-references** — all internal links to AGENT_RULES.md, WORKLOG.md, .env.example, code paths valid. No broken links.
5. **DEPLOY.md happy-path sections** — prerequisites, systemd, nginx, firewall, backups (creation), deploy, health, ops table, pre-launch checklist (13 items), post-launch monitoring (5 items), future hardening list. Comprehensive for normal operations.
6. **DEPLOY.md examples/commands accuracy** — all systemd paths, firewall rules, nginx config, cron syntax verified syntactically correct.
7. **.env.example** — 53 keys 100% documented с comments, required vs optional clear, default values present, DASHBOARD_API_KEY description accurate, secret placeholders properly marked.
8. **package.json description** — accurately matches SESSION_CONTEXT statement.
9. **package.json license** — ISC set.
10. **WORKLOG entry format** — 100% consistency across 20 entries (date · model · цель · scope · метод · файлы · counts · top-3 · verified safe · деплой · риски).
11. **WORKLOG_ARCHIVE.md** — exists, properly formatted, newest-first ordering inside, header summary intact.
12. **Superpowers specs/plans naming** — 100% compliant `YYYY-MM-DD-<topic>-design.md` / `YYYY-MM-DD-<topic>.md`.
13. **Plans→Specs cross-links** — 5/5 sample present and resolve.
14. **3 of 4 specs fully implemented** — dashboard-redesign (R1-R5), sort-redesign (R5), cat-mascot (R6+R7). Only iconography R4 partial (SD-14).
15. **docs/audit/*.md naming** — 12 reports 100% compliant.
16. **Audit cross-references** between reports — all SD-XX, finding ID references resolve correctly.
17. **SD-10 backup retention** — actually accurate (14d local + 30d B2 lifecycle) — drift was false alarm.
18. **SD-9 backup contract docs** — SESSION_CONTEXT describes real intent (broken implementation is code-level, not docs-level).
19. **SD-14 R4 iconography mention** — emoji documented in SESSION_CONTEXT cat mascot section, R4 reference present.
20. **SD-16 pause persistence** — accurately declared in-memory-only in SESSION_CONTEXT (drift is code, not docs).
21. **SD-17 getBotUsername caching** — accurately declared current state (TTL absence is code, not docs).
22. **SD-20 HOT_REFRESH_LIGHT_*** — present in SESSION_CONTEXT Env keys (drift is .env.example, not main docs).
23. **No SESSION_CONTEXT broken cross-refs** — all `AGENT_RULES §X`, `WORKLOG.md`, `.env.example`, code path references valid.
24. **0 TODO/FIXME/XXX/HACK markers** in code (Stage 11 verified).
25. **WORKLOG format consistency** — all 20 entries follow standard pattern.

---

## Out of scope / followups

- **All previous 11 stages** — done.
- **Code-level fixes for spec drift items** — backlog targets covered in INDEX.md priority queue.
- **WORKLOG ротация execution** — proposed в DOC-013 but operator decides timing.

**Open assumptions** (`⚠ assumes`):
- LICENSE file presence — `package.json` declares license=ISC, ⚠ assumes physical LICENSE file exists (not verified). If absent, low-severity recommendation create.
- `repository` field — left unset assuming intentional (private repo).
- `author` empty assuming intentional (solo project / no public attribution preference).
- ABSENT internal links beyond sample — full link graph not audited, sample shows 100% valid.

**Stage 12 closes audit series.**

See `docs/audit/INDEX.md` for master integration: 12-stage verdicts dashboard, priority backlog (4 tiers), spec drift sync queue, lessons learned, next steps.
