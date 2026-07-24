// Removes rows the in-process integration tests leave in the local SQLite database.
// Everything they create uses a "test-" prefixed game id, so this only ever touches test data.
const path = require('path');
const sqlite3 = require('sqlite3');

function cleanupTestGames() {
  return new Promise((resolve) => {
    const db = new sqlite3.Database(path.resolve(__dirname, '..', 'pickleball.db'));
    db.run("DELETE FROM games WHERE id LIKE 'test-%'", () => {
      db.run("DELETE FROM reminder_log WHERE game_id LIKE 'test-%'", () => {
        db.close(() => resolve());
      });
    });
  });
}

module.exports = { cleanupTestGames };
