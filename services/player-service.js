const { updateGame } = require('../database/games');
const { acquireGameLock } = require('../utils/game-lock');
const { isHost } = require('../utils/host-auth');
const { joinRejection } = require('../domain/join-policy');
const {
  joinPlayer,
  leavePlayer,
  removePlayer,
  movePlayerToWaitlist,
  promotePlayer
} = require('../domain/player-transitions');

/**
 * Every roster change goes through here: load the game, decide, mutate, save.
 *
 * Two layers keep a change from being lost. The in-process lock queues requests for the
 * same game behind each other, and updateGame() compares versions at the database, which is
 * what protects a game from a second app instance. When the version check refuses a write,
 * the whole body below runs again on the newer game - so a signup that raced with another
 * signup is re-decided against the roster as it now stands, and can correctly come back as
 * waitlisted rather than confirmed.
 */
async function runTransition(
  gameId,
  transition,
  args,
  { token, hostOnly = false, publicSignup = false } = {}
) {
  const declined = (game, status) => ({
    save: false,
    result: {
      game,
      player: null,
      previousStatus: null,
      status,
      promotedPlayer: null,
      outEntry: null,
      changed: false
    }
  });

  const releaseLock = await acquireGameLock(gameId);
  try {
    return await updateGame(gameId, (game) => {
      if (!game) return declined(null, 'game_not_found');

      // Definitive signup policy, enforced here inside the lock rather than in the browser:
      // a direct API call must not be able to join a cancelled or finished game.
      if (publicSignup) {
        const blocked = joinRejection(game);
        if (blocked) return declined(game, blocked);
      }

      if (hostOnly && !isHost(game, token)) return declined(game, 'unauthorized');

      const result = transition(game, ...args);
      return { save: Boolean(result.changed), result };
    });
  } finally {
    releaseLock();
  }
}

function joinGame(gameId, playerData, options) {
  return runTransition(gameId, joinPlayer, [playerData, options], { publicSignup: true });
}

function joinGameAsHost(gameId, playerData, options, token) {
  return runTransition(
    gameId,
    joinPlayer,
    [playerData, options],
    { token, hostOnly: true }
  );
}

function leaveGame(gameId, identity, options) {
  return runTransition(gameId, leavePlayer, [identity, options]);
}

function moveToWaitlist(gameId, playerId, token) {
  return runTransition(
    gameId,
    movePlayerToWaitlist,
    [playerId],
    { token, hostOnly: true }
  );
}

function promoteFromWaitlist(gameId, playerId, token) {
  return runTransition(
    gameId,
    promotePlayer,
    [playerId],
    { token, hostOnly: true }
  );
}

function removeFromGame(gameId, playerId, token) {
  return runTransition(
    gameId,
    removePlayer,
    [playerId],
    { token, hostOnly: true }
  );
}

module.exports = {
  runTransition,
  joinGame,
  joinGameAsHost,
  leaveGame,
  moveToWaitlist,
  promoteFromWaitlist,
  removeFromGame
};
