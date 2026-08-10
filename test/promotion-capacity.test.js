const test = require('node:test');
const assert = require('node:assert/strict');

const { promoteIntoOpenSpot } = require('../utils/promotion');

function gameWith({ totalPlayers, players, waitlist, registrationMode = 'fcfs' }) {
  return {
    totalPlayers,
    registrationMode,
    players: players.map((name) => ({ id: name, name })),
    waitlist: waitlist.map((name) => ({ id: name, name }))
  };
}

test('raising the player count pulls people off the waitlist', () => {
  const game = gameWith({
    totalPlayers: 6,
    players: ['Scott', 'Mike', 'Brett', 'Zac'],
    waitlist: ['Dana', 'Jamie', 'Alex']
  });

  const promoted = [];
  let next;
  while ((next = promoteIntoOpenSpot(game))) promoted.push(next.name);

  assert.deepEqual(promoted, ['Dana', 'Jamie']);
  assert.equal(game.players.length, 6);
  assert.deepEqual(game.waitlist.map((player) => player.name), ['Alex']);
});

test('a full game promotes nobody', () => {
  const game = gameWith({
    totalPlayers: 4,
    players: ['Scott', 'Mike', 'Brett', 'Zac'],
    waitlist: ['Dana']
  });

  assert.equal(promoteIntoOpenSpot(game), null);
  assert.equal(game.waitlist.length, 1);
});

test('approval mode never picks players for the organizer', () => {
  const game = gameWith({
    totalPlayers: 6,
    players: ['Scott'],
    waitlist: ['Dana', 'Jamie'],
    registrationMode: 'waitlist'
  });

  assert.equal(promoteIntoOpenSpot(game), null);
  assert.equal(game.players.length, 1);
  assert.equal(game.waitlist.length, 2);
});

test('an empty waitlist promotes nobody', () => {
  const game = gameWith({ totalPlayers: 4, players: ['Scott'], waitlist: [] });
  assert.equal(promoteIntoOpenSpot(game), null);
});
