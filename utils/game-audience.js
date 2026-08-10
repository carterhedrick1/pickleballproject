/**
 * Who is attached to a game, and in what capacity.
 *
 * The announcement route used to text whatever phone numbers arrived in the request body. The
 * roster is the authority on who a host can reach, so every send looks the recipient up here
 * first: it decides whether the number belongs to this game at all, and which randomizer
 * audience rules apply to them.
 */
const { formatPhoneNumber } = require('./sms-format');

// Order matters: someone who cancelled and then re-joined is confirmed, not out.
const AUDIENCE_GROUPS = [
  ['confirmed', 'players'],
  ['waitlist', 'waitlist'],
  ['out', 'outPlayers']
];

function findOnGame(game, phone) {
  const normalized = formatPhoneNumber(phone);
  if (!normalized || !game) return null;

  for (const [type, key] of AUDIENCE_GROUPS) {
    const player = (game[key] || []).find(
      (entry) => entry && formatPhoneNumber(entry.phone) === normalized
    );
    if (player) {
      return { player, type, isOrganizer: Boolean(player.isOrganizer) };
    }
  }

  return null;
}

/** Everyone on the game a host can text, in roster order. */
function textableAudience(game) {
  const audience = [];
  for (const [type, key] of AUDIENCE_GROUPS) {
    for (const player of game?.[key] || []) {
      if (player && player.phone && !player.isOrganizer) {
        audience.push({ player, type });
      }
    }
  }
  return audience;
}

module.exports = {
  AUDIENCE_GROUPS,
  findOnGame,
  textableAudience
};
