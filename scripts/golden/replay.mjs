/**
 * Run Stage 1 over the curated golden set and store the result.
 *
 *   node scripts/golden/replay.mjs [--label baseline] [--batch 8] [--limit N]
 *
 * Vision is NOT re-run: preStage comes from the fixtures, so a full pass costs
 * roughly one Stage-1 batch. The DB is stubbed with the settings read off the
 * production server on 2026-08-04, so prompt assembly matches the scanner.
 *
 * NOTE: the baseline run (2026-08-04) was taken while the trust contract was
 * still in place, so Stage 1 echoed the Stage 0b numbers and reproduced the
 * production scores exactly — that equality was the harness's sanity check.
 * Since the 2026-08-05 roles swap Stage 1 scores for itself, so runs now vary
 * between passes; compare bands, not individual numbers.
 */
import fs from 'node:fs';
import path from 'node:path';
import 'dotenv/config';
import Scorer, { runPostPass, loadAlertWeights } from '../../src/analysis/scorer.js';
import GeminiCaptioner from '../../src/analysis/gemini-captioner.js';
import { PreStage } from '../../src/analysis/pre-stage.js';

const args   = process.argv.slice(2);
const argVal = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const LABEL  = argVal('--label', 'run');
const BATCH  = Number(argVal('--batch', '8'));
const LIMIT  = Number(argVal('--limit', '0'));
// --model swaps the Stage 1 model without touching prod settings. Added
// 2026-08-05: once Stage 1 became the scorer, "is this the rubric or the
// model?" turned into a question the harness has to be able to answer.
const MODEL  = argVal('--model', 'gemini-3.5-flash-lite');
// --vision re-runs Stage 0b over the fixtures and caches the result. Added
// 2026-08-05 with the narrative-core fields: the curated fixtures were captured
// before SECTION E existed, so replaying Stage 1 against them measures the caps
// against fields that are simply absent. Vision output is cached because it
// costs real money and does not change between Stage 1 runs.
const REVISION = args.includes('--vision');
const FIXTURES       = 'data/golden/fixtures.json';
const FIXTURES_VISION = 'data/golden/fixtures-vision.json';

const logger = {
  info:  m => console.log('  [info]', m),
  warn:  m => console.warn('  [warn]', m),
  error: m => console.error('  [err ]', m),
  debug: () => {},
};

const dbStub = {
  getSetting: (key, dflt) => ({
    aiProvider:      'gemini',
    geminiModel:     MODEL,
    aiStage2Enabled: '0',
    activePreset:    'general',
    nanoEnabled:     '0',
  }[key] ?? dflt),
  listStage1Examples:    () => [],
  getLikedNarratives:    () => [],
  getDislikedNarratives: () => [],
};

if (!fs.existsSync(FIXTURES)) {
  console.error(`Missing ${FIXTURES}. Run scripts/golden/curate.mjs first.`);
  process.exit(1);
}

// Prefer the vision-refreshed cache when it exists — it is the same fixtures
// with a Stage 0b pass that knows about SECTION E.
const useCache = !REVISION && fs.existsSync(FIXTURES_VISION);
let fixtures = JSON.parse(fs.readFileSync(useCache ? FIXTURES_VISION : FIXTURES, 'utf8'));
if (useCache) console.log(`Using vision-refreshed fixtures (${FIXTURES_VISION})`);
if (LIMIT > 0) fixtures = fixtures.slice(0, LIMIT);

if (REVISION) {
  const captioner = new GeminiCaptioner({}, logger);
  if (!captioner.enabled) {
    console.error('GOOGLE_AI_API_KEY missing — cannot re-run vision.');
    process.exit(1);
  }
  const preStage = new PreStage(logger, { geminiCaptioner: captioner });
  // enrichBatch skips when every trend already has a `preStage` key, which the
  // fixtures do — drop it so the stage actually runs.
  for (const f of fixtures) delete f.preStage;
  console.log(`Re-running Stage 0b over ${fixtures.length} fixtures (${captioner._activeModel})…`);
  const t0 = Date.now();
  await preStage.enrichBatch(fixtures);
  const withVision = fixtures.filter(f => f.preStage?.gemini).length;
  fs.writeFileSync(FIXTURES_VISION, JSON.stringify(fixtures, null, 2));
  console.log(`Vision refreshed: ${withVision}/${fixtures.length} captioned in ` +
              `${Math.round((Date.now() - t0) / 1000)}s → ${FIXTURES_VISION}\n`);
}

const scorer = new Scorer({}, logger, dbStub, null);
if (!scorer.current.enabled) {
  console.error(`Provider ${scorer.current.provider} has no API key — cannot replay.`);
  process.exit(1);
}

console.log(`Replaying ${fixtures.length} fixtures through Stage 1 ` +
            `(${scorer.current.provider}:${scorer.current.model}, batch=${BATCH})`);

const scored = [];
const startedAt = Date.now();

for (let i = 0; i < fixtures.length; i += BATCH) {
  const batch = fixtures.slice(i, i + BATCH).map(f => ({ ...f }));
  process.stdout.write(`  batch ${Math.floor(i / BATCH) + 1} (${batch.length} items)… `);
  try {
    const out = await scorer._analyzeBatchStage1(batch, null, null, null);
    scored.push(...out);
    console.log('ok');
  } catch (e) {
    console.log('FAILED: ' + e.message);
    scored.push(...batch.map(b => ({ ...b, _replayError: e.message })));
  }
  if (i + BATCH < fixtures.length) await new Promise(r => setTimeout(r, 2000));
}

// The scanner runs the post-pass over every trend after Stage 1 (bonuses →
// text-only multiplier → potential caps → recompute). The harness has to do the
// same or it measures a pipeline that does not exist: before this was added
// (2026-08-05) the caps never ran during a replay and every `capsApplied` came
// back null while the run still looked plausible.
runPostPass(scored, loadAlertWeights(dbStub), logger);

const run = {
  label: LABEL,
  startedAt: new Date(startedAt).toISOString(),
  elapsedMs: Date.now() - startedAt,
  provider: scorer.current.provider,
  model: scorer.current.model,
  visionRefreshed: REVISION || useCache,
  results: scored.map(t => ({
    _dbId:         t._dbId,
    goldenClasses: t.goldenClasses,
    goldenNote:    t.goldenNote,
    source:        t.source,
    title:         t.title,
    memePotential: t.memePotential,
    viralityScore: t.score,
    category:      t.category,
    // alertScore is what the alert gate actually compares against, so a shift
    // in memePotential only matters through this number. Stored since
    // 2026-08-05 to make threshold recalibration measurable instead of guessed.
    alertScore:    t.alertScore,
    emergenceScore: t.emergenceScore,
    storyScore:    t.storyScore,
    subjectName:   t.subjectName,
    scoreSource:   t.scoreSource,
    // Which gate rule (if any) capped the score, and the SECTION E facts it
    // fired on — without these a run tells you the number moved but not why.
    capsApplied:   t.capsApplied || null,
    core: t.preStage?.gemini ? {
      retelling:      t.preStage.gemini.retelling,
      replaceability: t.preStage.gemini.replaceability,
      residue:        t.preStage.gemini.residue,
      authDependency: t.preStage.gemini.authenticityDependency,
      aiOrigin:       t.preStage.gemini.aiOrigin,
      presentedAsReal: t.preStage.gemini.presentedAsReal,
      isCompilation:  t.preStage.gemini.isCompilation,
    } : null,
    aiExplanation: t.aiExplanation,
    baseline:      t.baseline,
    error:         t._replayError || null,
  })),
};

const OUT_DIR = 'data/golden/runs';
fs.mkdirSync(OUT_DIR, { recursive: true });
const outPath = path.join(OUT_DIR, `${LABEL}-${Date.now()}.json`);
fs.writeFileSync(outPath, JSON.stringify(run, null, 2));

const failed = run.results.filter(r => r.error).length;
console.log(`\nWrote ${outPath}`);
console.log(`${run.results.length} results, ${failed} errored, ${Math.round(run.elapsedMs / 1000)}s`);
