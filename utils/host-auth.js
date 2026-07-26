/**
 * The one place that decides whether a caller is the host of a game.
 *
 * This check used to be inlined at sixteen call sites in two different spellings - half wrote
 * `game.hostToken !== token` and half wrote `!token || game.hostToken !== token`. Both behave
 * identically today, because `host_token TEXT NOT NULL` in both schemas (database.js) means
 * `game.hostToken` is never null or undefined and so never matches a missing token. The risk
 * was never the sixteen that exist; it was the seventeenth being written from memory.
 *
 * Deliberately a plain function rather than Express middleware. Several handlers take the
 * per-game lock and *then* load the game inside it (see the PUT /api/games/:id handler in
 * server.js). Middleware would have to load the game before the lock and hand over an object
 * read outside it - reintroducing exactly the read-modify-write race utils/game-lock.js exists
 * to prevent.
 *
 * @param {object|null} game - a game record, or the smaller object getGameHostInfo returns
 * @param {string|undefined} token - the token the caller supplied
 * @returns {boolean} true only when the caller proved they are the host
 */
function isHost(game, token) {
  return Boolean(token) && Boolean(game) && game.hostToken === token;
}

module.exports = { isHost };
