const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const PageUtils = require('../public/js/page-utils');

describe('PageUtils', () => {
  it('parses date-only values in local time without a UTC day shift', () => {
    const date = PageUtils.parseLocalDate('2026-07-27');
    assert.equal(date.getFullYear(), 2026);
    assert.equal(date.getMonth(), 6);
    assert.equal(date.getDate(), 27);
  });

  it('formats 24-hour times consistently', () => {
    assert.equal(PageUtils.formatTime12Hour('00:05'), '12:05 AM');
    assert.equal(PageUtils.formatTime12Hour('12:30'), '12:30 PM');
    assert.equal(PageUtils.formatTime12Hour('18:45'), '6:45 PM');
  });

  it('groups a cancelled upcoming game under Past Games immediately', () => {
    const now = new Date(2026, 6, 27, 12, 0);
    const game = {
      date: '2026-07-28',
      time: '19:15',
      cancelled: true
    };

    assert.equal(PageUtils.isGameCompleted(game.date, game.time, now), false);
    assert.equal(PageUtils.belongsInPastGames(game, now), true);
  });

  it('keeps active upcoming games out of Past Games', () => {
    const now = new Date(2026, 6, 27, 12, 0);
    const game = {
      date: '2026-07-28',
      time: '19:15',
      cancelled: false
    };

    assert.equal(PageUtils.belongsInPastGames(game, now), false);
  });

  it('continues to group completed active games under Past Games', () => {
    const now = new Date(2026, 6, 29, 12, 0);
    const game = {
      date: '2026-07-28',
      time: '19:15',
      cancelled: false
    };

    assert.equal(PageUtils.belongsInPastGames(game, now), true);
  });
});
