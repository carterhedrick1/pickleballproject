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
    assert.equal(PageUtils.canPermanentlyDelete(game, now), true);
  });

  it('keeps active upcoming games out of Past Games', () => {
    const now = new Date(2026, 6, 27, 12, 0);
    const game = {
      date: '2026-07-28',
      time: '19:15',
      cancelled: false
    };

    assert.equal(PageUtils.belongsInPastGames(game, now), false);
    assert.equal(PageUtils.canPermanentlyDelete(game, now), false);
  });

  it('continues to group completed active games under Past Games', () => {
    const now = new Date(2026, 6, 29, 12, 0);
    const game = {
      date: '2026-07-28',
      time: '19:15',
      cancelled: false
    };

    assert.equal(PageUtils.belongsInPastGames(game, now), true);
    assert.equal(PageUtils.canPermanentlyDelete(game, now), true);
  });

  it('describes how long ago a player signed up in the largest useful unit', () => {
    const now = new Date('2026-07-27T12:00:00.000Z');
    const ago = (iso) => PageUtils.formatTimeAgo(iso, now);

    assert.equal(ago('2026-07-27T11:59:30.000Z'), 'just now');
    assert.equal(ago('2026-07-27T11:59:00.000Z'), '1 minute ago');
    assert.equal(ago('2026-07-27T11:20:00.000Z'), '40 minutes ago');
    assert.equal(ago('2026-07-27T11:00:00.000Z'), '1 hour ago');
    assert.equal(ago('2026-07-27T04:00:00.000Z'), '8 hours ago');
    assert.equal(ago('2026-07-25T12:00:00.000Z'), '2 days ago');
  });

  it('describes a waiting time without the trailing "ago"', () => {
    const now = new Date('2026-07-27T12:00:00.000Z');

    assert.equal(PageUtils.formatDuration('2026-07-27T09:00:00.000Z', now), '3 hours');
    assert.equal(PageUtils.formatDuration('2026-07-26T12:00:00.000Z', now), '1 day');
    assert.equal(PageUtils.formatDuration('2026-07-27T11:59:50.000Z', now), 'just now');
  });

  it('says nothing when a timestamp is missing or unreadable', () => {
    assert.equal(PageUtils.formatTimeAgo(undefined), '');
    assert.equal(PageUtils.formatTimeAgo(''), '');
    assert.equal(PageUtils.formatDuration('not-a-timestamp'), '');
  });

  it('treats a timestamp from the future as just now rather than negative time', () => {
    const now = new Date('2026-07-27T12:00:00.000Z');

    assert.equal(PageUtils.formatDuration('2026-07-27T12:05:00.000Z', now), 'just now');
  });
});
