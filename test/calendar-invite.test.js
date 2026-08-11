const test = require('node:test');
const assert = require('node:assert');

const {
  centralWallClockToUtc,
  formatUtcStamp,
  escapeText,
  foldLine,
  buildGameCalendar,
  calendarFileName
} = require('../utils/calendar-invite');

function propertyOf(ics, name) {
  // Unfold first: a wrapped property continues on a line beginning with a space.
  const unfolded = ics.replace(/\r\n /g, '');
  const line = unfolded.split('\r\n').find((entry) => entry.startsWith(`${name}:`));
  return line ? line.slice(name.length + 1) : null;
}

const summerGame = {
  date: '2026-08-11',
  time: '18:00',
  duration: 90,
  location: 'Sunset Park Courts',
  organizerName: 'Scott',
  message: 'Bring water'
};

test('a summer evening game lands at the right UTC instant (CDT is UTC-5)', () => {
  const start = centralWallClockToUtc('2026-08-11', '18:00');
  assert.equal(start.toISOString(), '2026-08-11T23:00:00.000Z');
});

test('a winter game uses standard time instead (CST is UTC-6)', () => {
  const start = centralWallClockToUtc('2026-01-15', '18:00');
  assert.equal(start.toISOString(), '2026-01-16T00:00:00.000Z');
});

test('the hour after the spring clock change is still correct', () => {
  // 2026-03-08 is the second Sunday in March; clocks jump 02:00 -> 03:00 Central.
  assert.equal(centralWallClockToUtc('2026-03-08', '01:00').toISOString(), '2026-03-08T07:00:00.000Z');
  assert.equal(centralWallClockToUtc('2026-03-08', '03:00').toISOString(), '2026-03-08T08:00:00.000Z');
});

test('an unusable date or time produces no instant', () => {
  assert.equal(centralWallClockToUtc('', '18:00'), null);
  assert.equal(centralWallClockToUtc('2026-08-11', ''), null);
  assert.equal(centralWallClockToUtc('not-a-date', '18:00'), null);
  assert.equal(centralWallClockToUtc('2026-08-11', '99:99'), null);
});

test('timestamps are written in iCalendar UTC form', () => {
  assert.equal(formatUtcStamp(new Date('2026-08-11T23:00:00.000Z')), '20260811T230000Z');
});

test('the event covers the game and its full duration', () => {
  const ics = buildGameCalendar(summerGame, { gameId: 'abc123', now: new Date('2026-08-01T12:00:00Z') });
  assert.equal(propertyOf(ics, 'DTSTART'), '20260811T230000Z');
  assert.equal(propertyOf(ics, 'DTEND'), '20260812T003000Z');
  assert.equal(propertyOf(ics, 'DTSTAMP'), '20260801T120000Z');
  assert.equal(propertyOf(ics, 'UID'), 'abc123@inorout.club');
});

test('a game with no duration still gets an hour on the calendar', () => {
  const ics = buildGameCalendar({ ...summerGame, duration: undefined }, { gameId: 'abc123' });
  assert.equal(propertyOf(ics, 'DTEND'), '20260812T000000Z');
});

test('the entry names the game, the court and the organizer', () => {
  const ics = buildGameCalendar(summerGame, { gameId: 'abc123', gameUrl: 'https://inorout.club/game.html?id=abc123' });
  assert.equal(propertyOf(ics, 'SUMMARY'), 'Pickleball at Sunset Park Courts');
  assert.equal(propertyOf(ics, 'LOCATION'), 'Sunset Park Courts');
  assert.match(propertyOf(ics, 'DESCRIPTION'), /Scott's pickleball game/);
  assert.match(propertyOf(ics, 'DESCRIPTION'), /Bring water/);
  assert.equal(propertyOf(ics, 'URL'), 'https://inorout.club/game.html?id=abc123');
  assert.equal(propertyOf(ics, 'STATUS'), 'CONFIRMED');
});

test('a cancelled game is published as cancelled so a saved entry clears itself', () => {
  const ics = buildGameCalendar({ ...summerGame, cancelled: true }, { gameId: 'abc123' });
  assert.equal(propertyOf(ics, 'STATUS'), 'CANCELLED');
});

test('a game with no usable date and time has no calendar entry', () => {
  assert.equal(buildGameCalendar({ ...summerGame, time: '' }, { gameId: 'abc123' }), null);
  assert.equal(buildGameCalendar(null, { gameId: 'abc123' }), null);
});

test('commas and semicolons a host typed cannot break the file', () => {
  assert.equal(escapeText('Court 3, gate code 4417; ring bell'), 'Court 3\\, gate code 4417\\; ring bell');
  assert.equal(escapeText('line one\nline two'), 'line one\\nline two');
  const ics = buildGameCalendar({ ...summerGame, location: 'Oak Park, IL' }, { gameId: 'abc123' });
  assert.equal(propertyOf(ics, 'LOCATION'), 'Oak Park\\, IL');
});

test('long values are folded and unfold back to the original', () => {
  const longCourt = 'The Extremely Long Named Pickleball And Racquet Sports Complex Of Greater Chicagoland';
  const ics = buildGameCalendar({ ...summerGame, location: longCourt }, { gameId: 'abc123' });
  assert.ok(ics.split('\r\n').every((line) => Buffer.byteLength(line, 'utf8') <= 75));
  assert.equal(propertyOf(ics, 'LOCATION'), longCourt);
});

test('folding never splits a multi-byte character', () => {
  const folded = foldLine(`LOCATION:${'🏓'.repeat(40)}`);
  assert.ok(!folded.includes('�'));
  assert.equal(folded.replace(/\r\n /g, '').slice('LOCATION:'.length), '🏓'.repeat(40));
});

test('the file is a complete calendar with CRLF endings', () => {
  const ics = buildGameCalendar(summerGame, { gameId: 'abc123' });
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n'));
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
  assert.ok(!/[^\r]\n/.test(ics));
});

test('the download is named after the game date', () => {
  assert.equal(calendarFileName(summerGame), 'pickleball-2026-08-11.ics');
  assert.equal(calendarFileName({ date: 'nonsense' }), 'pickleball-game.ics');
});
