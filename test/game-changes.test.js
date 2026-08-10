const test = require('node:test');
const assert = require('node:assert/strict');

const {
  snapshotGame,
  changedFields,
  buildChangeMessage,
  summarizeForHost
} = require('../utils/game-changes');

function baseGame() {
  return {
    location: 'Oak Park Courts',
    date: '2026-08-01',
    time: '09:00',
    duration: 90,
    message: 'Bring water.',
    personalityId: 'realist'
  };
}

test('only where-and-when edits count as a change worth texting about', () => {
  const before = snapshotGame(baseGame());

  const copyEditOnly = baseGame();
  copyEditOnly.message = 'Bring water and a spare paddle.';
  copyEditOnly.personalityId = 'coach';
  assert.deepEqual(changedFields(before, copyEditOnly), []);
  assert.equal(buildChangeMessage(before, copyEditOnly), null);

  const movedTime = baseGame();
  movedTime.time = '10:30';
  assert.deepEqual(changedFields(before, movedTime), ['time']);
});

test('the change text restates the whole time and place, not only the delta', () => {
  const before = snapshotGame(baseGame());
  const after = baseGame();
  after.time = '10:30';

  const message = buildChangeMessage(before, after);
  assert.match(message, /^UPDATED: Your pickleball game changed time\./);
  assert.match(message, /Oak Park Courts/);
  assert.match(message, /Sat, Aug 1 at 10:30 AM/);
  assert.match(message, /Duration: 90 minutes/);
  assert.match(message, /Reply 2 for details, or 9 to cancel\./);
});

test('a court move and a time move are described together', () => {
  const before = snapshotGame(baseGame());
  const after = baseGame();
  after.location = 'Riverside Courts';
  after.date = '2026-08-02';

  assert.match(buildChangeMessage(before, after), /^UPDATED: Your pickleball game moved\./);
  assert.equal(summarizeForHost(before, after), 'court and date');
});

test('the host summary lists every changed field in plain words', () => {
  const before = snapshotGame(baseGame());
  const after = baseGame();
  after.location = 'Riverside Courts';
  after.time = '10:30';
  after.duration = 120;

  assert.equal(summarizeForHost(before, after), 'court, time and duration');
});
