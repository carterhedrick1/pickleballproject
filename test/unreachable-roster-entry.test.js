const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { findUnreachableRosterEntry } = require('../domain/player-transitions');

function game(overrides = {}) {
  return {
    players: [
      { id: 'host', name: 'Scott', phone: '3125550188', isOrganizer: true },
      { id: 'p1', name: 'Dana Reeves', phone: '3125550101' },
      { id: 'p2', name: 'Bob NoPhone', phone: '' }
    ],
    waitlist: [{ id: 'w1', name: 'Wanda Waiting', phone: '' }],
    ...overrides
  };
}

describe('spotting a roster entry that tapping OUT cannot reach', () => {
  it('finds the host-added player who has no phone number', () => {
    assert.equal(findUnreachableRosterEntry(game(), 'Bob NoPhone').id, 'p2');
    assert.equal(findUnreachableRosterEntry(game(), 'Wanda Waiting').id, 'w1');
  });

  it('ignores case and stray spacing, the way people type their own name', () => {
    assert.equal(findUnreachableRosterEntry(game(), '  bob nophone ').id, 'p2');
  });

  it('says nothing about players who do have a number', () => {
    // Their own OUT matches on phone, so there is no disagreement to report.
    assert.equal(findUnreachableRosterEntry(game(), 'Dana Reeves'), null);
    assert.equal(findUnreachableRosterEntry(game(), 'Scott'), null);
  });

  it('says nothing about a name nobody on this game shares', () => {
    assert.equal(findUnreachableRosterEntry(game(), 'Complete Stranger'), null);
    assert.equal(findUnreachableRosterEntry(game(), ''), null);
    assert.equal(findUnreachableRosterEntry(game(), null), null);
  });

  it('copes with a game that has no roster at all', () => {
    assert.equal(findUnreachableRosterEntry({}, 'Bob NoPhone'), null);
  });

  it('never removes anybody', () => {
    // The roster is public to anyone holding the game link, so a name alone must not be
    // enough to drop a player. This only reports; the host does the removing.
    const value = game();
    findUnreachableRosterEntry(value, 'Bob NoPhone');
    assert.equal(value.players.length, 3);
    assert.equal(value.waitlist.length, 1);
  });
});
