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
app.post('/api/games', async (req, res) => {
  try {
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
    
    await saveGame(gameId, gameData, hostToken, hostPhone ? formatPhoneNumber(hostPhone) : null);
    
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
      const hostMessage = `Your pickleball game at ${gameData.location} on ${gameDate} at ${gameTime} has been created! Reply "1" for management link or "2" for game details.`;      
      const formattedPhone = formatPhoneNumber(hostPhone);
      smsResult = await sendSMS(formattedPhone, hostMessage, gameId);
    }
    
    response.hostSms = smsResult;
    res.status(201).json(response);
  } catch (error) {
    console.error('Error creating game:', error);
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
    
    // Notify players of update
    const gameDate = formatDateForSMS(game.date);
    const gameTime = formatTimeForSMS(game.time);
    const updateMessage = `UPDATE: Your pickleball game has been updated. New details: ${game.location} on ${gameDate} at ${gameTime}. Duration: ${game.duration} minutes.`;
    
    for (const player of game.players) {
      if (player.phone && !player.isOrganizer) {
        await sendSMS(player.phone, updateMessage, gameId);
      }
    }
    
    for (const player of game.waitlist || []) {
      if (player.phone) {
        await sendSMS(player.phone, updateMessage);
      }
    }
    
    res.json({ success: true, message: 'Game updated and players notified' });
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
    
    // Send confirmation SMS
    let smsResult;
    if (playerData.phone) {
      const gameDate = formatDateForSMS(game.date);
      const gameTime = formatTimeForSMS(game.time);
      
      let message;
      if (result.status === 'confirmed') {
        message = `You're confirmed for Pickleball at ${game.location} on ${gameDate} at ${gameTime}! You are Player ${result.position} of ${game.totalPlayers}. Reply 2 for game details or 9 to cancel.`;
      } else {
        message = `You've been added to the waitlist for Pickleball at ${game.location}. You are #${result.position} on the waitlist. We'll notify you if a spot opens up! Reply 2 for game details or 9 to cancel.`;
      }
      
      smsResult = await sendSMS(playerData.phone, message, gameId);
    }
    
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
    
    const statusText = result.status === 'confirmed' ? 'game' : 'waitlist';
    res.json({
      success: true,
      message: `${playerData.name} added to ${statusText}`,
      ...result
    });
  } catch (error) {
    console.error('Error manually adding player:', error);
    res.status(500).json({ error: error.message || 'Failed to add player' });
  }
});

// Remove player from game
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
    
    // Remove player using our game logic
    const result = removePlayerFromGame(game, playerId);
    
    if (result.status === 'not_found') {
      return res.status(404).json({ error: 'Player not found' });
    }
    
    await saveGame(gameId, game, game.hostToken, game.hostPhone);
    
    // Send promotion SMS if someone was promoted from waitlist
    let smsResult = null;
    if (result.promotedPlayer && result.promotedPlayer.phone) {
      const gameDate = formatDateForSMS(game.date);
      const gameTime = formatTimeForSMS(game.time);
      const message = `Good news! You've been moved from the waitlist to confirmed for Pickleball at ${game.location} on ${gameDate} at ${gameTime}! You are Player ${game.players.length} of ${game.totalPlayers}. Reply 9 to cancel.`;
      
      smsResult = await sendSMS(result.promotedPlayer.phone, message, gameId);
    }
    
    res.json({ 
      ...result,
      sms: smsResult 
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