const { isProduction, pool, sqliteRun, sqlitePrepareRun } = require('./context');

// ---------------------------------------------------------------------------
// Locations
// ---------------------------------------------------------------------------

// The courts this friend group already plays at. Seeded on every boot so a fresh
// database (or a new deploy) always offers them in the create-game picker.
const SEED_LOCATIONS = [
  'Homoly Home Court',
  'Chicken and Pickle',
  'JustPaddles',
  'Char Bar',
  'Argosy'
];

// The primary key. " chicken AND pickle " and "Chicken and Pickle" are the same court,
// so the key is trimmed, whitespace-collapsed and lowercased. The first spelling anybody
// types is the one everyone sees (display_name is never overwritten).
function locationKey(displayName) {
  return String(displayName == null ? '' : displayName).trim().replace(/\s+/g, ' ').toLowerCase();
}

// Remove the old court from existing databases and do not remember it again if an older
// game at that location is edited. Include the historical misspellings as well as the
// spelling shown in the picker.
const RETIRED_LOCATION_KEYS = new Set(['wimbledom', 'wimbledon', 'wimbleton']);

function isRetiredLocation(displayName) {
  return RETIRED_LOCATION_KEYS.has(locationKey(displayName));
}

// ---------------------------------------------------------------------------
// Initialize database
// ---------------------------------------------------------------------------

async function initializeDatabase() {
  try {
    if (isProduction) {
      const client = await pool.connect();
      try {
        await client.query(`
          CREATE TABLE IF NOT EXISTS games (
            id TEXT PRIMARY KEY,
            data JSONB NOT NULL,
            host_token TEXT NOT NULL,
            host_phone TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `);
        await client.query(`
          CREATE TABLE IF NOT EXISTS sms_contexts (
            phone_number TEXT PRIMARY KEY,
            last_command TEXT NOT NULL,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `);
        await client.query(`
          CREATE TABLE IF NOT EXISTS reminder_log (
            game_id TEXT NOT NULL,
            player_phone TEXT NOT NULL,
            reminder_type TEXT NOT NULL,
            sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (game_id, player_phone, reminder_type)
          )
        `);
        await client.query(`
          CREATE TABLE IF NOT EXISTS locations (
            name_key TEXT PRIMARY KEY,
            display_name TEXT NOT NULL,
            image_mime_type TEXT,
            image_data BYTEA,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `);
        // The image columns above only get created on a database that has never had a
        // locations table. Production has had one since long before court images existed, and
        // CREATE TABLE IF NOT EXISTS does nothing to a table that is already there - so on
        // Postgres those two columns were never actually added, and every query naming them
        // failed with 'column "image_mime_type" does not exist'. Add them the same idempotent
        // way games.court_image_id is added below.
        for (const [column, type] of [['image_mime_type', 'TEXT'], ['image_data', 'BYTEA']]) {
          try {
            await client.query(`ALTER TABLE locations ADD COLUMN ${column} ${type}`);
          } catch (err) {
            if (!err.message.includes('already exists')) {
              throw err;
            }
          }
        }
        for (const nameKey of RETIRED_LOCATION_KEYS) {
          await client.query('DELETE FROM locations WHERE name_key = $1', [nameKey]);
        }
        for (const displayName of SEED_LOCATIONS) {
          await client.query(
            'INSERT INTO locations (name_key, display_name) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [locationKey(displayName), displayName]
          );
        }
        await client.query(`
          CREATE TABLE IF NOT EXISTS host_roster (
            host_phone TEXT NOT NULL,
            player_phone TEXT NOT NULL,
            name TEXT,
            dupr_id TEXT,
            dupr_rating REAL,
            is_android INTEGER,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (host_phone, player_phone)
          )
        `);
        // Render gives the app no persistent disk, so photos live in the database.
        await client.query(`
          CREATE TABLE IF NOT EXISTS game_photos (
            id TEXT PRIMARY KEY,
            game_id TEXT NOT NULL,
            mime_type TEXT NOT NULL,
            data BYTEA NOT NULL,
            caption TEXT,
            uploader_name TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `);
        await client.query('CREATE INDEX IF NOT EXISTS idx_game_photos_game ON game_photos (game_id)');

        await client.query(`
          CREATE TABLE IF NOT EXISTS court_images (
            id TEXT PRIMARY KEY,
            court_name_key TEXT NOT NULL,
            mime_type TEXT NOT NULL,
            image_data BYTEA NOT NULL,
            uploader_name TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `);
        await client.query('CREATE INDEX IF NOT EXISTS idx_court_images_court ON court_images (court_name_key)');
        for (const table of ['game_photos', 'court_images']) {
          try {
            await client.query(`ALTER TABLE ${table} ADD COLUMN uploader_name TEXT`);
          } catch (err) {
            if (!err.message.includes('already exists')) {
              throw err;
            }
          }
        }

        // Add column to games table for selected court image (if it doesn't exist)
        try {
          await client.query(`ALTER TABLE games ADD COLUMN court_image_id TEXT`);
        } catch (err) {
          if (!err.message.includes('already exists')) {
            throw err;
          }
        }

        // Developer area: the idea board, the error log and the published doc pages.
        await client.query(`
          CREATE TABLE IF NOT EXISTS dev_notes (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            body TEXT DEFAULT '',
            status TEXT DEFAULT 'idea',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `);
        await client.query(`
          CREATE TABLE IF NOT EXISTS app_errors (
            id TEXT PRIMARY KEY,
            source TEXT NOT NULL,
            message TEXT NOT NULL,
            stack TEXT,
            page TEXT,
            user_agent TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `);
        await client.query('CREATE INDEX IF NOT EXISTS idx_app_errors_created ON app_errors (created_at)');
        await client.query(`
          CREATE TABLE IF NOT EXISTS sms_events (
            id TEXT PRIMARY KEY,
            event_id TEXT NOT NULL,
            game_id TEXT,
            recipient_hash TEXT NOT NULL,
            status TEXT NOT NULL,
            attempts INTEGER NOT NULL DEFAULT 1,
            error TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `);
        await client.query('CREATE INDEX IF NOT EXISTS idx_sms_events_created ON sms_events (created_at)');
        await client.query('CREATE INDEX IF NOT EXISTS idx_sms_events_event ON sms_events (event_id)');
        // Same reason as photos: no persistent disk, so the generated doc pages live here.
        await client.query(`
          CREATE TABLE IF NOT EXISTS dev_assets (
            name TEXT PRIMARY KEY,
            content TEXT NOT NULL,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `);
        await client.query(`
          CREATE TABLE IF NOT EXISTS message_personalities (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            generation_guidance TEXT NOT NULL DEFAULT '',
            enabled BOOLEAN NOT NULL DEFAULT FALSE,
            is_default BOOLEAN NOT NULL DEFAULT FALSE,
            locked_percent INTEGER NOT NULL DEFAULT 40 CHECK (locked_percent BETWEEN 0 AND 100),
            fresh_pool_minimum INTEGER NOT NULL DEFAULT 10 CHECK (fresh_pool_minimum >= 0),
            generation_batch_size INTEGER NOT NULL DEFAULT 10 CHECK (generation_batch_size > 0),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `);
        await client.query(`
          CREATE UNIQUE INDEX IF NOT EXISTS idx_message_personalities_one_default
          ON message_personalities ((is_default))
          WHERE is_default = TRUE
        `);
        await client.query(`
          CREATE TABLE IF NOT EXISTS personality_surface_settings (
            personality_id TEXT NOT NULL REFERENCES message_personalities(id),
            surface_id TEXT NOT NULL,
            enabled BOOLEAN NOT NULL DEFAULT FALSE,
            locked_percent_override INTEGER CHECK (
              locked_percent_override IS NULL OR locked_percent_override BETWEEN 0 AND 100
            ),
            fresh_pool_minimum_override INTEGER CHECK (
              fresh_pool_minimum_override IS NULL OR fresh_pool_minimum_override >= 0
            ),
            auto_publish_generated BOOLEAN NOT NULL DEFAULT FALSE,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (personality_id, surface_id)
          )
        `);
        await client.query(`
          CREATE TABLE IF NOT EXISTS message_codex_prompts (
            personality_id TEXT NOT NULL REFERENCES message_personalities(id) ON DELETE CASCADE,
            surface_id TEXT NOT NULL,
            sections TEXT NOT NULL,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (personality_id, surface_id)
          )
        `);
        await client.query(`
          CREATE TABLE IF NOT EXISTS message_target_rules (
            id TEXT PRIMARY KEY,
            personality_id TEXT NOT NULL REFERENCES message_personalities(id),
            target_phone TEXT NOT NULL,
            target_display_name TEXT NOT NULL DEFAULT '',
            game_id TEXT,
            trigger_status TEXT NOT NULL CHECK (
              trigger_status IN ('confirmed', 'waitlisted', 'applicant', 'out', 'any-known')
            ),
            surface_id TEXT NOT NULL,
            audience TEXT NOT NULL CHECK (
              audience IN ('target-only', 'confirmed', 'known-game-audience', 'invitation-copy')
            ),
            mode TEXT NOT NULL CHECK (mode IN ('exact', 'direction')),
            exact_text TEXT,
            generation_direction TEXT,
            enabled BOOLEAN NOT NULL DEFAULT FALSE,
            starts_at TIMESTAMP,
            ends_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `);
        await client.query(`
          CREATE TABLE IF NOT EXISTS randomizer_messages (
            id TEXT PRIMARY KEY,
            personality_id TEXT NOT NULL REFERENCES message_personalities(id),
            surface_id TEXT NOT NULL,
            text TEXT NOT NULL,
            normalized_text TEXT NOT NULL,
            source TEXT NOT NULL CHECK (source IN ('migrated', 'manual', 'generated')),
            status TEXT NOT NULL CHECK (status IN ('draft', 'active', 'archived')),
            locked BOOLEAN NOT NULL DEFAULT FALSE,
            vetted BOOLEAN NOT NULL DEFAULT FALSE,
            target_rule_id TEXT REFERENCES message_target_rules(id) ON DELETE SET NULL,
            generation_direction TEXT,
            generator_name TEXT,
            generator_version TEXT,
            prompt_version TEXT,
            usage_count INTEGER NOT NULL DEFAULT 0,
            last_used_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE (personality_id, surface_id, normalized_text)
          )
        `);
        await client.query(
          'CREATE INDEX IF NOT EXISTS idx_randomizer_messages_pool ON randomizer_messages (personality_id, surface_id, status, locked)'
        );
        await client.query(`
          CREATE TABLE IF NOT EXISTS message_selection_events (
            id TEXT PRIMARY KEY,
            message_id TEXT REFERENCES randomizer_messages(id) ON DELETE SET NULL,
            personality_id TEXT NOT NULL REFERENCES message_personalities(id),
            surface_id TEXT NOT NULL,
            game_id TEXT,
            recipient_hash TEXT,
            target_rule_id TEXT REFERENCES message_target_rules(id) ON DELETE SET NULL,
            source_bucket TEXT NOT NULL CHECK (
              source_bucket IN ('exact-target', 'directed-target', 'locked', 'fresh', 'fallback')
            ),
            selected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `);
        await client.query(
          'CREATE INDEX IF NOT EXISTS idx_message_selections_scope ON message_selection_events (personality_id, surface_id, selected_at DESC)'
        );
        console.log('PostgreSQL tables initialized');
      } finally {
        client.release();
      }
    } else {
      await sqliteRun(`CREATE TABLE IF NOT EXISTS games (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        host_token TEXT NOT NULL,
        host_phone TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);
      console.log('SQLite games table initialized');

      await sqliteRun(`CREATE TABLE IF NOT EXISTS sms_contexts (
        phone_number TEXT PRIMARY KEY,
        last_command TEXT NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);
      console.log('SQLite sms_contexts table initialized');

      await sqliteRun(`CREATE TABLE IF NOT EXISTS reminder_log (
        game_id TEXT NOT NULL,
        player_phone TEXT NOT NULL,
        reminder_type TEXT NOT NULL,
        sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (game_id, player_phone, reminder_type)
      )`);
      console.log('SQLite reminder_log table initialized');

      await sqliteRun(`CREATE TABLE IF NOT EXISTS locations (
        name_key TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        image_mime_type TEXT,
        image_data BLOB,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);
      // Same idempotent add as the Postgres branch: a pickleball.db created before court
      // images existed has a locations table without these two columns, and the CREATE above
      // will not add them to a table that is already there.
      for (const [column, type] of [['image_mime_type', 'TEXT'], ['image_data', 'BLOB']]) {
        try {
          await sqliteRun(`ALTER TABLE locations ADD COLUMN ${column} ${type}`);
        } catch (err) {
          if (!err.message.includes('duplicate column')) {
            throw err;
          }
        }
      }
      for (const nameKey of RETIRED_LOCATION_KEYS) {
        await sqlitePrepareRun('DELETE FROM locations WHERE name_key = ?', [nameKey]);
      }
      for (const displayName of SEED_LOCATIONS) {
        await sqlitePrepareRun(
          'INSERT OR IGNORE INTO locations (name_key, display_name) VALUES (?, ?)',
          [locationKey(displayName), displayName]
        );
      }
      console.log('SQLite locations table initialized');

      await sqliteRun(`CREATE TABLE IF NOT EXISTS host_roster (
        host_phone TEXT NOT NULL,
        player_phone TEXT NOT NULL,
        name TEXT,
        dupr_id TEXT,
        dupr_rating REAL,
        is_android INTEGER,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (host_phone, player_phone)
      )`);
      console.log('SQLite host_roster table initialized');

      // Render gives the app no persistent disk, so photos live in the database.
      await sqliteRun(`CREATE TABLE IF NOT EXISTS game_photos (
        id TEXT PRIMARY KEY,
        game_id TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        data BLOB NOT NULL,
        caption TEXT,
        uploader_name TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);
      await sqliteRun('CREATE INDEX IF NOT EXISTS idx_game_photos_game ON game_photos (game_id)');
      console.log('SQLite game_photos table initialized');

      await sqliteRun(`CREATE TABLE IF NOT EXISTS court_images (
        id TEXT PRIMARY KEY,
        court_name_key TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        image_data BLOB NOT NULL,
        uploader_name TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);
      await sqliteRun('CREATE INDEX IF NOT EXISTS idx_court_images_court ON court_images (court_name_key)');
      console.log('SQLite court_images table initialized');
      for (const table of ['game_photos', 'court_images']) {
        try {
          await sqliteRun(`ALTER TABLE ${table} ADD COLUMN uploader_name TEXT`);
        } catch (err) {
          if (!err.message.includes('duplicate column')) {
            throw err;
          }
        }
      }

      // Add column to games table for selected court image
      try {
        await sqliteRun(`ALTER TABLE games ADD COLUMN court_image_id TEXT`);
        console.log('Added court_image_id column to games table');
      } catch (err) {
        // Column already exists, that's fine
        if (!err.message.includes('duplicate column')) {
          throw err;
        }
      }

      // Developer area: the idea board, the error log and the published doc pages.
      await sqliteRun(`CREATE TABLE IF NOT EXISTS dev_notes (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        body TEXT DEFAULT '',
        status TEXT DEFAULT 'idea',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);
      await sqliteRun(`CREATE TABLE IF NOT EXISTS app_errors (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        message TEXT NOT NULL,
        stack TEXT,
        page TEXT,
        user_agent TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);
      await sqliteRun('CREATE INDEX IF NOT EXISTS idx_app_errors_created ON app_errors (created_at)');
      await sqliteRun(`CREATE TABLE IF NOT EXISTS sms_events (
        id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL,
        game_id TEXT,
        recipient_hash TEXT NOT NULL,
        status TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 1,
        error TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);
      await sqliteRun('CREATE INDEX IF NOT EXISTS idx_sms_events_created ON sms_events (created_at)');
      await sqliteRun('CREATE INDEX IF NOT EXISTS idx_sms_events_event ON sms_events (event_id)');
      // Same reason as photos: no persistent disk, so the generated doc pages live here.
      await sqliteRun(`CREATE TABLE IF NOT EXISTS dev_assets (
        name TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);
      await sqliteRun(`CREATE TABLE IF NOT EXISTS message_personalities (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        generation_guidance TEXT NOT NULL DEFAULT '',
        enabled INTEGER NOT NULL DEFAULT 0,
        is_default INTEGER NOT NULL DEFAULT 0,
        locked_percent INTEGER NOT NULL DEFAULT 40 CHECK (locked_percent BETWEEN 0 AND 100),
        fresh_pool_minimum INTEGER NOT NULL DEFAULT 10 CHECK (fresh_pool_minimum >= 0),
        generation_batch_size INTEGER NOT NULL DEFAULT 10 CHECK (generation_batch_size > 0),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);
      await sqliteRun(`CREATE UNIQUE INDEX IF NOT EXISTS idx_message_personalities_one_default
        ON message_personalities (is_default) WHERE is_default = 1`);
      await sqliteRun(`CREATE TABLE IF NOT EXISTS personality_surface_settings (
        personality_id TEXT NOT NULL REFERENCES message_personalities(id),
        surface_id TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 0,
        locked_percent_override INTEGER CHECK (
          locked_percent_override IS NULL OR locked_percent_override BETWEEN 0 AND 100
        ),
        fresh_pool_minimum_override INTEGER CHECK (
          fresh_pool_minimum_override IS NULL OR fresh_pool_minimum_override >= 0
        ),
        auto_publish_generated INTEGER NOT NULL DEFAULT 0,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (personality_id, surface_id)
      )`);
      await sqliteRun(`CREATE TABLE IF NOT EXISTS message_codex_prompts (
        personality_id TEXT NOT NULL REFERENCES message_personalities(id) ON DELETE CASCADE,
        surface_id TEXT NOT NULL,
        sections TEXT NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (personality_id, surface_id)
      )`);
      await sqliteRun(`CREATE TABLE IF NOT EXISTS message_target_rules (
        id TEXT PRIMARY KEY,
        personality_id TEXT NOT NULL REFERENCES message_personalities(id),
        target_phone TEXT NOT NULL,
        target_display_name TEXT NOT NULL DEFAULT '',
        game_id TEXT,
        trigger_status TEXT NOT NULL CHECK (
          trigger_status IN ('confirmed', 'waitlisted', 'applicant', 'out', 'any-known')
        ),
        surface_id TEXT NOT NULL,
        audience TEXT NOT NULL CHECK (
          audience IN ('target-only', 'confirmed', 'known-game-audience', 'invitation-copy')
        ),
        mode TEXT NOT NULL CHECK (mode IN ('exact', 'direction')),
        exact_text TEXT,
        generation_direction TEXT,
        enabled INTEGER NOT NULL DEFAULT 0,
        starts_at DATETIME,
        ends_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);
      await sqliteRun(`CREATE TABLE IF NOT EXISTS randomizer_messages (
        id TEXT PRIMARY KEY,
        personality_id TEXT NOT NULL REFERENCES message_personalities(id),
        surface_id TEXT NOT NULL,
        text TEXT NOT NULL,
        normalized_text TEXT NOT NULL,
        source TEXT NOT NULL CHECK (source IN ('migrated', 'manual', 'generated')),
        status TEXT NOT NULL CHECK (status IN ('draft', 'active', 'archived')),
        locked INTEGER NOT NULL DEFAULT 0,
        vetted INTEGER NOT NULL DEFAULT 0,
        target_rule_id TEXT REFERENCES message_target_rules(id) ON DELETE SET NULL,
        generation_direction TEXT,
        generator_name TEXT,
        generator_version TEXT,
        prompt_version TEXT,
        usage_count INTEGER NOT NULL DEFAULT 0,
        last_used_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (personality_id, surface_id, normalized_text)
      )`);
      await sqliteRun(
        'CREATE INDEX IF NOT EXISTS idx_randomizer_messages_pool ON randomizer_messages (personality_id, surface_id, status, locked)'
      );
      await sqliteRun(`CREATE TABLE IF NOT EXISTS message_selection_events (
        id TEXT PRIMARY KEY,
        message_id TEXT REFERENCES randomizer_messages(id) ON DELETE SET NULL,
        personality_id TEXT NOT NULL REFERENCES message_personalities(id),
        surface_id TEXT NOT NULL,
        game_id TEXT,
        recipient_hash TEXT,
        target_rule_id TEXT REFERENCES message_target_rules(id) ON DELETE SET NULL,
        source_bucket TEXT NOT NULL CHECK (
          source_bucket IN ('exact-target', 'directed-target', 'locked', 'fresh', 'fallback')
        ),
        selected_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);
      await sqliteRun(
        'CREATE INDEX IF NOT EXISTS idx_message_selections_scope ON message_selection_events (personality_id, surface_id, selected_at DESC)'
      );
      console.log('SQLite dev tables initialized');
    }
    const { seedRealistAndMigrateSavedMessages } = require('./message-randomizer');
    const migration = await seedRealistAndMigrateSavedMessages();
    console.log(`Message Randomizer migration ready (${migration.total} vetted messages)`);
  } catch (err) {
    console.error('Database initialization error:', err);
    throw err;
  }
}

module.exports = { initializeDatabase, locationKey, isRetiredLocation };
