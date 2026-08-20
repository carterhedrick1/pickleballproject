const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { joinRejection } = require('../domain/join-policy');
const { hasGameEnded } = require('../utils/central-time');

// A "central now" for tests: hasGameEnded compares against the same naive wall-clock
// space the game's date/time strings live in, so tests can build one directly.
const at = (iso) => new Date(iso);

describe('hasGameEnded', () => {
  it('is false before the game starts', () => {
    assert.equal(hasGameEnded('2026-08-01', '18:00', 90, at('2026-08-01T17:00:00')), false);
  });

  it('is false while the game is being played', () => {
    assert.equal(hasGameEnded('2026-08-01', '18:00', 90, at('2026-08-01T19:00:00')), false);
  });

  it('is true once start + duration has passed', () => {
    assert.equal(hasGameEnded('2026-08-01', '18:00', 90, at('2026-08-01T19:31:00')), true);
  });

  it('treats a missing duration as ending at the start time', () => {
    assert.equal(hasGameEnded('2026-08-01', '18:00', undefined, at('2026-08-01T18:01:00')), true);
  });

  it('accepts a string duration, as stored games sometimes carry', () => {
    assert.equal(hasGameEnded('2026-08-01', '18:00', '90', at('2026-08-01T19:00:00')), false);
    assert.equal(hasGameEnded('2026-08-01', '18:00', '90', at('2026-08-01T19:31:00')), true);
  });

  it('is false (fails open to other checks) for malformed dates', () => {
    assert.equal(hasGameEnded('not-a-date', '18:00', 90, at('2026-08-01T19:31:00')), false);
    assert.equal(hasGameEnded('', '', 90, at('2026-08-01T19:31:00')), false);
  });

  it('stays consistent across the spring-forward DST boundary', () => {
    // 2026-03-08 is the second Sunday in March. Game 01:30 + 60min in naive wall-clock
    // terms ends at 02:30; the shifted-central model compares wall clocks directly.
    assert.equal(hasGameEnded('2026-03-08', '01:30', 60, at('2026-03-08T01:45:00')), false);
    assert.equal(hasGameEnded('2026-03-08', '01:30', 60, at('2026-03-08T03:31:00')), true);
  });
});

describe('joinRejection', () => {
  const openGame = { cancelled: false, date: '2099-01-01', time: '18:00', duration: 90 };

  it('allows joining an open upcoming game', () => {
    assert.equal(joinRejection(openGame), null);
  });

  it('rejects a cancelled game', () => {
    assert.equal(joinRejection({ ...openGame, cancelled: true }), 'game_cancelled');
  });

  it('rejects a cancelled game even if it has also ended', () => {
    const game = { cancelled: true, date: '2020-01-01', time: '18:00', duration: 90 };
    assert.equal(joinRejection(game), 'game_cancelled');
  });

  it('rejects a game that has ended', () => {
    const game = { cancelled: false, date: '2020-01-01', time: '18:00', duration: 90 };
    assert.equal(joinRejection(game), 'game_ended');
  });

  it('allows a game in progress (cutoff is game end, matching the browser)', () => {
    const inProgress = { cancelled: false, date: '2026-08-01', time: '18:00', duration: 90 };
    const stillPlaying = (date, time, duration) =>
      hasGameEnded(date, time, duration, new Date('2026-08-01T19:00:00'));
    assert.equal(joinRejection(inProgress, { ended: stillPlaying }), null);
  });

  it('returns null for a missing game (the not-found path answers that)', () => {
    assert.equal(joinRejection(null), null);
  });
});
