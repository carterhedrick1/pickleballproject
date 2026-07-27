const { isProduction, withPgClient, sqliteAll, sqliteGet, sqliteRun, sqlitePrepareRun } = require('./context');

const crypto = require('crypto');

// ---------------------------------------------------------------------------
// Developer area: idea board, error log, published doc pages
// ---------------------------------------------------------------------------



// Postgres hands back a Date; SQLite hands back "YYYY-MM-DD HH:MM:SS" in UTC.
// The developer page wants one shape it can format, so everything leaves here as ISO.
function toIso(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const asString = String(value);
  const parsed = new Date(asString.includes('T') ? asString : asString.replace(' ', 'T') + 'Z');
  return isNaN(parsed.getTime()) ? asString : parsed.toISOString();
}

/** Cheap "is the database actually answering?" check for the status dashboard. */
async function pingDatabase() {
  if (isProduction) {
    await withPgClient((client) => client.query('SELECT 1'));
  } else {
    await sqliteGet('SELECT 1');
  }
  return true;
}

async function countRows(table) {
  if (isProduction) {
    const rows = await withPgClient(async (client) => {
      const result = await client.query(`SELECT COUNT(*) AS count FROM ${table}`);
      return result.rows;
    });
    return Number(rows[0].count);
  }
  const row = await sqliteGet(`SELECT COUNT(*) AS count FROM ${table}`);
  return Number(row.count);
}

function mapNote(row) {
  return {
    id: row.id,
    title: row.title,
    body: row.body || '',
    status: row.status || 'idea',
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

async function listDevNotes() {
  const rows = isProduction
    ? await withPgClient(async (client) => {
        const result = await client.query('SELECT * FROM dev_notes ORDER BY updated_at DESC');
        return result.rows;
      })
    : await sqliteAll('SELECT * FROM dev_notes ORDER BY updated_at DESC');
  return rows.map(mapNote);
}

async function saveDevNote(title, body, status) {
  const id = crypto.randomUUID();
  if (isProduction) {
    await withPgClient((client) => client.query(
      'INSERT INTO dev_notes (id, title, body, status) VALUES ($1, $2, $3, $4)',
      [id, title, body, status]
    ));
  } else {
    await sqlitePrepareRun(
      'INSERT INTO dev_notes (id, title, body, status) VALUES (?, ?, ?, ?)',
      [id, title, body, status]
    );
  }
  return id;
}

async function updateDevNote(id, fields) {
  const existing = isProduction
    ? await withPgClient(async (client) => {
        const result = await client.query('SELECT * FROM dev_notes WHERE id = $1', [id]);
        return result.rows[0] || null;
      })
    : await sqliteGet('SELECT * FROM dev_notes WHERE id = ?', [id]);
  if (!existing) return null;

  const title = fields.title !== undefined ? fields.title : existing.title;
  const body = fields.body !== undefined ? fields.body : existing.body;
  const status = fields.status !== undefined ? fields.status : existing.status;

  if (isProduction) {
    await withPgClient((client) => client.query(
      'UPDATE dev_notes SET title = $1, body = $2, status = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $4',
      [title, body, status, id]
    ));
  } else {
    await sqliteRun(
      'UPDATE dev_notes SET title = ?, body = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [title, body, status, id]
    );
  }
  return mapNote({ ...existing, title, body, status, updated_at: new Date() });
}

async function deleteDevNote(id) {
  if (isProduction) {
    const count = await withPgClient(async (client) => {
      const result = await client.query('DELETE FROM dev_notes WHERE id = $1', [id]);
      return result.rowCount;
    });
    return count;
  }
  const result = await sqliteRun('DELETE FROM dev_notes WHERE id = ?', [id]);
  return result.changes;
}

async function countDevNotesByStatus() {
  const rows = isProduction
    ? await withPgClient(async (client) => {
        const result = await client.query('SELECT status, COUNT(*) AS count FROM dev_notes GROUP BY status');
        return result.rows;
      })
    : await sqliteAll('SELECT status, COUNT(*) AS count FROM dev_notes GROUP BY status');
  const counts = {};
  rows.forEach((row) => { counts[row.status] = Number(row.count); });
  return counts;
}

/**
 * Best-effort error recording. Callers are usually already handling a failure,
 * so this never throws - a broken logger must not become a second outage.
 */
async function logAppError(source, { message, stack, page, userAgent } = {}) {
  try {
    const id = crypto.randomUUID();
    const params = [
      id,
      String(source || 'server').slice(0, 20),
      String(message || 'Unknown error').slice(0, 500),
      stack ? String(stack).slice(0, 2000) : null,
      page ? String(page).slice(0, 300) : null,
      userAgent ? String(userAgent).slice(0, 300) : null
    ];
    if (isProduction) {
      await withPgClient((client) => client.query(
        'INSERT INTO app_errors (id, source, message, stack, page, user_agent) VALUES ($1, $2, $3, $4, $5, $6)',
        params
      ));
    } else {
      // sqliteRun, not sqlitePrepareRun: db.prepare() throws natively if the table is
      // not there yet, which would take down the process this function exists to record.
      await sqliteRun(
        'INSERT INTO app_errors (id, source, message, stack, page, user_agent) VALUES (?, ?, ?, ?, ?, ?)',
        params
      );
    }
    return id;
  } catch (err) {
    console.error('Error writing to app_errors (swallowed):', err.message);
    return null;
  }
}

async function listAppErrors(limit = 200) {
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 200, 1), 500);
  const rows = isProduction
    ? await withPgClient(async (client) => {
        const result = await client.query('SELECT * FROM app_errors ORDER BY created_at DESC LIMIT $1', [safeLimit]);
        return result.rows;
      })
    : await sqliteAll('SELECT * FROM app_errors ORDER BY created_at DESC LIMIT ?', [safeLimit]);
  return rows.map((row) => ({
    id: row.id,
    source: row.source,
    message: row.message,
    stack: row.stack,
    page: row.page,
    userAgent: row.user_agent,
    createdAt: toIso(row.created_at)
  }));
}

async function countAppErrors(sinceDays = 7) {
  const days = parseInt(sinceDays, 10) || 7;
  if (isProduction) {
    const rows = await withPgClient(async (client) => {
      const result = await client.query(
        `SELECT COUNT(*) AS count FROM app_errors WHERE created_at > CURRENT_TIMESTAMP - INTERVAL '${days} days'`
      );
      return result.rows;
    });
    return Number(rows[0].count);
  }
  const row = await sqliteGet(
    `SELECT COUNT(*) AS count FROM app_errors WHERE created_at > datetime('now', '-${days} days')`
  );
  return Number(row.count);
}

/** Keeps the newest 500 rows and nothing older than 30 days, so the table can't grow forever. */
async function pruneAppErrors() {
  try {
    if (isProduction) {
      await withPgClient(async (client) => {
        await client.query("DELETE FROM app_errors WHERE created_at < CURRENT_TIMESTAMP - INTERVAL '30 days'");
        await client.query('DELETE FROM app_errors WHERE id NOT IN (SELECT id FROM app_errors ORDER BY created_at DESC LIMIT 500)');
      });
    } else {
      await sqliteRun("DELETE FROM app_errors WHERE created_at < datetime('now', '-30 days')");
      await sqliteRun('DELETE FROM app_errors WHERE id NOT IN (SELECT id FROM app_errors ORDER BY created_at DESC LIMIT 500)');
    }
  } catch (err) {
    console.error('Error pruning app_errors (swallowed):', err.message);
  }
}

async function saveDevAsset(name, content) {
  if (isProduction) {
    await withPgClient((client) => client.query(`
      INSERT INTO dev_assets (name, content, updated_at)
      VALUES ($1, $2, CURRENT_TIMESTAMP)
      ON CONFLICT (name) DO UPDATE SET content = $2, updated_at = CURRENT_TIMESTAMP
    `, [name, content]));
  } else {
    await sqlitePrepareRun(
      'INSERT OR REPLACE INTO dev_assets (name, content, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)',
      [name, content]
    );
  }
}

async function getDevAsset(name) {
  const row = isProduction
    ? await withPgClient(async (client) => {
        const result = await client.query('SELECT content, updated_at FROM dev_assets WHERE name = $1', [name]);
        return result.rows[0] || null;
      })
    : await sqliteGet('SELECT content, updated_at FROM dev_assets WHERE name = ?', [name]);
  if (!row) return null;
  return { content: row.content, updatedAt: toIso(row.updated_at) };
}

/** Metadata only - the screens page is several megabytes, far too big to load for a status check. */
async function getDevAssetMeta(name) {
  const row = isProduction
    ? await withPgClient(async (client) => {
        const result = await client.query('SELECT updated_at, LENGTH(content) AS size FROM dev_assets WHERE name = $1', [name]);
        return result.rows[0] || null;
      })
    : await sqliteGet('SELECT updated_at, LENGTH(content) AS size FROM dev_assets WHERE name = ?', [name]);
  if (!row) return null;
  return { updatedAt: toIso(row.updated_at), size: Number(row.size) };
}

module.exports = {
  pingDatabase,
  countRows,
  listDevNotes,
  saveDevNote,
  updateDevNote,
  deleteDevNote,
  countDevNotesByStatus,
  logAppError,
  listAppErrors,
  countAppErrors,
  pruneAppErrors,
  saveDevAsset,
  getDevAsset,
  getDevAssetMeta
};
