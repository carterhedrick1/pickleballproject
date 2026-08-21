// The .ics file a confirmed player downloads from their confirmation screen.
//
// Games are stored as a Central Time wall clock ("2026-08-11" + "18:00"), the same way the
// reminders read them. A calendar entry has to name a real instant instead, or a player whose
// phone is set to another timezone gets an event at the wrong hour. Every timestamp below is
// therefore converted to UTC through the America/Chicago rules in force on that date, which
// keeps games on either side of a daylight-saving switch correct.

// This file's two-pass conversion is now the app's one Central Time model, and lives in
// public/js/central-time.js so the pages can use it too. The name it was known by here is
// kept for the tests and the .ics builder below.
const {
  CENTRAL_TIME_ZONE,
  wallClockToInstant: centralWallClockToUtc
} = require('../public/js/central-time');

const DEFAULT_DURATION_MINUTES = 60;

/** iCalendar UTC stamp: 20260811T230000Z */
function formatUtcStamp(instant) {
  return `${instant.toISOString().replace(/[-:]/g, '').split('.')[0]}Z`;
}

/** RFC 5545 escaping for the free-text properties. */
function escapeText(value) {
  return String(value == null ? '' : value)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/**
 * Wraps a property onto continuation lines at the 75-octet limit. Measured in bytes rather
 * than characters so an emoji in a court name cannot be split down the middle.
 */
function foldLine(line) {
  const maxOctets = 73;
  const lines = [];
  let current = '';
  let octets = 0;

  for (const character of String(line)) {
    const size = Buffer.byteLength(character, 'utf8');
    if (octets + size > maxOctets) {
      lines.push(current);
      current = ' ';
      octets = 1;
    }
    current += character;
    octets += size;
  }
  lines.push(current);
  return lines.join('\r\n');
}

/**
 * Builds the calendar file for one game.
 * @returns {string|null} the .ics body, or null when the game has no usable date and time
 */
function buildGameCalendar(game, { gameId, gameUrl = '', now = new Date() } = {}) {
  if (!game) return null;

  const start = centralWallClockToUtc(game.date, game.time);
  if (!start) return null;

  const minutes = parseInt(game.duration, 10);
  const end = new Date(
    start.getTime() + (Number.isFinite(minutes) && minutes > 0 ? minutes : DEFAULT_DURATION_MINUTES) * 60000
  );

  const location = game.location || 'Pickleball';
  const organizer = String(game.organizerName || '').trim();
  const note = String(game.message || '').trim();
  const description = [
    organizer ? `${organizer}'s pickleball game.` : 'Pickleball game.',
    note,
    gameUrl ? `Game details and roster: ${gameUrl}` : ''
  ].filter(Boolean).join('\n');

  const properties = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//IN or OUT//Pickleball Scheduling//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${escapeText(gameId || start.getTime())}@inorout.club`,
    `DTSTAMP:${formatUtcStamp(now)}`,
    `DTSTART:${formatUtcStamp(start)}`,
    `DTEND:${formatUtcStamp(end)}`,
    `SUMMARY:${escapeText(`Pickleball at ${location}`)}`,
    `LOCATION:${escapeText(location)}`,
    `DESCRIPTION:${escapeText(description)}`,
    gameUrl ? `URL:${escapeText(gameUrl)}` : '',
    `STATUS:${game.cancelled ? 'CANCELLED' : 'CONFIRMED'}`,
    'SEQUENCE:0',
    'END:VEVENT',
    'END:VCALENDAR'
  ].filter(Boolean);

  return `${properties.map(foldLine).join('\r\n')}\r\n`;
}

/** Filename a player sees in their downloads: pickleball-2026-08-11.ics */
function calendarFileName(game) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(game?.date || '')) ? game.date : 'game';
  return `pickleball-${date}.ics`;
}

module.exports = {
  CENTRAL_TIME_ZONE,
  centralWallClockToUtc,
  formatUtcStamp,
  escapeText,
  foldLine,
  buildGameCalendar,
  calendarFileName
};
