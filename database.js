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
            image_mime_type TEXT,
            image_data BYTEA,
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
        // Render gives the app no persistent disk, so photos live in the database.
        await client.query(`
          CREATE TABLE IF NOT EXISTS game_photos (
            id TEXT PRIMARY KEY,
            game_id TEXT NOT NULL,
            mime_type TEXT NOT NULL,
            data BYTEA NOT NULL,
            caption TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `);
        await client.query('CREATE INDEX IF NOT EXISTS idx_game_photos_game ON game_photos (game_id)');

        await client.query(`
          CREATE TABLE IF NOT EXISTS court_images (
            id TEXT PRIMARY KEY,
            court_name_key TEXT NOT NULL,
            mime_type TEXT NOT NULL,
            image_data BYTEA NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `);
        await client.query('CREATE INDEX IF NOT EXISTS idx_court_images_court ON court_images (court_name_key)');

        // Add column to games table for selected court image (if it doesn't exist)
        try {
          await client.query(`ALTER TABLE games ADD COLUMN court_image_id TEXT`);
        } catch (err) {
          if (!err.message.includes('already exists')) {
            throw err;
          }
        }

        // Developer area: the idea board, the error log and the published doc pages.
        await client.query(`
          CREATE TABLE IF NOT EXISTS dev_notes (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            body TEXT DEFAULT '',
            status TEXT DEFAULT 'idea',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `);
        await client.query(`
          CREATE TABLE IF NOT EXISTS app_errors (
            id TEXT PRIMARY KEY,
            source TEXT NOT NULL,
            message TEXT NOT NULL,
            stack TEXT,
            page TEXT,
            user_agent TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `);
        await client.query('CREATE INDEX IF NOT EXISTS idx_app_errors_created ON app_errors (created_at)');
        // Same reason as photos: no persistent disk, so the generated doc pages live here.
        await client.query(`
          CREATE TABLE IF NOT EXISTS dev_assets (
            name TEXT PRIMARY KEY,
            content TEXT NOT NULL,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
        image_mime_type TEXT,
        image_data BLOB,
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

      // Render gives the app no persistent disk, so photos live in the database.
      await sqliteRun(`CREATE TABLE IF NOT EXISTS game_photos (
        id TEXT PRIMARY KEY,
        game_id TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        data BLOB NOT NULL,
        caption TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);
      await sqliteRun('CREATE INDEX IF NOT EXISTS idx_game_photos_game ON game_photos (game_id)');
      console.log('SQLite game_photos table initialized');

      await sqliteRun(`CREATE TABLE IF NOT EXISTS court_images (
        id TEXT PRIMARY KEY,
        court_name_key TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        image_data BLOB NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);
      await sqliteRun('CREATE INDEX IF NOT EXISTS idx_court_images_court ON court_images (court_name_key)');
      console.log('SQLite court_images table initialized');

      // Add column to games table for selected court image
      try {
        await sqliteRun(`ALTER TABLE games ADD COLUMN court_image_id TEXT`);
        console.log('Added court_image_id column to games table');
      } catch (err) {
        // Column already exists, that's fine
        if (!err.message.includes('duplicate column')) {
          throw err;
        }
      }

      // Developer area: the idea board, the error log and the published doc pages.
      await sqliteRun(`CREATE TABLE IF NOT EXISTS dev_notes (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        body TEXT DEFAULT '',
        status TEXT DEFAULT 'idea',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);
      await sqliteRun(`CREATE TABLE IF NOT EXISTS app_errors (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        message TEXT NOT NULL,
        stack TEXT,
        page TEXT,
        user_agent TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);
      await sqliteRun('CREATE INDEX IF NOT EXISTS idx_app_errors_created ON app_errors (created_at)');
      // Same reason as photos: no persistent disk, so the generated doc pages live here.
      await sqliteRun(`CREATE TABLE IF NOT EXISTS dev_assets (
        name TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);
      console.log('SQLite dev tables initialized');
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

async function saveCourtImage(displayName, mimeType, imageData) {
  const trimmed = String(displayName == null ? '' : displayName).trim().replace(/\s+/g, ' ');
  if (!trimmed) return;
  const key = locationKey(trimmed);
  try {
    if (isProduction) {
      await withPgClient(async (client) => {
        await client.query(
          'UPDATE locations SET image_mime_type = $1, image_data = $2 WHERE name_key = $3',
          [mimeType, imageData, key]
        );
      });
    } else {
      await sqlitePrepareRun(
        'UPDATE locations SET image_mime_type = ?, image_data = ? WHERE name_key = ?',
        [mimeType, imageData, key]
      );
    }
  } catch (err) {
    console.error('Error saving court image:', err);
    throw err;
  }
}

async function getCourtImage(displayName) {
  const trimmed = String(displayName == null ? '' : displayName).trim().replace(/\s+/g, ' ');
  const key = locationKey(trimmed);
  try {
    if (isProduction) {
      return await withPgClient(async (client) => {
        const result = await client.query(
          'SELECT image_mime_type, image_data FROM locations WHERE name_key = $1',
          [key]
        );
        return result.rows[0] || null;
      });
    } else {
      return await sqliteGet(
        'SELECT image_mime_type, image_data FROM locations WHERE name_key = ?',
        [key]
      );
    }
  } catch (err) {
    console.error('Error getting court image:', err);
    throw err;
  }
}

async function getAllCourtImages() {
  try {
    if (isProduction) {
      return await withPgClient(async (client) => {
        const result = await client.query(
          'SELECT display_name, image_mime_type FROM locations WHERE image_data IS NOT NULL ORDER BY name_key'
        );
        return result.rows;
      });
    } else {
      return await sqliteAll(
        'SELECT display_name, image_mime_type FROM locations WHERE image_data IS NOT NULL ORDER BY name_key'
      );
    }
  } catch (err) {
    console.error('Error getting all court images:', err);
    throw err;
  }
}

async function saveCourtImageToLibrary(courtName, mimeType, imageData) {
  const trimmed = String(courtName == null ? '' : courtName).trim().replace(/\s+/g, ' ');
  if (!trimmed) return null;
  const key = locationKey(trimmed);
  const imageId = Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
  try {
    if (isProduction) {
      await withPgClient(async (client) => {
        await client.query(
          'INSERT INTO court_images (id, court_name_key, mime_type, image_data) VALUES ($1, $2, $3, $4)',
          [imageId, key, mimeType, imageData]
        );
      });
    } else {
      await sqlitePrepareRun(
        'INSERT INTO court_images (id, court_name_key, mime_type, image_data) VALUES (?, ?, ?, ?)',
        [imageId, key, mimeType, imageData]
      );
    }
    return imageId;
  } catch (err) {
    console.error('Error saving court image to library:', err);
    throw err;
  }
}

async function getCourtImagesLibrary(courtName) {
  const trimmed = String(courtName == null ? '' : courtName).trim().replace(/\s+/g, ' ');
  const key = locationKey(trimmed);
  try {
    if (isProduction) {
      return await withPgClient(async (client) => {
        const result = await client.query(
          'SELECT id, mime_type, created_at FROM court_images WHERE court_name_key = $1 ORDER BY created_at DESC',
          [key]
        );
        return result.rows;
      });
    } else {
      return await sqliteAll(
        'SELECT id, mime_type, created_at FROM court_images WHERE court_name_key = ? ORDER BY created_at DESC',
        [key]
      );
    }
  } catch (err) {
    console.error('Error getting court images library:', err);
    throw err;
  }
}

async function getCourtImageFromLibrary(imageId) {
  try {
    if (isProduction) {
      return await withPgClient(async (client) => {
        const result = await client.query(
          'SELECT mime_type, image_data FROM court_images WHERE id = $1',
          [imageId]
        );
        return result.rows[0] || null;
      });
    } else {
      return await sqliteGet(
        'SELECT mime_type, image_data FROM court_images WHERE id = ?',
        [imageId]
      );
    }
  } catch (err) {
    console.error('Error getting court image from library:', err);
    throw err;
  }
}

async function deleteCourtImageFromLibrary(imageId) {
  try {
    if (isProduction) {
      await withPgClient(async (client) => {
        await client.query('DELETE FROM court_images WHERE id = $1', [imageId]);
      });
    } else {
      await sqlitePrepareRun('DELETE FROM court_images WHERE id = ?', [imageId]);
    }
  } catch (err) {
    console.error('Error deleting court image from library:', err);
    throw err;
  }
}

async function setGameCourtImage(gameId, imageId) {
  try {
    if (isProduction) {
      await withPgClient(async (client) => {
        await client.query('UPDATE games SET court_image_id = $1 WHERE id = $2', [imageId, gameId]);
      });
    } else {
      await sqlitePrepareRun('UPDATE games SET court_image_id = ? WHERE id = ?', [imageId, gameId]);
    }
  } catch (err) {
    console.error('Error setting game court image:', err);
    throw err;
  }
}

async function getGameCourtImageId(gameId) {
  try {
    if (isProduction) {
      return await withPgClient(async (client) => {
        const result = await client.query('SELECT court_image_id FROM games WHERE id = $1', [gameId]);
        return result.rows[0]?.court_image_id || null;
      });
    } else {
      const row = await sqliteGet('SELECT court_image_id FROM games WHERE id = ?', [gameId]);
      return row?.court_image_id || null;
    }
  } catch (err) {
    console.error('Error getting game court image:', err);
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
// Game photo functions
//
// The image bytes are only ever read by getPhoto(). Every other query deliberately leaves
// the data column out, so listing a game's photos does not drag megabytes through memory.
// ---------------------------------------------------------------------------

async function savePhoto(photoId, gameId, mimeType, dataBuffer, caption) {
  try {
    if (isProduction) {
      await withPgClient(async (client) => {
        await client.query(
          'INSERT INTO game_photos (id, game_id, mime_type, data, caption) VALUES ($1, $2, $3, $4, $5)',
          [photoId, gameId, mimeType, dataBuffer, caption || null]
        );
      });
    } else {
      await sqlitePrepareRun(
        'INSERT INTO game_photos (id, game_id, mime_type, data, caption) VALUES (?, ?, ?, ?, ?)',
        [photoId, gameId, mimeType, dataBuffer, caption || null]
      );
    }
  } catch (err) {
    console.error('Error saving photo:', err);
    throw err;
  }
}

/** Metadata only - never the image bytes. */
async function getPhotosForGame(gameId) {
  const toPhoto = (row) => ({
    id: row.id,
    mimeType: row.mime_type,
    caption: row.caption || '',
    bytes: Number(row.bytes),
    createdAt: row.created_at
  });
  try {
    if (isProduction) {
      const rows = await withPgClient(async (client) => {
        const result = await client.query(
          `SELECT id, mime_type, caption, created_at, LENGTH(data) AS bytes
             FROM game_photos WHERE game_id = $1 ORDER BY created_at, id`,
          [gameId]
        );
        return result.rows;
      });
      return rows.map(toPhoto);
    } else {
      const rows = await sqliteAll(
        `SELECT id, mime_type, caption, created_at, LENGTH(data) AS bytes
           FROM game_photos WHERE game_id = ? ORDER BY created_at, id`,
        [gameId]
      );
      return rows.map(toPhoto);
    }
  } catch (err) {
    console.error('Error listing photos:', err);
    throw err;
  }
}

/** game_id is in the WHERE clause on purpose: a photo id from one game cannot be fetched
 *  by guessing it against another. */
async function getPhoto(gameId, photoId) {
  try {
    if (isProduction) {
      const rows = await withPgClient(async (client) => {
        const result = await client.query(
          'SELECT mime_type, data FROM game_photos WHERE game_id = $1 AND id = $2',
          [gameId, photoId]
        );
        return result.rows;
      });
      return rows.length ? { mimeType: rows[0].mime_type, data: rows[0].data } : null;
    } else {
      const row = await sqliteGet(
        'SELECT mime_type, data FROM game_photos WHERE game_id = ? AND id = ?',
        [gameId, photoId]
      );
      return row ? { mimeType: row.mime_type, data: row.data } : null;
    }
  } catch (err) {
    console.error('Error getting photo:', err);
    throw err;
  }
}

/** Returns how many rows were removed, so the caller can 404 on a photo that was not there. */
async function deletePhoto(gameId, photoId) {
  try {
    if (isProduction) {
      return await withPgClient(async (client) => {
        const result = await client.query(
          'DELETE FROM game_photos WHERE game_id = $1 AND id = $2',
          [gameId, photoId]
        );
        return result.rowCount;
      });
    } else {
      const result = await sqliteRun(
        'DELETE FROM game_photos WHERE game_id = ? AND id = ?',
        [gameId, photoId]
      );
      return result.changes;
    }
  } catch (err) {
    console.error('Error deleting photo:', err);
    throw err;
  }
}

async function countPhotosForGame(gameId) {
  try {
    if (isProduction) {
      const rows = await withPgClient(async (client) => {
        const result = await client.query(
          'SELECT COUNT(*) AS count FROM game_photos WHERE game_id = $1', [gameId]
        );
        return result.rows;
      });
      return Number(rows[0].count);
    } else {
      const row = await sqliteGet('SELECT COUNT(*) AS count FROM game_photos WHERE game_id = ?', [gameId]);
      return Number(row.count);
    }
  } catch (err) {
    console.error('Error counting photos:', err);
    throw err;
  }
}

/** One query for the whole My Games page, rather than one per card. */
async function getAllPhotoCounts() {
  try {
    const rows = isProduction
      ? await withPgClient(async (client) => {
          const result = await client.query('SELECT game_id, COUNT(*) AS count FROM game_photos GROUP BY game_id');
          return result.rows;
        })
      : await sqliteAll('SELECT game_id, COUNT(*) AS count FROM game_photos GROUP BY game_id');

    const counts = {};
    rows.forEach((row) => { counts[row.game_id] = Number(row.count); });
    return counts;
  } catch (err) {
    console.error('Error counting photos:', err);
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
// Developer area: idea board, error log, published doc pages
// ---------------------------------------------------------------------------

const crypto = require('crypto');

// Postgres hands back a Date; SQLite hands back "YYYY-MM-DD HH:MM:SS" in UTC.
// The developer page wants one shape it can format, so everything leaves here as ISO.
function toIso(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const asString = String(value);
  const parsed = new Date(asString.includes('T') ? asString : asString.replace(' ', 'T') + 'Z');
  return isNaN(parsed.getTime()) ? asString : parsed.toISOString();
}

/** Cheap "is the database actually answering?" check for the status dashboard. */
async function pingDatabase() {
  if (isProduction) {
    await withPgClient((client) => client.query('SELECT 1'));
  } else {
    await sqliteGet('SELECT 1');
  }
  return true;
}

async function countRows(table) {
  if (isProduction) {
    const rows = await withPgClient(async (client) => {
      const result = await client.query(`SELECT COUNT(*) AS count FROM ${table}`);
      return result.rows;
    });
    return Number(rows[0].count);
  }
  const row = await sqliteGet(`SELECT COUNT(*) AS count FROM ${table}`);
  return Number(row.count);
}

function mapNote(row) {
  return {
    id: row.id,
    title: row.title,
    body: row.body || '',
    status: row.status || 'idea',
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

async function listDevNotes() {
  const rows = isProduction
    ? await withPgClient(async (client) => {
        const result = await client.query('SELECT * FROM dev_notes ORDER BY updated_at DESC');
        return result.rows;
      })
    : await sqliteAll('SELECT * FROM dev_notes ORDER BY updated_at DESC');
  return rows.map(mapNote);
}

async function saveDevNote(title, body, status) {
  const id = crypto.randomUUID();
  if (isProduction) {
    await withPgClient((client) => client.query(
      'INSERT INTO dev_notes (id, title, body, status) VALUES ($1, $2, $3, $4)',
      [id, title, body, status]
    ));
  } else {
    await sqlitePrepareRun(
      'INSERT INTO dev_notes (id, title, body, status) VALUES (?, ?, ?, ?)',
      [id, title, body, status]
    );
  }
  return id;
}

async function updateDevNote(id, fields) {
  const existing = isProduction
    ? await withPgClient(async (client) => {
        const result = await client.query('SELECT * FROM dev_notes WHERE id = $1', [id]);
        return result.rows[0] || null;
      })
    : await sqliteGet('SELECT * FROM dev_notes WHERE id = ?', [id]);
  if (!existing) return null;

  const title = fields.title !== undefined ? fields.title : existing.title;
  const body = fields.body !== undefined ? fields.body : existing.body;
  const status = fields.status !== undefined ? fields.status : existing.status;

  if (isProduction) {
    await withPgClient((client) => client.query(
      'UPDATE dev_notes SET title = $1, body = $2, status = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $4',
      [title, body, status, id]
    ));
  } else {
    await sqliteRun(
      'UPDATE dev_notes SET title = ?, body = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [title, body, status, id]
    );
  }
  return mapNote({ ...existing, title, body, status, updated_at: new Date() });
}

async function deleteDevNote(id) {
  if (isProduction) {
    const count = await withPgClient(async (client) => {
      const result = await client.query('DELETE FROM dev_notes WHERE id = $1', [id]);
      return result.rowCount;
    });
    return count;
  }
  const result = await sqliteRun('DELETE FROM dev_notes WHERE id = ?', [id]);
  return result.changes;
}

async function countDevNotesByStatus() {
  const rows = isProduction
    ? await withPgClient(async (client) => {
        const result = await client.query('SELECT status, COUNT(*) AS count FROM dev_notes GROUP BY status');
        return result.rows;
      })
    : await sqliteAll('SELECT status, COUNT(*) AS count FROM dev_notes GROUP BY status');
  const counts = {};
  rows.forEach((row) => { counts[row.status] = Number(row.count); });
  return counts;
}

/**
 * Best-effort error recording. Callers are usually already handling a failure,
 * so this never throws - a broken logger must not become a second outage.
 */
async function logAppError(source, { message, stack, page, userAgent } = {}) {
  try {
    const id = crypto.randomUUID();
    const params = [
      id,
      String(source || 'server').slice(0, 20),
      String(message || 'Unknown error').slice(0, 500),
      stack ? String(stack).slice(0, 2000) : null,
      page ? String(page).slice(0, 300) : null,
      userAgent ? String(userAgent).slice(0, 300) : null
    ];
    if (isProduction) {
      await withPgClient((client) => client.query(
        'INSERT INTO app_errors (id, source, message, stack, page, user_agent) VALUES ($1, $2, $3, $4, $5, $6)',
        params
      ));
    } else {
      // sqliteRun, not sqlitePrepareRun: db.prepare() throws natively if the table is
      // not there yet, which would take down the process this function exists to record.
      await sqliteRun(
        'INSERT INTO app_errors (id, source, message, stack, page, user_agent) VALUES (?, ?, ?, ?, ?, ?)',
        params
      );
    }
    return id;
  } catch (err) {
    console.error('Error writing to app_errors (swallowed):', err.message);
    return null;
  }
}

async function listAppErrors(limit = 200) {
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 200, 1), 500);
  const rows = isProduction
    ? await withPgClient(async (client) => {
        const result = await client.query('SELECT * FROM app_errors ORDER BY created_at DESC LIMIT $1', [safeLimit]);
        return result.rows;
      })
    : await sqliteAll('SELECT * FROM app_errors ORDER BY created_at DESC LIMIT ?', [safeLimit]);
  return rows.map((row) => ({
    id: row.id,
    source: row.source,
    message: row.message,
    stack: row.stack,
    page: row.page,
    userAgent: row.user_agent,
    createdAt: toIso(row.created_at)
  }));
}

async function countAppErrors(sinceDays = 7) {
  const days = parseInt(sinceDays, 10) || 7;
  if (isProduction) {
    const rows = await withPgClient(async (client) => {
      const result = await client.query(
        `SELECT COUNT(*) AS count FROM app_errors WHERE created_at > CURRENT_TIMESTAMP - INTERVAL '${days} days'`
      );
      return result.rows;
    });
    return Number(rows[0].count);
  }
  const row = await sqliteGet(
    `SELECT COUNT(*) AS count FROM app_errors WHERE created_at > datetime('now', '-${days} days')`
  );
  return Number(row.count);
}

/** Keeps the newest 500 rows and nothing older than 30 days, so the table can't grow forever. */
async function pruneAppErrors() {
  try {
    if (isProduction) {
      await withPgClient(async (client) => {
        await client.query("DELETE FROM app_errors WHERE created_at < CURRENT_TIMESTAMP - INTERVAL '30 days'");
        await client.query('DELETE FROM app_errors WHERE id NOT IN (SELECT id FROM app_errors ORDER BY created_at DESC LIMIT 500)');
      });
    } else {
      await sqliteRun("DELETE FROM app_errors WHERE created_at < datetime('now', '-30 days')");
      await sqliteRun('DELETE FROM app_errors WHERE id NOT IN (SELECT id FROM app_errors ORDER BY created_at DESC LIMIT 500)');
    }
  } catch (err) {
    console.error('Error pruning app_errors (swallowed):', err.message);
  }
}

async function saveDevAsset(name, content) {
  if (isProduction) {
    await withPgClient((client) => client.query(`
      INSERT INTO dev_assets (name, content, updated_at)
      VALUES ($1, $2, CURRENT_TIMESTAMP)
      ON CONFLICT (name) DO UPDATE SET content = $2, updated_at = CURRENT_TIMESTAMP
    `, [name, content]));
  } else {
    await sqlitePrepareRun(
      'INSERT OR REPLACE INTO dev_assets (name, content, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)',
      [name, content]
    );
  }
}

async function getDevAsset(name) {
  const row = isProduction
    ? await withPgClient(async (client) => {
        const result = await client.query('SELECT content, updated_at FROM dev_assets WHERE name = $1', [name]);
        return result.rows[0] || null;
      })
    : await sqliteGet('SELECT content, updated_at FROM dev_assets WHERE name = ?', [name]);
  if (!row) return null;
  return { content: row.content, updatedAt: toIso(row.updated_at) };
}

/** Metadata only - the screens page is several megabytes, far too big to load for a status check. */
async function getDevAssetMeta(name) {
  const row = isProduction
    ? await withPgClient(async (client) => {
        const result = await client.query('SELECT updated_at, LENGTH(content) AS size FROM dev_assets WHERE name = $1', [name]);
        return result.rows[0] || null;
      })
    : await sqliteGet('SELECT updated_at, LENGTH(content) AS size FROM dev_assets WHERE name = ?', [name]);
  if (!row) return null;
  return { updatedAt: toIso(row.updated_at), size: Number(row.size) };
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
  deleteGamePermanently,
  addLocation,
  getLocations,
  saveCourtImage,
  getCourtImage,
  getAllCourtImages,
  saveCourtImageToLibrary,
  getCourtImagesLibrary,
  getCourtImageFromLibrary,
  deleteCourtImageFromLibrary,
  setGameCourtImage,
  getGameCourtImageId,
  upsertRosterEntry,
  recordRosterSighting,
  getRosterForHost,
  deleteRosterEntry,
  savePhoto,
  getPhotosForGame,
  getPhoto,
  deletePhoto,
  countPhotosForGame,
  getAllPhotoCounts,
  saveLastCommand,
  getLastCommand,
  clearLastCommand,
  hasReminderBeenSent,
  markReminderSent,
  pingDatabase,
  countRows,
  listDevNotes,
  saveDevNote,
  updateDevNote,
  deleteDevNote,
  countDevNotesByStatus,
  logAppError,
  listAppErrors,
  countAppErrors,
  pruneAppErrors,
  saveDevAsset,
  getDevAsset,
  getDevAssetMeta,
  closeDatabaseConnection,
  isProduction
};
