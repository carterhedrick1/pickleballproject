const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  TEXT_MESSAGE_CATEGORIES,
  getTextMessageCategory,
  normalizeMessages,
  normalizeDraftConfig
} = require('../text-message-categories');

test('defines all 13 editable text message categories with current previews', () => {
  assert.equal(TEXT_MESSAGE_CATEGORIES.length, 13);
  assert.equal(new Set(TEXT_MESSAGE_CATEGORIES.map((category) => category.id)).size, 13);
  TEXT_MESSAGE_CATEGORIES.forEach((category) => {
    assert.ok(category.title);
    assert.ok(category.addTitle);
    assert.ok(category.listTitle);
    assert.ok(category.recipient);
    assert.ok(category.description);
    assert.ok(category.preview);
    assert.ok(category.maxLength >= category.preview.length);
    assert.equal(getTextMessageCategory(category.id), category);
  });
});

test("keeps You're In live while the other 12 category rotations are drafts", () => {
  const live = TEXT_MESSAGE_CATEGORIES.filter((category) => category.live);
  assert.deepEqual(live.map((category) => category.id), ['youre-in']);
  assert.equal(TEXT_MESSAGE_CATEGORIES.filter((category) => !category.live).length, 12);
});

test('normalizes bulk message additions without merging their bodies', () => {
  assert.deepEqual(
    normalizeMessages([' First text ', 'Second\ntext', '', 'First text'], 100),
    ['First text', 'Second\ntext']
  );
});

test('normalizes saved drafts and ignores unknown category data', () => {
  const config = normalizeDraftConfig({
    categories: {
      'waitlist-confirmation': { messages: [' One ', 'Two'] },
      unknown: { messages: ['Do not keep'] }
    }
  });

  assert.deepEqual(
    config.categories['waitlist-confirmation'].messages,
    ['One', 'Two']
  );
  assert.equal(config.categories['waitlist-confirmation'].enabled, false);
  assert.equal(config.categories['application-confirmation'].messages.length, 0);
  assert.equal(config.categories.unknown, undefined);
  assert.equal(config.categories['youre-in'], undefined);
});

test('wires every toggle-controlled category into an outgoing SMS path', () => {
  const root = path.resolve(__dirname, '..');
  const runtimeSources = [
    'routes/announcements.js',
    'routes/games.js',
    'routes/players.js',
    'services/reminders.js',
    'services/sms-webhook.js'
  ].map((file) => fs.readFileSync(path.join(root, file), 'utf8')).join('\n');

  TEXT_MESSAGE_CATEGORIES
    .filter((category) => !category.live)
    .forEach((category) => {
      assert.match(
        runtimeSources,
        new RegExp(`['"]${category.id}['"]`),
        `${category.id} must be used by an outgoing SMS path`
      );
    });
});
