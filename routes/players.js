// Players joining, leaving and moving between the roster and the waitlist.
//
// This is the busiest and most concurrency-sensitive group in the app: every handler here is a
// read-modify-write of the whole game blob, so each one takes the per-game lock from
// utils/game-lock.js first and releases it as soon as the save lands - before any text goes
// out, so nobody waits behind an SMS round trip. verify/signup-race.js, capacity-race.js and
// mixed-race.js exist to prove that ordering holds.

const {
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
} = require('../game-logic');

const { isGameUpcoming } = require('../utils/central-time');
const {
  departureAlertType
} = require('../utils/promotion');
const { routeFailed } = require('../utils/route-error');
const {
  joinGame,
  joinGameAsHost,
  leaveGame,
  moveToWaitlist,
  promoteFromWaitlist,
  removeFromGame
} = require('../services/player-service');
const { buildSelectedPlayerMessage } = require('../services/youre-in-rotation');
const { resolveTextMessage } = require('../services/text-message-rotation');
const { appendCustomReplyInstructions } = require('../sms-reply-options');

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
    try {
      const { name, phone, action } = req.body;
      const isAndroid = /Android/i.test(req.headers['user-agent'] || '');
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

      if (action === 'out') {
        const result = await leaveGame(
          gameId,
          playerData,
          { recordUnknown: true, protectOrganizer: true }
        );
        if (result.status === 'game_not_found') {
          return res.status(404).json({ error: 'Game not found' });
        }
        if (result.status === 'organizer') {
          return res.status(400).json({
            error: "You're the organizer of this game. Use your management link to cancel it or to remove yourself."
          });
        }

        const game = result.game;
        const departing = result.player;
        const gameDate = formatDateForSMS(game.date);
        const gameTime = formatTimeForSMS(game.time);
        const locationText = formatLocationForSMS(game);
        await noteRosterSighting(game.hostPhone, playerData, isAndroid ? 1 : 0);

        let smsResult = null;
        if (playerData.phone) {
          let message;
          if (result.previousStatus === 'confirmed') {
            message = `Your pickleball reservation at ${locationText} on ${gameDate} at ${gameTime} has been cancelled. Thanks for letting us know!`;
          } else if (result.previousStatus === 'waitlist') {
            const statusText = game.registrationMode === 'waitlist' ? 'application' : 'waitlist spot';
            message = `Your pickleball ${statusText} at ${locationText} on ${gameDate} at ${gameTime} has been cancelled. Thanks for letting us know!`;
          } else {
            message = `Thanks for letting us know you can't make the pickleball game at ${locationText} on ${gameDate} at ${gameTime}. We appreciate the heads up!`;
          }
          message = await resolveTextMessage(
            'player-cancellation',
            message,
            {
              LOCATION: locationText,
              DATE: gameDate,
              TIME: gameTime,
              STATUS: result.previousStatus || 'out'
            }
          );
          smsResult = await sendSMSWithRetry(playerData.phone, message, gameId);
        }

        if (result.promotedPlayer?.phone) {
          const promoted = result.promotedPlayer;
          const promoMessage = await buildSelectedPlayerMessage(game, game.players.length);
          const promoResult = await sendSMSWithRetry(promoted.phone, promoMessage, gameId);
          if (!promoResult.success) {
            console.error(`[SERVER] ${promoted.name} was promoted on game ${gameId} but could not be told:`, promoResult.error);
          }
        }

        if (result.previousStatus) {
          await sendOrganizerNotification(
            gameId,
            game,
            departureAlertType(game, result.previousStatus === 'confirmed'),
            departing.name
          );
        }

        return res.status(201).json({
          action: 'out',
          cancelled: Boolean(result.previousStatus),
          wasConfirmed: result.previousStatus === 'confirmed',
          playerId: result.outEntry.id,
          promoted: result.promotedPlayer?.name || null,
          sms: smsResult
        });
      }

      const result = await joinGame(gameId, playerData);
      if (result.status === 'game_not_found') {
        return res.status(404).json({ error: 'Game not found' });
      }
      if (result.status === 'duplicate') {
        const message = result.duplicateStatus === 'confirmed'
          ? 'This phone number is already registered for this game'
          : 'This phone number is already on the waitlist';
        return res.status(400).json({ error: message });
      }

      const game = result.game;
      await noteRosterSighting(game.hostPhone, playerData, isAndroid ? 1 : 0);

      // Send confirmation SMS to the player
      let smsResult = null;
      if (playerData.phone) {
        const gameDate = formatDateForSMS(game.date);
        const gameTime = formatTimeForSMS(game.time);
        const locationText = formatLocationForSMS(game);

        let message;
        if (result.status === 'confirmed') {
          message = await buildSelectedPlayerMessage(game, result.position);
        } else {
          // Handle waitlist mode vs regular waitlist
          if (result.hidePosition || game.registrationMode === 'waitlist') {
            // Waitlist mode - don't show position, don't mention "2" for details
            message = `Thanks for signing up for Pickleball at ${locationText} on ${gameDate} at ${gameTime}! The organizer will review applications and select players. You'll be notified if selected. Reply 9 to cancel your application.`;
          } else {
            // Regular waitlist - show position, allow details
            message = `You've been added to the waitlist for Pickleball at ${locationText}. You are #${result.position} on the waitlist. We'll notify you if a spot opens up! Reply 2 for game details or 9 to cancel.`;
          }
          message = await resolveTextMessage(
            game.registrationMode === 'waitlist'
              ? 'application-confirmation'
              : 'waitlist-confirmation',
            message,
            {
              LOCATION: locationText,
              DATE: gameDate,
              TIME: gameTime,
              POSITION: result.position
            }
          );
        }
        message = await appendCustomReplyInstructions(message, 'player');
        
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
        status: result.status,
        position: result.position,
        playerId: result.player.id,
        reason: result.reason,
        hidePosition: result.hidePosition,
        totalPlayers: result.totalPlayers,
        sms: smsResult
      });
      
    } catch (error) {
      routeFailed(req, res, error, error.message || 'Failed to add player');
    }
  });



  // Add player manually (host function)
  app.post('/api/games/:id/manual-player', async (req, res) => {
    const gameId = req.params.id;
    try {
      const { name, phone, addTo, token } = req.body;
      const playerData = validatePlayerData(name, phone);
      const forceWaitlist = addTo === 'waitlist';
      const result = await joinGameAsHost(
        gameId,
        playerData,
        { forceWaitlist },
        token
      );
      if (result.status === 'game_not_found') {
        return res.status(404).json({ error: 'Game not found' });
      }
      if (result.status === 'unauthorized') {
        return res.status(403).json({ error: 'Unauthorized' });
      }
      if (result.status === 'duplicate') {
        const message = result.duplicateStatus === 'confirmed'
          ? 'This phone number is already registered for this game'
          : 'This phone number is already on the waitlist';
        return res.status(400).json({ error: message });
      }

      // The host typed this in on their own browser, so the user agent says nothing about the
      // player's phone. Record the sighting, but leave the Android flag unknown.
      const game = result.game;
      await noteRosterSighting(game.hostPhone, playerData, null);

      // Send SMS confirmation to the added player
      let smsResult = null;
      if (playerData.phone) {
        const gameDate = formatDateForSMS(game.date);
        const gameTime = formatTimeForSMS(game.time);
        const locationText = formatLocationForSMS(game);

        let message;
        if (result.status === 'confirmed') {
          message = await buildSelectedPlayerMessage(game, result.position);
        } else {
          message = `You've been added to the waitlist for the pickleball game at ${locationText}. You are #${result.position} on the waitlist. You'll be notified if a spot opens up! Reply 2 for details or 9 to cancel.`;
          message = await resolveTextMessage(
            game.registrationMode === 'waitlist'
              ? 'application-confirmation'
              : 'waitlist-confirmation',
            message,
            {
              LOCATION: locationText,
              DATE: gameDate,
              TIME: gameTime,
              POSITION: result.position
            }
          );
        }
        message = await appendCustomReplyInstructions(message, 'player');
        
        smsResult = await sendSMS(playerData.phone, message, gameId);
      }
      
      const statusText = result.status === 'confirmed' ? 'game' : 'waitlist';
      res.json({
        success: true,
        message: `${playerData.name} added to ${statusText}`,
        sms: smsResult,
        status: result.status,
        position: result.position,
        playerId: result.player.id,
        reason: result.reason,
        hidePosition: result.hidePosition,
        totalPlayers: result.totalPlayers
      });
    } catch (error) {
      routeFailed(req, res, error, error.message || 'Failed to add player');
    }
  });

  // NEW ENDPOINT: Move player to waitlist with SMS notification
  app.post('/api/games/:id/move-to-waitlist/:playerId', async (req, res) => {
    const gameId = req.params.id;
    try {
      const playerId = req.params.playerId;
      const { token } = req.body;
      const result = await moveToWaitlist(gameId, playerId, token);
      if (result.status === 'game_not_found') {
        return res.status(404).json({ error: 'Game not found' });
      }
      if (result.status === 'unauthorized') {
        return res.status(403).json({ error: 'Unauthorized' });
      }
      if (result.status === 'not_found') {
        return res.status(404).json({ error: 'Player not found in confirmed players' });
      }

      // Send SMS notification to the moved player
      const game = result.game;
      const player = result.player;
      let smsResult = null;
      if (player.phone) {
        const gameDate = formatDateForSMS(game.date);
        const gameTime = formatTimeForSMS(game.time);
        const locationText = formatLocationForSMS(game);

        const defaultMessage = `You've been moved to the waitlist for the pickleball game at ${locationText} on ${gameDate} at ${gameTime}. You are #${game.waitlist.length} on the waitlist. Reply 2 for details or 9 to cancel.`;
        const message = await resolveTextMessage(
          'roster-status-change',
          defaultMessage,
          {
            LOCATION: locationText,
            DATE: gameDate,
            TIME: gameTime,
            POSITION: game.waitlist.length,
            STATUS: 'waitlist'
          }
        );
        smsResult = await sendSMS(player.phone, message, gameId);
      }
      
      res.json({
        success: true,
        message: `${player.name} moved to waitlist`,
        sms: smsResult
      });
    } catch (error) {
      routeFailed(req, res, error, 'Failed to move player to waitlist');
    }
  });

  // NEW ENDPOINT: Promote player from waitlist with SMS notification
  app.post('/api/games/:id/promote-from-waitlist/:playerId', async (req, res) => {
    const gameId = req.params.id;
    try {
      const playerId = req.params.playerId;
      const { token } = req.body;
      const result = await promoteFromWaitlist(gameId, playerId, token);
      if (result.status === 'game_not_found') {
        return res.status(404).json({ error: 'Game not found' });
      }
      if (result.status === 'unauthorized') {
        return res.status(403).json({ error: 'Unauthorized' });
      }
      if (result.status === 'full') {
        return res.status(400).json({ error: 'Cannot promote: Game is already full' });
      }
      if (result.status === 'not_found') {
        return res.status(404).json({ error: 'Player not found in waitlist' });
      }

      // Send SMS notification to the promoted player
      const game = result.game;
      const player = result.player;
      let smsResult = null;
      if (player.phone) {
        const message = await buildSelectedPlayerMessage(game, game.players.length);
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
    }
  });

  // ENHANCED: Remove player from game with SMS notification
  app.delete('/api/games/:id/players/:playerId', async (req, res) => {
    const gameId = req.params.id;
    try {
      const playerId = req.params.playerId;
      const token = req.query.token;
      const result = await removeFromGame(gameId, playerId, token);
      if (result.status === 'game_not_found') {
        return res.status(404).json({ error: 'Game not found' });
      }
      if (result.status === 'unauthorized') {
        return res.status(403).json({ error: 'Unauthorized' });
      }
      if (result.status === 'not_found') {
        return res.status(404).json({ error: 'Player not found' });
      }

      // Send removal notification to the removed player (if they have a phone and aren't organizer)
      const game = result.game;
      const removedPlayer = result.player;
      const removalType = result.previousStatus;
      let removalSmsResult = null;
      if (removedPlayer.phone && !removedPlayer.isOrganizer) { // the token check above guarantees the host
        const gameDate = formatDateForSMS(game.date);
        const gameTime = formatTimeForSMS(game.time);
        const locationText = formatLocationForSMS(game);

        const statusText = removalType === 'confirmed' ? 'registration' : 'waitlist spot';
        const defaultMessage = `Your ${statusText} for the pickleball game at ${locationText} on ${gameDate} at ${gameTime} has been cancelled by the organizer.`;
        const message = await resolveTextMessage(
          'roster-status-change',
          defaultMessage,
          {
            LOCATION: locationText,
            DATE: gameDate,
            TIME: gameTime,
            STATUS: removalType
          }
        );
        removalSmsResult = await sendSMS(removedPlayer.phone, message);
      }
      
      // Send promotion SMS if someone was promoted from waitlist (this already exists in the logic)
      let promotionSmsResult = null;
      if (result.promotedPlayer?.phone) {
        const message = await buildSelectedPlayerMessage(game, game.players.length);
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
    status: result.status,
    from: result.previousStatus,
    removedPlayer: result.player,
    promotedPlayer: result.promotedPlayer,
    isOrganizer: result.isOrganizer,
    removalSms: removalSmsResult,
    promotionSms: promotionSmsResult
  });
    } catch (error) {
      routeFailed(req, res, error, 'Failed to remove player');
    }
  });
};
