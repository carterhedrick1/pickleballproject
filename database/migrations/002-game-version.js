/**
 * Optimistic concurrency for game writes.
 *
 * Every game mutation loads the whole game, edits it in memory and writes it back. Inside
 * one Node process `utils/game-lock.js` serializes that; across processes nothing did, so
 * two instances could each load version N, and the second write would silently erase the
 * first one's roster change.
 *
 * `version` is the compare-and-swap token: a write says "update this row only if it is
 * still the version I read", and the database refuses the write otherwise. Existing rows
 * start at 0 and every save increments.
 */

module.exports = {
  id: '002-game-version',
  description: 'games.version for optimistic concurrency on game writes',
  async up(runner) {
    await runner.addColumnIfMissing('games', 'version', {
      postgres: 'INTEGER NOT NULL DEFAULT 0',
      sqlite: 'INTEGER NOT NULL DEFAULT 0'
    });
  }
};
