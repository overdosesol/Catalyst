/**
 * Snapshot → candidate buckets.
 *
 *   node scripts/golden/extract.mjs
 *
 * Reads  data/golden/catalyst-trends-snapshot.json
 * Writes data/golden/candidates.json  ({ <bucket>: [trend, ...] })
 *
 * Buckets are SELECTION buckets (see heuristicClass), not golden classes — the
 * operator assigns final labels by hand in data/golden/fixtures.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import { rowToTrend, heuristicClass } from './lib.mjs';

const SNAPSHOT = 'data/golden/catalyst-trends-snapshot.json';
const OUT      = 'data/golden/candidates.json';

if (!fs.existsSync(SNAPSHOT)) {
  console.error(`Snapshot not found: ${SNAPSHOT}`);
  console.error('Pull it from production first (see the Фаза 1 plan, «Предусловия»).');
  process.exit(1);
}

const rows = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
const buckets = {};

for (const row of rows) {
  const trend = rowToTrend(row);
  const bucket = heuristicClass(trend);
  (buckets[bucket] ||= []).push(trend);
}

// Highest production score first — the worst offenders are the interesting ones.
for (const list of Object.values(buckets)) {
  list.sort((a, b) => b.baseline.memePotential - a.baseline.memePotential);
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(buckets, null, 2));

console.log(`Read ${rows.length} rows → ${OUT}\n`);
console.table(
  Object.entries(buckets)
    .map(([bucket, list]) => ({
      bucket,
      count: list.length,
      topMeme: list[0]?.baseline.memePotential ?? '-',
      medianMeme: list.length
        ? list[Math.floor(list.length / 2)].baseline.memePotential
        : '-',
    }))
    .sort((a, b) => b.count - a.count)
);
