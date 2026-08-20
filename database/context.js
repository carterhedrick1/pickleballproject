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
  // Several local processes share this file: the app, the verify rigs, and the parallel
  // node --test workers. Two settings make that safe. WAL journal mode lets readers and
  // writers coexist - in the default rollback mode, a connection upgrading a read to a
  // write while another process writes gets an immediate SQLITE_BUSY that the busy
  // handler deliberately never retries (deadlock avoidance). And the busy timeout makes
  // plain writer-vs-writer contention wait its turn instead of failing.
  db.run('PRAGMA journal_mode = WAL');
  db.configure('busyTimeout', 5000);
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
  isProduction,
  pool,
  db,
  withPgClient,
  sqliteAll,
  sqliteGet,
  sqliteRun,
  sqlitePrepareRun,
  closeDatabaseConnection
};
