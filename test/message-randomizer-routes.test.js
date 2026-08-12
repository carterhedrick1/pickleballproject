const test = require('node:test');
const assert = require('node:assert/strict');

const {
  validatePersonalityUpdate,
  validateMessage,
  validateCodexPromptUpdate,
  saveCodexPromptUpdate,
  PUBLIC_RANDOM_MESSAGE_SURFACES
} = require('../routes/message-randomizer');
const {
  DEFAULT_CODEX_PROMPT_SECTIONS,
  buildNumberedCodexPrompt
} = require('../codex-message-prompts');
const { getMessageSurface, MESSAGE_SURFACES } = require('../message-surfaces');

test('validates configurable ratios and surface overrides', () => {
  assert.equal(validatePersonalityUpdate({ lockedPercent: 101 }).error.includes('0 through 100'), true);
  assert.equal(validatePersonalityUpdate({
    lockedPercent: 40,
    surfaces: {
      'site-slogan': {
        enabled: true,
        lockedPercentOverride: 25,
        freshPoolMinimumOverride: 5
      }
    }
  }).error, undefined);
  assert.equal(validatePersonalityUpdate({
    surfaces: { imaginary: { enabled: true } }
  }).error, 'Unknown surface: imaginary.');
});

test('the public random-message route serves exactly the on-page surfaces', () => {
  assert.deepEqual(
    [...PUBLIC_RANDOM_MESSAGE_SURFACES].sort(),
    [
      'empty-my-games',
      'empty-roster',
      'game-details',
      'post-create-success',
      'site-slogan',
      'youre-in'
    ]
  );
  // Every public surface must be a real one, and SMS-only surfaces stay private.
  for (const surfaceId of PUBLIC_RANDOM_MESSAGE_SURFACES) {
    assert.ok(getMessageSurface(surfaceId), `${surfaceId} is a defined surface`);
  }
  assert.equal(PUBLIC_RANDOM_MESSAGE_SURFACES.has('invitation-opening'), false);
});

test('message validation protects surface tokens and status values', () => {
  assert.equal(validateMessage(null, {
    personalityId: 'realist',
    surfaceId: 'site-slogan',
    text: 'Ask {NAME}.',
    status: 'active'
  }, { creating: true }).error, undefined);
  assert.match(validateMessage(null, {
    personalityId: 'realist',
    surfaceId: 'site-slogan',
    text: 'Meet at {LOCATION}.'
  }, { creating: true }).error, /Unsupported/);
  assert.equal(validateMessage(null, {
    personalityId: 'realist',
    surfaceId: 'site-slogan',
    text: 'Valid.',
    status: 'deleted'
  }, { creating: true }).error, 'Unknown message status.');
});

test('Codex prompt validation requires nine numbered paragraphs and supports all categories', () => {
  const sections = [...DEFAULT_CODEX_PROMPT_SECTIONS];
  assert.equal(validateCodexPromptUpdate({
    personalityId: 'realist',
    surfaceId: 'site-slogan',
    sections
  }).error, undefined);
  assert.equal(validateCodexPromptUpdate({
    personalityId: 'realist',
    surfaceId: 'all',
    sections: sections.map((_section, index) => index === 3 ? 'Shared facts.' : null)
  }).error, undefined);
  assert.match(validateCodexPromptUpdate({
    personalityId: 'realist',
    surfaceId: 'site-slogan',
    sections: sections.slice(1)
  }).error, /9 numbered paragraphs/);
  assert.match(validateCodexPromptUpdate({
    personalityId: 'realist',
    surfaceId: 'all',
    sections: sections.map(() => null)
  }).error, /Change at least one paragraph/);
});

test('Codex prompt builder expands category details and numbers every paragraph', () => {
  const prompt = buildNumberedCodexPrompt(
    DEFAULT_CODEX_PROMPT_SECTIONS,
    getMessageSurface('site-slogan')
  );
  assert.match(prompt, /^Paragraph 1:/);
  assert.match(prompt, /Site Slogan/);
  assert.match(prompt, /Paragraph 9:\nBegin with the 50 candidates now\./);
  assert.equal((prompt.match(/^Paragraph \d+:/gm) || []).length, 9);
});

test('a checked prompt paragraph is saved across every message category', async () => {
  const records = new Map();
  const database = {
    async listCodexPrompts() {
      return [...records].map(([surfaceId, sections]) => ({ surfaceId, sections }));
    },
    async saveCodexPrompts(_personalityId, prompts) {
      for (const prompt of prompts) records.set(prompt.surfaceId, [...prompt.sections]);
      return this.listCodexPrompts();
    }
  };
  const sections = [...DEFAULT_CODEX_PROMPT_SECTIONS];
  sections[3] = 'Use the same safety paragraph everywhere.';
  await saveCodexPromptUpdate(database, {
    personalityId: 'realist',
    surfaceId: 'site-slogan',
    isAll: false,
    sections,
    sharedParagraphIndexes: [3]
  });
  assert.equal(records.size, MESSAGE_SURFACES.length);
  assert.equal(
    [...records.values()].every(
      (savedSections) => savedSections[3] === 'Use the same safety paragraph everywhere.'
    ),
    true
  );
  assert.equal(
    records.get('youre-in')[0],
    DEFAULT_CODEX_PROMPT_SECTIONS[0]
  );
});

test('all-category prompt updates preserve paragraphs that have different saved versions', async () => {
  const records = new Map([
    ['site-slogan', ['Slogan-specific opening.', ...DEFAULT_CODEX_PROMPT_SECTIONS.slice(1)]],
    ['youre-in', ['You’re In-specific opening.', ...DEFAULT_CODEX_PROMPT_SECTIONS.slice(1)]]
  ]);
  const database = {
    async listCodexPrompts() {
      return [...records].map(([surfaceId, sections]) => ({ surfaceId, sections }));
    },
    async saveCodexPrompts(_personalityId, prompts) {
      for (const prompt of prompts) records.set(prompt.surfaceId, [...prompt.sections]);
      return this.listCodexPrompts();
    }
  };
  const sections = DEFAULT_CODEX_PROMPT_SECTIONS.map(
    (_section, index) => index === 4 ? 'Use one shared two-phase instruction.' : null
  );
  await saveCodexPromptUpdate(database, {
    personalityId: 'realist',
    surfaceId: 'all',
    isAll: true,
    sections,
    sharedParagraphIndexes: []
  });
  assert.equal(records.get('site-slogan')[0], 'Slogan-specific opening.');
  assert.equal(records.get('youre-in')[0], 'You’re In-specific opening.');
  assert.equal(
    [...records.values()].every(
      (savedSections) => savedSections[4] === 'Use one shared two-phase instruction.'
    ),
    true
  );
});
