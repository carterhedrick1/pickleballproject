const test = require('node:test');
const assert = require('node:assert/strict');

const {
  PERMANENT_CONSTRAINTS,
  validateGeneratedCandidate,
  parseCandidateResponse,
  buildGenerationPrompt,
  DeterministicFakeGenerationProvider,
  generateFreshMessages
} = require('../services/message-generation');
const { getMessageSurface } = require('../message-surfaces');

test('parses only structured candidate responses', () => {
  assert.deepEqual(
    parseCandidateResponse('{"candidates":["One.",{"text":"Two."}]}'),
    ['One.', 'Two.']
  );
  assert.throws(() => parseCandidateResponse('not json'), /valid JSON/);
  assert.throws(() => parseCandidateResponse({ messages: [] }), /candidates list/);
});

test('rejects malformed, duplicated, unsafe, operational, and unsupported generated copy', () => {
  const surface = getMessageSurface('site-slogan');
  const options = {
    surface,
    existingNormalized: new Set(['already here']),
    archivedNormalized: new Set(['archived joke'])
  };
  assert.equal(validateGeneratedCandidate('', options).reason, 'blank');
  assert.equal(validateGeneratedCandidate('Already here!', options).reason, 'duplicate');
  assert.equal(validateGeneratedCandidate('Archived joke.', options).reason, 'duplicate');
  assert.equal(validateGeneratedCandidate('Reply 9 to cancel.', options).reason, 'operational-claim');
  assert.equal(validateGeneratedCandidate('Visit https://example.com', options).reason, 'url');
  assert.equal(validateGeneratedCandidate('See {DATE}.', options).reason, 'unsupported-token');
  assert.equal(validateGeneratedCandidate('A short direct joke.', options).valid, true);
});

test('generation prompts include permanent rules and every vetted style example', () => {
  const examples = Array.from({ length: 41 }, (_value, index) => ({
    surfaceId: index < 19 ? 'site-slogan' : 'youre-in',
    text: `Example ${index + 1}`
  }));
  const prompt = buildGenerationPrompt({
    personality: {
      name: 'Realist',
      description: 'Direct.',
      generationGuidance: 'Dry.'
    },
    surface: getMessageSurface('site-slogan'),
    styleExamples: examples,
    count: 5
  });
  assert.equal(prompt.styleExamples.length, 41);
  assert.deepEqual(prompt.permanentConstraints, PERMANENT_CONSTRAINTS);
  assert.equal(prompt.surface.id, 'site-slogan');
});

test('deterministic fake provider creates reviewed drafts and never auto-publishes', async () => {
  const created = [];
  const database = {
    async getPersonality() {
      return {
        id: 'realist',
        name: 'Realist',
        description: 'Direct.',
        generationGuidance: 'Dry.',
        enabled: true
      };
    },
    async listRandomizerMessages() {
      return Array.from({ length: 41 }, (_value, index) => ({
        id: `vetted-${index}`,
        surfaceId: index < 19 ? 'site-slogan' : 'youre-in',
        text: `Vetted example ${index + 1}.`,
        normalizedText: `vetted example ${index + 1}`,
        locked: true,
        vetted: true,
        status: 'active',
        source: 'migrated'
      }));
    },
    async getSurfaceSetting() {
      return { enabled: true, autoPublishGenerated: false };
    },
    async createRandomizerMessage(fields) {
      created.push(fields);
      return { id: `new-${created.length}`, ...fields };
    }
  };
  const provider = new DeterministicFakeGenerationProvider([
    'The group chat has received an actual decision.',
    'Availability remains undefeated.'
  ]);
  const result = await generateFreshMessages({
    database,
    provider,
    personalityId: 'realist',
    surfaceId: 'site-slogan',
    count: 2
  });
  assert.equal(result.styleExampleCount, 41);
  assert.equal(result.accepted.length, 2);
  assert.equal(created.every((message) => message.status === 'draft'), true);
  assert.equal(created.every((message) => message.source === 'generated'), true);
  assert.equal(created.every((message) => message.locked === false), true);
});
