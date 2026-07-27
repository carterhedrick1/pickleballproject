const { isProduction, withPgClient, sqliteAll, sqliteGet, sqliteRun, sqlitePrepareRun } = require('./context');

// ---------------------------------------------------------------------------
// SMS context functions
// ---------------------------------------------------------------------------

async function saveLastCommand(phoneNumber, context) {
  try {
    if (isProduction) {
      await withPgClient(async (client) => {
        await client.query(`
          INSERT INTO sms_contexts (phone_number, last_command, updated_at)
          VALUES ($1, $2, CURRENT_TIMESTAMP)
          ON CONFLICT (phone_number)
          DO UPDATE SET last_command = $2, updated_at = CURRENT_TIMESTAMP
        `, [phoneNumber, context]);
      });
    } else {
      await sqlitePrepareRun(`
        INSERT OR REPLACE INTO sms_contexts (phone_number, last_command, updated_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
      `, [phoneNumber, context]);
    }
    console.log(`[SMS Context] Saved context for ${phoneNumber}: ${context}`);
  } catch (err) {
    console.error('Error saving SMS context:', err);
    throw err;
  }
}

async function getLastCommand(phoneNumber) {
  try {
    if (isProduction) {
      const rows = await withPgClient(async (client) => {
        const result = await client.query('SELECT last_command FROM sms_contexts WHERE phone_number = $1', [phoneNumber]);
        return result.rows;
      });
      const context = rows.length > 0 ? rows[0].last_command : null;
      console.log(`[SMS Context] Retrieved context for ${phoneNumber}: ${context}`);
      return context;
    } else {
      const row = await sqliteGet('SELECT last_command FROM sms_contexts WHERE phone_number = ?', [phoneNumber]);
      const context = row ? row.last_command : null;
      console.log(`[SMS Context] Retrieved context for ${phoneNumber}: ${context}`);
      return context;
    }
  } catch (err) {
    console.error('Error getting SMS context:', err);
    throw err;
  }
}

async function clearLastCommand(phoneNumber) {
  try {
    if (isProduction) {
      await withPgClient(async (client) => {
        await client.query('DELETE FROM sms_contexts WHERE phone_number = $1', [phoneNumber]);
      });
    } else {
      await sqliteRun('DELETE FROM sms_contexts WHERE phone_number = ?', [phoneNumber]);
    }
    console.log(`[SMS Context] Cleared context for ${phoneNumber}`);
  } catch (err) {
    console.error('Error clearing SMS context:', err);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Reminder tracking functions
// ---------------------------------------------------------------------------

async function hasReminderBeenSent(gameId, playerPhone, reminderType) {
  try {
    if (isProduction) {
      const rows = await withPgClient(async (client) => {
        const result = await client.query(
          'SELECT 1 FROM reminder_log WHERE game_id = $1 AND player_phone = $2 AND reminder_type = $3',
          [gameId, playerPhone, reminderType]
        );
        return result.rows;
      });
      return rows.length > 0;
    } else {
      const row = await sqliteGet(
        'SELECT 1 FROM reminder_log WHERE game_id = ? AND player_phone = ? AND reminder_type = ?',
        [gameId, playerPhone, reminderType]
      );
      return !!row;
    }
  } catch (err) {
    console.error('Error checking reminder status:', err);
    throw err;
  }
}

async function markReminderSent(gameId, playerPhone, reminderType) {
  try {
    if (isProduction) {
      await withPgClient(async (client) => {
        await client.query(
          'INSERT INTO reminder_log (game_id, player_phone, reminder_type) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
          [gameId, playerPhone, reminderType]
        );
      });
    } else {
      await sqlitePrepareRun(`
        INSERT OR IGNORE INTO reminder_log (game_id, player_phone, reminder_type)
        VALUES (?, ?, ?)
      `, [gameId, playerPhone, reminderType]);
    }
    console.log(`[REMINDER] Marked ${reminderType} reminder sent for game ${gameId}, player ${playerPhone}`);
  } catch (err) {
    console.error('Error marking reminder sent:', err);
    throw err;
  }
}

module.exports = {
  saveLastCommand,
  getLastCommand,
  clearLastCommand,
  hasReminderBeenSent,
  markReminderSent
};
