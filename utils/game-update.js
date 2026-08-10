/**
 * Applies the fields a host is allowed to edit.
 *
 * The management endpoint used to Object.assign the entire request body onto the
 * persisted game. Keeping the allowlist here makes the API tolerant of old clients
 * that send extra properties without letting those properties overwrite protected
 * state such as the host token, roster, cancellation flags, or timestamps.
 */
const EDITABLE_FIELDS = [
  'location',
  'date',
  'time',
  'duration',
  'totalPlayers',
  'message',
  'registrationMode',
  'personalityId',
  // A host who signed up to play and then cannot had no way out: the roster refuses to remove
  // the organizer, and this flag reserves their seat in the capacity maths forever. Editing it
  // has to move them on or off the roster too, which applyOrganizerPlaying does below.
  'organizerPlaying'
];

const NOTIFICATION_FIELDS = [
  'gameFull',
  'playerJoins',
  'playerCancels',
  'oneSpotLeft',
  'waitlistStarts'
];

/**
 * Keeps the roster honest about whether the organizer is playing.
 *
 * The flag and the roster are two halves of the same fact. Setting one without the other is how
 * a game ends up reserving a seat for somebody who is not on the list, or listing somebody the
 * capacity maths does not count.
 */
function applyOrganizerPlaying(game, playing) {
  if (!Array.isArray(game.players)) game.players = [];
  const index = game.players.findIndex((player) => player && player.isOrganizer);

  if (playing && index < 0) {
    game.players.push({
      id: 'organizer',
      name: game.organizerName || 'Organizer',
      phone: game.organizerPhone || '',
      isOrganizer: true,
      joinedAt: new Date().toISOString()
    });
  } else if (!playing && index >= 0) {
    game.players.splice(index, 1);
  }
}

function applyGameUpdate(game, updateData = {}) {
  const hasAdditionalPlayerCount =
    Object.prototype.hasOwnProperty.call(updateData, 'playersNeeded');

  for (const field of EDITABLE_FIELDS) {
    if (field === 'totalPlayers' && hasAdditionalPlayerCount) continue;
    if (Object.prototype.hasOwnProperty.call(updateData, field)) {
      game[field] = field === 'organizerPlaying'
        ? updateData[field] === true
        : updateData[field];
    }
  }

  // Ordered deliberately: the roster and then the capacity maths both read the new value, so
  // this has to settle before totalPlayers is worked out from the additional-player count.
  if (Object.prototype.hasOwnProperty.call(updateData, 'organizerPlaying')) {
    applyOrganizerPlaying(game, game.organizerPlaying === true);
  }

  if (hasAdditionalPlayerCount) {
    const PlayerCapacity = require('../public/js/player-capacity');
    game.totalPlayers = PlayerCapacity.totalFromAdditional(
      updateData.playersNeeded,
      game.organizerPlaying === true
    );
  }

  if (updateData.notificationPreferences &&
      typeof updateData.notificationPreferences === 'object') {
    const existing = game.notificationPreferences || {};
    game.notificationPreferences = { ...existing };

    for (const field of NOTIFICATION_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(updateData.notificationPreferences, field)) {
        game.notificationPreferences[field] =
          updateData.notificationPreferences[field] === true;
      }
    }
  }

  return game;
}

module.exports = {
  EDITABLE_FIELDS,
  NOTIFICATION_FIELDS,
  applyGameUpdate
};
