// database.js - All database-related functions
require('dotenv').config();

const isProduction = process.env.DATABASE_URL ? true : false;
let db, pool;

console.log(`Environment: ${isProduction ? 'Production (PostgreSQL)' : 'Local (SQLite)'}`);

// Render's PostgreSQL requires TLS and presents a certificate the app does not pin, which
// is why production connects with rejectUnauthorized: false. A PostgreSQL started for the
// parity suite (npm run test:pg) usually has no TLS at all and refuses the handshake
// outright, so the local case has to be able to say so.
//
// Explicit sslmode in the URL always wins; otherwise a loopback host means no TLS and
// anything else - every real deployment - keeps it.
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

// Which local file SQLite opens. A relative path resolves against the working directory, which
// is how this has always behaved and is why each Git worktree already gets its own database.
//
// SQLITE_DB_FILE hands a process a database of its own instead. Two callers use it, both so
// that an assertion cannot be decided by whatever a developer's own pickleball.db happens to
// contain: the browser smoke's throwaway server (scripts/lib/local-server.js) and every
// `node --test` file (test/support/isolated-database.mjs).
const sqliteFile = process.env.SQLITE_DB_FILE || 'pickleball.db';

function postgresSslOption(connectionString) {
  const secure = { rejectUnauthorized: false };
  let parsed;
  try {
    parsed = new URL(connectionString);
  } catch {
    return secure;
  }
  const sslmode = parsed.searchParams.get('sslmode');
  if (sslmode) return sslmode === 'disable' ? false : secure;
  return LOOPBACK_HOSTS.has(parsed.hostname) ? false : secure;
}

if (isProduction) {
  const { Pool } = require('pg');
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: postgresSslOption(process.env.DATABASE_URL)
  });
  console.log('Using PostgreSQL for production');
} else {
  const sqlite3 = require('sqlite3').verbose();
  db = new sqlite3.Database(sqliteFile, (err) => {
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
  postgresSslOption,
  pool,
  db,
  withPgClient,
  sqliteAll,
  sqliteGet,
  sqliteRun,
  sqlitePrepareRun,
  closeDatabaseConnection
};
