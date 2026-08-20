// Whether a game is still open for new public signups.
//
// The browser hides the signup form (public/js/game-utils.js getGameStatus) when a game is
// cancelled or has ended, but the API is reachable without the browser, so the same rule is
// enforced here - inside the per-game lock, by services/player-service.js - before any join
// transition runs. The cutoff deliberately matches the browser: signups stay open through
// the game itself and close when it ends (start + duration), because a late "IN" while
// people are already on the court is still useful to the host.
//
// Host actions (manual add) and departures (OUT tap, SMS reply 9) are deliberately not
// gated: hosts correct rosters after the fact, and someone must always be able to leave.
const { hasGameEnded } = require('../utils/central-time');

const JOIN_BLOCKED_STATUSES = Object.freeze(['game_cancelled', 'game_ended']);

function joinRejection(game, { ended = hasGameEnded } = {}) {
  if (!game) return null;
  if (game.cancelled) return 'game_cancelled';
  if (ended(game.date, game.time, game.duration)) return 'game_ended';
  return null;
}

module.exports = { joinRejection, JOIN_BLOCKED_STATUSES };
