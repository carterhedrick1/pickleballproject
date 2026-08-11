const {
  promoteNextFromWaitlist,
  recordOutPlayer
} = require('../utils/promotion');

function transitionResult(game, values = {}) {
  return {
    game,
    player: null,
    previousStatus: null,
    status: null,
    promotedPlayer: null,
    outEntry: null,
    changed: false,
    ...values
  };
}

function findExistingPlayer(game, phone) {
  if (!phone) return null;

  const confirmed = (game.players || []).find((player) => player.phone === phone);
  if (confirmed) return { player: confirmed, status: 'confirmed' };

  const waitlisted = (game.waitlist || []).find((player) => player.phone === phone);
  if (waitlisted) return { player: waitlisted, status: 'waitlist' };

  return null;
}

/**
 * Where a phone number stands in this game, for the player holding that phone.
 *
 * The game page asks this on load so a returning player sees their own status instead of an
 * empty signup form. It reports only the caller's own row - never anybody else's - because the
 * only thing proving who they are is that they typed this number into the form once already.
 *
 * @returns {{status: 'confirmed'|'waitlist'|'out'|'none', name?: string, position?: number|null,
 *   totalPlayers?: number, hidePosition?: boolean, isOrganizer?: boolean}}
 */
function describePlayerStatus(game, phone) {
  if (!game || !phone) return { status: 'none' };

  const confirmedIndex = (game.players || []).findIndex((player) => player.phone === phone);
  if (confirmedIndex >= 0) {
    const player = game.players[confirmedIndex];
    return {
      status: 'confirmed',
      name: player.name || '',
      position: confirmedIndex + 1,
      totalPlayers: parseInt(game.totalPlayers, 10) || game.players.length,
      isOrganizer: player.isOrganizer === true
    };
  }

  const waitingIndex = (game.waitlist || []).findIndex((player) => player.phone === phone);
  if (waitingIndex >= 0) {
    // Approval mode keeps the queue private: the host picks whoever they want, so a position
    // number would imply an order that does not decide anything.
    const approvalMode = game.registrationMode === 'waitlist';
    return {
      status: 'waitlist',
      name: game.waitlist[waitingIndex].name || '',
      position: approvalMode ? null : waitingIndex + 1,
      hidePosition: approvalMode
    };
  }

  const departed = (game.outPlayers || []).find((player) => player.phone === phone);
  if (departed) {
    return { status: 'out', name: departed.name || '' };
  }

  return { status: 'none' };
}

function joinPlayer(game, playerData, { forceWaitlist = false, id, now } = {}) {
  const existing = findExistingPlayer(game, playerData.phone);
  if (existing) {
    return transitionResult(game, {
      player: existing.player,
      previousStatus: existing.status,
      status: 'duplicate',
      duplicateStatus: existing.status
    });
  }

  if (!game.players) game.players = [];
  if (!game.waitlist) game.waitlist = [];

  const totalPlayers = parseInt(game.totalPlayers) || 4;
  const spotsAvailable = totalPlayers - game.players.length;
  const player = {
    id: id || Date.now().toString(36) + Math.random().toString(36).substring(2, 6),
    ...playerData,
    joinedAt: now || new Date().toISOString(),
    isOrganizer: false
  };
  const approvalMode = game.registrationMode === 'waitlist';

  if (approvalMode || forceWaitlist || spotsAvailable <= 0) {
    game.waitlist.push(player);
    return transitionResult(game, {
      player,
      status: 'waitlist',
      changed: true,
      position: approvalMode ? null : game.waitlist.length,
      reason: approvalMode ? 'waitlist_mode' : (spotsAvailable <= 0 ? 'game_full' : 'requested'),
      hidePosition: approvalMode
    });
  }

  game.players.push(player);
  return transitionResult(game, {
    player,
    status: 'confirmed',
    changed: true,
    position: game.players.length,
    totalPlayers
  });
}

function locatePlayer(game, { playerId, phone } = {}) {
  const matches = (player) =>
    (playerId && player.id === playerId) || (phone && player.phone === phone);

  const confirmedIndex = (game.players || []).findIndex(matches);
  if (confirmedIndex >= 0) {
    return { collection: game.players, index: confirmedIndex, status: 'confirmed' };
  }

  const waitlistIndex = (game.waitlist || []).findIndex(matches);
  if (waitlistIndex >= 0) {
    return { collection: game.waitlist, index: waitlistIndex, status: 'waitlist' };
  }

  return null;
}

/**
 * A roster entry that this person plausibly is, but that tapping OUT cannot remove.
 *
 * locatePlayer matches on player id or phone number. A player the host typed in without a
 * number has neither, so their own OUT finds nothing, records a separate "out" entry, and
 * leaves them on the roster - the player believes they are off, the host still sees them
 * playing, and neither of them is told. This spots that specific disagreement so it can be
 * said out loud rather than papered over.
 *
 * Deliberately does NOT remove anybody: the game page shows the roster to anyone holding the
 * link, so matching a name alone would let a stranger drop a player from the game.
 */
function findUnreachableRosterEntry(game, name) {
  const wanted = String(name || '').trim().toLowerCase();
  if (!wanted) return null;

  const entries = [...(game.players || []), ...(game.waitlist || [])];
  return entries.find((entry) => (
    !entry.phone && String(entry.name || '').trim().toLowerCase() === wanted
  )) || null;
}

function leavePlayer(
  game,
  identity,
  { recordUnknown = false, protectOrganizer = true, now } = {}
) {
  const found = locatePlayer(game, identity);

  if (!found) {
    if (!recordUnknown) {
      return transitionResult(game, { status: 'not_found' });
    }

    const player = {
      name: identity.name || '',
      phone: identity.phone || ''
    };
    if (identity.isAndroid !== undefined) player.isAndroid = identity.isAndroid;
    const outEntry = recordOutPlayer(game, player, {});
    if (now) outEntry.outAt = now;

    return transitionResult(game, {
      player,
      status: 'out',
      outEntry,
      changed: true
    });
  }

  const player = found.collection[found.index];
  if (protectOrganizer && player.isOrganizer) {
    return transitionResult(game, {
      player,
      previousStatus: found.status,
      status: 'organizer'
    });
  }

  found.collection.splice(found.index, 1);
  const outEntry = recordOutPlayer(
    game,
    { ...player, isAndroid: identity.isAndroid ?? player.isAndroid },
    found.status === 'confirmed' ? { wasConfirmed: true } : { wasWaitlisted: true }
  );
  if (now) outEntry.outAt = now;

  const promotedPlayer =
    found.status === 'confirmed' ? promoteNextFromWaitlist(game) : null;

  return transitionResult(game, {
    player,
    previousStatus: found.status,
    status: 'out',
    promotedPlayer,
    outEntry,
    changed: true
  });
}

function removePlayer(game, playerId) {
  const found = locatePlayer(game, { playerId });
  if (!found) return transitionResult(game, { status: 'not_found' });

  // The organizer's seat is reserved by organizerPlaying, which no host tool can turn off
  // afterwards. Splicing them out of the roster would leave the game permanently short a
  // player with no way to correct it, so their own row is not removable.
  const target = found.collection[found.index];
  if (target.isOrganizer) {
    return transitionResult(game, {
      player: target,
      previousStatus: found.status,
      status: 'organizer',
      isOrganizer: true
    });
  }

  const player = found.collection.splice(found.index, 1)[0];
  const promotedPlayer =
    found.status === 'confirmed' ? promoteNextFromWaitlist(game) : null;

  return transitionResult(game, {
    player,
    previousStatus: found.status,
    status: 'removed',
    promotedPlayer,
    changed: true,
    isOrganizer: Boolean(player.isOrganizer)
  });
}

function movePlayerToWaitlist(game, playerId) {
  const index = (game.players || []).findIndex((player) => player.id === playerId);
  if (index < 0) return transitionResult(game, { status: 'not_found' });

  // Same reservation problem as removePlayer: the organizer cannot waitlist themselves out
  // of the seat that organizerPlaying keeps counting.
  if (game.players[index].isOrganizer) {
    return transitionResult(game, {
      player: game.players[index],
      previousStatus: 'confirmed',
      status: 'organizer',
      isOrganizer: true
    });
  }

  if (!game.waitlist) game.waitlist = [];
  const player = game.players.splice(index, 1)[0];
  game.waitlist.push(player);

  return transitionResult(game, {
    player,
    previousStatus: 'confirmed',
    status: 'waitlist',
    changed: true,
    position: game.waitlist.length
  });
}

function promotePlayer(game, playerId, { now } = {}) {
  if ((game.players || []).length >= parseInt(game.totalPlayers)) {
    return transitionResult(game, { status: 'full' });
  }

  const index = (game.waitlist || []).findIndex((player) => player.id === playerId);
  if (index < 0) return transitionResult(game, { status: 'not_found' });

  const player = game.waitlist.splice(index, 1)[0];
  player.promotedAt = now || new Date().toISOString();
  game.players.push(player);

  return transitionResult(game, {
    player,
    previousStatus: 'waitlist',
    status: 'confirmed',
    changed: true,
    position: game.players.length
  });
}

module.exports = {
  findExistingPlayer,
  findUnreachableRosterEntry,
  describePlayerStatus,
  joinPlayer,
  leavePlayer,
  removePlayer,
  movePlayerToWaitlist,
  promotePlayer
};
