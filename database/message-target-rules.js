/**
 * Targeting rules: "when this specific player hits this surface, say this instead."
 *
 * A rule owns the messages written for it (randomizer_messages.target_rule_id), which is why
 * deleting one archives its messages in the same transaction rather than leaving rows behind
 * pointing at a rule that no longer exists.
 */

const crypto = require('crypto');
const { isProduction, withPgClient, sqliteAll, sqliteGet, sqliteRun } = require('./context');
const { mapTargetRule } = require('./message-rows');

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
  // The clause is written once in PostgreSQL's numbered form, then rewritten to SQLite's
  // positional '?' - the parameter arrays are already in the same order.
  const pgWhere = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
  const sqliteWhere = pgWhere.replace(/\$\d+/g, () => '?');
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

/** Archives the rule's messages and removes the rule, or does neither. */
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

module.exports = {
  listTargetRules,
  getTargetRule,
  createTargetRule,
  updateTargetRule,
  deleteTargetRule
};
