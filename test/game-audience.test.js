const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { findOnGame, textableAudience } = require('../utils/game-audience');

function game(overrides = {}) {
  return {
    players: [
      { id: 'host', name: 'Host', phone: '5555559100', isOrganizer: true },
      { id: 'one', name: 'One', phone: '5555559101' }
    ],
    waitlist: [{ id: 'two', name: 'Two', phone: '5555559102' }],
    outPlayers: [{ id: 'three', name: 'Three', phone: '5555559103' }],
    ...overrides
  };
}

describe('game audience', () => {
  it('places a phone number in the list it actually belongs to', () => {
    const value = game();

    assert.equal(findOnGame(value, '5555559101').type, 'confirmed');
    assert.equal(findOnGame(value, '5555559102').type, 'waitlist');
    assert.equal(findOnGame(value, '5555559103').type, 'out');
    assert.equal(findOnGame(value, '5555559100').isOrganizer, true);
  });

  it('matches numbers however they were typed', () => {
    const value = game();

    assert.equal(findOnGame(value, '(555) 555-9101').type, 'confirmed');
    assert.equal(findOnGame(value, '15555559101').type, 'confirmed');
  });

  it('refuses a number that is not on the game', () => {
    assert.equal(findOnGame(game(), '5555559999'), null);
    assert.equal(findOnGame(game(), ''), null);
    assert.equal(findOnGame(null, '5555559101'), null);
  });

  it('counts someone who cancelled and re-joined as confirmed', () => {
    const value = game({
      players: [{ id: 'again', name: 'Three', phone: '5555559103' }],
      waitlist: [],
      outPlayers: [{ id: 'three', name: 'Three', phone: '5555559103' }]
    });

    assert.equal(findOnGame(value, '5555559103').type, 'confirmed');
  });

  it('lists everyone a host can text without the host themselves', () => {
    const audience = textableAudience(game());

    assert.deepEqual(
      audience.map((entry) => `${entry.type}:${entry.player.name}`),
      ['confirmed:One', 'waitlist:Two', 'out:Three']
    );
  });

  it('skips people with no phone number', () => {
    const value = game({
      players: [{ id: 'nophone', name: 'No Phone' }],
      waitlist: [],
      outPlayers: []
    });

    assert.deepEqual(textableAudience(value), []);
  });
});
