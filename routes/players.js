// Players joining, leaving and moving between the roster and the waitlist.
//
// This is the busiest and most concurrency-sensitive group in the app: every handler here is a
// read-modify-write of the whole game blob, so each one takes the per-game lock from
// utils/game-lock.js first and releases it as soon as the save lands - before any text goes
// out, so nobody waits behind an SMS round trip. verify/signup-race.js, capacity-race.js and
// mixed-race.js exist to prove that ordering holds.

const crypto = require('crypto');

const {
  getGame,
  recordRosterSighting,
  getSmsEventById
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
  describePlayerStatus,
  findUnreachableRosterEntry
} = require('../domain/player-transitions');
const {
  joinGame,
  joinGameAsHost,
  leaveGame,
  moveToWaitlist,
  promoteFromWaitlist,
  removeFromGame
} = require('../services/player-service');
const {
  buildSelectedPlayerMessage,
  buildPromotionMessage
} = require('../services/youre-in-rotation');
const { resolveTextMessage } = require('../services/text-message-rotation');
const { appendCustomReplyInstructions } = require('../sms-reply-options');

module.exports = function mountPlayerRoutes(app) {
  /**
   * Work that carries on after the browser has its answer.
   *
   * The response is already sent, so there is nobody left to show an error to: anything that
   * throws in here must land in the log rather than as an unhandled rejection that could take
   * the process down.
   */
  function afterResponding(label, work) {
    Promise.resolve()
      .then(work)
      .catch((error) => {
        console.error(`[SERVER] Post-response work failed (${label}):`, error);
      });
  }

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
              error: 'Please enter a valid phone number — 10 digits, no spaces or dashes (for example 5551234567).' 
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
            error: "You're the organizer of this game. Use your management link to cancel the game."
          });
        }

        const game = result.game;
        const departing = result.player;
        const gameDate = formatDateForSMS(game.date);
        const gameTime = formatTimeForSMS(game.time);
        const locationText = formatLocationForSMS(game);
        await noteRosterSighting(game.hostPhone, playerData, isAndroid ? 1 : 0);

        // The RSVP is saved. Everything below is telling people about it, and none of it needs
        // to happen before the player's own browser hears back: a text takes a second or two on
        // a good day and twenty-five on a bad one, and the player spent all of it watching a
        // spinner over a decision the database had already recorded. The confirmation screen
        // reports how the text went by asking about the ticket handed to it below.
        const textTicket = playerData.phone ? crypto.randomUUID() : null;

        // Nothing was taken off the roster. Usually that is fine - somebody who never said IN
        // is allowed to say they can't make it. But if the host typed this person in without a
        // phone number, their entry is still sitting on the roster and their OUT could not
        // touch it, so the page has to say that instead of implying they are off the list.
        const strandedEntry = result.previousStatus
          ? null
          : findUnreachableRosterEntry(game, playerData.name);

        res.status(201).json({
          action: 'out',
          cancelled: Boolean(result.previousStatus),
          wasConfirmed: result.previousStatus === 'confirmed',
          playerId: result.outEntry.id,
          promoted: result.promotedPlayer?.name || null,
          stillOnRoster: Boolean(strandedEntry),
          sms: textTicket ? { pending: true, ticket: textTicket } : null
        });

        afterResponding(`cancellation texts for game ${gameId}`, async () => {
        let smsResult = null;
        if (playerData.phone) {
          let message;
          if (result.previousStatus === 'confirmed') {
            message = `Your pickleball reservation at ${locationText} on ${gameDate} at ${gameTime} has been cancelled. Thanks for letting us know!`;
          } else if (result.previousStatus === 'waitlist') {
            const statusText = game.registrationMode === 'waitlist' ? 'application' : 'waitlist spot';
            message = `Your pickleball ${statusText} at ${locationText} on ${gameDate} at ${gameTime} has been cancelled. Thanks for letting us know!`;
          } else {
            message = `Thanks for letting us know you can't make the pickleball game at ${locationText} on ${gameDate} at ${gameTime}. We appreciate the heads-up!`;
          }
          message = await resolveTextMessage(
            'player-cancellation',
            message,
            {
              LOCATION: locationText,
              DATE: gameDate,
              TIME: gameTime,
              STATUS: result.previousStatus || 'out'
            },
            {
              game,
              gameId,
              recipientPhone: playerData.phone
            }
          );
          smsResult = await sendSMSWithRetry(playerData.phone, message, gameId, {
            eventId: 'player-cancelled',
            ticket: textTicket
          });
          if (!smsResult.success) {
            console.error(`[SERVER] ${playerData.name} left game ${gameId} but the confirmation text to ${playerData.phone} failed:`, smsResult.error);
          }
        }

        if (result.promotedPlayer?.phone) {
          const promoted = result.promotedPlayer;
          const promoMessage = await buildPromotionMessage(
            game,
            game.players.length,
            promoted.phone,
            gameId
          );
          const promoResult = await sendSMSWithRetry(promoted.phone, promoMessage, gameId, {
            eventId: 'player-confirmed'
          });
          if (!promoResult.success) {
            console.error(`[SERVER] ${promoted.name} was promoted on game ${gameId} but could not be told:`, promoResult.error);
          }
        }

        if (result.previousStatus) {
          await sendOrganizerNotification(
            gameId,
            game,
            departureAlertType(game, result.previousStatus === 'confirmed'),
            departing.name,
            { promotedName: result.promotedPlayer?.name || null }
          );
        }
        });

        return;
      }

      const result = await joinGame(gameId, playerData);
      if (result.status === 'game_not_found') {
        return res.status(404).json({ error: 'Game not found' });
      }
      if (result.status === 'duplicate') {
        const message = result.duplicateStatus === 'confirmed'
          ? 'This phone number is already registered for this game.'
          : 'This phone number is already on the waitlist.';
        // Tagged, not just worded: someone tapping IN twice is asking "am I in?", and the
        // page answers by showing them where they stand instead of a failure.
        return res.status(400).json({
          error: message,
          status: 'duplicate',
          duplicateStatus: result.duplicateStatus
        });
      }

      const game = result.game;
      await noteRosterSighting(game.hostPhone, playerData, isAndroid ? 1 : 0);

      // Same as the cancellation path above: the spot is saved, so the browser hears back now
      // and learns how the text went by asking about this ticket.
      const joinTicket = playerData.phone ? crypto.randomUUID() : null;

      res.status(201).json({
        status: result.status,
        position: result.position,
        playerId: result.player.id,
        reason: result.reason,
        hidePosition: result.hidePosition,
        totalPlayers: result.totalPlayers,
        sms: joinTicket ? { pending: true, ticket: joinTicket } : null
      });

      afterResponding(`signup texts for game ${gameId}`, async () => {
      // Send confirmation SMS to the player
      let smsResult = null;
      if (playerData.phone) {
        const gameDate = formatDateForSMS(game.date);
        const gameTime = formatTimeForSMS(game.time);
        const locationText = formatLocationForSMS(game);

        let message;
        if (result.status === 'confirmed') {
          message = await buildSelectedPlayerMessage(
            game,
            result.position,
            playerData.phone,
            gameId
          );
        } else {
          // Handle waitlist mode vs regular waitlist
          if (result.hidePosition || game.registrationMode === 'waitlist') {
            // Waitlist mode - don't show position, don't mention "2" for details
            message = `Thanks for signing up for pickleball at ${locationText} on ${gameDate} at ${gameTime}! The organizer will review applications and select players. You'll be notified if selected. Reply 9 to cancel your application.`;
          } else {
            // Regular waitlist - show position, allow details
            message = `You've been added to the waitlist for the pickleball game at ${locationText} on ${gameDate} at ${gameTime}. You are #${result.position} on the waitlist. We'll notify you if a spot opens up. Reply 2 for game details, or 9 to cancel.`;
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
            },
            {
              game,
              gameId,
              recipientPhone: playerData.phone
            }
          );
        }
        message = await appendCustomReplyInstructions(message, 'player');
        
        // Retries once, and the outcome is recorded under the ticket the page is holding, so
        // it can say the text did not go out rather than silently promising one. The signup
        // itself is already saved and stays valid either way.
        smsResult = await sendSMSWithRetry(playerData.phone, message, gameId, {
          eventId: result.status === 'confirmed'
            ? 'player-confirmed'
            : game.registrationMode === 'waitlist'
              ? 'application-submitted'
              : 'player-waitlisted',
          ticket: joinTicket
        });
        if (!smsResult.success) {
          console.error(`[SERVER] ${playerData.name} joined game ${gameId} but the confirmation text to ${playerData.phone} failed:`, smsResult.error);
        }
      }

      // Send organizer notifications (now after saving)
      if (result.status === 'confirmed') {
        const fillsTheGame = game.players.length === parseInt(game.totalPlayers);
        const prefs = game.notificationPreferences || {};

        // A signup that fills the game is one piece of news. Told as one text when the host
        // wants both alerts; otherwise each preference still gets exactly what it asked for.
        if (fillsTheGame && prefs.playerJoins === true && prefs.gameFull === true) {
          await sendOrganizerNotification(gameId, game, 'playerJoinsAndFills', playerData.name);
        } else {
          // Always send player joined notification first
          await sendOrganizerNotification(gameId, game, 'playerJoins', playerData.name);

          if (fillsTheGame) {
            await sendOrganizerNotification(gameId, game, 'gameFull');
          }
          // Only send "one spot left" if they DON'T have "player joins" enabled
          else if (game.players.length === parseInt(game.totalPlayers) - 1) {
            if (!prefs.playerJoins) {
              await sendOrganizerNotification(gameId, game, 'oneSpotLeft');
            }
          }
        }
      } else if (result.status === 'waitlist') {
        // Check if this is the first person on waitlist
        if ((game.waitlist || []).length === 1) {
          await sendOrganizerNotification(gameId, game, 'waitlistStarts', playerData.name);
        }
      }
      });

    } catch (error) {
      routeFailed(req, res, error, error.message || 'Failed to add player');
    }
  });



  // What this phone number's own status is in this game.
  //
  // The game page asks on load so somebody who has RSVP'd before sees where they stand instead
  // of an empty form. It answers only about the number in the request and never lists anybody
  // else, so it exposes no more than the roster the same page already shows - but it is a POST
  // rather than a GET so the number stays out of URLs, logs and referrers, and production rate
  // limiting keeps it from being walked through a range of numbers.
  app.post('/api/games/:id/player-status', async (req, res) => {
    const gameId = req.params.id;
    try {
      const phone = formatPhoneNumber(req.body && req.body.phone);
      if (phone.length !== 10) {
        return res.status(400).json({ error: 'A 10-digit phone number is required.' });
      }

      const game = await getGame(gameId);
      if (!game) {
        return res.status(404).json({ error: 'Game not found' });
      }

      res.json(describePlayerStatus(game, phone));
    } catch (error) {
      routeFailed(req, res, error, 'Failed to look up your status');
    }
  });

  // How the text for one RSVP turned out.
  //
  // The RSVP response now comes back before its confirmation text has been sent, so the page
  // asks here to find out whether the text made it - the honest "we couldn't send your
  // confirmation text" warning depends on this answer. The ticket is a random id minted for
  // that one send and known only to the browser that made the request, so it names no phone
  // number and reveals nothing about a game to anyone who does not already hold it.
  app.get('/api/games/:id/text-status', async (req, res) => {
    try {
      const ticket = String(req.query.ticket || '').trim();
      if (!/^[0-9a-fA-F-]{36}$/.test(ticket)) {
        return res.status(400).json({ error: 'A send ticket is required.' });
      }

      const event = await getSmsEventById(ticket);
      // No row yet means the send is still in flight. It also means an invented ticket learns
      // nothing it could not have guessed.
      if (!event || event.gameId !== req.params.id) {
        return res.json({ status: 'pending' });
      }

      res.json({
        status: event.status === 'failed' ? 'failed' : 'sent',
        attempts: event.attempts
      });
    } catch (error) {
      routeFailed(req, res, error, 'Failed to check the confirmation text');
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
          ? 'This phone number is already registered for this game.'
          : 'This phone number is already on the waitlist.';
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
          message = await buildSelectedPlayerMessage(
            game,
            result.position,
            playerData.phone,
            gameId
          );
        } else {
          // Approval mode keeps positions hidden until the organizer selects players, so the
          // host-added path has to branch the same way the self-signup path does.
          message = (result.hidePosition || game.registrationMode === 'waitlist')
            ? `You've been added as an applicant for the pickleball game at ${locationText} on ${gameDate} at ${gameTime}. The organizer will review applications and select players. You'll be notified if selected. Reply 9 to cancel your application.`
            : `You've been added to the waitlist for the pickleball game at ${locationText} on ${gameDate} at ${gameTime}. You are #${result.position} on the waitlist. We'll notify you if a spot opens up. Reply 2 for details, or 9 to cancel.`;
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
            },
            {
              game,
              gameId,
              recipientPhone: playerData.phone
            }
          );
        }
        message = await appendCustomReplyInstructions(message, 'player');
        
        smsResult = await sendSMS(playerData.phone, message, gameId, {
          eventId: result.status === 'confirmed'
            ? 'player-confirmed'
            : game.registrationMode === 'waitlist'
              ? 'application-submitted'
              : 'player-waitlisted'
        });
      }
      
      const statusText = result.status === 'confirmed' ? 'game' : 'waitlist';
      res.json({
        success: true,
        message: `${playerData.name} added to the ${statusText}.`,
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
        return res.status(404).json({ error: 'That player is not on the confirmed list.' });
      }
      if (result.status === 'organizer') {
        return res.status(400).json({
          error: 'The organizer holds a reserved spot in their own game and cannot be removed from it.'
        });
      }

      // Send SMS notification to the moved player
      const game = result.game;
      const player = result.player;
      let smsResult = null;
      if (player.phone) {
        const gameDate = formatDateForSMS(game.date);
        const gameTime = formatTimeForSMS(game.time);
        const locationText = formatLocationForSMS(game);

        // Read the real index rather than assuming the player was appended to the end.
        const waitlistIndex = (game.waitlist || []).findIndex((entry) => entry.id === player.id);
        const waitlistPosition = waitlistIndex >= 0 ? waitlistIndex + 1 : (game.waitlist || []).length;
        const defaultMessage = game.registrationMode === 'waitlist'
          ? `You've been moved back to the applicant list for the pickleball game at ${locationText} on ${gameDate} at ${gameTime}. The organizer will let you know if you're selected. Reply 9 to cancel your application.`
          : `You've been moved to the waitlist for the pickleball game at ${locationText} on ${gameDate} at ${gameTime}. You are #${waitlistPosition} on the waitlist. Reply 2 for details, or 9 to cancel.`;
        const message = await resolveTextMessage(
          'roster-status-change',
          defaultMessage,
          {
            LOCATION: locationText,
            DATE: gameDate,
            TIME: gameTime,
            POSITION: waitlistPosition,
            STATUS: 'waitlist'
          },
          {
            game,
            gameId,
            recipientPhone: player.phone
          }
        );
        smsResult = await sendSMS(player.phone, message, gameId, {
          eventId: 'player-moved-to-waitlist'
        });
      }
      
      res.json({
        success: true,
        message: `${player.name} moved to the waitlist.`,
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
        return res.status(400).json({ error: 'This game is already full, so nobody can be promoted right now.' });
      }
      if (result.status === 'not_found') {
        return res.status(404).json({ error: 'That player is not on the waitlist.' });
      }

      // Send SMS notification to the promoted player
      const game = result.game;
      const player = result.player;
      let smsResult = null;
      if (player.phone) {
        const message = await buildPromotionMessage(
          game,
          game.players.length,
          player.phone,
          gameId
        );
        // Retried for the same reason as the promotion above: a promotion the player never hears
        // about looks identical to still being on the waitlist.
        smsResult = await sendSMSWithRetry(player.phone, message, gameId, {
          eventId: 'player-confirmed'
        });
        if (!smsResult.success) {
          console.error(`[SERVER] ${player.name} was promoted on game ${gameId} but could not be told:`, smsResult.error);
        }
      }
      
      res.json({
        success: true,
        message: `${player.name} promoted to the confirmed list.`,
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
      if (result.status === 'organizer') {
        return res.status(400).json({
          error: 'The organizer holds a reserved spot in their own game and cannot be removed from it.'
        });
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

        const statusText = removalType === 'confirmed'
          ? 'registration'
          : game.registrationMode === 'waitlist'
            ? 'application'
            : 'waitlist spot';
        const defaultMessage = `Your ${statusText} for the pickleball game at ${locationText} on ${gameDate} at ${gameTime} has been cancelled by the organizer.`;
        const message = await resolveTextMessage(
          'roster-status-change',
          defaultMessage,
          {
            LOCATION: locationText,
            DATE: gameDate,
            TIME: gameTime,
            STATUS: removalType
          },
          {
            game,
            gameId,
            recipientPhone: removedPlayer.phone
          }
        );
        removalSmsResult = await sendSMS(removedPlayer.phone, message, gameId, {
          eventId: 'player-removed-by-organizer'
        });
      }
      
      // Send promotion SMS if someone was promoted from waitlist (this already exists in the logic)
      let promotionSmsResult = null;
      if (result.promotedPlayer?.phone) {
        const message = await buildPromotionMessage(
          game,
          game.players.length,
          result.promotedPlayer.phone,
          gameId
        );
        // Retried: this is the one text nobody can recover from missing. The player has been
        // moved onto the roster in the database either way, so if it never arrives they believe
        // they are still on the waitlist and simply do not turn up.
        promotionSmsResult = await sendSMSWithRetry(result.promotedPlayer.phone, message, gameId, {
          eventId: 'player-confirmed'
        });
        if (!promotionSmsResult.success) {
          console.error(`[SERVER] ${result.promotedPlayer.name} was promoted on game ${gameId} but could not be told:`, promotionSmsResult.error);
        }
      }

  // No organizer alert here, deliberately: this route only runs from the host's own
  // management page (the token check above proves it), so the removal is something the
  // host just did themselves. Texting them "X cancelled their spot" misstates who acted.
  // Departure alerts still go out when the player leaves on their own (OUT tap, reply 9).

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
