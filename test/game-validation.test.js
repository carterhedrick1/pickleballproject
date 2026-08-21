// What a game request has to look like, and what createGameData / applyGameUpdate are
// therefore allowed to assume.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  validateGameCreate,
  validateGameUpdate,
  validateHostNotes,
  validateCancellationReason,
  TOTAL_PLAYERS_MAX,
  DURATION_MAX_MINUTES
} = require('../domain/game-validation');
const { createGameData } = require('../domain/game-factory');
const { applyGameUpdate } = require('../utils/game-update');

const VALID = {
  location: 'Grant Park',
  organizerName: 'Dana',
  organizerPhone: '(312) 555-0101',
  organizerPlaying: true,
  date: '2026-09-12',
  time: '18:30',
  duration: 90,
  playersNeeded: 3,
  message: 'Bring water',
  registrationMode: 'fcfs'
};

function refusal(body, validate = validateGameCreate) {
  try {
    validate(body);
  } catch (error) {
    assert.equal(error.code, 'REQUEST_VALIDATION', `expected a validation failure, got ${error}`);
    return error.message;
  }
  assert.fail('expected the request to be refused');
}

describe('validating a new game', () => {
  it('normalizes what the create form sends', () => {
    const game = validateGameCreate(VALID);
    assert.equal(game.location, 'Grant Park');
    assert.equal(game.date, '2026-09-12');
    assert.equal(game.time, '18:30');
    assert.equal(game.duration, 90);
    // 3 players besides an organizer who is playing.
    assert.equal(game.totalPlayers, 4);
    assert.equal(game.organizerPhone, '3125550101');
    assert.equal(game.hostPhone, '3125550101');
    assert.equal(game.registrationMode, 'fcfs');
    assert.equal(game.personalityId, 'realist');
  });

  it('hands the factory values it can no longer misread', () => {
    const game = createGameData(validateGameCreate({ ...VALID, duration: '90' }));
    assert.equal(game.duration, 90);
    assert.equal(game.totalPlayers, 4);
    assert.equal(game.players.length, 1);
    assert.equal(game.players[0].isOrganizer, true);
  });

  it('accepts the older totalPlayers shape as well as playersNeeded', () => {
    const { playersNeeded, ...withoutAdditional } = VALID;
    const game = validateGameCreate({ ...withoutAdditional, totalPlayers: 6 });
    assert.equal(game.totalPlayers, 6);
  });

  it('defaults the fields the form may leave out', () => {
    const { organizerName, message, registrationMode, organizerPhone, ...bare } = VALID;
    const game = validateGameCreate(bare);
    assert.equal(game.organizerName, 'Organizer');
    assert.equal(game.message, '');
    assert.equal(game.registrationMode, 'fcfs');
    assert.equal(game.organizerPhone, '');
    assert.equal(game.hostPhone, null);
  });

  it('refuses a duration that used to be stored as NaN', () => {
    assert.equal(refusal({ ...VALID, duration: 'soon' }), 'The duration in minutes must be a whole number.');
    assert.equal(refusal({ ...VALID, duration: '' }), 'The duration in minutes is required.');
    assert.equal(
      refusal({ ...VALID, duration: DURATION_MAX_MINUTES + 1 }),
      `The duration in minutes must be between 15 and ${DURATION_MAX_MINUTES}.`
    );
  });

  it('refuses a date or time nothing can schedule against', () => {
    assert.equal(refusal({ ...VALID, date: '2026-02-30' }), 'The game date is not a real date.');
    assert.equal(refusal({ ...VALID, date: 'next tuesday' }), 'The game date must be a date like 2026-08-21.');
    assert.equal(refusal({ ...VALID, time: '25:00' }), 'The start time must be a time like 18:30.');
    assert.equal(refusal({ ...VALID, date: undefined }), 'The game date is required.');
  });

  it('refuses a capacity that leaves nobody able to join', () => {
    assert.equal(
      refusal({ ...VALID, playersNeeded: -4 }),
      'The number of players needed must be between 0 and 99.'
    );
    assert.equal(
      refusal({ ...VALID, playersNeeded: 0, organizerPlaying: false }),
      'A game needs room for at least one player.'
    );
    const { playersNeeded, ...withoutAdditional } = VALID;
    assert.equal(
      refusal({ ...withoutAdditional, totalPlayers: TOTAL_PLAYERS_MAX + 1 }),
      `The player count must be between 1 and ${TOTAL_PLAYERS_MAX}.`
    );
    assert.equal(
      refusal({ ...withoutAdditional, totalPlayers: undefined }),
      'The player count is required.'
    );
  });

  it('refuses a registration mode nothing in the app understands', () => {
    assert.equal(
      refusal({ ...VALID, registrationMode: 'lottery' }),
      'The registration mode must be one of: fcfs, waitlist.'
    );
  });

  it('keeps the organizer phone wording a host reads on the form', () => {
    assert.equal(
      refusal({ ...VALID, organizerPhone: '312555' }),
      'Please enter a valid US phone number for the organizer.'
    );
    // The old route only checked hostPhone || organizerPhone, so a valid hostPhone let a
    // broken organizerPhone through and stored it.
    assert.equal(
      refusal({ ...VALID, organizerPhone: '312555', hostPhone: '3125550101' }),
      'Please enter a valid US phone number for the organizer.'
    );
  });

  it('refuses a body that is not an object at all', () => {
    assert.equal(refusal('a string'), 'The game must be a JSON object.');
    assert.equal(refusal(null), 'The game must be a JSON object.');
  });
});

describe('validating a game edit', () => {
  it('checks only the fields that were sent', () => {
    const update = validateGameUpdate({ location: '  New Court  ' });
    assert.equal(update.location, 'New Court');
    assert.equal('date' in update, false);
  });

  it('passes everything else through for the route and applyGameUpdate', () => {
    const update = validateGameUpdate({
      duration: '120',
      playersNeeded: '5',
      notifyPlayers: false,
      notificationPreferences: { gameFull: true }
    });
    assert.equal(update.duration, 120);
    assert.equal(update.playersNeeded, 5);
    assert.equal(update.notifyPlayers, false);
    assert.deepEqual(update.notificationPreferences, { gameFull: true });
  });

  it('stays compatible with what applyGameUpdate expects', () => {
    const game = { players: [], totalPlayers: 4, organizerPlaying: false };
    applyGameUpdate(game, validateGameUpdate({ playersNeeded: '5', organizerPlaying: true }));
    assert.equal(game.totalPlayers, 6);
    assert.equal(game.players.length, 1);
  });

  it('refuses the values the blanket assign used to write onto the game', () => {
    assert.equal(
      refusal({ duration: 'soon' }, validateGameUpdate),
      'The duration in minutes must be a whole number.'
    );
    assert.equal(
      refusal({ date: '2026-02-30' }, validateGameUpdate),
      'The game date is not a real date.'
    );
    assert.equal(
      refusal({ location: '   ' }, validateGameUpdate),
      'The court or location is required.'
    );
    assert.equal(
      refusal({ registrationMode: 'lottery' }, validateGameUpdate),
      'The registration mode must be one of: fcfs, waitlist.'
    );
    assert.equal(
      refusal({ notificationPreferences: 'yes please' }, validateGameUpdate),
      'The notification preferences must be a JSON object.'
    );
  });
});

describe('validating the free text a host writes', () => {
  it('keeps notes and a cancellation reason inside their bounds', () => {
    assert.equal(validateHostNotes('  gate code 4417  '), 'gate code 4417');
    assert.equal(validateHostNotes(null), '');
    assert.equal(validateCancellationReason(undefined), '');
    assert.equal(validateCancellationReason('  rain  '), 'rain');
  });

  it('refuses more than a person would type', () => {
    assert.equal(
      refusal('x'.repeat(5001), validateHostNotes),
      'Your notes can be up to 5000 characters.'
    );
    assert.equal(
      refusal('x'.repeat(501), validateCancellationReason),
      'The cancellation reason can be up to 500 characters.'
    );
  });
});
