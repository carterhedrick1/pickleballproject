const { test } = require('node:test');
const assert = require('node:assert');

const { createDatabaseGate } = require('../utils/database-gate');

function runGate(gate) {
  return new Promise((resolve) => {
    gate({}, {}, (err) => resolve(err));
  });
}

test('passes requests through once initialization succeeds', async () => {
  const gate = createDatabaseGate(() => Promise.resolve());
  assert.strictEqual(await runGate(gate), undefined);
  assert.strictEqual(await runGate(gate), undefined);
});

test('a failed boot attempt is retried, not replayed forever', async () => {
  let attempts = 0;
  const gate = createDatabaseGate(() => {
    attempts += 1;
    return attempts === 1
      ? Promise.reject(new Error('boot-time hiccup'))
      : Promise.resolve();
  });

  // The boot attempt failed, but the first request triggers a retry and goes through.
  assert.strictEqual(await runGate(gate), undefined);
  assert.strictEqual(attempts, 2);

  // Later requests reuse the successful attempt instead of re-initializing.
  assert.strictEqual(await runGate(gate), undefined);
  assert.strictEqual(attempts, 2);
});

test('concurrent requests share one retry instead of stampeding', async () => {
  let attempts = 0;
  let releaseRetry;
  const gate = createDatabaseGate(() => {
    attempts += 1;
    if (attempts === 1) return Promise.reject(new Error('boot-time hiccup'));
    return new Promise((resolve) => { releaseRetry = resolve; });
  });

  // Both requests arrive while initialization is broken.
  const first = runGate(gate);
  const second = runGate(gate);
  await new Promise((r) => setImmediate(r));
  releaseRetry();

  assert.strictEqual(await first, undefined);
  assert.strictEqual(await second, undefined);
  assert.strictEqual(attempts, 2); // boot + one shared retry
});

test('requests fail with the real error while the database stays down', async () => {
  let attempts = 0;
  const gate = createDatabaseGate(() => {
    attempts += 1;
    return Promise.reject(new Error(`down ${attempts}`));
  });

  const err = await runGate(gate);
  assert.match(err.message, /down/);
  // Each new request tries again rather than giving up permanently.
  await runGate(gate);
  assert.ok(attempts >= 2);
});
