const test = require('node:test');
const assert = require('node:assert/strict');

const {
  SYSTEM_REPLY_OPTIONS,
  normalizeReplyOptionsConfig,
  validateReplyOptionsConfig,
  renderReplyOptionMessage
} = require('../sms-reply-options');

test('inventories the protected Host and Player reply commands', () => {
  assert.deepEqual(
    SYSTEM_REPLY_OPTIONS.map(({ command, audience }) => ({ command, audience })),
    [
      { command: '1', audience: 'host' },
      { command: '2', audience: 'host-and-player' },
      { command: '9', audience: 'player' }
    ]
  );
});

test('normalizes, deduplicates, and sorts custom reply options', () => {
  assert.deepEqual(
    normalizeReplyOptionsConfig({
      options: [
        { command: '8', title: '  Parking  ', audience: 'player', message: '  Use lot B.  ' },
        { command: '3', title: 'Weather', audience: 'host-and-player', message: 'Check the app.' },
        { command: '3', title: 'Duplicate', audience: 'host', message: 'Ignored.' },
        { command: '1', title: 'Reserved', audience: 'host', message: 'Ignored.' }
      ]
    }),
    {
      options: [
        {
          command: '3',
          title: 'Weather',
          audience: 'host-and-player',
          message: 'Check the app.',
          enabled: true
        },
        {
          command: '8',
          title: 'Parking',
          audience: 'player',
          message: 'Use lot B.',
          enabled: true
        }
      ]
    }
  );
});

test('rejects reserved commands and unsupported message values', () => {
  assert.match(
    validateReplyOptionsConfig({
      options: [{ command: '2', title: 'Other Details', audience: 'player', message: 'Hello' }]
    }).error,
    /reply numbers/
  );
  assert.match(
    validateReplyOptionsConfig({
      options: [{ command: '3', title: 'Weather', audience: 'player', message: '{UNKNOWN}' }]
    }).error,
    /Unsupported value/
  );
});

test('renders game values into a custom response', () => {
  assert.equal(
    renderReplyOptionMessage(
      { message: '{ROLE}: Meet at {LOCATION} at {TIME}. {GAME_LINK}' },
      {
        ROLE: 'Confirmed Player',
        LOCATION: 'Oak Park Courts',
        TIME: '9:00 AM',
        GAME_LINK: 'https://inorout.club/game.html?id=abc'
      }
    ),
    'Confirmed Player: Meet at Oak Park Courts at 9:00 AM. https://inorout.club/game.html?id=abc'
  );
});
