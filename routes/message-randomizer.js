const {
  MESSAGE_SURFACES,
  getMessageSurface
} = require('../message-surfaces');
const {
  providerStatus,
  getGenerationStatus,
  runGenerationJob
} = require('../services/message-generation');
const { resolveRandomizedMessage } = require('../services/message-randomizer');
// Two reads that are not message-randomizer rows: the protected master roster a target rule
// has to name a player from, and the game a public /api/random-message call is about.
const { getDeveloperRosterSources } = require('../database/dev-rosters');
const { getGame } = require('../database/games');
const { formatPhoneNumber } = require('../utils/sms-format');
const {
  buildDeveloperRosters
} = require('../utils/dev-rosters');
const {
  DEFAULT_CODEX_PROMPT_SECTIONS,
  CODEX_PROMPT_PLACEHOLDERS
} = require('../codex-message-prompts');

const PERSONALITY_FIELDS = new Set([
  'name',
  'description',
  'generationGuidance',
  'enabled',
  'isDefault',
  'lockedPercent',
  'freshPoolMinimum',
  'generationBatchSize'
]);
const MESSAGE_SOURCES = new Set(['migrated', 'manual', 'generated']);
const MESSAGE_STATUSES = new Set(['draft', 'active', 'archived']);
const TRIGGER_STATUSES = new Set(['confirmed', 'waitlisted', 'applicant', 'out', 'any-known']);
const AUDIENCES = new Set(['target-only', 'confirmed', 'known-game-audience', 'invitation-copy']);
const RULE_MODES = new Set(['exact', 'direction']);
const ALL_MESSAGE_CATEGORIES = 'all';
const MAX_CODEX_PROMPT_SECTION_LENGTH = 12000;
const MAX_CODEX_PROMPT_TOTAL_LENGTH = 60000;

function sendValidationError(res, error) {
  return res.status(400).json({ error });
}

function validatePercent(value, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 100) {
    return `${name} must be a whole number from 0 through 100.`;
  }
  return null;
}

function validatePersonalityUpdate(body = {}) {
  for (const field of Object.keys(body)) {
    if (field !== 'surfaces' && !PERSONALITY_FIELDS.has(field)) {
      return { error: `Unknown personality field: ${field}.` };
    }
  }
  if (body.name !== undefined && !String(body.name).trim()) {
    return { error: 'Personality name is required.' };
  }
  if (body.description !== undefined && String(body.description).trim().length > 2000) {
    return { error: 'Personality description can contain up to 2,000 characters.' };
  }
  if (
    body.generationGuidance !== undefined &&
    String(body.generationGuidance).trim().length > 5000
  ) {
    return { error: 'Generation guidance can contain up to 5,000 characters.' };
  }
  if (body.lockedPercent !== undefined) {
    const error = validatePercent(body.lockedPercent, 'Locked percent');
    if (error) return { error };
  }
  for (const field of ['freshPoolMinimum', 'generationBatchSize']) {
    if (body[field] !== undefined) {
      const value = Number(body[field]);
      if (!Number.isInteger(value) || value < (field === 'generationBatchSize' ? 1 : 0) || value > 500) {
        return { error: `${field} is outside the supported range.` };
      }
    }
  }
  if (body.enabled === false && body.isDefault === true) {
    return { error: 'The default personality must be enabled.' };
  }
  const surfaces = body.surfaces || {};
  for (const [surfaceId, fields] of Object.entries(surfaces)) {
    if (!getMessageSurface(surfaceId)) return { error: `Unknown surface: ${surfaceId}.` };
    if (fields.lockedPercentOverride !== null && fields.lockedPercentOverride !== undefined) {
      const error = validatePercent(fields.lockedPercentOverride, `${surfaceId} locked percent`);
      if (error) return { error };
    }
    if (
      fields.freshPoolMinimumOverride !== null &&
      fields.freshPoolMinimumOverride !== undefined &&
      (!Number.isInteger(Number(fields.freshPoolMinimumOverride)) ||
       Number(fields.freshPoolMinimumOverride) < 0)
    ) {
      return { error: `${surfaceId} fresh minimum must be zero or more.` };
    }
  }
  return { fields: body, surfaces };
}

function validateMessage(databaseMessage, body = {}, { creating = false } = {}) {
  const personalityId = creating ? String(body.personalityId || '') : databaseMessage.personalityId;
  const surfaceId = creating ? String(body.surfaceId || '') : databaseMessage.surfaceId;
  const text = body.text === undefined ? databaseMessage?.text : String(body.text).trim();
  const surface = getMessageSurface(surfaceId);
  if (!personalityId) return { error: 'Personality is required.' };
  if (!surface) return { error: 'Choose a known message surface.' };
  if (!text || text.length > surface.maxLength) {
    return { error: `Message text must be between 1 and ${surface.maxLength} characters.` };
  }
  const tokens = [...text.matchAll(/\{([A-Z][A-Z0-9_]*)\}/g)].map((match) => match[1]);
  const allowed = new Set(surface.allowedTokens || []);
  const unsupported = tokens.filter((token) => !allowed.has(token));
  if (unsupported.length) {
    return { error: `Unsupported value: {${unsupported[0]}}.` };
  }
  const source = body.source === undefined
    ? (databaseMessage?.source || 'manual')
    : body.source;
  const status = body.status === undefined
    ? (databaseMessage?.status || 'draft')
    : body.status;
  if (!MESSAGE_SOURCES.has(source)) return { error: 'Unknown message source.' };
  if (!MESSAGE_STATUSES.has(status)) return { error: 'Unknown message status.' };
  return {
    fields: {
      personalityId,
      surfaceId,
      text,
      source,
      status,
      locked: body.locked === undefined ? Boolean(databaseMessage?.locked) : body.locked === true,
      vetted: body.vetted === undefined ? Boolean(databaseMessage?.vetted) : body.vetted === true,
      generationDirection: body.generationDirection === undefined
        ? databaseMessage?.generationDirection
        : String(body.generationDirection || '').trim() || null
    }
  };
}

function effectiveCodexPrompts(savedPrompts) {
  const savedBySurface = new Map(savedPrompts.map((prompt) => [prompt.surfaceId, prompt]));
  return MESSAGE_SURFACES.map((surface) => {
    const saved = savedBySurface.get(surface.id);
    return {
      surfaceId: surface.id,
      sections: saved?.sections || [...DEFAULT_CODEX_PROMPT_SECTIONS],
      customized: Boolean(saved?.sections),
      updatedAt: saved?.updatedAt || null
    };
  });
}

function validateCodexPromptUpdate(body = {}) {
  const personalityId = String(body.personalityId || '').trim();
  const surfaceId = String(body.surfaceId || '').trim();
  const isAll = surfaceId === ALL_MESSAGE_CATEGORIES;
  if (!personalityId) return { error: 'Personality is required.' };
  if (!isAll && !getMessageSurface(surfaceId)) {
    return { error: 'Choose a known message category or all message categories.' };
  }
  if (!Array.isArray(body.sections) || body.sections.length !== DEFAULT_CODEX_PROMPT_SECTIONS.length) {
    return { error: `The prompt must contain ${DEFAULT_CODEX_PROMPT_SECTIONS.length} numbered paragraphs.` };
  }
  const sections = body.sections.map((section) => {
    if (isAll && section === null) return null;
    return String(section == null ? '' : section).trim();
  });
  if (!isAll && sections.some((section) => !section)) {
    return { error: 'Every numbered paragraph needs prompt text.' };
  }
  if (isAll && sections.some((section) => section !== null && !section)) {
    return { error: 'A shared numbered paragraph cannot be blank.' };
  }
  if (isAll && sections.every((section) => section === null)) {
    return { error: 'Change at least one paragraph before saving all message categories.' };
  }
  const oversized = sections.find(
    (section) => section !== null && section.length > MAX_CODEX_PROMPT_SECTION_LENGTH
  );
  if (oversized) {
    return { error: `Each prompt paragraph can contain up to ${MAX_CODEX_PROMPT_SECTION_LENGTH.toLocaleString()} characters.` };
  }
  const totalLength = sections.reduce(
    (total, section) => total + (section === null ? 0 : section.length),
    0
  );
  if (totalLength > MAX_CODEX_PROMPT_TOTAL_LENGTH) {
    return { error: `Prompt text can contain up to ${MAX_CODEX_PROMPT_TOTAL_LENGTH.toLocaleString()} characters.` };
  }
  const sharedParagraphIndexes = [...new Set(
    Array.isArray(body.sharedParagraphIndexes) ? body.sharedParagraphIndexes : []
  )];
  if (sharedParagraphIndexes.some(
    (index) => !Number.isInteger(index) || index < 0 || index >= sections.length
  )) {
    return { error: 'Choose known numbered paragraphs to share across message categories.' };
  }
  return { personalityId, surfaceId, isAll, sections, sharedParagraphIndexes };
}

async function saveCodexPromptUpdate(database, validation) {
  const saved = effectiveCodexPrompts(
    await database.listCodexPrompts(validation.personalityId)
  );
  const bySurface = new Map(saved.map((prompt) => [prompt.surfaceId, prompt]));
  const updates = new Map();

  if (validation.isAll) {
    for (const surface of MESSAGE_SURFACES) {
      const current = bySurface.get(surface.id);
      updates.set(surface.id, current.sections.map(
        (section, index) => validation.sections[index] === null
          ? section
          : validation.sections[index]
      ));
    }
  } else {
    updates.set(validation.surfaceId, validation.sections);
    for (const index of validation.sharedParagraphIndexes) {
      for (const surface of MESSAGE_SURFACES) {
        const current = updates.get(surface.id) || [...bySurface.get(surface.id).sections];
        current[index] = validation.sections[index];
        updates.set(surface.id, current);
      }
    }
  }

  await database.saveCodexPrompts(
    validation.personalityId,
    [...updates].map(([surfaceId, sections]) => ({ surfaceId, sections }))
  );
  return effectiveCodexPrompts(
    await database.listCodexPrompts(validation.personalityId)
  );
}

async function validateTargetRule(database, body = {}, existing = null) {
  const fields = {
    personalityId: body.personalityId ?? existing?.personalityId,
    targetPhone: formatPhoneNumber(body.targetPhone ?? existing?.targetPhone),
    targetDisplayName: String(body.targetDisplayName ?? existing?.targetDisplayName ?? '').trim(),
    gameId: String(body.gameId ?? existing?.gameId ?? '').trim() || null,
    triggerStatus: body.triggerStatus ?? existing?.triggerStatus,
    surfaceId: body.surfaceId ?? existing?.surfaceId,
    audience: body.audience ?? existing?.audience,
    mode: body.mode ?? existing?.mode,
    exactText: String(body.exactText ?? existing?.exactText ?? '').trim() || null,
    generationDirection:
      String(body.generationDirection ?? existing?.generationDirection ?? '').trim() || null,
    enabled: body.enabled === undefined ? Boolean(existing?.enabled) : body.enabled === true,
    startsAt: body.startsAt === undefined ? existing?.startsAt : (body.startsAt || null),
    endsAt: body.endsAt === undefined ? existing?.endsAt : (body.endsAt || null)
  };
  if (!fields.personalityId) return { error: 'Personality is required.' };
  if (fields.targetPhone.length !== 10) return { error: 'Choose a player with a valid phone number.' };
  const directory = buildDeveloperRosters(await getDeveloperRosterSources());
  const player = directory.players.find((candidate) => candidate.phone === fields.targetPhone);
  if (!player) return { error: 'Choose a player from the protected master roster.' };
  fields.targetDisplayName = player.name || fields.targetDisplayName;
  if (!TRIGGER_STATUSES.has(fields.triggerStatus)) return { error: 'Choose a trigger status.' };
  if (!getMessageSurface(fields.surfaceId)) return { error: 'Choose a known message surface.' };
  if (!AUDIENCES.has(fields.audience)) return { error: 'Choose a supported audience.' };
  if (!RULE_MODES.has(fields.mode)) return { error: 'Choose exact copy or a generation direction.' };
  if (fields.mode === 'exact' && !fields.exactText) return { error: 'Enter the exact target copy.' };
  if (fields.mode === 'direction' && !fields.generationDirection) {
    return { error: 'Enter a bounded generation direction.' };
  }
  const surface = getMessageSurface(fields.surfaceId);
  if (fields.exactText && fields.exactText.length > surface.maxLength) {
    return { error: `Exact copy can contain up to ${surface.maxLength} characters.` };
  }
  if (fields.exactText) {
    const allowed = new Set(surface.allowedTokens || []);
    const unsupported = [...fields.exactText.matchAll(/\{([A-Z][A-Z0-9_]*)\}/g)]
      .map((match) => match[1])
      .find((token) => !allowed.has(token));
    if (unsupported) return { error: `Unsupported value: {${unsupported}}.` };
  }
  if (fields.generationDirection && fields.generationDirection.length > 1000) {
    return { error: 'Generation direction can contain up to 1,000 characters.' };
  }
  if (fields.startsAt && !Number.isFinite(Date.parse(fields.startsAt))) {
    return { error: 'Start time is invalid.' };
  }
  if (fields.endsAt && !Number.isFinite(Date.parse(fields.endsAt))) {
    return { error: 'End time is invalid.' };
  }
  if (fields.startsAt && fields.endsAt && Date.parse(fields.startsAt) >= Date.parse(fields.endsAt)) {
    return { error: 'End time must be after start time.' };
  }
  return { fields };
}

// Surfaces a public page may read. Everything else (SMS categories, drafts)
// stays behind Developer authentication.
const PUBLIC_RANDOM_MESSAGE_SURFACES = new Set([
  'site-slogan',
  'game-details',
  'youre-in',
  'empty-my-games',
  'empty-roster',
  'post-create-success'
]);

function mountPublicRandomizerRoutes(app) {
  const database = require('../database/message-randomizer');

  app.get('/api/message-personalities', async (_req, res) => {
    try {
      const personalities = await database.listPersonalities({ enabledOnly: true });
      res.json({
        personalities: personalities.map(({ id, name, description, isDefault }) => ({
          id,
          name,
          description,
          isDefault
        }))
      });
    } catch (error) {
      res.json({
        personalities: [{
          id: 'realist',
          name: 'Realist',
          description: 'Short, direct, dryly funny copy.',
          isDefault: true
        }]
      });
    }
  });

  app.get('/api/random-message', async (req, res) => {
    const surfaceId = String(req.query.surface || '');
    if (!PUBLIC_RANDOM_MESSAGE_SURFACES.has(surfaceId)) {
      return res.status(400).json({ error: 'That message surface is not available here.' });
    }
    const exclude = String(req.query.exclude || '').split(',').filter(Boolean).slice(0, 50);
    const fallbackText = String(req.query.fallback || '');
    const gameId = String(req.query.gameId || '').trim() || null;
    const game = gameId ? await getGame(gameId).catch(() => null) : null;
    const result = await resolveRandomizedMessage({
      database,
      personalityId: req.query.personality || game?.personalityId || null,
      surfaceId,
      game,
      gameId,
      templateValues: { NAME: req.query.name || '' },
      fallbackText,
      excludedMessageIds: exclude
    });
    res.json({
      id: result.messageId,
      text: result.text,
      personalityId: result.personalityId,
      sourceBucket: result.sourceBucket
    });
  });
}

function mountDevRandomizerRoutes(app, requireDevAuth) {
  const database = require('../database/message-randomizer');

  app.get('/api/dev/message-randomizer', requireDevAuth, async (_req, res) => {
    try {
      const personalities = await database.listPersonalities();
      const rosterSources = await getDeveloperRosterSources();
      const payload = [];
      for (const personality of personalities) {
        const [settings, metrics, savedCodexPrompts] = await Promise.all([
          database.listSurfaceSettings(personality.id),
          database.getRandomizerMetrics(personality.id),
          database.listCodexPrompts(personality.id)
        ]);
        const generationStatuses = await Promise.all(
          MESSAGE_SURFACES.map((surface) => (
            getGenerationStatus(personality.id, surface.id)
          ))
        );
        const settingBySurface = new Map(settings.map((setting) => [setting.surfaceId, setting]));
        const codexPromptBySurface = new Map(
          effectiveCodexPrompts(savedCodexPrompts).map((prompt) => [prompt.surfaceId, prompt])
        );
        payload.push({
          ...personality,
          surfaces: MESSAGE_SURFACES.map((surface, index) => ({
            ...surface,
            setting: settingBySurface.get(surface.id),
            metrics: metrics.surfaces[surface.id],
            generationStatus: generationStatuses[index],
            codexPrompt: codexPromptBySurface.get(surface.id)
          }))
        });
      }
      res.json({
        personalities: payload,
        exampleGames: rosterSources.games.map((record) => ({
          gameId: record.gameId,
          location: record.data.location,
          date: record.data.date,
          time: record.data.time,
          totalPlayers: record.data.totalPlayers,
          personalityId: record.data.personalityId || null,
          players: record.data.players || [],
          waitlist: record.data.waitlist || [],
          applicants: record.data.applicants || [],
          outPlayers: record.data.outPlayers || [],
          invitedPlayers: record.data.invitedPlayers || []
        })).slice(0, 100),
        provider: providerStatus(),
        rollout: {
          randomizerEnabled: process.env.MESSAGE_RANDOMIZER_ENABLED !== '0',
          freshSelectionEnabled: process.env.MESSAGE_FRESH_SELECTION_ENABLED !== '0',
          autoGenerationEnabled: process.env.MESSAGE_AUTO_GENERATION_ENABLED === '1'
        },
        codexPromptPlaceholders: CODEX_PROMPT_PLACEHOLDERS
      });
    } catch (error) {
      console.error('Error loading Message Randomizer:', error);
      res.status(500).json({ error: 'Could not load the Message Randomizer.' });
    }
  });

  app.put('/api/dev/message-codex-prompts', requireDevAuth, async (req, res) => {
    const validation = validateCodexPromptUpdate(req.body);
    if (validation.error) return sendValidationError(res, validation.error);
    try {
      const personality = await database.getPersonality(validation.personalityId);
      if (!personality) return res.status(404).json({ error: 'Personality not found.' });
      const prompts = await saveCodexPromptUpdate(database, validation);
      res.json({ success: true, prompts });
    } catch (error) {
      console.error('Error saving Codex message prompts:', error);
      res.status(500).json({ error: 'Could not save the Codex message prompts.' });
    }
  });

  app.put('/api/dev/message-personalities/:id', requireDevAuth, async (req, res) => {
    const validation = validatePersonalityUpdate(req.body);
    if (validation.error) return sendValidationError(res, validation.error);
    try {
      const personality = await database.updatePersonality(req.params.id, validation.fields);
      if (!personality) return res.status(404).json({ error: 'Personality not found.' });
      for (const [surfaceId, fields] of Object.entries(validation.surfaces)) {
        await database.updateSurfaceSetting(req.params.id, surfaceId, fields);
      }
      res.json({
        success: true,
        personality,
        surfaces: await database.listSurfaceSettings(req.params.id)
      });
    } catch (error) {
      console.error('Error saving personality:', error);
      const validationFailure = /default personality|enabled default/i.test(error.message);
      res.status(validationFailure ? 400 : 500).json({
        error: validationFailure ? error.message : 'Could not save the personality.'
      });
    }
  });

  app.get('/api/dev/randomizer-messages', requireDevAuth, async (req, res) => {
    try {
      const filters = {
        personalityId: req.query.personalityId || undefined,
        surfaceId: req.query.surfaceId || undefined,
        source: req.query.source || undefined,
        status: req.query.status || undefined
      };
      if (req.query.locked === 'true' || req.query.locked === 'false') {
        filters.locked = req.query.locked === 'true';
      }
      res.json({ messages: await database.listRandomizerMessages(filters) });
    } catch (error) {
      res.status(500).json({ error: 'Could not load the message library.' });
    }
  });

  app.post('/api/dev/randomizer-messages', requireDevAuth, async (req, res) => {
    const validation = validateMessage(null, req.body, { creating: true });
    if (validation.error) return sendValidationError(res, validation.error);
    try {
      const message = await database.createRandomizerMessage(validation.fields);
      res.status(201).json({ success: true, message });
    } catch (error) {
      const duplicate = /unique|duplicate/i.test(error.message);
      res.status(duplicate ? 409 : 500).json({
        error: duplicate ? 'That message is already in this surface.' : 'Could not create the message.'
      });
    }
  });

  app.put('/api/dev/randomizer-messages/:id', requireDevAuth, async (req, res) => {
    try {
      const existing = await database.getRandomizerMessage(req.params.id);
      if (!existing) return res.status(404).json({ error: 'Message not found.' });
      const validation = validateMessage(existing, req.body);
      if (validation.error) return sendValidationError(res, validation.error);
      const message = await database.updateRandomizerMessage(req.params.id, validation.fields);
      res.json({ success: true, message });
    } catch (error) {
      const duplicate = /unique|duplicate/i.test(error.message);
      res.status(duplicate ? 409 : 500).json({
        error: duplicate ? 'That message is already in this surface.' : 'Could not update the message.'
      });
    }
  });

  app.post('/api/dev/message-generation', requireDevAuth, async (req, res) => {
    const personalityId = String(req.body?.personalityId || '');
    const surfaceId = String(req.body?.surfaceId || '');
    const surface = getMessageSurface(surfaceId);
    const count = Math.min(Math.max(Number(req.body?.count) || 1, 1), 50);
    if (!personalityId || !surface) return sendValidationError(res, 'Choose a personality and surface.');
    try {
      const targetRuleId = req.body?.targetRuleId || null;
      let direction = String(req.body?.direction || '').trim() || null;
      if (targetRuleId) {
        const rule = await database.getTargetRule(targetRuleId);
        if (!rule || rule.personalityId !== personalityId || rule.surfaceId !== surfaceId) {
          return sendValidationError(res, 'That target rule does not match this generation request.');
        }
        direction = rule.generationDirection;
      }
      const result = await runGenerationJob({
        database,
        personalityId,
        surfaceId,
        count,
        direction,
        targetRuleId
      });
      res.json({ success: true, ...result });
    } catch (error) {
      res.status(503).json({ error: error.message });
    }
  });

  app.get('/api/dev/message-generation/status', requireDevAuth, async (req, res) => {
    const personalityId = String(req.query.personalityId || 'realist');
    const statuses = {};
    for (const surface of MESSAGE_SURFACES) {
      statuses[surface.id] = await getGenerationStatus(personalityId, surface.id);
    }
    res.json({ provider: providerStatus(), statuses });
  });

  app.get('/api/dev/message-target-rules', requireDevAuth, async (req, res) => {
    try {
      res.json({
        rules: await database.listTargetRules({
          personalityId: req.query.personalityId || undefined,
          surfaceId: req.query.surfaceId || undefined
        }),
        roster: buildDeveloperRosters(await getDeveloperRosterSources()).players
      });
    } catch (error) {
      res.status(500).json({ error: 'Could not load target rules.' });
    }
  });

  app.post('/api/dev/message-target-rules', requireDevAuth, async (req, res) => {
    try {
      const validation = await validateTargetRule(database, req.body);
      if (validation.error) return sendValidationError(res, validation.error);
      const rule = await database.createTargetRule(validation.fields);
      res.status(201).json({ success: true, rule });
    } catch (error) {
      res.status(500).json({ error: 'Could not create the target rule.' });
    }
  });

  app.put('/api/dev/message-target-rules/:id', requireDevAuth, async (req, res) => {
    try {
      const existing = await database.getTargetRule(req.params.id);
      if (!existing) return res.status(404).json({ error: 'Target rule not found.' });
      const validation = await validateTargetRule(database, req.body, existing);
      if (validation.error) return sendValidationError(res, validation.error);
      const rule = await database.updateTargetRule(req.params.id, validation.fields);
      res.json({ success: true, rule });
    } catch (error) {
      res.status(500).json({ error: 'Could not update the target rule.' });
    }
  });

  app.delete('/api/dev/message-target-rules/:id', requireDevAuth, async (req, res) => {
    try {
      const removed = await database.deleteTargetRule(req.params.id);
      if (!removed) return res.status(404).json({ error: 'Target rule not found.' });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Could not delete the target rule.' });
    }
  });

  app.post('/api/dev/message-randomizer/preview', requireDevAuth, async (req, res) => {
    const surfaceId = String(req.body?.surfaceId || '');
    if (!getMessageSurface(surfaceId)) return sendValidationError(res, 'Choose a known surface.');
    try {
      const result = await resolveRandomizedMessage({
        database,
        personalityId: req.body?.personalityId || null,
        surfaceId,
        game: req.body?.game || null,
        gameId: req.body?.gameId || null,
        recipientPhone: req.body?.recipientPhone || null,
        templateValues: req.body?.templateValues || {},
        deterministicDetails: String(req.body?.deterministicDetails || ''),
        fallbackText: String(req.body?.fallbackText || ''),
        audience: req.body?.useTargetRules === false
          ? '__disabled__'
          : (req.body?.audience || 'target-only'),
        preview: true
      });
      res.json({
        ...result,
        characterCount: result.text.length
      });
    } catch (error) {
      res.status(500).json({ error: 'Could not build the preview.' });
    }
  });

  app.get('/api/dev/message-randomizer/metrics', requireDevAuth, async (req, res) => {
    try {
      res.json(await database.getRandomizerMetrics(req.query.personalityId || 'realist'));
    } catch (error) {
      res.status(500).json({ error: 'Could not load Message Randomizer metrics.' });
    }
  });
}

module.exports = {
  validatePersonalityUpdate,
  validateMessage,
  validateCodexPromptUpdate,
  effectiveCodexPrompts,
  saveCodexPromptUpdate,
  validateTargetRule,
  mountPublicRandomizerRoutes,
  mountDevRandomizerRoutes,
  PUBLIC_RANDOM_MESSAGE_SURFACES
};
