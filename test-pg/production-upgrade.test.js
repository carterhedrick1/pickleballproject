// Rehearses the upgrade production will actually perform, on real PostgreSQL.
//
// Production has had these tables since long before migrations existed, so its first
// migration run is not "build the schema" but "find the schema already built, change only
// what is genuinely new, and keep every row". This test builds that starting point - the
// baseline migration applied, with no schema_migrations table to show for it, which is
// exactly what production looks like today - fills it with rows, and then runs the real
// migration list over the top.
//
// It works inside its own schema so it can create and drop freely without disturbing the
// parity suite sharing the database. Run it through `npm run test:pg`.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { pool } = require('../database/context');
const { createPostgresRunner, runMigrations, MIGRATIONS_TABLE } = require('../database/migration-runner');
const migrations = require('../database/migrations');

const REPLICA_SCHEMA = 'production_replica';
const baseline = migrations.filter((migration) => migration.id === '001-baseline-schema');

let client;
let runner;

before(async () => {
  client = await pool.connect();
  await client.query(`DROP SCHEMA IF EXISTS ${REPLICA_SCHEMA} CASCADE`);
  await client.query(`CREATE SCHEMA ${REPLICA_SCHEMA}`);
  // Everything below - including the runner's current_schema() catalog lookups - lands in
  // the replica schema rather than public.
  await client.query(`SET search_path TO ${REPLICA_SCHEMA}`);
  runner = createPostgresRunner(client);
});

after(async () => {
  if (!client) return;
  await client.query('SET search_path TO public');
  await client.query(`DROP SCHEMA IF EXISTS ${REPLICA_SCHEMA} CASCADE`);
  client.release();
  await pool.end();
});

describe('upgrading a database that predates migrations', () => {
  it('starts from production\'s shape: the baseline schema, unrecorded', async () => {
    await runMigrations(runner, baseline);
    // Production has no record of ever having been migrated, so remove ours.
    await client.query(`DROP TABLE ${MIGRATIONS_TABLE}`);

    const games = await runner.get(
      `SELECT 1 AS present FROM information_schema.tables
       WHERE table_schema = current_schema() AND table_name = 'games'`
    );
    assert.ok(games, 'the replica has the games table');
    assert.equal(await runner.hasColumn('games', 'version'), false, 'and not yet a version column');
    assert.equal(await runner.hasTable(MIGRATIONS_TABLE), false);
  });

  it('keeps every row while adding only what is new', async () => {
    const roster = {
      players: [{ id: 'p1', name: "Scott O'Hara", phone: '+15551230000' }],
      waitlist: [],
      totalPlayers: 4,
      hostNotes: 'Bring the good net'
    };
    await client.query(
      'INSERT INTO games (id, data, host_token, host_phone) VALUES ($1, $2, $3, $4)',
      ['prod-replica-game', JSON.stringify(roster), 'tok-prod', '+15551230000']
    );
    await client.query('INSERT INTO locations (name_key, display_name) VALUES ($1, $2)', [
      'char bar',
      'Char Bar'
    ]);
    await client.query(
      'INSERT INTO reminder_log (game_id, player_phone, reminder_type) VALUES ($1, $2, $3)',
      ['prod-replica-game', '+15551230000', '24h']
    );

    const result = await runMigrations(runner, migrations);
    assert.deepEqual(result.applied, migrations.map((migration) => migration.id));

    const game = await runner.get('SELECT * FROM games WHERE id = ?', ['prod-replica-game']);
    assert.equal(game.host_token, 'tok-prod');
    assert.equal(game.host_phone, '+15551230000');
    assert.deepEqual(game.data, roster, 'the whole game blob is untouched');
    assert.equal(game.version, 0, 'rows that predate the column start at version 0');

    const location = await runner.get('SELECT * FROM locations WHERE name_key = ?', ['char bar']);
    assert.equal(location.display_name, 'Char Bar');

    const reminder = await runner.get(
      'SELECT * FROM reminder_log WHERE game_id = ?',
      ['prod-replica-game']
    );
    assert.equal(reminder.reminder_type, '24h', 'reminder history survives, so nobody is texted twice');
  });

  it('compare-and-swap works immediately, from version 0', async () => {
    // The first save after the upgrade is the one that has to be right: it compares against
    // the default the migration gave every existing row.
    const updated = await client.query(
      `UPDATE games SET data = $1, version = version + 1 WHERE id = $2 AND version = $3`,
      [JSON.stringify({ players: [], upgraded: true }), 'prod-replica-game', 0]
    );
    assert.equal(updated.rowCount, 1);

    const stale = await client.query(
      `UPDATE games SET data = $1, version = version + 1 WHERE id = $2 AND version = $3`,
      [JSON.stringify({ players: [], lost: true }), 'prod-replica-game', 0]
    );
    assert.equal(stale.rowCount, 0, 'a second writer holding version 0 is refused');

    const row = await runner.get('SELECT data, version FROM games WHERE id = ?', ['prod-replica-game']);
    assert.equal(row.version, 1);
    assert.equal(row.data.upgraded, true);
    assert.equal(row.data.lost, undefined);
  });

  it('is a no-op if the deploy restarts and runs it again', async () => {
    const rerun = await runMigrations(runner, migrations);
    assert.deepEqual(rerun.applied, []);
    assert.deepEqual(rerun.alreadyApplied, migrations.map((migration) => migration.id));

    const recorded = await runner.all(`SELECT id FROM ${MIGRATIONS_TABLE} ORDER BY id`);
    assert.deepEqual(recorded.map((row) => row.id), migrations.map((migration) => migration.id));
  });
});
