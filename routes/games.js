// The game itself: creating one, reading it, editing it, cancelling it, and the host's own
// history of games by phone number.
//
// The four mutating routes take the per-game lock, because each is a read-modify-write of the
// whole game blob. Note that PUT /api/games/:id is a blanket Object.assign of whatever the
// caller sends - the widest-reaching route in the app, and the reason host-token auth on it
// matters more than anywhere else.

const crypto = require('crypto');

const {
  saveGame,
  getGame,
  getAllGames,
  getGamesByHostPhone,
  deleteGamePermanently,
  addLocation,
  getAllPhotoCounts
} = require('../database');

const {
  sendSMS,
  formatPhoneNumber,
  formatDateForSMS,
  formatTimeForSMS,
  formatLocationForSMS
} = require('../sms-handler');

const {
  createGameData,
  isValidPhoneNumber
} = require('../game-logic');

const { acquireGameLock } = require('../utils/game-lock');
const { isGameUpcoming } = require('../utils/central-time');
const { routeFailed } = require('../utils/route-error');
const { isHost } = require('../utils/host-auth');
const { applyGameUpdate } = require('../utils/game-update');
const { resolveTextMessage } = require('../services/text-message-rotation');
const { appendCustomReplyInstructions } = require('../sms-reply-options');

module.exports = function mountGameRoutes(app) {
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
        totalPlayers: gameData.totalPlayers,
        playersNeeded: gameData.totalPlayers - (gameData.organizerPlaying ? 1 : 0),
        playerLink: `/game.html?id=${gameId}`,
        hostLink: `/manage.html?id=${gameId}&token=${hostToken}`
      };
      
      // Send confirmation SMS to host
      let smsResult = null;
      if (hostPhone) {
        const gameDate = formatDateForSMS(gameData.date);
        const gameTime = formatTimeForSMS(gameData.time);
        const locationText = formatLocationForSMS(gameData);
        const defaultHostMessage = `Your pickleball game at ${locationText} on ${gameDate} at ${gameTime} has been created! Reply "1" for management link or "2" for game details.`;
        let hostMessage = await resolveTextMessage(
          'game-created',
          defaultHostMessage,
          { LOCATION: locationText, DATE: gameDate, TIME: gameTime }
        );
        hostMessage = await appendCustomReplyInstructions(hostMessage, 'host');
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
      
      applyGameUpdate(game, updateData);
      
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
      const cancellationReason = reason || 'No reason provided';
      const defaultCancellationMessage = `CANCELLED: Your pickleball game at ${game.location} on ${gameDate} at ${gameTime} has been cancelled. Reason: ${cancellationReason}.`;
      const cancellationMessage = await resolveTextMessage(
        'game-cancelled',
        defaultCancellationMessage,
        {
          LOCATION: game.location,
          DATE: gameDate,
          TIME: gameTime,
          REASON: cancellationReason
        }
      );
      
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

  // Erase a past or cancelled game for good.
  //
  // Deliberately a separate route from the DELETE above, which only cancels: cancelling tells
  // the players something, this tells nobody and cannot be undone. Two guards keep it from
  // becoming a way to make an active game people are counting on vanish out from under them:
  // the host token, plus either prior cancellation (which already notified players) or the
  // scheduled start having passed. This route itself sends no SMS.
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
      // A cancelled game is already closed and its players were notified, so it can be erased
      // immediately even if its scheduled start is still upcoming.
      if (!game.cancelled && isGameUpcoming(game.date, game.time)) {
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
          date: fullGame.date,
          time: fullGame.time,
          duration: fullGame.duration,
          cancelled: fullGame.cancelled || false,
          cancellationReason: fullGame.cancellationReason || null,
          registrationMode: fullGame.registrationMode || 'fcfs',
          hostNotes: fullGame.hostNotes || '',
          playerCount: fullGame.players ? fullGame.players.length : 0,
          totalPlayers: fullGame.totalPlayers,
          organizerPlaying: fullGame.organizerPlaying === true,
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
        
        const templateGame = recentGames.length === 1
          ? recentGames[0]
          : recentGames.find(g => new Date(g.date) >= new Date()) || recentGames[0];
        message = await resolveTextMessage(
          'management-links',
          message,
          {
            LOCATION: formatLocationForSMS(templateGame),
            DATE: formatDateForSMS(templateGame.date),
            TIME: formatTimeForSMS(templateGame.time),
            MANAGEMENT_LINK: templateGame.managementLink,
            GAME_COUNT: recentGames.length
          }
        );
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

};
