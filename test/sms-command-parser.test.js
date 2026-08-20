const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseSmsCommand } = require('../services/sms-command-parser');

describe('parseSmsCommand', () => {
  it('reads the three built-in commands when no list is pending', () => {
    assert.deepEqual(parseSmsCommand('1', null), { type: 'management_links' });
    assert.deepEqual(parseSmsCommand('2', null), { type: 'game_details' });
    assert.deepEqual(parseSmsCommand('9', null), { type: 'cancellation' });
  });

  it('trims whitespace the way phones add it', () => {
    assert.deepEqual(parseSmsCommand(' 9 ', null), { type: 'cancellation' });
    assert.deepEqual(parseSmsCommand('\n2', null), { type: 'game_details' });
  });

  it('treats ANY bare number as a list answer while a selection is pending', () => {
    assert.deepEqual(parseSmsCommand('3', 'details_selection'), {
      type: 'selection', index: 2, context: 'details_selection'
    });
    // Including the numbers that would otherwise be commands: someone answering a
    // cancellation list with "2" means the second game on the list, not "game details".
    assert.deepEqual(parseSmsCommand('2', 'cancellation_selection'), {
      type: 'selection', index: 1, context: 'cancellation_selection'
    });
    assert.deepEqual(parseSmsCommand('9', 'cancellation_selection'), {
      type: 'selection', index: 8, context: 'cancellation_selection'
    });
  });

  it('carries an unknown saved context through so the dispatcher can reset it', () => {
    assert.deepEqual(parseSmsCommand('1', 'something_stale'), {
      type: 'selection', index: 0, context: 'something_stale'
    });
  });

  it('classifies everything else as other, preserving the trimmed text', () => {
    assert.deepEqual(parseSmsCommand('hello', null), { type: 'other', text: 'hello' });
    assert.deepEqual(parseSmsCommand('  STOP  ', null), { type: 'other', text: 'STOP' });
    // Multi-digit numbers are only meaningful as list answers; bare, they are not a command.
    assert.deepEqual(parseSmsCommand('12', null), { type: 'other', text: '12' });
    assert.deepEqual(parseSmsCommand('', null), { type: 'other', text: '' });
    assert.deepEqual(parseSmsCommand(null, null), { type: 'other', text: '' });
  });

  it('does not treat words as selections even while a list is pending', () => {
    assert.deepEqual(parseSmsCommand('yes', 'cancellation_selection'), { type: 'other', text: 'yes' });
  });
});
