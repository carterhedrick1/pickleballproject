const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { joinRejection } = require('../domain/join-policy');
const { hasGameEnded } = require('../public/js/central-time');

// "now" is a real instant, written in UTC so the fixture says what it means whatever timezone
// this test runs in. Central is UTC-5 in August (CDT) and UTC-6 in January (CST), so an 18:00
// game on 2026-08-01 starts at 23:00Z.
const at = (iso) => new Date(iso);

describe('hasGameEnded', () => {
  it('is false before the game starts', () => {
    assert.equal(hasGameEnded('2026-08-01', '18:00', 90, at('2026-08-01T22:00:00Z')), false);
  });

  it('is false while the game is being played', () => {
    assert.equal(hasGameEnded('2026-08-01', '18:00', 90, at('2026-08-02T00:00:00Z')), false);
  });

  it('is true once start + duration has passed', () => {
    assert.equal(hasGameEnded('2026-08-01', '18:00', 90, at('2026-08-02T00:31:00Z')), true);
  });

  it('treats a missing duration as ending at the start time', () => {
    assert.equal(hasGameEnded('2026-08-01', '18:00', undefined, at('2026-08-01T23:01:00Z')), true);
  });

  it('accepts a string duration, as stored games sometimes carry', () => {
    assert.equal(hasGameEnded('2026-08-01', '18:00', '90', at('2026-08-02T00:00:00Z')), false);
    assert.equal(hasGameEnded('2026-08-01', '18:00', '90', at('2026-08-02T00:31:00Z')), true);
  });

  it('is false (fails open to other checks) for malformed dates', () => {
    assert.equal(hasGameEnded('not-a-date', '18:00', 90, at('2026-08-02T00:31:00Z')), false);
    assert.equal(hasGameEnded('', '', 90, at('2026-08-02T00:31:00Z')), false);
  });

  it('measures a game that runs through the spring-forward gap in real hours', () => {
    // 2026-03-08 is the second Sunday in March: at 02:00 CST the clocks jump to 03:00 CDT, so
    // 02:30 never happens. A game at 01:30 CST (07:30Z) lasting 60 minutes therefore ends at
    // 08:30Z, which people in the room read as 03:30 CDT - an hour later on the wall than the
    // duration suggests. The old model added 60 minutes to the wall clock and asked whether
    // "02:30" had passed, a time that did not exist that night.
    assert.equal(hasGameEnded('2026-03-08', '01:30', 60, at('2026-03-08T08:29:00Z')), false);
    assert.equal(hasGameEnded('2026-03-08', '01:30', 60, at('2026-03-08T08:31:00Z')), true);
  });

  it('measures a game that runs through the fall-back repeat in real hours', () => {
    // 2026-11-01: 02:00 CDT falls back to 01:00 CST, so 01:30 happens twice. The first is
    // taken (06:30Z), which is what a host scheduling "01:30" that night would mean.
    assert.equal(hasGameEnded('2026-11-01', '01:30', 60, at('2026-11-01T07:29:00Z')), false);
    assert.equal(hasGameEnded('2026-11-01', '01:30', 60, at('2026-11-01T07:31:00Z')), true);
  });

  it('closes a game that ends after midnight, which the browser never used to', () => {
    // 23:00 + 120 minutes is 01:00 the next day. The old browser rule built the end time as
    // the string "25:00:00", which parses as Invalid Date, so the game stayed open for ever.
    assert.equal(hasGameEnded('2026-08-01', '23:00', 120, at('2026-08-02T05:59:00Z')), false);
    assert.equal(hasGameEnded('2026-08-01', '23:00', 120, at('2026-08-02T06:01:00Z')), true);
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
      hasGameEnded(date, time, duration, at('2026-08-02T00:00:00Z'));
    assert.equal(joinRejection(inProgress, { ended: stillPlaying }), null);
  });

  it('returns null for a missing game (the not-found path answers that)', () => {
    assert.equal(joinRejection(null), null);
  });
});
