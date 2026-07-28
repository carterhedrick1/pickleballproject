const { getDevAsset } = require('../database');
const youreInMessages = require('../youre-in-messages');
const {
  formatDateForSMS,
  formatTimeForSMS,
  formatLocationForSMS
} = require('../utils/sms-format');

const ASSET_NAME = 'youre-in-config';

async function loadYoureInConfig() {
  try {
    const saved = await getDevAsset(ASSET_NAME);
    if (!saved) return youreInMessages.normalizeConfig();
    return youreInMessages.normalizeConfig(JSON.parse(saved.content));
  } catch (error) {
    console.error('Error loading You\'re In message configuration:', error.message);
    return youreInMessages.normalizeConfig();
  }
}

async function buildYoureInMessage(details, values = {}, random) {
  return youreInMessages.build(await loadYoureInConfig(), details, values, random);
}

async function buildSelectedPlayerMessage(game, position, random) {
  const location = formatLocationForSMS(game);
  const date = formatDateForSMS(game.date);
  const time = formatTimeForSMS(game.time);
  const details = `Pickleball at ${location} on ${date} at ${time}! You are Player ${position} of ${game.totalPlayers}. Reply 2 for who is playing and game details or 9 to cancel.`;
  return buildYoureInMessage(
    details,
    {
      LOCATION: location,
      DATE: date,
      TIME: time,
      POSITION: position,
      TOTAL_PLAYERS: game.totalPlayers
    },
    random
  );
}

module.exports = {
  ASSET_NAME,
  loadYoureInConfig,
  buildYoureInMessage,
  buildSelectedPlayerMessage
};
