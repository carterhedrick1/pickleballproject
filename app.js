// app.js - builds the Express app and nothing else.
//
// Requiring this file must never start a listener, start the reminder timers, or touch
// process-level handlers; that is server.js's job. The split exists so tests can build a
// real app, point it at an ephemeral port, and exercise real HTTP - webhook signatures,
// signup rules, authorization - without launching an uncontrolled process.
//
// The API itself lives in ./routes, one file per group, each exporting a mountXRoutes(app)
// that registers absolute paths. What stays here is the order-sensitive part: middleware
// before routes, rate limiters before the route groups they cover, and the error middleware
// after everything. /api/health stays here too - it is how a deploy is confirmed, so it
// should not sit inside any group being changed.
const express = require('express');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const {
  initializeDatabase,
  logAppError,
  isProduction
} = require('./database');

const { handleIncomingSMS } = require('./sms-handler');
const { requireTextbeltSignature } = require('./utils/textbelt-webhook');
const { redactTokenInUrl } = require('./utils/host-auth');
const { checkAndSendReminders } = require('./services/reminders');
const { routeFailed } = require('./utils/route-error');
const { createDatabaseGate } = require('./utils/database-gate');

const mountDevRoutes = require('./routes/dev');
const mountGameRoutes = require('./routes/games');
const mountLocationRoutes = require('./routes/locations');
const mountCourtImageRoutes = require('./routes/court-images');
const mountPhotoRoutes = require('./routes/photos');
const mountRosterRoutes = require('./routes/roster');
const mountHostVerificationRoutes = require('./routes/host-verification');
const mountAnnouncementRoutes = require('./routes/announcements');
const mountInvitationRoutes = require('./routes/invitations');
const mountPlayerRoutes = require('./routes/players');
const { mountPublicRandomizerRoutes } = require('./routes/message-randomizer');

/**
 * Builds the complete app. Every option has the production default; tests override only
 * what they are exercising.
 * @param {object} [options]
 * @param {boolean} [options.production] - rate limiting and webhook strictness
 * @param {string} [options.textbeltSecret] - webhook signing key override (tests)
 * @param {Function} [options.runReminderCheck] - what /api/test-reminders runs
 */
function createApp({
  production = isProduction,
  textbeltSecret,
  runReminderCheck = checkAndSendReminders
} = {}) {
  const app = express();
  const startedAt = new Date().toISOString();

  // Tell Express to trust proxy headers (for rate limiting on platforms like Render)
  app.set('trust proxy', 1);

  // Initialize database. The gate retries a failed boot-time attempt on the next request,
  // so a brief Postgres outage during a deploy cannot leave the API answering 500 forever.
  const databaseGate = createDatabaseGate(initializeDatabase);

  // Middleware
  app.use(compression());
  // The raw body is kept alongside the parsed one because Textbelt's webhook signature
  // covers the exact bytes it sent; utils/textbelt-webhook.js verifies against req.rawBody.
  app.use(express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    }
  }));
  // maxAge lets browsers and the CDN reuse CSS/images for an hour instead of
  // re-fetching all of them on every page view. HTML and JavaScript must be
  // revalidated together: otherwise a deploy can pair new markup with an old cached
  // script and prevent a page from starting at all.
  app.use(express.static('public', {
    maxAge: '1h',
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.html') || filePath.endsWith('.js')) {
        res.setHeader('Cache-Control', 'no-cache');
      }
    }
  }));
  app.use('/api', databaseGate);

  app.use((req, res, next) => {
    // Old-style links may still carry a host token in the query string; a log line must
    // never become a copy of somebody's management credentials.
    console.log(`${req.method} ${redactTokenInUrl(req.url)}`);
    next();
  });

  // Rate limiting
  const createGameLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 15,
    message: { error: 'Too many games created. Please wait 15 minutes.' }
  });

  const generalLimiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 30,
    message: { error: 'Too many requests. Please slow down.' }
  });

  // A player's own status lookup answers "is this number in this game", so it is the one read
  // worth limiting harder than the rest: a legitimate page open asks once and then twice a
  // minute while it stays open, and nothing honest needs more.
  const playerStatusLimiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 20,
    message: { error: 'Too many requests. Please slow down.' }
  });

  if (production) {
    app.use('/api/games', generalLimiter);
    app.post('/api/games/:id/player-status', playerStatusLimiter);
    app.post('/api/games', createGameLimiter);
    console.log('Rate limiting enabled for production');
  } else {
    console.log('Rate limiting disabled for local development');
  }

  // Password-protected developer area (/dev.html and /api/dev/*)
  mountDevRoutes(app);
  mountPublicRandomizerRoutes(app);

  // ==========================================================================
  // API ROUTES
  //
  // Route groups live in ./routes and register absolute paths on the app, following the
  // same shape as routes/dev.js. Mount order is kept the same as the order these routes
  // were declared in when they all lived in server.js, and every mount sits after the rate
  // limiters above and before the error middleware at the bottom.
  // ==========================================================================

  // Health check
  app.get('/api/health', (req, res) => {
    res.json({
      status: 'OK',
      message: 'Server is running',
      database: isProduction ? 'PostgreSQL' : 'SQLite',
      environment: isProduction ? 'production' : 'local',
      startedAt
    });
  });

  // Manual reminder test endpoint - restricted to localhost in production
  app.post('/api/test-reminders', (req, res, next) => {
    if (production) {
      const clientIp = req.ip || req.connection?.remoteAddress || '';
      const isLocalhost = clientIp === '127.0.0.1' || clientIp === '::1' || clientIp === '::ffff:127.0.0.1';
      if (!isLocalhost) {
        return res.status(403).json({ error: 'Forbidden: test endpoint only available from localhost' });
      }
    }
    next();
  }, async (req, res) => {
    try {
      await runReminderCheck();
      res.json({ success: true, message: 'Reminder check completed' });
    } catch (error) {
      routeFailed(req, res, error, 'Failed to run reminder check');
    }
  });

  mountGameRoutes(app);
  mountHostVerificationRoutes(app);
  mountLocationRoutes(app);
  mountCourtImageRoutes(app);
  mountPhotoRoutes(app);
  mountRosterRoutes(app);
  mountAnnouncementRoutes(app);
  mountInvitationRoutes(app);
  mountPlayerRoutes(app);

  // SMS webhook. The signature gate rejects anything Textbelt did not sign - a forged
  // reply "9" would otherwise cancel a real player's spot.
  app.post(
    '/api/sms/webhook',
    requireTextbeltSignature(
      textbeltSecret === undefined
        ? undefined
        : { secret: textbeltSecret, isProduction: () => production }
    ),
    handleIncomingSMS
  );

  // ==========================================================================
  // ERROR CAPTURE
  // ==========================================================================

  // Anything a route throws without catching lands here and shows up in the
  // developer area's Errors tab. Individual routes still handle their own errors.
  app.use((err, req, res, next) => {
    // A bad request body is the caller's fault, not a fault in the app - answer with the
    // status the error carries and keep it out of the error log, or malformed JSON from
    // one confused browser would bury the failures actually worth looking at.
    const status = err.status || err.statusCode || 500;
    console.error(`Unhandled error on ${req.method} ${redactTokenInUrl(req.url)}:`, err);
    if (status >= 500) {
      logAppError('server', {
        message: err.message,
        stack: err.stack,
        page: `${req.method} ${redactTokenInUrl(req.url)}`,
        userAgent: req.headers['user-agent']
      });
    }
    if (res.headersSent) return next(err);
    res.status(status).json({ error: status >= 500 ? 'Something went wrong' : err.message });
  });

  return app;
}

module.exports = { createApp };
