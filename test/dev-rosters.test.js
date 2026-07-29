const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  chooseDeveloperRosterSource,
  buildDeveloperRosters,
  editPlayerInGame,
  deletePlayerFromGame
} = require('../utils/dev-rosters');

describe('developer roster directory', () => {
  it('uses live data by default in local development while allowing fixture isolation', () => {
    assert.equal(chooseDeveloperRosterSource(), 'production');
    assert.equal(
      chooseDeveloperRosterSource({ requestedSource: 'local' }),
      'local'
    );
    assert.equal(
      chooseDeveloperRosterSource({ configuredSource: 'local' }),
      'local'
    );
    assert.equal(
      chooseDeveloperRosterSource({
        configuredSource: 'local',
        requestedSource: 'production'
      }),
      'local'
    );
    assert.equal(
      chooseDeveloperRosterSource({
        production: true,
        configuredSource: 'local',
        requestedSource: 'local'
      }),
      'production'
    );
  });

  it('groups every player under each host and deduplicates the master roster', () => {
    const result = buildDeveloperRosters({
      games: [
        {
          hostPhone: '1111111111',
          updatedAt: '2026-01-01T00:00:00Z',
          data: {
            organizerName: 'Host One',
            players: [
              { name: 'Host One', phone: '1111111111', isOrganizer: true },
              { name: 'Signup Name', phone: '(222) 222-2222' }
            ],
            waitlist: [{ name: 'Waiting Player', phone: '3333333333' }]
          }
        },
        {
          hostPhone: '4444444444',
          updatedAt: '2026-02-01T00:00:00Z',
          data: {
            organizerName: 'Host Two',
            players: [{ name: 'Newer Signup Name', phone: '2222222222' }]
          }
        }
      ],
      rosterRows: [
        {
          hostPhone: '1111111111',
          playerPhone: '2222222222',
          name: 'Host Saved Name',
          updatedAt: '2025-01-01T00:00:00Z'
        }
      ]
    });

    assert.deepEqual(result.counts, { hosts: 2, players: 2, rosterEntries: 3 });
    assert.deepEqual(result.hosts[0], {
      phone: '1111111111',
      name: 'Host One',
      players: [
        { phone: '2222222222', name: 'Host Saved Name' },
        { phone: '3333333333', name: 'Waiting Player' }
      ]
    });
    assert.deepEqual(result.players, [
      {
        phone: '2222222222',
        name: 'Host Saved Name',
        hostCount: 2,
        hostRosters: [
          { phone: '1111111111', name: 'Host One' },
          { phone: '4444444444', name: 'Host Two' }
        ]
      },
      {
        phone: '3333333333',
        name: 'Waiting Player',
        hostCount: 1,
        hostRosters: [{ phone: '1111111111', name: 'Host One' }]
      }
    ]);
  });

  it('edits and deletes non-organizer occurrences across every player state', () => {
    const game = {
      players: [
        { name: 'Organizer', phone: '2222222222', isOrganizer: true },
        { name: 'Old Name', phone: '1111111111' }
      ],
      waitlist: [{ name: 'Old Name', phone: '(111) 111-1111' }],
      outPlayers: [{ name: 'Someone Else', phone: '3333333333' }]
    };

    assert.equal(editPlayerInGame(game, '1111111111', '4444444444', 'New Name'), true);
    assert.deepEqual(game.players[1], { name: 'New Name', phone: '4444444444' });
    assert.deepEqual(game.waitlist[0], { name: 'New Name', phone: '4444444444' });
    assert.equal(editPlayerInGame(game, '2222222222', '5555555555', 'Not The Host'), false);

    assert.equal(deletePlayerFromGame(game, '4444444444'), 2);
    assert.equal(game.players.length, 1);
    assert.equal(game.waitlist.length, 0);
    assert.equal(deletePlayerFromGame(game, '2222222222'), 0);
    assert.equal(game.players[0].isOrganizer, true);
  });
});
