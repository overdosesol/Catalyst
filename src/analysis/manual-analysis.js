// Manual analysis orchestrator. Used by:
//   - Admin "Ручной анализ" tab (admin/server.js → POST /api/submit-narrative)
//   - Dashboard pro/admin manual-analysis endpoint (dashboard/server.js)
//   - Telegram bot URL-paste handler (notifications/telegram.js)
//
// Resolves a raw URL to a synthetic trend, runs it through the scorer
// (Stage 1 + Stage 2 deep-dive when threshold met), optionally persists
// it to the trends table with a manualSubmitted marker, and returns the
// scored trend plus a pipeline trace.
//
// ALL THREE call sites need the same machinery — this file is the single
// source of truth so a fix in one surface doesn't quietly diverge from
// the others.

import { resolveUrlToTrend } from './url-resolver.js';

// ── Cross-user URL cache ────────────────────────────────────────────────────
// Stage 2 deep-dive costs ~5¢ per call. If user A analyses URL X and user B
// asks for the same URL within 1h, we serve user B from cache instead of
// paying for a duplicate run. Module-level Map → all three surfaces (admin,
// dashboard, TG) share the same cache because they live in one Node process.
//
// The cache stores the full scorer result. If a save:true caller arrives
// after a save:false cache write, we save lazily on hit so the trend ends
// up in DB anyway. The reverse case (save:true cached, save:false hit)
// just reuses the saved row's _dbId — that's fine, the row exists.
//
// Wiped on restart, which is correct for a 1h TTL — we don't need
// persistence and a fresh process should not inherit stale analyses.

const RESULT_CACHE = new Map();              // cacheKey → { trend, pipeline, ts, savedDbId|null }
const CACHE_TTL_MS = 60 * 60 * 1000;         // 1 hour
const CACHE_MAX_ENTRIES = 200;               // LRU-ish soft cap, expired entries swept on every miss

function cacheKeyFor(url) {
  // Lowercase trim — different cases / trailing whitespace are the same URL.
  // We deliberately keep query strings intact (?v=, ?id=) so distinct posts
  // on og:image-only sites don't collide. Tracking params (utm_*) cause
  // a duplicate analysis but that's <5¢ — not worth a normalizer.
  return String(url || '').trim().toLowerCase().replace(/\/+$/, '');
}

function sweepExpired() {
  if (RESULT_CACHE.size <= CACHE_MAX_ENTRIES) return;
  const cutoff = Date.now() - CACHE_TTL_MS;
  for (const [k, v] of RESULT_CACHE) {
    if (v.ts < cutoff) RESULT_CACHE.delete(k);
  }
}

/**
 * Public clear — used by admin "Force re-run" button if we ever add one,
 * or by tests. Not wired anywhere yet.
 */
export function clearManualAnalysisCache(url) {
  if (url) RESULT_CACHE.delete(cacheKeyFor(url));
  else RESULT_CACHE.clear();
}

/**
 * Non-mutating cache peek — lets callers (dashboard / TG handlers) skip
 * rate-limit checks when they know the result will come from cache anyway
 * (free + instant). Returns the cache age in ms or null if the URL is not
 * cached or the entry is stale.
 */
export function peekManualAnalysisCache(url) {
  const hit = RESULT_CACHE.get(cacheKeyFor(url));
  if (!hit) return null;
  const age = Date.now() - hit.ts;
  if (age >= CACHE_TTL_MS) return null;
  return age;
}

/**
 * @param {Object}   opts
 * @param {Object}   opts.scorer    Scorer instance (must expose scoreTrends())
 * @param {Object}   opts.db        Database wrapper
 * @param {string}   opts.url       Raw URL pasted by the operator/user
 * @param {boolean}  [opts.save]    If true, UPSERTs into `trends` with
 *                                  raw_metrics.manualSubmitted=true (admin
 *                                  history flow). Default false — dashboard
 *                                  and TG callers don't want their analyses
 *                                  polluting the global feed.
 * @param {boolean}  [opts.useCache] Default true. Pass false to force a
 *                                   fresh scorer run regardless of cache state
 *                                   (e.g. admin "Re-run" button — not wired yet).
 * @param {Object}   [opts.logger]  Optional logger (.info / .warn / .error)
 * @param {string|number} [opts.actorId] Optional chat_id / user_id for log
 *                                       attribution. Goes into the `[Manual]`
 *                                       log line but is NOT persisted on
 *                                       the trend row (no per-user history
 *                                       column today).
 *
 * @returns {Promise<{
 *   ok: true,
 *   elapsedMs: number,       Real time spent. Near-zero on cache hit.
 *   trend: Object,           Scored trend object (has memePotential, scores, xSearchData, preStage, etc.)
 *   dbId: number|null,       Set when save=true, null otherwise
 *   pipeline: {              Re-derived gate trace for UI rendering
 *     stage1Ran: boolean,
 *     stage2Ran: boolean,
 *     stage2SkipReason: string|null,
 *     stage2Threshold: number,
 *   },
 *   fromCache: boolean,      true → no scorer call was made, result is < 1h old
 *   cacheAgeMs: number,      0 on miss, otherwise milliseconds since the cached run
 * }>}
 */
export async function runManualAnalysis({ scorer, db, url, save = false, useCache = true, logger = null, actorId = null }) {
  if (!scorer) throw new Error('scorer is required');
  if (!db)     throw new Error('db is required');
  const rawUrl = String(url || '').trim();
  if (!rawUrl) throw new Error('url is required');

  const startedAt = Date.now();
  const tag = actorId ? `[Manual:${actorId}]` : '[Manual]';
  const key = cacheKeyFor(rawUrl);

  // ── Cache hit path ────────────────────────────────────────────────────────
  // On hit: serve the cached scorer output. If the caller wants to save and
  // the cached entry was never persisted (because the user who first ran it
  // had save=false), we save NOW so the admin's manual-submit guarantee
  // ("trend lands in DB") still holds. This means a save:true caller
  // following a save:false caller pays a tiny DB write but no scorer call.
  if (useCache) {
    const hit = RESULT_CACHE.get(key);
    if (hit && Date.now() - hit.ts < CACHE_TTL_MS) {
      const cacheAgeMs = Date.now() - hit.ts;
      logger?.info?.(`${tag} cache HIT ${rawUrl} (age=${Math.round(cacheAgeMs / 60000)}min, save=${save ? 'yes' : 'no'})`);

      let dbId = hit.savedDbId || null;
      let trendOut = hit.trend;
      if (save && !dbId) {
        // Lazy save — first save:true caller after a save:false caller wins.
        // Mark with the manualSubmitted flag here so the admin history list
        // sees this row exactly the same as a freshly-analyzed one.
        trendOut = { ...hit.trend };
        trendOut.metrics = { ...(hit.trend.metrics || {}) };
        trendOut.metrics.manualSubmitted = true;
        trendOut.metrics.manualSubmittedAt = new Date().toISOString();
        if (actorId) trendOut.metrics.manualSubmittedBy = String(actorId);
        dbId = db.saveTrend({ ...trendOut, pipelineStatus: 'scored' });
        trendOut._dbId = dbId;
        // Update cache so subsequent save:false callers also see the dbId
        // (lets them link to the trend in dashboards / TG buttons).
        hit.savedDbId = dbId;
        hit.trend = trendOut;
      }
      return {
        ok: true,
        elapsedMs: Date.now() - startedAt,
        trend: trendOut,
        dbId,
        pipeline: hit.pipeline,
        fromCache: true,
        cacheAgeMs,
      };
    }
  }

  // ── Cache miss path ───────────────────────────────────────────────────────
  logger?.info?.(`${tag} ${rawUrl} (save=${save ? 'yes' : 'no'}, cache=miss)`);

  const synthetic = await resolveUrlToTrend(rawUrl);
  if (!synthetic) throw new Error('Could not resolve URL metadata');

  // Full scorer pipeline — Stage 1 batch + Stage 2 deep-dive when threshold met.
  // PreStage is opportunistic (idempotency guard inside scorer).
  const scored = await scorer.scoreTrends([synthetic]);
  const trend = scored[0] || synthetic;

  let dbId = null;
  if (save) {
    trend.metrics = trend.metrics || {};
    trend.metrics.manualSubmitted = true;
    trend.metrics.manualSubmittedAt = new Date().toISOString();
    if (actorId) trend.metrics.manualSubmittedBy = String(actorId);
    dbId = db.saveTrend({ ...trend, pipelineStatus: 'scored' });
    trend._dbId = dbId;
  }

  const elapsedMs = Date.now() - startedAt;

  // Re-derive pipeline trace so the UI can show "Stage 2 skipped because
  // memePotential 35 < threshold 60" without the orchestrator keeping
  // any pipeline-internal state.
  const stage2Threshold = parseInt(db.getSetting?.('stage2Threshold', '60'), 10) || 60;
  const stage1Ran = typeof trend.memePotential === 'number';
  const stage2Ran = !!trend.xSearchData;
  let stage2SkipReason = null;
  if (!stage2Ran) {
    if ((trend.memePotential || 0) < stage2Threshold) {
      stage2SkipReason = `memePotential ${trend.memePotential || 0} < threshold ${stage2Threshold}`;
    } else if (trend.source === 'google_trends') {
      stage2SkipReason = 'google_trends source skipped from Stage 2';
    } else if (trend.clusterMetrics?.isNovel === false) {
      stage2SkipReason = 'duplicate cluster (isNovel=false)';
    } else {
      stage2SkipReason = 'cap reached or Stage 2 disabled';
    }
  }

  logger?.info?.(`${tag} done in ${elapsedMs}ms — ${dbId ? 'trend #' + dbId + ', ' : ''}score=${trend.score}, meme=${trend.memePotential}`);

  const pipeline = { stage1Ran, stage2Ran, stage2SkipReason, stage2Threshold };

  // Populate the cross-user cache so the next caller within 1h hits HIT path.
  // We sweep expired entries lazily — only when the cache grows past the cap.
  if (useCache) {
    RESULT_CACHE.set(key, { trend, pipeline, ts: Date.now(), savedDbId: dbId });
    sweepExpired();
  }

  return {
    ok: true,
    elapsedMs,
    trend,
    dbId,
    pipeline,
    fromCache: false,
    cacheAgeMs: 0,
  };
}
