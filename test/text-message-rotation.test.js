const test = require('node:test');
const assert = require('node:assert/strict');

const {
  renderTemplate,
  selectCategoryMessage
} = require('../services/text-message-rotation');
const { TEXT_MESSAGE_CATEGORIES } = require('../text-message-categories');

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

test('combines one random opening with the non-random details template', () => {
  assert.equal(
    selectCategoryMessage(
      {
        categories: {
          'waitlist-confirmation': {
            enabled: true,
            messages: ['First option', 'Second option'],
            detailsTemplate: 'Waitlist #{POSITION} at {LOCATION}\n{DEFAULT_TEXT}'
          }
        }
      },
      'waitlist-confirmation',
      'Current waitlist text',
      { POSITION: 2, LOCATION: 'Oak Park' },
      () => 0.75
    ),
    'Second option\n\nWaitlist #2 at Oak Park\nCurrent waitlist text'
  );
});

test('uses edited details without requiring a random opening', () => {
  assert.equal(
    selectCategoryMessage(
      {
        categories: {
          'game-created': {
            enabled: true,
            messages: [],
            detailsTemplate: 'Created at {LOCATION}. {DEFAULT_TEXT}'
          }
        }
      },
      'game-created',
      'Current creation text',
      { LOCATION: 'Oak Park' }
    ),
    'Created at Oak Park. Current creation text'
  );
});

test('keeps the same details while the opening selection changes', () => {
  const config = {
    categories: {
      'game-cancelled': {
        enabled: true,
        messages: ['First opening', 'Second opening'],
        detailsTemplate: 'Game at {LOCATION} was cancelled.'
      }
    }
  };
  assert.equal(
    selectCategoryMessage(
      config,
      'game-cancelled',
      'Current text',
      { LOCATION: 'Oak Park' },
      () => 0
    ),
    'First opening\n\nGame at Oak Park was cancelled.'
  );
  assert.equal(
    selectCategoryMessage(
      config,
      'game-cancelled',
      'Current text',
      { LOCATION: 'Oak Park' },
      () => 0.99
    ),
    'Second opening\n\nGame at Oak Park was cancelled.'
  );
});

test('builds both sections for every toggle-controlled category', () => {
  const values = {
    LOCATION: 'Oak Park',
    DATE: 'Sat, Aug 1',
    TIME: '9:00 AM',
    POSITION: 1,
    STATUS: 'reservation',
    DAY: 'tomorrow',
    REASON: 'Rain',
    ANNOUNCEMENT: 'Bring water.',
    EVENT: 'playerJoins',
    PLAYER_NAME: 'Jamie',
    SPOTS_LEFT: 1,
    WAITLIST_COUNT: 2,
    TOTAL_PLAYERS: 4
  };

  TEXT_MESSAGE_CATEGORIES
    .filter((category) => !category.live)
    .forEach((category) => {
      const message = selectCategoryMessage(
        {
          categories: {
            [category.id]: {
              enabled: true,
              messages: ['Random opening'],
              detailsTemplate: category.defaultDetailsTemplate
            }
          }
        },
        category.id,
        `Current ${category.title} details`,
        values,
        () => 0
      );
      assert.ok(
        message.startsWith('Random opening\n\n'),
        `${category.id} should put its random opening first`
      );
      assert.ok(
        message.length > 'Random opening\n\n'.length,
        `${category.id} should retain a details section`
      );
      assert.doesNotMatch(
        message,
        /\{[A-Z][A-Z0-9_]*\}/,
        `${category.id} should resolve every supported value`
      );
    });
});
