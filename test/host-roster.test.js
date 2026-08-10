const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { buildVisibleHostRoster } = require('../services/host-roster');

describe('visible host roster', () => {
  it('includes older-game players even when they have no separate saved-roster row', () => {
    const roster = buildVisibleHostRoster(
      '555-000-0000',
      [],
      [{
        date: '2026-07-01',
        players: [
          { name: 'Carter Hedrick', phone: '+1 (555) 111-2222', joinedAt: '2026-07-01T12:00:00Z' },
          { name: 'Scott Hedrick', phone: '5550000000', joinedAt: '2026-07-01T12:00:00Z' }
        ]
      }]
    );

    assert.deepEqual(roster.map((player) => player.phone), ['5551112222']);
    assert.equal(roster[0].name, 'Carter Hedrick');
    assert.equal(roster[0].gamesCount, 1);
  });

  it('normalizes identities, counts each game once, and lets saved details win', () => {
    const roster = buildVisibleHostRoster(
      '5550000000',
      [{
        playerPhone: '1-555-111-2222',
        name: 'Saved Name',
        duprId: 'DUPR-1',
        duprRating: 4.25,
        isAndroid: 1
      }],
      [{
        date: '2026-07-01',
        players: [{ name: 'Signup Name', phone: '(555) 111-2222' }],
        outPlayers: [{ name: 'Signup Name', phone: '5551112222' }]
      }]
    );

    assert.equal(roster.length, 1);
    assert.deepEqual(roster[0], {
      phone: '5551112222',
      name: 'Saved Name',
      duprId: 'DUPR-1',
      duprRating: 4.25,
      isAndroid: 1,
      lastSeen: '2026-07-01',
      gamesCount: 1
    });
  });
});
