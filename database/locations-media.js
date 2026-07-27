const { isProduction, withPgClient, sqliteAll, sqliteGet, sqliteRun, sqlitePrepareRun } = require('./context');

const { locationKey } = require('./schema');

// ---------------------------------------------------------------------------
// Location functions
// ---------------------------------------------------------------------------

// Remembers a court so the next host can pick it instead of retyping it.
// Blank names are ignored, and an existing court keeps the spelling it was first saved with.
async function addLocation(displayName) {
  const trimmed = String(displayName == null ? '' : displayName).trim().replace(/\s+/g, ' ');
  if (!trimmed) return;
  const key = locationKey(trimmed);
  try {
    if (isProduction) {
      await withPgClient(async (client) => {
        await client.query(
          'INSERT INTO locations (name_key, display_name) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [key, trimmed]
        );
      });
    } else {
      await sqlitePrepareRun(
        'INSERT OR IGNORE INTO locations (name_key, display_name) VALUES (?, ?)',
        [key, trimmed]
      );
    }
  } catch (err) {
    console.error('Error saving location:', err);
    throw err;
  }
}

// Display names, ordered by the normalized key so SQLite and Postgres agree on the order.
async function getLocations() {
  try {
    if (isProduction) {
      const rows = await withPgClient(async (client) => {
        const result = await client.query('SELECT display_name FROM locations ORDER BY name_key');
        return result.rows;
      });
      return rows.map((row) => row.display_name);
    } else {
      const rows = await sqliteAll('SELECT display_name FROM locations ORDER BY name_key');
      return rows.map((row) => row.display_name);
    }
  } catch (err) {
    console.error('Error getting locations:', err);
    throw err;
  }
}

async function saveCourtImage(displayName, mimeType, imageData) {
  const trimmed = String(displayName == null ? '' : displayName).trim().replace(/\s+/g, ' ');
  if (!trimmed) return;
  const key = locationKey(trimmed);
  try {
    if (isProduction) {
      await withPgClient(async (client) => {
        await client.query(
          'UPDATE locations SET image_mime_type = $1, image_data = $2 WHERE name_key = $3',
          [mimeType, imageData, key]
        );
      });
    } else {
      await sqlitePrepareRun(
        'UPDATE locations SET image_mime_type = ?, image_data = ? WHERE name_key = ?',
        [mimeType, imageData, key]
      );
    }
  } catch (err) {
    console.error('Error saving court image:', err);
    throw err;
  }
}

async function getCourtImage(displayName) {
  const trimmed = String(displayName == null ? '' : displayName).trim().replace(/\s+/g, ' ');
  const key = locationKey(trimmed);
  try {
    if (isProduction) {
      return await withPgClient(async (client) => {
        const result = await client.query(
          'SELECT image_mime_type, image_data FROM locations WHERE name_key = $1',
          [key]
        );
        return result.rows[0] || null;
      });
    } else {
      return await sqliteGet(
        'SELECT image_mime_type, image_data FROM locations WHERE name_key = ?',
        [key]
      );
    }
  } catch (err) {
    console.error('Error getting court image:', err);
    throw err;
  }
}

async function getAllCourtImages() {
  try {
    if (isProduction) {
      return await withPgClient(async (client) => {
        const result = await client.query(
          'SELECT display_name, image_mime_type FROM locations WHERE image_data IS NOT NULL ORDER BY name_key'
        );
        return result.rows;
      });
    } else {
      return await sqliteAll(
        'SELECT display_name, image_mime_type FROM locations WHERE image_data IS NOT NULL ORDER BY name_key'
      );
    }
  } catch (err) {
    console.error('Error getting all court images:', err);
    throw err;
  }
}

async function saveCourtImageToLibrary(courtName, mimeType, imageData) {
  const trimmed = String(courtName == null ? '' : courtName).trim().replace(/\s+/g, ' ');
  if (!trimmed) return null;
  const key = locationKey(trimmed);
  const imageId = Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
  try {
    if (isProduction) {
      await withPgClient(async (client) => {
        await client.query(
          'INSERT INTO court_images (id, court_name_key, mime_type, image_data) VALUES ($1, $2, $3, $4)',
          [imageId, key, mimeType, imageData]
        );
      });
    } else {
      await sqlitePrepareRun(
        'INSERT INTO court_images (id, court_name_key, mime_type, image_data) VALUES (?, ?, ?, ?)',
        [imageId, key, mimeType, imageData]
      );
    }
    return imageId;
  } catch (err) {
    console.error('Error saving court image to library:', err);
    throw err;
  }
}

async function getCourtImagesLibrary(courtName) {
  const trimmed = String(courtName == null ? '' : courtName).trim().replace(/\s+/g, ' ');
  const key = locationKey(trimmed);
  try {
    if (isProduction) {
      return await withPgClient(async (client) => {
        const result = await client.query(
          'SELECT id, mime_type, created_at FROM court_images WHERE court_name_key = $1 ORDER BY created_at DESC',
          [key]
        );
        return result.rows;
      });
    } else {
      return await sqliteAll(
        'SELECT id, mime_type, created_at FROM court_images WHERE court_name_key = ? ORDER BY created_at DESC',
        [key]
      );
    }
  } catch (err) {
    console.error('Error getting court images library:', err);
    throw err;
  }
}

async function getCourtImageFromLibrary(imageId) {
  try {
    if (isProduction) {
      return await withPgClient(async (client) => {
        const result = await client.query(
          'SELECT mime_type, image_data FROM court_images WHERE id = $1',
          [imageId]
        );
        return result.rows[0] || null;
      });
    } else {
      return await sqliteGet(
        'SELECT mime_type, image_data FROM court_images WHERE id = ?',
        [imageId]
      );
    }
  } catch (err) {
    console.error('Error getting court image from library:', err);
    throw err;
  }
}

async function deleteCourtImageFromLibrary(imageId) {
  try {
    if (isProduction) {
      await withPgClient(async (client) => {
        await client.query('DELETE FROM court_images WHERE id = $1', [imageId]);
      });
    } else {
      await sqlitePrepareRun('DELETE FROM court_images WHERE id = ?', [imageId]);
    }
  } catch (err) {
    console.error('Error deleting court image from library:', err);
    throw err;
  }
}

async function setGameCourtImage(gameId, imageId) {
  try {
    if (isProduction) {
      await withPgClient(async (client) => {
        await client.query('UPDATE games SET court_image_id = $1 WHERE id = $2', [imageId, gameId]);
      });
    } else {
      await sqlitePrepareRun('UPDATE games SET court_image_id = ? WHERE id = ?', [imageId, gameId]);
    }
  } catch (err) {
    console.error('Error setting game court image:', err);
    throw err;
  }
}

async function getGameCourtImageId(gameId) {
  try {
    if (isProduction) {
      return await withPgClient(async (client) => {
        const result = await client.query('SELECT court_image_id FROM games WHERE id = $1', [gameId]);
        return result.rows[0]?.court_image_id || null;
      });
    } else {
      const row = await sqliteGet('SELECT court_image_id FROM games WHERE id = ?', [gameId]);
      return row?.court_image_id || null;
    }
  } catch (err) {
    console.error('Error getting game court image:', err);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Game photo functions
//
// The image bytes are only ever read by getPhoto(). Every other query deliberately leaves
// the data column out, so listing a game's photos does not drag megabytes through memory.
// ---------------------------------------------------------------------------

async function savePhoto(photoId, gameId, mimeType, dataBuffer, caption) {
  try {
    if (isProduction) {
      await withPgClient(async (client) => {
        await client.query(
          'INSERT INTO game_photos (id, game_id, mime_type, data, caption) VALUES ($1, $2, $3, $4, $5)',
          [photoId, gameId, mimeType, dataBuffer, caption || null]
        );
      });
    } else {
      await sqlitePrepareRun(
        'INSERT INTO game_photos (id, game_id, mime_type, data, caption) VALUES (?, ?, ?, ?, ?)',
        [photoId, gameId, mimeType, dataBuffer, caption || null]
      );
    }
  } catch (err) {
    console.error('Error saving photo:', err);
    throw err;
  }
}

/** Metadata only - never the image bytes. */
async function getPhotosForGame(gameId) {
  const toPhoto = (row) => ({
    id: row.id,
    mimeType: row.mime_type,
    caption: row.caption || '',
    bytes: Number(row.bytes),
    createdAt: row.created_at
  });
  try {
    if (isProduction) {
      const rows = await withPgClient(async (client) => {
        const result = await client.query(
          `SELECT id, mime_type, caption, created_at, LENGTH(data) AS bytes
             FROM game_photos WHERE game_id = $1 ORDER BY created_at, id`,
          [gameId]
        );
        return result.rows;
      });
      return rows.map(toPhoto);
    } else {
      const rows = await sqliteAll(
        `SELECT id, mime_type, caption, created_at, LENGTH(data) AS bytes
           FROM game_photos WHERE game_id = ? ORDER BY created_at, id`,
        [gameId]
      );
      return rows.map(toPhoto);
    }
  } catch (err) {
    console.error('Error listing photos:', err);
    throw err;
  }
}

/** game_id is in the WHERE clause on purpose: a photo id from one game cannot be fetched
 *  by guessing it against another. */
async function getPhoto(gameId, photoId) {
  try {
    if (isProduction) {
      const rows = await withPgClient(async (client) => {
        const result = await client.query(
          'SELECT mime_type, data FROM game_photos WHERE game_id = $1 AND id = $2',
          [gameId, photoId]
        );
        return result.rows;
      });
      return rows.length ? { mimeType: rows[0].mime_type, data: rows[0].data } : null;
    } else {
      const row = await sqliteGet(
        'SELECT mime_type, data FROM game_photos WHERE game_id = ? AND id = ?',
        [gameId, photoId]
      );
      return row ? { mimeType: row.mime_type, data: row.data } : null;
    }
  } catch (err) {
    console.error('Error getting photo:', err);
    throw err;
  }
}

/** Returns how many rows were removed, so the caller can 404 on a photo that was not there. */
async function deletePhoto(gameId, photoId) {
  try {
    if (isProduction) {
      return await withPgClient(async (client) => {
        const result = await client.query(
          'DELETE FROM game_photos WHERE game_id = $1 AND id = $2',
          [gameId, photoId]
        );
        return result.rowCount;
      });
    } else {
      const result = await sqliteRun(
        'DELETE FROM game_photos WHERE game_id = ? AND id = ?',
        [gameId, photoId]
      );
      return result.changes;
    }
  } catch (err) {
    console.error('Error deleting photo:', err);
    throw err;
  }
}

async function countPhotosForGame(gameId) {
  try {
    if (isProduction) {
      const rows = await withPgClient(async (client) => {
        const result = await client.query(
          'SELECT COUNT(*) AS count FROM game_photos WHERE game_id = $1', [gameId]
        );
        return result.rows;
      });
      return Number(rows[0].count);
    } else {
      const row = await sqliteGet('SELECT COUNT(*) AS count FROM game_photos WHERE game_id = ?', [gameId]);
      return Number(row.count);
    }
  } catch (err) {
    console.error('Error counting photos:', err);
    throw err;
  }
}

/** One query for the whole My Games page, rather than one per card. */
async function getAllPhotoCounts() {
  try {
    const rows = isProduction
      ? await withPgClient(async (client) => {
          const result = await client.query('SELECT game_id, COUNT(*) AS count FROM game_photos GROUP BY game_id');
          return result.rows;
        })
      : await sqliteAll('SELECT game_id, COUNT(*) AS count FROM game_photos GROUP BY game_id');

    const counts = {};
    rows.forEach((row) => { counts[row.game_id] = Number(row.count); });
    return counts;
  } catch (err) {
    console.error('Error counting photos:', err);
    throw err;
  }
}

module.exports = {
  addLocation,
  getLocations,
  saveCourtImage,
  getCourtImage,
  getAllCourtImages,
  saveCourtImageToLibrary,
  getCourtImagesLibrary,
  getCourtImageFromLibrary,
  deleteCourtImageFromLibrary,
  setGameCourtImage,
  getGameCourtImageId,
  savePhoto,
  getPhotosForGame,
  getPhoto,
  deletePhoto,
  countPhotosForGame,
  getAllPhotoCounts
};
