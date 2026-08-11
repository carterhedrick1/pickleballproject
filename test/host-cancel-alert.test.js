const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { playerCancelledAlert } = require('../services/sms-webhook');

const base = {
  playerName: 'Frank',
  locationText: 'Oak Park Courts',
  gameDate: 'Fri, Aug 14',
  spotsLeft: 0,
  promotedName: null
};

describe('the host alert when a player cancels', () => {
  it('names the player who took the spot instead of reporting zero openings', () => {
    const message = playerCancelledAlert({ ...base, promotedName: 'Dana Reeves' });

    assert.match(message, /Frank cancelled their spot/);
    assert.match(message, /Dana Reeves moved up from the waitlist to take it/);
    assert.match(message, /still full/);
    // The contradiction that started this: a cancellation reported as no change at all.
    assert.doesNotMatch(message, /0 spots now available/);
  });

  it('still reports the openings when nobody was waiting', () => {
    assert.match(
      playerCancelledAlert({ ...base, spotsLeft: 1 }),
      /Frank cancelled their spot for your pickleball game at Oak Park Courts on Fri, Aug 14\. 1 spot now available\./
    );
    assert.match(playerCancelledAlert({ ...base, spotsLeft: 2 }), /2 spots now available\./);
  });

  it('reports both the replacement and the openings when a spot is still free', () => {
    // Possible when the host has raised the player count: the waitlist refills one seat and
    // leaves another empty, so the host needs both halves of the story.
    const message = playerCancelledAlert({ ...base, spotsLeft: 1, promotedName: 'Dana Reeves' });

    assert.match(message, /Dana Reeves moved up from the waitlist\./);
    assert.match(message, /1 spot now available\./);
  });

  it('never claims a full game when a spot really is open', () => {
    assert.doesNotMatch(
      playerCancelledAlert({ ...base, spotsLeft: 3, promotedName: 'Dana Reeves' }),
      /still full/
    );
  });
});
