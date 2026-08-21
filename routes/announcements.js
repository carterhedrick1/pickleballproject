// The host talking to their players: broadcast announcements, individual messages, and
// clearing someone off the "can't make it" list.
//
// Everything here can send real texts, which is why none of it has a verify script - testing
// it safely needs a server started with TEXTBELT_API_KEY="". Removing an out-player takes the
// game lock, since it edits the game blob.

const {
  getGame,
  saveGame
} = require('../database/games');

const { sendSMS } = require('../services/sms-client');
const {
  formatDateForSMS,
  formatTimeForSMS,
  formatLocationForSMS
} = require('../utils/sms-format');

const { acquireGameLock } = require('../utils/game-lock');
const { findOnGame } = require('../utils/game-audience');
const { routeFailed } = require('../utils/route-error');
const { isHost, requestHostToken } = require('../utils/host-auth');
const { requiredText, list } = require('../utils/request-validation');
const { resolveTextMessage } = require('../services/text-message-rotation');

// One text per recipient goes out from here, so the list is bounded. A game's whole audience -
// roster plus waitlist plus everyone who said they were out - never comes near this.
const MAX_ANNOUNCEMENT_RECIPIENTS = 200;
// Long enough for anything a host would type into a four-row box, short enough that nobody
// pays to send a novel one segment at a time.
const ANNOUNCEMENT_MAX = 1000;

module.exports = function mountAnnouncementRoutes(app) {
  // There used to be a second, group-shaped announcement route here taking includeConfirmed and
  // includeWaitlist. Nothing ever called it - the page always expands its groups into a list of
  // people and posts them here - and the two paths tagged the randomizer audience differently,
  // so the same announcement could pick a different message depending on which route sent it.
  // The group route is gone and its audience tagging moved onto this one.

  // Send announcement to individual players
  app.post('/api/games/:id/announcement-individual', async (req, res) => {
    try {
      const gameId = req.params.id;
      const token = requestHostToken(req);
      const { message, recipients, personalityWrapper } = req.body || {};

      const game = await getGame(gameId);
      if (!game) {
        return res.status(404).json({ error: 'Game not found' });
      }
      
      if (!isHost(game, token)) {
        return res.status(403).json({ error: 'Unauthorized' });
      }
      
      // The two sentences a host can actually reach are unchanged - an empty message and an
      // empty selection are what the Communication tab produces.
      if (!message || (typeof message === 'string' && !message.trim())) {
        return res.status(400).json({ error: 'Message is required' });
      }
      if (!recipients || recipients.length === 0) {
        return res.status(400).json({ error: 'At least one recipient is required' });
      }

      // Underneath them, the shapes the page cannot produce and the route used to accept.
      // recipients arriving as a string passed the length test above and was then iterated
      // character by character: every "recipient" had no phone, so the host was told the
      // announcement went to nobody with no explanation of why.
      requiredText(message, 'The announcement', { max: ANNOUNCEMENT_MAX });
      list(recipients, 'The recipients', { max: MAX_ANNOUNCEMENT_RECIPIENTS });

      let recipientCount = 0;
      const results = [];
      const skipped = [];
      // Send to each selected recipient
      for (const recipient of recipients) {
        if (!recipient || !recipient.phone) continue;

        // The client posts whichever names the host ticked, so the roster - not the request
        // body - decides who can be texted and which audience rules apply to them.
        const listed = findOnGame(game, recipient.phone);
        if (!listed || listed.isOrganizer) {
          skipped.push({ player: recipient.name || recipient.phone, reason: 'not on this game' });
          continue;
        }

        const configuredMessage = personalityWrapper === true ? await resolveTextMessage(
          'organizer-announcement',
          message,
          {
            ANNOUNCEMENT: message,
            LOCATION: formatLocationForSMS(game),
            DATE: formatDateForSMS(game.date),
            TIME: formatTimeForSMS(game.time)
          },
          {
            game,
            gameId,
            recipientPhone: recipient.phone,
            audience: listed.type === 'confirmed' ? 'confirmed' : 'known-game-audience'
          }
        ) : message;
        const result = await sendSMS(recipient.phone, configuredMessage, gameId, {
          eventId: 'organizer-announcement'
        });
        results.push({
          player: listed.player.name || recipient.name,
          type: listed.type,
          phone: recipient.phone,
          result
        });
        if (result.success) recipientCount++;
      }

      res.json({
        success: true,
        recipientCount,
        totalRecipients: recipients.length,
        skipped,
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
      const token = requestHostToken(req);

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
};
