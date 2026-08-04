import { test } from 'node:test';
import assert from 'node:assert';
import { normalizeNarrativeFields, selectDeepDiveCandidates } from '../src/analysis/scorer.js';
import { STAGE1_RESPONSE_SCHEMA, buildAnalysisPrompt, buildStage2Prompt, STAGE2_SYSTEM_PROMPT } from '../src/analysis/prompts.js';
import { collectSubjectNames } from '../src/analysis/subject-names.js';

test('collectSubjectNames reads the flat subjectName field', () => {
  const out = collectSubjectNames({ subjectName: 'Peanut', nameStrength: 80 });
  assert.ok(out.all.includes('Peanut'), `got ${JSON.stringify(out.all)}`);
});

test('collectSubjectNames still ignores weak names', () => {
  const out = collectSubjectNames({ subjectName: 'Peanut', nameStrength: 20 });
  assert.ok(!out.all.includes('Peanut'));
});

test('collectSubjectNames still prefers Gemini names first', () => {
  const out = collectSubjectNames({
    preStage: { gemini: { subjectNames: ['Moo Deng'] } },
    subjectName: 'Peanut', nameStrength: 90,
  });
  assert.strictEqual(out.primary, 'Moo Deng');
  assert.ok(out.all.includes('Peanut'));
});

test('clamps scores into 0-100', () => {
  assert.strictEqual(normalizeNarrativeFields({ storyScore: 150 }).storyScore, 100);
  assert.strictEqual(normalizeNarrativeFields({ storyScore: -20 }).storyScore, 0);
  assert.strictEqual(normalizeNarrativeFields({ storyScore: 'abc' }).storyScore, 0);
  assert.strictEqual(normalizeNarrativeFields({}).storyScore, 0);
});

test('trims and caps subjectName at 64 chars', () => {
  assert.strictEqual(normalizeNarrativeFields({ subjectName: '  Peanut  ' }).subjectName, 'Peanut');
  assert.strictEqual(normalizeNarrativeFields({ subjectName: 'x'.repeat(70) }).subjectName.length, 64);
});

test('caps storyHook at 80 chars', () => {
  assert.strictEqual(normalizeNarrativeFields({ storyHook: 'y'.repeat(120) }).storyHook.length, 80);
});

test('nameStrength is forced to 0 when there is no name', () => {
  assert.strictEqual(normalizeNarrativeFields({ subjectName: '', nameStrength: 90 }).nameStrength, 0);
  assert.strictEqual(normalizeNarrativeFields({ subjectName: 'Peanut', nameStrength: 90 }).nameStrength, 90);
});

test('Stage 1 schema declares all four fields as required', () => {
  const item = STAGE1_RESPONSE_SCHEMA.properties.trends.items;
  for (const f of ['storyScore', 'storyHook', 'subjectName', 'nameStrength']) {
    assert.ok(item.required.includes(f), `${f} missing from required`);
    assert.ok(item.properties[f], `${f} missing from properties`);
  }
});

test('Stage 1 prompt names all four fields (the only contract Gemini sees)', () => {
  const p = buildAnalysisPrompt([{ title: 't', source: 'reddit' }]);
  for (const f of ['storyScore', 'storyHook', 'subjectName', 'nameStrength']) {
    assert.ok(p.includes(f), `${f} missing from buildAnalysisPrompt`);
  }
});

test('deep-dive selection keys off memePotential, never storyScore', () => {
  const base = { source: 'reddit', clusterMetrics: { isNovel: true } };
  const picks = selectDeepDiveCandidates({
    stage1Results: [
      { ...base, title: 'low-meme-high-story', memePotential: 10, storyScore: 100 },
      { ...base, title: 'high-meme-no-story',  memePotential: 90, storyScore: 0 },
    ],
    stage2Threshold: 60, cap: 5, reserve: 2,
  });
  assert.deepStrictEqual(picks.map(t => t.title), ['high-meme-no-story']);
});

test('Stage 2 no longer asks for story or name', () => {
  const p = buildStage2Prompt({ title: 't', source: 'reddit', memePotential: 70, score: 60, category: 'meme' });
  for (const f of ['storyScore', 'storyHook', 'subjectName', 'nameStrength']) {
    assert.ok(!p.includes(f), `${f} still present in buildStage2Prompt`);
    assert.ok(!STAGE2_SYSTEM_PROMPT.includes(f), `${f} still present in STAGE2_SYSTEM_PROMPT`);
  }
});
