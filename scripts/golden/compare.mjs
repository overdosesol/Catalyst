/**
 * Report a golden run against the acceptance bands, optionally diffing two runs.
 *
 *   node scripts/golden/compare.mjs data/golden/runs/baseline-<ts>.json
 *   node scripts/golden/compare.mjs <before.json> <after.json>
 *
 * Prints a per-fixture table plus a per-class breakdown. The per-class view is
 * not optional decoration: one overall percentage can hide a whole class
 * collapsing to zero while the average improves.
 */
import fs from 'node:fs';
import { checkClasses } from './lib.mjs';

const [aPath, bPath] = process.argv.slice(2);
if (!aPath) {
  console.error('usage: compare.mjs <run.json> [<run2.json>]');
  process.exit(1);
}

const load = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const runA = load(aPath);
const runB = bPath ? load(bPath) : null;
const mapB = runB ? new Map(runB.results.map(r => [r._dbId, r])) : null;

// Labels are read LIVE, not from the stored run. Relabelling a fixture (which
// happens whenever the owner recognises a case) must not require paying for a
// fresh model pass — the run holds raw scores, the labels hold judgement.
const LABELS_PATH = 'test/fixtures/golden-labels.json';
let liveLabels = {};
try { liveLabels = JSON.parse(fs.readFileSync(LABELS_PATH, 'utf8')).labels || {}; }
catch { console.warn(`⚠ could not read ${LABELS_PATH} — falling back to labels stored in the run`); }

const classesOf = r => liveLabels[String(r._dbId)]?.classes || r.goldenClasses || [];

const rows = [];
let passA = 0, passB = 0, unknown = 0, conflicts = 0;

for (const r of runA.results) {
  const cls = classesOf(r);
  const a = checkClasses(cls, r.memePotential);
  if (a.unknown)  unknown++;
  if (a.conflict) conflicts++;
  if (a.ok)       passA++;

  const row = {
    id:      r._dbId,
    class:   cls.join('+'),
    title:   String(r.title || '').slice(0, 34),
    prod:    r.baseline?.memePotential ?? '-',
    limit:   [a.min > -Infinity ? `>=${a.min}` : null, a.max < Infinity ? `<=${a.max}` : null].filter(Boolean).join(' '),
    A:       r.memePotential,
    ok:      a.ok ? 'ok' : 'MISS',
  };
  if (mapB) {
    const other = mapB.get(r._dbId);
    const b = other ? checkClasses(cls, other.memePotential) : { ok: false };
    if (b.ok) passB++;
    row.B     = other ? other.memePotential : '-';
    row.okB   = other ? (b.ok ? 'ok' : 'MISS') : '?';
    row.delta = other ? other.memePotential - r.memePotential : '-';
  }
  rows.push(row);
}

rows.sort((x, y) => String(x.class).localeCompare(String(y.class)) || x.id - y.id);
console.table(rows);

const total = runA.results.length;
if (unknown)   console.log(`⚠ ${unknown} фикстур с классом вне BANDS — набор бракован.`);
if (conflicts) console.log(`⚠ ${conflicts} фикстур с противоречивыми метками — чинить golden-labels.json.`);

console.log(`\n${runA.label}: ${passA}/${total} в полосе (${Math.round(passA / total * 100)}%)`);
if (runB) {
  console.log(`${runB.label}: ${passB}/${total} в полосе (${Math.round(passB / total * 100)}%)`);
  const d = passB - passA;
  console.log(`Δ: ${d >= 0 ? '+' : ''}${d} кейсов`);
}

const perClass = {};
for (const r of runA.results) {
  const cls = classesOf(r);
  for (const c of cls) {
    perClass[c] ||= { total: 0, pass: 0, worst: null };
    perClass[c].total++;
    const res = checkClasses(cls, r.memePotential);
    if (res.ok) perClass[c].pass++;
    else if (perClass[c].worst === null || r.memePotential > perClass[c].worst) {
      perClass[c].worst = r.memePotential;
    }
  }
}
console.log('\nПо классам (worst = худший промах по скору):');
console.table(perClass);
