/**
 * Central Time utilities for reminders and SMS.
 * Games are assumed to be scheduled in America/Chicago (Central Time).
 */

/**
 * Returns the current time as a Date object representing Central Time.
 * Uses toLocaleString for accurate DST handling; falls back to CST (-6) if needed.
 * @returns {Date}
 */
function getCentralTimeNow() {
  const now = new Date();
  const centralNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/Chicago' }));

  if (isNaN(centralNow.getTime())) {
    const utcTime = now.getTime() + now.getTimezoneOffset() * 60000;
    const centralOffset = -6; // CST fallback (DST handled by toLocaleString when available)
    return new Date(utcTime + centralOffset * 3600000);
  }
  return centralNow;
}

/**
 * Checks if a game datetime is in the future relative to Central Time.
 * @param {string} gameDate - YYYY-MM-DD
 * @param {string} gameTime - HH:MM
 * @returns {boolean}
 */
function isGameUpcoming(gameDate, gameTime) {
  const centralNow = getCentralTimeNow();
  const gameDateTime = new Date(`${gameDate}T${gameTime}:00`);
  return gameDateTime > centralNow;
}

/**
 * Checks if a game has already started but is recent enough that its host still needs it.
 * Photos, thank-you notes and roster corrections all happen after the final point, so a
 * finished game stays reachable for a while. Thirty days matches the "recent games" window
 * the phone-number lookup already uses.
 * @param {string} gameDate - YYYY-MM-DD
 * @param {string} gameTime - HH:MM
 * @param {number} [days=30]
 * @returns {boolean}
 */
function isGameRecentlyFinished(gameDate, gameTime, days = 30) {
  const gameDateTime = new Date(`${gameDate}T${gameTime}:00`);
  if (isNaN(gameDateTime.getTime())) return false;

  const centralNow = getCentralTimeNow();
  if (gameDateTime > centralNow) return false;
  return centralNow - gameDateTime <= days * 24 * 60 * 60 * 1000;
}

/**
 * Checks if a game has completely finished (start + duration has passed).
 * This is the server-side twin of the browser's isGameExpired in
 * public/js/game-utils.js: the signup form closes at game END, not game start, so a late
 * "IN" while people are already playing still counts.
 * @param {string} gameDate - YYYY-MM-DD
 * @param {string} gameTime - HH:MM
 * @param {number|string} [durationMinutes=0]
 * @param {Date} [centralNow] - injectable clock for tests
 * @returns {boolean}
 */
function hasGameEnded(gameDate, gameTime, durationMinutes = 0, centralNow = getCentralTimeNow()) {
  // An unscheduled game has not ended. Checked explicitly because V8's lenient parser
  // turns the empty-string template ('T:00') into a real date in the year 2000.
  if (!gameDate || !gameTime) return false;
  const start = new Date(`${gameDate}T${gameTime}:00`);
  if (isNaN(start.getTime())) return false;

  const minutes = parseInt(durationMinutes, 10);
  const end = new Date(start.getTime() + (Number.isFinite(minutes) ? minutes : 0) * 60000);
  return centralNow > end;
}

module.exports = {
  getCentralTimeNow,
  isGameUpcoming,
  isGameRecentlyFinished,
  hasGameEnded
};
