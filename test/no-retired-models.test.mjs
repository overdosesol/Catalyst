import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { MODELS } from '../src/analysis/model-registry.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// The registry is the one place allowed to name a retired model: it has to
// know the id to flag it and to point at the replacement.
const ALLOWED = new Set([path.join('src', 'analysis', 'model-registry.js')]);

const RETIRED_IDS = Object.values(MODELS)
  .filter(m => m.status === 'retired')
  .map(m => m.id);

function collectSourceFiles(dir, found = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectSourceFiles(full, found);
    else if (entry.name.endsWith('.js')) found.push(full);
  }
  return found;
}

test('no retired model id is used anywhere in src/', () => {
  assert.ok(RETIRED_IDS.length > 0, 'registry lists no retired models — the guard would be vacuous');

  const offenders = [];
  for (const file of collectSourceFiles(path.join(repoRoot, 'src'))) {
    const relative = path.relative(repoRoot, file);
    if (ALLOWED.has(relative)) continue;

    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, index) => {
      // A retired id named in prose — a comment explaining what went away and
      // what replaced it — is documentation, and this repo writes such ids in
      // backticks. Skip comment lines so the guard flags real usage only.
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;

      for (const id of RETIRED_IDS) {
        if (new RegExp(`['"\`]${id.replace(/\./g, '\\.')}['"\`]`).test(line)) {
          offenders.push(`${relative}:${index + 1} → ${id}`);
        }
      }
    });
  }

  assert.deepEqual(offenders, [], `retired model ids still in use:\n  ${offenders.join('\n  ')}`);
});

test('no retired model id is offered in .env.example', () => {
  const file = path.join(repoRoot, '.env.example');
  const offenders = [];

  fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, index) => {
    // Assignments only: `XAI_MODEL=grok-...`. Commented-out lines and prose
    // are how the file explains what changed and why.
    const assignment = /^\s*([A-Z0-9_]+)\s*=\s*(\S+)/.exec(line);
    if (!assignment) return;
    if (RETIRED_IDS.includes(assignment[2])) {
      offenders.push(`.env.example:${index + 1} → ${assignment[1]}=${assignment[2]}`);
    }
  });

  assert.deepEqual(offenders, [], `retired model ids still configured:\n  ${offenders.join('\n  ')}`);
});
