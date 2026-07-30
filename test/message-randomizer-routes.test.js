const test = require('node:test');
const assert = require('node:assert/strict');

const {
  validatePersonalityUpdate,
  validateMessage
} = require('../routes/message-randomizer');

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
