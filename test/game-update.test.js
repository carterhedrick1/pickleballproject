const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { applyGameUpdate } = require('../utils/game-update');

function savedGame() {
  return {
    location: 'Old Court',
    courtNumber: '1',
    date: '2026-08-01',
    time: '18:00',
    duration: 90,
    totalPlayers: 4,
    message: 'Old message',
    registrationMode: 'fcfs',
    notificationPreferences: {
      gameFull: true,
      playerJoins: true,
      playerCancels: true,
      oneSpotLeft: true,
      waitlistStarts: true
    },
    hostToken: 'secret',
    hostPhone: '5551234567',
    players: [{ id: 'p1', name: 'Alex' }],
    waitlist: [],
    cancelled: false,
    created: '2026-07-01T00:00:00.000Z'
  };
}

describe('applyGameUpdate', () => {
  it('updates every supported host-editable field', () => {
    const game = savedGame();

    applyGameUpdate(game, {
      location: 'New Court',
      courtNumber: '2',
      date: '2026-08-02',
      time: '19:00',
      duration: '120',
      totalPlayers: '8',
      message: 'New message',
      registrationMode: 'waitlist',
      notificationPreferences: {
        gameFull: false,
        playerJoins: false,
        playerCancels: false,
        oneSpotLeft: false,
        waitlistStarts: false
      }
    });

    assert.equal(game.location, 'New Court');
    assert.equal(game.courtNumber, '2');
    assert.equal(game.date, '2026-08-02');
    assert.equal(game.time, '19:00');
    assert.equal(game.duration, '120');
    assert.equal(game.totalPlayers, '8');
    assert.equal(game.message, 'New message');
    assert.equal(game.registrationMode, 'waitlist');
    assert.deepEqual(game.notificationPreferences, {
      gameFull: false,
      playerJoins: false,
      playerCancels: false,
      oneSpotLeft: false,
      waitlistStarts: false
    });
  });

  it('ignores protected and unknown fields', () => {
    const game = savedGame();
    const originalPlayers = game.players;

    applyGameUpdate(game, {
      hostToken: 'attacker-token',
      hostPhone: '0000000000',
      players: [],
      waitlist: [{ id: 'w1' }],
      cancelled: true,
      cancelledAt: 'now',
      created: 'replaced',
      arbitrary: 'value'
    });

    assert.equal(game.hostToken, 'secret');
    assert.equal(game.hostPhone, '5551234567');
    assert.equal(game.players, originalPlayers);
    assert.deepEqual(game.waitlist, []);
    assert.equal(game.cancelled, false);
    assert.equal(game.cancelledAt, undefined);
    assert.equal(game.created, '2026-07-01T00:00:00.000Z');
    assert.equal(game.arbitrary, undefined);
  });

  it('preserves omitted notification preferences and coerces supplied values to booleans', () => {
    const game = savedGame();

    applyGameUpdate(game, {
      notificationPreferences: {
        playerJoins: false,
        gameFull: 'true',
        unknownPreference: true
      }
    });

    assert.deepEqual(game.notificationPreferences, {
      gameFull: false,
      playerJoins: false,
      playerCancels: true,
      oneSpotLeft: true,
      waitlistStarts: true
    });
  });
});
