// game-logic.js - Game creation and validation compatibility facade
//
// This used to call resetReminderState() at require time, which meant merely importing a
// validation helper wiped the reminder dedup caches. Rigs that want a clean reminder
// state (verify/reminder-catchup.js) now call resetReminderState() themselves.
const { formatPhoneNumber, isValidUsPhone } = require('./utils/sms-format');
const { checkAndSendReminders } = require('./services/reminders');
const PlayerCapacity = require('./public/js/player-capacity');
const {
  findExistingPlayer,
  joinPlayer,
  removePlayer
} = require('./domain/player-transitions');
const DEBUG = process.env.DEBUG === 'true' || process.env.DEBUG === '1';

// Validation functions.
//
// The validator library is gone: its isMobilePhone check was wrapped in so many fallbacks
// (a try/catch here, a lenient 10-15 digit branch in validatePlayerData, another in the
// signup route) that any 10-15 digit string was accepted anyway. One shared digits-only
// rule in utils/sms-format.js now decides, and it matches what Textbelt can deliver to.
//
// The old isGameExpired/checkGameNotExpired pair that lived here was dead code no route
// called; the live signup cutoff is domain/join-policy.js, enforced by the player service.
function isValidPhoneNumber(phoneNumber) {
  return isValidUsPhone(phoneNumber);
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
  
  if (cleanPhone && !isValidPhoneNumber(cleanPhone)) {
    throw new Error('Please enter a valid US phone number — for example 555-123-4567.');
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
  isValidPhoneNumber
};
