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

// Everyone this host has ever played with: their saved roster rows, plus anyone who has
// appeared in one of their games. Roster values win over whatever a player typed at signup.
app.get('/api/roster/:phone', async (req, res) => {
  try {
    const hostPhone = formatPhoneNumber(req.params.phone);

    const [rosterRows, games] = await Promise.all([
      getRosterForHost(hostPhone),
      getGamesByHostPhone(hostPhone)
    ]);

    const byPhone = new Map();

    for (const game of games) {
      const countedThisGame = new Set();
      const entries = [
        ...(game.players || []),
        ...(game.waitlist || []),
        ...(game.outPlayers || [])
      ];

      for (const entry of entries) {
        if (!entry || !entry.phone) continue;                 // phoneless entries can't be matched
        const phone = formatPhoneNumber(entry.phone);
        if (!phone || phone === hostPhone) continue;          // the host is not on their own roster

        let record = byPhone.get(phone);
        if (!record) {
          record = {
            phone,
            name: '',
            duprId: '',
            duprRating: null,
            isAndroid: null,
            lastSeen: null,
            gamesCount: 0
          };
          byPhone.set(phone, record);
        }

        // A player on both the waitlist and the out list is still one game.
        if (!countedThisGame.has(phone)) {
          countedThisGame.add(phone);
          record.gamesCount += 1;
        }

        const when = entry.joinedAt || entry.outAt || game.created || game.date || null;
        if (when && (!record.lastSeen || when > record.lastSeen)) {
          record.lastSeen = when;
          if (entry.name) record.name = entry.name;           // most recent name they signed up with
        } else if (entry.name && !record.name) {
          record.name = entry.name;
        }
      }
    }

    for (const row of rosterRows) {
      const record = byPhone.get(row.playerPhone) || {
        phone: row.playerPhone,
        name: '',
        duprId: '',
        duprRating: null,
        isAndroid: null,
        lastSeen: null,
        gamesCount: 0
      };
      if (row.name) record.name = row.name;
      record.duprId = row.duprId;
      record.duprRating = row.duprRating;
      record.isAndroid = row.isAndroid;
      byPhone.set(row.playerPhone, record);
    }

    const roster = [...byPhone.values()].sort((a, b) =>
      (a.name || a.phone).localeCompare(b.name || b.phone, undefined, { sensitivity: 'base' })
    );

    res.json({ phoneNumber: hostPhone, count: roster.length, roster });
  } catch (error) {
    routeFailed(req, res, error, 'Failed to load roster');
  }
});

// Host edits one player's details.
app.put('/api/roster/:phone/:playerPhone', async (req, res) => {
  try {
    const hostPhone = formatPhoneNumber(req.params.phone);
    const playerPhone = formatPhoneNumber(req.params.playerPhone);

    if (!hostPhone || !playerPhone) {
      return res.status(400).json({ error: 'A host phone number and a player phone number are required' });
    }

    const { name, duprId, duprRating } = req.body || {};
    const cleanName = name == null ? '' : String(name).trim().slice(0, 100);
    const cleanDuprId = duprId == null ? '' : String(duprId).trim().slice(0, 50);

    let cleanRating = null;
    if (duprRating !== undefined && duprRating !== null && String(duprRating).trim() !== '') {
      const parsed = Number(duprRating);
      if (!Number.isFinite(parsed) || parsed < 0 || parsed > 10) {
        return res.status(400).json({ error: 'DUPR rating should be a number between 0 and 10 (for example 3.75)' });
      }
      cleanRating = parsed;
    }

    await upsertRosterEntry(hostPhone, playerPhone, cleanName, cleanDuprId, cleanRating);

    res.json({
      success: true,
      player: { phone: playerPhone, name: cleanName, duprId: cleanDuprId, duprRating: cleanRating }
    });
  } catch (error) {
    routeFailed(req, res, error, 'Failed to save roster entry');
  }
});

// A host's numbers. Same phone-only access as the roster and by-phone routes above.
app.get('/api/stats/:phone', async (req, res) => {
  try {
    const hostPhone = formatPhoneNumber(req.params.phone);

    const [games, roster] = await Promise.all([
      getGamesByHostPhone(hostPhone),
      getRosterForHost(hostPhone)
    ]);

    res.json(computeHostStats(hostPhone, games, roster));
  } catch (error) {
    routeFailed(req, res, error, 'Failed to load stats');
  }
});

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

// Quietly builds the host's roster as people sign up. A roster row is a nicety - a failure
// here must never turn a successful signup into an error, so it only logs.
async function noteRosterSighting(hostPhone, playerData, isAndroid) {
  if (!hostPhone || !playerData || !playerData.phone) return;
  try {
    await recordRosterSighting(
      formatPhoneNumber(hostPhone),
      formatPhoneNumber(playerData.phone),
      playerData.name,
      isAndroid
    );
  } catch (error) {
    console.error('[ROSTER] Could not record sighting:', error);
  }
}

// Add player to game (regular signup)
app.post('/api/games/:id/players', async (req, res) => {
  const gameId = req.params.id;
  // Held from loading the game until the save completes, so simultaneous signups cannot
  // overwrite one another. Released before any SMS so nobody queues behind a Textbelt call.
  const releaseLock = await acquireGameLock(gameId);
  try {
    const game = await getGame(gameId);

    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }

    const { name, phone, action } = req.body;

    // Which phone somebody signed up on. Captured silently for now - nothing in the app
    // behaves differently because of it yet.
    const isAndroid = /Android/i.test(req.headers['user-agent'] || '');

    // Handle "I'm Out" responses.
    //
    // This used to only ever append to outPlayers, which meant a confirmed player who tapped
    // OUT on the web stayed on the roster and their spot was never released - the exact
    // last-minute-cancellation problem this app exists to fix. Now the same three cases the
    // SMS "9" flow handles are handled here too.
    if (action === 'out') {
      const playerData = validatePlayerData(name, phone);
      playerData.isAndroid = isAndroid;

      // validatePlayerData has already normalized the phone, so these compare directly.
      const confirmedIndex = playerData.phone
        ? game.players.findIndex((p) => p.phone === playerData.phone)
        : -1;
      const waitlistIndex = playerData.phone && confirmedIndex === -1
        ? (game.waitlist || []).findIndex((p) => p.phone === playerData.phone)
        : -1;

      const gameDate = formatDateForSMS(game.date);
      const gameTime = formatTimeForSMS(game.time);
      const locationText = formatLocationForSMS(game);

      // --- 1. They are on the roster: give up the spot and fill it. -----------------------
      if (confirmedIndex >= 0) {
        const departing = game.players[confirmedIndex];

        if (departing.isOrganizer) {
          return res.status(400).json({
            error: "You're the organizer of this game. Use your management link to cancel it or to remove yourself."
          });
        }

        game.players.splice(confirmedIndex, 1);
        const outEntry = recordOutPlayer(game, { ...departing, isAndroid }, { wasConfirmed: true });
        const promoted = promoteNextFromWaitlist(game);

        await saveGame(gameId, game, game.hostToken, game.hostPhone);
        releaseLock();

        await noteRosterSighting(game.hostPhone, playerData, isAndroid ? 1 : 0);

        let smsResult = null;
        if (departing.phone) {
          const message = `Your pickleball reservation at ${locationText} on ${gameDate} at ${gameTime} has been cancelled. Thanks for letting us know!`;
          smsResult = await sendSMSWithRetry(departing.phone, message, gameId);
          if (!smsResult.success) {
            console.error(`[SERVER] ${departing.name} cancelled on game ${gameId} but the confirmation text failed:`, smsResult.error);
          }
        }

        // The promotion already happened in the database. If this text fails the player is
        // still promoted - same already-committed precedent as every other promotion here.
        if (promoted && promoted.phone) {
          const promoMessage = `Good news! You've been promoted from the waitlist to confirmed for the pickleball game at ${locationText} on ${gameDate} at ${gameTime}! You are Player ${game.players.length} of ${game.totalPlayers}. Reply 2 for details or 9 to cancel.`;
          const promoResult = await sendSMSWithRetry(promoted.phone, promoMessage, gameId);
          if (!promoResult.success) {
            console.error(`[SERVER] ${promoted.name} was promoted on game ${gameId} but could not be told:`, promoResult.error);
          }
        }

        await sendOrganizerNotification(
          gameId, game, departureAlertType(game, true), departing.name
        );

        return res.status(201).json({
          action: 'out',
          cancelled: true,
          wasConfirmed: true,
          playerId: outEntry.id,
          promoted: promoted ? promoted.name : null,
          sms: smsResult
        });
      }

      // --- 2. They are on the waitlist: take them off it. --------------------------------
      if (waitlistIndex >= 0) {
        const departing = game.waitlist[waitlistIndex];
        game.waitlist.splice(waitlistIndex, 1);
        const outEntry = recordOutPlayer(game, { ...departing, isAndroid }, { wasWaitlisted: true });

        await saveGame(gameId, game, game.hostToken, game.hostPhone);
        releaseLock();

        await noteRosterSighting(game.hostPhone, playerData, isAndroid ? 1 : 0);

        let smsResult = null;
        if (departing.phone) {
          const statusText = game.registrationMode === 'waitlist' ? 'application' : 'waitlist spot';
          const message = `Your pickleball ${statusText} at ${locationText} on ${gameDate} at ${gameTime} has been cancelled. Thanks for letting us know!`;
          smsResult = await sendSMSWithRetry(departing.phone, message, gameId);
          if (!smsResult.success) {
            console.error(`[SERVER] ${departing.name} left the waitlist on game ${gameId} but the confirmation text failed:`, smsResult.error);
          }
        }

        await sendOrganizerNotification(gameId, game, 'playerCancels', departing.name);

        return res.status(201).json({
          action: 'out',
          cancelled: true,
          wasConfirmed: false,
          playerId: outEntry.id,
          sms: smsResult
        });
      }

      // --- 3. Nobody we know: an RSVP of "no", as before. --------------------------------
      const outEntry = recordOutPlayer(game, playerData, {});
      await saveGame(gameId, game, game.hostToken, game.hostPhone);
      releaseLock();

      await noteRosterSighting(game.hostPhone, playerData, isAndroid ? 1 : 0);

      let smsResult = null;
      if (playerData.phone) {
        const message = `Thanks for letting us know you can't make the pickleball game at ${locationText} on ${gameDate} at ${gameTime}. We appreciate the heads up!`;
        // Retries once, and the result is reported to the client so the page can say the text
        // did not go out rather than silently promising one.
        smsResult = await sendSMSWithRetry(playerData.phone, message, gameId);
        if (!smsResult.success) {
          console.error(`[SERVER] "I'm out" recorded for ${playerData.phone} on game ${gameId} but the confirmation text failed:`, smsResult.error);
        }
      }

      return res.status(201).json({
        action: 'out',
        cancelled: false,
        wasConfirmed: false,
        playerId: outEntry.id,
        sms: smsResult
      });
    }
        // Enhanced validation with better error messages
    let playerData;
    try {
      playerData = validatePlayerData(name, phone);
    } catch (validationError) {
      console.log('[SERVER] Validation error details:');
      console.log('  - Error message:', validationError.message);
      console.log('  - Phone input:', phone);
      console.log('  - User agent:', req.headers['user-agent']);
      
      // Check if this might be a Chrome iOS specific issue
      const userAgent = req.headers['user-agent'] || '';
      const isChromeIOS = userAgent.includes('CriOS');
      
      if (isChromeIOS && validationError.message.includes('valid US phone number')) {
        console.log('[SERVER] Detected Chrome iOS phone validation issue');
        
        // Try a more lenient validation for Chrome iOS
        const cleaned = phone ? phone.replace(/\D/g, '') : '';
        if (cleaned.length >= 10 && cleaned.length <= 15) {
          console.log('[SERVER] Accepting phone number with lenient validation for Chrome iOS');
          playerData = {
            name: name ? name.trim() : '',
            phone: cleaned.length === 11 && cleaned.startsWith('1') ? cleaned.substring(1) : cleaned
          };
        } else {
          return res.status(400).json({ 
            error: 'Please enter a valid phone number. For Chrome iOS users: try entering just the 10 digits (e.g., 5551234567).' 
          });
        }
      } else {
        return res.status(400).json({ error: validationError.message });
      }
    }

    playerData.isAndroid = isAndroid;

    // Check if player already exists
    const existingCheck = checkExistingPlayer(game, playerData.phone);
    if (existingCheck.exists) {
      return res.status(400).json({ error: existingCheck.message });
    }
    
    // Add player to game
    const result = addPlayerToGame(game, playerData);
    
    // MOVED: Save game BEFORE sending notifications
    await saveGame(gameId, game, game.hostToken, game.hostPhone);
    releaseLock();

    await noteRosterSighting(game.hostPhone, playerData, isAndroid ? 1 : 0);

    // Send confirmation SMS to the player
    let smsResult = null;
    if (playerData.phone) {
      const gameDate = formatDateForSMS(game.date);
      const gameTime = formatTimeForSMS(game.time);
      const locationText = formatLocationForSMS(game);

      let message;
      if (result.status === 'confirmed') {
        message = `You're confirmed for Pickleball at ${locationText} on ${gameDate} at ${gameTime}! You are Player ${result.position} of ${game.totalPlayers}. Reply 2 for game details or 9 to cancel.`;
      } else {
        // Handle waitlist mode vs regular waitlist
        if (result.hidePosition || game.registrationMode === 'waitlist') {
          // Waitlist mode - don't show position, don't mention "2" for details
          message = `Thanks for signing up for Pickleball at ${locationText} on ${gameDate} at ${gameTime}! The organizer will review applications and select players. You'll be notified if selected. Reply 9 to cancel your application.`;
        } else {
          // Regular waitlist - show position, allow details
          message = `You've been added to the waitlist for Pickleball at ${locationText}. You are #${result.position} on the waitlist. We'll notify you if a spot opens up! Reply 2 for game details or 9 to cancel.`;
        }
      }
      
      // Retries once, and the result is reported to the client so the page can say the text
      // did not go out rather than silently promising one. The signup itself is already saved
      // and stays valid either way.
      smsResult = await sendSMSWithRetry(playerData.phone, message, gameId);
      if (!smsResult.success) {
        console.error(`[SERVER] ${playerData.name} joined game ${gameId} but the confirmation text to ${playerData.phone} failed:`, smsResult.error);
      }
    }

    // Send organizer notifications (now after saving)
    if (result.status === 'confirmed') {
      // Always send player joined notification first
      await sendOrganizerNotification(gameId, game, 'playerJoins', playerData.name);
      
      // Check if game is now full
      if (game.players.length === parseInt(game.totalPlayers)) {
        await sendOrganizerNotification(gameId, game, 'gameFull');
      }
      // Only send "one spot left" if they DON'T have "player joins" enabled
      else if (game.players.length === parseInt(game.totalPlayers) - 1) {
        if (!game.notificationPreferences?.playerJoins) {
          await sendOrganizerNotification(gameId, game, 'oneSpotLeft');
        }
      }
    } else if (result.status === 'waitlist') {
      // Check if this is the first person on waitlist
      if ((game.waitlist || []).length === 1) {
        await sendOrganizerNotification(gameId, game, 'waitlistStarts', playerData.name);
      }
    }

    // Send response back to client (ONLY ONE RESPONSE!)
    res.status(201).json({ 
      ...result,
      sms: smsResult
    });
    
  } catch (error) {
    routeFailed(req, res, error, error.message || 'Failed to add player');
  } finally {
    // No-op if already released after the save; this covers the early returns and error paths.
    releaseLock();
  }
});



// Add player manually (host function)
app.post('/api/games/:id/manual-player', async (req, res) => {
  const gameId = req.params.id;
  const releaseLock = await acquireGameLock(gameId);
  try {
    const { name, phone, addTo, token } = req.body;
    
    const game = await getGame(gameId);
    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }
    
    if (!isHost(game, token)) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    
    // Validate player data
    const playerData = validatePlayerData(name, phone);
    
    // Check if player already exists
    const existingCheck = checkExistingPlayer(game, playerData.phone);
    if (existingCheck.exists) {
      return res.status(400).json({ error: existingCheck.message });
    }

    
    
    // Add player to game (force waitlist if requested)
    const forceWaitlist = addTo === 'waitlist';
    const result = addPlayerToGame(game, playerData, forceWaitlist);
    await saveGame(gameId, game, game.hostToken, game.hostPhone);
    releaseLock();

    // The host typed this in on their own browser, so the user agent says nothing about the
    // player's phone. Record the sighting, but leave the Android flag unknown.
    await noteRosterSighting(game.hostPhone, playerData, null);

    // Send SMS confirmation to the added player
    let smsResult = null;
    if (playerData.phone) {
      const gameDate = formatDateForSMS(game.date);
      const gameTime = formatTimeForSMS(game.time);
      const locationText = formatLocationForSMS(game);

      let message;
      if (result.status === 'confirmed') {
        message = `You've been added to the pickleball game at ${locationText} on ${gameDate} at ${gameTime}! You are Player ${result.position} of ${game.totalPlayers}. Reply 2 for details or 9 to cancel.`;
      } else {
        message = `You've been added to the waitlist for the pickleball game at ${locationText}. You are #${result.position} on the waitlist. You'll be notified if a spot opens up! Reply 2 for details or 9 to cancel.`;
      }
      
      smsResult = await sendSMS(playerData.phone, message, gameId);
    }
    
    const statusText = result.status === 'confirmed' ? 'game' : 'waitlist';
    res.json({
      success: true,
      message: `${playerData.name} added to ${statusText}`,
      sms: smsResult,
      ...result
    });
  } catch (error) {
    routeFailed(req, res, error, error.message || 'Failed to add player');
  } finally {
    releaseLock();
  }
});

// NEW ENDPOINT: Move player to waitlist with SMS notification
app.post('/api/games/:id/move-to-waitlist/:playerId', async (req, res) => {
  const gameId = req.params.id;
  const releaseLock = await acquireGameLock(gameId);
  try {
    const playerId = req.params.playerId;
    const { token } = req.body;
    
    const game = await getGame(gameId);
    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }
    
    if (!isHost(game, token)) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    
    // Find the player in confirmed players
    const playerIndex = game.players.findIndex(p => p.id === playerId);
    if (playerIndex === -1) {
      return res.status(404).json({ error: 'Player not found in confirmed players' });
    }
    
    const player = game.players[playerIndex];
    
    // Remove from confirmed players and add to waitlist
    game.players.splice(playerIndex, 1);
    if (!game.waitlist) game.waitlist = [];
    game.waitlist.push(player);

    await saveGame(gameId, game, game.hostToken, game.hostPhone);
    releaseLock();

    // Send SMS notification to the moved player
    let smsResult = null;
    if (player.phone) {
      const gameDate = formatDateForSMS(game.date);
      const gameTime = formatTimeForSMS(game.time);
      const locationText = formatLocationForSMS(game);

      const message = `You've been moved to the waitlist for the pickleball game at ${locationText} on ${gameDate} at ${gameTime}. You are #${game.waitlist.length} on the waitlist. Reply 2 for details or 9 to cancel.`;
      smsResult = await sendSMS(player.phone, message, gameId);
    }
    
    res.json({
      success: true,
      message: `${player.name} moved to waitlist`,
      sms: smsResult
    });
  } catch (error) {
    routeFailed(req, res, error, 'Failed to move player to waitlist');
  } finally {
    releaseLock();
  }
});

// NEW ENDPOINT: Promote player from waitlist with SMS notification
app.post('/api/games/:id/promote-from-waitlist/:playerId', async (req, res) => {
  const gameId = req.params.id;
  const releaseLock = await acquireGameLock(gameId);
  try {
    const playerId = req.params.playerId;
    const { token } = req.body;
    
    const game = await getGame(gameId);
    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }
    
    if (!isHost(game, token)) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    
    // Check if game is full
    if (game.players.length >= parseInt(game.totalPlayers)) {
      return res.status(400).json({ error: 'Cannot promote: Game is already full' });
    }
    
    // Find the player in waitlist
    const waitlistIndex = (game.waitlist || []).findIndex(p => p.id === playerId);
    if (waitlistIndex === -1) {
      return res.status(404).json({ error: 'Player not found in waitlist' });
    }
    
    const player = game.waitlist[waitlistIndex];
    
    // Remove from waitlist and add to confirmed players
    game.waitlist.splice(waitlistIndex, 1);
    game.players.push(player);

    await saveGame(gameId, game, game.hostToken, game.hostPhone);
    releaseLock();

    // Send SMS notification to the promoted player
    let smsResult = null;
    if (player.phone) {
      const gameDate = formatDateForSMS(game.date);
      const gameTime = formatTimeForSMS(game.time);
      const locationText = formatLocationForSMS(game);

      const message = `Great news! You've been promoted from the waitlist to confirmed for the pickleball game at ${locationText} on ${gameDate} at ${gameTime}! You are Player ${game.players.length} of ${game.totalPlayers}. Reply 2 for who is playing and details or 9 to cancel.`;
      // Retried for the same reason as the promotion above: a promotion the player never hears
      // about looks identical to still being on the waitlist.
      smsResult = await sendSMSWithRetry(player.phone, message, gameId);
      if (!smsResult.success) {
        console.error(`[SERVER] ${player.name} was promoted on game ${gameId} but could not be told:`, smsResult.error);
      }
    }
    
    res.json({
      success: true,
      message: `${player.name} promoted to confirmed players`,
      sms: smsResult
    });
  } catch (error) {
    routeFailed(req, res, error, 'Failed to promote player from waitlist');
  } finally {
    releaseLock();
  }
});

// ENHANCED: Remove player from game with SMS notification
app.delete('/api/games/:id/players/:playerId', async (req, res) => {
  const gameId = req.params.id;
  const releaseLock = await acquireGameLock(gameId);
  try {
    const playerId = req.params.playerId;
    const token = req.query.token;

    const game = await getGame(gameId);
    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }

    // Removing a player is a host action, so it needs the host token. This used to let a
    // request with NO token through entirely - only a wrong one was rejected.
    if (!isHost(game, token)) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    // Find player to get their info before removal
    let removedPlayer = null;
    let removalType = null;
    
    // Check confirmed players
    const confirmedIndex = game.players.findIndex(p => p.id === playerId);
    if (confirmedIndex >= 0) {
      removedPlayer = game.players[confirmedIndex];
      removalType = 'confirmed';
    } else {
      // Check waitlist
      const waitlistIndex = (game.waitlist || []).findIndex(p => p.id === playerId);
      if (waitlistIndex >= 0) {
        removedPlayer = game.waitlist[waitlistIndex];
        removalType = 'waitlist';
      }
    }
    
    if (!removedPlayer) {
      return res.status(404).json({ error: 'Player not found' });
    }
    
    // Remove player using existing game logic
    const result = removePlayerFromGame(game, playerId);
    await saveGame(gameId, game, game.hostToken, game.hostPhone);
    releaseLock();

    // Send removal notification to the removed player (if they have a phone and aren't organizer)
    let removalSmsResult = null;
    if (removedPlayer.phone && !removedPlayer.isOrganizer) { // the token check above guarantees the host
      const gameDate = formatDateForSMS(game.date);
      const gameTime = formatTimeForSMS(game.time);
      const locationText = formatLocationForSMS(game);

      const statusText = removalType === 'confirmed' ? 'registration' : 'waitlist spot';
      const message = `Your ${statusText} for the pickleball game at ${locationText} on ${gameDate} at ${gameTime} has been cancelled by the organizer.`;
      removalSmsResult = await sendSMS(removedPlayer.phone, message);
    }
    
    // Send promotion SMS if someone was promoted from waitlist (this already exists in the logic)
    let promotionSmsResult = null;
    if (result.promotedPlayer && result.promotedPlayer.phone) {
      const gameDate = formatDateForSMS(game.date);
      const gameTime = formatTimeForSMS(game.time);
      const locationText = formatLocationForSMS(game);

      const message = `Good news! You've been promoted from the waitlist to confirmed for the pickleball game at ${locationText} on ${gameDate} at ${gameTime}! You are Player ${game.players.length} of ${game.totalPlayers}. Reply 2 for details or 9 to cancel.`;
      // Retried: this is the one text nobody can recover from missing. The player has been
      // moved onto the roster in the database either way, so if it never arrives they believe
      // they are still on the waitlist and simply do not turn up.
      promotionSmsResult = await sendSMSWithRetry(result.promotedPlayer.phone, message, gameId);
      if (!promotionSmsResult.success) {
        console.error(`[SERVER] ${result.promotedPlayer.name} was promoted on game ${gameId} but could not be told:`, promotionSmsResult.error);
      }
    }

// Send organizer notification for cancellation. In approval mode, removing a confirmed player
// leaves a spot only the host can fill, so they are told that rather than "someone cancelled".
if (removedPlayer && !removedPlayer.isOrganizer) {
  await sendOrganizerNotification(
    gameId, game, departureAlertType(game, removalType === 'confirmed'), removedPlayer.name
  );
}

res.json({ 
  ...result,
  removalSms: removalSmsResult,
  promotionSms: promotionSmsResult
});
  } catch (error) {
    routeFailed(req, res, error, 'Failed to remove player');
  } finally {
    releaseLock();
  }
});


// Send announcement
app.post('/api/games/:id/announcement', async (req, res) => {
  try {
    const gameId = req.params.id;
    const { token, message, includeConfirmed, includeWaitlist } = req.body;
    
    const game = await getGame(gameId);
    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }
    
    if (!isHost(game, token)) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    
    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'Message is required' });
    }
    
    let recipientCount = 0;
    const results = [];
    
    if (includeConfirmed) {
      for (const player of game.players) {
        if (player.phone && !player.isOrganizer) {
          const result = await sendSMS(player.phone, message, gameId);
          results.push({ player: player.name, type: 'confirmed', result });
          if (result.success) recipientCount++;
        }
      }
    }
    
    if (includeWaitlist) {
      for (const player of game.waitlist || []) {
        if (player.phone) {
          const result = await sendSMS(player.phone, message);
          results.push({ player: player.name, type: 'waitlist', result });
          if (result.success) recipientCount++;
        }
      }
    }
    
    res.json({ 
      success: true, 
      recipientCount,
      results 
    });
  } catch (error) {
    routeFailed(req, res, error, 'Failed to send announcement');
  }
});

// Send announcement to individual players
app.post('/api/games/:id/announcement-individual', async (req, res) => {
  try {
    const gameId = req.params.id;
    const { token, message, recipients } = req.body;
    
    const game = await getGame(gameId);
    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }
    
    if (!isHost(game, token)) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    
    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'Message is required' });
    }
    
    if (!recipients || recipients.length === 0) {
      return res.status(400).json({ error: 'At least one recipient is required' });
    }
    
    let recipientCount = 0;
    const results = [];
    
    // Send to each selected recipient
    for (const recipient of recipients) {
      if (recipient.phone) {
        const result = await sendSMS(recipient.phone, message, gameId);
        results.push({ 
          player: recipient.name, 
          type: recipient.type, 
          phone: recipient.phone,
          result 
        });
        if (result.success) recipientCount++;
      }
    }
    
    res.json({ 
      success: true, 
      recipientCount,
      totalRecipients: recipients.length,
      results 
    });
  } catch (error) {
    routeFailed(req, res, error, 'Failed to send announcement');
  }
});

// Remove "out" player
app.delete('/api/games/:id/out-players/:playerId', async (req, res) => {
  const gameId = req.params.id;
  const releaseLock = await acquireGameLock(gameId);
  try {
    const playerId = req.params.playerId;
    const token = req.query.token;

    const game = await getGame(gameId);
    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }

    if (!isHost(game, token)) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    // Find and remove the out player
    if (!game.outPlayers) {
      return res.status(404).json({ error: 'Player not found' });
    }
    
    const playerIndex = game.outPlayers.findIndex(p => p.id === playerId);
    if (playerIndex === -1) {
      return res.status(404).json({ error: 'Player not found' });
    }
    
    const removedPlayer = game.outPlayers.splice(playerIndex, 1)[0];
    await saveGame(gameId, game, game.hostToken, game.hostPhone);
    releaseLock();

    res.json({
      success: true,
      message: `${removedPlayer.name} removed from "out" list`
    });
  } catch (error) {
    routeFailed(req, res, error, 'Failed to remove player');
  } finally {
    releaseLock();
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