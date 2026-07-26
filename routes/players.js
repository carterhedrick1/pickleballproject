// Players joining, leaving and moving between the roster and the waitlist.
//
// This is the busiest and most concurrency-sensitive group in the app: every handler here is a
// read-modify-write of the whole game blob, so each one takes the per-game lock from
// utils/game-lock.js first and releases it as soon as the save lands - before any text goes
// out, so nobody waits behind an SMS round trip. verify/signup-race.js, capacity-race.js and
// mixed-race.js exist to prove that ordering holds.

const {
  getGame,
  saveGame,
  recordRosterSighting
} = require('../database');

const {
  sendSMS,
  sendSMSWithRetry,
  sendOrganizerNotification,
  formatPhoneNumber,
  formatDateForSMS,
  formatTimeForSMS,
  formatLocationForSMS
} = require('../sms-handler');

const {
  validatePlayerData,
  checkExistingPlayer,
  addPlayerToGame,
  removePlayerFromGame
} = require('../game-logic');

const { acquireGameLock } = require('../utils/game-lock');
const { isGameUpcoming } = require('../utils/central-time');
const {
  promoteNextFromWaitlist,
  recordOutPlayer,
  departureAlertType
} = require('../utils/promotion');
const { routeFailed } = require('../utils/route-error');
const { isHost } = require('../utils/host-auth');

module.exports = function mountPlayerRoutes(app) {
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
};
