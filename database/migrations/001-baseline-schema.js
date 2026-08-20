/**
 * The schema as it stood on 2026-08-20, when explicit migrations were introduced.
 *
 * This is a transcription of the CREATE statements that `database/schema.js` used to run on
 * every boot, so it is a no-op against production (which has had these tables for months)
 * and builds the same schema from nothing on a fresh database. Every statement is still
 * IF NOT EXISTS for that reason: the first run against an existing database has to find
 * everything already there and simply record itself as applied.
 *
 * New changes do NOT belong in here. Add a numbered migration alongside this one.
 */

const POSTGRES_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS games (
    id TEXT PRIMARY KEY,
    data JSONB NOT NULL,
    host_token TEXT NOT NULL,
    host_phone TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  // My Games, Roster, and Stats all look games up by the host's phone.
  'CREATE INDEX IF NOT EXISTS idx_games_host_phone ON games (host_phone)',
  `CREATE TABLE IF NOT EXISTS sms_contexts (
    phone_number TEXT PRIMARY KEY,
    last_command TEXT NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS reminder_log (
    game_id TEXT NOT NULL,
    player_phone TEXT NOT NULL,
    reminder_type TEXT NOT NULL,
    sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (game_id, player_phone, reminder_type)
  )`,
  `CREATE TABLE IF NOT EXISTS locations (
    name_key TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    image_mime_type TEXT,
    image_data BYTEA,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS host_roster (
    host_phone TEXT NOT NULL,
    player_phone TEXT NOT NULL,
    name TEXT,
    dupr_id TEXT,
    dupr_rating REAL,
    is_android INTEGER,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (host_phone, player_phone)
  )`,
  // Render gives the app no persistent disk, so photos live in the database.
  `CREATE TABLE IF NOT EXISTS game_photos (
    id TEXT PRIMARY KEY,
    game_id TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    data BYTEA NOT NULL,
    caption TEXT,
    uploader_name TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  'CREATE INDEX IF NOT EXISTS idx_game_photos_game ON game_photos (game_id)',
  `CREATE TABLE IF NOT EXISTS court_images (
    id TEXT PRIMARY KEY,
    court_name_key TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    image_data BYTEA NOT NULL,
    uploader_name TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  'CREATE INDEX IF NOT EXISTS idx_court_images_court ON court_images (court_name_key)',
  // Developer area: the idea board, the error log and the published doc pages.
  `CREATE TABLE IF NOT EXISTS dev_notes (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    body TEXT DEFAULT '',
    status TEXT DEFAULT 'idea',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS app_errors (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    message TEXT NOT NULL,
    stack TEXT,
    page TEXT,
    user_agent TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  'CREATE INDEX IF NOT EXISTS idx_app_errors_created ON app_errors (created_at)',
  `CREATE TABLE IF NOT EXISTS sms_events (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL,
    game_id TEXT,
    recipient_hash TEXT NOT NULL,
    status TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 1,
    error TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  'CREATE INDEX IF NOT EXISTS idx_sms_events_created ON sms_events (created_at)',
  'CREATE INDEX IF NOT EXISTS idx_sms_events_event ON sms_events (event_id)',
  // The host-facing delivery log reads one game at a time.
  'CREATE INDEX IF NOT EXISTS idx_sms_events_game ON sms_events (game_id)',
  // Same reason as photos: no persistent disk, so the generated doc pages live here.
  `CREATE TABLE IF NOT EXISTS dev_assets (
    name TEXT PRIMARY KEY,
    content TEXT NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS message_personalities (
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
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_message_personalities_one_default
   ON message_personalities ((is_default))
   WHERE is_default = TRUE`,
  `CREATE TABLE IF NOT EXISTS personality_surface_settings (
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
  )`,
  `CREATE TABLE IF NOT EXISTS message_codex_prompts (
    personality_id TEXT NOT NULL REFERENCES message_personalities(id) ON DELETE CASCADE,
    surface_id TEXT NOT NULL,
    sections TEXT NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (personality_id, surface_id)
  )`,
  `CREATE TABLE IF NOT EXISTS message_target_rules (
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
  )`,
  `CREATE TABLE IF NOT EXISTS randomizer_messages (
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
  )`,
  `CREATE INDEX IF NOT EXISTS idx_randomizer_messages_pool
   ON randomizer_messages (personality_id, surface_id, status, locked)`,
  `CREATE TABLE IF NOT EXISTS message_selection_events (
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
  )`,
  `CREATE INDEX IF NOT EXISTS idx_message_selections_scope
   ON message_selection_events (personality_id, surface_id, selected_at DESC)`
];

const SQLITE_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS games (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    host_token TEXT NOT NULL,
    host_phone TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,
  'CREATE INDEX IF NOT EXISTS idx_games_host_phone ON games (host_phone)',
  `CREATE TABLE IF NOT EXISTS sms_contexts (
    phone_number TEXT PRIMARY KEY,
    last_command TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS reminder_log (
    game_id TEXT NOT NULL,
    player_phone TEXT NOT NULL,
    reminder_type TEXT NOT NULL,
    sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (game_id, player_phone, reminder_type)
  )`,
  `CREATE TABLE IF NOT EXISTS locations (
    name_key TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    image_mime_type TEXT,
    image_data BLOB,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS host_roster (
    host_phone TEXT NOT NULL,
    player_phone TEXT NOT NULL,
    name TEXT,
    dupr_id TEXT,
    dupr_rating REAL,
    is_android INTEGER,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (host_phone, player_phone)
  )`,
  `CREATE TABLE IF NOT EXISTS game_photos (
    id TEXT PRIMARY KEY,
    game_id TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    data BLOB NOT NULL,
    caption TEXT,
    uploader_name TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,
  'CREATE INDEX IF NOT EXISTS idx_game_photos_game ON game_photos (game_id)',
  `CREATE TABLE IF NOT EXISTS court_images (
    id TEXT PRIMARY KEY,
    court_name_key TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    image_data BLOB NOT NULL,
    uploader_name TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,
  'CREATE INDEX IF NOT EXISTS idx_court_images_court ON court_images (court_name_key)',
  `CREATE TABLE IF NOT EXISTS dev_notes (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    body TEXT DEFAULT '',
    status TEXT DEFAULT 'idea',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS app_errors (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    message TEXT NOT NULL,
    stack TEXT,
    page TEXT,
    user_agent TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,
  'CREATE INDEX IF NOT EXISTS idx_app_errors_created ON app_errors (created_at)',
  `CREATE TABLE IF NOT EXISTS sms_events (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL,
    game_id TEXT,
    recipient_hash TEXT NOT NULL,
    status TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 1,
    error TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,
  'CREATE INDEX IF NOT EXISTS idx_sms_events_created ON sms_events (created_at)',
  'CREATE INDEX IF NOT EXISTS idx_sms_events_event ON sms_events (event_id)',
  'CREATE INDEX IF NOT EXISTS idx_sms_events_game ON sms_events (game_id)',
  `CREATE TABLE IF NOT EXISTS dev_assets (
    name TEXT PRIMARY KEY,
    content TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS message_personalities (
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
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_message_personalities_one_default
   ON message_personalities (is_default) WHERE is_default = 1`,
  `CREATE TABLE IF NOT EXISTS personality_surface_settings (
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
  )`,
  `CREATE TABLE IF NOT EXISTS message_codex_prompts (
    personality_id TEXT NOT NULL REFERENCES message_personalities(id) ON DELETE CASCADE,
    surface_id TEXT NOT NULL,
    sections TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (personality_id, surface_id)
  )`,
  `CREATE TABLE IF NOT EXISTS message_target_rules (
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
  )`,
  `CREATE TABLE IF NOT EXISTS randomizer_messages (
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
  )`,
  `CREATE INDEX IF NOT EXISTS idx_randomizer_messages_pool
   ON randomizer_messages (personality_id, surface_id, status, locked)`,
  `CREATE TABLE IF NOT EXISTS message_selection_events (
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
  )`,
  `CREATE INDEX IF NOT EXISTS idx_message_selections_scope
   ON message_selection_events (personality_id, surface_id, selected_at DESC)`
];

// Columns added to tables that existed before the feature did. CREATE TABLE IF NOT EXISTS
// does nothing to a table that is already there, so on a long-lived database these columns
// only ever arrive this way. (Production learned that the hard way: every query naming
// locations.image_mime_type failed until the ALTER was added.)
const ADDED_COLUMNS = [
  ['locations', 'image_mime_type', { postgres: 'TEXT', sqlite: 'TEXT' }],
  ['locations', 'image_data', { postgres: 'BYTEA', sqlite: 'BLOB' }],
  ['game_photos', 'uploader_name', { postgres: 'TEXT', sqlite: 'TEXT' }],
  ['court_images', 'uploader_name', { postgres: 'TEXT', sqlite: 'TEXT' }],
  ['games', 'court_image_id', { postgres: 'TEXT', sqlite: 'TEXT' }]
];

module.exports = {
  id: '001-baseline-schema',
  description: 'Tables, indexes and late-added columns as of 2026-08-20',
  async up(runner) {
    await runner.exec(runner.isPostgres ? POSTGRES_STATEMENTS : SQLITE_STATEMENTS);
    for (const [table, column, type] of ADDED_COLUMNS) {
      await runner.addColumnIfMissing(table, column, type);
    }
  }
};
