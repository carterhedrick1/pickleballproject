const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  joinPlayer,
  leavePlayer,
  removePlayer,
  movePlayerToWaitlist,
  promotePlayer
} = require('../domain/player-transitions');

const NOW = '2026-07-27T12:00:00.000Z';

function game(overrides = {}) {
  return {
    totalPlayers: 2,
    registrationMode: 'fcfs',
    players: [],
    waitlist: [],
    outPlayers: [],
    ...overrides
  };
}

describe('player transitions', () => {
  it('joins open games, waitlists overflow, and rejects a repeated phone', () => {
    const value = game();
    const first = joinPlayer(value, { name: 'One', phone: '1111111111' }, {
      id: 'one',
      now: NOW
    });
    const second = joinPlayer(value, { name: 'Two', phone: '2222222222' }, {
      id: 'two',
      now: NOW
    });
    const third = joinPlayer(value, { name: 'Three', phone: '3333333333' }, {
      id: 'three',
      now: NOW
    });
    const repeat = joinPlayer(value, { name: 'One again', phone: '1111111111' });

    assert.equal(first.status, 'confirmed');
    assert.equal(second.status, 'confirmed');
    assert.equal(third.status, 'waitlist');
    assert.equal(third.position, 1);
    assert.equal(repeat.status, 'duplicate');
    assert.equal(repeat.changed, false);
    assert.deepEqual(value.players.map((player) => player.id), ['one', 'two']);
    assert.deepEqual(value.waitlist.map((player) => player.id), ['three']);
  });

  it('puts all public signups into approval-mode waitlist', () => {
    const value = game({ registrationMode: 'waitlist' });
    const result = joinPlayer(value, { name: 'Applicant', phone: '1111111111' }, {
      id: 'applicant',
      now: NOW
    });

    assert.equal(result.status, 'waitlist');
    assert.equal(result.position, null);
    assert.equal(result.hidePosition, true);
    assert.equal(value.players.length, 0);
    assert.equal(value.waitlist.length, 1);
  });

  it('leaving a confirmed spot records OUT and promotes in first-come mode', () => {
    const value = game({
      players: [{ id: 'one', name: 'One', phone: '1111111111' }],
      waitlist: [{ id: 'two', name: 'Two', phone: '2222222222' }]
    });
    const result = leavePlayer(value, { phone: '1111111111' }, { now: NOW });

    assert.equal(result.previousStatus, 'confirmed');
    assert.equal(result.status, 'out');
    assert.equal(result.promotedPlayer.id, 'two');
    assert.equal(result.outEntry.wasConfirmed, true);
    assert.deepEqual(value.players.map((player) => player.id), ['two']);
    assert.equal(value.waitlist.length, 0);
  });

  it('does not auto-promote in approval mode', () => {
    const value = game({
      registrationMode: 'waitlist',
      players: [{ id: 'one', name: 'One', phone: '1111111111' }],
      waitlist: [{ id: 'two', name: 'Two', phone: '2222222222' }]
    });
    const result = leavePlayer(value, { playerId: 'one' });

    assert.equal(result.promotedPlayer, null);
    assert.equal(value.players.length, 0);
    assert.deepEqual(value.waitlist.map((player) => player.id), ['two']);
  });

  it('protects organizers and makes repeated cancellation a no-op', () => {
    const value = game({
      players: [{
        id: 'organizer',
        name: 'Host',
        phone: '1111111111',
        isOrganizer: true
      }]
    });

    const protectedResult = leavePlayer(value, { phone: '1111111111' });
    assert.equal(protectedResult.status, 'organizer');
    assert.equal(value.players.length, 1);

    const ordinary = game({
      players: [{ id: 'one', name: 'One', phone: '2222222222' }]
    });
    assert.equal(leavePlayer(ordinary, { playerId: 'one' }).changed, true);
    const repeated = leavePlayer(ordinary, { playerId: 'one' });
    assert.equal(repeated.status, 'not_found');
    assert.equal(repeated.changed, false);
    assert.equal(ordinary.outPlayers.length, 1);
  });

  it('supports host move, promotion, and removal transitions', () => {
    const value = game({
      players: [{ id: 'one', name: 'One' }],
      waitlist: [{ id: 'two', name: 'Two' }]
    });

    const moved = movePlayerToWaitlist(value, 'one');
    assert.equal(moved.status, 'waitlist');
    assert.equal(moved.position, 2);

    const promoted = promotePlayer(value, 'two', { now: NOW });
    assert.equal(promoted.status, 'confirmed');
    assert.equal(promoted.player.promotedAt, NOW);

    const removed = removePlayer(value, 'two');
    assert.equal(removed.status, 'removed');
    assert.equal(removed.previousStatus, 'confirmed');
    assert.equal(removed.promotedPlayer.id, 'one');
  });
});
