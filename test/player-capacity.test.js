const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const PlayerCapacity = require('../public/js/player-capacity');

describe('PlayerCapacity', () => {
  it('adds the organizer seat when the organizer is playing', () => {
    assert.equal(PlayerCapacity.totalFromAdditional(3, true), 4);
    assert.equal(PlayerCapacity.totalFromAdditional('3', true), 4);
  });

  it('does not add a seat when the organizer is only hosting', () => {
    assert.equal(PlayerCapacity.totalFromAdditional(3, false), 3);
  });

  it('converts stored capacity back to the host-facing additional count', () => {
    assert.equal(PlayerCapacity.additionalFromTotal(4, true), 3);
    assert.equal(PlayerCapacity.additionalFromTotal(4, false), 4);
  });
});
