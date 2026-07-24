/**
 * Unit tests for game-utils.js expiration logic
 * Run with: npm test  (or: node --test test/game-utils.test.js)
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { isGameExpired, getGameStatus } = require('../public/js/game-utils.js');

// These fixtures used to hardcode calendar dates, which quietly rotted into the
// past and failed the "future game" tests. Derive them from today instead.
function daysFromToday(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const NEXT_MONTH = daysFromToday(30);
const NEXT_YEAR = daysFromToday(365);

describe('isGameExpired', () => {
  it('returns false for future games', () => {
    assert.strictEqual(
      isGameExpired(NEXT_MONTH, '14:00', 90),
      false,
      'Future game should not be expired'
    );
  });

  it('returns false for games far in the future', () => {
    assert.strictEqual(
      isGameExpired(NEXT_YEAR, '18:00', 90),
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
    assert.strictEqual(isGameExpired(NEXT_MONTH, '', 90), false);
  });
});

describe('getGameStatus', () => {
  it('returns active for future games', () => {
    const game = {
      date: NEXT_MONTH,
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
      date: NEXT_MONTH,
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
