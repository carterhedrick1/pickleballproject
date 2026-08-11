const crypto = require('crypto');
const { isProduction, withPgClient, sqliteAll, sqliteRun } = require('./context');
const { SMS_EVENT_DEFINITIONS } = require('../sms-event-catalog');

function toIso(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const text = String(value);
  const parsed = new Date(text.includes('T') ? text : `${text.replace(' ', 'T')}Z`);
  return Number.isNaN(parsed.getTime()) ? text : parsed.toISOString();
}

function recipientHash(phoneNumber) {
  const normalized = String(phoneNumber || '').replace(/\D/g, '');
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

async function logSmsEvent({
  id = null,
  eventId,
  gameId = null,
  phoneNumber,
  status,
  attempts = 1,
  error = null
}) {
  const params = [
    id || crypto.randomUUID(),
    eventId,
    gameId || null,
    recipientHash(phoneNumber),
    status,
    Math.max(1, Number(attempts) || 1),
    error ? String(error).slice(0, 500) : null
  ];

  if (isProduction) {
    await withPgClient((client) => client.query(`
      INSERT INTO sms_events
        (id, event_id, game_id, recipient_hash, status, attempts, error)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, params));
  } else {
    await sqliteRun(`
      INSERT INTO sms_events
        (id, event_id, game_id, recipient_hash, status, attempts, error)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, params);
  }
}

/**
 * Every text this game produced, newest first.
 *
 * Rows identify their recipient by hash only, so the caller matches those hashes against the
 * phone numbers it already knows to put names on them. A number nobody on the game recognizes
 * stays anonymous, which is the point of storing the hash rather than the number.
 */
async function getSmsEventsForGame(gameId, { limit = 200 } = {}) {
  if (!gameId) return [];
  const safeLimit = Math.min(Math.max(Number(limit) || 200, 1), 500);
  const query = isProduction
    ? `SELECT event_id, recipient_hash, status, attempts, error, created_at
       FROM sms_events WHERE game_id = $1
       ORDER BY created_at DESC, id DESC LIMIT $2`
    : `SELECT event_id, recipient_hash, status, attempts, error, created_at
       FROM sms_events WHERE game_id = ?
       ORDER BY created_at DESC, id DESC LIMIT ?`;

  const rows = isProduction
    ? await withPgClient(async (client) => (await client.query(query, [gameId, safeLimit])).rows)
    : await sqliteAll(query, [gameId, safeLimit]);

  return rows.map((row) => ({
    eventId: row.event_id,
    recipientHash: row.recipient_hash,
    status: row.status,
    attempts: Number(row.attempts) || 1,
    error: row.error || null,
    sentAt: toIso(row.created_at)
  }));
}

async function getSmsEventMetrics() {
  const intervalColumns = isProduction
    ? `
      COUNT(*) FILTER (WHERE created_at > CURRENT_TIMESTAMP - INTERVAL '24 hours') AS last_24_hours,
      COUNT(*) FILTER (WHERE created_at > CURRENT_TIMESTAMP - INTERVAL '7 days') AS last_7_days`
    : `
      SUM(CASE WHEN created_at > datetime('now', '-24 hours') THEN 1 ELSE 0 END) AS last_24_hours,
      SUM(CASE WHEN created_at > datetime('now', '-7 days') THEN 1 ELSE 0 END) AS last_7_days`;
  const query = `
    SELECT
      event_id,
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) AS sent,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
      SUM(CASE WHEN status = 'simulated' THEN 1 ELSE 0 END) AS simulated,
      COUNT(DISTINCT recipient_hash) AS unique_recipients,
      SUM(attempts) AS attempts,
      MAX(created_at) AS last_triggered_at,
      ${intervalColumns}
    FROM sms_events
    GROUP BY event_id
  `;
  const rows = isProduction
    ? await withPgClient(async (client) => (await client.query(query)).rows)
    : await sqliteAll(query);
  const byEvent = new Map(rows.map((row) => [row.event_id, row]));

  const events = SMS_EVENT_DEFINITIONS.map((definition) => {
    const row = byEvent.get(definition.id) || {};
    return {
      ...definition,
      total: Number(row.total) || 0,
      sent: Number(row.sent) || 0,
      failed: Number(row.failed) || 0,
      simulated: Number(row.simulated) || 0,
      uniqueRecipients: Number(row.unique_recipients) || 0,
      attempts: Number(row.attempts) || 0,
      last24Hours: Number(row.last_24_hours) || 0,
      last7Days: Number(row.last_7_days) || 0,
      lastTriggeredAt: toIso(row.last_triggered_at)
    };
  });
  const unclassified = byEvent.get('unclassified');
  if (unclassified) {
    events.push({
      id: 'unclassified',
      title: 'Unclassified Text',
      recipient: 'Unknown',
      description: 'A send path reached the SMS client without a recognized event label.',
      total: Number(unclassified.total) || 0,
      sent: Number(unclassified.sent) || 0,
      failed: Number(unclassified.failed) || 0,
      simulated: Number(unclassified.simulated) || 0,
      uniqueRecipients: Number(unclassified.unique_recipients) || 0,
      attempts: Number(unclassified.attempts) || 0,
      last24Hours: Number(unclassified.last_24_hours) || 0,
      last7Days: Number(unclassified.last_7_days) || 0,
      lastTriggeredAt: toIso(unclassified.last_triggered_at)
    });
  }

  const totals = events.reduce((summary, event) => {
    summary.total += event.total;
    summary.sent += event.sent;
    summary.failed += event.failed;
    summary.simulated += event.simulated;
    summary.attempts += event.attempts;
    summary.last24Hours += event.last24Hours;
    summary.last7Days += event.last7Days;
    return summary;
  }, { total: 0, sent: 0, failed: 0, simulated: 0, attempts: 0, last24Hours: 0, last7Days: 0 });

  const recipientQuery = `
    SELECT COUNT(DISTINCT recipient_hash) AS count, MIN(created_at) AS tracking_started_at
    FROM sms_events
  `;
  const recipientRows = isProduction
    ? await withPgClient(async (client) => (await client.query(recipientQuery)).rows)
    : await sqliteAll(recipientQuery);
  totals.uniqueRecipients = Number(recipientRows[0]?.count) || 0;
  totals.successRate = totals.sent + totals.failed
    ? Math.round((totals.sent / (totals.sent + totals.failed)) * 1000) / 10
    : null;

  return {
    trackingStartedAt: toIso(recipientRows[0]?.tracking_started_at),
    totals,
    events
  };
}

/**
 * One text's outcome, by the id its sender chose in advance.
 *
 * The RSVP page holds that id while the text is still being sent, so it can report what
 * actually happened without naming a phone number to ask about. An unknown id simply has no
 * row yet, which is the same answer as "still sending".
 */
async function getSmsEventById(id) {
  if (!id) return null;
  const query = isProduction
    ? 'SELECT event_id, game_id, status, attempts, error, created_at FROM sms_events WHERE id = $1'
    : 'SELECT event_id, game_id, status, attempts, error, created_at FROM sms_events WHERE id = ?';

  const rows = isProduction
    ? await withPgClient(async (client) => (await client.query(query, [id])).rows)
    : await sqliteAll(query, [id]);

  const row = rows[0];
  if (!row) return null;
  return {
    eventId: row.event_id,
    gameId: row.game_id,
    status: row.status,
    attempts: Number(row.attempts) || 1,
    error: row.error || null,
    createdAt: toIso(row.created_at)
  };
}

module.exports = {
  logSmsEvent,
  getSmsEventById,
  getSmsEventMetrics,
  getSmsEventsForGame,
  recipientHash
};
