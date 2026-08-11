const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  joinPlayer,
  leavePlayer,
  removePlayer,
  movePlayerToWaitlist,
  promotePlayer,
  describePlayerStatus
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

  it('refuses to remove or waitlist the organizer out of their own game', () => {
    const value = game({
      players: [
        { id: 'organizer', name: 'Host', isOrganizer: true },
        { id: 'one', name: 'One' }
      ]
    });

    const removed = removePlayer(value, 'organizer');
    assert.equal(removed.status, 'organizer');
    assert.equal(removed.changed, false);
    assert.equal(value.players.length, 2);

    const moved = movePlayerToWaitlist(value, 'organizer');
    assert.equal(moved.status, 'organizer');
    assert.equal(moved.changed, false);
    assert.equal(value.players.length, 2);
    assert.equal(value.waitlist.length, 0);

    // Everyone else still moves normally.
    assert.equal(removePlayer(value, 'one').status, 'removed');
  });
});

describe('describing a player their own status', () => {
  it('tells a confirmed player their place on the roster', () => {
    const value = game({
      totalPlayers: 6,
      players: [
        { name: 'Host', phone: '1111111111', isOrganizer: true },
        { name: 'Priya Patel', phone: '3125550101' }
      ]
    });

    assert.deepEqual(describePlayerStatus(value, '3125550101'), {
      status: 'confirmed',
      name: 'Priya Patel',
      position: 2,
      totalPlayers: 6,
      isOrganizer: false
    });
  });

  it('flags the organizer, who cannot drop their own reserved spot', () => {
    const value = game({
      players: [{ name: 'Host', phone: '1111111111', isOrganizer: true }]
    });
    assert.equal(describePlayerStatus(value, '1111111111').isOrganizer, true);
  });

  it('gives a waiting player their number in the queue', () => {
    const value = game({
      players: [{ name: 'Host', phone: '1111111111' }],
      waitlist: [
        { name: 'Grace', phone: '2222222222' },
        { name: 'Henry', phone: '3333333333' }
      ]
    });

    assert.deepEqual(describePlayerStatus(value, '3333333333'), {
      status: 'waitlist',
      name: 'Henry',
      position: 2,
      hidePosition: false
    });
  });

  it('hides the queue position in approval mode, where the host picks', () => {
    const value = game({
      registrationMode: 'waitlist',
      waitlist: [{ name: 'Ivy', phone: '2222222222' }]
    });

    const status = describePlayerStatus(value, '2222222222');
    assert.equal(status.status, 'waitlist');
    assert.equal(status.position, null);
    assert.equal(status.hidePosition, true);
  });

  it('remembers somebody who said they are out', () => {
    const value = game({
      outPlayers: [{ name: 'Marcus Webb', phone: '4444444444', wasConfirmed: true }]
    });
    assert.deepEqual(describePlayerStatus(value, '4444444444'), {
      status: 'out',
      name: 'Marcus Webb'
    });
  });

  it('reports nobody for a stranger, a missing number, or a missing game', () => {
    const value = game({ players: [{ name: 'Priya', phone: '3125550101' }] });
    assert.deepEqual(describePlayerStatus(value, '9999999999'), { status: 'none' });
    assert.deepEqual(describePlayerStatus(value, ''), { status: 'none' });
    assert.deepEqual(describePlayerStatus(null, '3125550101'), { status: 'none' });
  });

  it('prefers the live roster over an older out entry for the same phone', () => {
    // Somebody who tapped OUT and then signed up again is IN, not out.
    const value = game({
      players: [{ name: 'Priya Patel', phone: '3125550101' }],
      outPlayers: [{ name: 'Priya Patel', phone: '3125550101', wasConfirmed: true }]
    });
    assert.equal(describePlayerStatus(value, '3125550101').status, 'confirmed');
  });
});
