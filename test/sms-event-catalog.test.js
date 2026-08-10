const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  SMS_EVENT_DEFINITIONS,
  normalizeSmsEventId
} = require('../sms-event-catalog');

test('defines every outbound text trigger with stable dashboard copy', () => {
  assert.equal(SMS_EVENT_DEFINITIONS.length, 23);
  assert.equal(new Set(SMS_EVENT_DEFINITIONS.map((event) => event.id)).size, 23);
  SMS_EVENT_DEFINITIONS.forEach((event) => {
    assert.ok(event.id);
    assert.ok(event.title);
    assert.ok(event.recipient);
    assert.ok(event.description);
    assert.equal(normalizeSmsEventId(event.id), event.id);
  });
  assert.equal(normalizeSmsEventId('not-a-real-event'), 'unclassified');
});

test('wires every dashboard event into an outgoing SMS path', () => {
  const root = path.resolve(__dirname, '..');
  const runtimeSources = [
    'routes/announcements.js',
    'routes/games.js',
    'routes/invitations.js',
    'routes/players.js',
    'services/reminders.js',
    'services/host-verification.js',
    'services/sms-webhook.js'
  ].map((file) => fs.readFileSync(path.join(root, file), 'utf8')).join('\n');

  SMS_EVENT_DEFINITIONS.forEach((event) => {
    assert.match(
      runtimeSources,
      new RegExp(`['"]${event.id}['"]`),
      `${event.id} must be used by an outgoing SMS path`
    );
  });
});
