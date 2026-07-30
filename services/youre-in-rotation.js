const { getDevAsset } = require('../database');
const youreInMessages = require('../youre-in-messages');
const {
  formatDateForSMS,
  formatTimeForSMS,
  formatLocationForSMS
} = require('../utils/sms-format');
const { appendCustomReplyInstructions } = require('../sms-reply-options');
const { resolveRandomizedMessage } = require('./message-randomizer');
const { queuePoolRefill } = require('./message-generation');

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

async function buildSelectedPlayerMessage(
  game,
  position,
  recipientPhone = null,
  gameId = null,
  random
) {
  if (typeof recipientPhone === 'function') {
    random = recipientPhone;
    recipientPhone = null;
  } else if (typeof gameId === 'function') {
    random = gameId;
    gameId = null;
  }
  const location = formatLocationForSMS(game);
  const date = formatDateForSMS(game.date);
  const time = formatTimeForSMS(game.time);
  const details = `Pickleball at ${location} on ${date} at ${time}! You are Player ${position} of ${game.totalPlayers}. Reply 2 for who is playing and game details or 9 to cancel.`;
  const values = {
    LOCATION: location,
    DATE: date,
    TIME: time,
    POSITION: position,
    TOTAL_PLAYERS: game.totalPlayers
  };
  const config = await loadYoureInConfig();
  const legacyMessage = youreInMessages.build(
    config,
    details,
    values,
    random
  );
  const deterministicDetails = youreInMessages.renderTemplate(config.detailsTemplate, {
    ...values,
    DEFAULT_TEXT: details
  }).trim();
  const result = await resolveRandomizedMessage({
    personalityId: game.personalityId,
    surfaceId: 'youre-in',
    game,
    gameId: gameId || game.gameId || game.id || null,
    recipientPhone,
    templateValues: values,
    deterministicDetails,
    fallbackText: legacyMessage,
    random
  });
  if (result.personalityId) {
    queuePoolRefill({
      personalityId: result.personalityId,
      surfaceId: 'youre-in'
    });
  }
  return appendCustomReplyInstructions(result.text, 'player');
}

module.exports = {
  ASSET_NAME,
  loadYoureInConfig,
  buildYoureInMessage,
  buildSelectedPlayerMessage
};
