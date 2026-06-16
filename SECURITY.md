# Security Policy

## Reporting a Vulnerability

Please do not open public issues for vulnerabilities, leaked secrets, auth
bypasses, payment bugs, or production deployment details.

For now, report security concerns privately to the repository owner. Include:

- affected version or commit
- a short reproduction path
- expected vs actual behavior
- any logs or screenshots with secrets redacted

## Scope

This project is a single-operator Node.js application with a Telegram bot,
SQLite storage, local deployment scripts, and optional third-party API
integrations.

Before running it in production, review your own deployment, rotate all keys
that were ever committed or shared, and enable GitHub secret scanning and
Dependabot alerts on the public repository.

## Known Security Notes

- Dashboard/admin tokens are currently stored in browser localStorage.
- Production secrets must live in `.env` or a private secret manager, never in
  git.
- The pre-publication audit is tracked in `docs/open-source-readiness.md`.
