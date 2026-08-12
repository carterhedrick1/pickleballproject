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

/**
 * What changed for a player who was waiting, said before the game facts.
 *
 * A promoted player reads the same rotating "You're IN" opening as a fresh signup, so without
 * this line there is nothing in the text to tell them their status moved. In approval mode
 * nobody is promoted automatically - the host chose them - so it says so.
 */
function promotionLead(game) {
  return game.registrationMode === 'waitlist'
    ? 'The organizer picked you.'
    : "A spot opened up, so you're off the waitlist.";
}

async function buildRosterMessage(
  game,
  position,
  { recipientPhone = null, gameId = null, random, promoted = false } = {}
) {
  const location = formatLocationForSMS(game);
  const date = formatDateForSMS(game.date);
  const time = formatTimeForSMS(game.time);
  const details = `Pickleball at ${location} on ${date} at ${time}! You are Player ${position} of ${game.totalPlayers}. Reply 2 for who is playing and game details, or 9 to cancel.`;
  const values = {
    LOCATION: location,
    DATE: date,
    TIME: time,
    POSITION: position,
    TOTAL_PLAYERS: game.totalPlayers
  };
  const config = await loadYoureInConfig();
  // The lead is attached to the rendered details rather than to the text handed in as
  // {DEFAULT_TEXT}, so a custom details template cannot end up stating it twice.
  const renderedDetails = youreInMessages.renderTemplate(config.detailsTemplate, {
    ...values,
    DEFAULT_TEXT: details
  }).trim();
  const deterministicDetails = promoted
    ? `${promotionLead(game)} ${renderedDetails}`.trim()
    : renderedDetails;
  // Matches what youreInMessages.build() produces, with the promotion lead included.
  const legacyMessage = `${youreInMessages.choose(config, random)}\n\n${deterministicDetails}`.trim();
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

/** The text for somebody who just signed up and got a spot straight away. */
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
  return buildRosterMessage(game, position, { recipientPhone, gameId, random });
}

/** The text for somebody moved onto the roster from the waitlist or applicant list. */
async function buildPromotionMessage(
  game,
  position,
  recipientPhone = null,
  gameId = null,
  random
) {
  return buildRosterMessage(game, position, {
    recipientPhone,
    gameId,
    random,
    promoted: true
  });
}

module.exports = {
  ASSET_NAME,
  loadYoureInConfig,
  buildYoureInMessage,
  promotionLead,
  buildSelectedPlayerMessage,
  buildPromotionMessage
};
