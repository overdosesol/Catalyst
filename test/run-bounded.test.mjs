import { test } from 'node:test';
import assert from 'node:assert';
import { runBounded } from '../src/analysis/scorer.js';

test('runBounded preserves input order despite out-of-order completion', async () => {
  const items = [40, 10, 30, 20];
  const work = (ms, idx) => new Promise(r => setTimeout(() => r(idx), ms));
  const out = await runBounded(items, 2, work);
  assert.deepStrictEqual(out, [0, 1, 2, 3]);
});

test('runBounded caps concurrency', async () => {
  let active = 0, peak = 0;
  const work = () => new Promise(r => { active++; peak = Math.max(peak, active); setTimeout(() => { active--; r(1); }, 20); });
  await runBounded([1,2,3,4,5,6], 2, work);
  assert.ok(peak <= 2, `peak concurrency ${peak} must be <= 2`);
});
