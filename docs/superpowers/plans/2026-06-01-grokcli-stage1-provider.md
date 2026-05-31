# Grok Build CLI Stage 1 Provider — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `grokcli` as a fourth Stage 1 scoring provider that runs the Grok Build CLI over a SuperGrok subscription (no per-token API cost), admin-switchable like xai/openai/gemini, with bounded-concurrency batching, retry, and API fallback.

**Architecture:** A new `transport: 'cli'` provider in `scorer.js`'s provider registry. `_callResponsesAPI` forks at the top: cli transport → new `_callGrokCli` (spawns `grok -p`, reusing the proven spawn pattern from `gemini-captioner.js`); http transport → existing `fetch`. Stage 1's batch loop gains a bounded-concurrency pool for cli only (http path untouched). Resilience: CLI retry → API-provider fallback → heuristic. The CLI binary is installed into the Docker image (`apk add git` required — grok-build needs git + a real cwd), and the host `~/.grok` session dir is bind-mounted so the subscription session survives redeploys.

**Tech Stack:** Node 20 ESM, better-sqlite3, Docker (node:20-alpine), Grok Build CLI v0.2.14 (static linux-x86_64 binary), node `child_process.spawn`.

**Spec:** `docs/superpowers/specs/2026-06-01-grokcli-stage1-provider-design.md`

**Empirically validated before this plan (sandbox 185.192.23.55):** device-auth subscription works headless; grok-build returns valid Stage 1 JSON on the real 12-trend prod prompt; 4 concurrent calls = 99s (no throttle); **static binary runs in node:20-alpine**; with `apk add git` + `--cwd /work` it returns clean 12/12 JSON including `needsDeeperLook`.

---

## File Structure

- **`src/analysis/grok-cli.js`** (NEW) — isolated module: `callGrokCli({ bin, prompt, timeoutMs, cwd, logger })` (spawn wrapper) + `probeGrokSession({ bin, timeoutMs })` (liveness). One responsibility: talk to the CLI subprocess. Keeps `scorer.js` from growing a subprocess concern inline.
- **`src/analysis/scorer.js`** (MODIFY) — register `grokcli` provider; transport-aware `enabled`/fallback in `_getRuntimeAiConfig`; transport fork in `_callResponsesAPI`; bounded-concurrency batch loop in `scoreTrends` for cli; retry+fallback.
- **`src/admin/server.js`** (MODIFY) — add `grokcli` to provider dropdown + `grokcliModel` field + session-status chip. SPA-trap file → `npm run check:spa` after.
- **`Dockerfile`** (MODIFY) — `apk add git`; install grok CLI into image; ensure a writable cwd.
- **`docker-compose.yml`** (MODIFY) — bind-mount host `~/.grok` → container `/home/node/.grok` (session persistence).
- **`test/grok-cli.test.mjs`** (NEW) — unit tests for parsing/concurrency/fallback with a fake `grok` script (no network, no subscription needed in CI).

**Concurrency-order invariant (critical):** Stage 1 maps responses back to trends **by array index** (`scorer.js:890`). Every concurrency change MUST preserve input order in the results array. Tests enforce this.

---

## Task 1: Isolated CLI module — `callGrokCli` spawn wrapper

**Files:**
- Create: `src/analysis/grok-cli.js`
- Test: `test/grok-cli.test.mjs`

- [ ] **Step 1: Write the failing test** (`test/grok-cli.test.mjs`)

Uses a fake `grok` shell script so the test needs no subscription/network. The fake echoes a canned JSON (optionally ```` ```json ````-fenced) and can simulate slow/empty/crash via env.

```js
import { test } from 'node:test';
import assert from 'node:assert';
import { writeFileSync, chmodSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { callGrokCli } from '../src/analysis/grok-cli.js';

function fakeGrok(body) {
  const dir = mkdtempSync(join(tmpdir(), 'grokfake-'));
  const p = join(dir, 'grok');
  writeFileSync(p, `#!/bin/bash\n${body}\n`);
  chmodSync(p, 0o755);
  return p;
}

test('returns stdout text on success', async () => {
  const bin = fakeGrok('echo \'{"trends":[]}\'');
  const r = await callGrokCli({ bin, prompt: 'hi', timeoutMs: 5000, cwd: tmpdir() });
  assert.strictEqual(r.text.trim(), '{"trends":[]}');
  assert.strictEqual(r.inputTokens, 0);
});

test('throws on empty stdout', async () => {
  const bin = fakeGrok('exit 0');               // no output
  await assert.rejects(
    () => callGrokCli({ bin, prompt: 'hi', timeoutMs: 5000, cwd: tmpdir() }),
    /empty/i
  );
});

test('throws on timeout (and kills child)', async () => {
  const bin = fakeGrok('sleep 10; echo late');
  await assert.rejects(
    () => callGrokCli({ bin, prompt: 'hi', timeoutMs: 500, cwd: tmpdir() }),
    /timeout/i
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/grok-cli.test.mjs`
Expected: FAIL — `Cannot find module '../src/analysis/grok-cli.js'`.

- [ ] **Step 3: Write minimal implementation** (`src/analysis/grok-cli.js`)

Mirrors the spawn/Promise/timeout/SIGKILL pattern already used in `src/analysis/gemini-captioner.js` (spawn → collect stdout → resolve on close → reject on error/timeout, never leak the child).

```js
import { spawn } from 'child_process';

/**
 * Run the Grok Build CLI headlessly for one prompt and return its stdout text.
 * Subscription-billed (no per-token cost) → inputTokens/outputTokens reported 0.
 * Reuses the spawn+timeout+SIGKILL shape from gemini-captioner.js.
 *
 * grok-build is a CODING agent: it spawns `git` at startup and needs a real
 * working directory. The caller MUST pass a cwd that exists and is a git repo
 * (or at least writable); the Docker image installs `git` for this reason.
 */
export function callGrokCli({ bin = 'grok', prompt, timeoutMs = 180000, cwd, logger = null }) {
  return new Promise((resolve, reject) => {
    const args = ['-p', prompt, '--output-format', 'plain', '--disable-web-search', '--cwd', cwd];
    // Unset the API key in the child so it can NEVER fall back to paid API billing.
    const env = { ...process.env };
    delete env.XAI_API_KEY;
    delete env.GROK_DEPLOYMENT_KEY;
    delete env.GROK_CODE_XAI_API_KEY;

    const child = spawn(bin, args, { cwd, env });
    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill('SIGKILL'); } catch { /* already gone */ }
      reject(new Error(`grok-cli timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on('data', d => { stdout += d.toString(); });
    child.stderr.on('data', d => { stderr += d.toString(); });

    child.on('error', err => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`grok-cli spawn failed: ${err.message}`));
    });

    child.on('close', code => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const text = stdout.trim();
      if (!text) {
        reject(new Error(`grok-cli returned empty stdout (exit ${code}); stderr: ${stderr.slice(0, 300)}`));
        return;
      }
      resolve({ text, inputTokens: 0, outputTokens: 0 });
    });
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/grok-cli.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/analysis/grok-cli.js test/grok-cli.test.mjs
git commit -m "feat(scorer): isolated Grok CLI spawn wrapper with timeout"
```

---

## Task 2: Session liveness probe — `probeGrokSession`

**Files:**
- Modify: `src/analysis/grok-cli.js`
- Test: `test/grok-cli.test.mjs`

- [ ] **Step 1: Write the failing test** (append to `test/grok-cli.test.mjs`)

```js
import { probeGrokSession } from '../src/analysis/grok-cli.js';

test('probeGrokSession true when models lists grok-build', async () => {
  const bin = fakeGrok('echo "You are logged in with grok.com"; echo "Default model: grok-build"');
  const alive = await probeGrokSession({ bin, timeoutMs: 5000 });
  assert.strictEqual(alive, true);
});

test('probeGrokSession false when not authenticated', async () => {
  const bin = fakeGrok('echo "You are not authenticated."');
  const alive = await probeGrokSession({ bin, timeoutMs: 5000 });
  assert.strictEqual(alive, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/grok-cli.test.mjs`
Expected: FAIL — `probeGrokSession is not a function`.

- [ ] **Step 3: Write minimal implementation** (append to `src/analysis/grok-cli.js`)

```js
/**
 * Cheap liveness check: `grok models` prints "logged in with grok.com" + the
 * model list when the cached OIDC session is valid, or "not authenticated"
 * when it's dead. No scoring cost. Returns false on any error/timeout.
 */
export function probeGrokSession({ bin = 'grok', timeoutMs = 30000 } = {}) {
  return new Promise(resolve => {
    const env = { ...process.env };
    delete env.XAI_API_KEY;
    const child = spawn(bin, ['models'], { env });
    let out = '';
    let settled = false;
    const done = v => { if (!settled) { settled = true; clearTimeout(t); resolve(v); } };
    const t = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} done(false); }, timeoutMs);
    child.stdout.on('data', d => { out += d.toString(); });
    child.on('error', () => done(false));
    child.on('close', () => {
      const ok = /logged in with grok|Available models|grok-build/i.test(out) &&
                 !/not authenticated/i.test(out);
      done(ok);
    });
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/grok-cli.test.mjs`
Expected: PASS (5 tests total).

- [ ] **Step 5: Commit**

```bash
git add src/analysis/grok-cli.js test/grok-cli.test.mjs
git commit -m "feat(scorer): grok CLI session liveness probe"
```

---

## Task 3: Register `grokcli` provider in scorer

**Files:**
- Modify: `src/analysis/scorer.js:401-430` (provider registry), `:478-513` (`_getRuntimeAiConfig`)
- Test: `test/grokcli-provider.test.mjs` (NEW)

- [ ] **Step 1: Write the failing test** (`test/grokcli-provider.test.mjs`)

```js
import { test } from 'node:test';
import assert from 'node:assert';
import Scorer from '../src/analysis/scorer.js';

function fakeDb(settings = {}) {
  return { getSetting: (k, d) => (k in settings ? settings[k] : d), setSetting() {} };
}
const logger = { info(){}, warn(){}, error(){}, debug(){} };

test('grokcli provider is registered with transport cli', () => {
  const s = new Scorer({}, logger, fakeDb({ aiProvider: 'grokcli' }), null);
  assert.strictEqual(s.providers.grokcli.transport, 'cli');
});

test('grokcli selected → runtime reports transport cli', () => {
  const s = new Scorer({}, logger, fakeDb({ aiProvider: 'grokcli' }), null);
  s._grokSessionAlive = true;                       // inject liveness for the test
  const rt = s._getRuntimeAiConfig();
  assert.strictEqual(rt.provider, 'grokcli');
  assert.strictEqual(rt.transport, 'cli');
});

test('grokcli with DEAD session falls back to an http provider', () => {
  const s = new Scorer({}, logger, fakeDb({ aiProvider: 'grokcli' }), null);
  s.providers.xai.apiKey = 'xai-test';              // make an http provider available
  s._grokSessionAlive = false;                      // dead CLI session
  const rt = s._getRuntimeAiConfig();
  assert.strictEqual(rt.transport, 'http');
  assert.notStrictEqual(rt.provider, 'grokcli');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/grokcli-provider.test.mjs`
Expected: FAIL — `s.providers.grokcli` is undefined.

- [ ] **Step 3: Write minimal implementation**

In `scorer.js`, add to `this.providers` (after the `gemini` block, ~line 429):

```js
      grokcli: {
        transport: 'cli',
        bin: process.env.GROK_CLI_BIN || 'grok',
        cwd: process.env.GROK_CLI_CWD || '/app',
        defaultModel: process.env.GROKCLI_MODEL || 'grok-build',
        concurrency: Number(process.env.GROKCLI_CONCURRENCY || 4),
        timeoutMs: Number(process.env.GROKCLI_TIMEOUT_MS || 180000),
        apiKey: '',          // no key — liveness is session-based (see _getRuntimeAiConfig)
        baseUrl: '',
      },
```

Tag the existing three providers with `transport: 'http'` (add the line to each of xai/openai/gemini objects).

Add a liveness field in the constructor (after `this.current = this._getRuntimeAiConfig();`, ~line 432):

```js
    // CLI session liveness — refreshed by index.js on boot + periodically.
    // null = unknown/not-yet-probed; treated as not-alive until proven.
    this._grokSessionAlive = false;
```

Rewrite the relevant parts of `_getRuntimeAiConfig` (scorer.js:478-513):

```js
  _getRuntimeAiConfig() {
    const VALID_PROVIDERS = ['xai', 'openai', 'gemini', 'grokcli'];
    const rawProvider = this.db?.getSetting('aiProvider', 'xai') || 'xai';
    let provider = VALID_PROVIDERS.includes(String(rawProvider).toLowerCase())
      ? String(rawProvider).toLowerCase()
      : 'xai';

    let providerCfg = this.providers[provider] || this.providers.xai;

    // "available" differs by transport: cli = session alive; http = has apiKey.
    const isAvailable = (name) => {
      const cfg = this.providers[name];
      if (!cfg) return false;
      return cfg.transport === 'cli' ? !!this._grokSessionAlive : !!cfg.apiKey;
    };

    // Fallback when the chosen provider isn't available. grokcli falls back to
    // http providers (xai→openai→gemini); http providers keep the same chain.
    if (!isAvailable(provider)) {
      const chain = ['xai', 'openai', 'gemini'].filter(p => p !== provider);
      for (const candidate of chain) {
        if (isAvailable(candidate)) { provider = candidate; providerCfg = this.providers[candidate]; break; }
      }
    }

    const modelSettingKey =
      provider === 'openai'  ? 'openaiModel' :
      provider === 'gemini'  ? 'geminiModel' :
      provider === 'grokcli' ? 'grokcliModel' :
      'xaiModel';
    const model = this.db?.getSetting(modelSettingKey, providerCfg.defaultModel) || providerCfg.defaultModel;

    return {
      provider,
      transport: providerCfg.transport || 'http',
      model,
      apiKey: providerCfg.apiKey,
      baseUrl: providerCfg.baseUrl,
      bin: providerCfg.bin,
      cwd: providerCfg.cwd,
      concurrency: providerCfg.concurrency || 1,
      timeoutMs: providerCfg.timeoutMs,
      enabled: isAvailable(provider),
    };
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/grokcli-provider.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/analysis/scorer.js test/grokcli-provider.test.mjs
git commit -m "feat(scorer): register grokcli provider with session-based availability + fallback"
```

---

## Task 4: Transport fork in `_callResponsesAPI`

**Files:**
- Modify: `src/analysis/scorer.js:1269` (`_callResponsesAPI` entry), import at top
- Test: `test/grokcli-provider.test.mjs`

- [ ] **Step 1: Write the failing test** (append)

```js
test('_callResponsesAPI routes cli transport to _callGrokCli', async () => {
  const s = new Scorer({}, logger, fakeDb({ aiProvider: 'grokcli' }), null);
  s._grokSessionAlive = true;
  let calledWith = null;
  s._callGrokCli = async (args) => { calledWith = args; return { text: '{"trends":[]}', inputTokens: 0, outputTokens: 0 }; };
  const rt = s._getRuntimeAiConfig();
  const out = await s._callResponsesAPI({
    input: [{ role: 'system', content: 'sys' }, { role: 'user', content: 'usr' }],
    runtimeOverride: rt,
  });
  assert.ok(calledWith, '_callGrokCli was invoked');
  assert.strictEqual(out.text, '{"trends":[]}');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/grokcli-provider.test.mjs`
Expected: FAIL — cli transport still hits the fetch path (network error or wrong branch).

- [ ] **Step 3: Write minimal implementation**

Add import at top of `scorer.js` (near other imports):

```js
import { callGrokCli } from './grok-cli.js';
```

At the very start of `_callResponsesAPI` (scorer.js:1269), after `runtime` is resolved (it already computes `const runtime = runtimeOverride || this.current;` — place the fork immediately after that line):

```js
    if (runtime.transport === 'cli') {
      return this._callGrokCli({ input, runtime });
    }
```

Add the `_callGrokCli` method on the class (near `_callResponsesAPI`):

```js
  // Bridge: flatten the two-message input into one prompt and run it through
  // the CLI. Mirrors the sandbox-validated form: system + separator + user.
  async _callGrokCli({ input, runtime }) {
    const sys = input.find(m => m.role === 'system')?.content || '';
    const usr = input.find(m => m.role === 'user')?.content || '';
    const prompt = `${sys}\n\n=== INPUT ===\n\n${usr}`;
    return callGrokCli({
      bin: runtime.bin,
      prompt,
      cwd: runtime.cwd,
      timeoutMs: runtime.timeoutMs,
      logger: this.logger,
    });
  }
```

Note: the existing Stage 1 parser (scorer.js:872) already strips a ```` ```json ```` fence before `JSON.parse`, so cli output that arrives fenced is handled with no extra code.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/grokcli-provider.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/analysis/scorer.js test/grokcli-provider.test.mjs
git commit -m "feat(scorer): fork _callResponsesAPI to CLI transport for grokcli"
```

---

## Task 5: Bounded-concurrency Stage 1 batch loop (cli only) + retry/fallback

**Files:**
- Modify: `src/analysis/scorer.js` — `scoreTrends` batch loop (~678-705), add helper
- Test: `test/grokcli-concurrency.test.mjs` (NEW)

- [ ] **Step 1: Write the failing test** (`test/grokcli-concurrency.test.mjs`)

```js
import { test } from 'node:test';
import assert from 'node:assert';
import { runBounded } from '../src/analysis/scorer.js';   // exported helper

test('runBounded preserves input order despite out-of-order completion', async () => {
  const items = [40, 10, 30, 20];                          // ms delays
  const work = (ms, idx) => new Promise(r => setTimeout(() => r(idx), ms));
  const out = await runBounded(items, 2, work);
  assert.deepStrictEqual(out, [0, 1, 2, 3]);               // indices in INPUT order
});

test('runBounded caps concurrency', async () => {
  let active = 0, peak = 0;
  const work = () => new Promise(r => { active++; peak = Math.max(peak, active); setTimeout(() => { active--; r(1); }, 20); });
  await runBounded([1,2,3,4,5,6], 2, work);
  assert.ok(peak <= 2, `peak concurrency ${peak} must be <= 2`);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/grokcli-concurrency.test.mjs`
Expected: FAIL — `runBounded` not exported.

- [ ] **Step 3: Write minimal implementation**

Add and export a small pool helper in `scorer.js` (top-level, near other exports):

```js
/**
 * Run `worker(item, index)` over items with at most `limit` in flight.
 * Returns results in INPUT order (critical: Stage 1 maps responses by index).
 */
export async function runBounded(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) break;
      results[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return results;
}
```

In `scoreTrends`, branch the batch loop on transport. Keep the existing serial+sleep loop for http; use the pool for cli. Locate the current loop (`const batchSize = 8;` then the `for` over batches at ~678-705) and wrap:

```js
    const batchSize = 8;
    const batches = [];
    for (let i = 0; i < trends.length; i += batchSize) batches.push(trends.slice(i, i + batchSize));

    const runtime = this.current;
    let batchResults;

    if (runtime.transport === 'cli') {
      // Bounded concurrency — CLI calls are ~70-90s each; serial would blow the cycle.
      batchResults = await runBounded(batches, runtime.concurrency || 4, (batch) =>
        this._scoreBatchWithFallback(batch));
    } else {
      // HTTP providers: unchanged serial loop + inter-batch spacing.
      batchResults = [];
      for (const batch of batches) {
        batchResults.push(await this._scoreBatchWithFallback(batch));
        await new Promise(r => setTimeout(r, 2000));
      }
    }
    // flatten batchResults (array-of-arrays, input order) → scored trends
```

Add `_scoreBatchWithFallback` implementing the §3.5 escalation (CLI retry once → API fallback → heuristic). It wraps the existing `_analyzeBatchStage1` logic:

```js
  // One batch with resilience: cli retry → http fallback → heuristic.
  async _scoreBatchWithFallback(batch) {
    const rt = this.current;
    if (rt.transport === 'cli') {
      for (let attempt = 1; attempt <= 2; attempt++) {       // 1 try + 1 retry
        try { return await this._analyzeBatchStage1(batch, rt); }
        catch (e) { this.logger.warn(`[grokcli] batch attempt ${attempt} failed: ${e.message}`); }
      }
      // CLI exhausted → fall back to the best available HTTP provider for THIS batch.
      const httpRt = this._firstHttpRuntime();
      if (httpRt) {
        this.logger.warn('[grokcli] falling back to HTTP provider for this batch');
        try { return await this._analyzeBatchStage1(batch, httpRt); }
        catch (e) { this.logger.error(`[grokcli] http fallback also failed: ${e.message}`); }
      }
      return this._fallback(batch, 'grokcli + http fallback unavailable');   // heuristic
    }
    // http transport: existing single-attempt + heuristic-on-throw behavior.
    try { return await this._analyzeBatchStage1(batch, rt); }
    catch (e) { this.logger.warn(`Stage 1 batch failed: ${e.message}`); return this._fallback(batch, 'AI unavailable'); }
  }

  // First http provider that has a key, as a runtime config (for cli fallback).
  _firstHttpRuntime() {
    for (const name of ['xai', 'openai', 'gemini']) {
      const cfg = this.providers[name];
      if (cfg?.apiKey) {
        return { provider: name, transport: 'http', model: cfg.defaultModel,
                 apiKey: cfg.apiKey, baseUrl: cfg.baseUrl, enabled: true };
      }
    }
    return null;
  }
```

> NOTE for the implementer: `_analyzeBatchStage1` currently reads `this.current` internally and builds the call. It must accept an explicit runtime arg so the fallback can pass an http runtime while `this.current` is cli. If it doesn't already, thread a `runtime` parameter through `_analyzeBatchStage1` → `_callResponsesAPI` (the latter already accepts `runtimeOverride`). This is a mechanical signature change; preserve all existing behavior for the http path.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/grokcli-concurrency.test.mjs`
Expected: PASS (2 tests).
Also run the full suite: `node --test test/` — Expected: existing tests still PASS (http path unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/analysis/scorer.js test/grokcli-concurrency.test.mjs
git commit -m "feat(scorer): bounded-concurrency Stage 1 for cli + retry/http-fallback"
```

---

## Task 6: Wire session probe on boot — `index.js`

**Files:**
- Modify: `src/index.js` (after scorer construction, near other boot probes ~58)

- [ ] **Step 1: Write the failing test**

No unit test (boot wiring). Manual verification in Step 4. Skip test authoring here — this is an integration touch-point, verified by the boot-log assertion below.

- [ ] **Step 2: (n/a — integration step)**

- [ ] **Step 3: Implement**

In `src/index.js`, after the scorer is constructed (`const scorer = new Scorer(...)`, ~line 58), add a boot probe + periodic refresh, mirroring the existing setInterval maintenance pattern:

```js
import { probeGrokSession } from './analysis/grok-cli.js';

// grokcli session liveness — only meaningful when grokcli is the chosen provider,
// but cheap enough to probe always so the admin panel can show status.
async function refreshGrokSession() {
  try {
    const cfg = scorer.providers.grokcli;
    scorer._grokSessionAlive = await probeGrokSession({ bin: cfg.bin, timeoutMs: 30000 });
  } catch { scorer._grokSessionAlive = false; }
  scorer.current = scorer._getRuntimeAiConfig();   // re-resolve in case availability flipped
}
await refreshGrokSession();
logger.info(`[grokcli] session alive: ${scorer._grokSessionAlive}`);
setInterval(refreshGrokSession, 5 * 60 * 1000);    // every 5 min
```

- [ ] **Step 4: Verify (manual / boot log)**

Run locally with a fake grok on PATH that prints "not authenticated": boot log shows `[grokcli] session alive: false`. With one that prints the logged-in banner: `true`. (On the sandbox we already confirmed the real binary returns the logged-in banner.)

- [ ] **Step 5: Commit**

```bash
git add src/index.js
git commit -m "feat(boot): probe grokcli session on boot + every 5min"
```

---

## Task 7: Admin panel — provider dropdown + model + session chip

**Files:**
- Modify: `src/admin/server.js` (provider selector + stats payload)

- [ ] **Step 1: Write the failing test**

SPA monolith — no unit test. Verification is the SPA validator + manual UI check (Steps 4).

- [ ] **Step 2: (n/a)**

- [ ] **Step 3: Implement**

Three edits in `src/admin/server.js`:

1. Provider `<select>` (find where xai/openai/gemini options are rendered) — add:
```js
React.createElement('option', { value: 'grokcli' }, 'Grok Build CLI (subscription)'),
```
2. Model field: when provider is `grokcli`, the model input writes setting key `grokcliModel` (default `grok-build`). Follow the exact pattern the existing code uses to map provider→model-setting-key.
3. Stats payload (the `_getStats` / status JSON the panel polls): include
```js
grokcli: {
  sessionAlive: !!this.appState?.scorer?._grokSessionAlive,
  model: this.db.getSetting('grokcliModel', 'grok-build'),
},
```
and render a chip near the provider selector: `CLI session: OK` (green) when `sessionAlive`, else `CLI session: expired — run grok login` (amber). Match existing chip styling in the file.

> Implementer note: confirm how `admin/server.js` reaches the scorer instance (via `appState` or a passed ref). If the scorer isn't currently exposed to the admin server, pass it in at construction (small wiring change in `index.js` where `AdminServer` is instantiated) — do NOT reach through globals.

- [ ] **Step 4: Verify**

Run: `npm run check:spa`
Expected: PASS (admin SPA validator green — char count printed, no syntax error).
Manual: open admin panel, provider dropdown shows "Grok Build CLI (subscription)", chip reflects session status.

- [ ] **Step 5: Commit**

```bash
git add src/admin/server.js
git commit -m "feat(admin): grokcli provider option + model field + session status chip"
```

---

## Task 8: Dockerfile — install grok CLI + git; compose — mount session

**Files:**
- Modify: `Dockerfile` (runtime stage), `docker-compose.yml`

- [ ] **Step 1: (no unit test — infra)**

- [ ] **Step 2: (n/a)**

- [ ] **Step 3: Implement**

In `Dockerfile` runtime stage, extend the `apk add` (line 31-36) to include **git** (grok-build spawns git at startup — proven required on sandbox), and install the CLI binary. Because the binary is a **static** linux-x86_64 (confirmed), it runs in alpine as-is:

```dockerfile
RUN apk add --no-cache \
    sqlite-dev \
    curl \
    ca-certificates \
    ffmpeg \
    git \
    tini

# Install Grok Build CLI (static binary; runs under alpine/musl). Pinned version
# for reproducible builds — bump deliberately.
ARG GROK_CLI_VERSION=0.2.14
RUN curl -fsSL https://x.ai/cli/install.sh | bash -s "${GROK_CLI_VERSION}" \
    && ln -sf /root/.grok/bin/grok /usr/local/bin/grok || true
```

> Implementer note: the installer defaults to `~/.grok`. The container runs as USER `node` (uid 1000), so the CLI must resolve a session under the `node` user's home. Install/symlink the binary to a system path (`/usr/local/bin/grok`), but the **session dir** is the `node` user's `~/.grok` → that's the bind-mount below. Verify the install path during implementation; adjust the symlink target if the installer writes elsewhere under root vs node.

In `docker-compose.yml`, add a bind-mount so the host's authenticated session persists across redeploys (the app container reads it; refresh handled by the CLI):

```yaml
    volumes:
      - catalyst_data:/data
      - catalyst_logs:/logs
      - /root/.grok:/home/node/.grok          # grok CLI subscription session (host-authenticated once)
    environment:
      # ...existing...
      GROK_CLI_CWD: /app                       # grok-build needs a git cwd; /app is a dir in-image
```

> Operator one-time step (documented, not automated): on the prod host run `grok login --device-auth` once so `/root/.grok/auth.json` exists before the container starts. The CLI self-refreshes the token thereafter.

- [ ] **Step 4: Verify (build + smoke, on sandbox or prod-like)**

Run: `docker compose build` → Expected: image builds, no error on `apk add git` or CLI install.
Smoke: `docker compose run --rm catalyst sh -c 'grok --version'` → prints `grok 0.2.14`.
(Full scoring smoke requires a mounted authenticated session — covered in Task 9 staged rollout.)

- [ ] **Step 5: Commit**

```bash
git add Dockerfile docker-compose.yml
git commit -m "build: install grok CLI + git in image, mount subscription session volume"
```

---

## Task 9: Quality-parity gate + staged rollout docs

**Files:**
- Create: `experiments/grok-cli/parity-check.mjs` (NEW)
- Modify: `ai-context/SESSION_CONTEXT.md`, `ai-context/WORKLOG.md`, `ai-context/IDEAS.md`

- [ ] **Step 1: Write the parity-check script** (`experiments/grok-cli/parity-check.mjs`)

Reuses the harness already in `experiments/grok-cli/`. Scores the SAME real-trend sample through the current provider (gemini/xai via API) AND grokcli, then prints a side-by-side memePotential/category diff so the operator can confirm quality before flipping prod. (This is a tool, not an automated gate — operator reads the diff and decides.)

```js
// Usage: node experiments/grok-cli/parity-check.mjs out/system.txt out/user.txt
// Prints: per-trend memePotential from API-provider vs grokcli, and mean abs diff.
// (Full code mirrors build-stage1-prompt.mjs invocation + two scorer calls.)
```

(Implementer: flesh out using the existing `build-stage1-prompt.mjs` as the template — it already builds the exact prompt. Call both transports, tabulate. Keep it in `experiments/` — not shipped to prod.)

- [ ] **Step 2: Run the parity check (operator-driven, on sandbox or prod host)**

Run: `node experiments/grok-cli/parity-check.mjs <prompt files>`
Expected: a table; operator judges whether grokcli scores are within tolerance of the current provider. **Do not flip `aiProvider=grokcli` in prod until this passes operator review.**

- [ ] **Step 3: Update ai-context**

- `SESSION_CONTEXT.md`: provider list now includes `grokcli`; new prod dependency = host `~/.grok` session + git in image; note the 30/60-min cycle constraint and one-time `grok login` step.
- `WORKLOG.md`: entry (date · model · goal · files · deploy · risks) summarizing the feature + that it ships OFF (default provider unchanged) behind the admin toggle.
- `IDEAS.md`: mark the grok-build Stage 1 path **SHIPPED**, link this plan + the negative Stage 2 note.

- [ ] **Step 4: Verify**

Run: `node --test test/` → all green. `npm run check:spa` → green.
Confirm `aiProvider` default is still `xai`/`gemini` (feature is opt-in; nothing auto-switches to cli).

- [ ] **Step 5: Commit**

```bash
git add experiments/grok-cli/parity-check.mjs ai-context/
git commit -m "feat(grokcli): parity-check tool + context/worklog/ideas updates"
```

---

## Self-Review

**1. Spec coverage:**
- §3.1 provider registration → Task 3 ✅
- §3.2 transport fork → Task 4 ✅
- §3.3 `_callGrokCli` spawn → Task 1 ✅
- §3.4 bounded concurrency → Task 5 ✅
- §3.5 retry + fallback → Task 5 (`_scoreBatchWithFallback`) ✅
- §3.6 session liveness → Task 2 (probe) + Task 6 (boot wiring) ✅
- §3.7 admin toggle → Task 7 ✅
- §6 settings (grokcliModel, concurrency, env) → Tasks 3 + 7 ✅
- §7.1 container vs host (BIGGEST open Q) → **resolved**: static binary runs in alpine + git required + session bind-mount → Task 8 ✅
- §7.2 prompt assembly parity → Task 4 (`system + === INPUT === + user`) + Task 9 (parity check) ✅
- §7.3 plain vs json output → Task 1 uses `--output-format plain` ✅
- §7.5 quality parity gate → Task 9 ✅
- §5 ToS risk → documented in spec + WORKLOG (Task 9); not a code task ✅

**2. Placeholder scan:** Task 9 Step 1 intentionally leaves the parity script body as "flesh out from template" — acceptable because it's a throwaway experiment tool, not shipped code, and the template (`build-stage1-prompt.mjs`) already exists and is referenced. All shipped-code tasks (1-8) have complete code. No TBD/"handle edge cases" in shipped paths.

**3. Type consistency:** `callGrokCli({bin,prompt,timeoutMs,cwd,logger})` — same signature in Task 1 (def), Task 4 (call via `_callGrokCli`). `probeGrokSession({bin,timeoutMs})` — Task 2 def, Task 6 call ✅. `runBounded(items,limit,worker)` — Task 5 def + tests ✅. `_grokSessionAlive` — set in Task 3 (constructor), Task 6 (boot), read in Task 3 (`_getRuntimeAiConfig`) + Task 7 (admin) ✅. `transport` field — added Task 3, read Task 4 + Task 5 ✅. Runtime object shape (`{provider,transport,model,bin,cwd,concurrency,timeoutMs,...}`) consistent between Task 3 (producer) and Tasks 4/5 (consumers) ✅.

**Gaps found & fixed inline:** Task 5 flagged that `_analyzeBatchStage1` must accept an explicit `runtime` arg (for http fallback while `this.current` is cli) — noted as a required mechanical signature change so the implementer doesn't miss it.
