// game-logic.js - Game creation and validation compatibility facade
const validator = require('validator');
const { formatPhoneNumber } = require('./utils/sms-format');
const reminders = require('./services/reminders');
reminders.resetReminderState();
const { checkAndSendReminders } = reminders;
const PlayerCapacity = require('./public/js/player-capacity');
const {
  findExistingPlayer,
  joinPlayer,
  removePlayer
} = require('./domain/player-transitions');
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
      message: "This game has already ended, so it's no longer accepting sign-ups."
    };
  }
  return { error: false };
}

// Create game data function
function createGameData(formData) {
  if (DEBUG) console.log('[DEBUG] Creating game data, received:', formData);

  const organizerPlaying = formData.organizerPlaying === true ||
    formData.organizerPlaying === 'true' ||
    formData.organizerPlaying === 'on';
  const hasAdditionalPlayerCount =
    Object.prototype.hasOwnProperty.call(formData, 'playersNeeded');
  const totalPlayers = hasAdditionalPlayerCount
    ? PlayerCapacity.totalFromAdditional(formData.playersNeeded, organizerPlaying)
    : parseInt(formData.totalPlayers);
  
  const gameData = {
    location: formData.location,
    organizerName: formData.organizerName || 'Organizer',
    organizerPhone: formData.organizerPhone ? formatPhoneNumber(formData.organizerPhone) : '',
    organizerPlaying,
    date: formData.date,
    time: formData.time,
    duration: parseInt(formData.duration),
    totalPlayers,
    message: formData.message,
    registrationMode: formData.registrationMode || 'fcfs',
    personalityId: String(formData.personalityId || '').trim() || 'realist',
    invitedPlayers: [],
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
  gameData.outPlayers = [];
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
  }

  return gameData;
}

// Player validation and processing
function validatePlayerData(name, phone) {
  const cleanName = name ? name.trim() : '';
  const cleanPhone = phone ? phone.trim() : '';
  
  if (!cleanName) {
    throw new Error('Player name is required.');
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
        throw new Error('Please enter a valid US phone number — for example 555-123-4567.');
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

  const existing = findExistingPlayer(game, formattedPhone);
  if (existing?.status === 'confirmed') {
    return { exists: true, location: 'confirmed', message: 'This phone number is already registered for this game.' };
  }
  if (existing?.status === 'waitlist') {
    return { exists: true, location: 'waitlist', message: 'This phone number is already on the waitlist.' };
  }
  
  return { exists: false };
}

// Add player to game (handles both confirmed and waitlist)
function addPlayerToGame(game, playerData, forceWaitlist = false) {
  const result = joinPlayer(game, playerData, { forceWaitlist });
  return {
    status: result.status,
    position: result.position,
    playerId: result.player?.id,
    reason: result.reason,
    hidePosition: result.hidePosition,
    totalPlayers: result.totalPlayers
  };
}

function removePlayerFromGame(game, playerId) {
  const result = removePlayer(game, playerId);
  return {
    status: result.status,
    from: result.previousStatus,
    removedPlayer: result.player,
    promotedPlayer: result.promotedPlayer,
    isOrganizer: result.isOrganizer
  };
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
