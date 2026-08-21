// Configurable inbound SMS replies managed from the Developer Area.
//
// Commands 1, 2, and 9 are part of the application's game workflow and cannot be changed.
// Custom commands use the remaining single-digit replies so they stay easy to type and never
// collide with Textbelt's carrier-level STOP/HELP handling.

const { renderTemplate } = require('./services/text-message-rotation');

const REPLY_OPTIONS_ASSET_NAME = 'sms-reply-options';
const CUSTOM_COMMANDS = Object.freeze(['0', '3', '4', '5', '6', '7', '8']);
const AUDIENCES = Object.freeze(['host', 'player', 'host-and-player']);
const MAX_TITLE_LENGTH = 80;
const MAX_MESSAGE_LENGTH = 1200;
const ALLOWED_TOKENS = Object.freeze([
  'LOCATION',
  'DATE',
  'TIME',
  'DURATION',
  'ROLE',
  'GAME_LINK',
  'MANAGEMENT_LINK'
]);

const SYSTEM_REPLY_OPTIONS = Object.freeze([
  Object.freeze({
    command: '1',
    title: 'Management Link',
    audience: 'host',
    description: 'Sends the host management link for one upcoming game, or a list when the host has several.'
  }),
  Object.freeze({
    command: '2',
    title: 'Game Details',
    audience: 'host-and-player',
    description: 'Sends upcoming game details. When there are several games, it sends a numbered list to choose from.'
  }),
  Object.freeze({
    command: '9',
    title: 'Cancel A Spot',
    audience: 'player',
    description: 'Cancels one player registration, waitlist spot, or application, asking which game first when there are several.'
  })
]);

function normalizeReplyOption(value) {
  return {
    command: String(value && value.command || '').trim(),
    title: String(value && value.title || '').trim(),
    audience: String(value && value.audience || '').trim(),
    message: String(value && value.message || '').trim(),
    enabled: value?.enabled !== false
  };
}

function normalizeReplyOptionsConfig(value) {
  const source = Array.isArray(value?.options) ? value.options : [];
  const seen = new Set();
  const options = [];

  source.forEach((item) => {
    const option = normalizeReplyOption(item);
    if (
      !CUSTOM_COMMANDS.includes(option.command) ||
      seen.has(option.command) ||
      !AUDIENCES.includes(option.audience) ||
      !option.title ||
      option.title.length > MAX_TITLE_LENGTH ||
      !option.message ||
      option.message.length > MAX_MESSAGE_LENGTH
    ) {
      return;
    }
    seen.add(option.command);
    options.push(option);
  });

  options.sort((a, b) => Number(a.command) - Number(b.command));
  return { options };
}

function validateReplyOptionsConfig(value) {
  if (!value || !Array.isArray(value.options)) {
    return { error: 'Reply options must be a list.' };
  }
  if (value.options.length > CUSTOM_COMMANDS.length) {
    return { error: `You can create up to ${CUSTOM_COMMANDS.length} custom reply options.` };
  }

  const commands = new Set();
  for (const item of value.options) {
    const option = normalizeReplyOption(item);
    if (!CUSTOM_COMMANDS.includes(option.command)) {
      return { error: `Choose one of these reply numbers: ${CUSTOM_COMMANDS.join(', ')}.` };
    }
    if (commands.has(option.command)) {
      return { error: `Reply ${option.command} can only be used once.` };
    }
    commands.add(option.command);
    if (!AUDIENCES.includes(option.audience)) {
      return { error: 'Choose Host, Player, or Host And Player.' };
    }
    if (!option.title || option.title.length > MAX_TITLE_LENGTH) {
      return { error: `Each option title must be between 1 and ${MAX_TITLE_LENGTH} characters.` };
    }
    if (!option.message || option.message.length > MAX_MESSAGE_LENGTH) {
      return { error: `Each reply message must be between 1 and ${MAX_MESSAGE_LENGTH} characters.` };
    }

    const unsupportedTokens = [...option.message.matchAll(/\{([A-Z][A-Z0-9_]*)\}/g)]
      .map((match) => match[1])
      .filter((token, index, tokens) => (
        !ALLOWED_TOKENS.includes(token) && tokens.indexOf(token) === index
      ));
    if (unsupportedTokens.length) {
      return {
        error: `Unsupported value${unsupportedTokens.length === 1 ? '' : 's'}: ${unsupportedTokens
          .map((token) => `{${token}}`)
          .join(', ')}.`
      };
    }
  }

  return { config: normalizeReplyOptionsConfig(value) };
}

let configCache = null;
let configCacheExpiresAt = 0;
const CONFIG_CACHE_MS = 5000;

async function loadReplyOptionsConfig() {
  if (configCache && Date.now() < configCacheExpiresAt) return configCache;
  const { getDevAsset } = require('./database/dev');
  const saved = await getDevAsset(REPLY_OPTIONS_ASSET_NAME);
  if (!saved) {
    configCache = normalizeReplyOptionsConfig();
  } else {
    try {
      configCache = normalizeReplyOptionsConfig(JSON.parse(saved.content));
    } catch (error) {
      console.error('Error parsing SMS reply options:', error.message);
      configCache = normalizeReplyOptionsConfig();
    }
  }
  configCacheExpiresAt = Date.now() + CONFIG_CACHE_MS;
  return configCache;
}

function clearReplyOptionsCache() {
  configCache = null;
  configCacheExpiresAt = 0;
}

async function findActiveReplyOption(command) {
  const config = await loadReplyOptionsConfig();
  return config.options.find((option) => (
    option.enabled && option.command === String(command)
  )) || null;
}

async function listActiveReplyOptions(audience) {
  const config = await loadReplyOptionsConfig();
  return config.options.filter((option) => (
    option.enabled &&
    (option.audience === audience || option.audience === 'host-and-player')
  ));
}

function renderReplyOptionMessage(option, values) {
  return renderTemplate(option.message, values);
}

async function appendCustomReplyInstructions(message, audience) {
  const options = await listActiveReplyOptions(audience);
  const instructions = options
    .filter((option) => !new RegExp(`\\breply\\s+["']?${option.command}\\b`, 'i').test(message))
    .map((option) => `Reply "${option.command}" for ${option.title}.`);
  return instructions.reduce((result, instruction) => {
    const next = `${result}\n${instruction}`;
    return next.length <= 1600 ? next : result;
  }, String(message).trim());
}

module.exports = {
  REPLY_OPTIONS_ASSET_NAME,
  CUSTOM_COMMANDS,
  AUDIENCES,
  ALLOWED_TOKENS,
  SYSTEM_REPLY_OPTIONS,
  normalizeReplyOptionsConfig,
  validateReplyOptionsConfig,
  loadReplyOptionsConfig,
  clearReplyOptionsCache,
  findActiveReplyOption,
  listActiveReplyOptions,
  renderReplyOptionMessage,
  appendCustomReplyInstructions
};
