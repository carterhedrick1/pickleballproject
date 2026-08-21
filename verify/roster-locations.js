// Saved-locations and host-roster verification.
// Runs in-process against the local SQLite database - no server needed, and nothing here
// can send a text (it never touches the SMS client).
//   npm run verify:roster
//
// What it pins down:
//   - the five seeded courts survive repeated boots without ever duplicating
//   - Wimbledon and its historical misspellings stay retired
//   - " chicken AND pickle " is the same court as "Chicken and Pickle"
//   - a name the host typed is never replaced by whatever a player typed at signup
//   - is_android is remembered once known, and a later sighting that cannot tell (null)
//     does not erase it

const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const sqlite3 = require('sqlite3');
const { initializeDatabase } = require(ROOT + '/database/schema');
const { addLocation, getLocations } = require(ROOT + '/database/locations-media');
const {
  upsertRosterEntry,
  recordRosterSighting,
  getRosterForHost,
  deleteRosterEntry
} = require(ROOT + '/database/roster');
const { closeDatabaseConnection } = require(ROOT + '/database/context');
const { cleanupTestRosterAndLocations, VERIFY_PHONES } = require('./_cleanup');

const [HOST, PLAYER, OTHER] = VERIFY_PHONES;
const TEST_LOCATION = 'Test Court Alpha';

const SEEDS = [
  'Homoly Home Court',
  'Chicken and Pickle',
  'JustPaddles',
  'Char Bar',
  'Argosy'
];
const RETIRED = ['Wimbledom', 'Wimbledon', 'Wimbleton'];

let failures = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); failures++; };
const check = (cond, m) => (cond ? ok(m) : bad(m));

// Wipes just the five seed rows, so the next initializeDatabase() is indistinguishable from a
// boot against a brand new database. Host-added courts are left alone.
function deleteSeedRows() {
  return new Promise((resolve, reject) => {
    const conn = new sqlite3.Database(path.join(ROOT, 'pickleball.db'));
    const keys = SEEDS.map((s) => s.toLowerCase());
    conn.run(
      `DELETE FROM locations WHERE name_key IN (${keys.map(() => '?').join(',')})`,
      keys,
      (err) => { conn.close(); err ? reject(err) : resolve(); }
    );
  });
}

function insertRetiredRows() {
  return new Promise((resolve, reject) => {
    const conn = new sqlite3.Database(path.join(ROOT, 'pickleball.db'));
    const statement = conn.prepare(
      'INSERT OR REPLACE INTO locations (name_key, display_name) VALUES (?, ?)'
    );
    for (const displayName of RETIRED) {
      statement.run(displayName.toLowerCase(), displayName);
    }
    statement.finalize((err) => {
      conn.close();
      err ? reject(err) : resolve();
    });
  });
}

const roster = async () => (await getRosterForHost(HOST)).find((r) => r.playerPhone === PLAYER);

(async () => {
  console.log('\n=== Locations and host roster (local SQLite) ===\n');

  await initializeDatabase();
  await cleanupTestRosterAndLocations();

  console.log('1. Seeded courts survive two boots without duplicating');
  await deleteSeedRows();
  await insertRetiredRows();
  await initializeDatabase();                     // boot 1: fills an empty locations table
  const afterFirst = await getLocations();
  const missing = SEEDS.filter((s) => !afterFirst.includes(s));
  check(missing.length === 0, `all five courts seeded${missing.length ? ` (missing ${missing})` : ''}`);

  await initializeDatabase();                     // boot 2: must be a no-op
  const afterSecond = await getLocations();
  check(
    afterSecond.length === afterFirst.length,
    `second boot added nothing (${afterFirst.length} -> ${afterSecond.length})`
  );
  const seedCounts = SEEDS.map((s) => afterSecond.filter((l) => l === s).length);
  check(seedCounts.every((n) => n === 1), `each seeded court appears exactly once (${seedCounts})`);
  check(RETIRED.every((name) => !afterSecond.includes(name)), 'Wimbledon spellings are not seeded');

  console.log('\n2. The same court typed differently is one court');
  const before = (await getLocations()).length;
  await addLocation('   chicken   AND pickle  ');
  await addLocation('Wimbledon');
  const after = await getLocations();
  check(after.length === before, `" chicken   AND pickle " added no row (${before} -> ${after.length})`);
  check(after.includes('Chicken and Pickle'), 'the original spelling is the one kept');
  check(!after.includes('Wimbledon'), 'a retired court cannot be remembered again');

  console.log('\n3. Blank locations are ignored, new ones are kept with their first spelling');
  await addLocation('');
  await addLocation(null);
  await addLocation('   ');
  check((await getLocations()).length === before, 'blank / null / whitespace added nothing');

  await addLocation(TEST_LOCATION);
  await addLocation('TEST COURT ALPHA');
  const withTest = await getLocations();
  check(withTest.filter((l) => l.toLowerCase() === TEST_LOCATION.toLowerCase()).length === 1,
    'a new court is stored once regardless of casing');
  check(withTest.includes(TEST_LOCATION), `first spelling wins ("${TEST_LOCATION}")`);

  console.log('\n4. A host-typed name is never overwritten by a signup');
  await recordRosterSighting(HOST, PLAYER, 'Signup Typed Name', 1);
  check((await roster())?.name === 'Signup Typed Name', 'first sighting sets the name');

  await upsertRosterEntry(HOST, PLAYER, 'Host Typed Name', 'DUPR-4417', 3.75);
  let entry = await roster();
  check(entry?.name === 'Host Typed Name', 'the host can rename a player');
  check(entry?.duprId === 'DUPR-4417' && entry?.duprRating === 3.75, 'DUPR id and rating persist');
  check(entry?.isAndroid === 1, 'the host edit did NOT wipe is_android');

  await recordRosterSighting(HOST, PLAYER, 'Signup Typed Name Again', 1);
  check((await roster())?.name === 'Host Typed Name', 'a later signup does not clobber the host name');

  console.log('\n5. is_android is remembered, and an unknown sighting does not erase it');
  await recordRosterSighting(HOST, PLAYER, 'Whoever', null);
  check((await roster())?.isAndroid === 1, 'null sighting leaves a known Android flag alone');

  await recordRosterSighting(HOST, PLAYER, 'Whoever', 0);
  check((await roster())?.isAndroid === 0, 'a known non-Android sighting updates the flag');

  await recordRosterSighting(HOST, PLAYER, 'Whoever', null);
  check((await roster())?.isAndroid === 0, 'null sighting leaves a known non-Android flag alone');

  await recordRosterSighting(HOST, OTHER, 'Never Seen On A Phone', null);
  const unknown = (await getRosterForHost(HOST)).find((r) => r.playerPhone === OTHER);
  check(unknown?.isAndroid === null, 'a player only ever seen with an unknown device stays null');

  console.log('\n6. Rosters are per host, and entries can be removed');
  check((await getRosterForHost(PLAYER)).length === 0, "another host's roster is empty");
  check(await deleteRosterEntry(HOST, PLAYER) === 1, 'deleting an entry reports one row removed');
  check(await roster() === undefined, 'the deleted entry is gone');

  await cleanupTestRosterAndLocations();
  const cleaned = await getLocations();
  check(!cleaned.some((l) => l.toLowerCase().startsWith('test court ')), 'test rows cleaned up');

  await closeDatabaseConnection();
  console.log(`\n=== ${failures} failure(s) ===\n`);
  process.exit(failures ? 1 : 0);
})();
