// game-logic.js - Game creation and reminder system
const validator = require('validator');
const { 
  getAllGames, 
  hasReminderBeenSent, 
  markReminderSent 
} = require('./database');
const { sendSMS, formatDateForSMS, formatTimeForSMS } = require('./sms-handler');

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

// Game reminder system
async function checkAndSendReminders() {
  try {
    console.log('[REMINDER] Checking for games that need reminders...');
    
    const allGames = await getAllGames();
    
    // Get current time in Central Time using a simple, reliable approach
    const now = new Date();
    
    // Simple approach: Get the time as if it were Central Time
    const centralNow = new Date(now.toLocaleString("en-US", {timeZone: "America/Chicago"}));
    
    // If that fails, fall back to manual calculation
    if (isNaN(centralNow.getTime())) {
      console.log('[REMINDER] Timezone conversion failed, using manual calculation');
      
      // Manual calculation as fallback
      const utcTime = now.getTime() + (now.getTimezoneOffset() * 60000);
      
      // For May 2025, we're definitely in CDT (UTC-5)
      const centralOffset = -5; // CDT
      const manualCentralTime = new Date(utcTime + (centralOffset * 3600000));
      
      console.log(`[REMINDER] Server time: ${now.toLocaleString()}`);
      console.log(`[REMINDER] Manual Central time: ${manualCentralTime.toLocaleString()}`);
      console.log(`[REMINDER] Using manual CDT calculation (UTC-5)`);
      
      // Use the manual calculation
      var finalCentralTime = manualCentralTime;
    } else {
      console.log(`[REMINDER] Server time: ${now.toLocaleString()}`);
      console.log(`[REMINDER] Central time: ${centralNow.toLocaleString()}`);
      
      // Use the timezone conversion
      var finalCentralTime = centralNow;
    }
    
    for (const [gameId, game] of Object.entries(allGames)) {
      // Skip cancelled games
      if (game.cancelled) {
        continue;
      }
      
      // Create game datetime (assuming game times are stored in Central Time)
      const gameDateTime = `${game.date}T${game.time}:00`;
      const gameTime = new Date(gameDateTime);
      
      // Calculate 2 hours before game time
      const twoHoursBefore = new Date(gameTime.getTime() - (2 * 60 * 60 * 1000));
      
      // Check if game is before 9am Central
      const gameHour = gameTime.getHours();
      const isEarlyMorningGame = gameHour < 9;
      
      // For early morning games, set reminder time to 8pm the night before
      let reminderTime;
      if (isEarlyMorningGame) {
        const nightBefore = new Date(gameTime);
        nightBefore.setDate(nightBefore.getDate() - 1);
        nightBefore.setHours(20, 0, 0, 0); // 8:00 PM
        reminderTime = nightBefore;
      } else {
        reminderTime = twoHoursBefore;
      }
      
      console.log(`[REMINDER] Game ${gameId} at ${game.location}:`);
      console.log(`  Game time: ${gameTime.toLocaleString()}`);
      console.log(`  Reminder time: ${reminderTime.toLocaleString()}`);
      console.log(`  Current Central time: ${finalCentralTime.toLocaleString()}`);
      
      // Check if it's time to send reminders (within 5 minutes of reminder time)
      const timeDiff = Math.abs(finalCentralTime.getTime() - reminderTime.getTime());
      const fiveMinutes = 5 * 60 * 1000;
      
      if (timeDiff <= fiveMinutes && finalCentralTime >= reminderTime) {
        console.log(`[REMINDER] Time to send reminders for game ${gameId}`);
        
        // Send reminders to all confirmed players
        const confirmedPlayers = game.players || [];
        let remindersSent = 0;
        
        for (const player of confirmedPlayers) {
          // Skip players without phone numbers
          if (!player.phone) {
            continue;
          }
          
          // Check if reminder already sent
          const reminderType = isEarlyMorningGame ? 'evening_before' : 'two_hours';
          const alreadySent = await hasReminderBeenSent(gameId, player.phone, reminderType);
          
          if (alreadySent) {
            console.log(`[REMINDER] Already sent ${reminderType} reminder to ${player.phone} for game ${gameId}`);
            continue;
          }
          
          // Format reminder message
          const gameTime = formatTimeForSMS(game.time);
          const gameDate = formatDateForSMS(game.date);
          
          let reminderMessage;
          if (isEarlyMorningGame) {
            reminderMessage = `🏓 Reminder: Your pickleball game is tomorrow morning at ${gameTime} at ${game.location}. Get a good night's sleep! Reply 2 for details or 9 to cancel.`;
          } else {
            reminderMessage = `🏓 Reminder: Your pickleball game starts in 2 hours at ${gameTime} at ${game.location}. See you on the court! Reply 2 for details or 9 to cancel.`;
          }
          
          // Send SMS
          const smsResult = await sendSMS(player.phone, reminderMessage, gameId);
          
          if (smsResult.success) {
            await markReminderSent(gameId, player.phone, reminderType);
            remindersSent++;
            console.log(`[REMINDER] Sent ${reminderType} reminder to ${player.name} (${player.phone}) for game ${gameId}`);
          } else {
            console.error(`[REMINDER] Failed to send reminder to ${player.phone}:`, smsResult.error);
          }
        }
        
        if (remindersSent > 0) {
          console.log(`[REMINDER] Sent ${remindersSent} reminders for game ${gameId} at ${game.location}`);
        }
      }
    }
    
  } catch (error) {
    console.error('[REMINDER] Error in reminder system:', error);
  }
}

// Game creation logic
function createGameData(formData) {
  const gameData = {
    location: formData.location,
    organizerName: formData.organizerName || 'Organizer',
    organizerPhone: formData.organizerPhone ? formatPhoneNumber(formData.organizerPhone) : '',
    organizerPlaying: formData.organizerPlaying,
    date: formData.date,
    time: formData.time,
    duration: parseInt(formData.duration),
    totalPlayers: parseInt(formData.totalPlayers),
    message: formData.message,
    waitlist: []
  };

  // Set up initial players list
  if (gameData.organizerPlaying) {
    gameData.players = [
      { 
        id: 'organizer', 
        name: gameData.organizerName, 
        phone: gameData.organizerPhone,
        isOrganizer: true 
      }
    ];
  } else {
    gameData.players = [];
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
  
  if (forceWaitlist || spotsAvailable <= 0) {
    if (!game.waitlist) {
      game.waitlist = [];
    }
    game.waitlist.push(newPlayer);
    
    return {
      status: 'waitlist',
      position: game.waitlist.length,
      playerId: newPlayer.id,
      reason: spotsAvailable <= 0 ? 'game_full' : 'requested'
    };
  } else {
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

module.exports = {
  checkAndSendReminders,
  createGameData,
  validatePlayerData,
  checkExistingPlayer,
  addPlayerToGame,
  removePlayerFromGame,
  isValidPhoneNumber,
  formatPhoneNumber
};