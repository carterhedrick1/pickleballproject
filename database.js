// database.js - All database-related functions
require('dotenv').config();

const isProduction = process.env.DATABASE_URL ? true : false;
let db, pool;

console.log(`Environment: ${isProduction ? 'Production (PostgreSQL)' : 'Local (SQLite)'}`);

if (isProduction) {
  const { Pool } = require('pg');
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  console.log('Using PostgreSQL for production');
} else {
  const sqlite3 = require('sqlite3').verbose();
  db = new sqlite3.Database('pickleball.db', (err) => {
    if (err) {
      console.error('Error opening SQLite database:', err);
    } else {
      console.log('Connected to SQLite database');
    }
  });
}

// ---------------------------------------------------------------------------
// Database adapter - abstracts SQLite vs PostgreSQL
// ---------------------------------------------------------------------------

async function withPgClient(fn) {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

function sqliteAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

function sqliteGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row || null);
    });
  });
}

function sqliteRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function sqlitePrepareRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    const stmt = db.prepare(sql);
    stmt.run(...params, function (err) {
      stmt.finalize();
      if (err) reject(err);
      else resolve(this);
    });
  });
}

// ---------------------------------------------------------------------------
// Locations
// ---------------------------------------------------------------------------

// The courts this friend group already plays at. Seeded on every boot so a fresh
// database (or a new deploy) always offers them in the create-game picker.
const SEED_LOCATIONS = [
  'Homoly Home Court',
  'Chicken and Pickle',
  'JustPaddles',
  'Char Bar',
  'Argosy',
  'Wimbledom'
];

// The primary key. " chicken AND pickle " and "Chicken and Pickle" are the same court,
// so the key is trimmed, whitespace-collapsed and lowercased. The first spelling anybody
// types is the one everyone sees (display_name is never overwritten).
function locationKey(displayName) {
  return String(displayName == null ? '' : displayName).trim().replace(/\s+/g, ' ').toLowerCase();
}

// ---------------------------------------------------------------------------
// Initialize database
// ---------------------------------------------------------------------------

async function initializeDatabase() {
  try {
    if (isProduction) {
      const client = await pool.connect();
      try {
        await client.query(`
          CREATE TABLE IF NOT EXISTS games (
            id TEXT PRIMARY KEY,
            data JSONB NOT NULL,
            host_token TEXT NOT NULL,
            host_phone TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `);
        await client.query(`
          CREATE TABLE IF NOT EXISTS sms_contexts (
            phone_number TEXT PRIMARY KEY,
            last_command TEXT NOT NULL,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `);
        await client.query(`
          CREATE TABLE IF NOT EXISTS reminder_log (
            game_id TEXT NOT NULL,
            player_phone TEXT NOT NULL,
            reminder_type TEXT NOT NULL,
            sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (game_id, player_phone, reminder_type)
          )
        `);
        await client.query(`
          CREATE TABLE IF NOT EXISTS locations (
            name_key TEXT PRIMARY KEY,
            display_name TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `);
        for (const displayName of SEED_LOCATIONS) {
          await client.query(
            'INSERT INTO locations (name_key, display_name) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [locationKey(displayName), displayName]
          );
        }
        await client.query(`
          CREATE TABLE IF NOT EXISTS host_roster (
            host_phone TEXT NOT NULL,
            player_phone TEXT NOT NULL,
            name TEXT,
            dupr_id TEXT,
            dupr_rating REAL,
            is_android INTEGER,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (host_phone, player_phone)
          )
        `);
        console.log('PostgreSQL tables initialized');
      } finally {
        client.release();
      }
    } else {
      await sqliteRun(`CREATE TABLE IF NOT EXISTS games (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        host_token TEXT NOT NULL,
        host_phone TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);
      console.log('SQLite games table initialized');

      await sqliteRun(`CREATE TABLE IF NOT EXISTS sms_contexts (
        phone_number TEXT PRIMARY KEY,
        last_command TEXT NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);
      console.log('SQLite sms_contexts table initialized');

      await sqliteRun(`CREATE TABLE IF NOT EXISTS reminder_log (
        game_id TEXT NOT NULL,
        player_phone TEXT NOT NULL,
        reminder_type TEXT NOT NULL,
        sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (game_id, player_phone, reminder_type)
      )`);
      console.log('SQLite reminder_log table initialized');

      await sqliteRun(`CREATE TABLE IF NOT EXISTS locations (
        name_key TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);
      for (const displayName of SEED_LOCATIONS) {
        await sqlitePrepareRun(
          'INSERT OR IGNORE INTO locations (name_key, display_name) VALUES (?, ?)',
          [locationKey(displayName), displayName]
        );
      }
      console.log('SQLite locations table initialized');

      await sqliteRun(`CREATE TABLE IF NOT EXISTS host_roster (
        host_phone TEXT NOT NULL,
        player_phone TEXT NOT NULL,
        name TEXT,
        dupr_id TEXT,
        dupr_rating REAL,
        is_android INTEGER,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (host_phone, player_phone)
      )`);
      console.log('SQLite host_roster table initialized');
    }
  } catch (err) {
    console.error('Database initialization error:', err);
    throw err;
  }
}

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

// ---------------------------------------------------------------------------
// Location functions
// ---------------------------------------------------------------------------

// Remembers a court so the next host can pick it instead of retyping it.
// Blank names are ignored, and an existing court keeps the spelling it was first saved with.
async function addLocation(displayName) {
  const trimmed = String(displayName == null ? '' : displayName).trim().replace(/\s+/g, ' ');
  if (!trimmed) return;
  const key = locationKey(trimmed);
  try {
    if (isProduction) {
      await withPgClient(async (client) => {
        await client.query(
          'INSERT INTO locations (name_key, display_name) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [key, trimmed]
        );
      });
    } else {
      await sqlitePrepareRun(
        'INSERT OR IGNORE INTO locations (name_key, display_name) VALUES (?, ?)',
        [key, trimmed]
      );
    }
  } catch (err) {
    console.error('Error saving location:', err);
    throw err;
  }
}

// Display names, ordered by the normalized key so SQLite and Postgres agree on the order.
async function getLocations() {
  try {
    if (isProduction) {
      const rows = await withPgClient(async (client) => {
        const result = await client.query('SELECT display_name FROM locations ORDER BY name_key');
        return result.rows;
      });
      return rows.map((row) => row.display_name);
    } else {
      const rows = await sqliteAll('SELECT display_name FROM locations ORDER BY name_key');
      return rows.map((row) => row.display_name);
    }
  } catch (err) {
    console.error('Error getting locations:', err);
    throw err;
  }
}

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

// ---------------------------------------------------------------------------
// SMS context functions
// ---------------------------------------------------------------------------

async function saveLastCommand(phoneNumber, context) {
  try {
    if (isProduction) {
      await withPgClient(async (client) => {
        await client.query(`
          INSERT INTO sms_contexts (phone_number, last_command, updated_at)
          VALUES ($1, $2, CURRENT_TIMESTAMP)
          ON CONFLICT (phone_number)
          DO UPDATE SET last_command = $2, updated_at = CURRENT_TIMESTAMP
        `, [phoneNumber, context]);
      });
    } else {
      await sqlitePrepareRun(`
        INSERT OR REPLACE INTO sms_contexts (phone_number, last_command, updated_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
      `, [phoneNumber, context]);
    }
    console.log(`[SMS Context] Saved context for ${phoneNumber}: ${context}`);
  } catch (err) {
    console.error('Error saving SMS context:', err);
    throw err;
  }
}

async function getLastCommand(phoneNumber) {
  try {
    if (isProduction) {
      const rows = await withPgClient(async (client) => {
        const result = await client.query('SELECT last_command FROM sms_contexts WHERE phone_number = $1', [phoneNumber]);
        return result.rows;
      });
      const context = rows.length > 0 ? rows[0].last_command : null;
      console.log(`[SMS Context] Retrieved context for ${phoneNumber}: ${context}`);
      return context;
    } else {
      const row = await sqliteGet('SELECT last_command FROM sms_contexts WHERE phone_number = ?', [phoneNumber]);
      const context = row ? row.last_command : null;
      console.log(`[SMS Context] Retrieved context for ${phoneNumber}: ${context}`);
      return context;
    }
  } catch (err) {
    console.error('Error getting SMS context:', err);
    throw err;
  }
}

async function clearLastCommand(phoneNumber) {
  try {
    if (isProduction) {
      await withPgClient(async (client) => {
        await client.query('DELETE FROM sms_contexts WHERE phone_number = $1', [phoneNumber]);
      });
    } else {
      await sqliteRun('DELETE FROM sms_contexts WHERE phone_number = ?', [phoneNumber]);
    }
    console.log(`[SMS Context] Cleared context for ${phoneNumber}`);
  } catch (err) {
    console.error('Error clearing SMS context:', err);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Reminder tracking functions
// ---------------------------------------------------------------------------

async function hasReminderBeenSent(gameId, playerPhone, reminderType) {
  try {
    if (isProduction) {
      const rows = await withPgClient(async (client) => {
        const result = await client.query(
          'SELECT 1 FROM reminder_log WHERE game_id = $1 AND player_phone = $2 AND reminder_type = $3',
          [gameId, playerPhone, reminderType]
        );
        return result.rows;
      });
      return rows.length > 0;
    } else {
      const row = await sqliteGet(
        'SELECT 1 FROM reminder_log WHERE game_id = ? AND player_phone = ? AND reminder_type = ?',
        [gameId, playerPhone, reminderType]
      );
      return !!row;
    }
  } catch (err) {
    console.error('Error checking reminder status:', err);
    throw err;
  }
}

async function markReminderSent(gameId, playerPhone, reminderType) {
  try {
    if (isProduction) {
      await withPgClient(async (client) => {
        await client.query(
          'INSERT INTO reminder_log (game_id, player_phone, reminder_type) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
          [gameId, playerPhone, reminderType]
        );
      });
    } else {
      await sqlitePrepareRun(`
        INSERT OR IGNORE INTO reminder_log (game_id, player_phone, reminder_type)
        VALUES (?, ?, ?)
      `, [gameId, playerPhone, reminderType]);
    }
    console.log(`[REMINDER] Marked ${reminderType} reminder sent for game ${gameId}, player ${playerPhone}`);
  } catch (err) {
    console.error('Error marking reminder sent:', err);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

function closeDatabaseConnection() {
  if (isProduction) {
    return pool.end();
  } else {
    return new Promise((resolve) => {
      db.close((err) => {
        if (err) {
          console.error('Error closing SQLite database:', err);
        } else {
          console.log('SQLite database connection closed.');
        }
        resolve();
      });
    });
  }
}

module.exports = {
  initializeDatabase,
  saveGame,
  getGame,
  getGameHostInfo,
  getAllGames,
  getGamesByHostPhone,
  addLocation,
  getLocations,
  upsertRosterEntry,
  recordRosterSighting,
  getRosterForHost,
  deleteRosterEntry,
  saveLastCommand,
  getLastCommand,
  clearLastCommand,
  hasReminderBeenSent,
  markReminderSent,
  closeDatabaseConnection,
  isProduction
};
