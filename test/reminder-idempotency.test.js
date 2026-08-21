// Gate version of the reminder-idempotency core from verify/reminder-catchup.js: the same
// player must never be reminded twice about the same game - not on the next check, and not
// after a process restart, because the durable reminder_log (not the in-memory cache) is
// what prevents resends.
//
// sendSMS is stubbed on services/sms-client (the reminder service holds the module and
// resolves sendSMS at call time), so nothing is ever texted. Phones use the 555444 prefix so
// concurrent test files sharing the local SQLite database cannot collide.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

const smsClient = require('../services/sms-client');
const realSendSMS = smsClient.sendSMS;
const sent = [];
smsClient.sendSMS = async (phone, message, gameId, options) => {
  sent.push({ phone, message, gameId });
  return { success: true, stubbed: true };
};

const { initializeDatabase } = require('../database/schema');
const { saveGame, deleteGamePermanently } = require('../database/games');
const { checkAndSendReminders, resetReminderState } = require('../services/reminders');
const { getCentralTimeNow } = require('../utils/central-time');

const GAME_ID = 'gate-reminder-idem-test';
const PHONES = ['5554440001', '5554440002'];
const mine = () => sent.filter((s) => String(s.phone).startsWith('555444'));

// A date/time N hours from "now" in the same wall-clock frame the reminder system uses.
function offsetGame(hours) {
  const t = new Date(getCentralTimeNow().getTime() + hours * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return {
    date: `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}`,
    time: `${p(t.getHours())}:${p(t.getMinutes())}`
  };
}

before(async () => {
  await initializeDatabase();
  const { date, time } = offsetGame(12); // inside the 24h window, outside the game-day one
  const joinedAt = new Date(Date.now() - 4 * 3600 * 1000).toISOString(); // beyond the quiet window
  const game = {
    location: 'Gate Reminder Court',
    organizerName: 'Reminder Host',
    organizerPlaying: false,
    date,
    time,
    duration: 90,
    totalPlayers: 4,
    registrationMode: 'fcfs',
    cancelled: false,
    hostPhone: null,
    hostToken: 'gate-reminder-token',
    players: PHONES.map((phone, index) => ({
      id: `p${index + 1}`,
      name: `Reminded${index + 1}`,
      phone,
      joinedAt
    })),
    waitlist: [],
    outPlayers: [],
    invitedPlayers: [],
    notificationPreferences: {}
  };
  await saveGame(GAME_ID, game, game.hostToken, null);
  resetReminderState();
});

after(async () => {
  smsClient.sendSMS = realSendSMS;
  try {
    await deleteGamePermanently(GAME_ID);
  } catch {}
});

describe('reminder idempotency', () => {
  it('reminds each confirmed player exactly once', async () => {
    await checkAndSendReminders();
    const phones = mine().map((s) => s.phone).sort();
    assert.deepEqual(phones, PHONES, 'both players got exactly one reminder');
  });

  it('does not resend on the next check', async () => {
    const countBefore = mine().length;
    await checkAndSendReminders();
    assert.equal(mine().length, countBefore, 'second check sent nothing new');
  });

  it('still does not resend after a simulated restart (durable log is authoritative)', async () => {
    resetReminderState();
    const countBefore = mine().length;
    await checkAndSendReminders();
    assert.equal(mine().length, countBefore, 'restart did not resend');
  });
});
