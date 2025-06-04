// server.js - Main server file (simplified)
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

// Import our separated modules
const { 
  initializeDatabase, 
  saveGame, 
  getGame, 
  getAllGames,
  closeDatabaseConnection,
  isProduction
} = require('./database');

const { 
  sendSMS, 
  handleIncomingSMS, 
  formatPhoneNumber,
  formatDateForSMS, 
  formatTimeForSMS 
} = require('./sms-handler');

// Function to send organizer notifications
// server.js - REPLACE your sendOrganizerNotification function with this:
async function sendOrganizerNotification(gameId, game, eventType, playerName = null) {
  try {
    console.log('[DEBUG] ==================== ORGANIZER NOTIFICATION ====================');
    console.log('[DEBUG] gameId:', gameId);
    console.log('[DEBUG] eventType:', eventType);
    console.log('[DEBUG] playerName:', playerName);
    console.log('[DEBUG] hostPhone:', game.hostPhone);
    console.log('[DEBUG] notificationPreferences:', JSON.stringify(game.notificationPreferences, null, 2));

    // Check if we have the required data
    if (!game.hostPhone) {
      console.log('[DEBUG] ❌ No hostPhone found, skipping notification');
      return;
    }
    
    if (!game.notificationPreferences) {
      console.log('[DEBUG] ❌ No notification preferences found, skipping notification');
      return;
    }
    
    const prefs = game.notificationPreferences;
    let shouldSend = false;
    let message = '';
    
    const gameDate = formatDateForSMS(game.date);
    const gameTime = formatTimeForSMS(game.time);
    let locationText = game.location;
    if (game.courtNumber && game.courtNumber.trim()) {
      locationText += ` - ${game.courtNumber}`;
    }
    
    console.log('[DEBUG] Checking preferences for event:', eventType);
    
    switch (eventType) {
      case 'gameFull':
        console.log('[DEBUG] gameFull preference:', prefs.gameFull);
        if (prefs.gameFull === true) {
          shouldSend = true;
          message = `🎯 HOST ALERT: Your pickleball game at ${locationText} on ${gameDate} is now FULL! All ${game.totalPlayers} spots are taken.`;
        }
        break;
        
      case 'playerJoins':
        console.log('[DEBUG] playerJoins preference:', prefs.playerJoins);
        if (prefs.playerJoins === true && playerName) {
          shouldSend = true;
          const spotsLeft = parseInt(game.totalPlayers) - game.players.length;
          message = `🎯 HOST ALERT: ${playerName} just joined your pickleball game at ${locationText} on ${gameDate}. ${spotsLeft} spots remaining.`;
        }
        break;
        
      case 'playerCancels':
        console.log('[DEBUG] playerCancels preference:', prefs.playerCancels);
        if (prefs.playerCancels === true && playerName) {
          shouldSend = true;
          const spotsLeft = parseInt(game.totalPlayers) - game.players.length;
          message = `🎯 HOST ALERT: ${playerName} cancelled their spot for your pickleball game at ${locationText} on ${gameDate}. ${spotsLeft} spots now available.`;
        }
        break;
        
      case 'oneSpotLeft':
        console.log('[DEBUG] oneSpotLeft preference:', prefs.oneSpotLeft);
        if (prefs.oneSpotLeft === true) {
          shouldSend = true;
          message = `🎯 HOST ALERT: Only 1 spot left for your pickleball game at ${locationText} on ${gameDate}!`;
        }
        break;
        
      case 'waitlistStarts':
        console.log('[DEBUG] waitlistStarts preference:', prefs.waitlistStarts);
        if (prefs.waitlistStarts === true && playerName) {
          shouldSend = true;
          message = `🎯 HOST ALERT: ${playerName} is the first person on the waitlist for your pickleball game at ${locationText} on ${gameDate}.`;
        }
        break;
        
      default:
        console.log('[DEBUG] ❌ Unknown event type:', eventType);
    }
    
    console.log('[DEBUG] shouldSend:', shouldSend);
    console.log('[DEBUG] message length:', message ? message.length : 0);

    if (shouldSend && message) {
      console.log('[DEBUG] ✅ Sending organizer SMS to:', game.hostPhone);
      const smsResult = await sendSMS(game.hostPhone, message, gameId);
      console.log('[DEBUG] SMS result:', smsResult);
      
      if (smsResult.success) {
        console.log(`[ORGANIZER NOTIFICATION] ✅ Successfully sent ${eventType} notification to host for game ${gameId}`);
      } else {
        console.log(`[ORGANIZER NOTIFICATION] ❌ Failed to send ${eventType} notification:`, smsResult.error);
      }
    } else {
      console.log('[DEBUG] ❌ Not sending notification');
      console.log('[DEBUG] Reasons - shouldSend:', shouldSend, 'hasMessage:', !!message);
    }
    
    console.log('[DEBUG] ============================================================');
  } catch (error) {
    console.error('❌ Error sending organizer notification:', error);
  }
}
const { 
  checkAndSendReminders,
  createGameData,
  validatePlayerData,
  checkExistingPlayer,
  addPlayerToGame,
  removePlayerFromGame,
  isValidPhoneNumber
} = require('./game-logic');

const app = express();
const PORT = process.env.PORT || 3000;

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

// ============================================================================
// API ROUTES
// ============================================================================

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'Server is running', database: isProduction ? 'PostgreSQL' : 'SQLite' });
});

// Manual reminder test endpoint
app.post('/api/test-reminders', async (req, res) => {
  try {    
    await checkAndSendReminders();
    res.json({ success: true, message: 'Reminder check completed' });
  } catch (error) {
    console.error('Manual reminder test failed:', error);
    res.status(500).json({ error: 'Failed to run reminder check' });
  }
});

// Create game
// server.js - REPLACE your create game endpoint with this:
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
      let locationText = gameData.location;
      if (gameData.courtNumber && gameData.courtNumber.trim()) {
          locationText += ` - ${gameData.courtNumber}`;
      }
      const hostMessage = `Your pickleball game at ${locationText} on ${gameDate} at ${gameTime} has been created! Reply "1" for management link or "2" for game details.`;
      smsResult = await sendSMS(formattedHostPhone, hostMessage, gameId);
    }
    
    response.hostSms = smsResult;
    console.log('[SERVER] Game created successfully:', gameId);
    res.status(201).json(response);
  } catch (error) {
    console.error('[SERVER] Error creating game:', error);
    res.status(500).json({ error: 'Failed to create game' });
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
    
    res.json(game);
  } catch (error) {
    console.error('Error fetching game:', error);
    res.status(500).json({ error: 'Failed to fetch game' });
  }
});

// Update game
// UPDATE your game update endpoint in server.js - REMOVE the automatic notifications:

app.put('/api/games/:id', async (req, res) => {
  try {
    const gameId = req.params.id;
    const { token, ...updateData } = req.body;
    
    const game = await getGame(gameId);
    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }
    
    if (game.hostToken !== token) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    
    Object.assign(game, updateData);
    await saveGame(gameId, game, game.hostToken, game.hostPhone);
    
    // REMOVED: Automatic notification sending code
    // Organizers can now use the Communication tab to send manual updates
    
    res.json({ 
      success: true, 
      message: 'Game updated successfully. Use the Communication tab to notify players of changes if needed.' 
    });
  } catch (error) {
    console.error('Error updating game:', error);
    res.status(500).json({ error: 'Failed to update game' });
  }
});

// Cancel game
app.delete('/api/games/:id', async (req, res) => {
  try {
    const gameId = req.params.id;
    const { token, reason } = req.body;
    
    const game = await getGame(gameId);
    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }
    
    if (game.hostToken !== token) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    
    game.cancelled = true;
    game.cancellationReason = reason;
    await saveGame(gameId, game, game.hostToken, game.hostPhone);
    
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
    console.error('Error cancelling game:', error);
    res.status(500).json({ error: 'Failed to cancel game' });
  }
});

// Add player to game (regular signup)
app.post('/api/games/:id/players', async (req, res) => {
  try {
    const gameId = req.params.id;
    const game = await getGame(gameId);
    
    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }
    
    const { name, phone } = req.body;
    
    // Validate player data
    const playerData = validatePlayerData(name, phone);
    
    // Check if player already exists
    const existingCheck = checkExistingPlayer(game, playerData.phone);
    if (existingCheck.exists) {
      return res.status(400).json({ error: existingCheck.message });
    }
    
    // Add player to game
    const result = addPlayerToGame(game, playerData);
    await saveGame(gameId, game, game.hostToken, game.hostPhone);
    
    // Send confirmation SMS to the player
    let smsResult = null;
    if (playerData.phone) {
      const gameDate = formatDateForSMS(game.date);
      const gameTime = formatTimeForSMS(game.time);
      
      let locationText = game.location;
      if (game.courtNumber && game.courtNumber.trim()) {
        locationText += ` - ${game.courtNumber}`;
      }
      
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
      
      smsResult = await sendSMS(playerData.phone, message, gameId);
    }

    // Send organizer notifications (if preferences are set)
    if (result.status === 'confirmed') {
      // Check if game is now full
      if (game.players.length === parseInt(game.totalPlayers)) {
        await sendOrganizerNotification(gameId, game, 'gameFull');
      }
      // Check if only one spot left
      else if (game.players.length === parseInt(game.totalPlayers) - 1) {
        await sendOrganizerNotification(gameId, game, 'oneSpotLeft');
      }
      // Player joined notification
      await sendOrganizerNotification(gameId, game, 'playerJoins', playerData.name);
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
    console.error('Error adding player:', error);
    res.status(500).json({ error: error.message || 'Failed to add player' });
  }
});



// Add player manually (host function)
app.post('/api/games/:id/manual-player', async (req, res) => {
  try {
    const gameId = req.params.id;
    const { name, phone, addTo, token } = req.body;
    
    const game = await getGame(gameId);
    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }
    
    if (game.hostToken !== token) {
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
    
    // Send SMS confirmation to the added player
    let smsResult = null;
    if (playerData.phone) {
      const gameDate = formatDateForSMS(game.date);
      const gameTime = formatTimeForSMS(game.time);
      
      let locationText = game.location;
      if (game.courtNumber && game.courtNumber.trim()) {
        locationText += ` - ${game.courtNumber}`;
      }
      
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
    console.error('Error manually adding player:', error);
    res.status(500).json({ error: error.message || 'Failed to add player' });
  }
});

// NEW ENDPOINT: Move player to waitlist with SMS notification
app.post('/api/games/:id/move-to-waitlist/:playerId', async (req, res) => {
  try {
    const gameId = req.params.id;
    const playerId = req.params.playerId;
    const { token } = req.body;
    
    const game = await getGame(gameId);
    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }
    
    if (game.hostToken !== token) {
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
    
    // Send SMS notification to the moved player
    let smsResult = null;
    if (player.phone) {
      const gameDate = formatDateForSMS(game.date);
      const gameTime = formatTimeForSMS(game.time);
      
      let locationText = game.location;
      if (game.courtNumber && game.courtNumber.trim()) {
        locationText += ` - ${game.courtNumber}`;
      }
      
      const message = `You've been moved to the waitlist for the pickleball game at ${locationText} on ${gameDate} at ${gameTime}. You are #${game.waitlist.length} on the waitlist. Reply 2 for details or 9 to cancel.`;
      smsResult = await sendSMS(player.phone, message, gameId);
    }
    
    res.json({
      success: true,
      message: `${player.name} moved to waitlist`,
      sms: smsResult
    });
  } catch (error) {
    console.error('Error moving player to waitlist:', error);
    res.status(500).json({ error: 'Failed to move player to waitlist' });
  }
});

// NEW ENDPOINT: Promote player from waitlist with SMS notification
app.post('/api/games/:id/promote-from-waitlist/:playerId', async (req, res) => {
  try {
    const gameId = req.params.id;
    const playerId = req.params.playerId;
    const { token } = req.body;
    
    const game = await getGame(gameId);
    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }
    
    if (game.hostToken !== token) {
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
    
    // Send SMS notification to the promoted player
    let smsResult = null;
    if (player.phone) {
      const gameDate = formatDateForSMS(game.date);
      const gameTime = formatTimeForSMS(game.time);
      
      let locationText = game.location;
      if (game.courtNumber && game.courtNumber.trim()) {
        locationText += ` - ${game.courtNumber}`;
      }
      
      const message = `Great news! You've been promoted from the waitlist to confirmed for the pickleball game at ${locationText} on ${gameDate} at ${gameTime}! You are Player ${game.players.length} of ${game.totalPlayers}. Reply 2 for details or 9 to cancel.`;
      smsResult = await sendSMS(player.phone, message, gameId);
    }
    
    res.json({
      success: true,
      message: `${player.name} promoted to confirmed players`,
      sms: smsResult
    });
  } catch (error) {
    console.error('Error promoting player from waitlist:', error);
    res.status(500).json({ error: 'Failed to promote player from waitlist' });
  }
});

// ENHANCED: Remove player from game with SMS notification
app.delete('/api/games/:id/players/:playerId', async (req, res) => {
  try {
    const gameId = req.params.id;
    const playerId = req.params.playerId;
    const token = req.query.token;
    
    const game = await getGame(gameId);
    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }
    
    if (token && game.hostToken !== token) {
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
    
    // Send removal notification to the removed player (if they have a phone and aren't organizer)
    let removalSmsResult = null;
    if (removedPlayer.phone && !removedPlayer.isOrganizer && token) { // Only send if removed by host
      const gameDate = formatDateForSMS(game.date);
      const gameTime = formatTimeForSMS(game.time);
      
      let locationText = game.location;
      if (game.courtNumber && game.courtNumber.trim()) {
        locationText += ` - ${game.courtNumber}`;
      }
      
      const statusText = removalType === 'confirmed' ? 'registration' : 'waitlist spot';
      const message = `Your ${statusText} for the pickleball game at ${locationText} on ${gameDate} at ${gameTime} has been cancelled by the organizer.`;
      removalSmsResult = await sendSMS(removedPlayer.phone, message);
    }
    
    // Send promotion SMS if someone was promoted from waitlist (this already exists in the logic)
    let promotionSmsResult = null;
    if (result.promotedPlayer && result.promotedPlayer.phone) {
      const gameDate = formatDateForSMS(game.date);
      const gameTime = formatTimeForSMS(game.time);
      
      let locationText = game.location;
      if (game.courtNumber && game.courtNumber.trim()) {
        locationText += ` - ${game.courtNumber}`;
      }
      
      const message = `Good news! You've been promoted from the waitlist to confirmed for the pickleball game at ${locationText} on ${gameDate} at ${gameTime}! You are Player ${game.players.length} of ${game.totalPlayers}. Reply 2 for details or 9 to cancel.`;
      promotionSmsResult = await sendSMS(result.promotedPlayer.phone, message, gameId);
    }
    
// Send organizer notification for cancellation
if (removedPlayer && !removedPlayer.isOrganizer && token) {
  await sendOrganizerNotification(gameId, game, 'playerCancels', removedPlayer.name);
}

res.json({ 
  ...result,
  removalSms: removalSmsResult,
  promotionSms: promotionSmsResult
});
  } catch (error) {
    console.error('Error removing player:', error);
    res.status(500).json({ error: 'Failed to remove player' });
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
    
    if (game.hostToken !== token) {
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
    console.error('Error sending announcement:', error);
    res.status(500).json({ error: 'Failed to send announcement' });
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
    
    if (game.hostToken !== token) {
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
    console.error('Error sending individual announcement:', error);
    res.status(500).json({ error: 'Failed to send announcement' });
  }
});

// SMS webhook (uses our SMS handler)
app.post('/api/sms/webhook', express.json(), handleIncomingSMS);

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