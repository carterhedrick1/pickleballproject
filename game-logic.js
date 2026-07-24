// game-logic.js - Game creation and reminder system
const validator = require('validator');
const { 
  getAllGames, 
  hasReminderBeenSent, 
  markReminderSent 
} = require('./database');
const { sendSMS, formatDateForSMS, formatTimeForSMS, formatPhoneNumber, formatLocationForSMS } = require('./sms-handler');
const { getCentralTimeNow, isGameUpcoming } = require('./utils/central-time');
const sentRemindersCache = new Map(); // Games where every eligible player is confirmed reminded
// `${gameId}|${phone}` already texted by this process. reminder_log is the durable record, but if
// writing to it fails after the SMS goes out this stops us texting the same person again on the
// next check.
const remindedPlayersCache = new Map();
// Circuit breaker: most texts one check may send. Anything skipped is simply retried 2 minutes
// later, so this rate-limits a surprise backlog instead of dropping it.
const MAX_REMINDERS_PER_RUN = 50;
// `${gameId}|${phone}` -> { count, at }. sendSMS reports failure for any network error, including
// one where Textbelt already delivered the text, so an attempt that "fails" may still have sent.
// Retrying such a player every 2 minutes until game time could mean hundreds of texts; cap it.
const reminderAttempts = new Map();
const MAX_SEND_ATTEMPTS = 3;
// checkAndSendReminders runs on a 2-minute interval and is also reachable via /api/test-reminders.
// A slow Textbelt call can outlast the interval, and two runs interleaving would both see an
// unsent player and both text them. Only one check runs at a time.
let reminderCheckInProgress = false;

const DEBUG = process.env.DEBUG === 'true' || process.env.DEBUG === '1';

// Validation functions
function isValidPhoneNumber(phoneNumber) {
  if (!phoneNumber) return false;
  
  // More aggressive cleaning for Chrome iOS compatibility
  const cleaned = ('' + phoneNumber)
    .replace(/\D/g, '')  // Remove all non-digits
    .trim();             // Remove whitespace

  if (DEBUG) {
    console.log('[PHONE VALIDATION] Original:', phoneNumber, 'Cleaned:', cleaned);
  }
  
  // Check length first
  if (cleaned.length === 10 || (cleaned.length === 11 && cleaned.startsWith('1'))) {
    // Additional validation with the validator library
    try {
      const isValid = validator.isMobilePhone(phoneNumber, 'en-US');
      if (DEBUG) console.log('[PHONE VALIDATION] Validator result:', isValid);
      return isValid;
    } catch (error) {
      if (DEBUG) console.log('[PHONE VALIDATION] Validator error:', error);
      return true;
    }
  }

  if (DEBUG) console.log('[PHONE VALIDATION] Invalid length:', cleaned.length);
  return false;
}

/**
 * Checks if a game has expired (finished)
 * @param {Object} game - Game object with date, time, duration
 * @returns {boolean} True if game has finished
 */
function isGameExpired(game) {
  if (!game.date || !game.time) return false;
  
  try {
    // Create game start time
    const gameDateTime = new Date(`${game.date}T${game.time}:00`);
    
    // Add duration to get end time
    const duration = parseInt(game.duration) || 90; // Default 90 minutes
    const gameEndTime = new Date(gameDateTime.getTime() + (duration * 60 * 1000));
    
    const now = new Date();
    
    // Game is expired if end time has passed
    return gameEndTime < now;
  } catch (error) {
    console.error('[SERVER] Error checking game expiration:', error);
    return false;
  }
}

/**
 * Middleware function to check game expiration for player actions
 * @param {Object} game - Game object
 * @returns {Object} Error status and message
 */
function checkGameNotExpired(game) {
  if (isGameExpired(game)) {
    return {
      error: true,
      message: 'This game has ended and no longer accepts new registrations'
    };
  }
  return { error: false };
}

/**
 * Describes when a game falls relative to now. A reminder caught up late must not tell someone
 * their game is "tomorrow" when it is actually later today.
 * @param {Object} game - Game object with a YYYY-MM-DD date
 * @param {Date} centralNow - Current Central time
 * @returns {string} "today", "tomorrow", or "on <date>"
 */
function describeGameDay(game, centralNow) {
  const dateKey = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  if (game.date === dateKey(centralNow)) return 'today';

  const tomorrow = new Date(centralNow.getFullYear(), centralNow.getMonth(), centralNow.getDate() + 1);
  if (game.date === dateKey(tomorrow)) return 'tomorrow';

  return `on ${formatDateForSMS(game.date)}`;
}

// Game reminder system
async function checkAndSendReminders() {
  if (reminderCheckInProgress) {
    console.warn('[REMINDER] Previous check still running, skipping this one');
    return;
  }
  reminderCheckInProgress = true;

  try {
    console.log('[REMINDER] Checking for games that need reminders...');
    
    const allGames = await getAllGames();
    const finalCentralTime = getCentralTimeNow();
    let remindersSentThisRun = 0;

    if (DEBUG) {
      console.log(`[REMINDER] Current Central time: ${finalCentralTime.toLocaleString()}`);
    }

    // Check each game
    for (const [gameId, game] of Object.entries(allGames)) {
      // Skip cancelled games
      if (game.cancelled) {
        continue;
      }
      
      // Create the game date and time
      const gameDateTime = `${game.date}T${game.time}:00`;
      const gameTime = new Date(gameDateTime);
      
      // Calculate exactly 24 hours before the game
      const reminderTime = new Date(gameTime.getTime() - (24 * 60 * 60 * 1000));
      
      // Check if it's time to send reminders (within 5 minutes of reminder time)
      const timeDifference = Math.abs(finalCentralTime.getTime() - reminderTime.getTime());
      const fiveMinutes = 5 * 60 * 1000; // 5 minutes in milliseconds

      if (DEBUG) {
        const hoursUntilReminder = Math.round((reminderTime.getTime() - finalCentralTime.getTime()) / (1000 * 60 * 60));
        if (timeDifference <= fiveMinutes || Math.abs(hoursUntilReminder) <= 1) {
          console.log(`[REMINDER] Game ${gameId} at ${game.location}:`);
          console.log(`  Game time: ${gameTime.toLocaleString()}, 24h reminder: ${reminderTime.toLocaleString()}`);
          console.log(`  Time diff: ${Math.round((reminderTime.getTime() - finalCentralTime.getTime()) / (1000 * 60))} min`);
        }
      }

      // Send any time between 24 hours before the game and its start, rather than only inside a
      // narrow window around the 24-hour mark. reminder_log decides who still needs a text, so a
      // reminder missed while the server was asleep or restarting still goes out on a later check.
      if (finalCentralTime >= reminderTime && isGameUpcoming(game.date, game.time)) {
        const confirmedPlayers = game.players || [];

        // The key includes who is actually on the roster. Keyed on the game alone, a game was
        // cached as finished the moment everyone then-signed-up had been reminded, and skipped
        // on every later check - so anyone who joined after that point silently never got a
        // 24-hour reminder. Any change to the roster produces a new key and the game is looked
        // at again; reminder_log still decides who individually needs a text, so revisiting it
        // cannot text the same person twice.
        const rosterSignature = confirmedPlayers
          .map((p) => p.phone)
          .filter(Boolean)
          .sort()
          .join(',');
        const cacheKey = `${gameId}_${game.date}_${game.time}_${rosterSignature}`;
        if (sentRemindersCache.has(cacheKey)) {
          if (DEBUG) console.log(`[REMINDER] Already sent reminders for game ${gameId} (cached), skipping`);
          continue;
        }

        if (DEBUG) console.log(`[REMINDER] Checking 24-hour reminders for game ${gameId}`);

        let remindersSent = 0;
        let outstanding = 0; // players still owed a text after this pass
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

          if (!player.phone) {
            if (DEBUG) console.log(`[REMINDER] Skipping ${player.name} - no phone number`);
            continue;
          }

          const playerKey = `${gameId}|${player.phone}`;
          if (remindedPlayersCache.has(playerKey)) {
            continue;
          }

          // Already tried and failed the maximum number of times. Not counted as outstanding, so
          // this game stops being revisited rather than retrying forever.
          const priorAttempts = reminderAttempts.get(playerKey)?.count || 0;
          if (priorAttempts >= MAX_SEND_ATTEMPTS) {
            continue;
          }

          // If we cannot confirm whether this player was already reminded, skip them. Missing a
          // reminder is recoverable on the next check; sending a duplicate text is not.
          let alreadySent;
          try {
            alreadySent = await hasReminderBeenSent(gameId, player.phone, 'twenty_four_hours');
          } catch (err) {
            console.error(`[REMINDER] Could not check reminder status for ${player.phone}, skipping:`, err.message);
            outstanding++;
            continue;
          }

          if (alreadySent) {
            if (DEBUG) console.log(`[REMINDER] Already sent 24-hour reminder to ${player.phone} for game ${gameId}`);
            continue;
          }

          const gameTimeFormatted = formatTimeForSMS(game.time);
          const locationText = formatLocationForSMS(game);
          const whenText = describeGameDay(game, finalCentralTime);

          const reminderMessage = `Reminder: Your pickleball game is ${whenText} at ${gameTimeFormatted} at ${locationText}. Looking forward to seeing you! Reply 2 for details or 9 to cancel.`;

          // Count the attempt before sending: if the response is lost we must assume the text may
          // have gone out, so the attempt still has to count against the cap.
          reminderAttempts.set(playerKey, { count: priorAttempts + 1, at: Date.now() });

          const smsResult = await sendSMS(player.phone, reminderMessage, gameId);

          if (smsResult.success) {
            // Record in memory before the database write so that a logging failure can never
            // turn into the same player being texted again on the next check.
            remindedPlayersCache.set(playerKey, Date.now());
            remindersSent++;
            remindersSentThisRun++;
            try {
              await markReminderSent(gameId, player.phone, 'twenty_four_hours');
            } catch (err) {
              console.error(`[REMINDER] Sent reminder to ${player.phone} but failed to log it:`, err.message);
            }
            if (DEBUG) console.log(`[REMINDER] Sent 24-hour reminder to ${player.name} for game ${gameId}`);
          } else if (priorAttempts + 1 >= MAX_SEND_ATTEMPTS) {
            console.error(`[REMINDER] Giving up on ${player.phone} for game ${gameId} after ${MAX_SEND_ATTEMPTS} attempts:`, smsResult.error);
          } else {
            console.error(`[REMINDER] Failed to send reminder to ${player.phone}, will retry:`, smsResult.error);
            outstanding++;
          }
        }

        // Only stop revisiting this game once nobody is still owed a text, so failures retry.
        if (outstanding === 0) {
          sentRemindersCache.set(cacheKey, Date.now());
        }

        if (remindersSent > 0) {
          console.log(`[REMINDER] Sent ${remindersSent} reminder(s) for game ${gameId}`);
        }
      } else if (DEBUG) {
        const hoursUntilReminder = Math.round((reminderTime.getTime() - finalCentralTime.getTime()) / (1000 * 60 * 60));
        if (Math.abs(hoursUntilReminder) <= 24) {
          console.log(`[REMINDER] Game ${gameId} reminder in ${hoursUntilReminder} hours`);
        }
      }
    }
    
    // **NEW**: Clean up old cache entries (older than 48 hours)
    const twoDaysAgo = Date.now() - (48 * 60 * 60 * 1000);
    for (const [key, timestamp] of sentRemindersCache.entries()) {
      if (timestamp < twoDaysAgo) {
        sentRemindersCache.delete(key);
      }
    }
    // Safe to forget: any game these entries guard has already started by now, and a started game
    // no longer qualifies for reminders at all.
    for (const [key, timestamp] of remindedPlayersCache.entries()) {
      if (timestamp < twoDaysAgo) {
        remindedPlayersCache.delete(key);
      }
    }
    for (const [key, attempt] of reminderAttempts.entries()) {
      if (attempt.at < twoDaysAgo) {
        reminderAttempts.delete(key);
      }
    }
    
    if (DEBUG) console.log('[REMINDER] Check completed');

  } catch (error) {
    console.error('[REMINDER] Error in reminder system:', error);
  } finally {
    reminderCheckInProgress = false;
  }
}

// Create game data function
function createGameData(formData) {
  if (DEBUG) console.log('[DEBUG] Creating game data, received:', formData);
  
  const gameData = {
    location: formData.location,
    courtNumber: formData.courtNumber || '',
    organizerName: formData.organizerName || 'Organizer',
    organizerPhone: formData.organizerPhone ? formatPhoneNumber(formData.organizerPhone) : '',
    organizerPlaying: formData.organizerPlaying,
    date: formData.date,
    time: formData.time,
    duration: parseInt(formData.duration),
    totalPlayers: parseInt(formData.totalPlayers),
    message: formData.message,
    registrationMode: formData.registrationMode || 'fcfs',
    waitlist: [],
    notificationPreferences: {
      gameFull: formData.notificationPreferences?.gameFull ?? true,
      playerJoins: formData.notificationPreferences?.playerJoins ?? true,
      playerCancels: formData.notificationPreferences?.playerCancels ?? true,
      oneSpotLeft: formData.notificationPreferences?.oneSpotLeft ?? true,
      waitlistStarts: formData.notificationPreferences?.waitlistStarts ?? true
    },
    hostPhone: formData.organizerPhone ? formatPhoneNumber(formData.organizerPhone) : null,
    cancelled: false,
    created: new Date().toISOString()
  };

  if (DEBUG) {
    console.log('[DEBUG] Final notification preferences:', gameData.notificationPreferences);
    console.log('[DEBUG] Host phone:', gameData.hostPhone);
  }

  // Set up initial players list
  if (gameData.organizerPlaying) {
    gameData.players = [
      { 
        id: 'organizer', 
        name: gameData.organizerName, 
        phone: gameData.organizerPhone,
        isOrganizer: true,
        joinedAt: new Date().toISOString()
      }
    ];
  } else {
    gameData.players = [];
    gameData.outPlayers = [];

  }

  return gameData;
}

// Player validation and processing
function validatePlayerData(name, phone) {
  const cleanName = name ? name.trim() : '';
  const cleanPhone = phone ? phone.trim() : '';
  
  if (!cleanName) {
    throw new Error('Player name is required');
  }
  
  if (cleanPhone) {
    if (DEBUG) console.log('[VALIDATE PLAYER] Phone input:', cleanPhone);

    // Try the standard validation first
    if (!isValidPhoneNumber(cleanPhone)) {
      // If that fails, try lenient validation for Chrome iOS
      const cleaned = cleanPhone.replace(/\D/g, '');
      if (cleaned.length >= 10 && cleaned.length <= 15) {
        if (DEBUG) console.log('[VALIDATE PLAYER] Passed lenient validation for Chrome iOS');
      } else {
        throw new Error('Please enter a valid US phone number (e.g., (555) 123-4567)');
      }
    }
  }

  return {
    name: cleanName,
    phone: cleanPhone ? formatPhoneNumber(cleanPhone) : ''
  };
}

// Check if player already exists in game
function checkExistingPlayer(game, phone) {
  if (!phone) return { exists: false };
  
  const formattedPhone = formatPhoneNumber(phone);
  
  const existingPlayer = game.players.find(p => p.phone === formattedPhone);
  if (existingPlayer) {
    return { exists: true, location: 'confirmed', message: 'This phone number is already registered for this game' };
  }
  
  const existingWaitlist = (game.waitlist || []).find(p => p.phone === formattedPhone);
  if (existingWaitlist) {
    return { exists: true, location: 'waitlist', message: 'This phone number is already on the waitlist' };
  }
  
  return { exists: false };
}

// Add player to game (handles both confirmed and waitlist)
function addPlayerToGame(game, playerData, forceWaitlist = false) {
  const totalPlayers = parseInt(game.totalPlayers) || 4;
  const currentPlayerCount = game.players.length;
  const spotsAvailable = totalPlayers - currentPlayerCount;
  
  const newPlayer = {
    id: Date.now().toString(36) + Math.random().toString(36).substring(2, 6),
    ...playerData,
    joinedAt: new Date().toISOString(),
    isOrganizer: false
  };
  
  // In waitlist mode, ALL new players go to waitlist (except manual additions)
  const isWaitlistMode = game.registrationMode === 'waitlist';
  
  if (isWaitlistMode || forceWaitlist || spotsAvailable <= 0) {
    if (!game.waitlist) {
      game.waitlist = [];
    }
    game.waitlist.push(newPlayer);
    
    return {
      status: 'waitlist',
      position: isWaitlistMode ? null : game.waitlist.length, // Hide position in waitlist mode
      playerId: newPlayer.id,
      reason: isWaitlistMode ? 'waitlist_mode' : (spotsAvailable <= 0 ? 'game_full' : 'requested'),
      hidePosition: isWaitlistMode
    };
  } else {
    // First-come first-served mode
    game.players.push(newPlayer);
    
    return {
      status: 'confirmed',
      position: game.players.length,
      playerId: newPlayer.id,
      totalPlayers: totalPlayers
    };
  }
}

function removePlayerFromGame(game, playerId) {
  // Try to find in confirmed players
  const playerIndex = game.players.findIndex(p => p.id === playerId);
  
  if (playerIndex >= 0) {
    const removedPlayer = game.players.splice(playerIndex, 1)[0];
    
    let promotedPlayer = null;
    const isWaitlistMode = game.registrationMode === 'waitlist';
    
    if (!isWaitlistMode && game.waitlist && game.waitlist.length > 0) {
      // Only promote from waitlist in first-come-first-served mode
      promotedPlayer = game.waitlist.shift();
      game.players.push(promotedPlayer);
    }
    
    return { 
      status: 'removed',
      from: 'confirmed',
      removedPlayer,
      promotedPlayer, // Will be null in waitlist mode
      isOrganizer: removedPlayer.isOrganizer || false
    };
  }
  
  // Try to find in waitlist
  const waitlistIndex = (game.waitlist || []).findIndex(p => p.id === playerId);
  
  if (waitlistIndex >= 0) {
    const removedPlayer = game.waitlist.splice(waitlistIndex, 1)[0];
    return { 
      status: 'removed',
      from: 'waitlist',
      removedPlayer,
      promotedPlayer: null
    };
  }
  
  return { status: 'not_found' };
}

module.exports = {
  checkAndSendReminders,
  createGameData,
  validatePlayerData,
  checkExistingPlayer,
  addPlayerToGame,
  removePlayerFromGame,
  isValidPhoneNumber,
  isGameExpired,
  checkGameNotExpired
};