# Open Source Readiness Audit

Date: 2026-06-17

This is a pre-publication audit for turning Catalyst into an open source
repository while preserving the visible development history. It intentionally
does not include secret values.

## Executive Summary

The repository is not ready to publish as-is.

No high-confidence secret formats were found in the current tracked tree during
the custom scan, and `.env` is currently ignored. The first cleanup pass also
replaced real-looking keys in `.env.example` with explicit placeholders.

The first cleanup pass removed internal/private paths from the public tree with
`git rm --cached`, genericized production host/domain/bucket references, and
removed hard-coded public URLs from deploy and Telegram notification code.

The local history has now been rewritten to remove the known internal paths,
old production references, and real-looking `.env.example` key examples.

Public-facing repository docs and GitHub contribution templates have been
prepared for the first OSS release.

Remaining publication work: submit the Codex for OSS application and monitor
GitHub alerts after new public commits.

## Findings

### OSR-001: Private/internal files were tracked

Severity: Resolved locally / verify remote before publication

Evidence:

- These paths were tracked before cleanup: `.claude`, `.codex-backups`,
  `ai-context`, `docs/superpowers`, `posts`, `DEPLOYMENT_SUMMARY.txt`, and
  `EvilCatPack`.
- They have been removed from the current public tree with `git rm --cached`
  and added to `.gitignore`.
- Local rewritten history now reports 0 matches for these paths.

Impact:

Publishing these files would expose agent session rules, private worklogs,
internal plans, local assistant settings, old source snapshots, and possibly
third-party asset files without clear redistribution evidence.

Recommendation:

Keep these files local/private. Before publication, make sure GitHub no longer
has old refs that point to the pre-rewrite history.

### OSR-002: Production infrastructure details were present

Severity: Resolved locally / verify remote before publication

Evidence:

- `deploy.ps1` and `deploy.sh` previously contained a default root SSH target
  for the production host.
- `DEPLOY.md`, `scripts/nginx-catalyst.conf`, `scripts/check-cert-expiry.sh`,
  internal context, and audit/planning docs referenced the live domain,
  hostnames, SSH commands, backup bucket names, and operational procedures.
- Current public files and rewritten history now use example
  domains/placeholders instead of the live host/domain/bucket.

Impact:

This is not the same as a leaked password, but it gives attackers and random
internet users a map of the production setup.

Recommendation:

Keep real production runbooks in private operator notes or a password manager.
Re-scan GitHub after force-pushing the rewritten history.

### OSR-003: `.env.example` history contained real-looking key values

Severity: Resolved locally / rotate if any doubt

Evidence:

- Current `.env.example` has been changed to use explicit placeholders.
- Historical real-looking `ADMIN_API_KEY` / `DASHBOARD_API_KEY` examples were
  rewritten to placeholders.
- Local `.env` values for checked secret keys did not match historical
  `.env.example` values.

Impact:

Even if these are examples, readers may treat them as reusable defaults. If any
were ever used in production or staging, they must be considered compromised.

Recommendation:

Rotate any matching live keys before publication if there is any doubt.

### OSR-004: Open source metadata is mostly in place

Severity: Medium

Evidence:

- `package.json` has empty `author`.
- `LICENSE` has been added with MIT.
- `CONTRIBUTING.md` has been added.
- `SECURITY.md` and `.github/dependabot.yml` have been added.
- `README.md` now points to the MIT license.

Impact:

The project is now legally clear enough for a first public release, but owner
metadata can still be improved.

Recommendation:

Fill in package `author` if desired, and expand contributor docs after the
first public release.

### OSR-005: Dependency audit had production vulnerabilities

Severity: Resolved locally / verify after push

Evidence:

- Before cleanup, `npm audit --omit=dev` reported 10 vulnerabilities: 2
  critical, 1 high, 7 moderate.
- GitHub Dependabot alerts are enabled and reported 10 open alerts before the
  local dependency update.
- GitHub Dependabot security updates are enabled.
- The vulnerable chain was `node-telegram-bot-api -> request/form-data/qs`.
- `node-telegram-bot-api` was upgraded to 1.1.0.
- Local `npm audit --omit=dev` now reports 0 vulnerabilities.

Impact:

The public repository should stop showing these Dependabot alerts after the
dependency update is committed and pushed.

Recommendation:

Push the dependency update, then verify GitHub Dependabot alerts close.

### OSR-008: GitHub secret scanning is enabled

Severity: Resolved

Evidence:

- The repository is public.
- GitHub secret scanning is enabled.
- GitHub secret scanning push protection is enabled.
- GitHub secret scanning currently reports 0 open alerts.

Impact:

GitHub will scan pushes/history for supported secret patterns and block known
secret leaks before they land when push protection detects them.

Recommendation:

Keep secret scanning and push protection enabled.

### OSR-006: Asset licensing is unclear

Severity: Medium

Evidence:

- `EvilCatPack` contains 536 tracked image files.
- No license/readme/credits file was found inside `EvilCatPack`.

Impact:

Redistributing third-party art without a clear license can create copyright
trouble even when the code license is valid.

Recommendation:

Either remove `EvilCatPack` from the public repo, add verifiable licensing and
attribution, or replace it with assets you own.

### OSR-007: Browser and DB auth-token exposure

Severity: Partially resolved

Evidence:

- Dashboard now keeps `ts_auth_token` in `sessionStorage`, removes the legacy
  `localStorage` key on load, and no longer places bearer tokens in avatar or
  SSE URLs.
- Dashboard auth sessions now store `token_hash` instead of new plaintext
  bearer tokens. Legacy plaintext tokens migrate to `token_hash` on use.
- Admin still stores `adminKey` in `localStorage`; admin is designed as an
  operator-only, loopback/SSH-tunnel surface.

Impact:

XSS would still be serious because browser JavaScript must attach the bearer
token to API calls, but long-lived dashboard tokens are no longer persisted in
localStorage or leaked through query strings.

Recommendation:

For third-party production use, consider a full session-cookie + CSRF design or
a frontend bundle split that supports a stricter CSP/Trusted Types posture.

### OSR-009: Solana Pay manual-transfer fallback remains deferred

Severity: Medium / postponed by owner

Evidence:

- `src/billing/solana-pay.js` still has a fallback that searches recent merchant
  transactions and matches by amount/time when the Solana Pay `reference`
  lookup does not find a transaction.
- Owner explicitly asked not to change this path in the current security pass
  because the project is paused.

Impact:

Reference-based Solana Pay verification is safer. Amount/time matching can be
ambiguous when several users pay the same amount around the same time, and it
is harder to reason about during disputes or replay-like edge cases.

Recommendation:

Before re-enabling or promoting paid plans, either remove the amount-matching
fallback or gate it behind an explicit manual-review/operator workflow.

### OSR-010: Public repository presentation is prepared

Severity: Resolved

Evidence:

- `README.md` now explains the project purpose, pipeline, architecture,
  OpenAI/GPT usage, Codex-assisted maintenance workflow, setup, deployment,
  contribution flow, security policy and roadmap.
- `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `MAINTAINERS.md`,
  `ROADMAP.md`, issue templates and a pull request template are present.
- `package.json` now has repository, bugs, homepage, author and Node engine
  metadata.

Impact:

The public repository now gives reviewers a clearer picture of what the project
does, how it is maintained, how contributors should engage, and how AI/Codex
fits into the project without making unsupported claims.

Recommendation:

Use the README and ROADMAP wording as source material for the Codex for OSS
application fields, especially the API-credit and maintainer-workflow answers.

## Recommended Release Strategy

1. Rotate secrets before publication if there is any doubt.
2. Keep the sanitized working tree on `main`.
3. Re-scan the GitHub repository with gitleaks or TruffleHog.
4. Push the local dependency cleanup commit.
5. Verify GitHub Dependabot alerts close.
6. Prepare and submit the Codex for OSS application.

## Proposed Public Exclude List

Review and remove from the public release:

- `.claude/`
- `.codex-backups/`
- `ai-context/`
- `docs/superpowers/`
- `posts/`
- `DEPLOYMENT_SUMMARY.txt`
- `EvilCatPack/` unless licensing is confirmed
- production-specific deploy defaults and nginx/cert scripts

## Scan Notes

Custom scans performed before and after local history rewrite:

- Current tracked tree scan for common secret formats.
- Git history unique text blob scan for common secret formats.
- Search for production host/domain references.
- Search for internal tracked file groups.
- `npm audit --omit=dev`.
- GitHub Dependabot alerts: enabled, 10 open alerts before local dependency
  cleanup.
- GitHub Dependabot security updates: enabled.
- Local `npm audit --omit=dev` after dependency cleanup: 0 vulnerabilities.
- GitHub repository visibility: public.
- GitHub secret scanning: enabled.
- GitHub secret scanning push protection: enabled.
- GitHub secret scanning open alerts: 0.
- Post-rewrite path scan for excluded internal paths: 0 findings.
- Post-rewrite old production string scan: 0 findings.
- Post-rewrite `.env.example` bad API key line scan: 0 findings.
- Post-rewrite common secret-format scan: 0 findings.

Limitations:

- `gitleaks` is not installed locally, so this should be followed by a real
  gitleaks or TruffleHog scan before publishing.
- The custom scanner avoids printing secret values and is intentionally
  conservative.
