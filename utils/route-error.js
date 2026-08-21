/**
 * Ends a failed request exactly the way the route always did, and records it where it can
 * actually be seen.
 *
 * Every route used to handle its own failures with `console.error` plus a 500, and none of
 * them called `logAppError`. That meant the developer area's Errors tab only ever showed
 * browser errors and outright process crashes - an ordinary failed save was invisible.
 *
 * `userMessage` is passed in rather than derived from the error. The frontend reads `error`
 * off these response bodies (`throw new Error(errorData.error || ...)` in
 * public/js/manage-scripts.js), so the wording a host sees must not change.
 */
const { logAppError } = require('../database/dev');

// A save refused because the game moved on is not a fault: the caller read an older copy.
// 409 says exactly that, and the wording tells a host what to do about it. Routes that
// retry (everything roster-related, via updateGame) never reach here.
const VERSION_CONFLICT_STATUS = 409;
const VERSION_CONFLICT_MESSAGE =
  'This game just changed somewhere else. Refresh the page and try that again.';

function routeFailed(req, res, error, userMessage, status = 500) {
  if (error && error.code === 'GAME_VERSION_CONFLICT') {
    console.warn(`${req.method} ${req.url} refused a stale write:`, error.message);
    if (res.headersSent) return;
    res.status(VERSION_CONFLICT_STATUS).json({ error: VERSION_CONFLICT_MESSAGE });
    return;
  }

  console.error(`${req.method} ${req.url} failed:`, error);

  // Deliberately not awaited. logAppError has its own try/catch and never rejects, so this
  // can neither become an unhandled rejection nor hold up the response to the player.
  logAppError('server', {
    message: error && error.message ? error.message : String(error),
    stack: error && error.stack,
    page: `${req.method} ${req.url}`,
    userAgent: req.headers['user-agent']
  });

  // A route that already started streaming (the photo and court-image fetches do) cannot be
  // handed a JSON body on top - the error is recorded above either way.
  if (res.headersSent) return;
  res.status(status).json({ error: userMessage });
}

module.exports = { routeFailed };
