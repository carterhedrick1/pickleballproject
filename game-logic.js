// game-logic.js - Game creation and reminder system
const validator = require('validator');
const { 
  getAllGames, 
  hasReminderBeenSent, 
  markReminderSent 
} = require('./database');
const { sendSMS, formatDateForSMS, formatTimeForSMS, formatPhoneNumber, formatLocationForSMS } = require('./sms-handler');
const { getCentralTimeNow } = require('./utils/central-time');
const sentRemindersCache = new Map(); // In-memory cache to prevent duplicate sends

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

// Game reminder system
async function checkAndSendReminders() {
  try {
    console.log('[REMINDER] Checking for games that need reminders...');
    
    const allGames = await getAllGames();
    const finalCentralTime = getCentralTimeNow();

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

      // Only send if we're within 5 minutes of the reminder time and it's not in the past
      if (timeDifference <= fiveMinutes && finalCentralTime >= reminderTime) {
        // **NEW SAFETY CHECK**: Check in-memory cache first
        const cacheKey = `${gameId}_${game.date}_${game.time}`;
        if (sentRemindersCache.has(cacheKey)) {
          if (DEBUG) console.log(`[REMINDER] Already sent reminders for game ${gameId} (cached), skipping`);
          continue;
        }

        if (DEBUG) console.log(`[REMINDER] Sending 24-hour reminders for game ${gameId}`);
        
        // **NEW SAFETY CHECK**: Mark in cache BEFORE sending any SMS
        sentRemindersCache.set(cacheKey, Date.now());
        
        // Send reminders to all confirmed players
        const confirmedPlayers = game.players || [];
        let remindersSent = 0;
        let maxRemindersPerGame = 20; // **NEW SAFETY LIMIT**
        
        for (const player of confirmedPlayers) {
          // **NEW SAFETY CHECK**: Hard limit on reminders per game
          if (remindersSent >= maxRemindersPerGame) {
            if (DEBUG) console.log(`[REMINDER] Hit safety limit of ${maxRemindersPerGame} reminders for game ${gameId}`);
            break;
          }
          
          if (!player.phone) {
            if (DEBUG) console.log(`[REMINDER] Skipping ${player.name} - no phone number`);
            continue;
          }
          
          // Check if we already sent this player a 24-hour reminder
          const alreadySent = await hasReminderBeenSent(gameId, player.phone, 'twenty_four_hours');
          
          if (alreadySent) {
            if (DEBUG) console.log(`[REMINDER] Already sent 24-hour reminder to ${player.phone} for game ${gameId}`);
            continue;
          }
          
          // Format the game time and date for the message
          const gameTimeFormatted = formatTimeForSMS(game.time);
          const gameDateFormatted = formatDateForSMS(game.date);
          const locationText = formatLocationForSMS(game);

          const reminderMessage = `Reminder: Your pickleball game is tomorrow at ${gameTimeFormatted} at ${locationText}. Looking forward to seeing you! Reply 2 for details or 9 to cancel.`;          
          
          // Send the SMS
          const smsResult = await sendSMS(player.phone, reminderMessage, gameId);
          
          if (smsResult.success) {
            await markReminderSent(gameId, player.phone, 'twenty_four_hours');
            remindersSent++;
            if (DEBUG) console.log(`[REMINDER] Sent 24-hour reminder to ${player.name} for game ${gameId}`);
          } else {
            console.error(`[REMINDER] Failed to send reminder to ${player.phone}:`, smsResult.error);
          }
        }
        
        if (DEBUG && remindersSent > 0) {
          console.log(`[REMINDER] Sent ${remindersSent} reminders for game ${gameId}`);
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
    
    if (DEBUG) console.log('[REMINDER] Check completed');

  } catch (error) {
    console.error('[REMINDER] Error in reminder system:', error);
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