# Contributing

Thanks for your interest in Catalyst.

This is a first public open-source release of a project that was originally
built as a single-operator production tool. The contribution flow is intentionally
lightweight, but the quality bar is real: changes should be understandable,
reviewable and safe to run with real API keys.

## Ways To Help

- Improve setup docs, examples and troubleshooting notes.
- Add focused tests around data parsing, scoring fallback and billing edge
  cases.
- Improve provider adapters without changing the default production behavior.
- Harden security-sensitive paths such as auth, URL fetching, payment
  verification and deployment.
- Fix dashboard/admin issues, then run the SPA syntax check.

## Before You Start

- Open an issue before larger changes, new integrations, billing changes or
  security-sensitive work.
- Do not commit secrets, provider keys, hostnames, private runbooks, local
  databases, logs or screenshots with tokens.
- Keep changes scoped. This repository is intentionally a single-process app,
  not a microservice platform.
- If you use AI tools such as Codex, review the generated code yourself before
  submitting it.

## Local Setup

```powershell
git clone https://github.com/overdosesol/Catalyst.git
Set-Location "Catalyst"
npm install
Copy-Item ".env.example" ".env"
npm run dev
```

Fill `.env` with your own development keys. You do not need every optional
provider for documentation and many code changes, but production mode requires
the critical keys described in the README.

## Checks

Run before opening a pull request:

```powershell
npm run check
npm audit --omit=dev
```

If you edit `src/dashboard/server.js` or `src/admin/server.js`, `npm run check`
is required because both files embed large inline React apps inside template
literals.

For touched JavaScript files, a syntax check is also useful:

```powershell
node --check "src/path/to/file.js"
```

## Pull Request Checklist

- The change has a clear purpose and a small review surface.
- Public docs were updated if setup, configuration or behavior changed.
- No secrets or production-only details were added.
- `npm run check` passes.
- `npm audit --omit=dev` has no production vulnerabilities, or the PR explains
  why the alert is unrelated.
- Screenshots or logs are redacted if they include user data, tokens, chat IDs
  or provider responses.

## AI-Assisted Contributions

AI assistance is welcome. Please treat generated code as untrusted draft work:

- read the diff carefully;
- verify the code against the current repository, not memory;
- run the checks above;
- mention meaningful AI-assisted design choices in the PR description when they
  affect maintainability or security.

The maintainer may also use Codex for triage, review assistance and release
prep, but final project decisions remain human-reviewed.

## Security

Do not report vulnerabilities in public issues or PRs. Use the process in
[SECURITY.md](SECURITY.md).
