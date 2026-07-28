const {
  TEXT_MESSAGE_CONFIG_ASSET_NAME,
  getTextMessageCategory,
  normalizeDraftConfig
} = require('../text-message-categories');

const CONFIG_CACHE_MS = 5000;
let configCache = null;
let configCacheExpiresAt = 0;

function renderTemplate(template, values = {}) {
  const normalized = {};
  Object.entries(values).forEach(([key, value]) => {
    normalized[String(key).toUpperCase()] = value == null ? '' : String(value);
  });

  return String(template).replace(/\{([A-Z][A-Z0-9_]*)\}/g, (token, key) => (
    Object.prototype.hasOwnProperty.call(normalized, key) ? normalized[key] : token
  ));
}

function selectCategoryMessage(
  config,
  categoryId,
  defaultMessage,
  values = {},
  random = Math.random
) {
  const category = getTextMessageCategory(categoryId);
  if (!category || category.live) return String(defaultMessage);

  const normalized = normalizeDraftConfig(config);
  const categoryConfig = normalized.categories[categoryId];
  if (!categoryConfig.enabled || !categoryConfig.messages.length) {
    return String(defaultMessage);
  }

  const index = Math.min(
    Math.max(Math.floor(random() * categoryConfig.messages.length), 0),
    categoryConfig.messages.length - 1
  );
  return renderTemplate(categoryConfig.messages[index], {
    ...values,
    DEFAULT_TEXT: defaultMessage
  });
}

async function loadTextMessageConfig() {
  if (configCache && Date.now() < configCacheExpiresAt) return configCache;
  const { getDevAsset } = require('../database');
  const saved = await getDevAsset(TEXT_MESSAGE_CONFIG_ASSET_NAME);
  if (!saved) {
    configCache = normalizeDraftConfig();
    configCacheExpiresAt = Date.now() + CONFIG_CACHE_MS;
    return configCache;
  }
  try {
    configCache = normalizeDraftConfig(JSON.parse(saved.content));
  } catch (error) {
    console.error('Error parsing text message configuration:', error.message);
    configCache = normalizeDraftConfig();
  }
  configCacheExpiresAt = Date.now() + CONFIG_CACHE_MS;
  return configCache;
}

function clearTextMessageConfigCache() {
  configCache = null;
  configCacheExpiresAt = 0;
}

async function resolveTextMessage(categoryId, defaultMessage, values = {}, random) {
  try {
    const config = await loadTextMessageConfig();
    return selectCategoryMessage(
      config,
      categoryId,
      defaultMessage,
      values,
      random
    );
  } catch (error) {
    console.error(`Error resolving ${categoryId} text; using the current default:`, error.message);
    return String(defaultMessage);
  }
}

module.exports = {
  renderTemplate,
  selectCategoryMessage,
  loadTextMessageConfig,
  clearTextMessageConfigCache,
  resolveTextMessage
};
