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
const { saveGame, getGame, deleteGamePermanently } = require('../database/games');
const { checkAndSendReminders, resetReminderState } = require('../services/reminders');
const { sqliteRun } = require('../database/context');
const { hasRecentReminder } = require('../database/messaging-reminders');
const { centralWallClock } = require('../public/js/central-time');

const GAME_ID = 'gate-reminder-idem-test';
const PHONES = ['5554440001', '5554440002'];
const mine = () => sent.filter((s) => String(s.phone).startsWith('555444'));

// A date/time N hours from now, written the way a game stores it: the Central wall clock.
function offsetGame(hours) {
  return centralWallClock(new Date(Date.now() + hours * 3600 * 1000));
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


describe('spacing between automatic reminder kinds', () => {
  it('holds a game-day reminder sent ten minutes after the upcoming reminder, even after restart', async () => {
    const game = await getGame(GAME_ID);
    Object.assign(game, offsetGame(1.9));
    await saveGame(GAME_ID, game, game.hostToken, null);
    await sqliteRun("UPDATE reminder_log SET sent_at = datetime('now', '-10 minutes') WHERE game_id = ?", [GAME_ID]);
    resetReminderState();
    const beforeCount = mine().length;
    await checkAndSendReminders();
    assert.equal(mine().length, beforeCount);
  });

  it('still reminds a player who has not received an earlier reminder', async () => {
    await sqliteRun('DELETE FROM reminder_log WHERE game_id = ? AND player_phone = ?', [GAME_ID, PHONES[1]]);
    const beforeCount = mine().length;
    await checkAndSendReminders();
    assert.deepEqual(mine().slice(beforeCount).map((message) => message.phone), [PHONES[1]]);
  });

  it('reconsiders a held player after the three-hour gap passes', async () => {
    await sqliteRun("UPDATE reminder_log SET sent_at = datetime('now', '-4 hours') WHERE game_id = ? AND player_phone = ?", [GAME_ID, PHONES[0]]);
    const beforeCount = mine().length;
    await checkAndSendReminders();
    assert.deepEqual(mine().slice(beforeCount).map((message) => message.phone), [PHONES[0]]);
    assert.match(mine().at(-1).message, /starts at/);
  });

  it('compares stored UTC times precisely at the quiet-window boundary and scopes to the game', async () => {
    const boundary = '2026-11-15 18:00:00';
    await sqliteRun('UPDATE reminder_log SET sent_at = ? WHERE game_id = ?', [boundary, GAME_ID]);
    const boundaryMs = Date.parse('2026-11-15T18:00:00Z');
    assert.equal(await hasRecentReminder(GAME_ID, PHONES[0], boundaryMs - 1), true);
    assert.equal(await hasRecentReminder(GAME_ID, PHONES[0], boundaryMs), false);
    assert.equal(await hasRecentReminder('another-game', PHONES[0], boundaryMs - 1), false);
  });
});
