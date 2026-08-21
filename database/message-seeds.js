/**
 * Stage 3 of boot: filling the Message Randomizer pools for the Realist personality.
 *
 * Why this is not a numbered migration in ./migrations. These steps seed and repair *content*,
 * and each already records that it ran by writing a marker row into `dev_assets` - markers that
 * exist in production today. Moving them into the ordered list would make `schema_migrations`
 * the record of "has this run", and every database that already carries the dev_asset marker
 * would seed a second time. The ordered list stays for schema; content seeding keeps its own
 * markers. `database/schema.js` runs this as the named message-seeds stage.
 *
 * Everything here is written to be safe to run on every boot: markers short-circuit the work,
 * and the inserts that do run rely on the (personality_id, surface_id, normalized_text) unique
 * index to ignore anything already present.
 */

const crypto = require('crypto');
const { isProduction, withPgClient, sqliteGet, sqliteRun } = require('./context');
const { normalizeMessageText } = require('./message-rows');
const { listRandomizerMessages, updateRandomizerMessage } = require('./message-inventory');
const { MESSAGE_SURFACES } = require('../message-surfaces');
const sloganModule = require('../public/js/slogans');
const youreInMessages = require('../youre-in-messages');
const {
  REALIST_ID,
  MIGRATION_ASSET_NAME,
  VETTED_SLOGAN_REPAIR_ASSET_NAME,
  INVITATION_OPENING_DRAFT_ASSET_NAME,
  GAME_DETAILS_DRAFT_ASSET_NAME,
  PAGE_MOMENT_DRAFT_ASSET_NAME,
  REALIST_INVITATION_OPENING_DRAFTS,
  REALIST_GAME_DETAILS_DRAFTS,
  REALIST_PAGE_MOMENT_DRAFTS,
  LEGACY_V1_SLOGAN_REPLACEMENTS,
  DEFAULT_REALIST_DESCRIPTION,
  DEFAULT_REALIST_GUIDANCE
} = require('./realist-seed-copy');

// --- dev_assets access, the marker store these seeds run off -----------------------------

async function readDevAssetContent(name) {
  const row = isProduction
    ? await withPgClient(async (client) => (
        await client.query('SELECT content FROM dev_assets WHERE name = $1', [name])
      ).rows[0] || null)
    : await sqliteGet('SELECT content FROM dev_assets WHERE name = ?', [name]);
  return row ? row.content : null;
}

async function writeDevAsset(name, content) {
  if (isProduction) {
    await withPgClient((client) => client.query(`
      INSERT INTO dev_assets (name, content, updated_at)
      VALUES ($1, $2, CURRENT_TIMESTAMP)
      ON CONFLICT (name) DO UPDATE SET content = EXCLUDED.content, updated_at = CURRENT_TIMESTAMP
    `, [name, content]));
  } else {
    await sqliteRun(
      'INSERT OR REPLACE INTO dev_assets (name, content, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)',
      [name, content]
    );
  }
}

/**
 * The summary a previous run left behind, or null if this step has never run here.
 *
 * A marker this app wrote is always valid JSON, so an unparseable one means something else
 * wrote to that name. Letting it throw stops boot loudly rather than silently deciding the
 * step has or has not run - which is what the code this replaced did too.
 */
async function readSeedMarker(name) {
  const content = await readDevAssetContent(name);
  return content ? JSON.parse(content) : null;
}

const writeSeedMarker = (name, summary) => writeDevAsset(name, JSON.stringify(summary));

// --- the two shapes of seeded message ----------------------------------------------------

/** Owner-approved copy: active, locked and vetted, so it can be chosen immediately. */
async function insertMigratedMessage(personalityId, surfaceId, text) {
  const params = [crypto.randomUUID(), personalityId, surfaceId, text, normalizeMessageText(text)];
  if (isProduction) {
    await withPgClient((client) => client.query(`
      INSERT INTO randomizer_messages
        (id, personality_id, surface_id, text, normalized_text, source, status, locked, vetted)
      VALUES ($1, $2, $3, $4, $5, 'migrated', 'active', TRUE, TRUE)
      ON CONFLICT (personality_id, surface_id, normalized_text) DO NOTHING
    `, params));
  } else {
    await sqliteRun(`
      INSERT OR IGNORE INTO randomizer_messages
        (id, personality_id, surface_id, text, normalized_text, source, status, locked, vetted)
      VALUES (?, ?, ?, ?, ?, 'migrated', 'active', 1, 1)
    `, params);
  }
}

/** Proposed copy: a draft nobody has approved, so no player can ever be sent it. */
async function insertDraftMessage(personalityId, surfaceId, text) {
  const params = [crypto.randomUUID(), personalityId, surfaceId, text, normalizeMessageText(text)];
  if (isProduction) {
    await withPgClient((client) => client.query(`
      INSERT INTO randomizer_messages
        (id, personality_id, surface_id, text, normalized_text, source, status, locked, vetted)
      VALUES ($1, $2, $3, $4, $5, 'manual', 'draft', FALSE, FALSE)
      ON CONFLICT (personality_id, surface_id, normalized_text) DO NOTHING
    `, params));
  } else {
    await sqliteRun(`
      INSERT OR IGNORE INTO randomizer_messages
        (id, personality_id, surface_id, text, normalized_text, source, status, locked, vetted)
      VALUES (?, ?, ?, ?, ?, 'manual', 'draft', 0, 0)
    `, params);
  }
}

// --- the draft pools ---------------------------------------------------------------------

/**
 * Seeds one marker's worth of drafts. `entries` is [surfaceId, texts] pairs so the page-moment
 * pool, which spans three surfaces, uses the same path as the single-surface pools.
 */
async function seedDraftPool(assetName, entries, buildSummary) {
  const existing = await readSeedMarker(assetName);
  if (existing) return existing;

  let drafted = 0;
  for (const [surfaceId, texts] of entries) {
    for (const text of texts) {
      await insertDraftMessage(REALIST_ID, surfaceId, text);
      drafted++;
    }
  }

  const summary = buildSummary(drafted);
  await writeSeedMarker(assetName, summary);
  return summary;
}

function seedRealistInvitationOpeningDrafts() {
  return seedDraftPool(
    INVITATION_OPENING_DRAFT_ASSET_NAME,
    [['invitation-opening', REALIST_INVITATION_OPENING_DRAFTS]],
    (drafts) => ({
      version: 1,
      personalityId: REALIST_ID,
      surfaceId: 'invitation-opening',
      drafts,
      seededAt: new Date().toISOString()
    })
  );
}

function seedRealistGameDetailsDrafts() {
  return seedDraftPool(
    GAME_DETAILS_DRAFT_ASSET_NAME,
    [['game-details', REALIST_GAME_DETAILS_DRAFTS]],
    (drafts) => ({
      version: 1,
      personalityId: REALIST_ID,
      surfaceId: 'game-details',
      drafts,
      seededAt: new Date().toISOString()
    })
  );
}

function seedRealistPageMomentDrafts() {
  return seedDraftPool(
    PAGE_MOMENT_DRAFT_ASSET_NAME,
    Object.entries(REALIST_PAGE_MOMENT_DRAFTS),
    (drafts) => ({
      version: 1,
      personalityId: REALIST_ID,
      surfaces: Object.keys(REALIST_PAGE_MOMENT_DRAFTS),
      drafts,
      seededAt: new Date().toISOString()
    })
  );
}

// --- legacy copy, migration and repair ---------------------------------------------------

/**
 * The owner's saved slogan and You're IN copy, as the pools should start out. Falls back to
 * the shipped defaults when an asset is missing or unparseable, because a boot that throws
 * here would take the whole app down over a bad JSON blob.
 */
function readMigrationCopy({ sloganAsset = null, youreInAsset = null } = {}) {
  let sloganConfig = sloganModule.normalizeConfig();
  let youreInConfig = youreInMessages.normalizeConfig();
  try {
    if (sloganAsset) {
      sloganConfig = sloganModule.normalizeConfig(JSON.parse(sloganAsset));
    }
  } catch (error) {
    console.error('Could not parse saved slogans for Message Randomizer migration:', error.message);
  }
  try {
    if (youreInAsset) {
      youreInConfig = youreInMessages.normalizeConfig(JSON.parse(youreInAsset));
    }
  } catch (error) {
    console.error('Could not parse saved You’re In copy for Message Randomizer migration:', error.message);
  }
  return {
    slogans: sloganConfig.slogans,
    youreIn: youreInConfig.messages,
    youreInDetailsTemplate: youreInConfig.detailsTemplate
  };
}

/**
 * Makes the randomizer pool for one surface match the legacy editor's list exactly: everything
 * in `texts` becomes active/locked/vetted, and anything hand-managed that is no longer in the
 * list is archived. Generated messages are left alone - only migrated/manual copy is managed
 * by the legacy editors.
 */
async function syncLegacySurfaceMessages(personalityId, surfaceId, texts) {
  const normalized = [...new Set(texts.map(normalizeMessageText).filter(Boolean))];
  for (const text of texts) {
    const normalizedText = normalizeMessageText(text);
    if (!normalizedText) continue;
    const params = [crypto.randomUUID(), personalityId, surfaceId, String(text).trim(), normalizedText];
    if (isProduction) {
      await withPgClient((client) => client.query(`
        INSERT INTO randomizer_messages
          (id, personality_id, surface_id, text, normalized_text, source, status, locked, vetted)
        VALUES ($1, $2, $3, $4, $5, 'manual', 'active', TRUE, TRUE)
        ON CONFLICT (personality_id, surface_id, normalized_text)
        DO UPDATE SET text = EXCLUDED.text, status = 'active', locked = TRUE, vetted = TRUE,
                      updated_at = CURRENT_TIMESTAMP
      `, params));
    } else {
      await sqliteRun(`
        INSERT INTO randomizer_messages
          (id, personality_id, surface_id, text, normalized_text, source, status, locked, vetted)
        VALUES (?, ?, ?, ?, ?, 'manual', 'active', 1, 1)
        ON CONFLICT (personality_id, surface_id, normalized_text)
        DO UPDATE SET text = excluded.text, status = 'active', locked = 1, vetted = 1,
                      updated_at = CURRENT_TIMESTAMP
      `, params);
    }
  }

  const managed = await listRandomizerMessages({ personalityId, surfaceId });
  for (const message of managed) {
    if (
      (message.source === 'migrated' || message.source === 'manual') &&
      !normalized.includes(message.normalizedText) &&
      message.status !== 'archived'
    ) {
      await updateRandomizerMessage(message.id, { status: 'archived' });
    }
  }
}

/**
 * One-time repair: the v1 production slogan asset was a revision behind, so eight lines are
 * updated in place (which preserves the selection history pointing at them) and the missing
 * nineteenth is inserted. Marked with its own v2 asset so it runs once per database.
 */
async function repairOwnerVettedSlogans() {
  const existing = await readSeedMarker(VETTED_SLOGAN_REPAIR_ASSET_NAME);
  if (existing) return existing;

  const messages = await listRandomizerMessages({
    personalityId: REALIST_ID,
    surfaceId: 'site-slogan'
  });
  let replacements = 0;
  for (const message of messages) {
    const replacement = LEGACY_V1_SLOGAN_REPLACEMENTS.get(message.text);
    if (message.source === 'migrated' && replacement) {
      await updateRandomizerMessage(message.id, { text: replacement });
      replacements++;
    }
  }
  for (const text of sloganModule.DEFAULT_SLOGANS) {
    await insertMigratedMessage(REALIST_ID, 'site-slogan', text);
  }

  // The legacy slogan editor reads this asset, so it is brought up to the same list.
  let savedConfig = {};
  try {
    const savedAsset = await readDevAssetContent('slogan-config');
    savedConfig = savedAsset ? JSON.parse(savedAsset) : {};
  } catch (_error) {
    savedConfig = {};
  }
  const repairedConfig = sloganModule.normalizeConfig({
    ...savedConfig,
    slogans: sloganModule.DEFAULT_SLOGANS
  });
  const summary = {
    version: 2,
    slogans: repairedConfig.slogans.length,
    replacements,
    repairedAt: new Date().toISOString()
  };

  await writeDevAsset('slogan-config', JSON.stringify(repairedConfig));
  await writeSeedMarker(VETTED_SLOGAN_REPAIR_ASSET_NAME, summary);
  return summary;
}

/** Creates the Realist personality and its surface settings, once per database. */
async function seedRealistPersonality() {
  if (isProduction) {
    await withPgClient((client) => client.query(`
      INSERT INTO message_personalities
        (id, name, description, generation_guidance, enabled, is_default,
         locked_percent, fresh_pool_minimum, generation_batch_size)
      VALUES ($1, 'Realist', $2, $3, TRUE, TRUE, 40, 10, 10)
      ON CONFLICT (id) DO NOTHING
    `, [REALIST_ID, DEFAULT_REALIST_DESCRIPTION, DEFAULT_REALIST_GUIDANCE]));
  } else {
    await sqliteRun(`
      INSERT OR IGNORE INTO message_personalities
        (id, name, description, generation_guidance, enabled, is_default,
         locked_percent, fresh_pool_minimum, generation_batch_size)
      VALUES (?, 'Realist', ?, ?, 1, 1, 40, 10, 10)
    `, [REALIST_ID, DEFAULT_REALIST_DESCRIPTION, DEFAULT_REALIST_GUIDANCE]);
  }

  // Only the four surfaces with owner-approved copy start enabled. The rest are drafts-only
  // until somebody turns them on in the developer area.
  const initiallyEnabledSurfaces = new Set([
    'site-slogan',
    'invitation-opening',
    'youre-in',
    'game-details'
  ]);
  for (const surface of MESSAGE_SURFACES) {
    const enabled = initiallyEnabledSurfaces.has(surface.id);
    if (isProduction) {
      await withPgClient((client) => client.query(`
        INSERT INTO personality_surface_settings
          (personality_id, surface_id, enabled, auto_publish_generated)
        VALUES ($1, $2, $3, FALSE)
        ON CONFLICT (personality_id, surface_id) DO NOTHING
      `, [REALIST_ID, surface.id, enabled]));
    } else {
      await sqliteRun(`
        INSERT OR IGNORE INTO personality_surface_settings
          (personality_id, surface_id, enabled, auto_publish_generated)
        VALUES (?, ?, ?, 0)
      `, [REALIST_ID, surface.id, enabled ? 1 : 0]);
    }
  }
}

/**
 * The message-seeds stage. Repairs and draft pools run on every boot (each guarded by its own
 * marker); the personality and the legacy copy migration run only the first time.
 */
async function seedRealistAndMigrateSavedMessages() {
  const alreadyMigrated = await readSeedMarker(MIGRATION_ASSET_NAME);
  const summary = alreadyMigrated || await migrateSavedMessages();

  summary.vettedSloganRepair = await repairOwnerVettedSlogans();
  summary.invitationOpeningDrafts = await seedRealistInvitationOpeningDrafts();
  summary.gameDetailsDrafts = await seedRealistGameDetailsDrafts();
  summary.pageMomentDrafts = await seedRealistPageMomentDrafts();
  return summary;
}

/** First boot only: creates Realist and turns the owner's saved copy into pool messages. */
async function migrateSavedMessages() {
  await seedRealistPersonality();

  const migratedCopy = readMigrationCopy({
    sloganAsset: await readDevAssetContent('slogan-config'),
    youreInAsset: await readDevAssetContent('youre-in-config')
  });

  for (const text of migratedCopy.slogans) {
    await insertMigratedMessage(REALIST_ID, 'site-slogan', text);
  }
  for (const text of migratedCopy.youreIn) {
    await insertMigratedMessage(REALIST_ID, 'youre-in', text);
  }

  const summary = {
    version: 1,
    personalityId: REALIST_ID,
    slogans: migratedCopy.slogans.length,
    youreIn: migratedCopy.youreIn.length,
    total: migratedCopy.slogans.length + migratedCopy.youreIn.length,
    migratedAt: new Date().toISOString()
  };
  await writeSeedMarker(MIGRATION_ASSET_NAME, summary);
  return summary;
}

module.exports = {
  readMigrationCopy,
  syncLegacySurfaceMessages,
  seedRealistAndMigrateSavedMessages,
  seedRealistInvitationOpeningDrafts,
  seedRealistGameDetailsDrafts,
  seedRealistPageMomentDrafts,
  repairOwnerVettedSlogans
};
