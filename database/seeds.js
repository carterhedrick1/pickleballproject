/**
 * Reference data and one-time repairs, kept apart from the schema itself.
 *
 * Migrations describe the shape of the database and run once. What is in here is about
 * content, and runs on every boot because it has to be true continuously rather than once:
 * a fresh database (a new deploy, a developer's first run, a disposable test database)
 * must offer the same courts in the create-game picker as production does.
 */

const { isProduction, withPgClient, sqlitePrepareRun } = require('./context');

// The courts this friend group already plays at.
const SEED_LOCATIONS = [
  'Homoly Home Court',
  'Chicken and Pickle',
  'JustPaddles',
  'Char Bar',
  'Argosy'
];

// The primary key. " chicken AND pickle " and "Chicken and Pickle" are the same court,
// so the key is trimmed, whitespace-collapsed and lowercased. The first spelling anybody
// types is the one everyone sees (display_name is never overwritten).
function locationKey(displayName) {
  return String(displayName == null ? '' : displayName).trim().replace(/\s+/g, ' ').toLowerCase();
}

// Courts that must never come back into the picker. Include the historical misspellings as
// well as the spelling that was shown. "Production Verification Court" is residue from a
// retired deploy-verification script; real hosts should never see it.
const RETIRED_LOCATION_KEYS = new Set([
  'wimbledom',
  'wimbledon',
  'wimbleton',
  'production verification court'
]);

function isRetiredLocation(displayName) {
  return RETIRED_LOCATION_KEYS.has(locationKey(displayName));
}

/**
 * One-time repair, re-run cheaply on every boot. `addLocation` already refuses a retired
 * court, so this only has to clear what older versions of the app remembered.
 */
async function removeRetiredLocations() {
  if (isProduction) {
    await withPgClient(async (client) => {
      for (const nameKey of RETIRED_LOCATION_KEYS) {
        await client.query('DELETE FROM locations WHERE name_key = $1', [nameKey]);
      }
    });
    return;
  }
  for (const nameKey of RETIRED_LOCATION_KEYS) {
    await sqlitePrepareRun('DELETE FROM locations WHERE name_key = ?', [nameKey]);
  }
}

/** Adds any missing seed court. Never overwrites a display name somebody already typed. */
async function seedLocations() {
  if (isProduction) {
    await withPgClient(async (client) => {
      for (const displayName of SEED_LOCATIONS) {
        await client.query(
          'INSERT INTO locations (name_key, display_name) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [locationKey(displayName), displayName]
        );
      }
    });
    return;
  }
  for (const displayName of SEED_LOCATIONS) {
    await sqlitePrepareRun(
      'INSERT OR IGNORE INTO locations (name_key, display_name) VALUES (?, ?)',
      [locationKey(displayName), displayName]
    );
  }
}

/** Repairs first, then seeds: a retired court must not be deleted and re-added in one boot. */
async function seedReferenceData() {
  await removeRetiredLocations();
  await seedLocations();
}

module.exports = {
  SEED_LOCATIONS,
  RETIRED_LOCATION_KEYS,
  locationKey,
  isRetiredLocation,
  removeRetiredLocations,
  seedLocations,
  seedReferenceData
};
