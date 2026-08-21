const { getMessageSurface } = require('../message-surfaces');
const { formatPhoneNumber } = require('../utils/sms-format');

const SOURCE_BUCKETS = Object.freeze([
  'exact-target',
  'directed-target',
  'locked',
  'fresh',
  'fallback'
]);

function renderSupportedTokens(text, values = {}, surface) {
  const allowed = new Set(surface.allowedTokens || []);
  const normalized = {};
  Object.entries(values).forEach(([key, value]) => {
    normalized[String(key).toUpperCase()] = value == null ? '' : String(value);
  });
  return String(text).replace(/\{([A-Z][A-Z0-9_]*)\}/g, (token, key) => {
    if (!allowed.has(key)) return token;
    return Object.prototype.hasOwnProperty.call(normalized, key) ? normalized[key] : token;
  });
}

function joinMessageSections(opening, details) {
  return [opening, details]
    .map((section) => String(section == null ? '' : section).trim())
    .filter(Boolean)
    .join('\n\n');
}

function chooseScheduledBucket(history, lockedPercent) {
  const percent = Math.min(Math.max(Number(lockedPercent) || 0, 0), 100);
  const relevant = history.filter((event) => event.sourceBucket === 'locked' || event.sourceBucket === 'fresh');
  const lockedCount = relevant.filter((event) => event.sourceBucket === 'locked').length;
  const targetLockedAfterNext = ((relevant.length + 1) * percent) / 100;
  return lockedCount < targetLockedAfterNext ? 'locked' : 'fresh';
}

function selectNoRepeat(messages, excludedIds = [], recentEvents = [], random = Math.random) {
  if (!messages.length) return null;
  const excluded = new Set(excludedIds);
  const recentOrder = recentEvents
    .map((event) => event.messageId)
    .filter(Boolean);
  const recent = new Set(recentOrder);
  const unused = messages.filter((message) => !excluded.has(message.id) && !recent.has(message.id));
  const browserEligible = messages.filter((message) => !excluded.has(message.id));
  const pool = unused.length ? unused : (browserEligible.length ? browserEligible : messages);
  if (!unused.length && recentOrder.length) {
    const age = new Map();
    recentOrder.forEach((id, index) => {
      if (!age.has(id)) age.set(id, index);
    });
    return pool.slice().sort((a, b) => (
      (age.get(b.id) ?? Number.MAX_SAFE_INTEGER) -
      (age.get(a.id) ?? Number.MAX_SAFE_INTEGER)
    ))[0];
  }
  const index = Math.min(
    Math.max(Math.floor(random() * pool.length), 0),
    pool.length - 1
  );
  return pool[index];
}

function gameIdentityState(game, phone) {
  const normalized = formatPhoneNumber(phone);
  if (!normalized || !game) return null;
  const groups = [
    ['confirmed', game.players],
    [game.registrationMode === 'waitlist' ? 'applicant' : 'waitlisted', game.waitlist],
    ['out', game.outPlayers],
    ['applicant', game.applicants],
    ['invited', game.invitedPlayers]
  ];
  for (const [status, entries] of groups) {
    if ((entries || []).some((entry) => formatPhoneNumber(entry && entry.phone) === normalized)) {
      return status;
    }
  }
  return null;
}

function triggerMatches(rule, targetState) {
  if (!targetState) return false;
  if (rule.triggerStatus === 'any-known') return true;
  return rule.triggerStatus === targetState;
}

function ruleMatchesContext(rule, {
  game,
  gameId,
  recipientPhone,
  audience = 'target-only',
  now = new Date()
}) {
  if (!rule.enabled || rule.audience !== audience) return false;
  if (rule.gameId && rule.gameId !== gameId) return false;
  const timestamp = now.getTime();
  if (rule.startsAt && Date.parse(rule.startsAt) > timestamp) return false;
  if (rule.endsAt && Date.parse(rule.endsAt) < timestamp) return false;

  const targetState = gameIdentityState(game, rule.targetPhone);
  if (!triggerMatches(rule, targetState)) return false;

  const recipient = formatPhoneNumber(recipientPhone);
  if (rule.audience === 'target-only') {
    return Boolean(recipient && recipient === formatPhoneNumber(rule.targetPhone));
  }
  if (rule.audience === 'confirmed') {
    if (!recipient) return targetState === 'confirmed';
    return gameIdentityState(game, recipient) === 'confirmed';
  }
  if (rule.audience === 'known-game-audience') {
    if (!recipient) return true;
    return Boolean(gameIdentityState(game, recipient));
  }
  if (rule.audience === 'invitation-copy') {
    return ['confirmed', 'waitlisted', 'out', 'applicant', 'invited'].includes(targetState);
  }
  return false;
}

async function resolvePersonalityId(database, requestedId, game) {
  const candidate = requestedId || game?.personalityId;
  if (candidate) {
    const personality = await database.getPersonality(candidate);
    if (personality?.enabled) return personality;
  }
  return database.getDefaultPersonality();
}

function fallbackResult(fallbackText, surfaceId, personalityId = null, error = null) {
  return {
    text: String(fallbackText == null ? '' : fallbackText),
    opening: '',
    details: String(fallbackText == null ? '' : fallbackText),
    messageId: null,
    personalityId,
    surfaceId,
    sourceBucket: 'fallback',
    locked: false,
    targetRuleId: null,
    fallbackText: String(fallbackText == null ? '' : fallbackText),
    error: error ? error.message : null
  };
}

async function resolveRandomizedMessage({
  database = require('../database/message-randomizer'),
  personalityId,
  surfaceId,
  game = null,
  gameId = null,
  recipientPhone = null,
  templateValues = {},
  deterministicDetails = '',
  fallbackText = '',
  audience = 'target-only',
  excludedMessageIds = [],
  preview = false,
  random = Math.random,
  now = new Date()
}) {
  const surface = getMessageSurface(surfaceId);
  if (!surface || process.env.MESSAGE_RANDOMIZER_ENABLED === '0') {
    return fallbackResult(fallbackText, surfaceId);
  }

  try {
    const personality = await resolvePersonalityId(database, personalityId, game);
    if (!personality) return fallbackResult(fallbackText, surfaceId);
    const setting = await database.getSurfaceSetting(personality.id, surfaceId);
    if (!setting?.enabled) return fallbackResult(fallbackText, surfaceId, personality.id);

    const resolvedGameId = gameId || game?.gameId || game?.id || null;
    const history = await database.getSelectionHistory({
      personalityId: personality.id,
      surfaceId,
      recipientPhone,
      gameId: recipientPhone ? null : resolvedGameId,
      limit: 500
    });
    const repeatHistory = surfaceId === 'site-slogan' ? [] : history;
    const rules = await database.listTargetRules({
      personalityId: personality.id,
      surfaceId,
      enabled: true
    });
    const matchingRules = rules.filter((rule) => ruleMatchesContext(rule, {
      game,
      gameId: resolvedGameId,
      recipientPhone,
      audience,
      now
    }));

    let selected = null;
    let sourceBucket = null;
    let targetRule = matchingRules.find((rule) => rule.mode === 'exact' && rule.exactText);
    let opening = '';

    if (targetRule) {
      opening = renderSupportedTokens(targetRule.exactText, templateValues, surface);
      sourceBucket = 'exact-target';
    } else {
      targetRule = matchingRules.find((rule) => rule.mode === 'direction');
      if (targetRule) {
        const directed = await database.listRandomizerMessages({
          personalityId: personality.id,
          surfaceId,
          status: 'active',
          targetRuleId: targetRule.id
        });
        selected = selectNoRepeat(directed, excludedMessageIds, repeatHistory, random);
        if (selected) sourceBucket = 'directed-target';
      }
    }

    if (!sourceBucket) {
      const inventory = (await database.listRandomizerMessages({
        personalityId: personality.id,
        surfaceId,
        status: 'active',
        targetRuleId: null
      })).filter((message) => message.targetRuleId == null);
      const locked = inventory.filter((message) => message.locked);
      const fresh = process.env.MESSAGE_FRESH_SELECTION_ENABLED === '0'
        ? []
        : inventory.filter((message) => !message.locked);
      const lockedPercent = setting.lockedPercentOverride == null
        ? personality.lockedPercent
        : setting.lockedPercentOverride;
      const preferredBucket = chooseScheduledBucket(history, lockedPercent);
      const preferred = preferredBucket === 'locked' ? locked : fresh;
      const alternate = preferredBucket === 'locked' ? fresh : locked;
      selected = selectNoRepeat(preferred, excludedMessageIds, repeatHistory, random);
      sourceBucket = preferredBucket;
      if (!selected) {
        selected = selectNoRepeat(alternate, excludedMessageIds, repeatHistory, random);
        sourceBucket = preferredBucket === 'locked' ? 'fresh' : 'locked';
      }
    }

    if (selected) {
      opening = renderSupportedTokens(selected.text, templateValues, surface);
    }
    if (!sourceBucket || (!opening && !surface.allowEmpty)) {
      const fallback = fallbackResult(fallbackText, surfaceId, personality.id);
      if (!preview) {
        await database.recordSelection({
          personalityId: personality.id,
          surfaceId,
          gameId: resolvedGameId,
          recipientPhone,
          sourceBucket: 'fallback'
        });
      }
      return fallback;
    }

    const finalText = deterministicDetails
      ? joinMessageSections(opening, deterministicDetails)
      : opening;
    const result = {
      text: finalText,
      opening,
      details: deterministicDetails,
      messageId: selected?.id || null,
      personalityId: personality.id,
      surfaceId,
      sourceBucket,
      locked: Boolean(selected?.locked),
      targetRuleId: targetRule?.id || null,
      fallbackText: String(fallbackText == null ? '' : fallbackText),
      error: null
    };
    if (!preview) {
      await database.recordSelection({
        messageId: result.messageId,
        personalityId: personality.id,
        surfaceId,
        gameId: resolvedGameId,
        recipientPhone,
        targetRuleId: result.targetRuleId,
        sourceBucket
      });
    }
    return result;
  } catch (error) {
    console.error(`Message Randomizer fallback for ${surfaceId}:`, error.message);
    return fallbackResult(fallbackText, surfaceId, personalityId, error);
  }
}

module.exports = {
  SOURCE_BUCKETS,
  renderSupportedTokens,
  joinMessageSections,
  chooseScheduledBucket,
  selectNoRepeat,
  gameIdentityState,
  ruleMatchesContext,
  resolveRandomizedMessage
};
