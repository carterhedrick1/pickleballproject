// Removes verification/test games from the PRODUCTION database.
//
//   node scripts/cleanup-test-games.js            # dry run - shows what would go, changes nothing
//   node scripts/cleanup-test-games.js --delete   # backs up to JSON, then deletes
//
// Safety rules, in order:
//   1. A game is only a candidate if its location is a known test location OR its message is the
//      user-flow.js signature "Deploy verification game".
//   2. A candidate is REFUSED if it contains a phone number anywhere - organizer, host, players,
//      waitlist or out list. A real game that someone might be relying on will have phones; test
//      games never do. If any candidate has one, nothing is deleted at all.
//   3. A candidate is REFUSED if it has any reminder_log history.
//   4. Every matched row is written to a timestamped JSON backup before a single row is deleted,
//      so this is reversible.

require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const DO_DELETE = process.argv.includes('--delete');

const TEST_LOCATIONS = [
  'Mixed Race Court', 'Race Test Court', 'Capacity Race Court', 'Test Court',
  'Browser Test Court', 'Debug', 'Token Probe', 'Mixed Probe', 'Race Court',
];
const TEST_MESSAGE = 'Deploy verification game';

const client = new Client({
  connectionString: process.env.PROD_DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 20000,
});

const phonesIn = (list) =>
  (list || []).filter((p) => p && p.phone && String(p.phone).trim()).map((p) => p.phone);

(async () => {
  if (!process.env.PROD_DATABASE_URL) {
    console.error('PROD_DATABASE_URL is not set.');
    process.exit(1);
  }

  await client.connect();
  console.log(DO_DELETE ? '=== DELETE MODE ===\n' : '=== DRY RUN (nothing will change) ===\n');

  const { rows } = await client.query(
    `SELECT id, host_token, host_phone, created_at, updated_at, data
     FROM games
     WHERE data->>'location' = ANY($1) OR data->>'message' = $2
     ORDER BY created_at DESC`,
    [TEST_LOCATIONS, TEST_MESSAGE]
  );

  console.log(`matched ${rows.length} candidate game(s)\n`);
  if (rows.length === 0) { await client.end(); return; }

  // Rule 2: refuse if any candidate carries a phone number.
  const withPhones = [];
  for (const r of rows) {
    const d = r.data || {};
    const found = [
      ...phonesIn(d.players), ...phonesIn(d.waitlist), ...phonesIn(d.outPlayers),
      ...(d.organizerPhone && String(d.organizerPhone).trim() ? [d.organizerPhone] : []),
      ...(r.host_phone && String(r.host_phone).trim() ? [r.host_phone] : []),
    ];
    if (found.length) withPhones.push({ id: r.id, count: found.length });
  }

  // Rule 3: refuse if any candidate has reminder history.
  const ids = rows.map((r) => r.id);
  const rem = await client.query(
    'SELECT game_id, count(*)::int AS c FROM reminder_log WHERE game_id = ANY($1) GROUP BY game_id',
    [ids]
  );

  for (const r of rows) {
    const d = r.data || {};
    const people = [...(d.players || []), ...(d.waitlist || []), ...(d.outPlayers || [])];
    console.log(
      `  ${r.id.padEnd(16)} ${new Date(r.created_at).toISOString().slice(0, 16)} ` +
      `cancelled=${String(d.cancelled === true).padEnd(5)} ${String(d.location).slice(0, 22).padEnd(22)} people=${people.length}`
    );
  }

  if (withPhones.length) {
    console.error(`\nREFUSING: ${withPhones.length} candidate(s) contain a phone number:`);
    for (const w of withPhones) console.error(`   ${w.id} (${w.count} phone(s))`);
    console.error('Nothing was deleted.');
    await client.end();
    process.exit(1);
  }
  console.log('\n  check: no candidate contains a phone number anywhere');

  if (rem.rows.length) {
    console.error(`\nREFUSING: ${rem.rows.length} candidate(s) have reminder_log history: ${JSON.stringify(rem.rows)}`);
    console.error('Nothing was deleted.');
    await client.end();
    process.exit(1);
  }
  console.log('  check: no candidate has any reminder history');

  const { rows: totals } = await client.query('SELECT count(*)::int AS c FROM games');
  console.log(`  check: ${rows.length} of ${totals[0].c} total games matched; ${totals[0].c - rows.length} will remain`);

  if (!DO_DELETE) {
    console.log('\nDry run only. Re-run with --delete to back up and remove these.');
    await client.end();
    return;
  }

  const stamp = new Date(await client.query('SELECT now()').then((r) => r.rows[0].now))
    .toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const backupPath = path.resolve(__dirname, '..', `deleted-test-games-${stamp}.json`);
  fs.writeFileSync(backupPath, JSON.stringify(rows, null, 2));
  console.log(`\nbacked up ${rows.length} row(s) to ${backupPath}`);

  const del = await client.query('DELETE FROM games WHERE id = ANY($1)', [ids]);
  console.log(`deleted ${del.rowCount} row(s)`);

  const after = await client.query('SELECT count(*)::int AS c FROM games');
  console.log(`games remaining: ${after.rows[0].c}`);

  await client.end();
})().catch(async (e) => {
  console.error('ERROR:', e.message);
  try { await client.end(); } catch {}
  process.exit(1);
});
