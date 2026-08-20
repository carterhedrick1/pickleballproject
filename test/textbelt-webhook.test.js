const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  computeSignature,
  verifyTextbeltSignature,
  requireTextbeltSignature,
  MAX_TIMESTAMP_AGE_SECONDS
} = require('../utils/textbelt-webhook');

const SECRET = 'test-textbelt-key';
const NOW_MS = 1_760_000_000_000; // fixed clock so freshness checks are deterministic

function signedRequest(body, { secret = SECRET, ageSeconds = 0, tamper } = {}) {
  const rawBody = JSON.stringify(body);
  const timestamp = String(Math.floor(NOW_MS / 1000) - ageSeconds);
  const signature = computeSignature(secret, timestamp, rawBody);
  return {
    signature: tamper ? tamper(signature) : signature,
    timestamp,
    rawBody
  };
}

describe('verifyTextbeltSignature', () => {
  it('accepts a fresh, correctly signed payload', () => {
    const req = signedRequest({ fromNumber: '5551234567', text: '9', data: 'g1' });
    const result = verifyTextbeltSignature({ secret: SECRET, ...req, nowMs: NOW_MS });
    assert.deepEqual(result, { ok: true });
  });

  it('accepts a Buffer raw body, since express hands the bytes over as one', () => {
    const rawBody = Buffer.from(JSON.stringify({ fromNumber: '5551234567', text: '1' }));
    const timestamp = String(Math.floor(NOW_MS / 1000));
    const signature = computeSignature(SECRET, timestamp, rawBody);
    const result = verifyTextbeltSignature({ secret: SECRET, signature, timestamp, rawBody, nowMs: NOW_MS });
    assert.equal(result.ok, true);
  });

  it('rejects a signature made with the wrong key', () => {
    const req = signedRequest({ fromNumber: '5551234567', text: '9' }, { secret: 'attacker-key' });
    const result = verifyTextbeltSignature({ secret: SECRET, ...req, nowMs: NOW_MS });
    assert.deepEqual(result, { ok: false, reason: 'bad-signature' });
  });

  it('rejects a tampered signature of the right length', () => {
    const req = signedRequest({ fromNumber: '5551234567', text: '9' }, {
      tamper: (sig) => (sig[0] === 'a' ? 'b' : 'a') + sig.slice(1)
    });
    const result = verifyTextbeltSignature({ secret: SECRET, ...req, nowMs: NOW_MS });
    assert.deepEqual(result, { ok: false, reason: 'bad-signature' });
  });

  it('rejects a body altered after signing', () => {
    const req = signedRequest({ fromNumber: '5551234567', text: '1' });
    const forged = JSON.stringify({ fromNumber: '5551234567', text: '9' });
    const result = verifyTextbeltSignature({ secret: SECRET, ...req, rawBody: forged, nowMs: NOW_MS });
    assert.deepEqual(result, { ok: false, reason: 'bad-signature' });
  });

  it('rejects missing headers', () => {
    const { rawBody } = signedRequest({ text: '9' });
    assert.deepEqual(
      verifyTextbeltSignature({ secret: SECRET, signature: undefined, timestamp: undefined, rawBody, nowMs: NOW_MS }),
      { ok: false, reason: 'missing-headers' }
    );
  });

  it('rejects a malformed timestamp', () => {
    const req = signedRequest({ text: '9' });
    const result = verifyTextbeltSignature({ secret: SECRET, ...req, timestamp: 'not-a-number', nowMs: NOW_MS });
    assert.deepEqual(result, { ok: false, reason: 'malformed-timestamp' });
  });

  it('rejects a stale timestamp, even correctly signed', () => {
    const req = signedRequest({ text: '9' }, { ageSeconds: MAX_TIMESTAMP_AGE_SECONDS + 1 });
    const result = verifyTextbeltSignature({ secret: SECRET, ...req, nowMs: NOW_MS });
    assert.deepEqual(result, { ok: false, reason: 'stale-timestamp' });
  });

  it('rejects a timestamp too far in the future', () => {
    const req = signedRequest({ text: '9' }, { ageSeconds: -(MAX_TIMESTAMP_AGE_SECONDS + 1) });
    const result = verifyTextbeltSignature({ secret: SECRET, ...req, nowMs: NOW_MS });
    assert.deepEqual(result, { ok: false, reason: 'stale-timestamp' });
  });

  it('accepts a timestamp just inside the freshness window', () => {
    const req = signedRequest({ text: '9' }, { ageSeconds: MAX_TIMESTAMP_AGE_SECONDS - 1 });
    const result = verifyTextbeltSignature({ secret: SECRET, ...req, nowMs: NOW_MS });
    assert.equal(result.ok, true);
  });

  it('rejects an empty body', () => {
    const timestamp = String(Math.floor(NOW_MS / 1000));
    const signature = computeSignature(SECRET, timestamp, '');
    const result = verifyTextbeltSignature({ secret: SECRET, signature, timestamp, rawBody: '', nowMs: NOW_MS });
    assert.deepEqual(result, { ok: false, reason: 'missing-body' });
  });

  it('rejects everything when no secret is configured', () => {
    const req = signedRequest({ text: '9' });
    const result = verifyTextbeltSignature({ secret: '', ...req, nowMs: NOW_MS });
    assert.deepEqual(result, { ok: false, reason: 'no-secret-configured' });
  });

  it('still verifies an identical replayed request inside the window (documented limitation)', () => {
    const req = signedRequest({ fromNumber: '5551234567', text: '9' });
    assert.equal(verifyTextbeltSignature({ secret: SECRET, ...req, nowMs: NOW_MS }).ok, true);
    assert.equal(verifyTextbeltSignature({ secret: SECRET, ...req, nowMs: NOW_MS + 60_000 }).ok, true);
  });
});

describe('requireTextbeltSignature middleware', () => {
  function run(middleware, { headers = {}, rawBody } = {}) {
    const req = { headers, rawBody };
    let statusCode = null;
    let jsonBody = null;
    let nexted = false;
    const res = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(body) {
        jsonBody = body;
        return this;
      }
    };
    middleware(req, res, () => {
      nexted = true;
    });
    return { statusCode, jsonBody, nexted };
  }

  function signedHeaders(body, secret = SECRET) {
    const rawBody = Buffer.from(JSON.stringify(body));
    const timestamp = String(Math.floor(Date.now() / 1000));
    return {
      rawBody,
      headers: {
        'x-textbelt-timestamp': timestamp,
        'x-textbelt-signature': computeSignature(secret, timestamp, rawBody)
      }
    };
  }

  it('passes a correctly signed request through', () => {
    const middleware = requireTextbeltSignature({ secret: SECRET, isProduction: false });
    const { headers, rawBody } = signedHeaders({ fromNumber: '5551234567', text: '2' });
    const result = run(middleware, { headers, rawBody });
    assert.equal(result.nexted, true);
    assert.equal(result.statusCode, null);
  });

  it('rejects an unsigned request with 401 when a key is configured', () => {
    const middleware = requireTextbeltSignature({ secret: SECRET, isProduction: false });
    const result = run(middleware, { rawBody: Buffer.from('{}') });
    assert.equal(result.nexted, false);
    assert.equal(result.statusCode, 401);
  });

  it('rejects a badly signed request with 401', () => {
    const middleware = requireTextbeltSignature({ secret: SECRET, isProduction: false });
    const { headers, rawBody } = signedHeaders({ text: '9' }, 'wrong-key');
    const result = run(middleware, { headers, rawBody });
    assert.equal(result.statusCode, 401);
  });

  it('lets unsigned requests through only when keyless AND not production', () => {
    const middleware = requireTextbeltSignature({ secret: '', isProduction: false });
    const result = run(middleware, { rawBody: Buffer.from('{}') });
    assert.equal(result.nexted, true);
  });

  it('rejects unsigned requests when keyless in production', () => {
    const middleware = requireTextbeltSignature({ secret: '', isProduction: true });
    const result = run(middleware, { rawBody: Buffer.from('{}') });
    assert.equal(result.nexted, false);
    assert.equal(result.statusCode, 401);
  });
});
