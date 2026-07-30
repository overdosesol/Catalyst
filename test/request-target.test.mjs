import test from 'node:test';
import assert from 'node:assert/strict';

import AdminServer from '../src/admin/server.js';
import DashboardServer from '../src/dashboard/server.js';

// The router is reached before any dependency is touched, so a bare prototype
// instance with a logger is all these cases need. Building a real server would
// drag in the database, Telegram and the scan callback for no added coverage.
function bareServer() {
  const server = Object.create(DashboardServer.prototype);
  server.warnings = [];
  server.errors = [];
  server.logger = {
    warn: msg => server.warnings.push(msg),
    error: msg => server.errors.push(msg),
    info: () => {},
    debug: () => {},
  };
  server.sseClients = new Set();
  return server;
}

function fakeRes() {
  const res = { statusCode: null, headers: null, body: '', ended: false };
  res.writeHead = (status, headers) => { res.statusCode = status; res.headers = headers; return res; };
  res.end = chunk => { if (chunk) res.body += String(chunk); res.ended = true; };
  return res;
}

test('router answers 400 to a malformed request target instead of throwing', async () => {
  for (const target of ['//', '/\\', 'http://h:99999/']) {
    const server = bareServer();
    const res = fakeRes();

    await server._handle({ url: target, method: 'GET', headers: {} }, res);

    assert.equal(res.statusCode, 400, `expected 400 for ${JSON.stringify(target)}`);
    assert.ok(res.ended, 'response must be ended, not left hanging');
  }
});

test('admin router answers 400 to a malformed request target', async () => {
  const server = Object.create(AdminServer.prototype);
  const warnings = [];
  server.logger = { warn: m => warnings.push(m), error: () => {}, info: () => {}, debug: () => {} };
  const res = fakeRes();

  // Prefixing a base by string concatenation, as the admin router used to,
  // survives `//` but still breaks on an out-of-range port.
  await server._handle({ url: 'http://h:99999/', method: 'GET', headers: {} }, res);

  assert.equal(res.statusCode, 400);
  assert.ok(res.ended, 'response must be ended, not left hanging');
});

test('a throwing router answers 500 instead of leaving the socket hanging', async () => {
  const server = bareServer();
  server.config = { enabled: true, port: 0, host: '127.0.0.1' };
  // Own property shadows the prototype method for this instance only.
  server._handle = async () => { throw new Error('router blew up'); };
  server.start();
  if (!server.server.listening) {
    await new Promise(resolve => server.server.once('listening', resolve));
  }

  const { port } = server.server.address();
  try {
    // Without the guard nothing ever answers, so the timeout is what turns a
    // hung socket into a readable failure instead of a stuck test run.
    const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
      signal: AbortSignal.timeout(3000),
    });
    assert.equal(response.status, 500);
    assert.ok(server.errors.some(m => /router blew up/.test(m)), 'the failure must be logged');
  } finally {
    await server.stop(200);
  }
});

test('router logs the rejected target, truncated and stripped of control characters', async () => {
  const server = bareServer();

  await server._handle({ url: '//\r\nInjected: header', method: 'GET', headers: {} }, fakeRes());
  assert.equal(server.warnings.length, 1);
  assert.doesNotMatch(server.warnings[0], /[\r\n]/, 'control characters must not reach the log');

  // `//%` starts an authority with broken percent-encoding, so the whole
  // thing stays unparseable however long the tail gets.
  const long = bareServer();
  await long._handle({ url: `//%${'a'.repeat(500)}`, method: 'GET', headers: {} }, fakeRes());
  assert.ok(long.warnings[0].length < 300, `log line ${long.warnings[0].length} chars, expected truncation`);
});
