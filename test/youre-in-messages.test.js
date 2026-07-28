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
    { messages: ['First', 'Second'] },
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
    { messages: ['First', 'Second'] }
  );
  assert.equal(
    youreInMessages.normalizeConfig({ messages: [] }).messages.length,
    22
  );
});
