const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { applyGameUpdate } = require('../utils/game-update');

function savedGame() {
  return {
    location: 'Old Court',
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
      date: '2026-08-02',
      time: '19:00',
      duration: '120',
      totalPlayers: '8',
      message: 'New message',
      registrationMode: 'waitlist',
      personalityId: 'realist',
      notificationPreferences: {
        gameFull: false,
        playerJoins: false,
        playerCancels: false,
        oneSpotLeft: false,
        waitlistStarts: false
      }
    });

    assert.equal(game.location, 'New Court');
    assert.equal(game.date, '2026-08-02');
    assert.equal(game.time, '19:00');
    assert.equal(game.duration, '120');
    assert.equal(game.totalPlayers, '8');
    assert.equal(game.message, 'New message');
    assert.equal(game.registrationMode, 'waitlist');
    assert.equal(game.personalityId, 'realist');
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

  it('turns additional players needed into full capacity for a playing organizer', () => {
    const game = savedGame();
    game.organizerPlaying = true;

    applyGameUpdate(game, {
      playersNeeded: '3',
      totalPlayers: '99'
    });

    assert.equal(game.totalPlayers, 4);
  });

  it('uses the entered count directly when the organizer is not playing', () => {
    const game = savedGame();
    game.organizerPlaying = false;

    applyGameUpdate(game, { playersNeeded: '3' });

    assert.equal(game.totalPlayers, 3);
  });

  it('takes the organizer off the roster when they stop playing', () => {
    const game = savedGame();
    game.organizerPlaying = true;
    game.organizerName = 'Scott';
    game.players = [
      { id: 'organizer', name: 'Scott', isOrganizer: true },
      { id: 'p1', name: 'Alex' }
    ];

    applyGameUpdate(game, { organizerPlaying: false, playersNeeded: '3' });

    assert.equal(game.organizerPlaying, false);
    assert.deepEqual(game.players.map((player) => player.name), ['Alex']);
    // Three others wanted, and no seat held back for the host.
    assert.equal(game.totalPlayers, 3);
  });

  it('puts the organizer back on the roster when they start playing', () => {
    const game = savedGame();
    game.organizerPlaying = false;
    game.organizerName = 'Scott';
    game.organizerPhone = '5551234567';
    game.players = [{ id: 'p1', name: 'Alex' }];

    applyGameUpdate(game, { organizerPlaying: true, playersNeeded: '3' });

    const organizer = game.players.find((player) => player.isOrganizer);
    assert.equal(game.organizerPlaying, true);
    assert.equal(organizer.name, 'Scott');
    assert.equal(organizer.phone, '5551234567');
    assert.ok(organizer.joinedAt);
    assert.equal(game.totalPlayers, 4);
  });

  it('never lists the organizer twice, however many times it is saved', () => {
    const game = savedGame();
    game.organizerPlaying = true;
    game.players = [{ id: 'organizer', name: 'Scott', isOrganizer: true }];

    applyGameUpdate(game, { organizerPlaying: true });
    applyGameUpdate(game, { organizerPlaying: true });

    assert.equal(game.players.filter((player) => player.isOrganizer).length, 1);
  });

  it('leaves the roster alone when the flag is not being edited', () => {
    const game = savedGame();
    game.organizerPlaying = true;
    game.players = [{ id: 'organizer', name: 'Scott', isOrganizer: true }];

    applyGameUpdate(game, { location: 'New Court' });

    assert.equal(game.players.length, 1);
    assert.equal(game.organizerPlaying, true);
  });

  it('reads the flag as a real boolean rather than a checkbox string', () => {
    const game = savedGame();
    game.organizerPlaying = true;
    game.players = [{ id: 'organizer', name: 'Scott', isOrganizer: true }];

    applyGameUpdate(game, { organizerPlaying: 'false' });

    assert.equal(game.organizerPlaying, false);
    assert.deepEqual(game.players, []);
  });
});
