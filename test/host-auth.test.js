/**
 * Unit tests for the shared host-token check.
 * Run with: npm test  (or: node --test test/host-auth.test.js)
 *
 * This check guards every host-only action - editing a game, removing a player, deleting a
 * photo - so the cases that must return false matter more than the one that returns true.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { isHost, requestHostToken, redactTokenInUrl } = require('../utils/host-auth.js');

const TOKEN = 'a'.repeat(64);
const game = { hostToken: TOKEN };

describe('isHost', () => {
  it('accepts the matching token', () => {
    assert.strictEqual(isHost(game, TOKEN), true);
  });

  it('rejects a different token', () => {
    assert.strictEqual(isHost(game, 'b'.repeat(64)), false);
  });

  it('rejects a missing token', () => {
    assert.strictEqual(isHost(game, undefined), false);
    assert.strictEqual(isHost(game, null), false);
    assert.strictEqual(isHost(game, ''), false);
  });

  it('rejects a missing game', () => {
    assert.strictEqual(isHost(null, TOKEN), false);
    assert.strictEqual(isHost(undefined, TOKEN), false);
  });

  // The reason the guarded spelling was chosen over the bare `game.hostToken !== token`.
  // These cannot happen while host_token is NOT NULL, but the check should not depend on
  // that staying true somewhere else in the codebase.
  it('rejects when neither side has a token', () => {
    assert.strictEqual(isHost({ hostToken: undefined }, undefined), false);
    assert.strictEqual(isHost({ hostToken: null }, null), false);
    assert.strictEqual(isHost({ hostToken: '' }, ''), false);
  });

  it('does not accept a token that only loosely matches', () => {
    assert.strictEqual(isHost({ hostToken: '0' }, 0), false);
    assert.strictEqual(isHost({ hostToken: '1' }, true), false);
  });
});

describe('requestHostToken', () => {
  const req = ({ headers = {}, body, query } = {}) => ({ headers, body, query });

  it('prefers the X-Host-Token header, the intended transport', () => {
    assert.strictEqual(
      requestHostToken(req({
        headers: { 'x-host-token': 'header-token', authorization: 'Bearer bearer-token' },
        body: { token: 'body-token' },
        query: { token: 'query-token' }
      })),
      'header-token'
    );
  });

  it('accepts Authorization: Bearer for curl and tests', () => {
    assert.strictEqual(
      requestHostToken(req({ headers: { authorization: 'Bearer bearer-token' } })),
      'bearer-token'
    );
  });

  it('still accepts the historical body and query transports', () => {
    assert.strictEqual(requestHostToken(req({ body: { token: 'body-token' } })), 'body-token');
    assert.strictEqual(requestHostToken(req({ query: { token: 'query-token' } })), 'query-token');
  });

  it('prefers the body over the query when both are present', () => {
    assert.strictEqual(
      requestHostToken(req({ body: { token: 'body-token' }, query: { token: 'query-token' } })),
      'body-token'
    );
  });

  it('returns an empty string for a request carrying no token anywhere', () => {
    assert.strictEqual(requestHostToken(req()), '');
    assert.strictEqual(requestHostToken(req({ body: {}, query: {} })), '');
  });

  it('ignores non-string token shapes rather than coercing them', () => {
    assert.strictEqual(requestHostToken(req({ body: { token: 123 }, query: { token: ['a', 'b'] } })), '');
  });
});

describe('redactTokenInUrl', () => {
  it('masks a token in the query string, wherever it sits', () => {
    assert.strictEqual(
      redactTokenInUrl('/api/games/g1?token=secret123'),
      '/api/games/g1?token=[redacted]'
    );
    assert.strictEqual(
      redactTokenInUrl('/manage.html?id=g1&token=secret123&tab=Invite'),
      '/manage.html?id=g1&token=[redacted]&tab=Invite'
    );
  });

  it('leaves token-less URLs untouched', () => {
    assert.strictEqual(redactTokenInUrl('/api/games/g1?ticket=abc'), '/api/games/g1?ticket=abc');
    assert.strictEqual(redactTokenInUrl('/api/health'), '/api/health');
  });
});
