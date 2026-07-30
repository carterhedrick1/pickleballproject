const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildDeterministicInvitation,
  buildRandomizedInvitation
} = require('../services/invitation-message');

const game = {
  location: 'Oak Park Courts',
  date: '2026-08-01',
  time: '09:00',
  duration: 90,
  totalPlayers: 4,
  organizerPlaying: true,
  registrationMode: 'fcfs',
  message: 'Bring water.',
  personalityId: 'realist',
  players: [],
  waitlist: [],
  outPlayers: [],
  invitedPlayers: []
};

test('deterministic invitation preserves every operational detail and instruction', () => {
  const message = buildDeterministicInvitation(game, 'game-1', 'https://inorout.club');
  assert.match(message, /https:\/\/inorout\.club\/game\.html\?id=game-1/);
  assert.match(message, /Location: Oak Park Courts/);
  assert.match(message, /Date: Saturday, August 1, 2026/);
  assert.match(message, /Time: 9:00 AM/);
  assert.match(message, /Duration: 90 minutes/);
  assert.match(message, /Spots: 3/);
  assert.match(message, /Bring water\./);
  assert.match(message, /do not reply to this text message/);
  assert.match(message, /First 3 are in\./);
});

test('randomized invitation adds one stored opening without changing deterministic copy', async () => {
  const events = [];
  const database = {
    async getPersonality() {
      return { id: 'realist', enabled: true, lockedPercent: 100 };
    },
    async getDefaultPersonality() {
      return { id: 'realist', enabled: true, lockedPercent: 100 };
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
      return [{
        id: 'opening-1',
        text: 'The group chat needs a decision.',
        locked: true,
        targetRuleId: null
      }];
    },
    async recordSelection(event) {
      events.push(event);
    }
  };
  const result = await buildRandomizedInvitation(
    game,
    'game-1',
    'https://inorout.club',
    database
  );
  assert.match(result.text, /^The group chat needs a decision\.\n\nLet us know/);
  assert.match(result.text, /Reply|do not reply/i);
  assert.equal(events[0].gameId, 'game-1');
});
