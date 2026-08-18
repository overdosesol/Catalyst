import test from 'node:test';
import assert from 'node:assert/strict';

import BaseCollector from '../src/collectors/base-collector.js';
import { sourceHealth } from '../src/notifications/source-health.js';

const silentLogger = { info() {}, warn() {}, debug() {}, error() {} };

class FakeCollector extends BaseCollector {
  constructor(behaviour) {
    super('Twitter', silentLogger);
    this.behaviour = behaviour;
  }
  async collect() {
    return this.behaviour(this);
  }
}

const runCycles = async (collector, n) => {
  for (let i = 0; i < n; i++) await collector.safeCollect();
};

test.beforeEach(() => sourceHealth.reset());

test('swallowed sub-failures reach the tracker', async () => {
  // The shape of the real bug: collect() succeeds, returns nothing, and the
  // per-query failures are invisible to the caller.
  const c = new FakeCollector((self) => {
    self.noteFailure(new Error('Apify 400: Max Items must be at least 20'));
    self.noteFailure(new Error('Apify 400: Max Items must be at least 20'));
    return [];
  });

  await runCycles(c, 4);
  const s = sourceHealth.snapshot().twitter;
  assert.equal(s.failStreak, 4);
  assert.equal(s.active, 'down', 'four failing cycles must raise the flag');
  assert.match(s.lastError, /Max Items/);
});

test('the failure counter resets between cycles', async () => {
  const c = new FakeCollector((self) => {
    self.noteFailure(new Error('boom'));
    return [{ id: 1 }];
  });
  await c.safeCollect();
  assert.equal(c._cycleFailures, 1);
  await c.safeCollect();
  assert.equal(c._cycleFailures, 1, 'counted per cycle, not cumulative');
});

test('a collector that throws outright counts as a failing cycle', async () => {
  const c = new FakeCollector(() => { throw new Error('network down'); });
  await runCycles(c, 4);
  const s = sourceHealth.snapshot().twitter;
  assert.equal(s.active, 'down');
  assert.match(s.lastError, /network down/);
});

test('a healthy cycle clears the streak', async () => {
  const flaky = { fail: true };
  const c = new FakeCollector((self) => {
    if (flaky.fail) { self.noteFailure(new Error('boom')); return []; }
    return [{ id: 1 }, { id: 2 }];
  });
  await runCycles(c, 3);
  flaky.fail = false;
  await c.safeCollect();
  assert.equal(sourceHealth.snapshot().twitter.failStreak, 0);
  assert.equal(sourceHealth.snapshot().twitter.active, null);
});

test('a skipped cycle leaves no trace', async () => {
  const c = new FakeCollector((self) => { self.noteSkipped(); return []; });
  await runCycles(c, 30);
  const s = sourceHealth.snapshot().twitter;
  assert.equal(s.emptyStreak, 0);
  assert.equal(s.failStreak, 0);
  assert.equal(s.active, null);
});

test('health bookkeeping can never break a collection cycle', async () => {
  const c = new FakeCollector(() => [{ id: 1 }]);
  const original = sourceHealth.record;
  sourceHealth.record = () => { throw new Error('tracker exploded'); };
  try {
    const items = await c.safeCollect();
    assert.equal(items.length, 1, 'the cycle still returns its items');
  } finally {
    sourceHealth.record = original;
  }
});

test('safeCollect still returns [] on failure, as every caller assumes', async () => {
  const c = new FakeCollector(() => { throw new Error('nope'); });
  assert.deepEqual(await c.safeCollect(), []);
});
