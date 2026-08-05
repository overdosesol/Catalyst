import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyPotentialCaps,
  computeDeceptionRisk,
  runPostPass,
  POTENTIAL_CAPS,
  DECEPTION_CAP_RISK,
  DEFAULT_ALERT_WEIGHTS,
} from '../src/analysis/scorer.js';
import {
  parseNarrativeCore,
  VISION_PROMPT,
  _buildContextString,
} from '../src/analysis/gemini-captioner.js';
import { STAGE1_SYSTEM_PROMPT, buildAnalysisPrompt } from '../src/analysis/prompts.js';

// Build a trend that has vision output and trips nothing by default.
function neutralTrend(gemini = {}, extra = {}) {
  return {
    title: 'test trend',
    memePotential: 80,
    preStage: {
      gemini: {
        retelling: 'A named raccoon steals a police body camera.',
        replaceability: 20,
        residue: 70,
        authenticityDependency: 30,
        aiOrigin: 'real',
        presentedAsReal: true,
        isCompilation: false,
        ...gemini,
      },
    },
    ...extra,
  };
}

// ─── parseNarrativeCore ──────────────────────────────────────────────────────

test('parseNarrativeCore defaults every number to 50, not 0', () => {
  const p = parseNarrativeCore({});
  assert.equal(p.replaceability, 50);
  assert.equal(p.residue, 50);
  assert.equal(p.authenticityDependency, 50);
  // Absent key, NOT '': an unanswered field must not read as "no story".
  assert.equal('retelling' in p, false);
});

test('parseNarrativeCore keeps an explicitly empty retelling as evidence', () => {
  assert.equal(parseNarrativeCore({ retelling: '  ' }).retelling, '');
});

test('parseNarrativeCore clamps out-of-range numbers', () => {
  const p = parseNarrativeCore({ replaceability: 999, residue: -20, authenticityDependency: '77' });
  assert.equal(p.replaceability, 100);
  assert.equal(p.residue, 0);
  assert.equal(p.authenticityDependency, 77);
});

test('parseNarrativeCore neutral defaults trip no cap', () => {
  const t = neutralTrend(parseNarrativeCore({}));
  applyPotentialCaps(t);
  assert.equal(t.memePotential, 80);
  assert.equal(t.capsApplied, undefined);
});

// ─── computeDeceptionRisk ────────────────────────────────────────────────────

test('honest AI meme is not a deception risk', () => {
  // Openly generated, openly stylised, interest does not need it to be real.
  const risk = computeDeceptionRisk({
    aiOrigin: 'obvious_ai', presentedAsReal: false, authenticityDependency: 10,
  });
  assert.ok(risk < DECEPTION_CAP_RISK, `expected honest AI meme below threshold, got ${risk}`);
});

test('AI fake presented as real footage is a deception risk', () => {
  const risk = computeDeceptionRisk({
    aiOrigin: 'likely_ai', presentedAsReal: true, authenticityDependency: 80,
  });
  assert.ok(risk >= DECEPTION_CAP_RISK, `expected fake above threshold, got ${risk}`);
});

test('honest "unclear" can never trip the deception cap on its own', () => {
  // Worst case for an uncertain observer: max dependency, framed as real.
  const risk = computeDeceptionRisk({
    aiOrigin: 'unclear', presentedAsReal: true, authenticityDependency: 100,
  });
  assert.ok(risk < DECEPTION_CAP_RISK, `unclear must stay unpunished, got ${risk}`);
});

test('real footage carries zero deception risk regardless of dependency', () => {
  assert.equal(computeDeceptionRisk({
    aiOrigin: 'real', presentedAsReal: true, authenticityDependency: 100,
  }), 0);
});

// ─── applyPotentialCaps: individual rules ────────────────────────────────────

test('compilation caps memePotential at 25', () => {
  const t = neutralTrend({ isCompilation: true });
  applyPotentialCaps(t);
  assert.equal(t.memePotential, POTENTIAL_CAPS.compilation);
  assert.equal(t.capsApplied.rules[0].rule, 'compilation');
  assert.equal(t.capsApplied.memeBefore, 80);
});

test('empty retelling caps at 35', () => {
  const t = neutralTrend({ retelling: '   ' });
  applyPotentialCaps(t);
  assert.equal(t.memePotential, POTENTIAL_CAPS.no_retelling);
});

test('residue <= 20 caps at 40', () => {
  const t = neutralTrend({ residue: 20 });
  applyPotentialCaps(t);
  assert.equal(t.memePotential, POTENTIAL_CAPS.spectacle_only);
});

test('replaceable AND nameless caps at 40', () => {
  const t = neutralTrend({ replaceability: 71 });
  applyPotentialCaps(t);
  assert.equal(t.memePotential, POTENTIAL_CAPS.replaceable);
});

test('replaceable BUT named is not capped', () => {
  const t = neutralTrend({ replaceability: 95 }, { subjectName: 'Moo Deng' });
  applyPotentialCaps(t);
  assert.equal(t.memePotential, 80);
});

test('deception risk caps at 30', () => {
  const t = neutralTrend({
    aiOrigin: 'likely_ai', presentedAsReal: true, authenticityDependency: 80,
  });
  applyPotentialCaps(t);
  assert.equal(t.memePotential, POTENTIAL_CAPS.deception);
});

// ─── applyPotentialCaps: combination and exemptions ──────────────────────────

test('multiple rules apply the strictest cap, never a stacked one', () => {
  const t = neutralTrend({ isCompilation: true, residue: 5, retelling: '' });
  applyPotentialCaps(t);
  assert.equal(t.memePotential, POTENTIAL_CAPS.compilation); // 25, the minimum
  assert.equal(t.capsApplied.rules.length, 3);
  assert.equal(t.capsApplied.cap, 25);
});

test('no vision output means no caps (text-only exemption)', () => {
  const t = { title: 'reddit text post', memePotential: 90, preStage: { gemini: null } };
  applyPotentialCaps(t);
  assert.equal(t.memePotential, 90);
  assert.equal(t.capsApplied, undefined);
});

test('legacy record without SECTION E fields is not capped', () => {
  // retelling undefined (never collected) must not read as "empty retelling".
  const t = {
    title: 'scored before 2026-08-05',
    memePotential: 88,
    preStage: { gemini: { visualCaption: 'a cat', aiOrigin: 'unclear', presentedAsReal: true } },
  };
  applyPotentialCaps(t);
  assert.equal(t.memePotential, 88);
});

test('a cap never raises a score that is already below it', () => {
  const t = neutralTrend({ isCompilation: true }, { memePotential: 10 });
  applyPotentialCaps(t);
  assert.equal(t.memePotential, 10);
  // The rule still fired — recorded so calibration can see near-misses.
  assert.equal(t.capsApplied.rules[0].rule, 'compilation');
  assert.equal(t.capsApplied.memeAfter, 10);
});

test('applying caps twice is idempotent', () => {
  const t = neutralTrend({ isCompilation: true });
  applyPotentialCaps(t);
  applyPotentialCaps(t);
  assert.equal(t.memePotential, POTENTIAL_CAPS.compilation);
});

// ─── runPostPass ordering + kill switch ──────────────────────────────────────

test('caps run AFTER the story bonus, so the bonus cannot lift a capped trend', () => {
  const t = neutralTrend({ isCompilation: true }, {
    memePotential: 70,
    storyScore: 100,      // would add the full +15 story bonus
    subjectName: '',
  });
  runPostPass([t], DEFAULT_ALERT_WEIGHTS);
  assert.equal(t.memePotential, POTENTIAL_CAPS.compilation);
});

test('capped trend gets its alertScore recomputed from the capped value', () => {
  const t = neutralTrend({ isCompilation: true }, { memePotential: 95, score: 90 });
  runPostPass([t], DEFAULT_ALERT_WEIGHTS);
  assert.equal(t.alertBreakdown.meme, POTENTIAL_CAPS.compilation);
  // 25*0.60 + 90*0.20 + 50*0.05 = 35.5 — comfortably under the 55 alert floor.
  assert.ok(t.alertScore < 55, `expected capped compilation below threshold, got ${t.alertScore}`);
});

// ─── prompt assembly ─────────────────────────────────────────────────────────

test('vision prompt carries SECTION E and counts five sections', () => {
  assert.ok(VISION_PROMPT.includes('SECTION E — NARRATIVE CORE'), 'SECTION E must be present');
  assert.ok(VISION_PROMPT.includes('Return these fields in 5 sections:'), 'section count must match');
  assert.ok(VISION_PROMPT.indexOf('SECTION E') < VISION_PROMPT.indexOf('FILTER FLAGS'),
            'splice marker moved — E must precede FILTER FLAGS');
});

test('stage 1 prompt carries the narrative-core block before batch calibration', () => {
  assert.ok(STAGE1_SYSTEM_PROMPT.includes('━━━ NARRATIVE CORE ━━━'), 'core block must be present');
  assert.ok(STAGE1_SYSTEM_PROMPT.indexOf('NARRATIVE CORE') < STAGE1_SYSTEM_PROMPT.indexOf('BATCH CALIBRATION'),
            'splice marker moved');
});

test('observer never sees engagement metrics', () => {
  const trend = {
    title: 'cat',
    source: 'tiktok',
    metrics: { views: 2_300_000, likes: 19_000, author: 'someone' },
  };
  const ctx = _buildContextString(trend);
  assert.ok(!ctx.includes('Metrics:'), 'observer must not see engagement');
  assert.ok(!ctx.includes('2.3M'), 'no engagement number may leak through another line');
  assert.ok(ctx.includes('Source: tiktok'), 'platform context stays — it is not a metric');
});

test('stage 1 prompt drops the emergence echo and carries the core fields', () => {
  const trend = {
    title: 'a trend',
    source: 'tiktok',
    emergenceScore: 62,
    clusterMetrics: { emergenceScore: 62, itemCount: 4 },
    preStage: { gemini: { visualCaption: 'x', replaceability: 88, residue: 12, retelling: '' } },
  };

  const p = buildAnalysisPrompt([trend]);
  assert.ok(!p.includes('Emergence: 62/100'), 'emergence must not be double counted');
  assert.ok(!p.includes('ClusterSize:'));
  assert.ok(p.includes('replaceability=88/100'));
  assert.ok(p.includes('residue=12/100'));
  assert.ok(p.includes('Retelling: NONE'), 'empty retelling must be stated, not omitted');
});

test('a record captioned before SECTION E existed still renders', () => {
  const legacy = {
    title: 'old trend',
    source: 'reddit',
    preStage: { gemini: { visualCaption: 'x', hasNarrative: true } },
  };
  const p = buildAnalysisPrompt([legacy]);
  assert.ok(!p.includes('replaceability='));
  assert.ok(!p.includes('Retelling:'));
});
