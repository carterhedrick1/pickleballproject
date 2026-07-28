const test = require('node:test');
const assert = require('node:assert/strict');

const youreInMessages = require('../youre-in-messages');

test("ships the requested You're In rotation", () => {
  assert.equal(youreInMessages.DEFAULT_MESSAGES.length, 22);
  assert.equal(
    youreInMessages.DEFAULT_MESSAGES[0],
    "You're IN. The others have been warned."
  );
  assert.equal(
    youreInMessages.DEFAULT_MESSAGES[21],
    "You're IN. The waitlist has been told and is coping."
  );
});

test("selects a You're In text and keeps the game details", () => {
  const message = youreInMessages.build(
    { messages: ['First', 'Second'], detailsTemplate: '{DEFAULT_TEXT}' },
    'Pickleball at Test Court on Saturday. Reply 2 for details.',
    () => 0.75
  );

  assert.equal(
    message,
    'Second\n\nPickleball at Test Court on Saturday. Reply 2 for details.'
  );
});

test("normalizes editable You're In texts and falls back when empty", () => {
  assert.deepEqual(
    youreInMessages.normalizeConfig({ messages: ['  First  ', 'First', '', 'Second'] }),
    {
      messages: ['First', 'Second'],
      detailsTemplate: youreInMessages.DEFAULT_DETAILS_TEMPLATE
    }
  );
  assert.equal(
    youreInMessages.normalizeConfig({ messages: [] }).messages.length,
    22
  );
});

test("renders the editable You're In details with live game values", () => {
  const message = youreInMessages.build(
    {
      messages: ['Opening'],
      detailsTemplate:
        'Meet at {LOCATION} on {DATE} at {TIME}. You are player {POSITION} of {TOTAL_PLAYERS}.'
    },
    'Current details',
    {
      LOCATION: 'Oak Park',
      DATE: 'Sat, Aug 1',
      TIME: '9:00 AM',
      POSITION: 2,
      TOTAL_PLAYERS: 4
    },
    () => 0
  );
  assert.equal(
    message,
    'Opening\n\nMeet at Oak Park on Sat, Aug 1 at 9:00 AM. You are player 2 of 4.'
  );
});
