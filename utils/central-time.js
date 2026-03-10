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

module.exports = {
  getCentralTimeNow,
  isGameUpcoming
};
