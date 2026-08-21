/**
 * Turning Message Randomizer rows into the objects the rest of the app uses.
 *
 * Pure functions, no connection: the two engines disagree about booleans (PostgreSQL returns
 * true/false, SQLite returns 1/0) and about timestamps (a Date object versus a string), and
 * every repository in this family would otherwise repeat the same coercions. `bool` and
 * `toIso` are the whole reason this file exists.
 */

function toIso(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const text = String(value);
  const parsed = new Date(text.includes('T') ? text : `${text.replace(' ', 'T')}Z`);
  return Number.isNaN(parsed.getTime()) ? text : parsed.toISOString();
}

function bool(value) {
  return value === true || value === 1 || value === '1';
}

/**
 * The comparison key for "is this the same message?".
 *
 * Case, curly quotes, punctuation and runs of whitespace are all discarded, so a line
 * re-typed with a different apostrophe cannot enter the pool twice. The unique index on
 * (personality_id, surface_id, normalized_text) is what enforces it.
 */
function normalizeMessageText(value) {
  return String(value == null ? '' : value)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function mapPersonality(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    description: row.description || '',
    generationGuidance: row.generation_guidance || '',
    enabled: bool(row.enabled),
    isDefault: bool(row.is_default),
    lockedPercent: Number(row.locked_percent),
    freshPoolMinimum: Number(row.fresh_pool_minimum),
    generationBatchSize: Number(row.generation_batch_size),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function mapSurfaceSetting(row) {
  if (!row) return null;
  return {
    personalityId: row.personality_id,
    surfaceId: row.surface_id,
    enabled: bool(row.enabled),
    lockedPercentOverride: row.locked_percent_override == null
      ? null
      : Number(row.locked_percent_override),
    freshPoolMinimumOverride: row.fresh_pool_minimum_override == null
      ? null
      : Number(row.fresh_pool_minimum_override),
    autoPublishGenerated: bool(row.auto_publish_generated),
    updatedAt: toIso(row.updated_at)
  };
}

function mapCodexPrompt(row) {
  if (!row) return null;
  let sections = null;
  try {
    sections = JSON.parse(row.sections);
  } catch (_error) {
    sections = null;
  }
  return {
    personalityId: row.personality_id,
    surfaceId: row.surface_id,
    sections: Array.isArray(sections) ? sections : null,
    updatedAt: toIso(row.updated_at)
  };
}

function mapMessage(row) {
  if (!row) return null;
  return {
    id: row.id,
    personalityId: row.personality_id,
    surfaceId: row.surface_id,
    text: row.text,
    normalizedText: row.normalized_text,
    source: row.source,
    status: row.status,
    locked: bool(row.locked),
    vetted: bool(row.vetted),
    targetRuleId: row.target_rule_id || null,
    generationDirection: row.generation_direction || null,
    generatorName: row.generator_name || null,
    generatorVersion: row.generator_version || null,
    promptVersion: row.prompt_version || null,
    usageCount: Number(row.usage_count) || 0,
    lastUsedAt: toIso(row.last_used_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

/**
 * `includePhone: false` is how the dev area lists rules without handing the browser the
 * targeted player's number.
 */
function mapTargetRule(row, { includePhone = true } = {}) {
  if (!row) return null;
  const rule = {
    id: row.id,
    personalityId: row.personality_id,
    targetDisplayName: row.target_display_name || '',
    gameId: row.game_id || null,
    triggerStatus: row.trigger_status,
    surfaceId: row.surface_id,
    audience: row.audience,
    mode: row.mode,
    exactText: row.exact_text || null,
    generationDirection: row.generation_direction || null,
    enabled: bool(row.enabled),
    startsAt: toIso(row.starts_at),
    endsAt: toIso(row.ends_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
  if (includePhone) rule.targetPhone = row.target_phone;
  return rule;
}

function mapSelectionEvent(row) {
  if (!row) return null;
  return {
    id: row.id,
    messageId: row.message_id || null,
    personalityId: row.personality_id,
    surfaceId: row.surface_id,
    gameId: row.game_id || null,
    recipientHash: row.recipient_hash || null,
    targetRuleId: row.target_rule_id || null,
    sourceBucket: row.source_bucket,
    selectedAt: toIso(row.selected_at)
  };
}

module.exports = {
  toIso,
  bool,
  normalizeMessageText,
  mapPersonality,
  mapSurfaceSetting,
  mapCodexPrompt,
  mapMessage,
  mapTargetRule,
  mapSelectionEvent
};
