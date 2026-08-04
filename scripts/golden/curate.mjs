/**
 * Labels + snapshot → curated fixtures.
 *
 *   node scripts/golden/curate.mjs
 *
 * Reads  test/fixtures/golden-labels.json  (committed — human judgement)
 *        data/golden/candidates.json       (gitignored — scraped content)
 * Writes data/golden/fixtures.json         (gitignored — the two joined)
 *
 * Splitting it this way keeps the expensive part (labelling) in version control
 * without publishing third-party post text, captions, URLs or author handles
 * into a public repository.
 */
import fs from 'node:fs';
import path from 'node:path';
import { GOLDEN_CLASSES, checkClasses } from './lib.mjs';

const LABELS     = 'test/fixtures/golden-labels.json';
const CANDIDATES = 'data/golden/candidates.json';
const OUT        = 'data/golden/fixtures.json';

for (const f of [LABELS, CANDIDATES]) {
  if (!fs.existsSync(f)) {
    console.error(`Missing ${f}. Run scripts/golden/extract.mjs first.`);
    process.exit(1);
  }
}

const { labels } = JSON.parse(fs.readFileSync(LABELS, 'utf8'));
const buckets    = JSON.parse(fs.readFileSync(CANDIDATES, 'utf8'));

// Flatten every selection bucket into one id → trend index.
const byId = new Map();
for (const list of Object.values(buckets)) {
  for (const t of list) byId.set(String(t._dbId), t);
}

const fixtures = [];
const missing  = [];
const invalid  = [];

for (const [id, label] of Object.entries(labels)) {
  const trend = byId.get(id);
  if (!trend) { missing.push(id); continue; }

  const classes = Array.isArray(label.classes) ? label.classes : [];
  const bad = classes.filter(c => !GOLDEN_CLASSES.includes(c));
  if (classes.length === 0 || bad.length > 0) {
    invalid.push(`${id}: ${bad.length ? 'unknown ' + bad.join(',') : 'no classes'}`);
    continue;
  }
  // A contradictory pair (e.g. ai_slop + compilation) can never pass — catch it
  // at build time rather than letting it look like a model failure in a run.
  const probe = checkClasses(classes, 0);
  if (probe.conflict) { invalid.push(`${id}: ${probe.detail}`); continue; }

  fixtures.push({ ...trend, goldenClasses: classes, goldenNote: label.note || '' });
}

if (missing.length > 0) {
  console.warn(`⚠ ${missing.length} labelled id(s) not found in the snapshot: ${missing.join(', ')}`);
  console.warn('  (expected when labels reference trends added after the snapshot was pulled)');
}
if (invalid.length > 0) {
  console.error('✗ Invalid labels — fix golden-labels.json:');
  for (const line of invalid) console.error('   ' + line);
  process.exit(1);
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(fixtures, null, 2));

const perClass = {};
for (const f of fixtures) {
  for (const c of f.goldenClasses) {
    perClass[c] ||= { count: 0, minProd: 100, maxProd: 0 };
    const m = f.baseline.memePotential;
    perClass[c].count++;
    perClass[c].minProd = Math.min(perClass[c].minProd, m);
    perClass[c].maxProd = Math.max(perClass[c].maxProd, m);
  }
}

console.log(`\nWrote ${fixtures.length} fixtures → ${OUT}`);
console.table(perClass);
