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
  saveLastCommand,
  getLastCommand,
  clearLastCommand,
  hasReminderBeenSent,
  markReminderSent,
  closeDatabaseConnection,
  isProduction
};
