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

mountLocationRoutes(app);
mountCourtImageRoutes(app);
mountPhotoRoutes(app);
mountRosterRoutes(app);
mountAnnouncementRoutes(app);
mountPlayerRoutes(app);

app.post('/api/games', async (req, res) => {
  try {
    console.log('[SERVER] Received create game request:', req.body);
    
    const gameId = Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
    const hostToken = crypto.randomBytes(32).toString('hex');

    // Create game data using our game logic
    const gameData = createGameData(req.body);
    gameData.hostToken = hostToken;
    
    const hostPhone = req.body.hostPhone || req.body.organizerPhone;

    if (hostPhone && !isValidPhoneNumber(hostPhone)) {
      return res.status(400).json({ 
        error: 'Please enter a valid US phone number for the organizer' 
      });
    }    
    
    // Make sure hostPhone is properly formatted and saved
    const formattedHostPhone = hostPhone ? formatPhoneNumber(hostPhone) : null;
    gameData.hostPhone = formattedHostPhone;
    
    console.log('[SERVER] Final game data before saving:');
    console.log('  - hostPhone:', gameData.hostPhone);
    console.log('  - notificationPreferences:', gameData.notificationPreferences);
    
    await saveGame(gameId, gameData, hostToken, formattedHostPhone);

    // Remember the court for the next host's picker. Never fail a game save over it.
    try {
      await addLocation(gameData.location);
    } catch (locationError) {
      console.error('[SERVER] Could not save location for reuse:', locationError);
    }

    const response = {
      gameId,
      hostToken,
      playerLink: `/game.html?id=${gameId}`,
      hostLink: `/manage.html?id=${gameId}&token=${hostToken}`
    };
    
    // Send confirmation SMS to host
    let smsResult = null;
    if (hostPhone) {
      const gameDate = formatDateForSMS(gameData.date);
      const gameTime = formatTimeForSMS(gameData.time);
      const locationText = formatLocationForSMS(gameData);
      const hostMessage = `Your pickleball game at ${locationText} on ${gameDate} at ${gameTime} has been created! Reply "1" for management link or "2" for game details.`;
      smsResult = await sendSMS(formattedHostPhone, hostMessage, gameId);
    }
    
    response.hostSms = smsResult;
    console.log('[SERVER] Game created successfully:', gameId);
    res.status(201).json(response);
  } catch (error) {
    routeFailed(req, res, error, 'Failed to create game');
  }
});

// Get game
app.get('/api/games/:id', async (req, res) => {
  try {
    const gameId = req.params.id;
    const token = req.query.token;
    
    const game = await getGame(gameId);
    
    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }
    
    if (token && game.hostToken !== token) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    // Only a caller holding the matching token gets host-only fields. Everyone
    // else (anyone with the shareable game link) gets the game without them.
    if (token && token === game.hostToken) {
      return res.json(game);
    }

    // hostNotes are the host's private reminders ("gate code 4417") - never public.
    const { hostToken, hostNotes, ...publicGame } = game;
    res.json(publicGame);
  } catch (error) {
    routeFailed(req, res, error, 'Failed to fetch game');
  }
});

app.put('/api/games/:id', async (req, res) => {
  const gameId = req.params.id;
  const releaseLock = await acquireGameLock(gameId);
  try {
    const { token, ...updateData } = req.body;
    
    console.log('[SERVER] Updating game with data:', updateData);
    console.log('[SERVER] Received notification preferences:', updateData.notificationPreferences);
    
    const game = await getGame(gameId);
    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }
    
    if (!isHost(game, token)) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    
    // IMPORTANT: Merge the update data with existing game data
    Object.assign(game, updateData);
    
    // Ensure notification preferences are properly saved
    if (updateData.notificationPreferences) {
      game.notificationPreferences = {
        gameFull: updateData.notificationPreferences.gameFull === true,
        playerJoins: updateData.notificationPreferences.playerJoins === true,
        playerCancels: updateData.notificationPreferences.playerCancels === true,
        oneSpotLeft: updateData.notificationPreferences.oneSpotLeft === true,
        waitlistStarts: updateData.notificationPreferences.waitlistStarts === true
      };
    }
    
    console.log('[SERVER] Saving game with notification preferences:', game.notificationPreferences);
    
    await saveGame(gameId, game, game.hostToken, game.hostPhone);

    // A host can move the game to a new court; remember that one too. Never fail the update over it.
    try {
      await addLocation(game.location);
    } catch (locationError) {
      console.error('[SERVER] Could not save location for reuse:', locationError);
    }

    // Verify the save worked by reading it back
    const savedGame = await getGame(gameId);
    console.log('[SERVER] Verified saved notification preferences:', savedGame.notificationPreferences);
    releaseLock();

    res.json({ 
      success: true, 
      message: 'Game updated successfully. Use the Communication tab to notify players of changes if needed.',
      notificationPreferences: savedGame.notificationPreferences
    });
  } catch (error) {
    routeFailed(req, res, error, 'Failed to update game');
  } finally {
    releaseLock();
  }
});

// Save the host's private notes for a game. Deliberately its own route rather than the
// blanket Object.assign PUT above, and deliberately with no expiry or cancelled check -
// a note about a game that already happened is still worth keeping.
app.put('/api/games/:id/notes', async (req, res) => {
  const gameId = req.params.id;
  const releaseLock = await acquireGameLock(gameId);
  try {
    const { token, hostNotes } = req.body;

    const game = await getGame(gameId);
    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }

    if (!isHost(game, token)) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    game.hostNotes = String(hostNotes == null ? '' : hostNotes).slice(0, 5000);
    await saveGame(gameId, game, game.hostToken, game.hostPhone);
    releaseLock();

    res.json({ success: true, hostNotes: game.hostNotes });
  } catch (error) {
    routeFailed(req, res, error, 'Failed to save notes');
  } finally {
    releaseLock();
  }
});

// Cancel game
app.delete('/api/games/:id', async (req, res) => {
  const gameId = req.params.id;
  const releaseLock = await acquireGameLock(gameId);
  try {
    const { token, reason } = req.body;
    
    const game = await getGame(gameId);
    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }
    
    if (!isHost(game, token)) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    
    game.cancelled = true;
    game.cancellationReason = reason;
    game.cancelledAt = new Date().toISOString();
    await saveGame(gameId, game, game.hostToken, game.hostPhone);
    releaseLock();

    // Notify all players
    const gameDate = formatDateForSMS(game.date);
    const gameTime = formatTimeForSMS(game.time);
    const cancellationMessage = `CANCELLED: Your pickleball game at ${game.location} on ${gameDate} at ${gameTime} has been cancelled. Reason: ${reason || 'No reason provided'}.`;
    
    let notificationCount = 0;
    const results = [];
    
    for (const player of game.players) {
      if (player.phone && !player.isOrganizer) {
        const result = await sendSMS(player.phone, cancellationMessage);
        results.push({ player: player.name, type: 'confirmed', result });
        if (result.success) notificationCount++;
      }
    }
    
    for (const player of game.waitlist || []) {
      if (player.phone) {
        const result = await sendSMS(player.phone, cancellationMessage);
        results.push({ player: player.name, type: 'waitlist', result });
        if (result.success) notificationCount++;
      }
    }
    
    res.json({ 
      success: true, 
      notificationCount,
      results 
    });
  } catch (error) {
    routeFailed(req, res, error, 'Failed to cancel game');
  } finally {
    releaseLock();
  }
});

// Erase a past game for good.
//
// Deliberately a separate route from the DELETE above, which only cancels: cancelling tells
// the players something, this tells nobody and cannot be undone. Two guards keep it from
// becoming a way to make a game people are counting on vanish out from under them:
// the host token, and the game having already started. No SMS goes out - everyone the game
// concerned has already played it.
app.delete('/api/games/:id/permanent', async (req, res) => {
  const gameId = req.params.id;
  const releaseLock = await acquireGameLock(gameId);
  try {
    const { token } = req.body;

    const game = await getGame(gameId);
    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }

    if (!isHost(game, token)) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    // Central Time, the same clock the reminders use, so "past" means past to the players.
    if (isGameUpcoming(game.date, game.time)) {
      return res.status(400).json({
        error: 'This game has not happened yet. Cancel it instead so the players are told.'
      });
    }

    const deleted = await deleteGamePermanently(gameId);

    console.log(`[DELETE] Host erased game ${gameId} (${game.location} ${game.date})`);
    res.json({ success: true, deleted });
  } catch (error) {
    routeFailed(req, res, error, 'Failed to delete game');
  } finally {
    releaseLock();
  }
});

// Add these endpoints to your server.js file, around line 400-500 where your other API endpoints are

// Get management links for a specific phone number
app.get('/api/games/by-phone/:phone', async (req, res) => {
  console.log(`[PHONE LOOKUP] Looking up games for phone: ${req.params.phone}`);
  
  try {
    const phoneNumber = formatPhoneNumber(req.params.phone);
    console.log(`[PHONE LOOKUP] Formatted phone: ${phoneNumber}`);

    // ?all=1 is the full host history (My Games). Without it the response keeps its old
    // shape: cancelled games drop off after a week.
    const includeAll = req.query.all === '1';

    const games = await getGamesByHostPhone(phoneNumber);
    // One grouped query for every card's photo badge, rather than one per game.
    const photoCounts = await getAllPhotoCounts();
    const hostGames = [];

    for (const fullGame of games) {
      const gameId = fullGame.gameId;

      if (!includeAll) {
        // Don't include cancelled games older than 7 days
        const gameDate = new Date(fullGame.date);
        const daysSinceGame = (new Date() - gameDate) / (1000 * 60 * 60 * 24);
        if (fullGame.cancelled && daysSinceGame > 7) continue;
      }

      hostGames.push({
        gameId,
        location: fullGame.location,
        courtNumber: fullGame.courtNumber,
        date: fullGame.date,
        time: fullGame.time,
        duration: fullGame.duration,
        cancelled: fullGame.cancelled || false,
        cancellationReason: fullGame.cancellationReason || null,
        registrationMode: fullGame.registrationMode || 'fcfs',
        hostNotes: fullGame.hostNotes || '',
        playerCount: fullGame.players ? fullGame.players.length : 0,
        totalPlayers: fullGame.totalPlayers,
        waitlistCount: fullGame.waitlist ? fullGame.waitlist.length : 0,
        photoCount: photoCounts[gameId] || 0,
        // Already inside managementLink; named separately so callers that need to authorize
        // a request (deleting a past game) don't have to pick it back out of the URL.
        hostToken: fullGame.hostToken,
        managementLink: `/manage.html?id=${gameId}&token=${fullGame.hostToken}`,
        playerLink: `/game.html?id=${gameId}`,
        created: fullGame.created
      });
    }

    // Sort by date (newest first)
    hostGames.sort((a, b) => new Date(b.date) - new Date(a.date));
    
    console.log(`[PHONE LOOKUP] Found ${hostGames.length} games for phone ${phoneNumber}`);
    
    res.json({
      phoneNumber,
      gamesFound: hostGames.length,
      games: hostGames
    });
    
  } catch (error) {
    routeFailed(req, res, error, 'Failed to lookup games');
  }
});

// ---------------------------------------------------------------------------
// Host roster
//
// Auth is the host's phone number and nothing more. That matches the existing
// /api/games/by-phone route, which already hands out management links (and therefore full
// control of a game) to anyone who knows the number. This is a private app for one friend
// group, so the accepted risk is the same one already taken there; if that ever changes,
// both routes need a real token together.
// ---------------------------------------------------------------------------


// Send management links via SMS
app.post('/api/games/lookup-and-notify', async (req, res) => {
  console.log(`[PHONE LOOKUP SMS] Looking up and notifying phone: ${req.body.phone}`);
  
  try {
    const { phone, sendSms = false } = req.body;
    const phoneNumber = formatPhoneNumber(phone);
    
    const allGames = await getAllGames();
    const recentGames = [];
    
    // Find recent games (last 30 days) where this phone number is the host
    for (const [gameId, gameData] of Object.entries(allGames)) {
      const fullGame = await getGame(gameId);
      
      if (fullGame && fullGame.hostPhone === phoneNumber) {
        const gameDate = new Date(fullGame.date);
        const daysSinceGame = (new Date() - gameDate) / (1000 * 60 * 60 * 24);
        
        // Include games from last 30 days or future games
        if (daysSinceGame <= 30 || gameDate > new Date()) {
          recentGames.push({
            gameId,
            location: fullGame.location,
            courtNumber: fullGame.courtNumber,
            date: fullGame.date,
            time: fullGame.time,
            cancelled: fullGame.cancelled || false,
            managementLink: `${req.protocol}://${req.get('host')}/manage.html?id=${gameId}&token=${fullGame.hostToken}`
          });
        }
      }
    }
    
    let smsResult = null;
    if (sendSms && recentGames.length > 0) {
      
      let message;
      if (recentGames.length === 1) {
        const game = recentGames[0];
        const gameDate = formatDateForSMS(game.date);
        const gameTime = formatTimeForSMS(game.time);
        const locationText = formatLocationForSMS(game);
        message = `Your pickleball game management link:\n\n${locationText}\n${gameDate} at ${gameTime}\n\n${game.managementLink}`;
      } else {
        // Sort by date and get the most recent upcoming game
        recentGames.sort((a, b) => new Date(a.date) - new Date(b.date));
        const upcomingGames = recentGames.filter(g => new Date(g.date) >= new Date());
        const gameToShow = upcomingGames.length > 0 ? upcomingGames[0] : recentGames[0];
        
        const gameDate = formatDateForSMS(gameToShow.date);
        const gameTime = formatTimeForSMS(gameToShow.time);
        const locationText = formatLocationForSMS(gameToShow);

        message = `You have ${recentGames.length} recent games. Here's your ${upcomingGames.length > 0 ? 'next' : 'most recent'} game:\n\n${locationText}\n${gameDate} at ${gameTime}\n\n${gameToShow.managementLink}`;
      }
      
      smsResult = await sendSMS(phoneNumber, message);
    }
    
    res.json({
      phoneNumber,
      gamesFound: recentGames.length,
      games: recentGames,
      smsResult
    });
    
  } catch (error) {
    routeFailed(req, res, error, 'Failed to lookup and notify');
  }
});




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