import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import TrendDatabase from '../src/db/database.js';

const silentLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

// A real file, not :memory:, because the scenario under test is "an existing
// production database is reopened by freshly deployed code".
function withTempDb(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'catalyst-test-'));
  const dbPath = path.join(dir, 'catalyst.db');
  try {
    return fn(dbPath);
  } finally {
    // Best-effort: on Windows the WAL sidecars can still be held for a moment
    // after close(). A cleanup failure must never masquerade as a test failure.
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* temp dir, OS will reap it */ }
  }
}

test('reopening a database rewrites retired model ids to their replacement', () => {
  withTempDb(dbPath => {
    const before = new TrendDatabase(dbPath, silentLogger);
    before.setSetting('xaiModel', 'grok-4-1-fast-non-reasoning');
    before.db.close();

    const after = new TrendDatabase(dbPath, silentLogger);
    assert.equal(after.getSetting('xaiModel'), 'grok-4.3');
    after.db.close();
  });
});

test('a live model id is never rewritten', () => {
  withTempDb(dbPath => {
    const before = new TrendDatabase(dbPath, silentLogger);
    // Switching Stage 1 from 3.1 to 3.5 is the operator's call in the admin
    // panel — a deploy must not make that decision behind their back.
    before.setSetting('geminiModel', 'gemini-3.1-flash-lite');
    before.setSetting('openaiModel', 'gpt-4.1-mini');
    before.db.close();

    const after = new TrendDatabase(dbPath, silentLogger);
    assert.equal(after.getSetting('geminiModel'), 'gemini-3.1-flash-lite');
    assert.equal(after.getSetting('openaiModel'), 'gpt-4.1-mini');
    after.db.close();
  });
});

test('the rewrite is idempotent across restarts', () => {
  withTempDb(dbPath => {
    const first = new TrendDatabase(dbPath, silentLogger);
    first.setSetting('xaiModel', 'grok-4-1-fast-reasoning');
    first.db.close();

    const second = new TrendDatabase(dbPath, silentLogger);
    assert.equal(second.getSetting('xaiModel'), 'grok-4.3');
    second.db.close();

    const third = new TrendDatabase(dbPath, silentLogger);
    assert.equal(third.getSetting('xaiModel'), 'grok-4.3');
    third.db.close();
  });
});
