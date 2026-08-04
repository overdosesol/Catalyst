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
import Scorer from '../../src/analysis/scorer.js';

const args   = process.argv.slice(2);
const argVal = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const LABEL  = argVal('--label', 'run');
const BATCH  = Number(argVal('--batch', '8'));
const LIMIT  = Number(argVal('--limit', '0'));
// --model swaps the Stage 1 model without touching prod settings. Added
// 2026-08-05: once Stage 1 became the scorer, "is this the rubric or the
// model?" turned into a question the harness has to be able to answer.
const MODEL  = argVal('--model', 'gemini-3.5-flash-lite');
const FIXTURES = 'data/golden/fixtures.json';

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

let fixtures = JSON.parse(fs.readFileSync(FIXTURES, 'utf8'));
if (LIMIT > 0) fixtures = fixtures.slice(0, LIMIT);

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

const run = {
  label: LABEL,
  startedAt: new Date(startedAt).toISOString(),
  elapsedMs: Date.now() - startedAt,
  provider: scorer.current.provider,
  model: scorer.current.model,
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
