const { getGame, saveGame } = require('../database');
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

async function runTransition(
  gameId,
  transition,
  args,
  { token, hostOnly = false, publicSignup = false } = {}
) {
  const releaseLock = await acquireGameLock(gameId);
  try {
    const game = await getGame(gameId);
    if (!game) {
      return {
        game: null,
        player: null,
        previousStatus: null,
        status: 'game_not_found',
        promotedPlayer: null,
        outEntry: null,
        changed: false
      };
    }

    // Definitive signup policy, enforced here inside the lock rather than in the browser:
    // a direct API call must not be able to join a cancelled or finished game.
    if (publicSignup) {
      const blocked = joinRejection(game);
      if (blocked) {
        return {
          game,
          player: null,
          previousStatus: null,
          status: blocked,
          promotedPlayer: null,
          outEntry: null,
          changed: false
        };
      }
    }

    if (hostOnly && !isHost(game, token)) {
      return {
        game,
        player: null,
        previousStatus: null,
        status: 'unauthorized',
        promotedPlayer: null,
        outEntry: null,
        changed: false
      };
    }

    const result = transition(game, ...args);
    if (result.changed) {
      await saveGame(gameId, game, game.hostToken, game.hostPhone);
    }
    return result;
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
