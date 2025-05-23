const express = require('express');
const path = require('path');
require('dotenv').config(); // Load environment variables
const app = express();
const PORT = process.env.PORT || 3000;

// TextBelt SMS function with webhook support
async function sendSMS(to, message, gameId = null) {
  try {
    // Check if TextBelt is configured
    if (!process.env.TEXTBELT_API_KEY) {
      console.log(`[DEV MODE] SMS would be sent to ${to}: ${message}`);
      return { success: true, dev: true };
    }
    
    // Build the request parameters
    const params = {
      phone: to,
      message: message,
      key: process.env.TEXTBELT_API_KEY
    };
    
    // Add webhook URL if we have a game ID (for replies)
    if (gameId) {
      params.replyWebhookUrl = `${process.env.BASE_URL || 'https://your-domain.com'}/api/sms/webhook`;
      params.webhookData = gameId; // Pass game ID to identify which game the reply is for
    }
    
    // Send SMS via TextBelt
    const response = await fetch('https://textbelt.com/text', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(params)
    });

    const result = await response.json();
    
    if (result.success) {
      console.log(`SMS sent to ${to}. TextID: ${result.textId}, Quota remaining: ${result.quotaRemaining}`);
      return { success: true, textId: result.textId, quotaRemaining: result.quotaRemaining };
    } else {
      console.error('TextBelt error:', result.error);
      return { success: false, error: result.error };
    }
  } catch (error) {
    console.error('SMS sending failed:', error);
    return { success: false, error: error.message };
  }
}

// In-memory database for storing games
const games = {};

// Middleware for parsing JSON and serving static files
app.use(express.json());
app.use(express.static('public'));

// Log all incoming requests for debugging
app.use((req, res, next) => {
  console.log(`${req.method} ${req.url}`);
  next();
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  console.log('Health check endpoint called');
  res.json({ status: 'OK', message: 'Server is running' });
});

// API Routes
// Create a new game - WITH HOST SMS CONFIRMATION
app.post('/api/games', async (req, res) => {
  try {
    console.log('Received game creation request:', req.body);
    
    const gameData = req.body;
    const gameId = Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
    
    // Generate a host management token
    const hostToken = Math.random().toString(36).substring(2, 15) + 
                      Math.random().toString(36).substring(2, 15);
    
    // Initialize players array - only add organizer if they're playing
    if (gameData.organizerPlaying) {
      gameData.players = [
        { id: 'organizer', name: gameData.organizerName || 'Organizer', isOrganizer: true }
      ];
    } else {
      gameData.players = [];
    }
    
    // Initialize waitlist
    gameData.waitlist = [];
    
    // Add host token to the game data
    gameData.hostToken = hostToken;
    
    // Store game in our "database"
    games[gameId] = gameData;
    
    console.log(`Game created with ID: ${gameId}`);
    console.log('Current games:', Object.keys(games));
    
    // Build response data
    const response = { 
      gameId,
      hostToken,
      playerLink: `/game.html?id=${gameId}`,
      hostLink: `/manage.html?id=${gameId}&token=${hostToken}`
    };
    
    // Send SMS confirmation to the host
    let smsResult = null;
    if (gameData.hostPhone || gameData.organizerPhone) {
      const hostPhone = gameData.hostPhone || gameData.organizerPhone;
      const baseUrl = process.env.BASE_URL || `http://localhost:${PORT}`;
      const gameDate = formatDateForSMS(gameData.date);
      const gameTime = formatTimeForSMS(gameData.time);
      
      const hostMessage = `Your pickleball game at ${gameData.location} on ${gameDate} at ${gameTime} has been created! Manage your game: ${baseUrl}${response.hostLink}`;
      
      const formattedPhone = formatPhoneNumber(hostPhone);
      smsResult = await sendSMS(formattedPhone, hostMessage);
      
      console.log(`Host SMS ${smsResult.success ? 'sent' : 'failed'} to ${formattedPhone} for game ${gameId}`);
      
      if (smsResult.dev) {
        console.log(`[DEV MODE] Host SMS message: ${hostMessage}`);
      }
    } else {
      console.log('No host phone number provided - skipping SMS confirmation');
    }
    
    // Add SMS result to response
    response.hostSms = smsResult;
    
    res.status(201).json(response);
  } catch (error) {
    console.error('Error creating game:', error);
    res.status(500).json({ error: 'Failed to create game' });
  }
});

// Get game details
app.get('/api/games/:id', (req, res) => {
  const gameId = req.params.id;
  console.log(`Fetching game with ID: ${gameId}`);
  console.log('Available games:', Object.keys(games));
  
  const game = games[gameId];
  
  if (!game) {
    console.log(`Game not found: ${gameId}`);
    return res.status(404).json({ error: 'Game not found' });
  }
  
  console.log(`Found game: ${gameId}`);
  res.json(game);
});

// Add player to game - WITH SMS NOTIFICATION
app.post('/api/games/:id/players', async (req, res) => {
  try {
    const gameId = req.params.id;
    const game = games[gameId];
    
    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }
    
    const { name, phone } = req.body;
    
    // Format phone number
    const formattedPhone = formatPhoneNumber(phone);
    
    // Generate a unique player ID
    const playerId = Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
    const playerData = { id: playerId, name, phone: formattedPhone };
    
    console.log(`Attempting to add player ${name} to game ${gameId}`);
    
    // Check if spots are available
    let smsResult;
    
    if (game.players.length < parseInt(game.totalPlayers)) {
      // Add to players
      game.players.push(playerData);
      
      // Send confirmation SMS
      const gameDate = formatDateForSMS(game.date);
      const gameTime = formatTimeForSMS(game.time);
      const message = `You're confirmed for Pickleball at ${game.location} on ${gameDate} at ${gameTime}! You are Player ${game.players.length} of ${game.totalPlayers}. Reply 9 to cancel.`;
      
      smsResult = await sendSMS(formattedPhone, message, gameId);
      
      console.log(`Player ${name} added to game ${gameId} as player ${game.players.length}`);
      res.status(201).json({ 
        status: 'confirmed', 
        position: game.players.length,
        playerId,
        totalPlayers: game.totalPlayers,
        sms: smsResult
      });
    } else {
      // Add to waitlist
      game.waitlist.push(playerData);
      
      // Send waitlist SMS
      const message = `You've been added to the waitlist for Pickleball at ${game.location}. You are #${game.waitlist.length} on the waitlist. We'll notify you if a spot opens up!`;
      
      smsResult = await sendSMS(formattedPhone, message);
      
      console.log(`Player ${name} added to waitlist for game ${gameId} at position ${game.waitlist.length}`);
      res.status(201).json({ 
        status: 'waitlist', 
        position: game.waitlist.length,
        playerId,
        sms: smsResult
      });
    }
  } catch (error) {
    console.error('Error adding player:', error);
    res.status(500).json({ error: 'Failed to add player' });
  }
});

// Cancel player spot - WITH SMS NOTIFICATION FOR PROMOTED PLAYERS
app.delete('/api/games/:id/players/:playerId', async (req, res) => {
  try {
    const gameId = req.params.id;
    const playerId = req.params.playerId;
    const game = games[gameId];
    
    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }
    
    console.log(`Attempting to remove player ${playerId} from game ${gameId}`);
    
    // Find player in the list
    const playerIndex = game.players.findIndex(p => p.id === playerId);
    
    if (playerIndex > 0) { // Don't allow removing the organizer
      const removedPlayer = game.players.splice(playerIndex, 1)[0];
      console.log(`Player ${removedPlayer.name} removed from game ${gameId}`);
      
      // Promote first person from waitlist if available
      let promotedPlayer = null;
      let smsResult = null;
      
      if (game.waitlist.length > 0) {
        promotedPlayer = game.waitlist.shift();
        game.players.push(promotedPlayer);
        
        console.log(`Player ${promotedPlayer.name} promoted from waitlist for game ${gameId}`);
        
        // Send promotion SMS
        const gameDate = formatDateForSMS(game.date);
        const gameTime = formatTimeForSMS(game.time);
        const message = `Good news! You've been moved from the waitlist to confirmed for Pickleball at ${game.location} on ${gameDate} at ${gameTime}! You are Player ${game.players.length} of ${game.totalPlayers}. Reply 9 to cancel.`;
        
        smsResult = await sendSMS(promotedPlayer.phone, message, gameId);
      }
      
      res.json({ 
        status: 'removed',
        promotedPlayer,
        sms: smsResult 
      });
    } else if (playerIndex === 0) {
      // Trying to remove organizer
      console.log(`Cannot remove organizer from game ${gameId}`);
      res.status(403).json({ error: 'Cannot remove the organizer' });
    } else {
      // Check waitlist
      const waitlistIndex = game.waitlist.findIndex(p => p.id === playerId);
      
      if (waitlistIndex >= 0) {
        const removedPlayer = game.waitlist.splice(waitlistIndex, 1)[0];
        console.log(`Player ${removedPlayer.name} removed from waitlist for game ${gameId}`);
        res.json({ status: 'removed from waitlist' });
      } else {
        console.log(`Player ${playerId} not found in game ${gameId}`);
        res.status(404).json({ error: 'Player not found' });
      }
    }
  } catch (error) {
    console.error('Error removing player:', error);
    res.status(500).json({ error: 'Failed to remove player' });
  }
});

// Send reminders to all confirmed players
app.post('/api/games/:id/send-reminders', async (req, res) => {
  try {
    const gameId = req.params.id;
    const game = games[gameId];
    
    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }
    
    const gameDate = formatDateForSMS(game.date);
    const gameTime = formatTimeForSMS(game.time);
    
    // Send reminder to all confirmed players
    const results = [];
    for (const player of game.players) {
      if (player.phone && !player.isOrganizer) {
        const message = `Reminder: Your pickleball game at ${game.location} is today at ${gameTime}. See you there!`;
        const result = await sendSMS(player.phone, message);
        results.push({ player: player.name, result });
      }
    }
    
    res.json({ success: true, results });
  } catch (error) {
    console.error('Error sending reminders:', error);
    res.status(500).json({ error: 'Failed to send reminders' });
  }
});

// Debug route to list all games
app.get('/api/debug/games', (req, res) => {
  const gamesList = Object.keys(games).map(gameId => {
    return {
      id: gameId,
      location: games[gameId].location,
      date: games[gameId].date,
      players: games[gameId].players.length,
      waitlist: games[gameId].waitlist.length
    };
  });
  
  res.json({ 
    gamesCount: Object.keys(games).length,
    games: gamesList 
  });
});

// Helper Functions
// Format phone number
function formatPhoneNumber(phoneNumber) {
  // Remove any non-numeric characters
  const cleaned = ('' + phoneNumber).replace(/\D/g, '');
  
  // TextBelt expects 10-digit US numbers without country code
  if (cleaned.length === 10) {
    return cleaned; // Return as-is for TextBelt
  } else if (cleaned.length === 11 && cleaned.startsWith('1')) {
    return cleaned.substring(1); // Remove leading 1
  }
  
  // Return cleaned version for other cases
  return cleaned;
}

// Format date for SMS
function formatDateForSMS(dateStr) {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

// Format time for SMS
function formatTimeForSMS(timeStr) {
  const [hours, minutes] = timeStr.split(':');
  const hour = parseInt(hours);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const hour12 = hour % 12 || 12;
  return `${hour12}:${minutes} ${ampm}`;
}

// Handle incoming SMS from TextBelt webhook  
app.post('/api/sms/webhook', express.json(), async (req, res) => {
  try {
    // Get the incoming message details from TextBelt
    const { fromNumber, text, data: gameId } = req.body;
    
    console.log(`Received SMS from ${fromNumber}: "${text}" for game ${gameId}`);
    
    // Check if the message is "9" (cancel code)
    if (text.trim() === '9') {
      // Find the player in the specific game
      const game = games[gameId];
      if (!game) {
        console.log(`Game ${gameId} not found for SMS reply`);
        return res.json({ success: true }); // Still return success to TextBelt
      }
      
      let playerFound = false;
      
      // Check confirmed players
      const playerIndex = game.players.findIndex(p => p.phone === formatPhoneNumber(fromNumber));
      if (playerIndex > 0 && !game.players[playerIndex].isOrganizer) { // Skip organizer
        playerFound = true;
        const player = game.players[playerIndex];
        
        // Remove the player
        game.players.splice(playerIndex, 1);
        console.log(`Player ${player.name} cancelled via SMS from game ${gameId}`);
        
        // Promote from waitlist if available
        if (game.waitlist.length > 0) {
          const promotedPlayer = game.waitlist.shift();
          game.players.push(promotedPlayer);
          
          // Send promotion notification to promoted player
          const gameDate = formatDateForSMS(game.date);
          const gameTime = formatTimeForSMS(game.time);
          const promotionMessage = `Good news! You've been moved from the waitlist to confirmed for Pickleball at ${game.location} on ${gameDate} at ${gameTime}! Reply 9 to cancel.`;
          
          await sendSMS(promotedPlayer.phone, promotionMessage, gameId);
          console.log(`Player ${promotedPlayer.name} promoted from waitlist for game ${gameId}`);
        }
        
        // Send confirmation back to the cancelling user
        const responseMessage = `Your pickleball reservation at ${game.location} has been cancelled. Thanks for letting us know!`;
        await sendSMS(fromNumber, responseMessage);
      }
      
      // Check waitlist if not found in confirmed players
      if (!playerFound) {
        const waitlistIndex = game.waitlist.findIndex(p => p.phone === formatPhoneNumber(fromNumber));
        if (waitlistIndex >= 0) {
          playerFound = true;
          const player = game.waitlist[waitlistIndex];
          
          // Remove from waitlist
          game.waitlist.splice(waitlistIndex, 1);
          console.log(`Player ${player.name} cancelled from waitlist via SMS for game ${gameId}`);
          
          // Send confirmation back
          const responseMessage = `You've been removed from the waitlist for pickleball at ${game.location}. Thanks for letting us know!`;
          await sendSMS(fromNumber, responseMessage);
        }
      }
      
      if (!playerFound) {
        // Player not found in this game
        const responseMessage = `We couldn't find your registration for this pickleball game. Please contact the organizer if you need assistance.`;
        await sendSMS(fromNumber, responseMessage);
      }
    } else {
      // If message is not "9"
      const responseMessage = `To cancel your pickleball reservation, please reply with just the number 9. For all other inquiries, please contact the organizer.`;
      await sendSMS(fromNumber, responseMessage);
    }
    
    // Always return success to TextBelt
    res.json({ success: true });
    
  } catch (error) {
    console.error('Error handling incoming SMS:', error);
    // Still return success to avoid TextBelt retries
    res.json({ success: true });
  }
});

// Verify host token
function verifyHostToken(gameId, token) {
  const game = games[gameId];
  if (!game) return false;
  return game.hostToken === token;
}

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Visit http://localhost:${PORT} to view your app`);
});