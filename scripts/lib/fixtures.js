// Creates and removes the three demo games the screenshots are taken against.
//
// The screens are only worth looking at with plausible data in them, so this seeds:
//   - an open first-come game (2 of 6 spots left, one player marked out)
//   - a full game, to photograph the "Game is Full" state
//   - an approval-mode game with three applicants waiting
//
// Cleanup deletes the rows straight out of the local SQLite file. DELETE /api/games only marks a
// game cancelled - it does not remove it - so an API-based teardown would leave a growing pile of
// cancelled fixtures behind and they would show up in Find My Games results.
//
// Every fixture carries MARKER in its message. Cleanup matches on that AND on a 555 host phone,
// so an interrupted run can be swept up later without any risk of touching a real game.

const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const DB_FILE = path.join(ROOT, 'pickleball.db');

const MARKER = '[docs fixture: scripts/capture-screens.js]';
// Reserved-for-fiction numbers. Nothing is sent to them anyway - the server runs with SMS in
// dev mode - but using 555 numbers means a stray fixture is obviously not a real person.
const HOST_PHONE = '5555550101';
const FORM_PHONE = '5555550199';   // used when the script submits the create form itself
const JOIN_PHONE = '5555550777';   // used when the script signs up as a player
const FIXTURE_PHONES = [HOST_PHONE, FORM_PHONE, JOIN_PHONE];

// Courts the fixtures invent. Creating a game now remembers its location for the next host, so
// these would otherwise pile up in the create form's picker. Keys are normalized the same way
// database.js normalizes them (trimmed, whitespace-collapsed, lowercased).
const FIXTURE_LOCATIONS = [
  'Oak Park Courts',
  'Riverside Athletic Club',
  'Lakeside Park',
  'Sunset Park Courts',   // typed by the create-form screenshot
];
const FIXTURE_LOCATION_KEYS = FIXTURE_LOCATIONS.map(
  (name) => name.trim().replace(/\s+/g, ' ').toLowerCase()
);

const inDays = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

async function post(baseUrl, pathname, body) {
  const res = await fetch(baseUrl + pathname, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(`POST ${pathname} -> ${res.status} ${JSON.stringify(json)}`);
  }
  return json;
}

// The API takes players as { name }, and the player count as totalPlayers - create.html maps its
// own "players" field onto that name before posting. Getting either wrong fails quietly: the
// player is skipped, or totalPlayers lands as null and game-logic silently falls back to 4.
const addPlayer = (baseUrl, id, name, action = 'join') =>
  post(baseUrl, `/api/games/${id}/players`, { name, action });

/** Seeds the three games and returns their ids and host tokens. */
async function seed(baseUrl) {
  const date = inDays(3);
  const common = {
    organizerName: 'Scott H.',
    organizerPhone: HOST_PHONE,
    organizerPlaying: true,
    date,
  };

  const open = await post(baseUrl, '/api/games', {
    ...common,
    location: 'Oak Park Courts',
    time: '18:00',
    duration: '90',
    totalPlayers: '6',
    message: `Bring water and a spare ball. Parking is free after 5pm. ${MARKER}`,
    registrationMode: 'fcfs',
    notifyGameFull: true,
    notifyPlayerCancels: true,
    notifyPlayerJoins: true,
    notifyWaitlistStarts: true,
  });
  for (const name of ['Maria Alvarez', 'Dev Patel', 'Tom Whitfield']) {
    await addPlayer(baseUrl, open.gameId, name);
  }
  await addPlayer(baseUrl, open.gameId, 'Priya Raman', 'out');

  const approval = await post(baseUrl, '/api/games', {
    ...common,
    location: 'Riverside Athletic Club',
    time: '09:30',
    duration: '120',
    totalPlayers: '4',
    message: `3.5+ level. I will pick a balanced set of four. ${MARKER}`,
    registrationMode: 'waitlist',
    notifyPlayerJoins: true,
  });
  for (const name of ['Alex Kim', 'Rosa Delgado', 'Ben Carter']) {
    await addPlayer(baseUrl, approval.gameId, name);
  }

  const full = await post(baseUrl, '/api/games', {
    ...common,
    location: 'Lakeside Park',
    time: '12:00',
    duration: '60',
    totalPlayers: '2',
    message: `Quick singles session. ${MARKER}`,
    registrationMode: 'fcfs',
  });
  await addPlayer(baseUrl, full.gameId, 'Nina Brooks');

  return { open, approval, full, date, HOST_PHONE, FORM_PHONE, JOIN_PHONE, MARKER };
}

/** Sanity check, so a mis-seeded run is caught before 26 screenshots are taken of it. */
async function verify(baseUrl, fixtures) {
  const expected = {
    open: { totalPlayers: 6, players: 4, waitlist: 0, outPlayers: 1, registrationMode: 'fcfs' },
    approval: { totalPlayers: 4, players: 1, waitlist: 3, outPlayers: 0, registrationMode: 'waitlist' },
    full: { totalPlayers: 2, players: 2, waitlist: 0, outPlayers: 0, registrationMode: 'fcfs' },
  };
  const problems = [];
  for (const [key, want] of Object.entries(expected)) {
    const game = await (await fetch(`${baseUrl}/api/games/${fixtures[key].gameId}`)).json();
    const got = {
      totalPlayers: game.totalPlayers,
      players: (game.players || []).length,
      waitlist: (game.waitlist || []).length,
      outPlayers: (game.outPlayers || []).length,
      registrationMode: game.registrationMode,
    };
    for (const [field, value] of Object.entries(want)) {
      if (got[field] !== value) {
        problems.push(`${key}.${field}: expected ${value}, got ${got[field]}`);
      }
    }
  }
  if (problems.length) {
    throw new Error('Fixture games are not in the expected shape:\n  ' + problems.join('\n  '));
  }
}

/**
 * Deletes fixture rows from the local SQLite database.
 * Only rows that carry MARKER and a fixture 555 phone are eligible, so this cannot remove a
 * real game even if the marker string were somehow reused. The side tables a fixture run also
 * writes - saved courts and roster entries - are swept by their own narrow criteria.
 */
function cleanup() {
  const sqlite3 = require('sqlite3');
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(DB_FILE, (err) => {
      if (err) return reject(err);
      const where =
        `WHERE host_phone IN (${FIXTURE_PHONES.map(() => '?').join(',')})
           AND COALESCE(json_extract(data, '$.message'), '') LIKE ?`;
      const params = [...FIXTURE_PHONES, `%${MARKER}%`];

      // Runs after the games are gone: the invented courts, the roster rows a fixture signup
      // creates, and the SMS contexts. Each one only ever matches fixture data.
      const sweepSideTables = (done, gameIds = []) => {
        const phoneMarks = FIXTURE_PHONES.map(() => '?').join(',');
        // Photos are keyed by game id, so they have to go before/with the games themselves.
        const dropPhotos = (next) => {
          if (!gameIds.length) return next();
          db.run(
            `DELETE FROM game_photos WHERE game_id IN (${gameIds.map(() => '?').join(',')})`,
            gameIds, next
          );
        };
        dropPhotos(() => db.run(
          `DELETE FROM host_roster WHERE host_phone IN (${phoneMarks}) OR player_phone IN (${phoneMarks})`,
          [...FIXTURE_PHONES, ...FIXTURE_PHONES],
          () => {
            db.run(
              `DELETE FROM court_images WHERE court_name_key IN (${FIXTURE_LOCATION_KEYS.map(() => '?').join(',')})`,
              FIXTURE_LOCATION_KEYS,
              () => {
                db.run(
                  `DELETE FROM locations WHERE name_key IN (${FIXTURE_LOCATION_KEYS.map(() => '?').join(',')})`,
                  FIXTURE_LOCATION_KEYS,
                  () => {
                    db.run('DELETE FROM sms_contexts WHERE phone_number IN (?,?,?)', FIXTURE_PHONES, done);
                  }
                );
              }
            );
          }
        ));
      };

      db.all(`SELECT id FROM games ${where}`, params, (selErr, rows) => {
        if (selErr) { db.close(); return reject(selErr); }
        if (!rows.length) {
          sweepSideTables(() => db.close(() => resolve(0)));
          return;
        }
        const gameIds = rows.map((row) => row.id);
        db.run(`DELETE FROM games ${where}`, params, function (delErr) {
          if (delErr) { db.close(); return reject(delErr); }
          const removed = this.changes;
          sweepSideTables(() => db.close(() => resolve(removed)), gameIds);
        });
      });
    });
  });
}

module.exports = {
  seed, verify, cleanup, MARKER, HOST_PHONE, FORM_PHONE, JOIN_PHONE, inDays, FIXTURE_LOCATIONS
};
