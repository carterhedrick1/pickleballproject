const { isProduction, withPgClient, sqliteAll, sqliteGet, sqliteRun, sqlitePrepareRun } = require('./context');

// ---------------------------------------------------------------------------
// Game functions
// ---------------------------------------------------------------------------

async function saveGame(gameId, gameData, hostToken, hostPhone = null) {
  try {
    const dataStr = JSON.stringify(gameData);
    if (isProduction) {
      await withPgClient(async (client) => {
        await client.query(`
          INSERT INTO games (id, data, host_token, host_phone, updated_at)
          VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
          ON CONFLICT (id)
          DO UPDATE SET data = $2, host_token = $3, host_phone = $4, updated_at = CURRENT_TIMESTAMP
        `, [gameId, dataStr, hostToken, hostPhone]);
      });
    } else {
      await sqlitePrepareRun(`
        INSERT OR REPLACE INTO games (id, data, host_token, host_phone, updated_at)
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      `, [gameId, dataStr, hostToken, hostPhone]);
    }
    console.log(`Game ${gameId} saved to database`);
  } catch (err) {
    console.error('Error saving game:', err);
    throw err;
  }
}

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
          hostPhone: row.host_phone
        };
      }
      return null;
    } else {
      const row = await sqliteGet('SELECT * FROM games WHERE id = ?', [gameId]);
      if (row) {
        return {
          ...JSON.parse(row.data),
          hostToken: row.host_token,
          hostPhone: row.host_phone
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
  saveGame,
  getGame,
  getGameHostInfo,
  getAllGames,
  getGamesByHostPhone,
  deleteGamePermanently
};
