# Grok Build CLI as a Stage 1 Provider — Design Spec

**Date**: 2026-06-01
**Scope**: Add `grokcli` as a fourth Stage 1 scoring provider (alongside `xai` / `openai` /
`gemini`), driven by the Grok Build CLI over a SuperGrok **subscription** (flat $30/mo) instead
of the per-token xAI API. Admin-switchable like the existing providers. Text-only Stage 1 (the
"alert writer" role). Stage 2 (x_search) stays on the API, unchanged.
**Origin**: Operator idea — use the already-paid SuperGrok subscription for Stage 1 scoring.
Empirically validated on a sandbox (Vultr 185.192.23.55) before this spec — see §3.
**Estimated effort**: ~5-8h (firms up in the plan).

---

## 1. Goal / Problem

Stage 1 scoring currently runs on a per-token API provider (`aiProvider` setting: xai/openai/gemini).
The operator pays an already-sunk **$30/mo SuperGrok subscription** whose `grok-build-0.1` model is
reachable headlessly via the Grok Build CLI **without** consuming API tokens. Routing Stage 1 through
that subscription channel could:
- trim API spend (Stage 1 portion),
- use a model that *reasons* before answering (grok-build "thinks"),
- keep a one-click rollback to the API providers if anything degrades.

**This spec covers ONLY text Stage 1.** Media analysis (Stage 0b / Gemini vision) is untouched —
build *can* see images, but that's a separate, larger iteration (parked in §8).

### Why this is viable (not speculation — measured on sandbox, §3)
- Headless subscription auth works (`grok login --device-auth` → OIDC session, no API key).
- grok-build returns valid Stage 1 JSON on the real production prompt (12 real trends).
- **Parallelism works**: 4 concurrent CLI calls finished in 99s (vs 344s if serialized), no throttling.
- Scoring quality on the fallback (text-only) path is sensible (catches meme/celebrity, drops noise).

### The hard constraint this design solves: timing
grok-build latency ≈ **70-90s per 8-12-trend batch** (vs ~2-5s on the API). Production peaks at
~82 new trends/hour ≈ 11 batches. **Serial** Stage 1 (today's loop) would take ~13 min/cycle at peak —
breaks a 15-min cycle, tight on 30. The fix is **bounded concurrency** (§3.3): 11 batches ÷ 4 parallel
× ~90s ≈ ~4.5 min, which fits 30- and 60-min cycles with headroom. 15-min cycle remains unsupported
for grokcli (documented limit, not a goal).

---

## 2. Architecture overview

```
src/analysis/
├── scorer.js   — (1) register `grokcli` provider in this.providers + _getRuntimeAiConfig
│                 (2) transport fork in _callResponsesAPI: cli → _callGrokCli (spawn), else fetch
│                 (3) _callGrokCli: spawn grok -p, parse JSON (strips ```json fence — already done)
│                 (4) bounded-concurrency Stage 1 batch loop when transport==='cli'
│                 (5) retry + API fallback on empty/timeout
│                 (6) session liveness probe (cached), surfaced to admin
src/admin/
└── server.js   — add 'grokcli' to the provider dropdown + model field + "CLI session: OK/expired"
                  indicator; optional cli concurrency (N) setting.
ai-context/
├── SESSION_CONTEXT.md — provider list + new prod dependency (grok CLI session in volume)
├── WORKLOG.md         — entry after implementation
└── IDEAS.md           — mark this path SHIPPED, link the negative-result note we already wrote
```

No DB schema change — reuses generic `getSetting`/`setSetting`. Stage 2 path is **not touched**.

---

## 3. Components

### 3.1 Provider registration — `scorer.js`

`this.providers` (currently scorer.js:401-430) gains a fourth entry. Unlike the HTTP providers it has
no `apiKey`/`baseUrl`; it carries a `transport` discriminator. The existing three implicitly become
`transport: 'http'`.

```js
// shape (final names firm up in plan)
grokcli: {
  transport: 'cli',                 // vs 'http' for xai/openai/gemini
  bin: process.env.GROK_CLI_BIN || 'grok',
  defaultModel: process.env.GROKCLI_MODEL || 'grok-build',
  concurrency: Number(process.env.GROKCLI_CONCURRENCY || 4),
  timeoutMs: Number(process.env.GROKCLI_TIMEOUT_MS || 180000),
  // no apiKey — "alive" = bin present + valid cached session (see §3.6)
}
```

`VALID_PROVIDERS` (scorer.js:479) gains `'grokcli'`. In `_getRuntimeAiConfig`:
- `enabled` for grokcli is **not** `!!apiKey` (it has none) — it's `transport==='cli' ? sessionAlive : !!apiKey`.
- The auto-fallback chain (scorer.js:485-499) must treat grokcli specially: if grokcli is picked but
  its session is dead, fall back to the first HTTP provider with a key (xai→openai→gemini), exactly
  the existing pattern. This guarantees the scorer never hard-fails on a dead CLI session.

### 3.2 Transport fork — `_callResponsesAPI` (scorer.js:1269)

Today this function always `fetch`es `{baseUrl}/responses`. Add a guard at the top:

```js
if (runtime.transport === 'cli') {
  return this._callGrokCli({ input, temperature, responseSchema, runtime });
}
// ...existing fetch path unchanged...
```

Stage 2 forces `provider: 'xai'` (HTTP), so it never reaches the cli branch — Stage 2 stays API.

### 3.3 `_callGrokCli` — the subprocess call (NEW)

Reuses the **existing, proven spawn pattern** from `gemini-captioner.js` (spawn + Promise + stdout
collect + hard timeout + SIGKILL + resolve-not-reject on error). That file shells `ffmpeg`/`ffprobe`
today; this is the same shape pointed at `grok`.

```
input (system + user messages) → single prompt string
   (concat: system + "\n\n=== INPUT ===\n\n" + user — matches what we validated on sandbox)
spawn(bin, ['-p', prompt, '--output-format', 'plain', '--disable-web-search'])
   • plain output: prints the model's text straight to stdout (validated — cleaner than json envelope)
   • --disable-web-search: Stage 1 is pure text scoring, no tools needed (faster, cheaper turns)
   • env: pass through, but UNSET XAI_API_KEY in the child so it CANNOT fall back to paid API
   • hard timeout (timeoutMs) → SIGKILL → treated as failure (retry/fallback per §3.5)
parse: strip ```json fence (the existing Stage 1 parser at scorer.js:872 already does this) → JSON.parse
return: { text, inputTokens: 0, outputTokens: 0 }   // subscription = no per-token meter
```

**Auth model:** the child relies on the cached OIDC session at `~/.grok/auth.json` (refreshes itself,
6h token + refresh_token). The app does NOT manage tokens — it only checks liveness (§3.6).

### 3.4 Bounded-concurrency Stage 1 — `scoreTrends` (scorer.js ~629/678)

Today: serial `for` loop over batches of 8, `await` each + 2000ms sleep between
(scorer.js:692-705). For `transport==='cli'` replace with a **bounded-concurrency pool** (small
inline p-limit-style helper, no new dep, or add `p-limit`): run `runtime.concurrency` (default 4)
batches at once, collect results, preserve **input order** (Stage 1 maps responses back by index —
scorer.js:890 — so order MUST be preserved; use indexed results, not completion order).

- **HTTP providers keep the serial+sleep loop unchanged** (their own rate limits; don't perturb a
  working path). The concurrency pool is gated to cli only.
- Concurrency is read per cycle from settings (admin-tunable, no restart).
- Measured: 11 batches ÷ 4 ≈ 3 waves × ~90s ≈ ~4.5 min at peak.

### 3.5 Retry + fallback — resilience

Per-batch, in order of escalation:
1. **CLI retry**: empty stdout / non-JSON / timeout → retry the same batch through the CLI **once**
   (the sandbox showed occasional ```json-fenced output, already handled; this covers real
   timeouts/relay hiccups).
2. **API fallback**: if the retry also fails, route *that batch only* through the first available
   HTTP provider (`_getRuntimeAiConfig` fallback chain) so the batch still gets real LLM scores.
3. **Heuristic**: if even the API path fails (no keys), the existing `_fallback(batch,...)` heuristic
   kicks in (scorer.js:697) marking `_aiUnavailable:true`. This is the current end-state for any LLM
   failure — unchanged.

Net: prod never stalls and never hard-fails; worst case is a batch scored by a cheaper API provider
or heuristic, exactly as today.

### 3.6 Session liveness — boot + admin indicator

- On boot (and cached ~5 min), run a cheap `grok models` (or read `auth.json` expiry) to determine
  `sessionAlive`. Cheap, no scoring cost.
- Surface as `{ grokcli: { sessionAlive, model, lastChecked } }` in the admin stats object the panel
  reads, so the operator sees **"CLI session: OK / expired"** without SSH.
- If expired, admin sees it AND the scorer auto-falls-back to API — no silent breakage.

### 3.7 Admin toggle — `admin/server.js`

The panel already has a provider selector (xai/openai/gemini) + model field. Add:
- `grokcli` to the provider dropdown (writes `aiProvider='grokcli'`).
- Model field maps to a `grokcliModel` setting (default `grok-build`).
- Read-only **session status** chip next to it (from §3.6).
- Optional: `grokcliConcurrency` numeric field (default 4) — tune parallelism without redeploy.

SPA-trap: admin/server.js is the inline-React monolith → run `npm run check:spa` after edits.

---

## 4. Data flow (per cycle, cli provider)

```
aiProvider='grokcli' → _getRuntimeAiConfig → { transport:'cli', model, concurrency, sessionAlive }
   sessionAlive? no → fallback to xai/openai/gemini (HTTP), run exactly as today. done.
   yes ↓
scoreTrends: batches of 8 → bounded pool (N=concurrency)
   each batch → _callResponsesAPI → (transport cli) → _callGrokCli → spawn grok -p
       ok       → parse (strip fence) → trends[]
       fail x2  → API fallback for that batch → heuristic if that fails too
   results merged back BY INDEX (order preserved) → same downstream as any provider
Stage 2 (x_search) → unchanged, still HTTP/xai
```

---

## 5. Risks

- **ToS (highest).** Running a production pipeline 24/7 through a personal SuperGrok subscription is
  a grey area. If xAI throttles/blocks the account, Stage 1 degrades to API/heuristic (never a crash,
  per §3.5). Operator has explicitly accepted this risk. Document, don't hide.
- **Session expiry / refresh.** OIDC token is 6h with refresh_token; the CLI refreshes itself. If the
  whole session dies (revocation, password change), §3.6 detects it and §3.5 falls back. Operator
  re-runs `grok login --device-auth` once to restore.
- **Latency on a 15-min cycle.** Not supported for grokcli; documented. 30/60-min only.
- **Throughput surprise.** Peak measured at 82 *new* trends/hr; rescores add more. If a cycle's batch
  count × ~90s ÷ concurrency exceeds the cycle interval, cycles could overlap. Mitigation: concurrency
  is tunable; a guard logs if Stage 1 wall-time exceeds X% of the cycle so the operator can react.
- **Binary/PATH drift on redeploy.** `grok` lives in `~/.grok/bin` on the host, NOT in the container.
  This needs resolving in the plan: either run the CLI on the host and bridge, or install the CLI
  into the image + mount `~/.grok` (session) as a volume. **OPEN — see §7.**

---

## 6. Settings (runtime-tunable, generic KV)

| Key | Default | Meaning |
|---|---|---|
| `aiProvider` | `xai` (existing) | now also accepts `grokcli` |
| `grokcliModel` | `grok-build` | model id for the CLI provider |
| `grokcliConcurrency` | `4` | parallel CLI batches in Stage 1 (cli transport only) |
| `GROK_CLI_BIN` (env) | `grok` | path to the CLI binary |
| `GROKCLI_TIMEOUT_MS` (env) | `180000` | per-call hard timeout |

---

## 7. Open questions → resolved in the plan

1. **Container vs host execution (BIGGEST).** The app runs in Docker; `grok` + its session live on the
   host (`~/.grok`). Options to resolve in the plan:
   a. Install `grok` into the Docker image + bind-mount a host `~/.grok` dir (session persists across
      redeploys) into the container. Cleanest if the CLI runs in-container.
   b. Run `grok` on the host; the container calls it via a tiny local shim (ssh/socket). More moving parts.
   Recommendation leans (a) — mount the session dir as a volume, install CLI in image. Plan must verify
   the CLI's relay/network works from inside the container sandbox.
2. **Prompt assembly:** confirm `system + "\n\n=== INPUT ===\n\n" + user` reproduces production scoring
   parity vs the two-message API form (validated loosely on sandbox; plan adds a parity check).
3. **`--output-format plain` vs `json`:** plain gave clean JSON in tests; json wraps in an envelope with
   a `thought` field (extra tokens/time). Plan picks plain unless a parsing reason emerges.
4. **Concurrency ceiling:** 4 measured safe; is 6-8 still throttle-free? Plan can probe once more.
5. **Quality parity gate:** before flipping prod, run the same trend sample through grokcli AND the
   current provider, diff the scores; only ship if within tolerance. (Operator's core concern.)

---

## 8. Out of scope

- **Media/vision via build (Stage 0b replacement).** build can see images; replacing Gemini Stage 0b
  with build is a separate, larger iteration (how to pass media to the CLI, video timing, cost). Parked.
- **Stage 2 (x_search) on the subscription.** Proven impossible — x_search bills per-token via the API
  in any channel (CLI has no x_search tool; MCP wrappers still need XAI_API_KEY). See IDEAS.md negative
  note (2026-06-01). Stage 2 stays on the API.
- **15-min cycle support for grokcli.** Latency doesn't fit; documented limit.
- **Reasoning-effort tuning** of grok-build — default behavior for now; revisit if quality needs it.
