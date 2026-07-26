// The host talking to their players: broadcast announcements, individual messages, and
// clearing someone off the "can't make it" list.
//
// Everything here can send real texts, which is why none of it has a verify script - testing
// it safely needs a server started with TEXTBELT_API_KEY="". Removing an out-player takes the
// game lock, since it edits the game blob.

const {
  getGame,
  saveGame
} = require('../database');

const {
  sendSMS,
  formatDateForSMS,
  formatTimeForSMS,
  formatLocationForSMS
} = require('../sms-handler');

const { acquireGameLock } = require('../utils/game-lock');
const { routeFailed } = require('../utils/route-error');
const { isHost } = require('../utils/host-auth');

module.exports = function mountAnnouncementRoutes(app) {
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
};
