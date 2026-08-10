// The /api gate: every API request waits for the database to be initialized.
//
// The subtlety is failure. Initialization runs once at boot; if that one attempt rejects
// (Render's Postgres can briefly refuse connections while a deploy is settling), a naive
// cached promise replays that stale rejection on every later request - the whole API answers
// 500 until someone restarts the process, even though the database recovered seconds later.
// This gate retries a failed initialization on the next request instead, one attempt at a
// time: concurrent requests all wait on the same retry rather than each starting their own.
function createDatabaseGate(initialize) {
  let ready = initialize();
  return function databaseGate(req, res, next) {
    ready = ready.catch(() => initialize());
    ready.then(() => next(), next);
  };
}

module.exports = { createDatabaseGate };
