const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  getCentralTimeNow,
  isGameUpcoming,
  isGameRecentlyFinished
} = require('../utils/central-time');

// Both helpers compare a game's wall clock against the Central wall clock, so the fixtures are
// built by shifting the same "now" rather than by hardcoding a date this test would outlive.
function shiftedGame(days, hours = 0) {
  const moment = new Date(getCentralTimeNow().getTime() + (days * 24 + hours) * 60 * 60 * 1000);
  const pad = (value) => String(value).padStart(2, '0');
  return {
    date: `${moment.getFullYear()}-${pad(moment.getMonth() + 1)}-${pad(moment.getDate())}`,
    time: `${pad(moment.getHours())}:${pad(moment.getMinutes())}`
  };
}

describe('central time windows', () => {
  it('separates upcoming games from finished ones', () => {
    const tomorrow = shiftedGame(1);
    const yesterday = shiftedGame(-1);

    assert.equal(isGameUpcoming(tomorrow.date, tomorrow.time), true);
    assert.equal(isGameUpcoming(yesterday.date, yesterday.time), false);
  });

  it('treats games from the last thirty days as recently finished', () => {
    const lastNight = shiftedGame(0, -12);
    const lastWeek = shiftedGame(-7);
    const lastYear = shiftedGame(-365);
    const tomorrow = shiftedGame(1);

    assert.equal(isGameRecentlyFinished(lastNight.date, lastNight.time), true);
    assert.equal(isGameRecentlyFinished(lastWeek.date, lastWeek.time), true);
    assert.equal(isGameRecentlyFinished(lastYear.date, lastYear.time), false);

    // An upcoming game is not "recently finished" - the caller wants those separately.
    assert.equal(isGameRecentlyFinished(tomorrow.date, tomorrow.time), false);
  });

  it('honours a custom window and ignores unparseable dates', () => {
    const lastWeek = shiftedGame(-7);

    assert.equal(isGameRecentlyFinished(lastWeek.date, lastWeek.time, 3), false);
    assert.equal(isGameRecentlyFinished(lastWeek.date, lastWeek.time, 30), true);
    assert.equal(isGameRecentlyFinished('not-a-date', '09:00'), false);
  });
});
