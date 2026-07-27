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
  'courtNumber',
  'date',
  'time',
  'duration',
  'totalPlayers',
  'message',
  'registrationMode'
];

const NOTIFICATION_FIELDS = [
  'gameFull',
  'playerJoins',
  'playerCancels',
  'oneSpotLeft',
  'waitlistStarts'
];

function applyGameUpdate(game, updateData = {}) {
  for (const field of EDITABLE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(updateData, field)) {
      game[field] = updateData[field];
    }
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
