const test = require('node:test');
const assert = require('node:assert');

const {
  joinedTooRecentlyForReminder,
  RECENT_SIGNUP_QUIET_HOURS
} = require('../services/reminders');

const NOW = Date.parse('2026-08-11T18:00:00.000Z');
const hoursBefore = (hours) => new Date(NOW - hours * 3600 * 1000).toISOString();

test('a player who just signed up is not reminded about the game they just joined', () => {
  assert.equal(joinedTooRecentlyForReminder({ joinedAt: hoursBefore(0) }, NOW), true);
  assert.equal(joinedTooRecentlyForReminder({ joinedAt: hoursBefore(0.03) }, NOW), true);
});

test('a player who signed up before the quiet window still gets their reminder', () => {
  assert.equal(
    joinedTooRecentlyForReminder({ joinedAt: hoursBefore(RECENT_SIGNUP_QUIET_HOURS + 0.5) }, NOW),
    false
  );
  assert.equal(joinedTooRecentlyForReminder({ joinedAt: hoursBefore(30) }, NOW), false);
});

test('the quiet window ends exactly at the boundary', () => {
  assert.equal(
    joinedTooRecentlyForReminder({ joinedAt: hoursBefore(RECENT_SIGNUP_QUIET_HOURS) }, NOW),
    false
  );
});

test('a promotion off the waitlist restarts the quiet window', () => {
  // Joined the waitlist days ago, but was told "you're off the waitlist" moments ago.
  const promoted = { joinedAt: hoursBefore(50), promotedAt: hoursBefore(0.02) };
  assert.equal(joinedTooRecentlyForReminder(promoted, NOW), true);

  const promotedLongAgo = { joinedAt: hoursBefore(50), promotedAt: hoursBefore(9) };
  assert.equal(joinedTooRecentlyForReminder(promotedLongAgo, NOW), false);
});

test('an old promotion does not silence a fresh signup, or the reverse', () => {
  // Whichever text was most recent is what counts.
  assert.equal(
    joinedTooRecentlyForReminder({ joinedAt: hoursBefore(0.1), promotedAt: hoursBefore(40) }, NOW),
    true
  );
});

test('a roster entry with no timestamps is reminded as before', () => {
  // Host-added players and rows written before joinedAt existed must not go silent.
  assert.equal(joinedTooRecentlyForReminder({ name: 'No Stamps' }, NOW), false);
  assert.equal(joinedTooRecentlyForReminder({ joinedAt: 'not a date' }, NOW), false);
  assert.equal(joinedTooRecentlyForReminder({ joinedAt: null, promotedAt: null }, NOW), false);
});

test('a timestamp from the future is treated as recent, not as ancient', () => {
  // Clock skew should hold the reminder rather than fire it.
  assert.equal(joinedTooRecentlyForReminder({ joinedAt: hoursBefore(-2) }, NOW), true);
});
