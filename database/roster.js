const { isProduction, withPgClient, sqliteAll, sqliteGet, sqliteRun, sqlitePrepareRun } = require('./context');

// ---------------------------------------------------------------------------
// Host roster functions
//
// Two writers with deliberately different rules, because a name the host typed must never
// be replaced by whatever a player happened to type into a signup form:
//   upsertRosterEntry    - the host editing the roster. Overwrites name and DUPR fields.
//   recordRosterSighting - automatic, when somebody joins a game. Only fills in a name for
//                          a player the host has never seen before.
// Neither uses INSERT OR REPLACE: that rewrites the whole row and would wipe is_android.
// ---------------------------------------------------------------------------

function toRosterEntry(row) {
  return {
    playerPhone: row.player_phone,
    name: row.name || '',
    duprId: row.dupr_id || '',
    duprRating: row.dupr_rating == null ? null : Number(row.dupr_rating),
    isAndroid: row.is_android == null ? null : Number(row.is_android),
    updatedAt: row.updated_at
  };
}

// Host-entered values. These win over anything captured automatically.
async function upsertRosterEntry(hostPhone, playerPhone, name, duprId, duprRating) {
  const rating = duprRating === '' || duprRating == null || isNaN(Number(duprRating))
    ? null
    : Number(duprRating);
  try {
    if (isProduction) {
      await withPgClient(async (client) => {
        await client.query(`
          INSERT INTO host_roster (host_phone, player_phone, name, dupr_id, dupr_rating, updated_at)
          VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
          ON CONFLICT (host_phone, player_phone)
          DO UPDATE SET name = EXCLUDED.name,
                        dupr_id = EXCLUDED.dupr_id,
                        dupr_rating = EXCLUDED.dupr_rating,
                        updated_at = CURRENT_TIMESTAMP
        `, [hostPhone, playerPhone, name || null, duprId || null, rating]);
      });
    } else {
      await sqlitePrepareRun(`
        INSERT INTO host_roster (host_phone, player_phone, name, dupr_id, dupr_rating, updated_at)
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT (host_phone, player_phone)
        DO UPDATE SET name = excluded.name,
                      dupr_id = excluded.dupr_id,
                      dupr_rating = excluded.dupr_rating,
                      updated_at = CURRENT_TIMESTAMP
      `, [hostPhone, playerPhone, name || null, duprId || null, rating]);
    }
  } catch (err) {
    console.error('Error saving roster entry:', err);
    throw err;
  }
}

// Automatic capture when somebody signs up. The name is only used for a brand new row, and
// is_android keeps whatever it already knew if this sighting cannot tell (COALESCE).
async function recordRosterSighting(hostPhone, playerPhone, name, isAndroid) {
  if (!hostPhone || !playerPhone) return;
  const androidFlag = isAndroid == null ? null : (isAndroid ? 1 : 0);
  try {
    if (isProduction) {
      await withPgClient(async (client) => {
        await client.query(`
          INSERT INTO host_roster (host_phone, player_phone, name, is_android, updated_at)
          VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
          ON CONFLICT (host_phone, player_phone)
          DO UPDATE SET is_android = COALESCE(EXCLUDED.is_android, host_roster.is_android),
                        updated_at = CURRENT_TIMESTAMP
        `, [hostPhone, playerPhone, name || null, androidFlag]);
      });
    } else {
      await sqlitePrepareRun(`
        INSERT INTO host_roster (host_phone, player_phone, name, is_android, updated_at)
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT (host_phone, player_phone)
        DO UPDATE SET is_android = COALESCE(excluded.is_android, host_roster.is_android),
                      updated_at = CURRENT_TIMESTAMP
      `, [hostPhone, playerPhone, name || null, androidFlag]);
    }
  } catch (err) {
    console.error('Error recording roster sighting:', err);
    throw err;
  }
}

async function getRosterForHost(hostPhone) {
  try {
    if (isProduction) {
      const rows = await withPgClient(async (client) => {
        const result = await client.query(
          'SELECT * FROM host_roster WHERE host_phone = $1',
          [hostPhone]
        );
        return result.rows;
      });
      return rows.map(toRosterEntry);
    } else {
      const rows = await sqliteAll('SELECT * FROM host_roster WHERE host_phone = ?', [hostPhone]);
      return rows.map(toRosterEntry);
    }
  } catch (err) {
    console.error('Error getting roster:', err);
    throw err;
  }
}

async function deleteRosterEntry(hostPhone, playerPhone) {
  try {
    if (isProduction) {
      const rowCount = await withPgClient(async (client) => {
        const result = await client.query(
          'DELETE FROM host_roster WHERE host_phone = $1 AND player_phone = $2',
          [hostPhone, playerPhone]
        );
        return result.rowCount;
      });
      return rowCount;
    } else {
      const result = await sqliteRun(
        'DELETE FROM host_roster WHERE host_phone = ? AND player_phone = ?',
        [hostPhone, playerPhone]
      );
      return result.changes;
    }
  } catch (err) {
    console.error('Error deleting roster entry:', err);
    throw err;
  }
}

module.exports = {
  upsertRosterEntry,
  recordRosterSighting,
  getRosterForHost,
  deleteRosterEntry
};
