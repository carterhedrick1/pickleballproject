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
const { getGameHostInfo } = require('../database');
const { verifySessionToken } = require('../services/host-verification');

function formatPhoneNumber(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
}

function isHost(game, token) {
  return Boolean(token) && Boolean(game) && game.hostToken === token;
}

function bearerToken(req) {
  const match = String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : '';
}

/**
 * Where a request may carry its game host token, in preference order.
 *
 * The X-Host-Token header is the intended transport (the roster routes already use it),
 * with Authorization: Bearer accepted for curl and tests. The body and query forms are
 * the historical transports and stay accepted so old pages and links keep working - but
 * a token in a query string lands in logs and browser history, which is why the
 * management page no longer sends one and the request logger redacts any that arrive.
 *
 * @param {import('express').Request} req
 * @returns {string} the supplied token, or '' when the request carries none
 */
function requestHostToken(req) {
  const headerToken = String(req.headers?.['x-host-token'] || '').trim();
  if (headerToken) return headerToken;
  const bearer = bearerToken(req);
  if (bearer) return bearer;
  if (req.body && typeof req.body.token === 'string' && req.body.token) return req.body.token;
  if (req.query && typeof req.query.token === 'string' && req.query.token) return req.query.token;
  return '';
}

/**
 * Strips token values out of a URL before it is logged. The request logger runs for every
 * call, and an old-style link or client may still put the host token in the query string.
 */
function redactTokenInUrl(url) {
  return String(url).replace(/([?&]token=)[^&]*/gi, '$1[redacted]');
}

function requireVerifiedHostPhone({ allowGameToken = false } = {}) {
  return async function verifyHostPhoneRequest(req, res, next) {
    const phone = formatPhoneNumber(req.params.phone || req.body?.phone);
    if (verifySessionToken(bearerToken(req), phone)) {
      req.verifiedHostPhone = phone;
      return next();
    }

    if (allowGameToken) {
      try {
        const gameId = req.headers['x-game-id'];
        const gameToken = req.headers['x-host-token'];
        const game = gameId ? await getGameHostInfo(gameId) : null;
        if (isHost(game, gameToken) && formatPhoneNumber(game.phone) === phone) {
          req.verifiedHostPhone = phone;
          return next();
        }
      } catch (error) {
        return next(error);
      }
    }

    return res.status(401).json({
      error: 'Verify this host phone number before viewing private organizer information.'
    });
  };
}

module.exports = { isHost, requireVerifiedHostPhone, requestHostToken, redactTokenInUrl };
