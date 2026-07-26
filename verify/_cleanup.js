// Removes rows the in-process integration tests leave in the local SQLite database.
// Everything they create uses a "test-" prefixed game id, so this only ever touches test data.
const path = require('path');
const sqlite3 = require('sqlite3');

// The phone numbers roster-locations.js writes with, and the display-name prefix its test
// courts use. Both are deliberately narrow so cleanup can never remove a real row.
// 555-555-90xx: reserved-for-fiction numbers that still pass US phone validation, and distinct
// from the 555-555-01xx/07xx numbers the documentation fixtures use.
const VERIFY_PHONES = ['5555559001', '5555559002', '5555559003'];

// Creating a game now remembers its court, so every invented court in this directory would
// otherwise show up in the real create-form picker. These are the names the verify scripts use;
// add to the list if a new script invents another one.
const TEST_LOCATION_NAMES = [
  'Test Court',
  'Test Court Alpha',
  'Race Test Court',
  'Capacity Race Court',
  'Mixed Race Court',
  'SMS Cancel Court',
  'Safety Court',
  'Browser Test Court',
];
// Normalized the same way database.js normalizes them.
const TEST_LOCATION_KEYS = TEST_LOCATION_NAMES.map(
  (name) => name.trim().replace(/\s+/g, ' ').toLowerCase()
);

function openDb() {
  return new sqlite3.Database(path.resolve(__dirname, '..', 'pickleball.db'));
}

function cleanupTestGames() {
  return new Promise((resolve) => {
    const db = openDb();
    db.run("DELETE FROM games WHERE id LIKE 'test-%'", () => {
      db.run("DELETE FROM reminder_log WHERE game_id LIKE 'test-%'", () => {
        db.close(() => resolve());
      });
    });
  });
}

// Roster rows and saved courts are keyed by phone number and name, not by game id, so they
// survive cleanupTestGames() and need their own sweep.
function cleanupTestRosterAndLocations() {
  return new Promise((resolve) => {
    const db = openDb();
    const marks = VERIFY_PHONES.map(() => '?').join(',');
    db.run(
      `DELETE FROM host_roster WHERE host_phone IN (${marks}) OR player_phone IN (${marks})`,
      [...VERIFY_PHONES, ...VERIFY_PHONES],
      () => {
        db.run(
          `DELETE FROM locations WHERE name_key IN (${TEST_LOCATION_KEYS.map(() => '?').join(',')})`,
          TEST_LOCATION_KEYS,
          () => db.close(() => resolve())
        );
      }
    );
  });
}

// DELETE /api/games only marks a game cancelled, so an HTTP-driven test that runs locally
// removes its own games this way rather than leaving a pile of cancelled ones behind.
function deleteGamesById(ids) {
  if (!ids || !ids.length) return Promise.resolve(0);
  return new Promise((resolve) => {
    const db = openDb();
    db.run(`DELETE FROM games WHERE id IN (${ids.map(() => '?').join(',')})`, ids, function () {
      db.close(() => resolve(this ? this.changes : 0));
    });
  });
}

// For the HTTP scripts, which can legitimately be pointed at production: sweep the local
// database only when the run really was local. Against any other base URL it does nothing.
function sweepLocalTestRows(baseUrl) {
  if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(baseUrl || '')) return Promise.resolve();
  return cleanupTestRosterAndLocations();
}

// Photos are keyed by game id, not by anything the game-row sweeps match, so they need
// removing explicitly - otherwise the image rows outlive the games they belong to.
function deletePhotosForGames(ids) {
  if (!ids || !ids.length) return Promise.resolve(0);
  return new Promise((resolve) => {
    const db = openDb();
    db.run(`DELETE FROM game_photos WHERE game_id IN (${ids.map(() => '?').join(',')})`, ids, function () {
      db.close(() => resolve(this ? this.changes : 0));
    });
  });
}

module.exports = {
  cleanupTestGames,
  deletePhotosForGames,
  cleanupTestRosterAndLocations,
  sweepLocalTestRows,
  deleteGamesById,
  VERIFY_PHONES,
  TEST_LOCATION_NAMES
};
