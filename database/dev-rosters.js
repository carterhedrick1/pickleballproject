const {
  isProduction,
  withPgClient,
  sqliteAll,
  sqliteRun
} = require('./context');
const {
  buildDeveloperRosters,
  editPlayerInGame,
  deletePlayerFromGame
} = require('../utils/dev-rosters');

function mapGameRow(row) {
  return {
    gameId: row.id,
    hostPhone: row.host_phone,
    data: typeof row.data === 'string' ? JSON.parse(row.data) : row.data,
    updatedAt: row.updated_at
  };
}

function mapRosterRow(row) {
  return {
    hostPhone: row.host_phone,
    playerPhone: row.player_phone,
    name: row.name || '',
    duprId: row.dupr_id || '',
    duprRating: row.dupr_rating,
    isAndroid: row.is_android,
    updatedAt: row.updated_at
  };
}

async function getDeveloperRosterSources() {
  if (isProduction) {
    return withPgClient(async (client) => {
      const [games, roster] = await Promise.all([
        client.query('SELECT id, host_phone, data, updated_at FROM games'),
        client.query('SELECT * FROM host_roster')
      ]);
      return {
        games: games.rows.map(mapGameRow),
        rosterRows: roster.rows.map(mapRosterRow)
      };
    });
  }

  const [games, rosterRows] = await Promise.all([
    sqliteAll('SELECT id, host_phone, data, updated_at FROM games'),
    sqliteAll('SELECT * FROM host_roster')
  ]);
  return {
    games: games.map(mapGameRow),
    rosterRows: rosterRows.map(mapRosterRow)
  };
}

async function updatePostgresRosterRows(client, oldPhone, newPhone, name) {
  if (oldPhone === newPhone) {
    const result = await client.query(
      `UPDATE host_roster
       SET name = $2, updated_at = CURRENT_TIMESTAMP
       WHERE player_phone = $1`,
      [oldPhone, name]
    );
    return result.rowCount;
  }

  const rows = (await client.query(
    'SELECT * FROM host_roster WHERE player_phone = $1',
    [oldPhone]
  )).rows;
  for (const row of rows) {
    await client.query(
      `INSERT INTO host_roster
        (host_phone, player_phone, name, dupr_id, dupr_rating, is_android, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
       ON CONFLICT (host_phone, player_phone)
       DO UPDATE SET name = EXCLUDED.name,
                     dupr_id = COALESCE(host_roster.dupr_id, EXCLUDED.dupr_id),
                     dupr_rating = COALESCE(host_roster.dupr_rating, EXCLUDED.dupr_rating),
                     is_android = COALESCE(host_roster.is_android, EXCLUDED.is_android),
                     updated_at = CURRENT_TIMESTAMP`,
      [row.host_phone, newPhone, name, row.dupr_id, row.dupr_rating, row.is_android]
    );
  }
  await client.query('DELETE FROM host_roster WHERE player_phone = $1', [oldPhone]);
  return rows.length;
}

async function updateSqliteRosterRows(oldPhone, newPhone, name) {
  if (oldPhone === newPhone) {
    const result = await sqliteRun(
      `UPDATE host_roster
       SET name = ?, updated_at = CURRENT_TIMESTAMP
       WHERE player_phone = ?`,
      [name, oldPhone]
    );
    return result.changes;
  }

  const rows = await sqliteAll('SELECT * FROM host_roster WHERE player_phone = ?', [oldPhone]);
  for (const row of rows) {
    await sqliteRun(
      `INSERT INTO host_roster
        (host_phone, player_phone, name, dupr_id, dupr_rating, is_android, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT (host_phone, player_phone)
       DO UPDATE SET name = excluded.name,
                     dupr_id = COALESCE(host_roster.dupr_id, excluded.dupr_id),
                     dupr_rating = COALESCE(host_roster.dupr_rating, excluded.dupr_rating),
                     is_android = COALESCE(host_roster.is_android, excluded.is_android),
                     updated_at = CURRENT_TIMESTAMP`,
      [row.host_phone, newPhone, name, row.dupr_id, row.dupr_rating, row.is_android]
    );
  }
  await sqliteRun('DELETE FROM host_roster WHERE player_phone = ?', [oldPhone]);
  return rows.length;
}

function ensurePhoneAvailable(sources, oldPhone, newPhone) {
  if (oldPhone === newPhone) return;
  const directory = buildDeveloperRosters(sources);
  if (directory.players.some((player) => player.phone === newPhone)) {
    const error = new Error('Another player already uses that phone number.');
    error.code = 'PLAYER_PHONE_EXISTS';
    throw error;
  }
}

async function updateDeveloperPlayer(oldPhone, newPhone, name) {
  if (isProduction) {
    return withPgClient(async (client) => {
      await client.query('BEGIN');
      try {
        const [gameResult, rosterResult] = await Promise.all([
          client.query('SELECT id, host_phone, data, updated_at FROM games FOR UPDATE'),
          client.query('SELECT * FROM host_roster FOR UPDATE')
        ]);
        const sources = {
          games: gameResult.rows.map(mapGameRow),
          rosterRows: rosterResult.rows.map(mapRosterRow)
        };
        ensurePhoneAvailable(sources, oldPhone, newPhone);

        let gameOccurrences = 0;
        for (const record of sources.games) {
          const before = JSON.stringify(record.data);
          editPlayerInGame(record.data, oldPhone, newPhone, name, record.hostPhone);
          if (JSON.stringify(record.data) === before) continue;
          gameOccurrences += 1;
          await client.query(
            'UPDATE games SET data = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
            [record.data, record.gameId]
          );
        }
        const hostRosters = await updatePostgresRosterRows(client, oldPhone, newPhone, name);
        await client.query('COMMIT');
        return { gameOccurrences, hostRosters };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    });
  }

  await sqliteRun('BEGIN IMMEDIATE');
  try {
    const sources = await getDeveloperRosterSources();
    ensurePhoneAvailable(sources, oldPhone, newPhone);
    let gameOccurrences = 0;
    for (const record of sources.games) {
      const before = JSON.stringify(record.data);
      editPlayerInGame(record.data, oldPhone, newPhone, name, record.hostPhone);
      if (JSON.stringify(record.data) === before) continue;
      gameOccurrences += 1;
      await sqliteRun(
        'UPDATE games SET data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [JSON.stringify(record.data), record.gameId]
      );
    }
    const hostRosters = await updateSqliteRosterRows(oldPhone, newPhone, name);
    await sqliteRun('COMMIT');
    return { gameOccurrences, hostRosters };
  } catch (error) {
    await sqliteRun('ROLLBACK');
    throw error;
  }
}

async function deleteDeveloperPlayer(phone) {
  if (isProduction) {
    return withPgClient(async (client) => {
      await client.query('BEGIN');
      try {
        const rows = (await client.query(
          'SELECT id, host_phone, data, updated_at FROM games FOR UPDATE'
        )).rows.map(mapGameRow);
        let gameOccurrences = 0;
        for (const record of rows) {
          const removed = deletePlayerFromGame(record.data, phone, record.hostPhone);
          if (!removed) continue;
          gameOccurrences += removed;
          await client.query(
            'UPDATE games SET data = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
            [record.data, record.gameId]
          );
        }
        const rosterResult = await client.query(
          'DELETE FROM host_roster WHERE player_phone = $1',
          [phone]
        );
        await client.query('COMMIT');
        return { gameOccurrences, hostRosters: rosterResult.rowCount };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    });
  }

  await sqliteRun('BEGIN IMMEDIATE');
  try {
    const rows = (await sqliteAll(
      'SELECT id, host_phone, data, updated_at FROM games'
    )).map(mapGameRow);
    let gameOccurrences = 0;
    for (const record of rows) {
      const removed = deletePlayerFromGame(record.data, phone, record.hostPhone);
      if (!removed) continue;
      gameOccurrences += removed;
      await sqliteRun(
        'UPDATE games SET data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [JSON.stringify(record.data), record.gameId]
      );
    }
    const rosterResult = await sqliteRun(
      'DELETE FROM host_roster WHERE player_phone = ?',
      [phone]
    );
    await sqliteRun('COMMIT');
    return { gameOccurrences, hostRosters: rosterResult.changes };
  } catch (error) {
    await sqliteRun('ROLLBACK');
    throw error;
  }
}

module.exports = {
  getDeveloperRosterSources,
  updateDeveloperPlayer,
  deleteDeveloperPlayer
};
