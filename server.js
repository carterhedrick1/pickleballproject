const express = require('express');
const path = require('path');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const validator = require('validator');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Database setup - SQLite for local, PostgreSQL for production
let db, pool;
let isProduction = process.env.DATABASE_URL ? true : false;

console.log(`Environment: ${isProduction ? 'Production (PostgreSQL)' : 'Local (SQLite)'}`);

if (isProduction) {
  // Production: Use PostgreSQL
  const { Pool } = require('pg');
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  console.log('Using PostgreSQL for production');
} else {
  // Local development: Use SQLite
  const sqlite3 = require('sqlite3').verbose();
  db = new sqlite3.Database('pickleball.db', (err) => {
    if (err) {
      console.error('Error opening SQLite database:', err);
    } else {
      console.log('Connected to SQLite database');
    }
  });
}

// Initialize database
async function initializeDatabase() {
  try {
    if (isProduction) {
      // PostgreSQL setup
      const client = await pool.connect();
      console.log('Connected to PostgreSQL database');
      
      await client.query(`
        CREATE TABLE IF NOT EXISTS games (
          id TEXT PRIMARY KEY,
          data JSONB NOT NULL,
          host_token TEXT NOT NULL,
          host_phone TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      // New table for SMS context
      await client.query(`
        CREATE TABLE IF NOT EXISTS sms_contexts (
          phone_number TEXT PRIMARY KEY,
          last_command TEXT NOT NULL,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      
      console.log('PostgreSQL tables initialized');
      client.release();
    } else {
      // SQLite setup
      db.serialize(() => {
        db.run(`CREATE TABLE IF NOT EXISTS games (
          id TEXT PRIMARY KEY,
          data TEXT NOT NULL,
          host_token TEXT NOT NULL,
          host_phone TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`, (err) => {
          if (err) {
            console.error('Error creating SQLite games table:', err);
          } else {
            console.log('SQLite games table initialized');
          }
        });
        // New table for SMS context
        db.run(`CREATE TABLE IF NOT EXISTS sms_contexts (
          phone_number TEXT PRIMARY KEY,
          last_command TEXT NOT NULL,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`, (err) => {
          if (err) {
            console.error('Error creating SQLite sms_contexts table:', err);
          } else {
            console.log('SQLite sms_contexts table initialized');
          }
        });
      });
    }
  } catch (err) {
    console.error('Database initialization error:', err);
  }
}

initializeDatabase();

// Database helper functions
async function saveGame(gameId, gameData, hostToken, hostPhone = null) {
  try {
    if (isProduction) {
      // PostgreSQL
      const client = await pool.connect();
      const query = `
        INSERT INTO games (id, data, host_token, host_phone, updated_at) 
        VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
        ON CONFLICT (id) 
        DO UPDATE SET data = $2, host_token = $3, host_phone = $4, updated_at = CURRENT_TIMESTAMP
      `;
      
      await client.query(query, [JSON.stringify(gameData), gameId, hostToken, hostPhone]); // Corrected order of parameters
      client.release();
    } else {
      // SQLite
      return new Promise((resolve, reject) => {
        const stmt = db.prepare(`
          INSERT OR REPLACE INTO games (id, data, host_token, host_phone, updated_at) 
          VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
        `);
        
        stmt.run([gameId, JSON.stringify(gameData), hostToken, hostPhone], function(err) {
          if (err) reject(err);
          else resolve(this);
        });
        
        stmt.finalize();
      });
    }
    
    console.log(`Game ${gameId} saved to database`);
  } catch (err) {
    console.error('Error saving game:', err);
    throw err;
  }
}

async function getGame(gameId) {
  try {
    if (isProduction) {
      // PostgreSQL
      const client = await pool.connect();
      const result = await client.query('SELECT * FROM games WHERE id = $1', [gameId]);
      client.release();
      
      if (result.rows.length > 0) {
        const row = result.rows[0];
        return {
          ...row.data,
          hostToken: row.host_token,
          hostPhone: row.host_phone
        };
      }
      return null;
    } else {
      // SQLite
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
  } catch (err) {
    console.error('Error getting game:', err);
    throw err;
  }
}

async function getGameHostInfo(gameId) {
  try {
    if (isProduction) {
      // PostgreSQL
      const client = await pool.connect();
      const result = await client.query('SELECT host_phone, host_token FROM games WHERE id = $1', [gameId]);
      client.release();
      
      if (result.rows.length > 0) {
        const row = result.rows[0];
        return { phone: row.host_phone, hostToken: row.host_token };
      }
      return null;
    } else {
      // SQLite
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
  } catch (err) {
    console.error('Error getting host info:', err);
    throw err;
  }
}

async function getAllGames() {
  try {
    if (isProduction) {
      // PostgreSQL
      const client = await pool.connect();
      const result = await client.query('SELECT id, data FROM games');
      client.release();
      
      const games = {};
      result.rows.forEach(row => {
        games[row.id] = row.data;
      });
      return games;
    } else {
      // SQLite
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
  } catch (err) {
    console.error('Error getting all games:', err);
    throw err;
  }
}

// SMS Context Management (New functions for stateful SMS conversations)
async function saveLastCommand(phoneNumber, context) {
  try {
    if (isProduction) {
      const client = await pool.connect();
      const query = `
        INSERT INTO sms_contexts (phone_number, last_command, updated_at)
        VALUES ($1, $2, CURRENT_TIMESTAMP)
        ON CONFLICT (phone_number)
        DO UPDATE SET last_command = $2, updated_at = CURRENT_TIMESTAMP
      `;
      await client.query(query, [phoneNumber, context]);
      client.release();
    } else {
      return new Promise((resolve, reject) => {
        const stmt = db.prepare(`
          INSERT OR REPLACE INTO sms_contexts (phone_number, last_command, updated_at)
          VALUES (?, ?, CURRENT_TIMESTAMP)
        `);
        stmt.run([phoneNumber, context], function(err) {
          if (err) reject(err);
          else resolve(this);
        });
        stmt.finalize();
      });
    }
    console.log(`[SMS Context] Saved context for ${phoneNumber}: ${context}`);
  } catch (err) {
    console.error('Error saving SMS context:', err);
  }
}

async function getLastCommand(phoneNumber) {
  try {
    if (isProduction) {
      const client = await pool.connect();
      const result = await client.query('SELECT last_command FROM sms_contexts WHERE phone_number = $1', [phoneNumber]);
      client.release();
      const context = result.rows.length > 0 ? result.rows[0].last_command : null;
      console.log(`[SMS Context] Retrieved context for ${phoneNumber}: ${context}`);
      return context;
    } else {
      return new Promise((resolve, reject) => {
        db.get('SELECT last_command FROM sms_contexts WHERE phone_number = ?', [phoneNumber], (err, row) => {
          if (err) {
            reject(err);
          } else {
            const context = row ? row.last_command : null;
            console.log(`[SMS Context] Retrieved context for ${phoneNumber}: ${context}`);
            resolve(context);
          }
        });
      });
    }
  } catch (err) {
    console.error('Error getting SMS context:', err);
    return null;
  }
}

async function clearLastCommand(phoneNumber) {
  try {
    if (isProduction) {
      const client = await pool.connect();
      await client.query('DELETE FROM sms_contexts WHERE phone_number = $1', [phoneNumber]);
      client.release();
    } else {
      return new Promise((resolve, reject) => {
        db.run('DELETE FROM sms_contexts WHERE phone_number = ?', [phoneNumber], function(err) {
          if (err) reject(err);
          else resolve(this);
        });
      });
    }
    console.log(`[SMS Context] Cleared context for ${phoneNumber}`);
  } catch (err) {
    console.error('Error clearing SMS context:', err);
  }
}


// SMS function
async function sendSMS(to, message, gameId = null) {
  try {
    if (!process.env.TEXTBELT_API_KEY) {
      console.log(`[DEV MODE] SMS would be sent to ${to}: ${message}`);
      return { success: true, dev: true };
    }
    
    const params = {
      phone: to,
      message: message,
      key: process.env.TEXTBELT_API_KEY
    };
    
    if (gameId) {
      params.replyWebhookUrl = `${process.env.BASE_URL || 'https://your-domain.com'}/api/sms/webhook`;
      params.webhookData = gameId; // This is the 'data' field in the webhook
    }
    
    const response = await fetch('https://textbelt.com/text', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(params)
    });

    const result = await response.json();
    
    if (result.success) {
      console.log(`SMS sent to ${to}. TextID: ${result.textId}`);
      return { success: true, textId: result.textId };
    } else {
      console.error('TextBelt error:', result.error);
      return { success: false, error: result.error };
    }
  } catch (error) {
    console.error('SMS sending failed:', error);
    return { success: false, error: error.message };
  }
}

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

function isValidPhoneNumber(phoneNumber) {
  if (!phoneNumber) return false;
  
  // Clean the number first
  const cleaned = ('' + phoneNumber).replace(/\D/g, '');
  
  // Check if it's a valid US phone number length
  if (cleaned.length === 10 || (cleaned.length === 11 && cleaned.startsWith('1'))) {
    // Use validator to double-check
    return validator.isMobilePhone(phoneNumber, 'en-US');
  }
  
  return false;
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

// Middleware
app.use(express.json());
app.use(express.static('public'));

app.use((req, res, next) => {
  console.log(`${req.method} ${req.url}`);
  next();
});

// Rate limiting - prevents spam
const createGameLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 15, // Allow 15 game creations per 15 minutes per IP
  message: { error: 'Too many games created. Please wait 15 minutes.' }
});

const generalLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 30, // Allow 30 requests per minute per IP
  message: { error: 'Too many requests. Please slow down.' }
});

// Apply rate limiting only in production
if (isProduction) {
  app.use('/api/games', generalLimiter);
  app.post('/api/games', createGameLimiter);
  console.log('Rate limiting enabled for production');
} else {
  console.log('Rate limiting disabled for local development');
}

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'Server is running', database: isProduction ? 'PostgreSQL' : 'SQLite' });
});

// Create game
app.post('/api/games', async (req, res) => {
  try {
    const gameData = req.body;
    const gameId = Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
    const hostToken = crypto.randomBytes(32).toString('hex');

    if (gameData.organizerPlaying) {
      gameData.players = [
        { 
          id: 'organizer', 
          name: gameData.organizerName || 'Organizer', 
          phone: gameData.organizerPhone ? formatPhoneNumber(gameData.organizerPhone) : '',
          isOrganizer: true 
        }
      ];
    } else {
      gameData.players = [];
    }
    
    gameData.waitlist = [];
    gameData.hostToken = hostToken;
    
    const hostPhone = gameData.hostPhone || gameData.organizerPhone;

    // Validate organizer phone number
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

// Add player manually
app.post('/api/games/:id/manual-player', async (req, res) => {
  try {
    const gameId = req.params.id;
    const { name, phone, addTo, token } = req.body;
    
    // Basic input cleaning
    const cleanName = name ? name.trim() : '';
    const cleanPhone = phone ? phone.trim() : '';
    
    // Validate required fields
    if (!cleanName) {
      return res.status(400).json({ error: 'Player name is required' });
    }
    
    // Validate phone number if provided
    if (cleanPhone && !isValidPhoneNumber(cleanPhone)) {
      return res.status(400).json({ error: 'Please enter a valid phone number' });
    }
    
    const game = await getGame(gameId);
    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }
    
    // Verify host token
    if (game.hostToken !== token) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    
    // Check for duplicate phone numbers ONLY (if phone provided)
    if (cleanPhone) {
      const formattedPhone = formatPhoneNumber(cleanPhone);
      
      const existingPlayer = game.players.find(p => p.phone === formattedPhone);
      if (existingPlayer) {
        return res.status(400).json({ error: 'This phone number is already registered for this game' });
      }
      
      if (game.waitlist) {
        const existingWaitlist = game.waitlist.find(p => p.phone === formattedPhone);
        if (existingWaitlist) {
          return res.status(400).json({ error: 'This phone number is already on the waitlist' });
        }
      }
    }
    
    const newPlayer = {
      id: Date.now().toString(36) + Math.random().toString(36).substring(2, 6),
      name: cleanName,
      phone: cleanPhone ? formatPhoneNumber(cleanPhone) : '',
      joinedAt: new Date().toISOString(),
      isOrganizer: false
    };
    
    // Determine where to add based on capacity and user choice
    const totalPlayers = parseInt(game.totalPlayers) || 4;
    const currentPlayerCount = game.players.length;
    const spotsAvailable = totalPlayers - currentPlayerCount;
    
if (addTo === 'waitlist' || spotsAvailable <= 0) {
  // Add to waitlist
  if (!game.waitlist) {
    game.waitlist = [];
  }
  game.waitlist.push(newPlayer);
  
  await saveGame(gameId, game, game.hostToken, game.hostPhone);
  
  const position = game.waitlist.length;
  return res.json({
    success: true,
    message: spotsAvailable <= 0 ? 
      `Game is full - ${cleanName} added to waitlist` : 
      `${cleanName} added to waitlist`,
    status: 'waitlist',
    position: position,
    reason: spotsAvailable <= 0 ? 'game_full' : 'requested'
  });
} else {
  // Add to confirmed players
  game.players.push(newPlayer);
  
  await saveGame(gameId, game, game.hostToken, game.hostPhone);
  
  const position = game.players.length;
  return res.json({
    success: true,
    message: `${cleanName} added to game`,
    status: 'confirmed',
    position: position,
    totalPlayers: totalPlayers
  });
}
} catch (error) {
  console.error('Error manually adding player:', error);
  res.status(500).json({ error: 'Failed to add player' });
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

    // Validate phone number before doing anything
    if (!isValidPhoneNumber(phone)) {
      return res.status(400).json({ 
        error: 'Please enter a valid US phone number (e.g., (555) 123-4567)' 
      });
    }

    const formattedPhone = formatPhoneNumber(phone);
    
    // Check for duplicate phone numbers ONLY
    const existingPlayer = game.players.find(p => p.phone === formattedPhone);
    if (existingPlayer) {
      return res.status(400).json({ error: 'This phone number is already registered for this game' });
    }
    
    const existingWaitlist = (game.waitlist || []).find(p => p.phone === formattedPhone);
    if (existingWaitlist) {
      return res.status(400).json({ error: 'This phone number is already on the waitlist' });
    }
    
    const playerId = Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
    const playerData = { id: playerId, name, phone: formattedPhone };
    
    let smsResult;
    
    if (game.players.length < parseInt(game.totalPlayers)) {
      game.players.push(playerData);
      await saveGame(gameId, game, game.hostToken, game.hostPhone);
      
      const gameDate = formatDateForSMS(game.date);
      const gameTime = formatTimeForSMS(game.time);
      const message = `You're confirmed for Pickleball at ${game.location} on ${gameDate} at ${gameTime}! You are Player ${game.players.length} of ${game.totalPlayers}. Reply 2 for game details or 9 to cancel.`;      
      smsResult = await sendSMS(formattedPhone, message, gameId);
      
      res.status(201).json({ 
        status: 'confirmed', 
        position: game.players.length,
        playerId,
        totalPlayers: game.totalPlayers,
        sms: smsResult
      });
    } else {
      if (!game.waitlist) game.waitlist = [];
      game.waitlist.push(playerData);
      await saveGame(gameId, game, game.hostToken, game.hostPhone);
      
      const message = `You've been added to the waitlist for Pickleball at ${game.location}. You are #${game.waitlist.length} on the waitlist. We'll notify you if a spot opens up! Reply 2 for game details or 9 to cancel.`;      
      smsResult = await sendSMS(formattedPhone, message);
      
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
    
    const playerIndex = game.players.findIndex(p => p.id === playerId);
    
    if (playerIndex >= 0) {
      const removedPlayer = game.players.splice(playerIndex, 1)[0];
      
      // If organizer removes themselves, keep their organizer status but remove from player list
      if (removedPlayer.isOrganizer) {
        console.log('Organizer removed themselves from player list but retains management access');
      }
      
      let promotedPlayer = null;
      let smsResult = null;
      
      // Promote from waitlist if available
      if (game.waitlist && game.waitlist.length > 0) {
        promotedPlayer = game.waitlist.shift();
        game.players.push(promotedPlayer);
        
        const gameDate = formatDateForSMS(game.date);
        const gameTime = formatTimeForSMS(game.time);
        const message = `Good news! You've been moved from the waitlist to confirmed for Pickleball at ${game.location} on ${gameDate} at ${gameTime}! You are Player ${game.players.length} of ${game.totalPlayers}. Reply 9 to cancel.`;
        
        if (promotedPlayer.phone) {
          smsResult = await sendSMS(promotedPlayer.phone, message, gameId);
        }
      }
      
      await saveGame(gameId, game, game.hostToken, game.hostPhone);
      
      res.json({ 
        status: 'removed',
        isOrganizer: removedPlayer.isOrganizer || false,
        promotedPlayer,
        sms: smsResult 
      });
    } else {
      // Check waitlist
      const waitlistIndex = (game.waitlist || []).findIndex(p => p.id === playerId);
      
      if (waitlistIndex >= 0) {
        const removedPlayer = game.waitlist.splice(waitlistIndex, 1)[0];
        await saveGame(gameId, game, game.hostToken, game.hostPhone);
        res.json({ status: 'removed from waitlist' });
      } else {
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

      
// SMS webhook - CORRECTED VERSION
app.post('/api/sms/webhook', express.json(), async (req, res) => {
  try {
    const { fromNumber, text, data: gameId } = req.body;
    
    console.log(`Received SMS from ${fromNumber}: "${text}" for game ${gameId}`);
    
    const cleanedFromNumber = formatPhoneNumber(fromNumber);
    const messageText = text.trim();
    const lastCommand = await getLastCommand(cleanedFromNumber); // Get context early

    // --- Priority 1: Handle numerical selections if a context exists ---
    // This block runs if the message is a number AND we expect a numerical selection
    if (/^\d+$/.test(messageText) && lastCommand) {
      const selection = parseInt(messageText) - 1; // Convert to 0-indexed
      
      if (lastCommand === 'details_selection') {
        const allGames = await getAllGames();
        const userGames = [];
        
        // Re-generate userGames list (same logic as '2' command)
        for (const [id, game] of Object.entries(allGames)) {
          const gameDate = new Date(game.date);
          const now = new Date();
          
          if (gameDate >= now || (gameDate.toDateString() === now.toDateString())) {
            let userRole = null;
            const playerInConfirmed = game.players.find(p => p.phone === cleanedFromNumber);
            const playerInWaitlist = (game.waitlist || []).find(p => p.phone === cleanedFromNumber);
            
            if (playerInConfirmed) {
              userRole = playerInConfirmed.isOrganizer ? 'host' : 'confirmed';
            } else if (playerInWaitlist) {
              userRole = 'waitlist';
            } else {
              const hostInfo = await getGameHostInfo(id);
              if (hostInfo && hostInfo.phone === cleanedFromNumber) {
                userRole = 'host';
              }
            }
            
            if (userRole) {
              userGames.push({ id, game, role: userRole });
            }
          }
        }
        
        if (selection >= 0 && selection < userGames.length) {
          const { game, role } = userGames[selection];
          const gameDate = formatDateForSMS(game.date);
          const gameTime = formatTimeForSMS(game.time);
          
          let responseMessage = `🏓 ${game.location}\n📅 ${gameDate} at ${gameTime}\n⏱️ Duration: ${game.duration} minutes\n\n`;
          
          responseMessage += `👥 Confirmed Players (${game.players.length}/${game.totalPlayers}):\n`;
          if (game.players.length === 0) {
            responseMessage += `• None yet\n`;
          } else {
            game.players.forEach(player => {
              responseMessage += `• ${player.name}${player.isOrganizer ? ' (Organizer)' : ''}\n`;
            });
          }
          
          if (game.waitlist && game.waitlist.length > 0) {
            responseMessage += `\n⏳ Waitlist (${game.waitlist.length}):\n`;
            game.waitlist.forEach((player, index) => {
              responseMessage += `• ${player.name} (#${index + 1})\n`;
            });
          }
          
          if (role === 'host') {
            responseMessage += `\nYou are: 🎯 Host/Organizer\nReply "1" for management link`;
          } else if (role === 'confirmed') {
            responseMessage += `\nYou are: ✅ Confirmed Player\nReply "9" to cancel`;
          } else if (role === 'waitlist') {
            const waitlistPosition = game.waitlist.findIndex(p => p.phone === cleanedFromNumber) + 1;
            responseMessage += `\nYou are: ⏳ Waitlist #${waitlistPosition}\nReply "9" to cancel`;
          }
          
          await sendSMS(fromNumber, responseMessage);
          await clearLastCommand(cleanedFromNumber); // Clear context after providing details
        } else {
          // Invalid selection within context
          await sendSMS(fromNumber, `Invalid game number. Please reply with a valid number from the list or text "2" for game details.`);
          await clearLastCommand(cleanedFromNumber); // Clear context on invalid input
        }

      } else if (lastCommand === 'cancellation_selection') {
        const allGames = await getAllGames();
        const playerGames = [];
        
        // Same logic as "9" command
        for (const [id, game] of Object.entries(allGames)) {
          const gameDate = new Date(game.date);
          const now = new Date();
          
          if (gameDate >= now || (gameDate.toDateString() === now.toDateString())) {
            const playerInConfirmed = game.players.find(p => p.phone === cleanedFromNumber && !p.isOrganizer);
            const playerInWaitlist = (game.waitlist || []).find(p => p.phone === cleanedFromNumber);
            
            if (playerInConfirmed || playerInWaitlist) {
              playerGames.push({
                id,
                game,
                player: playerInConfirmed || playerInWaitlist,
                status: playerInConfirmed ? 'confirmed' : 'waitlist'
              });
            }
          }
        }
        
        if (selection >= 0 && selection < playerGames.length) {
          const { id, game, player, status } = playerGames[selection];
          
          if (status === 'confirmed') {
            const playerIndex = game.players.findIndex(p => p.id === player.id);
            game.players.splice(playerIndex, 1);
            
            if (game.waitlist && game.waitlist.length > 0) {
              const promotedPlayer = game.waitlist.shift();
              game.players.push(promotedPlayer);
              
              const gameDate = formatDateForSMS(game.date);
              const gameTime = formatTimeForSMS(game.time);
              const promotionMessage = `Good news! You've been moved from the waitlist to confirmed for Pickleball at ${game.location} on ${gameDate} at ${gameTime}! Reply 2 for game details or 9 to cancel.`;
              
              await sendSMS(promotedPlayer.phone, promotionMessage, id);
            }
          } else {
            const waitlistIndex = game.waitlist.findIndex(p => p.id === player.id);
            game.waitlist.splice(waitlistIndex, 1);
          }
          
          await saveGame(id, game, game.hostToken, game.hostPhone);
          
          const gameDate = formatDateForSMS(game.date);
          const gameTime = formatTimeForSMS(game.time);
          const statusText = status === 'confirmed' ? 'reservation' : 'waitlist spot';
          await sendSMS(fromNumber, `Your pickleball ${statusText} at ${game.location} on ${gameDate} at ${gameTime} has been cancelled. Thanks for letting us know!`);
          await clearLastCommand(cleanedFromNumber); // Clear context after cancellation
          
        } else {
          // Invalid selection within context
          await sendSMS(fromNumber, `Invalid selection. Please reply with a valid number from the list or text "9" to try cancelling again.`);
          await clearLastCommand(cleanedFromNumber); // Clear context on invalid input
        }
      } 
      // If a number is sent but no relevant context (e.g., just sent "5" out of the blue)
      else {
        await sendSMS(fromNumber, `Reply "1" for management link, "2" for game details, or "9" to cancel your reservation. For other inquiries, contact the organizer.`);
        await clearLastCommand(cleanedFromNumber); 
      }
    } 
    // --- Priority 2: Handle specific text commands (1, 2, 9) if no numerical selection or no context ---
    // This block runs if the message is NOT a number, OR if it's a number but there was no active context.
    else if (messageText === '1') {
      await clearLastCommand(cleanedFromNumber); // Clear any old context before starting new command
      const allGames = await getAllGames();
      const hostGames = [];
      
      for (const [id, game] of Object.entries(allGames)) {
        const hostInfo = await getGameHostInfo(id);
        if (hostInfo && hostInfo.phone === cleanedFromNumber) {
          const gameDate = new Date(game.date);
          const now = new Date();
          if (gameDate >= now || (gameDate.toDateString() === now.toDateString())) {
            hostGames.push({ id, game, hostInfo });
          }
        }
      }
      
      if (hostGames.length === 0) {
        await sendSMS(fromNumber, `Sorry, we couldn't find any upcoming games for your number.`);
      } else if (hostGames.length === 1) {
        const { id, game, hostInfo } = hostGames[0];
        const baseUrl = process.env.BASE_URL || 'https://your-domain.com';
        const managementLink = `${baseUrl}/manage.html?id=${id}&token=${hostInfo.hostToken}`;
        const gameDate = formatDateForSMS(game.date);
        const gameTime = formatTimeForSMS(game.time);
        
        await sendSMS(fromNumber, `Here's your management link for ${game.location} on ${gameDate} at ${gameTime}: ${managementLink}`);
      } else {
        let responseMessage = `You have ${hostGames.length} upcoming games:\n\n`;
        
        hostGames.forEach(({ id, game, hostInfo }, index) => {
          const baseUrl = process.env.BASE_URL || 'https://your-domain.com';
          const managementLink = `${baseUrl}/manage.html?id=${id}&token=${hostInfo.hostToken}`;
          const gameDate = formatDateForSMS(game.date);
          const gameTime = formatTimeForSMS(game.time);
          
          responseMessage += `${index + 1}. ${game.location}\n${gameDate} at ${gameTime}\n${managementLink}\n\n`;
        });
        
        if (responseMessage.length > 1500) {
          responseMessage = `You have ${hostGames.length} upcoming games. Please visit the website to manage them.`;
        }
        
        await sendSMS(fromNumber, responseMessage);
        // No context needed here, '1' always lists games
      }
      
    } else if (messageText === '2') { 
      await clearLastCommand(cleanedFromNumber); // Clear any old context before starting new command
      const allGames = await getAllGames();
      const userGames = [];
      
      for (const [id, game] of Object.entries(allGames)) {
        const gameDate = new Date(game.date);
        const now = new Date();
        
        if (gameDate >= now || (gameDate.toDateString() === now.toDateString())) {
          let userRole = null;
          const playerInConfirmed = game.players.find(p => p.phone === cleanedFromNumber);
          const playerInWaitlist = (game.waitlist || []).find(p => p.phone === cleanedFromNumber);
          
          if (playerInConfirmed) {
            userRole = playerInConfirmed.isOrganizer ? 'host' : 'confirmed';
          } else if (playerInWaitlist) {
            userRole = 'waitlist';
          } else {
            const hostInfo = await getGameHostInfo(id);
            if (hostInfo && hostInfo.phone === cleanedFromNumber) {
              userRole = 'host';
            }
          }
          
          if (userRole) {
            userGames.push({ id, game, role: userRole });
          }
        }
      }
      
      if (userGames.length === 0) {
        await sendSMS(fromNumber, `You don't have any upcoming games.`);
      } else if (userGames.length === 1) {
        const { game, role } = userGames[0];
        const gameDate = formatDateForSMS(game.date);
        const gameTime = formatTimeForSMS(game.time);
        
        let responseMessage = `🏓 ${game.location}\n📅 ${gameDate} at ${gameTime}\n⏱️ Duration: ${game.duration} minutes\n\n`;
        
        responseMessage += `👥 Confirmed Players (${game.players.length}/${game.totalPlayers}):\n`;
        if (game.players.length === 0) {
          responseMessage += `• None yet\n`;
        } else {
          game.players.forEach(player => {
            responseMessage += `• ${player.name}${player.isOrganizer ? ' (Organizer)' : ''}\n`;
          });
        }
        
        if (game.waitlist && game.waitlist.length > 0) {
          responseMessage += `\n⏳ Waitlist (${game.waitlist.length}):\n`;
          game.waitlist.forEach((player, index) => {
            responseMessage += `• ${player.name} (#${index + 1})\n`;
          });
        }
        
        if (role === 'host') {
          responseMessage += `\nYou are: 🎯 Host/Organizer\nReply "1" for management link`;
        } else if (role === 'confirmed') {
          responseMessage += `\nYou are: ✅ Confirmed Player\nReply "9" to cancel`;
        } else if (role === 'waitlist') {
          const waitlistPosition = game.waitlist.findIndex(p => p.phone === cleanedFromNumber) + 1;
          responseMessage += `\nYou are: ⏳ Waitlist #${waitlistPosition}\nReply "9" to cancel`;
        }
        
        await sendSMS(fromNumber, responseMessage);
        // No context needed here if only one game
      } else {
        let responseMessage = `You have ${userGames.length} upcoming games. Reply with just the number (1, 2, 3, etc.) to see details:\n\n`;
        
        userGames.forEach(({ game, role }, index) => {
          const gameDate = formatDateForSMS(game.date);
          const gameTime = formatTimeForSMS(game.time);
          
          let statusIcon = '';
          let roleText = '';
          
          if (role === 'host') {
            statusIcon = '🎯';
            roleText = ' (Host)';
          } else if (role === 'confirmed') {
            statusIcon = '✅';
          } else {
            statusIcon = '⏳';
          }
          
          responseMessage += `${index + 1}. ${statusIcon} ${game.location}${roleText}\n${gameDate} at ${gameTime}\n\n`;
        });
        
        await sendSMS(fromNumber, responseMessage);
        await saveLastCommand(cleanedFromNumber, 'details_selection'); // Set context for numerical follow-up
      }
      
    } else if (messageText === '9') {
      await clearLastCommand(cleanedFromNumber); // Clear any old context before starting new command
      const allGames = await getAllGames();
      const playerGames = [];
      
      for (const [id, game] of Object.entries(allGames)) {
        const gameDate = new Date(game.date);
        const now = new Date();
        
        if (gameDate >= now || (gameDate.toDateString() === now.toDateString())) {
          const playerInConfirmed = game.players.find(p => p.phone === cleanedFromNumber && !p.isOrganizer);
          const playerInWaitlist = (game.waitlist || []).find(p => p.phone === cleanedFromNumber);
          
          if (playerInConfirmed || playerInWaitlist) {
            playerGames.push({
              id,
              game,
              player: playerInConfirmed || playerInWaitlist,
              status: playerInConfirmed ? 'confirmed' : 'waitlist'
            });
          }
        }
      }
      
      if (playerGames.length === 0) {
        await sendSMS(fromNumber, `We couldn't find any upcoming game registrations for your number.`);
      } else if (playerGames.length === 1) {
        const { id, game, player, status } = playerGames[0];
        
        if (status === 'confirmed') {
          const playerIndex = game.players.findIndex(p => p.id === player.id);
          game.players.splice(playerIndex, 1);
          
          if (game.waitlist && game.waitlist.length > 0) {
            const promotedPlayer = game.waitlist.shift();
            game.players.push(promotedPlayer);
            
            const gameDate = formatDateForSMS(game.date);
            const gameTime = formatTimeForSMS(game.time);
            const promotionMessage = `Good news! You've been moved from the waitlist to confirmed for Pickleball at ${game.location} on ${gameDate} at ${gameTime}! Reply 2 for game details or 9 to cancel.`;
            
            await sendSMS(promotedPlayer.phone, promotionMessage, id);
          }
        } else {
          const waitlistIndex = game.waitlist.findIndex(p => p.id === player.id);
          game.waitlist.splice(waitlistIndex, 1);
        }
        
        await saveGame(id, game, game.hostToken, game.hostPhone);
        
        const statusText = status === 'confirmed' ? 'reservation' : 'waitlist spot';
        await sendSMS(fromNumber, `Your pickleball ${statusText} at ${game.location} has been cancelled. Thanks for letting us know!`);
      } else {
        let responseMessage = `You're registered for ${playerGames.length} upcoming games. Reply with the number of the game you want to cancel:\n\n`;
        
        playerGames.forEach(({ game, status }, index) => {
          const gameDate = formatDateForSMS(game.date);
          const gameTime = formatTimeForSMS(game.time);
          const statusText = status === 'confirmed' ? 'Confirmed' : 'Waitlist';
          
          responseMessage += `${index + 1}. ${game.location}\n${gameDate} at ${gameTime} (${statusText})\n\n`;
        });
        
        await sendSMS(fromNumber, responseMessage);
        await saveLastCommand(cleanedFromNumber, 'cancellation_selection'); // Set context for numerical follow-up
      }
      
    } else {
      // Default response for unrecognized commands or clear context
      await sendSMS(fromNumber, `Reply "1" for management link, "2" for game details, or "9" to cancel your reservation. For other inquiries, contact the organizer.`);
      await clearLastCommand(cleanedFromNumber); 
    }
    
    res.json({ success: true });
    
  } catch (error) {
    console.error('Error handling incoming SMS:', error);
    res.json({ success: true, message: "Error processing webhook, please try again or contact support." });
  }
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Closing database connection...');
  if (isProduction) {
    pool.end(() => {
      console.log('PostgreSQL connection pool closed.');
      process.exit(0);
    });
  } else {
    db.close((err) => {
      if (err) {
        console.error('Error closing SQLite database:', err);
      } else {
        console.log('SQLite database connection closed.');
      }
      process.exit(0);
    });
  }
});

process.on('SIGTERM', () => {
  console.log('Closing database connection...');
  if (isProduction) {
    pool.end(() => {
      console.log('PostgreSQL connection pool closed.');
      process.exit(0);
    });
  } else {
    db.close((err) => {
      if (err) {
        console.error('Error closing SQLite database:', err);
      } else {
        console.log('SQLite database connection closed.');
      }
      process.exit(0);
    });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Visit http://localhost:${PORT} to view your app`);
});