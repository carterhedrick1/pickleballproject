const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { describeSmsEvents, UNKNOWN_RECIPIENT } = require('../utils/delivery-log');

// A stand-in for the real SHA-256: same contract, readable failures.
const hashPhone = (phone) => `h:${String(phone || '').replace(/\D/g, '')}`;

function game(overrides = {}) {
  return {
    organizerName: 'Scott',
    hostPhone: '5555559100',
    players: [
      { name: 'Scott', phone: '5555559100', isOrganizer: true },
      { name: 'Jamie', phone: '5555559101' }
    ],
    waitlist: [{ name: 'Robin', phone: '5555559102' }],
    outPlayers: [{ name: 'Casey', phone: '5555559103' }],
    invitedPlayers: [{ name: 'Alex', phone: '5555559104' }],
    ...overrides
  };
}

function row(phone, overrides = {}) {
  return {
    eventId: 'upcoming-game-reminder',
    recipientHash: hashPhone(phone),
    status: 'sent',
    attempts: 1,
    error: null,
    sentAt: '2026-08-01T12:00:00.000Z',
    ...overrides
  };
}

describe('delivery log', () => {
  it('names every kind of person attached to the game', () => {
    const { events } = describeSmsEvents(game(), [
      row('5555559101'),
      row('5555559102'),
      row('5555559103'),
      row('5555559104'),
      row('5555559100')
    ], hashPhone);

    assert.deepEqual(
      events.map((event) => `${event.name}/${event.role}`),
      ['Jamie/confirmed', 'Robin/waitlist', 'Casey/out', 'Alex/invited', 'Scott/organizer']
    );
  });

  it('says so plainly when the number is nobody it can see', () => {
    const { events } = describeSmsEvents(game(), [row('5555559999')], hashPhone);

    assert.equal(events[0].name, UNKNOWN_RECIPIENT);
    assert.equal(events[0].phone, null);
    assert.equal(events[0].role, null);
  });

  it('never returns a recipient hash to the page', () => {
    const result = describeSmsEvents(game(), [row('5555559101')], hashPhone);

    assert.equal(JSON.stringify(result).includes('recipientHash'), false);
    assert.equal(JSON.stringify(result).includes('h:5555559101'), false);
  });

  it('turns event ids into the titles the dashboard already uses', () => {
    const { events } = describeSmsEvents(game(), [
      row('5555559101', { eventId: 'game-invitation' }),
      row('5555559101', { eventId: 'something-we-stopped-sending' })
    ], hashPhone);

    assert.equal(events[0].event, 'Game Invitation Sent');
    assert.equal(events[1].event, 'Other Text');
  });

  it('keeps the failure detail a host needs to explain a missing text', () => {
    const { events, counts } = describeSmsEvents(game(), [
      row('5555559101', { status: 'failed', attempts: 3, error: 'Carrier rejected the message' }),
      row('5555559102')
    ], hashPhone);

    assert.equal(events[0].status, 'failed');
    assert.equal(events[0].attempts, 3);
    assert.equal(events[0].error, 'Carrier rejected the message');
    assert.deepEqual(counts, { failed: 1, sent: 1 });
  });

  it('prefers a current role over an older one for the same number', () => {
    const rejoined = game({
      players: [{ name: 'Casey', phone: '5555559103' }],
      waitlist: [],
      outPlayers: [{ name: 'Casey', phone: '5555559103' }]
    });
    const { events } = describeSmsEvents(rejoined, [row('5555559103')], hashPhone);

    assert.equal(events[0].role, 'confirmed');
  });

  it('copes with a game that has no roster at all', () => {
    const { events, counts } = describeSmsEvents({}, [], hashPhone);

    assert.deepEqual(events, []);
    assert.deepEqual(counts, {});
  });
});
