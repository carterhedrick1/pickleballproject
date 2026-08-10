const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { inviteStatus, normalizePhone } = require('../public/js/invite-status');
const { recordInvitations } = require('../routes/invitations');

function game(overrides = {}) {
  return {
    players: [{ name: 'Confirmed', phone: '5555559101' }],
    waitlist: [{ name: 'Waiting', phone: '5555559102' }],
    outPlayers: [{ name: 'Out', phone: '5555559103' }],
    invitedPlayers: [
      { phone: '5555559101', name: 'Confirmed' },
      { phone: '5555559102', name: 'Waiting' },
      { phone: '5555559103', name: 'Out' },
      { phone: '5555559104', name: 'Silent' }
    ],
    ...overrides
  };
}

describe('invite status', () => {
  it('separates invitees who answered from the ones who never did', () => {
    const status = inviteStatus(game());

    assert.deepEqual(status.responded.map((person) => person.name), ['Confirmed', 'Waiting', 'Out']);
    assert.deepEqual(status.nonResponders.map((person) => person.name), ['Silent']);
    assert.deepEqual(
      status.responded.map((person) => person.response),
      ['confirmed', 'waitlist', 'out']
    );
  });

  it('counts saying OUT as a reply, because it is one', () => {
    const status = inviteStatus(game({
      players: [],
      waitlist: [],
      outPlayers: [{ name: 'Out', phone: '5555559103' }]
    }));

    assert.deepEqual(status.nonResponders.map((person) => person.name), ['Confirmed', 'Waiting', 'Silent']);
  });

  it('matches invitees to responders however the number was typed', () => {
    const status = inviteStatus(game({
      players: [{ name: 'Confirmed', phone: '(555) 555-9101' }],
      waitlist: [],
      outPlayers: [],
      invitedPlayers: [{ phone: '15555559101', name: 'Confirmed' }]
    }));

    assert.equal(status.nonResponders.length, 0);
    assert.equal(status.responded.length, 1);
  });

  it('says nothing was invited when the list is empty or missing', () => {
    assert.deepEqual(inviteStatus({}).invited, []);
    assert.deepEqual(inviteStatus({ invitedPlayers: [] }).nonResponders, []);
  });

  it('ignores a duplicated invitee rather than counting them twice', () => {
    const status = inviteStatus(game({
      players: [],
      waitlist: [],
      outPlayers: [],
      invitedPlayers: [
        { phone: '5555559104', name: 'Silent' },
        { phone: '5555559104', name: 'Silent again' }
      ]
    }));

    assert.equal(status.invited.length, 1);
    assert.equal(status.nonResponders.length, 1);
  });

  it('normalizes phone numbers the way the roster does', () => {
    assert.equal(normalizePhone('(555) 555-9101'), '5555559101');
    assert.equal(normalizePhone('15555559101'), '5555559101');
    assert.equal(normalizePhone(null), '');
  });
});

describe('recording an invitation send', () => {
  const FIRST = '2026-08-01T12:00:00.000Z';
  const SECOND = '2026-08-02T12:00:00.000Z';

  it('remembers who was texted, when, and whether it landed', () => {
    const invited = recordInvitations(
      [],
      [{ phone: '5555559104', name: 'Silent', success: true }],
      FIRST
    );

    assert.deepEqual(invited, [{
      phone: '5555559104',
      name: 'Silent',
      invitedAt: FIRST,
      lastTextedAt: FIRST,
      textCount: 1,
      lastTextStatus: 'sent'
    }]);
  });

  it('keeps the first invitation date when the same person is nudged again', () => {
    const first = recordInvitations([], [{ phone: '5555559104', name: 'Silent', success: true }], FIRST);
    const second = recordInvitations(first, [{ phone: '5555559104', name: 'Silent', success: false }], SECOND);

    assert.equal(second.length, 1);
    assert.equal(second[0].invitedAt, FIRST);
    assert.equal(second[0].lastTextedAt, SECOND);
    assert.equal(second[0].textCount, 2);
    assert.equal(second[0].lastTextStatus, 'failed');
  });

  it('adds delivery details to somebody who was only ever an intended invitee', () => {
    const invited = recordInvitations(
      [{ phone: '5555559104', name: 'Silent' }],
      [{ phone: '(555) 555-9104', name: 'Silent', success: true }],
      FIRST
    );

    assert.equal(invited.length, 1);
    assert.equal(invited[0].textCount, 1);
    assert.equal(invited[0].invitedAt, FIRST);
  });

  it('leaves everyone else on the list untouched', () => {
    const invited = recordInvitations(
      [{ phone: '5555559101', name: 'Confirmed', textCount: 3 }],
      [{ phone: '5555559104', name: 'Silent', success: true }],
      FIRST
    );

    assert.equal(invited.length, 2);
    assert.equal(invited[0].textCount, 3);
    assert.equal(invited[0].lastTextedAt, undefined);
  });
});
