const { describe, it, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// Patched before sms-webhook loads, because it destructures sendSMS at require time.
const smsClient = require('../services/sms-client');
const sent = [];
smsClient.sendSMS = async (phone, message) => {
  sent.push({ phone, message });
  return { success: true, stubbed: true };
};

const { sendOrganizerNotification } = require('../services/sms-webhook');

function fullGame(notificationPreferences) {
  return {
    location: 'Oak Park Courts',
    date: '2026-08-14',
    time: '18:00',
    totalPlayers: 4,
    hostPhone: '3125550188',
    players: [{ name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'D' }],
    waitlist: [],
    notificationPreferences
  };
}

describe('the host alert when a signup fills the game', () => {
  beforeEach(() => { sent.length = 0; });

  it('tells the whole story in one text', async () => {
    await sendOrganizerNotification(
      'g1',
      fullGame({ playerJoins: true, gameFull: true }),
      'playerJoinsAndFills',
      'Dana Reeves'
    );

    assert.equal(sent.length, 1, 'one text, not the old pair');
    assert.match(sent[0].message, /Dana Reeves just joined/);
    assert.match(sent[0].message, /That fills it — all 4 spots are taken\./);
    // The half that used to arrive on its own a second later.
    assert.doesNotMatch(sent[0].message, /0 spots remaining/);
  });

  it('says nothing when the host did not ask for both alerts', async () => {
    // The route only combines when both preferences are on; the single-preference hosts go
    // down the original playerJoins / gameFull paths, so this event must stay silent.
    await sendOrganizerNotification(
      'g1',
      fullGame({ playerJoins: true, gameFull: false }),
      'playerJoinsAndFills',
      'Dana Reeves'
    );
    await sendOrganizerNotification(
      'g1',
      fullGame({ playerJoins: false, gameFull: true }),
      'playerJoinsAndFills',
      'Dana Reeves'
    );

    assert.equal(sent.length, 0);
  });

  it('reads correctly for a one-player game', async () => {
    const game = fullGame({ playerJoins: true, gameFull: true });
    game.totalPlayers = 1;
    game.players = [{ name: 'A' }];

    await sendOrganizerNotification('g1', game, 'playerJoinsAndFills', 'Dana Reeves');

    assert.match(sent[0].message, /all 1 spot is taken\./);
  });
});
