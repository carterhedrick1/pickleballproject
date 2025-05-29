// database.js - All database-related functions
require('dotenv').config();

// Database setup - SQLite for local, PostgreSQL for production
let db, pool;
let isProduction = process.env.DATABASE_URL ? true : false;

console.log(`Environment: ${isProduction ? 'Production (PostgreSQL)' : 'Local (SQLite)'}`);

if (isProduction) {
  // Production: Use PostgreSQL
  const { Pool } = require('pg');
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  console.log('Using PostgreSQL for production');
} else {
  // Local development: Use SQLite
  const sqlite3 = require('sqlite3').verbose();
  db = new sqlite3.Database('pickleball.db', (err) => {
    if (err) {
      console.error('Error opening SQLite database:', err);
    } else {
      console.log('Connected to SQLite database');
    }
  });
}

// Initialize database
async function initializeDatabase() {
  try {
    if (isProduction) {
      // PostgreSQL setup
      const client = await pool.connect();
      console.log('Connected to PostgreSQL database');
      
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
      
      // SMS context table
      await client.query(`
        CREATE TABLE IF NOT EXISTS sms_contexts (
          phone_number TEXT PRIMARY KEY,
          last_command TEXT NOT NULL,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      
      // Reminder tracking table
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
      client.release();
    } else {
      // SQLite setup
      db.serialize(() => {
        db.run(`CREATE TABLE IF NOT EXISTS games (
          id TEXT PRIMARY KEY,
          data TEXT NOT NULL,
          host_token TEXT NOT NULL,
          host_phone TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`, (err) => {
          if (err) {
            console.error('Error creating SQLite games table:', err);
          } else {
            console.log('SQLite games table initialized');
          }
        });
        
        db.run(`CREATE TABLE IF NOT EXISTS sms_contexts (
          phone_number TEXT PRIMARY KEY,
          last_command TEXT NOT NULL,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`, (err) => {
          if (err) {
            console.error('Error creating SQLite sms_contexts table:', err);
          } else {
            console.log('SQLite sms_contexts table initialized');
          }
        });
        
        db.run(`CREATE TABLE IF NOT EXISTS reminder_log (
          game_id TEXT NOT NULL,
          player_phone TEXT NOT NULL,
          reminder_type TEXT NOT NULL,
          sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (game_id, player_phone, reminder_type)
        )`, (err) => {
          if (err) {
            console.error('Error creating SQLite reminder_log table:', err);
          } else {
            console.log('SQLite reminder_log table initialized');
          }
        });
      });
    }
  } catch (err) {
    console.error('Database initialization error:', err);
  }
}

// Game database functions
async function saveGame(gameId, gameData, hostToken, hostPhone = null) {
  try {
    if (isProduction) {
      const client = await pool.connect();
      const query = `
        INSERT INTO games (id, data, host_token, host_phone, updated_at) 
        VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
        ON CONFLICT (id) 
        DO UPDATE SET data = $2, host_token = $3, host_phone = $4, updated_at = CURRENT_TIMESTAMP
      `;
      await client.query(query, [gameId, JSON.stringify(gameData), hostToken, hostPhone]); 
      client.release();
    } else {
      return new Promise((resolve, reject) => {
        const stmt = db.prepare(`
          INSERT OR REPLACE INTO games (id, data, host_token, host_phone, updated_at) 
          VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
        `);
        stmt.run([gameId, JSON.stringify(gameData), hostToken, hostPhone], function(err) {
          if (err) reject(err);
          else resolve(this);
        });
        stmt.finalize();
      });
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
      const client = await pool.connect();
      const result = await client.query('SELECT * FROM games WHERE id = $1', [gameId]);
      client.release();
      
      if (result.rows.length > 0) {
        const row = result.rows[0];
        return {
          ...row.data,
          hostToken: row.host_token,
          hostPhone: row.host_phone
        };
      }
      return null;
    } else {
      return new Promise((resolve, reject) => {
        db.get('SELECT * FROM games WHERE id = ?', [gameId], (err, row) => {
          if (err) {
            reject(err);
          } else if (row) {
            resolve({
              ...JSON.parse(row.data),
              hostToken: row.host_token,
              hostPhone: row.host_phone
            });
          } else {
            resolve(null);
          }
        });
      });
    }
  } catch (err) {
    console.error('Error getting game:', err);
    throw err;
  }
}

async function getGameHostInfo(gameId) {
  try {
    if (isProduction) {
      const client = await pool.connect();
      const result = await client.query('SELECT host_phone, host_token FROM games WHERE id = $1', [gameId]);
      client.release();
      
      if (result.rows.length > 0) {
        const row = result.rows[0];
        return { phone: row.host_phone, hostToken: row.host_token };
      }
      return null;
    } else {
      return new Promise((resolve, reject) => {
        db.get('SELECT host_phone, host_token FROM games WHERE id = ?', [gameId], (err, row) => {
          if (err) {
            reject(err);
          } else {
            resolve(row ? { phone: row.host_phone, hostToken: row.host_token } : null);
          }
        });
      });
    }
  } catch (err) {
    console.error('Error getting host info:', err);
    throw err;
  }
}

async function getAllGames() {
  try {
    if (isProduction) {
      const client = await pool.connect();
      const result = await client.query('SELECT id, data FROM games');
      client.release();
      
      const games = {};
      result.rows.forEach(row => {
        games[row.id] = row.data;
      });
      return games;
    } else {
      return new Promise((resolve, reject) => {
        db.all('SELECT id, data FROM games', [], (err, rows) => {
          if (err) {
            reject(err);
          } else {
            const games = {};
            rows.forEach(row => {
              games[row.id] = JSON.parse(row.data);
            });
            resolve(games);
          }
        });
      });
    }
  } catch (err) {
    console.error('Error getting all games:', err);
    throw err;
  }
}

// SMS Context Management
async function saveLastCommand(phoneNumber, context) {
  try {
    if (isProduction) {
      const client = await pool.connect();
      const query = `
        INSERT INTO sms_contexts (phone_number, last_command, updated_at)
        VALUES ($1, $2, CURRENT_TIMESTAMP)
        ON CONFLICT (phone_number)
        DO UPDATE SET last_command = $2, updated_at = CURRENT_TIMESTAMP
      `;
      await client.query(query, [phoneNumber, context]);
      client.release();
    } else {
      return new Promise((resolve, reject) => {
        const stmt = db.prepare(`
          INSERT OR REPLACE INTO sms_contexts (phone_number, last_command, updated_at)
          VALUES (?, ?, CURRENT_TIMESTAMP)
        `);
        stmt.run([phoneNumber, context], function(err) {
          if (err) reject(err);
          else resolve(this);
        });
        stmt.finalize();
      });
    }
    console.log(`[SMS Context] Saved context for ${phoneNumber}: ${context}`);
  } catch (err) {
    console.error('Error saving SMS context:', err);
  }
}

async function getLastCommand(phoneNumber) {
  try {
    if (isProduction) {
      const client = await pool.connect();
      const result = await client.query('SELECT last_command FROM sms_contexts WHERE phone_number = $1', [phoneNumber]);
      client.release();
      const context = result.rows.length > 0 ? result.rows[0].last_command : null;
      console.log(`[SMS Context] Retrieved context for ${phoneNumber}: ${context}`);
      return context;
    } else {
      return new Promise((resolve, reject) => {
        db.get('SELECT last_command FROM sms_contexts WHERE phone_number = ?', [phoneNumber], (err, row) => {
          if (err) {
            reject(err);
          } else {
            const context = row ? row.last_command : null;
            console.log(`[SMS Context] Retrieved context for ${phoneNumber}: ${context}`);
            resolve(context);
          }
        });
      });
    }
  } catch (err) {
    console.error('Error getting SMS context:', err);
    return null;
  }
}

async function clearLastCommand(phoneNumber) {
  try {
    if (isProduction) {
      const client = await pool.connect();
      await client.query('DELETE FROM sms_contexts WHERE phone_number = $1', [phoneNumber]);
      client.release();
    } else {
      return new Promise((resolve, reject) => {
        db.run('DELETE FROM sms_contexts WHERE phone_number = ?', [phoneNumber], function(err) {
          if (err) reject(err);
          else resolve(this);
        });
      });
    }
    console.log(`[SMS Context] Cleared context for ${phoneNumber}`);
  } catch (err) {
    console.error('Error clearing SMS context:', err);
  }
}

// Reminder tracking functions
async function hasReminderBeenSent(gameId, playerPhone, reminderType) {
  try {
    if (isProduction) {
      const client = await pool.connect();
      const result = await client.query(
        'SELECT 1 FROM reminder_log WHERE game_id = $1 AND player_phone = $2 AND reminder_type = $3',
        [gameId, playerPhone, reminderType]
      );
      client.release();
      return result.rows.length > 0;
    } else {
      return new Promise((resolve, reject) => {
        db.get(
          'SELECT 1 FROM reminder_log WHERE game_id = ? AND player_phone = ? AND reminder_type = ?',
          [gameId, playerPhone, reminderType],
          (err, row) => {
            if (err) reject(err);
            else resolve(!!row);
          }
        );
      });
    }
  } catch (err) {
    console.error('Error checking reminder status:', err);
    return false;
  }
}

async function markReminderSent(gameId, playerPhone, reminderType) {
  try {
    if (isProduction) {
      const client = await pool.connect();
      await client.query(
        'INSERT INTO reminder_log (game_id, player_phone, reminder_type) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
        [gameId, playerPhone, reminderType]
      );
      client.release();
    } else {
      return new Promise((resolve, reject) => {
        const stmt = db.prepare(`
          INSERT OR IGNORE INTO reminder_log (game_id, player_phone, reminder_type) 
          VALUES (?, ?, ?)
        `);
        stmt.run([gameId, playerPhone, reminderType], function(err) {
          if (err) reject(err);
          else resolve(this);
        });
        stmt.finalize();
      });
    }
    console.log(`[REMINDER] Marked ${reminderType} reminder sent for game ${gameId}, player ${playerPhone}`);
  } catch (err) {
    console.error('Error marking reminder sent:', err);
  }
}

// Graceful shutdown
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