/**
 * Boot-time database preparation, in three separated stages:
 *
 *   1. schema     - ordered migrations recorded in `schema_migrations` (./migrations)
 *   2. reference  - the seed courts and the retired-court repair (./seeds)
 *   3. messages   - the Realist message pools (./message-seeds)
 *
 * This file used to be all three at once, as one long list of CREATE TABLE IF NOT EXISTS
 * statements duplicated per dialect. See ./migration-runner.js for why that changed.
 */

const { isProduction, db, withPgClient } = require('./context');
const { createPostgresRunner, createSqliteRunner, runMigrations } = require('./migration-runner');
const migrations = require('./migrations');
const { seedReferenceData } = require('./seeds');

/** Migrates whichever database this process is connected to. */
async function migrateDatabase() {
  if (isProduction) {
    // One client for the whole run: the advisory lock that keeps two instances from
    // migrating at once is held by the session, not the pool.
    return withPgClient((client) => runMigrations(createPostgresRunner(client), migrations));
  }
  return runMigrations(createSqliteRunner(db), migrations);
}

async function initializeDatabase() {
  try {
    const { applied, alreadyApplied } = await migrateDatabase();
    console.log(
      `${isProduction ? 'PostgreSQL' : 'SQLite'} schema ready ` +
      `(${alreadyApplied.length} already applied, ${applied.length} newly applied)`
    );

    await seedReferenceData();

    const { seedRealistAndMigrateSavedMessages } = require('./message-seeds');
    const migration = await seedRealistAndMigrateSavedMessages();
    console.log(`Message Randomizer migration ready (${migration.total} vetted messages)`);
  } catch (err) {
    console.error('Database initialization error:', err);
    throw err;
  }
}

module.exports = { initializeDatabase, migrateDatabase };
