/**
 * Serializes read-modify-write sequences against a single game.
 *
 * Every mutation loads the whole game record, edits it in memory and writes it back. When two
 * requests interleave between the load and the write, the second one overwrites the first, and
 * a player who was told they were in disappears from the roster. That is most likely exactly
 * when a game is busiest: an invite goes out and several friends tap the link at once.
 *
 * Work is queued per game id, so unrelated games still run in parallel.
 *
 * This guards one Node process, which is what the app runs on today. Serving the same game from
 * more than one instance would need the database to enforce ordering instead.
 */

const queues = new Map();

/**
 * Runs fn with exclusive access to a game, queueing behind any work already in flight for it.
 * @param {string} gameId
 * @param {Function} fn - async function performing the read-modify-write
 * @returns {Promise<*>} whatever fn resolves to
 */
function withGameLock(gameId, fn) {
  const previous = queues.get(gameId) || Promise.resolve();

  const result = previous.then(() => fn());

  // A caller's rejection must not poison the queue for everyone behind them.
  const tail = result.catch(() => {});
  queues.set(gameId, tail);

  tail.then(() => {
    // Only clear if nobody else queued behind us, otherwise we would drop their place in line.
    if (queues.get(gameId) === tail) {
      queues.delete(gameId);
    }
  });

  return result;
}

/**
 * Same guarantee as withGameLock, but the caller decides when to let go. Use this when only the
 * first part of a handler touches the game and the rest is slow work such as sending texts:
 * release as soon as the save completes so other players are not stuck behind an SMS round trip.
 *
 * Always release in a finally block. The returned function is safe to call more than once.
 * @param {string} gameId
 * @returns {Promise<Function>} release
 */
async function acquireGameLock(gameId) {
  const previous = queues.get(gameId) || Promise.resolve();

  let release;
  const held = new Promise((resolve) => { release = resolve; });
  const tail = previous.then(() => held);
  queues.set(gameId, tail);

  // Our turn starts once whoever was ahead of us has released.
  await previous;

  let released = false;
  return () => {
    if (released) return;
    released = true;
    release();
    if (queues.get(gameId) === tail) {
      queues.delete(gameId);
    }
  };
}

module.exports = { withGameLock, acquireGameLock };
