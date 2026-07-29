// routes/dev.js - The password-protected developer area behind /dev.html
//
// One place to see what the app is doing: Textbelt credit, hosting health, the idea
// board, errors real users hit, and the generated documentation pages.
//
// Auth is a single shared password (DEV_PASSWORD). Logging in sets a cookie whose value
// is an HMAC of the password, so no session store is needed - which matters because Render
// restarts the process on every deploy and would wipe anything held in memory. Changing
// DEV_PASSWORD invalidates every cookie that was ever handed out.

const express = require('express');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');

const {
  isProduction,
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
} = require('../database');
const sloganModule = require('../public/js/slogans');
const youreInMessages = require('../youre-in-messages');
const {
  ASSET_NAME: YOURE_IN_ASSET_NAME,
  loadYoureInConfig
} = require('../services/youre-in-rotation');
const {
  TEXT_MESSAGE_CONFIG_ASSET_NAME,
  TEXT_MESSAGE_CATEGORIES,
  getTextMessageCategory,
  normalizeMessages,
  normalizeDetailsTemplate,
  normalizeDraftConfig
} = require('../text-message-categories');
const { clearTextMessageConfigCache } = require('../services/text-message-rotation');
const {
  REPLY_OPTIONS_ASSET_NAME,
  CUSTOM_COMMANDS,
  ALLOWED_TOKENS: REPLY_OPTION_TOKENS,
  SYSTEM_REPLY_OPTIONS,
  validateReplyOptionsConfig,
  loadReplyOptionsConfig,
  clearReplyOptionsCache
} = require('../sms-reply-options');

const DEV_PASSWORD = process.env.DEV_PASSWORD || 'vibe123';
const COOKIE_NAME = 'dev_auth';
const THIRTY_DAYS = 30 * 24 * 60 * 60;

// The four columns of the idea board. Anything else is rejected.
const NOTE_STATUSES = ['idea', 'building', 'done-not-deployed', 'live'];

// Which generated doc pages may be published. Without this an authenticated
// caller could write any key they liked into dev_assets.
const PUBLISHABLE = ['screens', 'containers', 'copy-deck'];
const SLOGAN_ASSET_NAME = 'slogan-config';

const SERVER_STARTED_AT = new Date();

function expectedToken() {
  return crypto.createHmac('sha256', DEV_PASSWORD).update('inorout-dev-area').digest('hex');
}

// timingSafeEqual throws if the buffers differ in length, so check that first.
function safeEqual(a, b) {
  const bufA = Buffer.from(String(a || ''));
  const bufB = Buffer.from(String(b || ''));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// A five-line cookie reader rather than pulling in cookie-parser for one cookie.
function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  const match = header.split(';').map((part) => part.trim()).find((part) => part.startsWith(name + '='));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

function isAuthed(req) {
  // The cookie is how the browser gets in; the header is how publish-docs.js gets in.
  if (safeEqual(readCookie(req, COOKIE_NAME), expectedToken())) return true;
  if (req.headers['x-dev-password'] && safeEqual(req.headers['x-dev-password'], DEV_PASSWORD)) return true;
  return false;
}

function requireDevAuth(req, res, next) {
  if (isAuthed(req)) return next();
  // A page request gets a page; an API request gets JSON.
  if (req.accepts('html') && !req.path.startsWith('/api/')) {
    return res.status(401).send(`<!DOCTYPE html>
      <html><head><title>Locked</title><meta name="viewport" content="width=device-width, initial-scale=1">
      <style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;background:#f5f7fa;
      display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center;color:#2c3e50}
      a{color:#4CAF50}</style></head>
      <body><div><h1>Locked</h1><p>This page is part of the developer area.</p>
      <p><a href="/dev.html">Sign in first</a>, then come back.</p></div></body></html>`);
  }
  return res.status(401).json({ error: 'Not signed in' });
}

// Textbelt charges per request, so a dashboard refresh should not mean a fresh lookup.
let quotaCache = { value: null, checkedAt: 0 };
const QUOTA_TTL_MS = 5 * 60 * 1000;

async function getTextbeltQuota() {
  const key = process.env.TEXTBELT_API_KEY;
  if (!key) return { error: 'TEXTBELT_API_KEY is not set (texts are only logged, not sent)' };

  const age = Date.now() - quotaCache.checkedAt;
  if (quotaCache.value !== null && age < QUOTA_TTL_MS) {
    return { quotaRemaining: quotaCache.value, checkedAt: new Date(quotaCache.checkedAt).toISOString(), cached: true };
  }

  try {
    const response = await fetch(`https://textbelt.com/quota/${key}`);
    const body = await response.json();
    if (!body.success) return { error: 'Textbelt rejected the quota check' };
    quotaCache = { value: body.quotaRemaining, checkedAt: Date.now() };
    return { quotaRemaining: body.quotaRemaining, checkedAt: new Date(quotaCache.checkedAt).toISOString(), cached: false };
  } catch (err) {
    return { error: `Could not reach Textbelt: ${err.message}` };
  }
}

async function loadSloganConfig() {
  const saved = await getDevAsset(SLOGAN_ASSET_NAME);
  if (!saved) return sloganModule.normalizeConfig();
  try {
    return sloganModule.normalizeConfig(JSON.parse(saved.content));
  } catch (err) {
    console.error('Error parsing saved slogan configuration:', err.message);
    return sloganModule.normalizeConfig();
  }
}

function validateSloganConfig(body) {
  const slogans = body && body.slogans;
  const names = body && body.names;
  if (!Array.isArray(slogans) || !Array.isArray(names)) {
    return { error: 'Slogans and names must both be lists.' };
  }
  if (!slogans.length) return { error: 'Keep at least one slogan in the rotation.' };
  if (!names.length) return { error: 'Keep at least one rotating name.' };
  if (slogans.length > 200) return { error: 'The rotation can contain up to 200 slogans.' };
  if (names.length > 100) return { error: 'The name list can contain up to 100 names.' };
  if (slogans.some((slogan) => !String(slogan).trim() || String(slogan).trim().length > 240)) {
    return { error: 'Each slogan must be between 1 and 240 characters.' };
  }
  if (names.some((name) => !String(name).trim() || String(name).trim().length > 50)) {
    return { error: 'Each name must be between 1 and 50 characters.' };
  }
  return { config: sloganModule.normalizeConfig({ slogans, names }) };
}

function validateYoureInConfig(body) {
  const messages = body && body.messages;
  if (!Array.isArray(messages)) {
    return { error: 'You’re In texts must be a list.' };
  }
  if (!messages.length) return { error: 'Keep at least one You’re In text in the rotation.' };
  if (messages.length > 200) return { error: 'The rotation can contain up to 200 You’re In texts.' };
  if (messages.some((message) => !String(message).trim() || String(message).trim().length > 240)) {
    return { error: 'Each You’re In text must be between 1 and 240 characters.' };
  }
  return { config: youreInMessages.normalizeConfig({ messages }) };
}

async function loadTextMessageDraftConfig() {
  const saved = await getDevAsset(TEXT_MESSAGE_CONFIG_ASSET_NAME);
  if (!saved) return normalizeDraftConfig();
  try {
    return normalizeDraftConfig(JSON.parse(saved.content));
  } catch (err) {
    console.error('Error parsing saved text message drafts:', err.message);
    return normalizeDraftConfig();
  }
}

function validateTextMessageCategory(category, body) {
  const messages = body && body.messages;
  if (!Array.isArray(messages)) {
    return { error: `${category.title} texts must be a list.` };
  }

  const cleaned = messages.map((message) => String(message == null ? '' : message).trim());
  if (cleaned.some((message) => !message || message.length > category.maxLength)) {
    return {
      error: `Each ${category.title} text must be between 1 and ${category.maxLength} characters.`
    };
  }
  if (new Set(cleaned).size !== cleaned.length) {
    return { error: `${category.title} texts cannot contain duplicates.` };
  }
  if (category.requiresOne && !cleaned.length) {
    return { error: `Keep at least one ${category.title} text in the rotation.` };
  }
  const detailsTemplate = String(body && body.detailsTemplate || '').trim();
  if (!detailsTemplate || detailsTemplate.length > category.detailsMaxLength) {
    return {
      error: `The ${category.title} details must be between 1 and ${category.detailsMaxLength} characters.`
    };
  }

  const allowedTokens = new Set(category.tokens || []);
  const unsupportedTokens = [...cleaned, detailsTemplate]
    .flatMap((text) => [...text.matchAll(/\{([A-Z][A-Z0-9_]*)\}/g)].map((match) => match[1]))
    .filter((token, index, tokens) => !allowedTokens.has(token) && tokens.indexOf(token) === index);
  if (unsupportedTokens.length) {
    return {
      error: `Unsupported value${unsupportedTokens.length === 1 ? '' : 's'}: ${unsupportedTokens
        .map((token) => `{${token}}`)
        .join(', ')}.`
    };
  }

  return {
    messages: normalizeMessages(cleaned, category.maxLength),
    detailsTemplate: normalizeDetailsTemplate(
      detailsTemplate,
      category.defaultDetailsTemplate,
      category.detailsMaxLength
    )
  };
}

module.exports = function mountDevRoutes(app) {
  // Brute force is the only real attack on a single shared password.
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { error: 'Too many sign-in attempts. Wait 15 minutes.' }
  });

  // Players' browsers post here when a page throws, so it cannot require auth.
  const clientErrorLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 5,
    message: { error: 'Too many error reports.' }
  });

  // -------------------------------------------------------------------------
  // Sign in / sign out
  // -------------------------------------------------------------------------

  app.post('/api/dev/login', loginLimiter, (req, res) => {
    const password = (req.body && req.body.password) || '';
    if (!safeEqual(password, DEV_PASSWORD)) {
      return res.status(401).json({ error: 'Wrong password' });
    }
    const flags = [
      `${COOKIE_NAME}=${expectedToken()}`,
      'HttpOnly',
      'Path=/',
      'SameSite=Lax',
      `Max-Age=${THIRTY_DAYS}`
    ];
    // Secure would make the cookie unusable over plain http on localhost.
    if (isProduction) flags.push('Secure');
    res.setHeader('Set-Cookie', flags.join('; '));
    res.json({ success: true });
  });

  app.post('/api/dev/logout', (req, res) => {
    res.setHeader('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`);
    res.json({ success: true });
  });

  // Public pages only need read access. Changes stay behind the Developer Area sign-in.
  app.get('/api/slogans', async (_req, res) => {
    try {
      res.json(await loadSloganConfig());
    } catch (err) {
      console.error('Error loading slogans:', err);
      res.json(sloganModule.normalizeConfig());
    }
  });

  app.put('/api/dev/slogans', requireDevAuth, async (req, res) => {
    const result = validateSloganConfig(req.body);
    if (result.error) return res.status(400).json({ error: result.error });
    try {
      await saveDevAsset(SLOGAN_ASSET_NAME, JSON.stringify(result.config));
      res.json({ success: true, ...result.config });
    } catch (err) {
      console.error('Error saving slogans:', err);
      res.status(500).json({ error: 'Could not save the slogan rotation.' });
    }
  });

  app.get('/api/youre-in-messages', async (_req, res) => {
    res.json(await loadYoureInConfig());
  });

  app.put('/api/dev/youre-in-messages', requireDevAuth, async (req, res) => {
    const result = validateYoureInConfig(req.body);
    if (result.error) return res.status(400).json({ error: result.error });
    try {
      const current = await loadYoureInConfig();
      const config = youreInMessages.normalizeConfig({
        messages: result.config.messages,
        detailsTemplate: current.detailsTemplate
      });
      await saveDevAsset(YOURE_IN_ASSET_NAME, JSON.stringify(config));
      res.json({ success: true, ...config });
    } catch (err) {
      console.error('Error saving You\'re In texts:', err);
      res.status(500).json({ error: 'Could not save the You’re In rotation.' });
    }
  });

  app.get('/api/dev/text-message-categories', requireDevAuth, async (_req, res) => {
    try {
      const [youreInConfig, draftConfig] = await Promise.all([
        loadYoureInConfig(),
        loadTextMessageDraftConfig()
      ]);
      res.json({
        categories: TEXT_MESSAGE_CATEGORIES.map((category) => ({
          ...category,
          enabled: category.live
            ? true
            : draftConfig.categories[category.id].enabled,
          messages: category.id === 'youre-in'
            ? youreInConfig.messages
            : draftConfig.categories[category.id].messages,
          detailsTemplate: category.id === 'youre-in'
            ? youreInConfig.detailsTemplate
            : draftConfig.categories[category.id].detailsTemplate
        }))
      });
    } catch (err) {
      console.error('Error loading text message categories:', err);
      res.status(500).json({ error: 'Could not load the text message editors.' });
    }
  });

  app.put('/api/dev/text-message-categories/:categoryId', requireDevAuth, async (req, res) => {
    const category = getTextMessageCategory(req.params.categoryId);
    if (!category) return res.status(404).json({ error: 'Unknown text message category.' });

    const result = validateTextMessageCategory(category, req.body);
    if (result.error) return res.status(400).json({ error: result.error });

    try {
      if (category.id === 'youre-in') {
        const config = youreInMessages.normalizeConfig({
          messages: result.messages,
          detailsTemplate: result.detailsTemplate
        });
        await saveDevAsset(YOURE_IN_ASSET_NAME, JSON.stringify(config));
        return res.json({
          success: true,
          messages: config.messages,
          detailsTemplate: config.detailsTemplate
        });
      }

      const config = await loadTextMessageDraftConfig();
      config.categories[category.id] = {
        enabled: req.body && req.body.enabled === true,
        messages: result.messages,
        detailsTemplate: result.detailsTemplate
      };
      await saveDevAsset(TEXT_MESSAGE_CONFIG_ASSET_NAME, JSON.stringify(config));
      clearTextMessageConfigCache();
      res.json({
        success: true,
        enabled: config.categories[category.id].enabled,
        messages: result.messages,
        detailsTemplate: result.detailsTemplate
      });
    } catch (err) {
      console.error(`Error saving ${category.title} texts:`, err);
      res.status(500).json({ error: `Could not save the ${category.title} texts.` });
    }
  });

  // -------------------------------------------------------------------------
  // SMS reply options
  // -------------------------------------------------------------------------

  app.get('/api/dev/reply-options', requireDevAuth, async (_req, res) => {
    try {
      const config = await loadReplyOptionsConfig();
      res.json({
        systemOptions: SYSTEM_REPLY_OPTIONS,
        customOptions: config.options,
        availableCommands: CUSTOM_COMMANDS,
        tokens: REPLY_OPTION_TOKENS
      });
    } catch (err) {
      console.error('Error loading SMS reply options:', err);
      res.status(500).json({ error: 'Could not load the reply options.' });
    }
  });

  app.put('/api/dev/reply-options', requireDevAuth, async (req, res) => {
    const result = validateReplyOptionsConfig({ options: req.body?.customOptions });
    if (result.error) return res.status(400).json({ error: result.error });

    try {
      await saveDevAsset(REPLY_OPTIONS_ASSET_NAME, JSON.stringify(result.config));
      clearReplyOptionsCache();
      res.json({ success: true, customOptions: result.config.options });
    } catch (err) {
      console.error('Error saving SMS reply options:', err);
      res.status(500).json({ error: 'Could not save the reply options.' });
    }
  });

  // -------------------------------------------------------------------------
  // Status dashboard
  // -------------------------------------------------------------------------

  app.get('/api/dev/status', requireDevAuth, async (req, res) => {
    const status = {
      server: {
        startedAt: SERVER_STARTED_AT.toISOString(),
        uptimeSeconds: Math.round(process.uptime()),
        nodeVersion: process.version,
        environment: isProduction ? 'production' : 'local'
      }
    };

    try {
      await pingDatabase();
      status.database = { type: isProduction ? 'PostgreSQL' : 'SQLite', ok: true };
    } catch (err) {
      status.database = { type: isProduction ? 'PostgreSQL' : 'SQLite', ok: false, error: err.message };
    }

    try {
      const [games, photos, errorsLast7Days, noteCounts] = await Promise.all([
        countRows('games'),
        countRows('game_photos'),
        countAppErrors(7),
        countDevNotesByStatus()
      ]);
      status.counts = {
        games,
        photos,
        errorsLast7Days,
        ideas: noteCounts.idea || 0,
        building: noteCounts.building || 0,
        doneNotDeployed: noteCounts['done-not-deployed'] || 0,
        live: noteCounts.live || 0
      };
    } catch (err) {
      status.counts = { error: err.message };
    }

    status.textbelt = await getTextbeltQuota();

    try {
      const meta = await getDevAssetMeta('screens');
      status.screens = meta ? { publishedAt: meta.updatedAt, sizeBytes: meta.size } : null;
    } catch (err) {
      status.screens = null;
    }

    res.json(status);
  });

  // -------------------------------------------------------------------------
  // Idea board
  // -------------------------------------------------------------------------

  app.get('/api/dev/notes', requireDevAuth, async (req, res) => {
    try {
      res.json({ notes: await listDevNotes(), statuses: NOTE_STATUSES });
    } catch (err) {
      console.error('Error listing dev notes:', err);
      res.status(500).json({ error: 'Could not load ideas' });
    }
  });

  app.post('/api/dev/notes', requireDevAuth, async (req, res) => {
    try {
      const title = String((req.body && req.body.title) || '').trim();
      if (!title) return res.status(400).json({ error: 'Give the idea a title' });

      const status = (req.body && req.body.status) || 'idea';
      if (!NOTE_STATUSES.includes(status)) return res.status(400).json({ error: 'Unknown status' });

      const id = await saveDevNote(title.slice(0, 200), String((req.body && req.body.body) || '').slice(0, 5000), status);
      res.json({ success: true, id });
    } catch (err) {
      console.error('Error saving dev note:', err);
      res.status(500).json({ error: 'Could not save the idea' });
    }
  });

  app.put('/api/dev/notes/:id', requireDevAuth, async (req, res) => {
    try {
      const fields = {};
      if (req.body && req.body.title !== undefined) {
        const title = String(req.body.title).trim();
        if (!title) return res.status(400).json({ error: 'Give the idea a title' });
        fields.title = title.slice(0, 200);
      }
      if (req.body && req.body.body !== undefined) fields.body = String(req.body.body).slice(0, 5000);
      if (req.body && req.body.status !== undefined) {
        if (!NOTE_STATUSES.includes(req.body.status)) return res.status(400).json({ error: 'Unknown status' });
        fields.status = req.body.status;
      }

      const updated = await updateDevNote(req.params.id, fields);
      if (!updated) return res.status(404).json({ error: 'That idea is gone' });
      res.json({ success: true, note: updated });
    } catch (err) {
      console.error('Error updating dev note:', err);
      res.status(500).json({ error: 'Could not update the idea' });
    }
  });

  app.delete('/api/dev/notes/:id', requireDevAuth, async (req, res) => {
    try {
      const removed = await deleteDevNote(req.params.id);
      if (!removed) return res.status(404).json({ error: 'That idea is gone' });
      res.json({ success: true });
    } catch (err) {
      console.error('Error deleting dev note:', err);
      res.status(500).json({ error: 'Could not delete the idea' });
    }
  });

  // -------------------------------------------------------------------------
  // Errors
  // -------------------------------------------------------------------------

  app.get('/api/dev/errors', requireDevAuth, async (req, res) => {
    try {
      res.json({ errors: await listAppErrors(req.query.limit || 200) });
    } catch (err) {
      console.error('Error listing app errors:', err);
      res.status(500).json({ error: 'Could not load errors' });
    }
  });

  // Called by the reporter in header.js when a player's browser throws.
  // Unauthenticated by necessity, so everything here is capped and rate limited.
  app.post('/api/client-error', clientErrorLimiter, async (req, res) => {
    try {
      await logAppError('client', {
        message: (req.body && req.body.message) || 'Unknown client error',
        stack: req.body && req.body.stack,
        page: req.body && req.body.page,
        userAgent: req.headers['user-agent']
      });
      await pruneAppErrors();
    } catch (err) {
      console.error('Error recording client error:', err.message);
    }
    // Always 204: a browser reporting a crash should never get a second error back.
    res.status(204).end();
  });

  // -------------------------------------------------------------------------
  // Published documentation pages
  // -------------------------------------------------------------------------

  // The screens page is a few megabytes of inlined screenshots, so this route needs
  // its own body parser - the global express.json() limit would reject it outright.
  app.post(
    '/api/dev/assets/:name',
    requireDevAuth,
    express.text({ limit: '20mb', type: '*/*' }),
    async (req, res) => {
      const name = req.params.name;
      if (!PUBLISHABLE.includes(name)) {
        return res.status(400).json({ error: `Unknown page. Expected one of: ${PUBLISHABLE.join(', ')}` });
      }
      if (!req.body || typeof req.body !== 'string' || !req.body.trim()) {
        return res.status(400).json({ error: 'No content received' });
      }
      try {
        await saveDevAsset(name, req.body);
        console.log(`[DEV] Published ${name} (${(req.body.length / 1024 / 1024).toFixed(1)} MB)`);
        res.json({ success: true, name, sizeBytes: req.body.length });
      } catch (err) {
        console.error('Error saving dev asset:', err);
        res.status(500).json({ error: 'Could not save the page' });
      }
    }
  );

  PUBLISHABLE.forEach((name) => {
    app.get(`/dev/${name}`, requireDevAuth, async (req, res) => {
      try {
        const asset = await getDevAsset(name);
        if (!asset) {
          return res.status(404).send(`<!DOCTYPE html>
            <html><head><title>Not published yet</title><meta name="viewport" content="width=device-width, initial-scale=1">
            <style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;background:#f5f7fa;
            display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center;color:#2c3e50}
            code{background:#e8f5e9;padding:2px 6px;border-radius:4px}a{color:#4CAF50}</style></head>
            <body><div><h1>Not published yet</h1>
            <p>Run <code>npm run docs</code> then <code>npm run docs:publish</code> to build this page.</p>
            <p><a href="/dev.html">Back to the developer area</a></p></div></body></html>`);
        }
        res.type('html').send(asset.content);
      } catch (err) {
        console.error(`Error serving dev asset ${name}:`, err);
        res.status(500).send('Could not load that page.');
      }
    });
  });

  console.log('[DEV] Developer area mounted at /dev.html');
};

module.exports.requireDevAuth = requireDevAuth;
