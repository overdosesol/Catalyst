import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import TrendDatabase from '../src/db/database.js';

const DAY_MS = 24 * 3600_000;
const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };

/**
 * Fresh on-disk DB per test — better-sqlite3 needs a real path (the ctor
 * mkdir's the parent), and WAL mode is not worth faking for a few rows.
 */
function withDb(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'catalyst-auth-'));
  const db = new TrendDatabase(path.join(dir, 'test.db'), silentLogger);
  try {
    return fn(db);
  } finally {
    try { db.db.close(); } catch { /* already closed */ }
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Drive the real login flow: initiate → bot attaches code → verify. */
function login(db, chatId = '424242') {
  db.getOrCreateUser(chatId, 'operator');
  const sessionId = db.createAuthSession('node-test');
  const { code } = db.attachAuthCode(sessionId, chatId);
  const verified = db.verifyAuthCode(sessionId, code);
  assert.ok(verified, 'verifyAuthCode should accept the code the bot just issued');
  return { sessionId, token: verified.token, tokenExpiresAt: verified.tokenExpiresAt };
}

/** Rewrite a verified session's expiry to simulate the passage of time. */
function setExpiry(db, sessionId, msFromNow) {
  db.db.prepare(`UPDATE auth_sessions SET token_expires_at = ? WHERE session_id = ?`)
    .run(new Date(Date.now() + msFromNow).toISOString(), sessionId);
}

function expiryOf(db, sessionId) {
  const row = db.db.prepare(`SELECT token_expires_at FROM auth_sessions WHERE session_id = ?`)
    .get(sessionId);
  return new Date(row.token_expires_at).getTime();
}

test('a fresh login issues a token that resolves back to its user', () => {
  withDb(db => {
    const { token } = login(db);
    const user = db.getUserByAuthToken(token);
    assert.ok(user, 'the token issued by verifyAuthCode must resolve');
    assert.equal(user.telegram_chat_id, '424242');
  });
});

test('a fresh login lasts 30 days', () => {
  withDb(db => {
    const { tokenExpiresAt } = login(db);
    const days = (new Date(tokenExpiresAt).getTime() - Date.now()) / DAY_MS;
    assert.ok(Math.abs(days - 30) < 0.01, `expected ~30 days, got ${days}`);
  });
});

test('using a nearly-expired token slides its expiry back out to 30 days', () => {
  withDb(db => {
    const { sessionId, token } = login(db);
    setExpiry(db, sessionId, 3 * DAY_MS);

    assert.ok(db.getUserByAuthToken(token), 'a token with 3 days left is still valid');

    const days = (expiryOf(db, sessionId) - Date.now()) / DAY_MS;
    assert.ok(days > 29.9, `expected renewal to ~30 days, got ${days}`);
  });
});

test('a token with plenty of life left is not rewritten on every request', () => {
  // Guards the write-rate bound: renewal only fires below the threshold, so
  // ordinary API traffic must not turn each authenticated call into an UPDATE.
  withDb(db => {
    const { sessionId, token } = login(db);
    const before = expiryOf(db, sessionId);

    for (let i = 0; i < 5; i++) assert.ok(db.getUserByAuthToken(token));

    assert.equal(expiryOf(db, sessionId), before, 'expiry should be untouched above the threshold');
  });
});

test('an expired token is rejected and not resurrected by renewal', () => {
  withDb(db => {
    const { sessionId, token } = login(db);
    setExpiry(db, sessionId, -DAY_MS);

    assert.equal(db.getUserByAuthToken(token), null, 'an expired token must not authenticate');

    const remaining = expiryOf(db, sessionId) - Date.now();
    assert.ok(remaining < 0, 'renewal must not run for an already-expired token');
  });
});

test('logout revokes the token immediately', () => {
  withDb(db => {
    const { token } = login(db);
    assert.equal(db.revokeAuthToken(token), 1);
    assert.equal(db.getUserByAuthToken(token), null);
  });
});

test('the daily prune keeps verified sessions and drops abandoned ones', () => {
  // Regression guard: verified rows store the hash in token_hash and leave
  // token NULL, so a prune that only checked `token IS NULL` would log every
  // signed-in user out within a day.
  withDb(db => {
    const { sessionId, token } = login(db);
    const abandoned = db.createAuthSession('never-verified');
    db.db.prepare(`UPDATE auth_sessions SET created_at = datetime('now', '-48 hours')`).run();

    assert.equal(db.pruneAuthSessions(24), 1, 'only the unverified session should be pruned');
    assert.ok(db.getUserByAuthToken(token), 'a verified session must survive the prune');
    assert.equal(db.getAuthSessionStatus(sessionId).verified, true);
    assert.equal(db.getAuthSessionStatus(abandoned).exists, false);
  });
});

test('the plaintext token column stays empty — only the hash is stored', () => {
  withDb(db => {
    const { sessionId, token } = login(db);
    const row = db.db.prepare(`SELECT token, token_hash FROM auth_sessions WHERE session_id = ?`)
      .get(sessionId);
    assert.equal(row.token, null, 'plaintext bearer token must never be persisted');
    assert.ok(row.token_hash && row.token_hash !== token);
  });
});
