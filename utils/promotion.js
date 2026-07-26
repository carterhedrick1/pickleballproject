// What happens when somebody gives up a spot.
//
// This lives in its own module rather than in game-logic.js because sms-handler.js needs the
// same rules, and game-logic.js already requires sms-handler.js - putting them there and
// requiring it back would be a cycle.
//
// The rule these enforce: automatic promotion happens in first-come-first-served games only.
// In approval ("waitlist") mode the host picks who plays, so the app must never quietly pick
// for them - it tells them a spot opened instead.

/** House-style short id, matching the ones generated elsewhere for players. */
const newId = () => Date.now().toString(36) + Math.random().toString(36).substring(2, 6);

/**
 * Moves the first person on the waitlist onto the roster.
 * @returns the promoted player, or null if nobody was promoted (approval mode, or nobody waiting).
 */
function promoteNextFromWaitlist(game) {
  if (game.registrationMode === 'waitlist') return null;
  if (!game.waitlist || game.waitlist.length === 0) return null;

  const promoted = game.waitlist.shift();
  promoted.promotedAt = new Date().toISOString();
  game.players.push(promoted);
  return promoted;
}

/**
 * Records that somebody is not playing, deduped by phone number so that tapping OUT twice
 * (or texting 9 after tapping OUT) leaves one entry rather than several.
 *
 * The entry keeps joinedAt, because the management page reads it, and adds outAt as the
 * timestamp that actually means "when they pulled out".
 *
 * @param {object} player          the player leaving - or just { name, phone } for an RSVP of no
 * @param {boolean} wasConfirmed   they were on the roster (this opened a spot)
 * @param {boolean} wasWaitlisted  they were on the waitlist
 * @returns the outPlayers entry, new or updated
 */
function recordOutPlayer(game, player, { wasConfirmed = false, wasWaitlisted = false } = {}) {
  if (!game.outPlayers) game.outPlayers = [];

  const now = new Date().toISOString();
  const phone = player.phone || '';

  // Only entries with a phone can be matched up; two phoneless "Daves" are not necessarily
  // the same Dave, so those are always recorded separately.
  const existing = phone ? game.outPlayers.find((p) => p.phone === phone) : null;

  if (existing) {
    existing.outAt = now;
    existing.wasConfirmed = existing.wasConfirmed || wasConfirmed;
    existing.wasWaitlisted = existing.wasWaitlisted || wasWaitlisted;
    if (player.name) existing.name = player.name;
    return existing;
  }

  const entry = {
    id: newId(),
    name: player.name || '',
    phone,
    joinedAt: player.joinedAt || now,
    outAt: now,
    wasConfirmed,
    wasWaitlisted
  };
  if (player.isAndroid !== undefined) entry.isAndroid = player.isAndroid;

  game.outPlayers.push(entry);
  return entry;
}

/**
 * Which alert the host should get when somebody leaves.
 *
 * Losing a confirmed player in approval mode is the one case the host has to act on: nobody
 * is promoted automatically, so without a nudge the spot just stays empty.
 *
 * Call this AFTER the departure and any promotion have been applied to the game.
 */
function departureAlertType(game, wasConfirmed) {
  const nobodyWasPromoted = game.registrationMode === 'waitlist';
  if (wasConfirmed && nobodyWasPromoted && (game.waitlist || []).length > 0) {
    return 'spotOpenedWaitlistMode';
  }
  return 'playerCancels';
}

module.exports = { promoteNextFromWaitlist, recordOutPlayer, departureAlertType };
