const test = require('node:test');
const assert = require('node:assert/strict');

const {
  renderTemplate,
  selectCategoryMessage
} = require('../services/text-message-rotation');

test('renders known live values and leaves unknown values visible', () => {
  assert.equal(
    renderTemplate('{PLAYER_NAME} at {LOCATION}: {UNKNOWN}', {
      player_name: 'Jamie',
      location: 'Oak Park'
    }),
    'Jamie at Oak Park: {UNKNOWN}'
  );
});

test('keeps the current default while a category toggle is off', () => {
  assert.equal(
    selectCategoryMessage(
      {
        categories: {
          'waitlist-confirmation': {
            enabled: false,
            messages: ['Custom {LOCATION}']
          }
        }
      },
      'waitlist-confirmation',
      'Current waitlist text',
      { LOCATION: 'Oak Park' },
      () => 0
    ),
    'Current waitlist text'
  );
});

test('uses a random saved text when enabled and fills its values', () => {
  assert.equal(
    selectCategoryMessage(
      {
        categories: {
          'waitlist-confirmation': {
            enabled: true,
            messages: [
              'First option',
              'Waitlist #{POSITION} at {LOCATION}\n\n{DEFAULT_TEXT}'
            ]
          }
        }
      },
      'waitlist-confirmation',
      'Current waitlist text',
      { POSITION: 2, LOCATION: 'Oak Park' },
      () => 0.75
    ),
    'Waitlist #2 at Oak Park\n\nCurrent waitlist text'
  );
});

test('falls back to the current text when random mode has no saved text', () => {
  assert.equal(
    selectCategoryMessage(
      {
        categories: {
          'game-created': {
            enabled: true,
            messages: []
          }
        }
      },
      'game-created',
      'Current creation text'
    ),
    'Current creation text'
  );
});
