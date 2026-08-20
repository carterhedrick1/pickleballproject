/**
 * Ordered, idempotent schema migrations.
 *
 * Before this existed, every boot re-ran a long list of CREATE TABLE IF NOT EXISTS
 * statements plus conditional ALTERs, and the only record of what a database had already
 * been through was the shape of the database itself. That works until two statements have
 * to run in a particular order, or until a change is not expressible as "create if absent".
 *
 * Now each change is a numbered migration that runs exactly once and is recorded in
 * `schema_migrations`. Migration 001 is the schema as it stood on 2026-08-20, written so it
 * is a no-op on a database that already has those tables - which is what production is.
 *
 * The runner is deliberately given a connection rather than reaching for the app's own
 * database handle, so tests can migrate a throwaway file and the PostgreSQL parity path can
 * migrate a disposable database.
 */

const MIGRATIONS_TABLE = 'schema_migrations';

// Any bigint works; it only has to be the same number in every process that migrates this
// database. Two Render instances overlapping during a deploy is the case that matters.
const POSTGRES_ADVISORY_LOCK_KEY = 8675309001;

/**
 * A dialect-neutral connection. Migration SQL is written with `?` placeholders and the
 * PostgreSQL adapter rewrites them to $1, $2, ... - so no migration may contain a literal
 * `?` inside a string literal.
 */
class MigrationRunner {
  constructor({ dialect, run, get, all, quoteIdentifier }) {
    this.dialect = dialect;
    this._run = run;
    this._get = get;
    this._all = all;
    this._quoteIdentifier = quoteIdentifier;
  }

  get isPostgres() {
    return this.dialect === 'postgres';
  }

  /** Picks the value for this dialect: `runner.pick({ postgres: 'JSONB', sqlite: 'TEXT' })`. */
  pick(byDialect) {
    return byDialect[this.dialect];
  }

  run(sql, params = []) {
    return this._run(sql, params);
  }

  get(sql, params = []) {
    return this._get(sql, params);
  }

  all(sql, params = []) {
    return this._all(sql, params);
  }

  /** Runs statements in order. Migrations use this for their plain DDL. */
  async exec(statements) {
    for (const statement of statements) {
      await this._run(statement, []);
    }
  }

  async hasTable(name) {
    if (this.isPostgres) {
      const row = await this._get(
        `SELECT 1 AS present FROM information_schema.tables
         WHERE table_schema = current_schema() AND table_name = ?`,
        [name]
      );
      return Boolean(row);
    }
    const row = await this._get(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`,
      [name]
    );
    return Boolean(row);
  }

  async hasColumn(table, column) {
    if (this.isPostgres) {
      const row = await this._get(
        `SELECT 1 AS present FROM information_schema.columns
         WHERE table_schema = current_schema() AND table_name = ? AND column_name = ?`,
        [table, column]
      );
      return Boolean(row);
    }
    // PRAGMA takes an identifier, not a bound parameter.
    const rows = await this._all(`PRAGMA table_info(${this._quoteIdentifier(table)})`, []);
    return rows.some((row) => row.name === column);
  }

  /**
   * Adds a column only when it is missing. Asking the catalog beats catching the error,
   * which is what the old schema.js did - "already exists" and "duplicate column" are
   * different strings in the two engines, and a typo'd match swallowed real failures.
   */
  async addColumnIfMissing(table, column, type) {
    const columnType = typeof type === 'string' ? type : this.pick(type);
    if (await this.hasColumn(table, column)) return false;
    await this._run(
      `ALTER TABLE ${this._quoteIdentifier(table)} ADD COLUMN ${this._quoteIdentifier(column)} ${columnType}`,
      []
    );
    return true;
  }

  begin() {
    // SQLite defers taking the write lock until the first write under a plain BEGIN, which
    // is exactly the window where two migrating processes could both decide a migration is
    // pending. IMMEDIATE takes the lock up front.
    return this._run(this.isPostgres ? 'BEGIN' : 'BEGIN IMMEDIATE', []);
  }

  commit() {
    return this._run('COMMIT', []);
  }

  rollback() {
    return this._run('ROLLBACK', []);
  }

  /**
   * Serializes migration runs across processes. PostgreSQL gets a session advisory lock;
   * SQLite relies on BEGIN IMMEDIATE above, since the whole file is locked by one writer.
   */
  async acquireLock() {
    if (!this.isPostgres) return;
    await this._run('SELECT pg_advisory_lock(?)', [POSTGRES_ADVISORY_LOCK_KEY]);
  }

  async releaseLock() {
    if (!this.isPostgres) return;
    await this._run('SELECT pg_advisory_unlock(?)', [POSTGRES_ADVISORY_LOCK_KEY]);
  }
}

function toPostgresPlaceholders(sql) {
  let index = 0;
  return sql.replace(/\?/g, () => {
    index += 1;
    return `$${index}`;
  });
}

function quotePostgresIdentifier(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

function quoteSqliteIdentifier(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

/** Wraps a connected `pg` client. The same client must serve the whole run: advisory locks
 *  and transactions are per-session. */
function createPostgresRunner(client) {
  const query = (sql, params) => client.query(toPostgresPlaceholders(sql), params);
  return new MigrationRunner({
    dialect: 'postgres',
    run: async (sql, params) => query(sql, params),
    get: async (sql, params) => (await query(sql, params)).rows[0] || null,
    all: async (sql, params) => (await query(sql, params)).rows,
    quoteIdentifier: quotePostgresIdentifier
  });
}

/** Wraps an open `sqlite3` Database handle. */
function createSqliteRunner(db) {
  const call = (method, sql, params) =>
    new Promise((resolve, reject) => {
      db[method](sql, params, function callback(err, result) {
        if (err) reject(err);
        else resolve(method === 'run' ? this : result);
      });
    });
  return new MigrationRunner({
    dialect: 'sqlite',
    run: (sql, params) => call('run', sql, params),
    get: async (sql, params) => (await call('get', sql, params)) || null,
    all: async (sql, params) => (await call('all', sql, params)) || [],
    quoteIdentifier: quoteSqliteIdentifier
  });
}

async function ensureMigrationsTable(runner) {
  const timestamp = runner.pick({ postgres: 'TIMESTAMP', sqlite: 'DATETIME' });
  await runner.run(`
    CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
      id TEXT PRIMARY KEY,
      description TEXT NOT NULL DEFAULT '',
      applied_at ${timestamp} DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

async function appliedMigrationIds(runner) {
  const rows = await runner.all(`SELECT id FROM ${MIGRATIONS_TABLE}`);
  return new Set(rows.map((row) => row.id));
}

/**
 * Runs every migration that has not been recorded yet, in list order.
 *
 * Each migration and its `schema_migrations` row commit together, so a migration is either
 * fully applied and recorded or not applied at all. A failure stops the run: later
 * migrations may depend on the one that failed.
 *
 * @param {MigrationRunner} runner
 * @param {Array<{id: string, description: string, up: Function}>} migrations
 * @returns {Promise<{applied: string[], alreadyApplied: string[]}>}
 */
async function runMigrations(runner, migrations) {
  assertMigrationList(migrations);

  const applied = [];
  const alreadyApplied = [];

  await runner.acquireLock();
  try {
    await ensureMigrationsTable(runner);
    const done = await appliedMigrationIds(runner);

    for (const migration of migrations) {
      if (done.has(migration.id)) {
        alreadyApplied.push(migration.id);
        continue;
      }

      await runner.begin();
      try {
        // Re-check inside the transaction: another process may have applied this one
        // between our snapshot above and this moment.
        const row = await runner.get(`SELECT id FROM ${MIGRATIONS_TABLE} WHERE id = ?`, [migration.id]);
        if (row) {
          await runner.rollback();
          alreadyApplied.push(migration.id);
          continue;
        }

        await migration.up(runner);
        await runner.run(
          `INSERT INTO ${MIGRATIONS_TABLE} (id, description) VALUES (?, ?)`,
          [migration.id, migration.description || '']
        );
        await runner.commit();
        applied.push(migration.id);
        console.log(`[MIGRATION] applied ${migration.id} - ${migration.description}`);
      } catch (err) {
        await runner.rollback().catch(() => {});
        console.error(`[MIGRATION] ${migration.id} failed:`, err.message);
        throw err;
      }
    }
  } finally {
    await runner.releaseLock().catch(() => {});
  }

  return { applied, alreadyApplied };
}

function assertMigrationList(migrations) {
  if (!Array.isArray(migrations) || migrations.length === 0) {
    throw new Error('runMigrations needs a non-empty ordered migration list');
  }
  const seen = new Set();
  for (const migration of migrations) {
    if (!migration || typeof migration.id !== 'string' || !migration.id) {
      throw new Error('Every migration needs a string id');
    }
    if (seen.has(migration.id)) {
      throw new Error(`Duplicate migration id: ${migration.id}`);
    }
    seen.add(migration.id);
    if (typeof migration.up !== 'function') {
      throw new Error(`Migration ${migration.id} needs an up(runner) function`);
    }
  }
  const ids = migrations.map((migration) => migration.id);
  const sorted = [...ids].sort();
  for (let index = 0; index < ids.length; index += 1) {
    if (ids[index] !== sorted[index]) {
      throw new Error(
        `Migrations must be listed in id order; ${ids[index]} appears where ${sorted[index]} was expected`
      );
    }
  }
}

module.exports = {
  MIGRATIONS_TABLE,
  MigrationRunner,
  createPostgresRunner,
  createSqliteRunner,
  runMigrations,
  appliedMigrationIds,
  ensureMigrationsTable
};
