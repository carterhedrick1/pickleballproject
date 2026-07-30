const {
  getAllGames,
  hasReminderBeenSent,
  markReminderSent
} = require('../database');
// Resolve through the compatibility facade so the existing verification seam can replace
// sendSMS before game-logic loads without ever contacting Textbelt.
const smsHandler = require('../sms-handler');
const { formatDateForSMS, formatTimeForSMS, formatLocationForSMS } = require('../utils/sms-format');
const { getCentralTimeNow, isGameUpcoming } = require('../utils/central-time');
const { resolveTextMessage } = require('./text-message-rotation');
const { appendCustomReplyInstructions } = require('../sms-reply-options');

const sentRemindersCache = new Map();
const remindedPlayersCache = new Map();
const reminderAttempts = new Map();
const MAX_REMINDERS_PER_RUN = 50;
const MAX_SEND_ATTEMPTS = 3;
let reminderCheckInProgress = false;

const DEBUG = process.env.DEBUG === 'true' || process.env.DEBUG === '1';

function describeGameDay(game, centralNow) {
  const dateKey = (date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

  if (game.date === dateKey(centralNow)) return 'today';
  const tomorrow = new Date(
    centralNow.getFullYear(),
    centralNow.getMonth(),
    centralNow.getDate() + 1
  );
  if (game.date === dateKey(tomorrow)) return 'tomorrow';
  return `on ${formatDateForSMS(game.date)}`;
}

async function checkAndSendReminders() {
  if (reminderCheckInProgress) {
    console.warn('[REMINDER] Previous check still running, skipping this one');
    return;
  }
  reminderCheckInProgress = true;

  try {
    console.log('[REMINDER] Checking for games that need reminders...');
    const allGames = await getAllGames();
    const centralNow = getCentralTimeNow();
    let remindersSentThisRun = 0;

    if (DEBUG) {
      console.log(`[REMINDER] Current Central time: ${centralNow.toLocaleString()}`);
    }

    for (const [gameId, game] of Object.entries(allGames)) {
      if (game.cancelled) continue;

      const gameTime = new Date(`${game.date}T${game.time}:00`);
      const reminderTime = new Date(gameTime.getTime() - (24 * 60 * 60 * 1000));

      if (centralNow >= reminderTime && isGameUpcoming(game.date, game.time)) {
        const confirmedPlayers = game.players || [];
        const rosterSignature = confirmedPlayers
          .map((player) => player.phone)
          .filter(Boolean)
          .sort()
          .join(',');
        const cacheKey = `${gameId}_${game.date}_${game.time}_${rosterSignature}`;
        if (sentRemindersCache.has(cacheKey)) continue;

        let remindersSent = 0;
        let outstanding = 0;
        const maxRemindersPerGame = 20;

        for (const player of confirmedPlayers) {
          if (remindersSent >= maxRemindersPerGame) {
            console.warn(`[REMINDER] Hit per-game limit of ${maxRemindersPerGame} for game ${gameId}`);
            outstanding++;
            break;
          }
          if (remindersSentThisRun >= MAX_REMINDERS_PER_RUN) {
            console.warn(`[REMINDER] Hit per-run limit of ${MAX_REMINDERS_PER_RUN}; remaining reminders retry on the next check`);
            outstanding++;
            break;
          }
          if (!player.phone) continue;

          const playerKey = `${gameId}|${player.phone}`;
          if (remindedPlayersCache.has(playerKey)) continue;

          const priorAttempts = reminderAttempts.get(playerKey)?.count || 0;
          if (priorAttempts >= MAX_SEND_ATTEMPTS) continue;

          let alreadySent;
          try {
            alreadySent = await hasReminderBeenSent(
              gameId,
              player.phone,
              'twenty_four_hours'
            );
          } catch (error) {
            console.error(`[REMINDER] Could not check reminder status for ${player.phone}, skipping:`, error.message);
            outstanding++;
            continue;
          }
          if (alreadySent) continue;

          const gameDay = describeGameDay(game, centralNow);
          const defaultMessage =
            `Reminder: Your pickleball game is ${gameDay} ` +
            `at ${formatTimeForSMS(game.time)} at ${formatLocationForSMS(game)}. ` +
            'Looking forward to seeing you! Reply 2 for details or 9 to cancel.';
          let message = await resolveTextMessage(
            'upcoming-reminder',
            defaultMessage,
            {
              LOCATION: formatLocationForSMS(game),
              DATE: formatDateForSMS(game.date),
              TIME: formatTimeForSMS(game.time),
              DAY: gameDay
            },
            {
              game,
              gameId,
              recipientPhone: player.phone
            }
          );
          message = await appendCustomReplyInstructions(message, 'player');

          reminderAttempts.set(playerKey, {
            count: priorAttempts + 1,
            at: Date.now()
          });
          const smsResult = await smsHandler.sendSMS(player.phone, message, gameId, {
            eventId: 'upcoming-game-reminder'
          });

          if (smsResult.success) {
            remindedPlayersCache.set(playerKey, Date.now());
            remindersSent++;
            remindersSentThisRun++;
            try {
              await markReminderSent(gameId, player.phone, 'twenty_four_hours');
            } catch (error) {
              console.error(`[REMINDER] Sent reminder to ${player.phone} but failed to log it:`, error.message);
            }
          } else if (priorAttempts + 1 >= MAX_SEND_ATTEMPTS) {
            console.error(`[REMINDER] Giving up on ${player.phone} for game ${gameId} after ${MAX_SEND_ATTEMPTS} attempts:`, smsResult.error);
          } else {
            console.error(`[REMINDER] Failed to send reminder to ${player.phone}, will retry:`, smsResult.error);
            outstanding++;
          }
        }

        if (outstanding === 0) sentRemindersCache.set(cacheKey, Date.now());
        if (remindersSent > 0) {
          console.log(`[REMINDER] Sent ${remindersSent} reminder(s) for game ${gameId}`);
        }
      }
    }

    const twoDaysAgo = Date.now() - (48 * 60 * 60 * 1000);
    for (const [key, timestamp] of sentRemindersCache.entries()) {
      if (timestamp < twoDaysAgo) sentRemindersCache.delete(key);
    }
    for (const [key, timestamp] of remindedPlayersCache.entries()) {
      if (timestamp < twoDaysAgo) remindedPlayersCache.delete(key);
    }
    for (const [key, attempt] of reminderAttempts.entries()) {
      if (attempt.at < twoDaysAgo) reminderAttempts.delete(key);
    }
  } catch (error) {
    console.error('[REMINDER] Error in reminder system:', error);
  } finally {
    reminderCheckInProgress = false;
  }
}

function resetReminderState() {
  sentRemindersCache.clear();
  remindedPlayersCache.clear();
  reminderAttempts.clear();
  reminderCheckInProgress = false;
}

module.exports = {
  checkAndSendReminders,
  describeGameDay,
  resetReminderState
};
