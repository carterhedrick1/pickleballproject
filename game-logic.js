// game-logic.js - Game creation and reminder system
const validator = require('validator');
const { 
  getAllGames, 
  hasReminderBeenSent, 
  markReminderSent 
} = require('./database');
const { sendSMS, formatDateForSMS, formatTimeForSMS } = require('./sms-handler');

// Test logging variables
let TEST_GAME_ID = null;
let hasInitializedTestGame = false;

// Validation functions
function isValidPhoneNumber(phoneNumber) {
  if (!phoneNumber) return false;
  
  const cleaned = ('' + phoneNumber).replace(/\D/g, '');
  
  if (cleaned.length === 10 || (cleaned.length === 11 && cleaned.startsWith('1'))) {
    return validator.isMobilePhone(phoneNumber, 'en-US');
  }
  
  return false;
}

function formatPhoneNumber(phoneNumber) {
  const cleaned = ('' + phoneNumber).replace(/\D/g, '');
  if (cleaned.length === 10) {
    return cleaned;
  } else if (cleaned.length === 11 && cleaned.startsWith('1')) {
    return cleaned.substring(1);
  }
  return cleaned;
}

// ADDED: Game expiration functions
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
    
    // Get current time in Central Time
    const now = new Date();
    const centralNow = new Date(now.toLocaleString("en-US", {timeZone: "America/Chicago"}));
    
    // If timezone conversion fails, use manual calculation
    if (isNaN(centralNow.getTime())) {
      console.log('[REMINDER] Timezone conversion failed, using manual calculation');
      const utcTime = now.getTime() + (now.getTimezoneOffset() * 60000);
      const centralOffset = -5; // CDT (adjust to -6 for CST if needed)
      const manualCentralTime = new Date(utcTime + (centralOffset * 3600000));
      var finalCentralTime = manualCentralTime;
    } else {
      var finalCentralTime = centralNow;
    }
    
    console.log(`[REMINDER] Current Central time: ${finalCentralTime.toLocaleString()}`);
    
    // Only set the test game ID once on startup
    if (!hasInitializedTestGame) {
      const gameIds = Object.keys(allGames);
      TEST_GAME_ID = gameIds.length > 0 ? gameIds[gameIds.length - 1] : null;
      
      if (TEST_GAME_ID) {
        console.log(`[REMINDER TEST] 🎯 Using most recent game for detailed logging: ${TEST_GAME_ID}`);
      }
      hasInitializedTestGame = true;
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
      
      // Only show detailed logging for the test game if something interesting is happening
      if (gameId === TEST_GAME_ID) {
        const hoursUntilReminder = Math.round((reminderTime.getTime() - finalCentralTime.getTime()) / (1000 * 60 * 60));
        
        // Only log if: sending reminders, within 1 hour, or first time seeing this game
        if (timeDifference <= fiveMinutes || Math.abs(hoursUntilReminder) <= 1) {
          console.log(`[REMINDER TEST] 🎯 Game ${gameId} at ${game.location}:`);
          console.log(`  Game time: ${gameTime.toLocaleString()}`);
          console.log(`  24-hour reminder time: ${reminderTime.toLocaleString()}`);
          console.log(`  Current time: ${finalCentralTime.toLocaleString()}`);
          console.log(`  Time difference: ${Math.round((reminderTime.getTime() - finalCentralTime.getTime()) / (1000 * 60))} minutes`);
        }
      }
      
      // Only send if we're within 5 minutes of the reminder time and it's not in the past
      if (timeDifference <= fiveMinutes && finalCentralTime >= reminderTime) {
        // Only log sending details for test game
        if (gameId === TEST_GAME_ID) {
          console.log(`[REMINDER TEST] ✅ Time to send 24-hour reminders for game ${gameId}`);
        } else {
          console.log(`[REMINDER] ✅ Sending reminders for game ${gameId}`);
        }
        
        // Send reminders to all confirmed players
        const confirmedPlayers = game.players || [];
        let remindersSent = 0;
        
        for (const player of confirmedPlayers) {
          // Skip players without phone numbers
          if (!player.phone) {
            console.log(`[REMINDER] Skipping ${player.name} - no phone number`);
            continue;
          }
          
          // Check if we already sent this player a 24-hour reminder
          const alreadySent = await hasReminderBeenSent(gameId, player.phone, 'twenty_four_hours');
          
          if (alreadySent) {
            console.log(`[REMINDER] Already sent 24-hour reminder to ${player.phone} for game ${gameId}`);
            continue;
          }
          
          // Format the game time and date for the message
          const gameTimeFormatted = formatTimeForSMS(game.time);
          const gameDateFormatted = formatDateForSMS(game.date);
          
          // Create the reminder message
// Include court number in location text like other SMS messages
let locationText = game.location;
if (game.courtNumber && game.courtNumber.trim()) {
  locationText += ` - ${game.courtNumber}`;
}

const reminderMessage = `🏓 Reminder: Your pickleball game is tomorrow at ${gameTimeFormatted} at ${locationText}. Looking forward to seeing you! Reply 2 for details or 9 to cancel.`;          
          // Send the SMS
          const smsResult = await sendSMS(player.phone, reminderMessage, gameId);
          
          if (smsResult.success) {
            // Mark that we sent this reminder
            await markReminderSent(gameId, player.phone, 'twenty_four_hours');
            remindersSent++;
            console.log(`[REMINDER] ✅ Sent 24-hour reminder to ${player.name} (${player.phone}) for game ${gameId}`);
          } else {
            console.error(`[REMINDER] ❌ Failed to send reminder to ${player.phone}:`, smsResult.error);
          }
        }
        
        if (remindersSent > 0) {
          console.log(`[REMINDER] 📤 Sent ${remindersSent} total reminders for game ${gameId} at ${game.location}`);
        } else {
          console.log(`[REMINDER] 📭 No reminders sent for game ${gameId} (no eligible players)`);
        }
      } else {
        // Only log detailed timing info for the test game
        if (gameId === TEST_GAME_ID) {
          const hoursUntilReminder = Math.round((reminderTime.getTime() - finalCentralTime.getTime()) / (1000 * 60 * 60));
          if (hoursUntilReminder > 0) {
            console.log(`[REMINDER TEST] ⏰ Game ${gameId} reminder in ${hoursUntilReminder} hours`);
          } else if (hoursUntilReminder < -24) {
            console.log(`[REMINDER TEST] ⏭️ Game ${gameId} is old, skipping`);
          } else {
            console.log(`[REMINDER TEST] ⏳ Game ${gameId} reminder window passed`);
          }
        }
      }
    }
    
    console.log('[REMINDER] ✅ Reminder check completed');
    
  } catch (error) {
    console.error('[REMINDER] ❌ Error in reminder system:', error);
  }
}

// Create game data function
function createGameData(formData) {
  console.log('[DEBUG] Creating game data, received:', formData);
  
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

  console.log('[DEBUG] Final notification preferences:', gameData.notificationPreferences);
  console.log('[DEBUG] Host phone:', gameData.hostPhone);

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
  
  if (cleanPhone && !isValidPhoneNumber(cleanPhone)) {
    throw new Error('Please enter a valid US phone number (e.g., (555) 123-4567)');
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

// Remove player from game (handles promotion from waitlist)
function removePlayerFromGame(game, playerId) {
  // Try to find in confirmed players
  const playerIndex = game.players.findIndex(p => p.id === playerId);
  
  if (playerIndex >= 0) {
    const removedPlayer = game.players.splice(playerIndex, 1)[0];
    
    let promotedPlayer = null;
    
    // Promote from waitlist if available
    if (game.waitlist && game.waitlist.length > 0) {
      promotedPlayer = game.waitlist.shift();
      game.players.push(promotedPlayer);
    }
    
    return { 
      status: 'removed',
      from: 'confirmed',
      removedPlayer,
      promotedPlayer,
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

// UPDATED: module.exports with new functions added
module.exports = {
  checkAndSendReminders,
  createGameData,
  validatePlayerData,
  checkExistingPlayer,
  addPlayerToGame,
  removePlayerFromGame,
  isValidPhoneNumber,
  formatPhoneNumber,
  isGameExpired,           // ADDED
  checkGameNotExpired      // ADDED
};