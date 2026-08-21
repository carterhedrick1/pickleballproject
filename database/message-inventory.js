/**
 * The message pool itself: every candidate line, per personality and surface.
 *
 * `normalized_text` is what makes a message unique within a surface, so both writes here
 * recompute it rather than trusting a caller to pass one - see database/message-rows.js.
 */

const crypto = require('crypto');
const { isProduction, withPgClient, sqliteAll, sqliteGet, sqliteRun } = require('./context');
const { mapMessage, normalizeMessageText } = require('./message-rows');

/**
 * Both engines need the same filters with different placeholder syntax, so the clause is
 * built once per dialect. `targetRuleId: null` deliberately means "general pool only"
 * (IS NULL), which is not the same as leaving the filter off.
 */
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
    // Positions 7 and 8 are locked/vetted: SQLite has no boolean type.
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

module.exports = {
  buildMessageFilters,
  listRandomizerMessages,
  getRandomizerMessage,
  createRandomizerMessage,
  updateRandomizerMessage
};
