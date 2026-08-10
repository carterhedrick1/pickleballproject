const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeMessageText,
  readMigrationCopy,
  REALIST_INVITATION_OPENING_DRAFTS,
  REALIST_GAME_DETAILS_DRAFTS
} = require('../database/message-randomizer');
const {
  extractTokens,
  validateGeneratedCandidate
} = require('../services/message-generation');
const {
  renderSupportedTokens,
  joinMessageSections,
  chooseScheduledBucket,
  selectNoRepeat,
  gameIdentityState,
  ruleMatchesContext,
  resolveRandomizedMessage
} = require('../services/message-randomizer');
const { getMessageSurface, MESSAGE_SURFACES } = require('../message-surfaces');

test('defines every stable surface once', () => {
  assert.equal(MESSAGE_SURFACES.length, 16);
  assert.equal(new Set(MESSAGE_SURFACES.map((surface) => surface.id)).size, 16);
  assert.equal(getMessageSurface('site-slogan').allowedTokens[0], 'NAME');
  assert.equal(getMessageSurface('youre-in').id, 'youre-in');
});

test('normalizes whitespace and punctuation-only message differences', () => {
  assert.equal(
    normalizeMessageText('  You’re IN...  The others have been warned! '),
    normalizeMessageText("You're IN — The others have been warned")
  );
});

test('preserves all 41 saved owner-vetted values and the deterministic details template', () => {
  const slogans = Array.from({ length: 19 }, (_value, index) => `Saved slogan ${index + 1}.`);
  const youreIn = Array.from(
    { length: 22 },
    (_value, index) => `You're IN. Saved opening ${index + 1}.`
  );
  const detailsTemplate = 'Court: {LOCATION}. Reply 9 to cancel.';
  const migrated = readMigrationCopy({
    sloganAsset: JSON.stringify({ slogans, names: ['Scott'] }),
    youreInAsset: JSON.stringify({ messages: youreIn, detailsTemplate })
  });
  assert.deepEqual(migrated.slogans, slogans);
  assert.deepEqual(migrated.youreIn, youreIn);
  assert.equal(migrated.youreInDetailsTemplate, detailsTemplate);
  assert.equal(migrated.slogans.length + migrated.youreIn.length, 41);
});

test('keeps the 20 owner-approved Realist invitation openings valid and unique', () => {
  const surface = getMessageSurface('invitation-opening');
  const normalized = new Set();
  assert.equal(REALIST_INVITATION_OPENING_DRAFTS.length, 20);
  for (const text of REALIST_INVITATION_OPENING_DRAFTS) {
    const result = validateGeneratedCandidate(text, { surface });
    assert.equal(result.valid, true, `${text}: ${result.reason}`);
    assert.equal(normalized.has(result.normalized), false, `Duplicate opening: ${text}`);
    normalized.add(result.normalized);
  }
});

test('keeps the 9 owner-approved Realist game details drafts valid and unique', () => {
  const surface = getMessageSurface('game-details');
  const allowedTokens = new Set(surface.allowedTokens);
  const normalized = new Set();
  assert.equal(REALIST_GAME_DETAILS_DRAFTS.length, 9);
  for (const text of REALIST_GAME_DETAILS_DRAFTS) {
    const result = validateGeneratedCandidate(text, { surface });
    assert.equal(result.valid, true, `${text}: ${result.reason}`);
    assert.equal(text.length <= surface.maxLength, true, `Too long: ${text}`);
    assert.equal(
      extractTokens(text).every((token) => allowedTokens.has(token)),
      true,
      `Unsupported token: ${text}`
    );
    assert.equal(normalized.has(result.normalized), false, `Duplicate draft: ${text}`);
    normalized.add(result.normalized);
  }
});

test('renders only values allowed by the selected surface', () => {
  const surface = getMessageSurface('site-slogan');
  assert.equal(
    renderSupportedTokens('Ask {NAME} on {DATE}.', { NAME: 'Scott', DATE: 'Friday' }, surface),
    'Ask Scott on {DATE}.'
  );
  assert.equal(joinMessageSections('Short opening.', 'Deterministic details.'), (
    'Short opening.\n\nDeterministic details.'
  ));
});

test('deficit scheduler converges to a 40/60 split over short windows', () => {
  const history = [];
  const selected = [];
  for (let index = 0; index < 20; index++) {
    const bucket = chooseScheduledBucket(history, 40);
    selected.push(bucket);
    history.push({ sourceBucket: bucket });
  }
  assert.equal(selected.slice(0, 10).filter((bucket) => bucket === 'locked').length, 4);
  assert.equal(selected.filter((bucket) => bucket === 'locked').length, 8);
});

test('no-repeat uses every eligible message before relaxing oldest-first', () => {
  const messages = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const history = [{ messageId: 'a' }, { messageId: 'b' }];
  assert.equal(selectNoRepeat(messages, [], history, () => 0).id, 'c');
  assert.equal(
    selectNoRepeat(messages, [], [{ messageId: 'c' }, { messageId: 'b' }, { messageId: 'a' }]).id,
    'a'
  );
  assert.equal(selectNoRepeat(messages, ['a', 'b'], [], () => 0).id, 'c');
});

test('phone identity survives name changes and drives target matching', () => {
  const game = {
    players: [{ name: 'New Display Name', phone: '(816) 555-0101' }],
    waitlist: [{ name: 'Someone Else', phone: '8165550102' }],
    invitedPlayers: [{ name: 'Intended Player', phone: '8165550103' }]
  };
  assert.equal(gameIdentityState(game, '1-816-555-0101'), 'confirmed');
  assert.equal(gameIdentityState(game, '8165550103'), 'invited');
  assert.equal(gameIdentityState({
    registrationMode: 'waitlist',
    waitlist: [{ phone: '8165550104' }]
  }, '8165550104'), 'applicant');

  const baseRule = {
    enabled: true,
    targetPhone: '8165550101',
    targetDisplayName: 'Old Display Name',
    gameId: null,
    triggerStatus: 'confirmed',
    audience: 'target-only',
    startsAt: null,
    endsAt: null
  };
  assert.equal(ruleMatchesContext(baseRule, {
    game,
    gameId: 'game-1',
    recipientPhone: '8165550101',
    audience: 'target-only'
  }), true);
  assert.equal(ruleMatchesContext({
    ...baseRule,
    audience: 'invitation-copy',
    targetPhone: '8165550103',
    triggerStatus: 'any-known'
  }, {
    game,
    gameId: 'game-1',
    audience: 'invitation-copy'
  }), true);
  assert.equal(ruleMatchesContext({
    ...baseRule,
    audience: 'invitation-copy',
    targetPhone: '8165550199',
    triggerStatus: 'any-known'
  }, {
    game,
    gameId: 'game-1',
    audience: 'invitation-copy'
  }), false);
});

function fakeDatabase(overrides = {}) {
  const events = [];
  return {
    events,
    async getPersonality() {
      return {
        id: 'realist',
        enabled: true,
        lockedPercent: 40
      };
    },
    async getDefaultPersonality() {
      return {
        id: 'realist',
        enabled: true,
        lockedPercent: 40
      };
    },
    async getSurfaceSetting() {
      return { enabled: true, lockedPercentOverride: null };
    },
    async getSelectionHistory() {
      return [];
    },
    async listTargetRules() {
      return [];
    },
    async listRandomizerMessages() {
      return [
        { id: 'locked-1', text: 'Realist opening.', locked: true, targetRuleId: null }
      ];
    },
    async recordSelection(event) {
      events.push(event);
    },
    ...overrides
  };
}

test('resolver selects stored copy instantly and keeps deterministic details intact', async () => {
  const database = fakeDatabase();
  const result = await resolveRandomizedMessage({
    database,
    personalityId: 'realist',
    surfaceId: 'youre-in',
    templateValues: {},
    deterministicDetails: 'Court on Friday. Reply 9 to cancel.',
    fallbackText: 'Legacy message.',
    recipientPhone: '8165550101'
  });
  assert.equal(result.text, 'Realist opening.\n\nCourt on Friday. Reply 9 to cancel.');
  assert.equal(result.sourceBucket, 'locked');
  assert.equal(database.events.length, 1);
});

test('resolver falls back to the available inventory bucket', async () => {
  const database = fakeDatabase({
    async getPersonality() {
      return { id: 'realist', enabled: true, lockedPercent: 0 };
    },
    async listRandomizerMessages() {
      return [{
        id: 'locked-only',
        text: 'The locked pool remains available.',
        locked: true,
        targetRuleId: null
      }];
    }
  });
  const result = await resolveRandomizedMessage({
    database,
    surfaceId: 'site-slogan',
    fallbackText: 'Legacy.'
  });
  assert.equal(result.messageId, 'locked-only');
  assert.equal(result.sourceBucket, 'locked');
});

test('exact target rules precede inventory and preview does not increment usage', async () => {
  const rule = {
    id: 'rule-1',
    enabled: true,
    targetPhone: '8165550101',
    gameId: null,
    triggerStatus: 'confirmed',
    surfaceId: 'youre-in',
    audience: 'target-only',
    mode: 'exact',
    exactText: 'You answered. Miracles happen.',
    startsAt: null,
    endsAt: null
  };
  const database = fakeDatabase({
    async listTargetRules() {
      return [rule];
    }
  });
  const result = await resolveRandomizedMessage({
    database,
    surfaceId: 'youre-in',
    game: { players: [{ name: 'Changed', phone: '8165550101' }] },
    gameId: 'game-1',
    recipientPhone: '8165550101',
    deterministicDetails: 'Reply 9 to cancel.',
    fallbackText: 'Legacy message.',
    preview: true
  });
  assert.equal(result.sourceBucket, 'exact-target');
  assert.equal(result.targetRuleId, 'rule-1');
  assert.equal(result.text, 'You answered. Miracles happen.\n\nReply 9 to cancel.');
  assert.equal(database.events.length, 0);
});

test('direction rules select only target-specific inventory for a known game audience', async () => {
  const rule = {
    id: 'direction-rule',
    enabled: true,
    targetPhone: '8165550101',
    gameId: null,
    triggerStatus: 'confirmed',
    surfaceId: 'game-cancelled',
    audience: 'known-game-audience',
    mode: 'direction',
    exactText: null,
    startsAt: null,
    endsAt: null
  };
  const database = fakeDatabase({
    async listTargetRules() {
      return [rule];
    },
    async listRandomizerMessages(filters) {
      if (filters.targetRuleId === 'direction-rule') {
        return [{
          id: 'directed-1',
          text: 'The forecast has defeated the schedule.',
          locked: false,
          targetRuleId: 'direction-rule'
        }];
      }
      return [{ id: 'general-1', text: 'General.', locked: true, targetRuleId: null }];
    }
  });
  const result = await resolveRandomizedMessage({
    database,
    surfaceId: 'game-cancelled',
    game: {
      players: [
        { phone: '8165550101' },
        { phone: '8165550102' }
      ]
    },
    gameId: 'game-1',
    deterministicDetails: 'Cancelled because the courts are closed.',
    fallbackText: 'Legacy cancellation.',
    audience: 'known-game-audience'
  });
  assert.equal(result.sourceBucket, 'directed-target');
  assert.equal(result.messageId, 'directed-1');
  assert.equal(result.targetRuleId, 'direction-rule');
});

test('database failure returns the exact legacy fallback', async () => {
  const database = fakeDatabase({
    async getPersonality() {
      throw new Error('database unavailable');
    }
  });
  const result = await resolveRandomizedMessage({
    database,
    personalityId: 'realist',
    surfaceId: 'youre-in',
    fallbackText: 'The existing deterministic message.'
  });
  assert.equal(result.text, 'The existing deterministic message.');
  assert.equal(result.sourceBucket, 'fallback');
});
