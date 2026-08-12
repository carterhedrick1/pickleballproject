const { TEXT_MESSAGE_CATEGORIES } = require('./text-message-categories');

const BASE_SURFACES = [
  {
    id: 'site-slogan',
    name: 'Site Slogan',
    purpose: 'Shared header and footer line.',
    allowedTokens: ['NAME'],
    maxLength: 240,
    allowEmpty: false,
    targetedGroupCopy: false,
    autoPublishEligible: true
  },
  {
    id: 'invitation-opening',
    name: 'Invitation Opening',
    purpose: 'Personality line at the beginning of copied invitation text.',
    allowedTokens: [],
    maxLength: 240,
    allowEmpty: true,
    targetedGroupCopy: true,
    autoPublishEligible: true
  },
  {
    id: 'empty-my-games',
    name: 'Empty My Games',
    purpose: 'Personality line on the My Games page before any game exists.',
    allowedTokens: [],
    maxLength: 240,
    allowEmpty: true,
    targetedGroupCopy: false,
    autoPublishEligible: false
  },
  {
    id: 'empty-roster',
    name: 'Empty Roster',
    purpose: 'Personality line on the Roster page before anybody is on it.',
    allowedTokens: [],
    maxLength: 240,
    allowEmpty: true,
    targetedGroupCopy: false,
    autoPublishEligible: false
  },
  {
    id: 'post-create-success',
    name: 'Post-Create Success',
    purpose: 'Personality line shown to the host right after creating a game.',
    allowedTokens: [],
    maxLength: 240,
    allowEmpty: true,
    targetedGroupCopy: false,
    autoPublishEligible: false
  }
];

const SMS_SURFACES = TEXT_MESSAGE_CATEGORIES.map((category) => ({
  id: category.id,
  name: category.title,
  purpose: category.description,
  allowedTokens: category.tokens || [],
  maxLength: category.maxLength,
  allowEmpty: category.id === 'organizer-announcement',
  targetedGroupCopy: true,
  autoPublishEligible: category.id !== 'organizer-announcement'
}));

const MESSAGE_SURFACES = Object.freeze([...BASE_SURFACES, ...SMS_SURFACES]);
const SURFACE_BY_ID = new Map(MESSAGE_SURFACES.map((surface) => [surface.id, surface]));

function getMessageSurface(surfaceId) {
  return SURFACE_BY_ID.get(String(surfaceId || '')) || null;
}

module.exports = {
  MESSAGE_SURFACES,
  getMessageSurface
};
