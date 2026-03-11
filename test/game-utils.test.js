/**
 * Unit tests for game-utils.js expiration logic
 * Run with: node --test test/game-utils.test.js
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { isGameExpired, getGameStatus } = require('../public/js/game-utils.js');

describe('isGameExpired', () => {
  it('returns false for future games', () => {
    // Game March 20, 2026 at 2pm Central - should be in future
    assert.strictEqual(
      isGameExpired('2026-03-20', '14:00', 90),
      false,
      'Future game should not be expired'
    );
  });

  it('returns false for games today that have not ended yet', () => {
    // Use a date far in future to ensure it's not expired
    assert.strictEqual(
      isGameExpired('2030-06-15', '18:00', 90),
      false,
      'Far future game should not be expired'
    );
  });

  it('returns true for past games', () => {
    // Game Jan 15, 2024 at 2pm - definitely in the past
    assert.strictEqual(
      isGameExpired('2024-01-15', '14:00', 90),
      true,
      'Past game should be expired'
    );
  });

  it('returns false when date is missing', () => {
    assert.strictEqual(isGameExpired('', '14:00', 90), false);
  });

  it('returns false when time is missing', () => {
    assert.strictEqual(isGameExpired('2026-03-20', '', 90), false);
  });
});

describe('getGameStatus', () => {
  it('returns active for future games', () => {
    const game = {
      date: '2026-03-20',
      time: '14:00',
      duration: 90,
      cancelled: false,
    };
    const status = getGameStatus(game);
    assert.strictEqual(status.type, 'active');
    assert.strictEqual(status.canJoin, true);
    assert.strictEqual(status.canEdit, true);
  });

  it('returns expired for past games', () => {
    const game = {
      date: '2024-01-15',
      time: '14:00',
      duration: 90,
      cancelled: false,
    };
    const status = getGameStatus(game);
    assert.strictEqual(status.type, 'expired');
    assert.strictEqual(status.canJoin, false);
    assert.strictEqual(status.canEdit, false);
  });

  it('returns cancelled when game is cancelled', () => {
    const game = {
      date: '2026-03-20',
      time: '14:00',
      duration: 90,
      cancelled: true,
    };
    const status = getGameStatus(game);
    assert.strictEqual(status.type, 'cancelled');
    assert.strictEqual(status.canJoin, false);
    assert.strictEqual(status.canEdit, false);
  });
});
