/**
 * Golden-set core — pure functions only. No fs, no network, no process access,
 * so the whole thing is testable without API keys and without a snapshot.
 *
 * Used by:
 *   scripts/golden/extract.mjs  — snapshot → candidate buckets
 *   scripts/golden/replay.mjs   — fixtures → live Stage 1 run
 *   scripts/golden/compare.mjs  — run(s) → band report
 *   test/golden-lib.test.mjs    — synthetic unit tests
 */

// ─── Snapshot row → scorer-compatible trend ──────────────────────────────────

// Fields that are NOT engagement metrics — they are scorer output persisted
// into the same JSON blob. Everything else in raw_metrics is a metric.
// Mirrors the destructuring stripper in src/db/database.js:1191-1194.
const SERVICE_KEYS = new Set([
  'memePotential', 'adoptionScore', 'emergenceScore', 'narrativePhase', 'rankScore',
  'marketStage', 'junkPenalty', 'junkReasons', 'alertScore', 'alertBreakdown',
  'alertType', 'storyScore', 'storyHook', 'subjectName', 'nameStrength',
  'preStage', 'tgMessageUrl',
]);

/**
 * Rebuild a trend object the scorer can consume, out of one snapshot row.
 *
 * The snapshot is FLAT: engagement metrics sit at the top level of raw_metrics
 * next to the score fields, and `clusterMetrics` is never persisted — emergence
 * and junk live as plain top-level keys. Both facts were verified against the
 * production dump on 2026-08-04.
 */
export function rowToTrend(row) {
  let meta = {};
  try { meta = row.raw_metrics ? JSON.parse(row.raw_metrics) : {}; }
  catch { meta = {}; }

  const metrics = {};
  for (const [k, v] of Object.entries(meta)) {
    if (!SERVICE_KEYS.has(k)) metrics[k] = v;
  }

  const emergenceScore = Number(meta.emergenceScore ?? 0);
  const junkPenalty    = Number(meta.junkPenalty ?? 0);
  const memePotential  = Number(meta.memePotential ?? 0);
  const gem            = meta.preStage?.gemini || null;

  return {
    _dbId:          row.id,
    source:         row.source,
    title:          row.title,
    originalTitle:  row.original_title || row.title,
    description:    row.description || '',
    url:            row.url,
    score:          row.score || 0,
    category:       row.category,
    memePotential,
    emergenceScore,
    junkPenalty,
    clusterMetrics: {
      emergenceScore,
      junkPenalty,
      junkReasons:    meta.junkReasons || [],
      marketStage:    meta.marketStage ?? null,
      narrativePhase: meta.narrativePhase ?? null,
      isNovel:        true,
    },
    preStage: meta.preStage || null,
    metrics,
    firstSeen: row.first_seen_at,
    // What production actually produced — frozen for comparison. Never fed back
    // into the model; kept beside the inputs so a run can show drift.
    baseline: {
      memePotential,
      viralityScore:     row.score || 0,
      category:          row.category,
      alertScore:        Number(meta.alertScore ?? 0),
      storyScore:        Number(meta.storyScore ?? 0),
      aiExplanation:     row.ai_explanation || '',
      geminiMeme:        gem && Number.isFinite(gem.memePotential) ? gem.memePotential : null,
      viralPattern:      gem?.viralPattern ?? null,
      memeShapeStrength: gem && Number.isFinite(gem.memeShapeStrength) ? gem.memeShapeStrength : null,
      isAmbient:         gem?.isAmbient ?? null,
      isLipSync:         gem?.isLipSync ?? null,
    },
  };
}

// ─── Candidate selection heuristics ──────────────────────────────────────────

const RE_COMPILATION = /\bcompilations?\b|\bmontage\b|series of [a-z ]*clips|multiple clips|several clips|various clips|best of\b|funniest\b/i;

// Explicit admissions of generated origin.
const RE_AI_EXPLICIT = /\bai[- ]generated\b|\bdeepfake\b|\b3d render\b|digitally created|\bcgi\b|synthetic (?:video|footage)/i;

// Physically impossible action narrated as if it happened. This is the ONLY
// machine-readable trace of a generated clip in historic data — Gemini was
// never asked about authenticity, so when it met AI footage it simply described
// the impossible thing and moved on. Case 16066 ("kittens appear to be walking
// upright on two legs, holding hands", memePotential=87) is the canonical
// example. Recall matters here, precision does not: this only picks CANDIDATES
// for a human to label, so false positives cost one glance.
const RE_AI_IMPOSSIBLE = /\b(?:walking|standing|dancing|marching|strolling)\s+upright\b|\bon (?:its|their) (?:two |hind )?legs\b|\bholding (?:hands|paws)\b|\bhuman-like (?:walk|gait|dance|movement)\b|\bdefies (?:gravity|physics)\b|\bimpossible(?:ly)?\b/i;

/**
 * Rough bucketing for CANDIDATE SELECTION ONLY. The operator assigns the final
 * label(s) by hand — this just stops us reading 930 records one by one.
 *
 * Returns one of: compilation | ai_suspect | text_only | junk | animal_high |
 * high_score | other. These are SELECTION buckets, deliberately different from
 * the golden classes in BANDS — see checkClasses.
 */
export function heuristicClass(trend) {
  const g = trend.preStage?.gemini || null;
  const text = [
    trend.title, trend.description,
    g?.visualCaption, g?.videoSummary, g?.visibleText,
  ].filter(Boolean).join(' ');

  if (g?.viralPattern === 'compilation' || RE_COMPILATION.test(text))    return 'compilation';
  if (RE_AI_EXPLICIT.test(text) || RE_AI_IMPOSSIBLE.test(text))          return 'ai_suspect';
  if (!g || !g.visualCaption)                                            return 'text_only';
  if (Number(trend.junkPenalty) >= 40)                                   return 'junk';
  if (trend.category === 'animals' && Number(trend.memePotential) >= 60) return 'animal_high';
  if (Number(trend.memePotential) >= 70)                                 return 'high_score';
  return 'other';
}

// ─── Acceptance bands ────────────────────────────────────────────────────────

/**
 * Acceptance bands per curated class. Deliberately bands, not exact numbers —
 * LLM output is not deterministic, so a target of "<= 25" is testable while
 * "== 18" is noise.
 */
export const BANDS = {
  good:           { min: 60, max: 90 },
  compilation:    { max: 25 },
  ai_fake:        { max: 20 },
  // Floor only. ai_slop says "do not crush this" — openly-generated meme content
  // is legitimate. How HIGH it may go is decided by the other labels on the same
  // fixture (16066 is also generic_animal → effective band 30..45), because
  // being generated is not by itself a reason to score well either.
  ai_slop:        { min: 30 },
  generic_animal: { max: 45 },
  junk:           { max: 30 },
  // Ceiling only. text_only is a PATH label ("scored without vision"), not a
  // quality label: a routine sports trade legitimately deserves 15, so a lower
  // bound would fail correct behaviour. What we actually guard against is the
  // model inventing confidence it cannot have without seeing the media.
  text_only:      { max: 70 },
};

/** The only labels a curated fixture may carry. */
export const GOLDEN_CLASSES = Object.freeze(Object.keys(BANDS));

/**
 * Check a score against every class assigned to a fixture, applying the
 * STRICTEST bound on each side.
 *
 * Fixtures carry an array because the classes are not mutually exclusive:
 * case 16041 is a compilation AND an AI fake presented as real, so its real
 * ceiling is min(25, 20) = 20.
 *
 * Contradictory labels (e.g. ai_slop needs >= 40 while compilation needs <= 25)
 * are reported as `conflict` rather than silently failing — that combination is
 * a labelling mistake, not a model failure, and the two look identical in a
 * pass/fail column.
 */
export function checkClasses(classes, value) {
  const list = Array.isArray(classes) ? classes : (classes ? [classes] : []);
  if (list.length === 0) {
    return { ok: false, unknown: true, conflict: false, detail: 'no golden class assigned' };
  }
  const unknown = list.filter(c => !BANDS[c]);
  if (unknown.length > 0) {
    return {
      ok: false, unknown: true, conflict: false,
      detail: `unknown golden class: ${unknown.join(', ')}`,
    };
  }

  let min = -Infinity;
  let max = Infinity;
  for (const c of list) {
    const b = BANDS[c];
    if (b.min !== undefined) min = Math.max(min, b.min);
    if (b.max !== undefined) max = Math.min(max, b.max);
  }

  if (min > max) {
    return {
      ok: false, unknown: false, conflict: true, min, max,
      detail: `contradictory labels [${list.join(' + ')}]: needs >= ${min} and <= ${max}`,
    };
  }

  const v = Number(value) || 0;
  const parts = [];
  if (min > -Infinity) parts.push(`>= ${min}`);
  if (max < Infinity)  parts.push(`<= ${max}`);
  return {
    ok: v >= min && v <= max,
    unknown: false,
    conflict: false,
    min, max,
    detail: `${v} vs ${parts.join(' and ') || 'no bounds'}`,
  };
}

/** Single-class convenience wrapper around checkClasses. */
export function checkBand(cls, value) {
  return checkClasses(cls, value);
}
