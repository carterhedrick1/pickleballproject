const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULT_MESSAGES } = require('../youre-in-messages');
const { TEXT_MESSAGE_CATEGORIES } = require('../text-message-categories');

// A pool message is chosen at random and pasted in front of the real game details, so it knows
// nothing about the game it lands on. "Four spots, four people who answered" went out for a
// two-spot game and contradicted the very next line of its own text.
//
// Numbers as jokes are fine ("Two buttons. Pick one."). Numbers counting spots, players or
// people on this roster are not, because only the details line knows those.
const CAPACITY_CLAIMS = [
  // "Four spots", "two people", "3 players"
  new RegExp(
    '\\b(one|two|three|four|five|six|seven|eight|nine|ten|\\d+)\\b' +
    '[^.!?]{0,24}' +
    '\\b(spot|spots|player|players|people|person|answered|joined|signed up|on the roster)\\b',
    'i'
  ),
  // "They needed a fourth" - the noun is left out, but it is still a roster size.
  /\bneed(s|ed)?\s+an?\s+(second|third|fourth|fifth|sixth|seventh|eighth)\b/i
];

function offenders(messages) {
  return messages.filter((message) => CAPACITY_CLAIMS.some((rule) => rule.test(message)));
}

describe('rotating pool messages', () => {
  it("never states how many spots or players a game has", () => {
    assert.deepEqual(offenders(DEFAULT_MESSAGES), []);
  });

  it('leaves the counting to the details line, which knows the real numbers', () => {
    const youreIn = TEXT_MESSAGE_CATEGORIES.find((category) => category.id === 'youre-in');

    assert.match(youreIn.defaultDetailsTemplate, /\{POSITION\} of \{TOTAL_PLAYERS\}/);
    assert.deepEqual(offenders([youreIn.preview.split('\n')[0]]), []);
  });

  it('recognises the message that caused this rule', () => {
    // Guards the guard: a rule that matches nothing would pass silently forever.
    assert.deepEqual(
      offenders([
        "You're IN. Four spots, four people who answered. Do the math.",
        "You're IN. They needed a fourth and you were available. That's the whole reason."
      ]).length,
      2
    );
    // ...without condemning a number used as a joke.
    assert.deepEqual(offenders(['Two buttons. Pick one.', 'Find 4 seconds to respond.']), []);
  });
});
