/**
 * Unit tests for the shared host-token check.
 * Run with: npm test  (or: node --test test/host-auth.test.js)
 *
 * This check guards every host-only action - editing a game, removing a player, deleting a
 * photo - so the cases that must return false matter more than the one that returns true.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { isHost } = require('../utils/host-auth.js');

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
