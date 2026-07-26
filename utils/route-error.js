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
const { logAppError } = require('../database');

function routeFailed(req, res, error, userMessage, status = 500) {
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
