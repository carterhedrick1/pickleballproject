const express = require('express');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize SQLite database
const db = new sqlite3.Database('pickleball.db', (err) => {
  if (err) {
    console.error('Error opening database:', err);
  } else {
    console.log('Connected to SQLite database');
    initializeDatabase();
  }
});

// Create tables if they don't exist
function initializeDatabase() {
  db.serialize(() => {
    // Games table
    db.run(`CREATE TABLE IF NOT EXISTS games (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      host_token TEXT NOT NULL,
      host_phone TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    
    console.log('Database tables initialized');
  });
}

// Database helper functions
function saveGame(gameId, gameData, hostToken, hostPhone = null) {
  return new Promise((resolve, reject) => {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO games (id, data, host_token, host_phone, updated_at) 
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);
    
    stmt.run([gameId, JSON.stringify(gameData), hostToken, hostPhone], function(err) {
      if (err) {
        console.error('Error saving game:', err);
        reject(err);
      } else {
        console.log(`Game ${gameId} saved to database`);
        resolve(this);
      }
    });
    
    stmt.finalize();
  });
}

function getGame(gameId) {
  return new Promise((resolve, reject) => {
    db.get('SELECT * FROM games WHERE id = ?', [gameId], (err, row) => {
      if (err) {
        reject(err);
      } else if (row) {
        resolve({
          ...JSON.parse(row.data),
          hostToken: row.host_token,
          hostPhone: row.host_phone
        });
      } else {
        resolve(null);
      }
    });
  });
}

function getGameHostInfo(gameId) {
  return new Promise((resolve, reject) => {
    db.get('SELECT host_phone, host_token FROM games WHERE id = ?', [gameId], (err, row) => {
      if (err) {
        reject(err);
      } else {
        resolve(row ? { phone: row.host_phone, hostToken: row.host_token } : null);
      }
    });
  });
}

function getAllGames() {
  return new Promise((resolve, reject) => {
    db.all('SELECT id, data FROM games', [], (err, rows) => {
      if (err) {
        reject(err);
      } else {
        const games = {};
        rows.forEach(row => {
          games[row.id] = JSON.parse(row.data);
        });
        resolve(games);
      }
    });
  });
}

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
      params.webhookData = gameId;
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

// Middleware
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

// Create a new game
app.post('/api/games', async (req, res) => {
  try {
    console.log('Received game creation request:', req.body);
    
    const gameData = req.body;
    const gameId = Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
    const hostToken = Math.random().toString(36).substring(2, 15) + 
                      Math.random().toString(36).substring(2, 15);
    
    // Initialize players array
    if (gameData.organizerPlaying) {
      gameData.players = [
        { id: 'organizer', name: gameData.organizerName || 'Organizer', isOrganizer: true }
      ];
    } else {
      gameData.players = [];
    }
    
    gameData.waitlist = [];
    gameData.hostToken = hostToken;
    
    const hostPhone = gameData.hostPhone || gameData.organizerPhone;
    
    // Save to database
    await saveGame(gameId, gameData, hostToken, hostPhone ? formatPhoneNumber(hostPhone) : null);
    
    console.log(`Game created with ID: ${gameId}`);
    
    const response = { 
      gameId,
      hostToken,
      playerLink: `/game.html?id=${gameId}`,
      hostLink: `/manage.html?id=${gameId}&token=${hostToken}`
    };
    
    // Send SMS confirmation to host
    let smsResult = null;
    if (hostPhone) {
      const gameDate = formatDateForSMS(gameData.date);
      const gameTime = formatTimeForSMS(gameData.time);
      const hostMessage = `Your pickleball game at ${gameData.location} on ${gameDate} at ${gameTime} has been created! Reply "1" to get your management link.`;
      
      const formattedPhone = formatPhoneNumber(hostPhone);
      smsResult = await sendSMS(formattedPhone, hostMessage, gameId);
      
      console.log(`Host SMS ${smsResult.success ? 'sent' : 'failed'} to ${formattedPhone} for game ${gameId}`);
      
      if (smsResult.dev) {
        console.log(`[DEV MODE] Host SMS message: ${hostMessage}`);
      }
    } else {
      console.log('No host phone number provided - skipping SMS confirmation');
    }
    
    response.hostSms = smsResult;
    res.status(201).json(response);
  } catch (error) {
    console.error('Error creating game:', error);
    res.status(500).json({ error: 'Failed to create game' });
  }
});

// Get game details
app.get('/api/games/:id', async (req, res) => {
  try {
    const gameId = req.params.id;
    const token = req.query.token;
    
    console.log(`Fetching game with ID: ${gameId}`);
    
    const game = await getGame(gameId);
    
    if (!game) {
      console.log(`Game not found: ${gameId}`);
      return res.status(404).json({ error: 'Game not found' });
    }
    
    if (token && game.hostToken !== token) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    
    console.log(`Found game: ${gameId}`);
    res.json(game);
  } catch (error) {
    console.error('Error fetching game:', error);
    res.status(500).json({ error: 'Failed to fetch game' });
  }
});

// Update game details
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
    
    console.log(`Game ${gameId} updated`);
    
    // Send update notification
    const gameDate = formatDateForSMS(game.date);
    const gameTime = formatTimeForSMS(game.time);
    const updateMessage = `UPDATE: Your pickleball game has been updated. New details: ${game.location} on ${gameDate} at ${gameTime}. Duration: ${game.duration} minutes.`;
    
    for (const player of game.players) {
      if (player.phone && !player.isOrganizer) {
        await sendSMS(player.phone, updateMessage, gameId);
      }
    }
    
    for (const player of game.waitlist) {
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
    
    console.log(`Cancelling game ${gameId} with reason: ${reason}`);
    
    game.cancelled = true;
    game.cancellationReason = reason;
    await saveGame(gameId, game, game.hostToken, game.hostPhone);
    
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
    
    for (const player of game.waitlist) {
      if (player.phone) {
        const result = await sendSMS(player.phone, cancellationMessage);
        results.push({ player: player.name, type: 'waitlist', result });
        if (result.success) notificationCount++;
      }
    }
    
    console.log(`Game ${gameId} cancelled, ${notificationCount} players notified`);
    
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
    
    console.log(`Sending announcement for game ${gameId}: ${message}`);
    
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
      for (const player of game.waitlist) {
        if (player.phone) {
          const result = await sendSMS(player.phone, message);
          results.push({ player: player.name, type: 'waitlist', result });
          if (result.success) recipientCount++;
        }
      }
    }
    
    console.log(`Announcement sent to ${recipientCount} players`);
    
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

// Add player manually
app.post('/api/games/:id/manual-player', async (req, res) => {
  try {
    const gameId = req.params.id;
    const { token, name, phone, action } = req.body;
    
    const game = await getGame(gameId);
    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }
    
    if (game.hostToken !== token) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    
    const playerId = Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
    const playerData = { 
      id: playerId, 
      name, 
      phone: phone ? formatPhoneNumber(phone) : null 
    };
    
    console.log(`Manually adding player ${name} to game ${gameId} (action: ${action})`);
    
    let smsResult = null;
    
    if (action === 'add') {
      game.players.push(playerData);
      
      if (phone) {
        const gameDate = formatDateForSMS(game.date);
        const gameTime = formatTimeForSMS(game.time);
        const message = `You've been added to the pickleball game at ${game.location} on ${gameDate} at ${gameTime}! You are Player ${game.players.length} of ${game.totalPlayers}. Reply 9 to cancel.`;
        smsResult = await sendSMS(playerData.phone, message, gameId);
      }
    } else if (action === 'waitlist') {
      game.waitlist.push(playerData);
      
      if (phone) {
        const message = `You've been added to the waitlist for pickleball at ${game.location}. You are #${game.waitlist.length} on the waitlist. We'll notify you if a spot opens up!`;
        smsResult = await sendSMS(playerData.phone, message);
      }
    }
    
    await saveGame(gameId, game, game.hostToken, game.hostPhone);
    
    res.json({ 
      success: true, 
      playerId,
      action,
      sms: smsResult 
    });
  } catch (error) {
    console.error('Error adding player manually:', error);
    res.status(500).json({ error: 'Failed to add player' });
  }
});

// Add player to game
app.post('/api/games/:id/players', async (req, res) => {
  try {
    const gameId = req.params.id;
    const game = await getGame(gameId);
    
    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }
    
    const { name, phone } = req.body;
    const formattedPhone = formatPhoneNumber(phone);
    const playerId = Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
    const playerData = { id: playerId, name, phone: formattedPhone };
    
    console.log(`Attempting to add player ${name} to game ${gameId}`);
    
    let smsResult;
    
    if (game.players.length < parseInt(game.totalPlayers)) {
      game.players.push(playerData);
      await saveGame(gameId, game, game.hostToken, game.hostPhone);
      
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
      game.waitlist.push(playerData);
      await saveGame(gameId, game, game.hostToken, game.hostPhone);
      
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

// Cancel player spot
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
    
    console.log(`Attempting to remove player ${playerId} from game ${gameId}`);
    
    const playerIndex = game.players.findIndex(p => p.id === playerId);
    
    if (playerIndex > 0) {
      const removedPlayer = game.players.splice(playerIndex, 1)[0];
      console.log(`Player ${removedPlayer.name} removed from game ${gameId}`);
      
      let promotedPlayer = null;
      let smsResult = null;
      
      if (game.waitlist.length > 0) {
        promotedPlayer = game.waitlist.shift();
        game.players.push(promotedPlayer);
        
        console.log(`Player ${promotedPlayer.name} promoted from waitlist for game ${gameId}`);
        
        const gameDate = formatDateForSMS(game.date);
        const gameTime = formatTimeForSMS(game.time);
        const message = `Good news! You've been moved from the waitlist to confirmed for Pickleball at ${game.location} on ${gameDate} at ${gameTime}! You are Player ${game.players.length} of ${game.totalPlayers}. Reply 9 to cancel.`;
        
        smsResult = await sendSMS(promotedPlayer.phone, message, gameId);
      }
      
      await saveGame(gameId, game, game.hostToken, game.hostPhone);
      
      res.json({ 
        status: 'removed',
        promotedPlayer,
        sms: smsResult 
      });
    } else if (playerIndex === 0) {
      console.log(`Cannot remove organizer from game ${gameId}`);
      res.status(403).json({ error: 'Cannot remove the organizer' });
    } else {
      const waitlistIndex = game.waitlist.findIndex(p => p.id === playerId);
      
      if (waitlistIndex >= 0) {
        const removedPlayer = game.waitlist.splice(waitlistIndex, 1)[0];
        console.log(`Player ${removedPlayer.name} removed from waitlist for game ${gameId}`);
        
        await saveGame(gameId, game, game.hostToken, game.hostPhone);
        
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

// Send reminders
app.post('/api/games/:id/send-reminders', async (req, res) => {
  try {
    const gameId = req.params.id;
    const game = await getGame(gameId);
    
    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }
    
    const gameDate = formatDateForSMS(game.date);
    const gameTime = formatTimeForSMS(game.time);
    
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

// Debug route
app.get('/api/debug/games', async (req, res) => {
  try {
    const games = await getAllGames();
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
  } catch (error) {
    console.error('Error fetching games for debug:', error);
    res.status(500).json({ error: 'Failed to fetch games' });
  }
});

// SMS webhook handler
app.post('/api/sms/webhook', express.json(), async (req, res) => {
  try {
    const { fromNumber, text, data: gameId } = req.body;
    
    console.log(`Received SMS from ${fromNumber}: "${text}" for game ${gameId}`);
    
    const cleanedFromNumber = formatPhoneNumber(fromNumber);
    const messageText = text.trim();
    
    if (messageText === '1') {
      const hostInfo = await getGameHostInfo(gameId);
      
      if (hostInfo && hostInfo.phone === cleanedFromNumber) {
        const game = await getGame(gameId);
        if (game) {
          const baseUrl = process.env.BASE_URL || 'https://your-domain.com';
          const managementLink = `${baseUrl}/manage.html?id=${gameId}&token=${hostInfo.hostToken}`;
          const responseMessage = `Here's your management link for ${game.location}: ${managementLink}`;
          await sendSMS(fromNumber, responseMessage);
          console.log(`Management link sent to host ${cleanedFromNumber} for game ${gameId}`);
        }
      } else {
        const responseMessage = `Sorry, we couldn't find your game. Only the game organizer can request the management link.`;
        await sendSMS(fromNumber, responseMessage);
      }
    } else if (messageText === '9') {
      const game = await getGame(gameId);
      if (!game) {
        console.log(`Game ${gameId} not found for SMS reply`);
        return res.json({ success: true });
      }
      
      let playerFound = false;
      
      const playerIndex = game.players.findIndex(p => p.phone === cleanedFromNumber);
      if (playerIndex > 0 && !game.players[playerIndex].isOrganizer) {
        playerFound = true;
        const player = game.players[playerIndex];
        
        game.players.splice(playerIndex, 1);
        console.log(`Player ${player.name} cancelled via SMS from game ${gameId}`);
        
        if (game.waitlist.length > 0) {
          const promotedPlayer = game.waitlist.shift();
          game.players.push(promotedPlayer);
          
          const gameDate = formatDateForSMS(game.date);
          const gameTime = formatTimeForSMS(game.time);
          const promotionMessage = `Good news! You've been moved from the waitlist to confirmed for Pickleball at ${game.location} on ${gameDate} at ${gameTime}! Reply 9 to cancel.`;
          
          await sendSMS(promotedPlayer.phone, promotionMessage, gameId);
          console.log(`Player ${promotedPlayer.name} promoted from waitlist for game ${gameId}`);
        }
        
        await saveGame(gameId, game, game.hostToken, game.hostPhone);
        
        const responseMessage = `Your pickleball reservation at ${game.location} has been cancelled. Thanks for letting us know!`;
        await sendSMS(fromNumber, responseMessage);
      }
      
      if (!playerFound) {
        const waitlistIndex = game.waitlist.findIndex(p => p.phone === cleanedFromNumber);
        if (waitlistIndex >= 0) {
          playerFound = true;
          const player = game.waitlist[waitlistIndex];
          
          game.waitlist.splice(waitlistIndex, 1);
          console.log(`Player ${player.name} cancelled from waitlist via SMS for game ${gameId}`);
          
          await saveGame(gameId, game, game.hostToken, game.hostPhone);
          
          const responseMessage = `You've been removed from the waitlist for pickleball at ${game.location}. Thanks for letting us know!`;
          await sendSMS(fromNumber, responseMessage);
        }
      }
      
      if (!playerFound) {
        const responseMessage = `We couldn't find your registration for this pickleball game. Please contact the organizer if you need assistance.`;
        await sendSMS(fromNumber, responseMessage);
      }
    } else {
      const responseMessage = `Reply "1" for management link or "9" to cancel your reservation. For other inquiries, contact the organizer.`;
      await sendSMS(fromNumber, responseMessage);
    }
    
    res.json({ success: true });
    
  } catch (error) {
    console.error('Error handling incoming SMS:', error);
    res.json({ success: true });
  }
});

// Helper Functions
function formatPhoneNumber(phoneNumber) {
  const cleaned = ('' + phoneNumber).replace(/\D/g, '');
  
  if (cleaned.length === 10) {
    return cleaned;
  } else if (cleaned.length === 11 && cleaned.startsWith('1')) {
    return cleaned.substring(1);
  }
  
  return cleaned;
}

function formatDateForSMS(dateStr) {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatTimeForSMS(timeStr) {
  const [hours, minutes] = timeStr.split(':');
  const hour = parseInt(hours);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const hour12 = hour % 12 || 12;
  return `${hour12}:${minutes} ${ampm}`;
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Closing database connection...');
  db.close((err) => {
    if (err) {
      console.error('Error closing database:', err);
    } else {
      console.log('Database connection closed.');
    }
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  console.log('Closing database connection...');
  db.close((err) => {
    if (err) {
      console.error('Error closing database:', err);
    } else {
      console.log('Database connection closed.');
    }
    process.exit(0);
  });
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Visit http://localhost:${PORT} to view your app`);
});