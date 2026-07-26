// server.js - Main server file (simplified)
const express = require('express');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

// Import our separated modules
const {
  initializeDatabase,
  saveGame,
  getGame,
  getGameHostInfo,
  getAllGames,
  getGamesByHostPhone,
  deleteGamePermanently,
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
  upsertRosterEntry,
  recordRosterSighting,
  getRosterForHost,
  savePhoto,
  getPhotosForGame,
  getPhoto,
  deletePhoto,
  countPhotosForGame,
  getAllPhotoCounts,
  logAppError,
  closeDatabaseConnection,
  isProduction
} = require('./database');

const mountDevRoutes = require('./routes/dev');
const { requireDevAuth } = mountDevRoutes;

const mountGameRoutes = require('./routes/games');
const mountLocationRoutes = require('./routes/locations');
const mountCourtImageRoutes = require('./routes/court-images');
const mountPhotoRoutes = require('./routes/photos');
const mountRosterRoutes = require('./routes/roster');
const mountAnnouncementRoutes = require('./routes/announcements');
const mountPlayerRoutes = require('./routes/players');

const {
  sendSMS,
  sendSMSWithRetry,
  handleIncomingSMS,
  sendOrganizerNotification,
  formatPhoneNumber,
  formatDateForSMS, 
  formatTimeForSMS,
  formatLocationForSMS
} = require('./sms-handler');

const { 
  checkAndSendReminders,
  createGameData,
  validatePlayerData,
  checkExistingPlayer,
  addPlayerToGame,
  removePlayerFromGame,
  isValidPhoneNumber
} = require('./game-logic');

const { withGameLock, acquireGameLock } = require('./utils/game-lock');

const { routeFailed } = require('./utils/route-error');

const { isHost } = require('./utils/host-auth');

const { PHOTO_TYPES, MAX_PHOTOS_PER_GAME, sniffImageType } = require('./utils/image-type');

const { isGameUpcoming } = require('./utils/central-time');

const {
  promoteNextFromWaitlist,
  recordOutPlayer,
  departureAlertType
} = require('./utils/promotion');

const { computeHostStats } = require('./stats');

const app = express();
const PORT = process.env.PORT || 3001;

// Tell Express to trust proxy headers (for rate limiting on platforms like Render)
app.set('trust proxy', 1);

// Initialize database
initializeDatabase();

// Middleware
app.use(express.json());
app.use(express.static('public'));

app.use((req, res, next) => {
  console.log(`${req.method} ${req.url}`);
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

if (isProduction) {
  app.use('/api/games', generalLimiter);
  app.post('/api/games', createGameLimiter);
  console.log('Rate limiting enabled for production');
} else {
  console.log('Rate limiting disabled for local development');
}

// Start the reminder system - check every 2 minutes
setInterval(checkAndSendReminders, 2 * 60 * 1000);
console.log('[REMINDER] Reminder system started - checking every 2 minutes');

// Also run once on startup after a delay
setTimeout(checkAndSendReminders, 10000); // Wait 10 seconds after startup

// Password-protected developer area (/dev.html and /api/dev/*)
mountDevRoutes(app);

// ============================================================================
// API ROUTES
//
// Route groups live in ./routes and register absolute paths on the app, following the same
// shape as routes/dev.js. Mount order is kept the same as the order these routes were
// declared in when they all lived here, and every mount sits after the rate limiters above
// and before the error middleware at the bottom of this file.
// ============================================================================

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'Server is running', database: isProduction ? 'PostgreSQL' : 'SQLite' });
});

// Manual reminder test endpoint - restricted to localhost in production
app.post('/api/test-reminders', (req, res, next) => {
  if (isProduction) {
    const clientIp = req.ip || req.connection?.remoteAddress || '';
    const isLocalhost = clientIp === '127.0.0.1' || clientIp === '::1' || clientIp === '::ffff:127.0.0.1';
    if (!isLocalhost) {
      return res.status(403).json({ error: 'Forbidden: test endpoint only available from localhost' });
    }
  }
  next();
}, async (req, res) => {
  try {
    await checkAndSendReminders();
    res.json({ success: true, message: 'Reminder check completed' });
  } catch (error) {
    routeFailed(req, res, error, 'Failed to run reminder check');
  }
});

mountGameRoutes(app);
mountLocationRoutes(app);
mountCourtImageRoutes(app);
mountPhotoRoutes(app);
mountRosterRoutes(app);
mountAnnouncementRoutes(app);
mountPlayerRoutes(app);




// SMS webhook (uses our SMS handler)
app.post('/api/sms/webhook', express.json(), handleIncomingSMS);

// ============================================================================
// ERROR CAPTURE
// ============================================================================

// Anything a route throws without catching lands here and shows up in the
// developer area's Errors tab. Individual routes still handle their own errors.
app.use((err, req, res, next) => {
  // A bad request body is the caller's fault, not a fault in the app - answer with the
  // status the error carries and keep it out of the error log, or malformed JSON from
  // one confused browser would bury the failures actually worth looking at.
  const status = err.status || err.statusCode || 500;
  console.error(`Unhandled error on ${req.method} ${req.url}:`, err);
  if (status >= 500) {
    logAppError('server', {
      message: err.message,
      stack: err.stack,
      page: `${req.method} ${req.url}`,
      userAgent: req.headers['user-agent']
    });
  }
  if (res.headersSent) return next(err);
  res.status(status).json({ error: status >= 500 ? 'Something went wrong' : err.message });
});

process.on('unhandledRejection', (reason) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  console.error('Unhandled promise rejection:', err);
  logAppError('server', { message: `Unhandled rejection: ${err.message}`, stack: err.stack });
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  // The process is in an unknown state, so record what happened and let Render restart
  // us rather than limping along. The timeout guarantees we exit even if the database
  // write hangs - which it can, since the database may be the thing that just broke.
  const exit = () => process.exit(1);
  setTimeout(exit, 1000);
  logAppError('server', { message: `Uncaught exception: ${err.message}`, stack: err.stack })
    .then(exit, exit);
});

// ============================================================================
// SERVER STARTUP & SHUTDOWN
// ============================================================================

// Graceful shutdown handlers
process.on('SIGINT', async () => {
  console.log('Closing database connection...');
  await closeDatabaseConnection();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('Closing database connection...');
  await closeDatabaseConnection();
  process.exit(0);
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Visit http://localhost:${PORT} to view your app`);
});