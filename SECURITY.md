# Security Policy

## Reporting A Vulnerability

Please do not open public issues for vulnerabilities, leaked secrets, auth
bypasses, payment bugs or production deployment details.

For now, report security concerns privately to the repository owner. Include:

- affected commit or version;
- a short reproduction path;
- expected vs actual behavior;
- logs or screenshots with secrets, tokens, chat IDs and provider responses
  redacted.

## Supported Versions

Security fixes target the current `main` branch until the project starts
publishing tagged releases.

## Scope

Catalyst is a single-operator Node.js application with:

- Telegram bot auth and alerts;
- SQLite storage;
- dashboard and admin HTTP surfaces;
- optional third-party API integrations;
- local Docker/VPS deployment scripts;
- Solana Pay billing support.

Before running your own production deployment, review your environment, rotate
all keys that were ever committed or shared, and enable GitHub secret scanning
and Dependabot alerts on your fork.

## Current Security Notes

- Dashboard bearer sessions are stored as hashed tokens server-side, with a
  30-day sliding expiry that is refreshed on use. The browser keeps the active
  token in `localStorage`. `sessionStorage` was tried and reverted: it does not
  meaningfully limit XSS (a script on the page reads either store) and it ended
  every session when the browser closed. Moving the token to an `HttpOnly`
  cookie is the real hardening step and is still open.
- Admin still stores the operator key in browser `localStorage`; the admin panel
  is designed for loopback/SSH-tunnel access only, not direct internet exposure.
- Production secrets must live in `.env` or a private secret manager, never in
  git.
- The pre-publication audit is tracked in
  [docs/open-source-readiness.md](docs/open-source-readiness.md).
- Solana Pay verification is reference-based by default. The manual-transfer
  amount/time fallback is disabled unless the operator explicitly sets
  `SOLANA_PAY_MANUAL_FALLBACK=1`; treat that mode as higher risk and monitor
  payments manually.

## Disclosure Expectations

Please give the maintainer reasonable time to investigate before sharing details
publicly. If the report is valid, the fix and credit can be included in release
notes unless you prefer to stay anonymous.
