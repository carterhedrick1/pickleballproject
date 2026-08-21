/**
 * What was said, to whom, and how often - the record behind "don't repeat yourself".
 *
 * Recipients are stored as a hash, never a phone number (see database/sms-events.js), so the
 * history can answer "has this person seen this line?" without holding anybody's number.
 *
 * Known rough edge, unchanged by the split that created this file: recordSelection opens
 * BEGIN IMMEDIATE on the one shared SQLite connection, so two signups landing together make
 * the second throw "cannot start a transaction within a transaction". The caller in
 * services/message-randomizer.js catches it and falls back to the legacy text, so nobody gets
 * a broken message - they just get the un-randomized one. It is logged as
 * "Message Randomizer fallback for <surface>". PostgreSQL takes a client per call and is
 * unaffected. Fixing it means a queue or a savepoint, and it is a behaviour change, so it
 * belongs in its own task.
 */

const crypto = require('crypto');
const { isProduction, withPgClient, sqliteAll, sqliteRun } = require('./context');
const { recipientHash } = require('./sms-events');
const { toIso, mapSelectionEvent } = require('./message-rows');
const { MESSAGE_SURFACES } = require('../message-surfaces');
const { listRandomizerMessages } = require('./message-inventory');
const { listSurfaceSettings } = require('./message-personalities');

/**
 * Recent selections for one surface, narrowed to a person when a phone is known and to a
 * game otherwise. The limit is clamped so a caller cannot ask for the whole table.
 */
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
  return rows.map(mapSelectionEvent);
}

/** Writes the selection and bumps the chosen message's usage counters together. */
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

/**
 * Per-surface selection counts, split by which bucket the message came from.
 * `lockedPercentActual` is what the owner compares against the locked percent they configured.
 */
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
    // Only scheduled buckets count: a fallback was not a choice between locked and fresh.
    const scheduled = (entry.buckets.locked || 0) + (entry.buckets.fresh || 0);
    entry.lockedPercentActual = scheduled
      ? Math.round(((entry.buckets.locked || 0) / scheduled) * 1000) / 10
      : null;
  }
  return bySurface;
}

/** Everything the developer area's Message Randomizer tab shows for one personality. */
async function getRandomizerMetrics(personalityId = 'realist') {
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

module.exports = {
  getSelectionHistory,
  recordSelection,
  getSelectionMetrics,
  getRandomizerMetrics
};
