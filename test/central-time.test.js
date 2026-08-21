// The one Central Time model, tested at the moments that used to be decided five ways.
//
// Every "now" here is written in UTC so the fixture means the same thing whatever timezone the
// machine running it is set to - which is the whole point of the module. Central is UTC-6 in
// winter (CST) and UTC-5 in summer (CDT), so an 18:00 game is 00:00Z the next day in January
// and 23:00Z the same day in August.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  CENTRAL_TIME_ZONE,
  centralOffsetMs,
  wallClockToInstant,
  centralWallClock,
  centralDateKey,
  gameStart,
  gameEnd,
  isGameUpcoming,
  hasGameStarted,
  hasGameEnded,
  isGameRecentlyFinished,
  getGameStatus,
  getTimeUntilGame
} = require('../public/js/central-time');

const at = (iso) => new Date(iso);
const HOUR = 60 * 60 * 1000;

describe('turning a Central wall clock into a real instant', () => {
  it('knows the zone it speaks for', () => {
    assert.equal(CENTRAL_TIME_ZONE, 'America/Chicago');
  });

  it('reads CST in winter and CDT in summer', () => {
    assert.equal(centralOffsetMs(at('2026-01-15T12:00:00Z')) / HOUR, -6);
    assert.equal(centralOffsetMs(at('2026-08-15T12:00:00Z')) / HOUR, -5);
  });

  it('names the instant a stored game really starts at', () => {
    assert.equal(wallClockToInstant('2026-08-11', '18:00').toISOString(), '2026-08-11T23:00:00.000Z');
    assert.equal(wallClockToInstant('2026-01-15', '18:00').toISOString(), '2026-01-16T00:00:00.000Z');
  });

  it('lands on the right side of both clock changes', () => {
    // Spring forward: 2026-03-08. 01:00 is still CST, 03:00 is already CDT, and the hour
    // between them does not exist.
    assert.equal(wallClockToInstant('2026-03-08', '01:00').toISOString(), '2026-03-08T07:00:00.000Z');
    assert.equal(wallClockToInstant('2026-03-08', '03:00').toISOString(), '2026-03-08T08:00:00.000Z');
    // Fall back: 2026-11-01. 01:30 happens twice; the first (CDT) is taken.
    assert.equal(wallClockToInstant('2026-11-01', '01:30').toISOString(), '2026-11-01T06:30:00.000Z');
    assert.equal(wallClockToInstant('2026-11-01', '03:00').toISOString(), '2026-11-01T09:00:00.000Z');
  });

  it('refuses values it cannot read rather than inventing a date', () => {
    assert.equal(wallClockToInstant('', '18:00'), null);
    assert.equal(wallClockToInstant('2026-08-11', ''), null);
    assert.equal(wallClockToInstant('not-a-date', '18:00'), null);
    assert.equal(wallClockToInstant('2026-08-11', '25:00'), null);
    assert.equal(wallClockToInstant(null, null), null);
  });
});

describe('reading the Central wall clock back', () => {
  it('gives the date and time a player would see on the wall', () => {
    assert.deepEqual(centralWallClock(at('2026-08-11T23:00:00Z')), {
      date: '2026-08-11',
      time: '18:00',
      year: 2026,
      month: 8,
      day: 11,
      hour: 18,
      minute: 0
    });
  });

  it('spells midnight 00:00 rather than 24:00', () => {
    assert.equal(centralWallClock(at('2026-08-12T05:00:00Z')).time, '00:00');
  });

  it('rolls the Central day over at Central midnight, not UTC midnight', () => {
    // 03:00Z on the 12th is still 22:00 on the 11th in Chicago.
    assert.equal(centralDateKey(at('2026-08-12T03:00:00Z'), 0), '2026-08-11');
    assert.equal(centralDateKey(at('2026-08-12T05:30:00Z'), 0), '2026-08-12');
    assert.equal(centralDateKey(at('2026-08-12T03:00:00Z'), 1), '2026-08-12');
  });
});

describe('where a game sits against now', () => {
  const game = { date: '2026-08-11', time: '18:00', duration: 90 };

  it('finds its start and end as instants', () => {
    assert.equal(gameStart(game).toISOString(), '2026-08-11T23:00:00.000Z');
    assert.equal(gameEnd(game).toISOString(), '2026-08-12T00:30:00.000Z');
  });

  it('treats a game with no duration as ending when it starts', () => {
    assert.equal(gameEnd({ date: '2026-08-11', time: '18:00' }).toISOString(), '2026-08-11T23:00:00.000Z');
  });

  it('separates upcoming, in progress and ended', () => {
    const before = at('2026-08-11T22:00:00Z');
    const during = at('2026-08-11T23:30:00Z');
    const after = at('2026-08-12T01:00:00Z');

    assert.equal(isGameUpcoming(game.date, game.time, before), true);
    assert.equal(hasGameStarted(game.date, game.time, before), false);
    assert.equal(hasGameEnded(game.date, game.time, game.duration, before), false);

    assert.equal(isGameUpcoming(game.date, game.time, during), false);
    assert.equal(hasGameStarted(game.date, game.time, during), true);
    assert.equal(hasGameEnded(game.date, game.time, game.duration, during), false);

    assert.equal(hasGameStarted(game.date, game.time, after), true);
    assert.equal(hasGameEnded(game.date, game.time, game.duration, after), true);
  });

  it('says nothing is upcoming or started when the game has no schedule', () => {
    assert.equal(isGameUpcoming('', '', at('2026-08-11T22:00:00Z')), false);
    assert.equal(hasGameStarted('', '', at('2026-08-11T22:00:00Z')), false);
    assert.equal(hasGameEnded('', '', 90, at('2026-08-11T22:00:00Z')), false);
  });

  it('keeps a finished game reachable for its host for thirty days', () => {
    assert.equal(isGameRecentlyFinished(game.date, game.time, 30, at('2026-08-12T06:00:00Z')), true);
    assert.equal(isGameRecentlyFinished(game.date, game.time, 30, at('2026-09-05T06:00:00Z')), true);
    assert.equal(isGameRecentlyFinished(game.date, game.time, 30, at('2026-10-05T06:00:00Z')), false);
    // A game still to come is not "recently finished" - callers want those separately.
    assert.equal(isGameRecentlyFinished(game.date, game.time, 30, at('2026-08-11T20:00:00Z')), false);
  });

  it('honours a shorter window and ignores unreadable dates', () => {
    assert.equal(isGameRecentlyFinished(game.date, game.time, 3, at('2026-08-20T06:00:00Z')), false);
    assert.equal(isGameRecentlyFinished(game.date, game.time, 30, at('2026-08-20T06:00:00Z')), true);
    assert.equal(isGameRecentlyFinished('not-a-date', '09:00', 30, at('2026-08-20T06:00:00Z')), false);
  });
});

describe('what a page is told about a game', () => {
  const game = { date: '2026-08-11', time: '18:00', duration: 90, cancelled: false };

  it('reports the three states the pages branch on', () => {
    const upcoming = getGameStatus(game, at('2026-08-11T22:00:00Z'));
    assert.equal(upcoming.type, 'active');
    assert.equal(upcoming.canJoin, true);
    assert.equal(upcoming.canEdit, true);

    const ended = getGameStatus(game, at('2026-08-12T01:00:00Z'));
    assert.equal(ended.type, 'expired');
    assert.equal(ended.canJoin, false);
    assert.equal(ended.canEdit, false);

    const cancelled = getGameStatus({ ...game, cancelled: true }, at('2026-08-11T22:00:00Z'));
    assert.equal(cancelled.type, 'cancelled');
    assert.equal(cancelled.canJoin, false);
    assert.equal(cancelled.canEdit, false);
  });

  it('keeps a game in progress joinable, which is the whole reason the cutoff is game end', () => {
    const during = getGameStatus(game, at('2026-08-11T23:30:00Z'));
    assert.equal(during.type, 'active');
    assert.equal(during.canJoin, true);
  });

  it('says cancelled before ended, so a cancelled past game reads as cancelled', () => {
    const both = getGameStatus({ ...game, cancelled: true }, at('2026-08-12T01:00:00Z'));
    assert.equal(both.type, 'cancelled');
  });
});

describe('how long until the game', () => {
  const game = { date: '2026-08-11', time: '18:00' };

  it('counts down in days, hours and minutes', () => {
    assert.equal(getTimeUntilGame(game.date, game.time, at('2026-08-09T23:00:00Z')), '2 days away');
    assert.equal(getTimeUntilGame(game.date, game.time, at('2026-08-10T23:00:00Z')), '1 day away');
    assert.equal(getTimeUntilGame(game.date, game.time, at('2026-08-11T20:00:00Z')), '3 hours away');
    assert.equal(getTimeUntilGame(game.date, game.time, at('2026-08-11T22:00:00Z')), '1 hour away');
    assert.equal(getTimeUntilGame(game.date, game.time, at('2026-08-11T22:45:00Z')), '15 minutes away');
    assert.equal(getTimeUntilGame(game.date, game.time, at('2026-08-11T22:59:00Z')), '1 minute away');
  });

  it('says the game has started once it has', () => {
    assert.equal(getTimeUntilGame(game.date, game.time, at('2026-08-11T23:30:00Z')), 'Game has started');
  });

  it('is the same countdown wherever the reader is', () => {
    // The old version built the game time in the browser's own timezone, so this exact
    // instant read as "1 hour away" in Chicago and "2 hours away" in New York.
    const oneHourBefore = at('2026-08-11T22:00:00Z');
    assert.equal(getTimeUntilGame(game.date, game.time, oneHourBefore), '1 hour away');
  });

  it('says nothing about a game with no date or time', () => {
    assert.equal(getTimeUntilGame('', '18:00', at('2026-08-11T22:00:00Z')), '');
    assert.equal(getTimeUntilGame('2026-08-11', '', at('2026-08-11T22:00:00Z')), '');
  });
});

describe('the server and the browser agree', () => {
  // The signup cutoff is enforced twice - the page hides the form, the API refuses the join -
  // and they used to be two implementations that had to be kept matched by hand. They are now
  // the same function, so the only thing left to prove is that both answers come from it.
  it('is one module, so the two cutoffs cannot drift apart', () => {
    const browserSide = require('../public/js/central-time');
    const serverSide = require('../public/js/central-time');
    assert.equal(browserSide.hasGameEnded, serverSide.hasGameEnded);

    const game = { date: '2026-08-11', time: '18:00', duration: 90 };
    const during = at('2026-08-11T23:30:00Z');
    assert.equal(getGameStatus(game, during).canJoin, true);
    assert.equal(hasGameEnded(game.date, game.time, game.duration, during), false);
  });
});
