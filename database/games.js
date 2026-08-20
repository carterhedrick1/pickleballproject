const { isProduction, withPgClient, sqliteAll, sqliteGet, sqliteRun, sqlitePrepareRun } = require('./context');

// ---------------------------------------------------------------------------
// Optimistic concurrency
// ---------------------------------------------------------------------------

/**
 * A save was refused because the game changed after it was read.
 *
 * Callers that can simply try again should use updateGame() below, which re-reads and
 * re-applies. Routes that surface it to a person answer 409 rather than 500: nothing is
 * broken, the host or player just needs the newer roster.
 */
class GameVersionConflictError extends Error {
  constructor(gameId, expectedVersion) {
    super(`Game ${gameId} changed since it was read (expected version ${expectedVersion})`);
    this.name = 'GameVersionConflictError';
    // Checked by code that must not import this module (see utils/route-error.js).
    this.code = 'GAME_VERSION_CONFLICT';
    this.gameId = gameId;
    this.expectedVersion = expectedVersion;
  }
}

const GAME_SAVE_ATTEMPTS = 5;

/**
 * The version to compare against, or null for an unconditional write.
 *
 * A game that came from getGame() carries the version it was read at, so every existing
 * read-modify-write in the app gets compare-and-swap without changing its call. Callers
 * building a game from scratch (creating one) have no version and write unconditionally.
 */
function resolveExpectedVersion(gameData, options) {
  if (options && Object.prototype.hasOwnProperty.call(options, 'expectedVersion')) {
    return options.expectedVersion;
  }
  const carried = gameData && gameData.version;
  return Number.isInteger(carried) ? carried : null;
}

// ---------------------------------------------------------------------------
// Game functions
// ---------------------------------------------------------------------------

/**
 * Writes a game, refusing to overwrite a newer one.
 *
 * A guarded write to a game that no longer exists still inserts it, which is what the code
 * did before versions existed. Only deleteGamePermanently removes a row, and recreating one
 * a caller was mid-edit on beats losing their work.
 *
 * @param {object} [options]
 * @param {number|null} [options.expectedVersion] overrides the version carried by gameData;
 *   null writes unconditionally.
 * @throws {GameVersionConflictError} when the stored version is not the expected one.
 */
async function saveGame(gameId, gameData, hostToken, hostPhone = null, options = null) {
  try {
    const expectedVersion = resolveExpectedVersion(gameData, options);
    // version lives in its own column; it must never be written into the JSON blob, where a
    // later read would take it for game data.
    const { version: _versionColumn, ...blob } = gameData || {};
    const dataStr = JSON.stringify(blob);

    if (isProduction) {
      await withPgClient(async (client) => {
        const conditional = expectedVersion !== null;
        const result = await client.query(`
          INSERT INTO games (id, data, host_token, host_phone, version, updated_at)
          VALUES ($1, $2, $3, $4, 1, CURRENT_TIMESTAMP)
          ON CONFLICT (id)
          DO UPDATE SET
            data = $2,
            host_token = $3,
            host_phone = $4,
            version = games.version + 1,
            updated_at = CURRENT_TIMESTAMP
          ${conditional ? 'WHERE games.version = $5' : ''}
        `, conditional
          ? [gameId, dataStr, hostToken, hostPhone, expectedVersion]
          : [gameId, dataStr, hostToken, hostPhone]);

        // The insert conflicted and the update was refused: somebody else wrote first.
        if (result.rowCount === 0) throw new GameVersionConflictError(gameId, expectedVersion);
      });
    } else {
      await saveGameSqlite(gameId, dataStr, hostToken, hostPhone, expectedVersion);
    }
    console.log(`Game ${gameId} saved to database`);
  } catch (err) {
    if (err instanceof GameVersionConflictError) throw err;
    console.error('Error saving game:', err);
    throw err;
  }
}

// SQLite has no "update only if" upsert, so it is spelled out: try the guarded update, and
// only insert when there is no row at all. INSERT OR REPLACE is deliberately not used - it
// deletes and re-inserts, which would reset the version column other writers are comparing
// against.
async function saveGameSqlite(gameId, dataStr, hostToken, hostPhone, expectedVersion) {
  const conditional = expectedVersion !== null;
  const update = await sqlitePrepareRun(`
    UPDATE games
    SET data = ?, host_token = ?, host_phone = ?, version = version + 1, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?${conditional ? ' AND version = ?' : ''}
  `, conditional
    ? [dataStr, hostToken, hostPhone, gameId, expectedVersion]
    : [dataStr, hostToken, hostPhone, gameId]);
  if (update.changes > 0) return;

  const insert = await sqlitePrepareRun(`
    INSERT OR IGNORE INTO games (id, data, host_token, host_phone, version, updated_at)
    VALUES (?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
  `, [gameId, dataStr, hostToken, hostPhone]);
  if (insert.changes > 0) return;

  // A row exists after all. For a guarded write that is the conflict; for an unconditional
  // one it means another process inserted the game between our update and our insert, so
  // finish the write we were asked to make.
  if (conditional) throw new GameVersionConflictError(gameId, expectedVersion);
  await sqlitePrepareRun(`
    UPDATE games
    SET data = ?, host_token = ?, host_phone = ?, version = version + 1, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [dataStr, hostToken, hostPhone, gameId]);
}

/**
 * Read-modify-write with compare-and-swap and retries.
 *
 * `apply(game, attempt)` receives the freshly loaded game (null when it does not exist),
 * mutates it in place, and returns `{ save, result }`. `result` is what updateGame returns;
 * `save: false` leaves the database untouched. On a conflict the game is read again and
 * apply runs again on the newer copy, so two overlapping mutations both land instead of one
 * erasing the other.
 */
async function updateGame(gameId, apply, { attempts = GAME_SAVE_ATTEMPTS } = {}) {
  let lastConflict = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const game = await getGame(gameId);
    const outcome = await apply(game, attempt);
    if (!outcome || typeof outcome !== 'object') {
      throw new TypeError('updateGame expects apply() to return { save, result }');
    }
    const { save, result } = outcome;
    if (!save) return result;
    if (!game) {
      throw new Error(`Cannot save game ${gameId}: it does not exist`);
    }

    try {
      await saveGame(gameId, game, game.hostToken, game.hostPhone);
      return result;
    } catch (err) {
      if (err.code !== 'GAME_VERSION_CONFLICT') throw err;
      lastConflict = err;
      console.log(`[GAME] ${gameId} changed underneath attempt ${attempt}; re-reading and retrying`);
    }
  }

  throw lastConflict;
}

/**
 * Loads one game, tagged with the version it was read at.
 *
 * That version is what makes saveGame() safe: hand the same object back and the write only
 * lands if nobody else wrote in between. The list reads below deliberately do not carry a
 * version - they answer "what games are there", not "what am I about to change".
 */
async function getGame(gameId) {
  try {
    if (isProduction) {
      const rows = await withPgClient(async (client) => {
        const result = await client.query('SELECT * FROM games WHERE id = $1', [gameId]);
        return result.rows;
      });
      if (rows.length > 0) {
        const row = rows[0];
        return {
          ...row.data,
          hostToken: row.host_token,
          hostPhone: row.host_phone,
          version: row.version
        };
      }
      return null;
    } else {
      const row = await sqliteGet('SELECT * FROM games WHERE id = ?', [gameId]);
      if (row) {
        return {
          ...JSON.parse(row.data),
          hostToken: row.host_token,
          hostPhone: row.host_phone,
          version: row.version
        };
      }
      return null;
    }
  } catch (err) {
    console.error('Error getting game:', err);
    throw err;
  }
}

async function getGameHostInfo(gameId) {
  try {
    if (isProduction) {
      const rows = await withPgClient(async (client) => {
        const result = await client.query('SELECT host_phone, host_token FROM games WHERE id = $1', [gameId]);
        return result.rows;
      });
      if (rows.length > 0) {
        const row = rows[0];
        return { phone: row.host_phone, hostToken: row.host_token };
      }
      return null;
    } else {
      const row = await sqliteGet('SELECT host_phone, host_token FROM games WHERE id = ?', [gameId]);
      return row ? { phone: row.host_phone, hostToken: row.host_token } : null;
    }
  } catch (err) {
    console.error('Error getting host info:', err);
    throw err;
  }
}

async function getAllGames() {
  try {
    if (isProduction) {
      const rows = await withPgClient(async (client) => {
        const result = await client.query('SELECT id, data FROM games');
        return result.rows;
      });
      const games = {};
      rows.forEach((row) => {
        games[row.id] = row.data;
      });
      return games;
    } else {
      const rows = await sqliteAll('SELECT id, data FROM games');
      const games = {};
      rows.forEach((row) => {
        games[row.id] = JSON.parse(row.data);
      });
      return games;
    }
  } catch (err) {
    console.error('Error getting all games:', err);
    throw err;
  }
}

// Every game a host owns, in one query. The host-history page used to call getAllGames()
// and then getGame() once per row, which read the whole table to show one person's games.
async function getGamesByHostPhone(hostPhone) {
  try {
    if (isProduction) {
      const rows = await withPgClient(async (client) => {
        const result = await client.query(
          'SELECT id, data, host_token FROM games WHERE host_phone = $1',
          [hostPhone]
        );
        return result.rows;
      });
      return rows.map((row) => ({
        gameId: row.id,
        ...row.data,
        hostToken: row.host_token,
        hostPhone
      }));
    } else {
      const rows = await sqliteAll(
        'SELECT id, data, host_token FROM games WHERE host_phone = ?',
        [hostPhone]
      );
      return rows.map((row) => ({
        gameId: row.id,
        ...JSON.parse(row.data),
        hostToken: row.host_token,
        hostPhone
      }));
    }
  } catch (err) {
    console.error('Error getting games by host phone:', err);
    throw err;
  }
}

// Erase a game for good: the row, its photos, and its reminder log.
//
// Cancelling (the DELETE /api/games/:id route) only sets a flag - the game stays visible
// and still counts in stats. This is the real thing, for a host clearing out old history.
// There is no ON DELETE CASCADE on either child table, so they are cleared by hand;
// leaving them would strand photo blobs in the database with no game to reach them.
async function deleteGamePermanently(gameId) {
  try {
    if (isProduction) {
      return await withPgClient(async (client) => {
        try {
          await client.query('BEGIN');
          await client.query('DELETE FROM game_photos WHERE game_id = $1', [gameId]);
          await client.query('DELETE FROM reminder_log WHERE game_id = $1', [gameId]);
          const result = await client.query('DELETE FROM games WHERE id = $1', [gameId]);
          await client.query('COMMIT');
          return result.rowCount;
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        }
      });
    } else {
      // SQLite here is single-connection and one request at a time, so the three
      // statements run back to back without another writer slipping between them.
      await sqliteRun('DELETE FROM game_photos WHERE game_id = ?', [gameId]);
      await sqliteRun('DELETE FROM reminder_log WHERE game_id = ?', [gameId]);
      const result = await sqliteRun('DELETE FROM games WHERE id = ?', [gameId]);
      return result.changes;
    }
  } catch (err) {
    console.error('Error deleting game:', err);
    throw err;
  }
}

module.exports = {
  GameVersionConflictError,
  saveGame,
  updateGame,
  getGame,
  getGameHostInfo,
  getAllGames,
  getGamesByHostPhone,
  deleteGamePermanently
};
