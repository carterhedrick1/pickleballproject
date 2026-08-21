/**
 * Personalities, their per-surface settings, and the saved Codex prompts.
 *
 * A personality is the voice ("Realist"); a surface setting is that voice's configuration for
 * one place a message appears. Exactly one enabled personality is the default, and this file
 * is what enforces that - see updatePersonality.
 */

const { isProduction, withPgClient, sqliteAll, sqliteGet, sqliteRun } = require('./context');
const { mapPersonality, mapSurfaceSetting, mapCodexPrompt } = require('./message-rows');

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

  // Promoting a new default and demoting the old one has to be one write, or a crash between
  // them leaves the app with two defaults or none.
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

async function listCodexPrompts(personalityId) {
  const rows = isProduction
    ? await withPgClient(async (client) => (
        await client.query(
          'SELECT * FROM message_codex_prompts WHERE personality_id = $1 ORDER BY surface_id',
          [personalityId]
        )
      ).rows)
    : await sqliteAll(
      'SELECT * FROM message_codex_prompts WHERE personality_id = ? ORDER BY surface_id',
      [personalityId]
    );
  return rows.map(mapCodexPrompt);
}

async function saveCodexPrompts(personalityId, prompts) {
  const records = prompts.map((prompt) => [
    personalityId,
    prompt.surfaceId,
    JSON.stringify(prompt.sections)
  ]);
  // "Save this prompt to all message categories" arrives as many rows at once; either the
  // whole edit lands or none of it does.
  if (isProduction) {
    await withPgClient(async (client) => {
      await client.query('BEGIN');
      try {
        for (const params of records) {
          await client.query(`
            INSERT INTO message_codex_prompts
              (personality_id, surface_id, sections, updated_at)
            VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
            ON CONFLICT (personality_id, surface_id) DO UPDATE
            SET sections = EXCLUDED.sections, updated_at = CURRENT_TIMESTAMP
          `, params);
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
      for (const params of records) {
        await sqliteRun(`
          INSERT INTO message_codex_prompts
            (personality_id, surface_id, sections, updated_at)
          VALUES (?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT (personality_id, surface_id) DO UPDATE
          SET sections = excluded.sections, updated_at = CURRENT_TIMESTAMP
        `, params);
      }
      await sqliteRun('COMMIT');
    } catch (error) {
      await sqliteRun('ROLLBACK');
      throw error;
    }
  }
  return listCodexPrompts(personalityId);
}

module.exports = {
  listPersonalities,
  getPersonality,
  getDefaultPersonality,
  updatePersonality,
  listSurfaceSettings,
  getSurfaceSetting,
  updateSurfaceSetting,
  listCodexPrompts,
  saveCodexPrompts
};
