const { getMessageSurface } = require('../message-surfaces');
const { normalizeMessageText } = require('../database/message-rows');
// The "is a generation running" banner is a dev asset rather than a randomizer row.
const { getDevAsset, saveDevAsset } = require('../database/dev');
const messagePersonalities = require('../database/message-personalities');
const messageInventory = require('../database/message-inventory');

/**
 * The persistence calls generation makes, assembled from the specific repositories. Same seam
 * as services/message-randomizer.js: the unit tests pass a fake in place of this.
 */
const MESSAGE_STORE = Object.freeze({
  getPersonality: messagePersonalities.getPersonality,
  getSurfaceSetting: messagePersonalities.getSurfaceSetting,
  listRandomizerMessages: messageInventory.listRandomizerMessages,
  createRandomizerMessage: messageInventory.createRandomizerMessage
});

const PROMPT_VERSION = 'realist-v1';
const PERMANENT_CONSTRAINTS = Object.freeze([
  'Do not invent facts about a player.',
  'Do not reference protected characteristics, health, disability, religion, sexuality, finances, trauma, or family circumstances.',
  'Do not produce threats, slurs, sexual content, or encouragement of harassment.',
  'Do not imply a player has been excluded when they have not.',
  'Do not alter dates, times, locations, roster status, links, or reply commands.',
  'Keep Realist copy short and direct.',
  'Preserve supported template tokens exactly.'
]);
const SAFETY_PATTERNS = [
  /\b(?:kill|suicide|slur|rape|sexual|nazi)\b/i,
  /\b(?:disabled|disability|religion|sexuality|pregnan|trauma)\b/i
];
const OPERATIONAL_CLAIM_PATTERNS = [
  /\breply\s+\d/i,
  /\b(?:today|tomorrow|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
  /\b\d{1,2}:\d{2}\b/,
  /\b(?:confirmed|waitlisted|cancelled|player\s+\d+|spots?\s+(?:left|remaining))\b/i
];
const generationFlights = new Map();
const failureBackoff = new Map();

function extractTokens(text) {
  return [...String(text).matchAll(/\{([A-Z][A-Z0-9_]*)\}/g)].map((match) => match[1]);
}

function validateGeneratedCandidate(text, {
  surface,
  existingNormalized = new Set(),
  archivedNormalized = new Set(),
  requiredTokens = []
}) {
  const candidate = String(text == null ? '' : text).trim();
  if (!candidate) return { valid: false, reason: 'blank' };
  if (candidate.length > surface.maxLength) return { valid: false, reason: 'too-long' };
  const normalized = normalizeMessageText(candidate);
  if (!normalized) return { valid: false, reason: 'malformed' };
  if (existingNormalized.has(normalized) || archivedNormalized.has(normalized)) {
    return { valid: false, reason: 'duplicate' };
  }
  const allowedTokens = new Set(surface.allowedTokens || []);
  const tokens = extractTokens(candidate);
  if (tokens.some((token) => !allowedTokens.has(token))) {
    return { valid: false, reason: 'unsupported-token' };
  }
  if (requiredTokens.some((token) => !tokens.includes(token))) {
    return { valid: false, reason: 'missing-token' };
  }
  if (/https?:\/\/|www\./i.test(candidate)) return { valid: false, reason: 'url' };
  if (/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/.test(candidate)) {
    return { valid: false, reason: 'phone-number' };
  }
  if (SAFETY_PATTERNS.some((pattern) => pattern.test(candidate))) {
    return { valid: false, reason: 'safety' };
  }
  if (OPERATIONAL_CLAIM_PATTERNS.some((pattern) => pattern.test(candidate))) {
    return { valid: false, reason: 'operational-claim' };
  }
  return { valid: true, text: candidate, normalized };
}

function parseCandidateResponse(value) {
  let parsed = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch (_error) {
      throw new Error('The generation provider did not return valid JSON.');
    }
  }
  if (!parsed || !Array.isArray(parsed.candidates)) {
    throw new Error('The generation provider response must contain a candidates list.');
  }
  return parsed.candidates.map((candidate) => (
    typeof candidate === 'string' ? candidate : candidate && candidate.text
  ));
}

function buildGenerationPrompt({
  personality,
  surface,
  styleExamples,
  count,
  recentMessages = [],
  direction = null
}) {
  return {
    promptVersion: PROMPT_VERSION,
    task: `Write ${count} new opening message${count === 1 ? '' : 's'} for ${surface.name}.`,
    personality: {
      name: personality.name,
      description: personality.description,
      generationGuidance: personality.generationGuidance
    },
    surface: {
      id: surface.id,
      purpose: surface.purpose,
      allowedTokens: surface.allowedTokens,
      maximumLength: surface.maxLength
    },
    styleExamples,
    recentMessagesToAvoid: recentMessages,
    boundedDirection: direction || null,
    permanentConstraints: PERMANENT_CONSTRAINTS,
    responseShape: {
      candidates: ['message text only']
    }
  };
}

class GenericJsonGenerationProvider {
  constructor({
    url = process.env.MESSAGE_GENERATION_URL,
    apiKey = process.env.MESSAGE_GENERATION_API_KEY,
    name = process.env.MESSAGE_GENERATION_PROVIDER || 'generic-json',
    version = process.env.MESSAGE_GENERATION_MODEL || 'configured'
  } = {}) {
    this.url = url;
    this.apiKey = apiKey;
    this.name = name;
    this.version = version;
  }

  get enabled() {
    return Boolean(this.url && this.apiKey);
  }

  async generate(prompt) {
    if (!this.enabled) {
      throw new Error('Live message generation is disabled because no provider credentials are configured.');
    }
    const response = await fetch(this.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        prompt,
        responseFormat: { type: 'json_object' }
      }),
      signal: AbortSignal.timeout(45000)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error?.message || payload.error || `Generation failed with HTTP ${response.status}.`);
    }
    return parseCandidateResponse(payload.output || payload.result || payload);
  }
}

class DeterministicFakeGenerationProvider {
  constructor(candidates = ['The group chat has been spared another follow-up.']) {
    this.candidates = candidates.slice();
    this.name = 'deterministic-fake';
    this.version = '1';
    this.enabled = true;
  }

  async generate(prompt) {
    const count = Number(String(prompt.task).match(/\d+/)?.[0]) || this.candidates.length;
    return Array.from({ length: count }, (_value, index) => (
      this.candidates[index % this.candidates.length]
    ));
  }
}

function configuredProvider() {
  if (process.env.MESSAGE_GENERATION_FAKE === '1') {
    return new DeterministicFakeGenerationProvider([
      'The court needed an answer, not a character arc.',
      'A decision has occurred. Alert the group chat.',
      'You responded before the follow-up text. Growth.'
    ]);
  }
  return new GenericJsonGenerationProvider();
}

function providerStatus(provider = configuredProvider()) {
  return {
    enabled: provider.enabled === true,
    name: provider.name,
    version: provider.version,
    live: provider instanceof GenericJsonGenerationProvider && provider.enabled === true,
    reason: provider.enabled
      ? null
      : 'No generation provider URL and API key are configured. Stored messages and legacy fallbacks remain active.'
  };
}

function statusAssetName(personalityId, surfaceId) {
  return `message-generation-status:${personalityId}:${surfaceId}`;
}

async function saveGenerationStatus(personalityId, surfaceId, status) {
  await saveDevAsset(
    statusAssetName(personalityId, surfaceId),
    JSON.stringify({ ...status, updatedAt: new Date().toISOString() })
  );
}

async function getGenerationStatus(personalityId, surfaceId) {
  const asset = await getDevAsset(statusAssetName(personalityId, surfaceId));
  if (!asset) return null;
  try {
    return JSON.parse(asset.content);
  } catch (_error) {
    return null;
  }
}

async function generateFreshMessages({
  database = MESSAGE_STORE,
  provider = configuredProvider(),
  personalityId,
  surfaceId,
  count,
  direction = null,
  targetRuleId = null
}) {
  const surface = getMessageSurface(surfaceId);
  if (!surface) throw new Error('Unknown message surface.');
  const personality = await database.getPersonality(personalityId);
  if (!personality?.enabled) throw new Error('That personality is not enabled.');
  const setting = await database.getSurfaceSetting(personalityId, surfaceId);
  if (!setting?.enabled) throw new Error('That message surface is not enabled.');
  if (!provider.enabled) {
    throw new Error(providerStatus(provider).reason);
  }

  const inventory = await database.listRandomizerMessages({ personalityId });
  const styleExamples = inventory
    .filter((message) => message.locked && message.vetted)
    .map((message) => ({ surfaceId: message.surfaceId, text: message.text }));
  const recentMessages = inventory
    .filter((message) => message.source === 'generated')
    .slice(0, 100)
    .map((message) => message.text);
  const prompt = buildGenerationPrompt({
    personality,
    surface,
    styleExamples,
    count,
    recentMessages,
    direction
  });
  const rawCandidates = await provider.generate(prompt);
  const existingNormalized = new Set(inventory.map((message) => message.normalizedText));
  const archivedNormalized = new Set(
    inventory.filter((message) => message.status === 'archived').map((message) => message.normalizedText)
  );
  const accepted = [];
  const rejected = [];
  for (const candidate of rawCandidates) {
    const result = validateGeneratedCandidate(candidate, {
      surface,
      existingNormalized,
      archivedNormalized
    });
    if (!result.valid || existingNormalized.has(result.normalized)) {
      rejected.push({ text: String(candidate || ''), reason: result.reason || 'duplicate' });
      continue;
    }
    existingNormalized.add(result.normalized);
    accepted.push(await database.createRandomizerMessage({
      personalityId,
      surfaceId,
      text: result.text,
      source: 'generated',
      status: setting.autoPublishGenerated && surface.autoPublishEligible ? 'active' : 'draft',
      locked: false,
      vetted: false,
      targetRuleId,
      generationDirection: direction,
      generatorName: provider.name,
      generatorVersion: provider.version,
      promptVersion: PROMPT_VERSION
    }));
  }
  return {
    accepted,
    rejected,
    promptVersion: PROMPT_VERSION,
    provider: providerStatus(provider),
    styleExampleCount: styleExamples.length
  };
}

async function runGenerationJob(options) {
  const key = `${options.personalityId}:${options.surfaceId}:${options.targetRuleId || 'general'}`;
  if (generationFlights.has(key)) return generationFlights.get(key);
  const blockedUntil = failureBackoff.get(key) || 0;
  if (Date.now() < blockedUntil) {
    throw new Error('Generation is temporarily paused after a provider failure.');
  }
  const flight = (async () => {
    await saveGenerationStatus(options.personalityId, options.surfaceId, {
      state: 'running',
      startedAt: new Date().toISOString(),
      targetRuleId: options.targetRuleId || null
    });
    try {
      const result = await generateFreshMessages(options);
      failureBackoff.delete(key);
      await saveGenerationStatus(options.personalityId, options.surfaceId, {
        state: 'succeeded',
        lastSuccessAt: new Date().toISOString(),
        accepted: result.accepted.length,
        rejected: result.rejected.length,
        targetRuleId: options.targetRuleId || null
      });
      return result;
    } catch (error) {
      failureBackoff.set(key, Date.now() + 60_000);
      await saveGenerationStatus(options.personalityId, options.surfaceId, {
        state: 'failed',
        lastFailureAt: new Date().toISOString(),
        failureReason: error.message,
        targetRuleId: options.targetRuleId || null
      }).catch(() => {});
      throw error;
    } finally {
      generationFlights.delete(key);
    }
  })();
  generationFlights.set(key, flight);
  return flight;
}

function queuePoolRefill({
  database = MESSAGE_STORE,
  personalityId,
  surfaceId
}) {
  if (process.env.MESSAGE_AUTO_GENERATION_ENABLED !== '1') return false;
  setImmediate(async () => {
    try {
      const [personality, setting, messages] = await Promise.all([
        database.getPersonality(personalityId),
        database.getSurfaceSetting(personalityId, surfaceId),
        database.listRandomizerMessages({
          personalityId,
          surfaceId,
          status: 'active',
          targetRuleId: null
        })
      ]);
      if (!personality?.enabled || !setting?.enabled) return;
      const minimum = setting.freshPoolMinimumOverride == null
        ? personality.freshPoolMinimum
        : setting.freshPoolMinimumOverride;
      const fresh = messages.filter((message) => (
        !message.locked &&
        message.source === 'generated' &&
        message.usageCount === 0
      ));
      if (fresh.length >= minimum) return;
      await runGenerationJob({
        database,
        personalityId,
        surfaceId,
        count: personality.generationBatchSize
      });
    } catch (error) {
      console.error(`Background message refill failed for ${surfaceId}:`, error.message);
    }
  });
  return true;
}

module.exports = {
  PROMPT_VERSION,
  PERMANENT_CONSTRAINTS,
  extractTokens,
  validateGeneratedCandidate,
  parseCandidateResponse,
  buildGenerationPrompt,
  GenericJsonGenerationProvider,
  DeterministicFakeGenerationProvider,
  configuredProvider,
  providerStatus,
  getGenerationStatus,
  generateFreshMessages,
  runGenerationJob,
  queuePoolRefill
};
