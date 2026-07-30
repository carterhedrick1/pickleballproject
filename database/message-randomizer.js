const crypto = require('crypto');
const {
  isProduction,
  withPgClient,
  sqliteAll,
  sqliteGet,
  sqliteRun
} = require('./context');
const { recipientHash } = require('./sms-events');
const { MESSAGE_SURFACES } = require('../message-surfaces');
const sloganModule = require('../public/js/slogans');
const youreInMessages = require('../youre-in-messages');

const REALIST_ID = 'realist';
const MIGRATION_ASSET_NAME = 'message-randomizer-migration-v1';
const VETTED_SLOGAN_REPAIR_ASSET_NAME = 'message-randomizer-vetted-slogans-v2';
const INVITATION_OPENING_DRAFT_ASSET_NAME = 'message-randomizer-invitation-openings-v1';
const GAME_DETAILS_DRAFT_ASSET_NAME = 'message-randomizer-game-details-v1';
const REALIST_INVITATION_OPENING_DRAFTS = Object.freeze([
  'A pickleball invitation has arrived. Your excuses may begin.',
  'A game is forming. Confidence remains optional.',
  'You were invited for your availability. Let’s not make this complicated.',
  'Your athletic future has narrowed to two buttons.',
  'Please consult your calendar, not your feelings.',
  'We found a court. Now we are finding out who can make a decision.',
  'Your presence is requested. Your scouting report was not.',
  'Pickleball is available. Athletic excellence remains optional.',
  'Here lies an opportunity to play pickleball and briefly feel athletic.',
  'An invitation, a calendar, and two possible answers. Stay focused.',
  'Pickleball wants a commitment. Nothing emotional, just scheduling.',
  'This invitation has fewer choices than your paddle bag.',
  'Your calendar is about to reveal how serious you are about pickleball.',
  'A game is being arranged. Your excuses remain unrequested.',
  'A game is forming. Your talent was not part of the calculation.',
  'Please determine whether your schedule supports recreational overconfidence.',
  'Your next athletic exaggeration starts with one decision.',
  'The details are below. The dramatic deliberation is optional.',
  'The court has requested your presence and waived the skill requirement.',
  'Your schedule is the only qualification under review.'
]);
const REALIST_GAME_DETAILS_DRAFTS = Object.freeze([
  'Information has been organized. Try not to make it emotional.',
  'Everything currently worth knowing is below. Adjust expectations accordingly.',
  'Your request has produced details. Technology occasionally works.',
  'Here is what the system knows. It has no opinions about your backhand.',
  'Everything below is useful. A rare moment for your phone.',
  'The details are below. Please pace your excitement.',
  'Here is the plan, assuming everyone can read.',
  'The details are here. No paddle upgrade was required.',
  'The facts are ready. Your excuses were not consulted.'
]);
const LEGACY_V1_SLOGAN_REPLACEMENTS = new Map([
  ['Fill the court, not the group chat.', 'Fill the court, not a group chat.'],
  ['We don\'t care why. We care if.', 'No one cares why. We care if.'],
  ['Ghost us and the app moves on without you.', 'Ghost us and we move on without you.'],
  ['Life\'s too short to text six people twice.', 'Life\'s too short to text six people ten times.'],
  ['"I\'m 90% in" means you\'re out.', '"I\'m 90% in" means you\'re Out.'],
  ['Nobody is putting you down as a maybe.', 'Nobody is putting you down as a Maybe.'],
  ['Quick responses improve your DUPR.', 'Quick responses will improve your DUPR Rating.'],
  [
    'You found time to read this. Find a second to respond.',
    'You had time to read this. Find a second to respond.'
  ]
]);
const DEFAULT_REALIST_DESCRIPTION =
  'Short, direct, dryly funny reality checks about committing, responding, and showing up.';
const DEFAULT_REALIST_GUIDANCE =
  'Sound like a blunt friend who values availability over excuses. Keep the joke concise, observational, and useful. Never change operational facts or instructions.';

function toIso(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const text = String(value);
  const parsed = new Date(text.includes('T') ? text : `${text.replace(' ', 'T')}Z`);
  return Number.isNaN(parsed.getTime()) ? text : parsed.toISOString();
}

function bool(value) {
  return value === true || value === 1 || value === '1';
}

function normalizeMessageText(value) {
  return String(value == null ? '' : value)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function readMigrationCopy({ sloganAsset = null, youreInAsset = null } = {}) {
  let sloganConfig = sloganModule.normalizeConfig();
  let youreInConfig = youreInMessages.normalizeConfig();
  try {
    if (sloganAsset) {
      sloganConfig = sloganModule.normalizeConfig(JSON.parse(sloganAsset));
    }
  } catch (error) {
    console.error('Could not parse saved slogans for Message Randomizer migration:', error.message);
  }
  try {
    if (youreInAsset) {
      youreInConfig = youreInMessages.normalizeConfig(JSON.parse(youreInAsset));
    }
  } catch (error) {
    console.error('Could not parse saved You’re In copy for Message Randomizer migration:', error.message);
  }
  return {
    slogans: sloganConfig.slogans,
    youreIn: youreInConfig.messages,
    youreInDetailsTemplate: youreInConfig.detailsTemplate
  };
}

function mapPersonality(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    description: row.description || '',
    generationGuidance: row.generation_guidance || '',
    enabled: bool(row.enabled),
    isDefault: bool(row.is_default),
    lockedPercent: Number(row.locked_percent),
    freshPoolMinimum: Number(row.fresh_pool_minimum),
    generationBatchSize: Number(row.generation_batch_size),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function mapSurfaceSetting(row) {
  if (!row) return null;
  return {
    personalityId: row.personality_id,
    surfaceId: row.surface_id,
    enabled: bool(row.enabled),
    lockedPercentOverride: row.locked_percent_override == null
      ? null
      : Number(row.locked_percent_override),
    freshPoolMinimumOverride: row.fresh_pool_minimum_override == null
      ? null
      : Number(row.fresh_pool_minimum_override),
    autoPublishGenerated: bool(row.auto_publish_generated),
    updatedAt: toIso(row.updated_at)
  };
}

function mapMessage(row) {
  if (!row) return null;
  return {
    id: row.id,
    personalityId: row.personality_id,
    surfaceId: row.surface_id,
    text: row.text,
    normalizedText: row.normalized_text,
    source: row.source,
    status: row.status,
    locked: bool(row.locked),
    vetted: bool(row.vetted),
    targetRuleId: row.target_rule_id || null,
    generationDirection: row.generation_direction || null,
    generatorName: row.generator_name || null,
    generatorVersion: row.generator_version || null,
    promptVersion: row.prompt_version || null,
    usageCount: Number(row.usage_count) || 0,
    lastUsedAt: toIso(row.last_used_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function mapTargetRule(row, { includePhone = true } = {}) {
  if (!row) return null;
  const rule = {
    id: row.id,
    personalityId: row.personality_id,
    targetDisplayName: row.target_display_name || '',
    gameId: row.game_id || null,
    triggerStatus: row.trigger_status,
    surfaceId: row.surface_id,
    audience: row.audience,
    mode: row.mode,
    exactText: row.exact_text || null,
    generationDirection: row.generation_direction || null,
    enabled: bool(row.enabled),
    startsAt: toIso(row.starts_at),
    endsAt: toIso(row.ends_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
  if (includePhone) rule.targetPhone = row.target_phone;
  return rule;
}

async function listPersonalities({ enabledOnly = false } = {}) {
  const where = enabledOnly ? ' WHERE enabled = 1' : '';
  const pgWhere = enabledOnly ? ' WHERE enabled = TRUE' : '';
  const rows = isProduction
    ? await withPgClient(async (client) => (
        await client.query(`SELECT * FROM message_personalities${pgWhere} ORDER BY name`)
      ).rows)
    : await sqliteAll(`SELECT * FROM message_personalities${where} ORDER BY name`);
  return rows.map(mapPersonality);
}

async function getPersonality(id) {
  const row = isProduction
    ? await withPgClient(async (client) => (
        await client.query('SELECT * FROM message_personalities WHERE id = $1', [id])
      ).rows[0] || null)
    : await sqliteGet('SELECT * FROM message_personalities WHERE id = ?', [id]);
  return mapPersonality(row);
}

async function getDefaultPersonality() {
  const row = isProduction
    ? await withPgClient(async (client) => (
        await client.query(
          'SELECT * FROM message_personalities WHERE enabled = TRUE ORDER BY is_default DESC, created_at ASC LIMIT 1'
        )
      ).rows[0] || null)
    : await sqliteGet(
      'SELECT * FROM message_personalities WHERE enabled = 1 ORDER BY is_default DESC, created_at ASC LIMIT 1'
    );
  return mapPersonality(row);
}

async function updatePersonality(id, fields) {
  const existing = await getPersonality(id);
  if (!existing) return null;
  const next = {
    name: fields.name === undefined ? existing.name : String(fields.name).trim(),
    description: fields.description === undefined
      ? existing.description
      : String(fields.description).trim(),
    generationGuidance: fields.generationGuidance === undefined
      ? existing.generationGuidance
      : String(fields.generationGuidance).trim(),
    enabled: fields.enabled === undefined ? existing.enabled : fields.enabled === true,
    isDefault: fields.isDefault === undefined ? existing.isDefault : fields.isDefault === true,
    lockedPercent: fields.lockedPercent === undefined
      ? existing.lockedPercent
      : Number(fields.lockedPercent),
    freshPoolMinimum: fields.freshPoolMinimum === undefined
      ? existing.freshPoolMinimum
      : Number(fields.freshPoolMinimum),
    generationBatchSize: fields.generationBatchSize === undefined
      ? existing.generationBatchSize
      : Number(fields.generationBatchSize)
  };
  if (next.isDefault && !next.enabled) {
    throw new Error('The default personality must be enabled.');
  }
  if (existing.isDefault && !next.isDefault) {
    const alternatives = (await listPersonalities()).filter(
      (personality) => personality.id !== id && personality.isDefault && personality.enabled
    );
    if (!alternatives.length) {
      throw new Error('Choose another enabled default personality first.');
    }
  }

  if (isProduction) {
    await withPgClient(async (client) => {
      await client.query('BEGIN');
      try {
        if (next.isDefault) {
          await client.query('UPDATE message_personalities SET is_default = FALSE WHERE id <> $1', [id]);
        }
        await client.query(`
          UPDATE message_personalities
          SET name = $1, description = $2, generation_guidance = $3, enabled = $4,
              is_default = $5, locked_percent = $6, fresh_pool_minimum = $7,
              generation_batch_size = $8, updated_at = CURRENT_TIMESTAMP
          WHERE id = $9
        `, [
          next.name, next.description, next.generationGuidance, next.enabled,
          next.isDefault, next.lockedPercent, next.freshPoolMinimum,
          next.generationBatchSize, id
        ]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    });
  } else {
    await sqliteRun('BEGIN IMMEDIATE');
    try {
      if (next.isDefault) {
        await sqliteRun('UPDATE message_personalities SET is_default = 0 WHERE id <> ?', [id]);
      }
      await sqliteRun(`
        UPDATE message_personalities
        SET name = ?, description = ?, generation_guidance = ?, enabled = ?,
            is_default = ?, locked_percent = ?, fresh_pool_minimum = ?,
            generation_batch_size = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `, [
        next.name, next.description, next.generationGuidance, next.enabled ? 1 : 0,
        next.isDefault ? 1 : 0, next.lockedPercent, next.freshPoolMinimum,
        next.generationBatchSize, id
      ]);
      await sqliteRun('COMMIT');
    } catch (error) {
      await sqliteRun('ROLLBACK');
      throw error;
    }
  }
  return getPersonality(id);
}

async function listSurfaceSettings(personalityId) {
  const rows = isProduction
    ? await withPgClient(async (client) => (
        await client.query(
          'SELECT * FROM personality_surface_settings WHERE personality_id = $1 ORDER BY surface_id',
          [personalityId]
        )
      ).rows)
    : await sqliteAll(
      'SELECT * FROM personality_surface_settings WHERE personality_id = ? ORDER BY surface_id',
      [personalityId]
    );
  return rows.map(mapSurfaceSetting);
}

async function getSurfaceSetting(personalityId, surfaceId) {
  const row = isProduction
    ? await withPgClient(async (client) => (
        await client.query(
          'SELECT * FROM personality_surface_settings WHERE personality_id = $1 AND surface_id = $2',
          [personalityId, surfaceId]
        )
      ).rows[0] || null)
    : await sqliteGet(
      'SELECT * FROM personality_surface_settings WHERE personality_id = ? AND surface_id = ?',
      [personalityId, surfaceId]
    );
  return mapSurfaceSetting(row);
}

async function updateSurfaceSetting(personalityId, surfaceId, fields) {
  const existing = await getSurfaceSetting(personalityId, surfaceId);
  if (!existing) return null;
  const values = {
    enabled: fields.enabled === undefined ? existing.enabled : fields.enabled === true,
    lockedPercentOverride: fields.lockedPercentOverride === undefined
      ? existing.lockedPercentOverride
      : fields.lockedPercentOverride,
    freshPoolMinimumOverride: fields.freshPoolMinimumOverride === undefined
      ? existing.freshPoolMinimumOverride
      : fields.freshPoolMinimumOverride,
    autoPublishGenerated: fields.autoPublishGenerated === undefined
      ? existing.autoPublishGenerated
      : fields.autoPublishGenerated === true
  };
  if (isProduction) {
    await withPgClient((client) => client.query(`
      UPDATE personality_surface_settings
      SET enabled = $1, locked_percent_override = $2, fresh_pool_minimum_override = $3,
          auto_publish_generated = $4, updated_at = CURRENT_TIMESTAMP
      WHERE personality_id = $5 AND surface_id = $6
    `, [
      values.enabled, values.lockedPercentOverride, values.freshPoolMinimumOverride,
      values.autoPublishGenerated, personalityId, surfaceId
    ]));
  } else {
    await sqliteRun(`
      UPDATE personality_surface_settings
      SET enabled = ?, locked_percent_override = ?, fresh_pool_minimum_override = ?,
          auto_publish_generated = ?, updated_at = CURRENT_TIMESTAMP
      WHERE personality_id = ? AND surface_id = ?
    `, [
      values.enabled ? 1 : 0, values.lockedPercentOverride, values.freshPoolMinimumOverride,
      values.autoPublishGenerated ? 1 : 0, personalityId, surfaceId
    ]);
  }
  return getSurfaceSetting(personalityId, surfaceId);
}

function buildMessageFilters(filters, postgres) {
  const clauses = [];
  const params = [];
  const add = (column, value) => {
    if (value === undefined || value === null || value === '') return;
    params.push(value);
    clauses.push(`${column} = ${postgres ? `$${params.length}` : '?'}`);
  };
  add('personality_id', filters.personalityId);
  add('surface_id', filters.surfaceId);
  add('source', filters.source);
  add('status', filters.status);
  if (filters.locked !== undefined) add('locked', postgres ? filters.locked === true : (filters.locked ? 1 : 0));
  if (filters.targetRuleId !== undefined) {
    if (filters.targetRuleId === null) clauses.push('target_rule_id IS NULL');
    else add('target_rule_id', filters.targetRuleId);
  }
  return {
    where: clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '',
    params
  };
}

async function listRandomizerMessages(filters = {}) {
  const pg = buildMessageFilters(filters, true);
  const sqlite = buildMessageFilters(filters, false);
  const rows = isProduction
    ? await withPgClient(async (client) => (
        await client.query(
          `SELECT * FROM randomizer_messages${pg.where} ORDER BY updated_at DESC, created_at DESC`,
          pg.params
        )
      ).rows)
    : await sqliteAll(
      `SELECT * FROM randomizer_messages${sqlite.where} ORDER BY updated_at DESC, created_at DESC`,
      sqlite.params
    );
  return rows.map(mapMessage);
}

async function getRandomizerMessage(id) {
  const row = isProduction
    ? await withPgClient(async (client) => (
        await client.query('SELECT * FROM randomizer_messages WHERE id = $1', [id])
      ).rows[0] || null)
    : await sqliteGet('SELECT * FROM randomizer_messages WHERE id = ?', [id]);
  return mapMessage(row);
}

async function createRandomizerMessage(fields) {
  const id = fields.id || crypto.randomUUID();
  const normalizedText = normalizeMessageText(fields.text);
  const params = [
    id,
    fields.personalityId,
    fields.surfaceId,
    String(fields.text).trim(),
    normalizedText,
    fields.source || 'manual',
    fields.status || 'draft',
    fields.locked === true,
    fields.vetted === true,
    fields.targetRuleId || null,
    fields.generationDirection || null,
    fields.generatorName || null,
    fields.generatorVersion || null,
    fields.promptVersion || null
  ];
  if (isProduction) {
    await withPgClient((client) => client.query(`
      INSERT INTO randomizer_messages
        (id, personality_id, surface_id, text, normalized_text, source, status, locked,
         vetted, target_rule_id, generation_direction, generator_name, generator_version,
         prompt_version)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
    `, params));
  } else {
    await sqliteRun(`
      INSERT INTO randomizer_messages
        (id, personality_id, surface_id, text, normalized_text, source, status, locked,
         vetted, target_rule_id, generation_direction, generator_name, generator_version,
         prompt_version)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, params.map((value, index) => (index === 7 || index === 8) ? (value ? 1 : 0) : value));
  }
  return getRandomizerMessage(id);
}

async function updateRandomizerMessage(id, fields) {
  const existing = await getRandomizerMessage(id);
  if (!existing) return null;
  const next = {
    text: fields.text === undefined ? existing.text : String(fields.text).trim(),
    source: fields.source === undefined ? existing.source : fields.source,
    status: fields.status === undefined ? existing.status : fields.status,
    locked: fields.locked === undefined ? existing.locked : fields.locked === true,
    vetted: fields.vetted === undefined ? existing.vetted : fields.vetted === true,
    generationDirection: fields.generationDirection === undefined
      ? existing.generationDirection
      : fields.generationDirection
  };
  const params = [
    next.text,
    normalizeMessageText(next.text),
    next.source,
    next.status,
    next.locked,
    next.vetted,
    next.generationDirection,
    id
  ];
  if (isProduction) {
    await withPgClient((client) => client.query(`
      UPDATE randomizer_messages
      SET text = $1, normalized_text = $2, source = $3, status = $4, locked = $5,
          vetted = $6, generation_direction = $7, updated_at = CURRENT_TIMESTAMP
      WHERE id = $8
    `, params));
  } else {
    params[4] = params[4] ? 1 : 0;
    params[5] = params[5] ? 1 : 0;
    await sqliteRun(`
      UPDATE randomizer_messages
      SET text = ?, normalized_text = ?, source = ?, status = ?, locked = ?,
          vetted = ?, generation_direction = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, params);
  }
  return getRandomizerMessage(id);
}

async function listTargetRules(filters = {}, options = {}) {
  const clauses = [];
  const pgParams = [];
  const sqliteParams = [];
  function add(column, value) {
    if (value === undefined || value === null || value === '') return;
    pgParams.push(value);
    sqliteParams.push(value);
    clauses.push(`${column} = $${pgParams.length}`);
  }
  add('personality_id', filters.personalityId);
  add('surface_id', filters.surfaceId);
  add('game_id', filters.gameId);
  if (filters.enabled !== undefined) {
    pgParams.push(filters.enabled === true);
    sqliteParams.push(filters.enabled ? 1 : 0);
    clauses.push(`enabled = $${pgParams.length}`);
  }
  const pgWhere = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
  let index = 0;
  const sqliteWhere = pgWhere.replace(/\$\d+/g, () => {
    index++;
    return '?';
  });
  const rows = isProduction
    ? await withPgClient(async (client) => (
        await client.query(
          `SELECT * FROM message_target_rules${pgWhere} ORDER BY updated_at DESC`,
          pgParams
        )
      ).rows)
    : await sqliteAll(
      `SELECT * FROM message_target_rules${sqliteWhere} ORDER BY updated_at DESC`,
      sqliteParams
    );
  return rows.map((row) => mapTargetRule(row, options));
}

async function getTargetRule(id, options = {}) {
  const row = isProduction
    ? await withPgClient(async (client) => (
        await client.query('SELECT * FROM message_target_rules WHERE id = $1', [id])
      ).rows[0] || null)
    : await sqliteGet('SELECT * FROM message_target_rules WHERE id = ?', [id]);
  return mapTargetRule(row, options);
}

async function createTargetRule(fields) {
  const id = fields.id || crypto.randomUUID();
  const params = [
    id, fields.personalityId, fields.targetPhone, fields.targetDisplayName || '',
    fields.gameId || null, fields.triggerStatus, fields.surfaceId, fields.audience,
    fields.mode, fields.exactText || null, fields.generationDirection || null,
    fields.enabled === true, fields.startsAt || null, fields.endsAt || null
  ];
  if (isProduction) {
    await withPgClient((client) => client.query(`
      INSERT INTO message_target_rules
        (id, personality_id, target_phone, target_display_name, game_id, trigger_status,
         surface_id, audience, mode, exact_text, generation_direction, enabled,
         starts_at, ends_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
    `, params));
  } else {
    params[11] = params[11] ? 1 : 0;
    await sqliteRun(`
      INSERT INTO message_target_rules
        (id, personality_id, target_phone, target_display_name, game_id, trigger_status,
         surface_id, audience, mode, exact_text, generation_direction, enabled,
         starts_at, ends_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, params);
  }
  return getTargetRule(id);
}

async function updateTargetRule(id, fields) {
  const existing = await getTargetRule(id);
  if (!existing) return null;
  const next = {
    targetPhone: fields.targetPhone === undefined ? existing.targetPhone : fields.targetPhone,
    targetDisplayName: fields.targetDisplayName === undefined
      ? existing.targetDisplayName
      : fields.targetDisplayName,
    gameId: fields.gameId === undefined ? existing.gameId : fields.gameId,
    triggerStatus: fields.triggerStatus === undefined ? existing.triggerStatus : fields.triggerStatus,
    surfaceId: fields.surfaceId === undefined ? existing.surfaceId : fields.surfaceId,
    audience: fields.audience === undefined ? existing.audience : fields.audience,
    mode: fields.mode === undefined ? existing.mode : fields.mode,
    exactText: fields.exactText === undefined ? existing.exactText : fields.exactText,
    generationDirection: fields.generationDirection === undefined
      ? existing.generationDirection
      : fields.generationDirection,
    enabled: fields.enabled === undefined ? existing.enabled : fields.enabled === true,
    startsAt: fields.startsAt === undefined ? existing.startsAt : fields.startsAt,
    endsAt: fields.endsAt === undefined ? existing.endsAt : fields.endsAt
  };
  const params = [
    next.targetPhone, next.targetDisplayName, next.gameId, next.triggerStatus,
    next.surfaceId, next.audience, next.mode, next.exactText,
    next.generationDirection, next.enabled, next.startsAt, next.endsAt, id
  ];
  if (isProduction) {
    await withPgClient((client) => client.query(`
      UPDATE message_target_rules
      SET target_phone = $1, target_display_name = $2, game_id = $3, trigger_status = $4,
          surface_id = $5, audience = $6, mode = $7, exact_text = $8,
          generation_direction = $9, enabled = $10, starts_at = $11, ends_at = $12,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $13
    `, params));
  } else {
    params[9] = params[9] ? 1 : 0;
    await sqliteRun(`
      UPDATE message_target_rules
      SET target_phone = ?, target_display_name = ?, game_id = ?, trigger_status = ?,
          surface_id = ?, audience = ?, mode = ?, exact_text = ?,
          generation_direction = ?, enabled = ?, starts_at = ?, ends_at = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, params);
  }
  return getTargetRule(id);
}

async function deleteTargetRule(id) {
  if (isProduction) {
    return withPgClient(async (client) => {
      await client.query('BEGIN');
      try {
        await client.query(
          "UPDATE randomizer_messages SET status = 'archived', updated_at = CURRENT_TIMESTAMP WHERE target_rule_id = $1",
          [id]
        );
        const result = await client.query('DELETE FROM message_target_rules WHERE id = $1', [id]);
        await client.query('COMMIT');
        return result.rowCount;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    });
  }
  await sqliteRun('BEGIN IMMEDIATE');
  try {
    await sqliteRun(
      "UPDATE randomizer_messages SET status = 'archived', updated_at = CURRENT_TIMESTAMP WHERE target_rule_id = ?",
      [id]
    );
    const result = await sqliteRun('DELETE FROM message_target_rules WHERE id = ?', [id]);
    await sqliteRun('COMMIT');
    return result.changes;
  } catch (error) {
    await sqliteRun('ROLLBACK');
    throw error;
  }
}

async function getSelectionHistory({
  personalityId,
  surfaceId,
  recipientPhone = null,
  gameId = null,
  limit = 100
}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const hash = recipientPhone ? recipientHash(recipientPhone) : null;
  const params = [personalityId, surfaceId];
  let pgWhere = 'personality_id = $1 AND surface_id = $2';
  let sqliteWhere = 'personality_id = ? AND surface_id = ?';
  if (hash) {
    params.push(hash);
    pgWhere += ` AND recipient_hash = $${params.length}`;
    sqliteWhere += ' AND recipient_hash = ?';
  } else if (gameId) {
    params.push(gameId);
    pgWhere += ` AND game_id = $${params.length}`;
    sqliteWhere += ' AND game_id = ?';
  }
  params.push(safeLimit);
  const rows = isProduction
    ? await withPgClient(async (client) => (
        await client.query(`
          SELECT * FROM message_selection_events
          WHERE ${pgWhere}
          ORDER BY selected_at DESC
          LIMIT $${params.length}
        `, params)
      ).rows)
    : await sqliteAll(`
      SELECT * FROM message_selection_events
      WHERE ${sqliteWhere}
      ORDER BY selected_at DESC
      LIMIT ?
    `, params);
  return rows.map((row) => ({
    id: row.id,
    messageId: row.message_id || null,
    personalityId: row.personality_id,
    surfaceId: row.surface_id,
    gameId: row.game_id || null,
    recipientHash: row.recipient_hash || null,
    targetRuleId: row.target_rule_id || null,
    sourceBucket: row.source_bucket,
    selectedAt: toIso(row.selected_at)
  }));
}

async function recordSelection({
  messageId = null,
  personalityId,
  surfaceId,
  gameId = null,
  recipientPhone = null,
  targetRuleId = null,
  sourceBucket
}) {
  const params = [
    crypto.randomUUID(), messageId, personalityId, surfaceId, gameId,
    recipientPhone ? recipientHash(recipientPhone) : null,
    targetRuleId, sourceBucket
  ];
  if (isProduction) {
    await withPgClient(async (client) => {
      await client.query('BEGIN');
      try {
        await client.query(`
          INSERT INTO message_selection_events
            (id, message_id, personality_id, surface_id, game_id, recipient_hash,
             target_rule_id, source_bucket)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `, params);
        if (messageId) {
          await client.query(`
            UPDATE randomizer_messages
            SET usage_count = usage_count + 1, last_used_at = CURRENT_TIMESTAMP
            WHERE id = $1
          `, [messageId]);
        }
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    });
  } else {
    await sqliteRun('BEGIN IMMEDIATE');
    try {
      await sqliteRun(`
        INSERT INTO message_selection_events
          (id, message_id, personality_id, surface_id, game_id, recipient_hash,
           target_rule_id, source_bucket)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, params);
      if (messageId) {
        await sqliteRun(`
          UPDATE randomizer_messages
          SET usage_count = usage_count + 1, last_used_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `, [messageId]);
      }
      await sqliteRun('COMMIT');
    } catch (error) {
      await sqliteRun('ROLLBACK');
      throw error;
    }
  }
}

async function getSelectionMetrics(personalityId) {
  const rows = isProduction
    ? await withPgClient(async (client) => (
        await client.query(`
          SELECT surface_id, source_bucket, COUNT(*) AS count, MAX(selected_at) AS last_selected_at
          FROM message_selection_events
          WHERE personality_id = $1
          GROUP BY surface_id, source_bucket
        `, [personalityId])
      ).rows)
    : await sqliteAll(`
      SELECT surface_id, source_bucket, COUNT(*) AS count, MAX(selected_at) AS last_selected_at
      FROM message_selection_events
      WHERE personality_id = ?
      GROUP BY surface_id, source_bucket
    `, [personalityId]);
  const bySurface = {};
  for (const row of rows) {
    if (!bySurface[row.surface_id]) {
      bySurface[row.surface_id] = {
        total: 0,
        buckets: {},
        lastSelectedAt: null,
        lockedPercentActual: null
      };
    }
    const entry = bySurface[row.surface_id];
    const count = Number(row.count) || 0;
    entry.total += count;
    entry.buckets[row.source_bucket] = count;
    const selectedAt = toIso(row.last_selected_at);
    if (selectedAt && (!entry.lastSelectedAt || selectedAt > entry.lastSelectedAt)) {
      entry.lastSelectedAt = selectedAt;
    }
  }
  for (const entry of Object.values(bySurface)) {
    const scheduled = (entry.buckets.locked || 0) + (entry.buckets.fresh || 0);
    entry.lockedPercentActual = scheduled
      ? Math.round(((entry.buckets.locked || 0) / scheduled) * 1000) / 10
      : null;
  }
  return bySurface;
}

async function getRandomizerMetrics(personalityId = REALIST_ID) {
  const [messages, settings, selectionMetrics] = await Promise.all([
    listRandomizerMessages({ personalityId }),
    listSurfaceSettings(personalityId),
    getSelectionMetrics(personalityId)
  ]);
  const bySurface = {};
  for (const surface of MESSAGE_SURFACES) {
    const surfaceMessages = messages.filter((message) => message.surfaceId === surface.id);
    bySurface[surface.id] = {
      locked: surfaceMessages.filter((message) => message.status === 'active' && message.locked).length,
      fresh: surfaceMessages.filter((message) => (
        message.status === 'active' && !message.locked && message.source === 'generated'
      )).length,
      draft: surfaceMessages.filter((message) => message.status === 'draft').length,
      lastSelectedAt: surfaceMessages
        .map((message) => message.lastUsedAt)
        .filter(Boolean)
        .sort()
        .at(-1) || selectionMetrics[surface.id]?.lastSelectedAt || null,
      lastGeneratedAt: surfaceMessages
        .filter((message) => message.source === 'generated')
        .map((message) => message.createdAt)
        .filter(Boolean)
        .sort()
        .at(-1) || null,
      selections: selectionMetrics[surface.id] || {
        total: 0,
        buckets: {},
        lastSelectedAt: null,
        lockedPercentActual: null
      }
    };
  }
  return {
    personalityId,
    messageCount: messages.length,
    selectionCount: Object.values(selectionMetrics).reduce(
      (sum, surface) => sum + surface.total,
      0
    ),
    surfaces: bySurface,
    settings
  };
}

async function insertMigratedMessage(personalityId, surfaceId, text) {
  const normalizedText = normalizeMessageText(text);
  if (isProduction) {
    await withPgClient((client) => client.query(`
      INSERT INTO randomizer_messages
        (id, personality_id, surface_id, text, normalized_text, source, status, locked, vetted)
      VALUES ($1, $2, $3, $4, $5, 'migrated', 'active', TRUE, TRUE)
      ON CONFLICT (personality_id, surface_id, normalized_text) DO NOTHING
    `, [crypto.randomUUID(), personalityId, surfaceId, text, normalizedText]));
  } else {
    await sqliteRun(`
      INSERT OR IGNORE INTO randomizer_messages
        (id, personality_id, surface_id, text, normalized_text, source, status, locked, vetted)
      VALUES (?, ?, ?, ?, ?, 'migrated', 'active', 1, 1)
    `, [crypto.randomUUID(), personalityId, surfaceId, text, normalizedText]);
  }
}

async function seedRealistInvitationOpeningDrafts() {
  const marker = isProduction
    ? await withPgClient(async (client) => (
        await client.query(
          'SELECT content FROM dev_assets WHERE name = $1',
          [INVITATION_OPENING_DRAFT_ASSET_NAME]
        )
      ).rows[0] || null)
    : await sqliteGet(
      'SELECT content FROM dev_assets WHERE name = ?',
      [INVITATION_OPENING_DRAFT_ASSET_NAME]
    );
  if (marker) return JSON.parse(marker.content);

  for (const text of REALIST_INVITATION_OPENING_DRAFTS) {
    const params = [
      crypto.randomUUID(),
      REALIST_ID,
      'invitation-opening',
      text,
      normalizeMessageText(text)
    ];
    if (isProduction) {
      await withPgClient((client) => client.query(`
        INSERT INTO randomizer_messages
          (id, personality_id, surface_id, text, normalized_text, source, status, locked, vetted)
        VALUES ($1, $2, $3, $4, $5, 'manual', 'draft', FALSE, FALSE)
        ON CONFLICT (personality_id, surface_id, normalized_text) DO NOTHING
      `, params));
    } else {
      await sqliteRun(`
        INSERT OR IGNORE INTO randomizer_messages
          (id, personality_id, surface_id, text, normalized_text, source, status, locked, vetted)
        VALUES (?, ?, ?, ?, ?, 'manual', 'draft', 0, 0)
      `, params);
    }
  }

  const summary = {
    version: 1,
    personalityId: REALIST_ID,
    surfaceId: 'invitation-opening',
    drafts: REALIST_INVITATION_OPENING_DRAFTS.length,
    seededAt: new Date().toISOString()
  };
  const content = JSON.stringify(summary);
  if (isProduction) {
    await withPgClient((client) => client.query(`
      INSERT INTO dev_assets (name, content, updated_at)
      VALUES ($1, $2, CURRENT_TIMESTAMP)
      ON CONFLICT (name) DO UPDATE SET content = EXCLUDED.content, updated_at = CURRENT_TIMESTAMP
    `, [INVITATION_OPENING_DRAFT_ASSET_NAME, content]));
  } else {
    await sqliteRun(
      'INSERT OR REPLACE INTO dev_assets (name, content, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)',
      [INVITATION_OPENING_DRAFT_ASSET_NAME, content]
    );
  }
  return summary;
}

async function seedRealistGameDetailsDrafts() {
  const marker = isProduction
    ? await withPgClient(async (client) => (
        await client.query(
          'SELECT content FROM dev_assets WHERE name = $1',
          [GAME_DETAILS_DRAFT_ASSET_NAME]
        )
      ).rows[0] || null)
    : await sqliteGet(
      'SELECT content FROM dev_assets WHERE name = ?',
      [GAME_DETAILS_DRAFT_ASSET_NAME]
    );
  if (marker) return JSON.parse(marker.content);

  for (const text of REALIST_GAME_DETAILS_DRAFTS) {
    const params = [
      crypto.randomUUID(),
      REALIST_ID,
      'game-details',
      text,
      normalizeMessageText(text)
    ];
    if (isProduction) {
      await withPgClient((client) => client.query(`
        INSERT INTO randomizer_messages
          (id, personality_id, surface_id, text, normalized_text, source, status, locked, vetted)
        VALUES ($1, $2, $3, $4, $5, 'manual', 'draft', FALSE, FALSE)
        ON CONFLICT (personality_id, surface_id, normalized_text) DO NOTHING
      `, params));
    } else {
      await sqliteRun(`
        INSERT OR IGNORE INTO randomizer_messages
          (id, personality_id, surface_id, text, normalized_text, source, status, locked, vetted)
        VALUES (?, ?, ?, ?, ?, 'manual', 'draft', 0, 0)
      `, params);
    }
  }

  const summary = {
    version: 1,
    personalityId: REALIST_ID,
    surfaceId: 'game-details',
    drafts: REALIST_GAME_DETAILS_DRAFTS.length,
    seededAt: new Date().toISOString()
  };
  const content = JSON.stringify(summary);
  if (isProduction) {
    await withPgClient((client) => client.query(`
      INSERT INTO dev_assets (name, content, updated_at)
      VALUES ($1, $2, CURRENT_TIMESTAMP)
      ON CONFLICT (name) DO UPDATE SET content = EXCLUDED.content, updated_at = CURRENT_TIMESTAMP
    `, [GAME_DETAILS_DRAFT_ASSET_NAME, content]));
  } else {
    await sqliteRun(
      'INSERT OR REPLACE INTO dev_assets (name, content, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)',
      [GAME_DETAILS_DRAFT_ASSET_NAME, content]
    );
  }
  return summary;
}

async function syncLegacySurfaceMessages(personalityId, surfaceId, texts) {
  const normalized = [...new Set(texts.map(normalizeMessageText).filter(Boolean))];
  for (const text of texts) {
    const normalizedText = normalizeMessageText(text);
    if (!normalizedText) continue;
    if (isProduction) {
      await withPgClient((client) => client.query(`
        INSERT INTO randomizer_messages
          (id, personality_id, surface_id, text, normalized_text, source, status, locked, vetted)
        VALUES ($1, $2, $3, $4, $5, 'manual', 'active', TRUE, TRUE)
        ON CONFLICT (personality_id, surface_id, normalized_text)
        DO UPDATE SET text = EXCLUDED.text, status = 'active', locked = TRUE, vetted = TRUE,
                      updated_at = CURRENT_TIMESTAMP
      `, [crypto.randomUUID(), personalityId, surfaceId, String(text).trim(), normalizedText]));
    } else {
      await sqliteRun(`
        INSERT INTO randomizer_messages
          (id, personality_id, surface_id, text, normalized_text, source, status, locked, vetted)
        VALUES (?, ?, ?, ?, ?, 'manual', 'active', 1, 1)
        ON CONFLICT (personality_id, surface_id, normalized_text)
        DO UPDATE SET text = excluded.text, status = 'active', locked = 1, vetted = 1,
                      updated_at = CURRENT_TIMESTAMP
      `, [crypto.randomUUID(), personalityId, surfaceId, String(text).trim(), normalizedText]);
    }
  }

  const managed = await listRandomizerMessages({ personalityId, surfaceId });
  for (const message of managed) {
    if (
      (message.source === 'migrated' || message.source === 'manual') &&
      !normalized.includes(message.normalizedText) &&
      message.status !== 'archived'
    ) {
      await updateRandomizerMessage(message.id, { status: 'archived' });
    }
  }
}

async function repairOwnerVettedSlogans() {
  const marker = isProduction
    ? await withPgClient(async (client) => (
        await client.query(
          'SELECT content FROM dev_assets WHERE name = $1',
          [VETTED_SLOGAN_REPAIR_ASSET_NAME]
        )
      ).rows[0] || null)
    : await sqliteGet(
      'SELECT content FROM dev_assets WHERE name = ?',
      [VETTED_SLOGAN_REPAIR_ASSET_NAME]
    );
  if (marker) return JSON.parse(marker.content);

  // This is the exact 19-item owner-saved configuration captured for this release.
  // The v1 production asset was one revision behind, so update those eight rows in
  // place (preserving selection references) and insert the nineteenth row.
  const messages = await listRandomizerMessages({
    personalityId: REALIST_ID,
    surfaceId: 'site-slogan'
  });
  let replacements = 0;
  for (const message of messages) {
    const replacement = LEGACY_V1_SLOGAN_REPLACEMENTS.get(message.text);
    if (message.source === 'migrated' && replacement) {
      await updateRandomizerMessage(message.id, { text: replacement });
      replacements++;
    }
  }
  for (const text of sloganModule.DEFAULT_SLOGANS) {
    await insertMigratedMessage(REALIST_ID, 'site-slogan', text);
  }

  let savedConfig = {};
  const savedAsset = isProduction
    ? await withPgClient(async (client) => (
        await client.query('SELECT content FROM dev_assets WHERE name = $1', ['slogan-config'])
      ).rows[0] || null)
    : await sqliteGet('SELECT content FROM dev_assets WHERE name = ?', ['slogan-config']);
  try {
    savedConfig = savedAsset ? JSON.parse(savedAsset.content) : {};
  } catch (_error) {
    savedConfig = {};
  }
  const repairedConfig = sloganModule.normalizeConfig({
    ...savedConfig,
    slogans: sloganModule.DEFAULT_SLOGANS
  });
  const repairedContent = JSON.stringify(repairedConfig);
  const summary = {
    version: 2,
    slogans: repairedConfig.slogans.length,
    replacements,
    repairedAt: new Date().toISOString()
  };
  const markerContent = JSON.stringify(summary);

  if (isProduction) {
    await withPgClient(async (client) => {
      await client.query(`
        INSERT INTO dev_assets (name, content, updated_at)
        VALUES ($1, $2, CURRENT_TIMESTAMP)
        ON CONFLICT (name)
        DO UPDATE SET content = EXCLUDED.content, updated_at = CURRENT_TIMESTAMP
      `, ['slogan-config', repairedContent]);
      await client.query(`
        INSERT INTO dev_assets (name, content, updated_at)
        VALUES ($1, $2, CURRENT_TIMESTAMP)
        ON CONFLICT (name)
        DO UPDATE SET content = EXCLUDED.content, updated_at = CURRENT_TIMESTAMP
      `, [VETTED_SLOGAN_REPAIR_ASSET_NAME, markerContent]);
    });
  } else {
    await sqliteRun(
      'INSERT OR REPLACE INTO dev_assets (name, content, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)',
      ['slogan-config', repairedContent]
    );
    await sqliteRun(
      'INSERT OR REPLACE INTO dev_assets (name, content, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)',
      [VETTED_SLOGAN_REPAIR_ASSET_NAME, markerContent]
    );
  }
  return summary;
}

async function seedRealistAndMigrateSavedMessages() {
  const marker = isProduction
    ? await withPgClient(async (client) => (
        await client.query('SELECT content FROM dev_assets WHERE name = $1', [MIGRATION_ASSET_NAME])
      ).rows[0] || null)
    : await sqliteGet('SELECT content FROM dev_assets WHERE name = ?', [MIGRATION_ASSET_NAME]);
  if (marker) {
    const summary = JSON.parse(marker.content);
    summary.vettedSloganRepair = await repairOwnerVettedSlogans();
    summary.invitationOpeningDrafts = await seedRealistInvitationOpeningDrafts();
    summary.gameDetailsDrafts = await seedRealistGameDetailsDrafts();
    return summary;
  }

  if (isProduction) {
    await withPgClient((client) => client.query(`
      INSERT INTO message_personalities
        (id, name, description, generation_guidance, enabled, is_default,
         locked_percent, fresh_pool_minimum, generation_batch_size)
      VALUES ($1, 'Realist', $2, $3, TRUE, TRUE, 40, 10, 10)
      ON CONFLICT (id) DO NOTHING
    `, [REALIST_ID, DEFAULT_REALIST_DESCRIPTION, DEFAULT_REALIST_GUIDANCE]));
  } else {
    await sqliteRun(`
      INSERT OR IGNORE INTO message_personalities
        (id, name, description, generation_guidance, enabled, is_default,
         locked_percent, fresh_pool_minimum, generation_batch_size)
      VALUES (?, 'Realist', ?, ?, 1, 1, 40, 10, 10)
    `, [REALIST_ID, DEFAULT_REALIST_DESCRIPTION, DEFAULT_REALIST_GUIDANCE]);
  }

  const initiallyEnabledSurfaces = new Set([
    'site-slogan',
    'invitation-opening',
    'youre-in'
  ]);
  for (const surface of MESSAGE_SURFACES) {
    const enabled = initiallyEnabledSurfaces.has(surface.id);
    if (isProduction) {
      await withPgClient((client) => client.query(`
        INSERT INTO personality_surface_settings
          (personality_id, surface_id, enabled, auto_publish_generated)
        VALUES ($1, $2, $3, FALSE)
        ON CONFLICT (personality_id, surface_id) DO NOTHING
      `, [REALIST_ID, surface.id, enabled]));
    } else {
      await sqliteRun(`
        INSERT OR IGNORE INTO personality_surface_settings
          (personality_id, surface_id, enabled, auto_publish_generated)
        VALUES (?, ?, ?, 0)
      `, [REALIST_ID, surface.id, enabled ? 1 : 0]);
    }
  }

  const assetNames = ['slogan-config', 'youre-in-config'];
  const assets = {};
  for (const name of assetNames) {
    const row = isProduction
      ? await withPgClient(async (client) => (
          await client.query('SELECT content FROM dev_assets WHERE name = $1', [name])
        ).rows[0] || null)
      : await sqliteGet('SELECT content FROM dev_assets WHERE name = ?', [name]);
    assets[name] = row ? row.content : null;
  }

  const migratedCopy = readMigrationCopy({
    sloganAsset: assets['slogan-config'],
    youreInAsset: assets['youre-in-config']
  });

  for (const text of migratedCopy.slogans) {
    await insertMigratedMessage(REALIST_ID, 'site-slogan', text);
  }
  for (const text of migratedCopy.youreIn) {
    await insertMigratedMessage(REALIST_ID, 'youre-in', text);
  }

  const summary = {
    version: 1,
    personalityId: REALIST_ID,
    slogans: migratedCopy.slogans.length,
    youreIn: migratedCopy.youreIn.length,
    total: migratedCopy.slogans.length + migratedCopy.youreIn.length,
    migratedAt: new Date().toISOString()
  };
  const content = JSON.stringify(summary);
  if (isProduction) {
    await withPgClient((client) => client.query(`
      INSERT INTO dev_assets (name, content, updated_at)
      VALUES ($1, $2, CURRENT_TIMESTAMP)
      ON CONFLICT (name) DO UPDATE SET content = EXCLUDED.content, updated_at = CURRENT_TIMESTAMP
    `, [MIGRATION_ASSET_NAME, content]));
  } else {
    await sqliteRun(
      'INSERT OR REPLACE INTO dev_assets (name, content, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)',
      [MIGRATION_ASSET_NAME, content]
    );
  }
  summary.vettedSloganRepair = await repairOwnerVettedSlogans();
  summary.invitationOpeningDrafts = await seedRealistInvitationOpeningDrafts();
  summary.gameDetailsDrafts = await seedRealistGameDetailsDrafts();
  return summary;
}

module.exports = {
  REALIST_ID,
  MIGRATION_ASSET_NAME,
  INVITATION_OPENING_DRAFT_ASSET_NAME,
  GAME_DETAILS_DRAFT_ASSET_NAME,
  REALIST_INVITATION_OPENING_DRAFTS,
  REALIST_GAME_DETAILS_DRAFTS,
  DEFAULT_REALIST_DESCRIPTION,
  DEFAULT_REALIST_GUIDANCE,
  normalizeMessageText,
  readMigrationCopy,
  listPersonalities,
  getPersonality,
  getDefaultPersonality,
  updatePersonality,
  listSurfaceSettings,
  getSurfaceSetting,
  updateSurfaceSetting,
  listRandomizerMessages,
  getRandomizerMessage,
  createRandomizerMessage,
  updateRandomizerMessage,
  listTargetRules,
  getTargetRule,
  createTargetRule,
  updateTargetRule,
  deleteTargetRule,
  getSelectionHistory,
  recordSelection,
  getSelectionMetrics,
  getRandomizerMetrics,
  syncLegacySurfaceMessages,
  seedRealistAndMigrateSavedMessages,
  seedRealistGameDetailsDrafts
};
