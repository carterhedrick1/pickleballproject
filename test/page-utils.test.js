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
});
