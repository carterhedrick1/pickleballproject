// Builds the stored game object from what the create-game form submitted.
//
// This was the only real construction logic inside the old game-logic.js facade. It lives in
// domain/ next to join-policy.js and player-transitions.js because it is the same kind of
// thing: rules about a game, with no HTTP or persistence attached.
const { formatPhoneNumber } = require('../utils/sms-format');
const PlayerCapacity = require('../public/js/player-capacity');

const DEBUG = process.env.DEBUG === 'true' || process.env.DEBUG === '1';

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

module.exports = {
  createGameData
};
