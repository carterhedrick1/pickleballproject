// server.js - PROTECTED VERSION with comprehensive SMS monitoring
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

// Import our enhanced modules
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
  formatTimeForSMS,
  activateEmergencyStop,
  deactivateEmergencyStop,
  getProtectionStatus,
  getSMSStats
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

// ============================================================================
// SMS MONITORING & PROTECTION SYSTEM
// ============================================================================

// SMS monitoring state
const SMS_MONITOR = {
  startTime: new Date(),
  totalSent: 0,
  totalBlocked: 0,
  totalErrors: 0,
  lastHourSent: 0,
  lastHourStart: Date.now(),
  
  // Track by endpoint
  endpointStats: new Map(),
  
  // Track recent activity
  recentActivity: []
};

// Enhanced organizer notification with protection and logging
async function sendOrganizerNotification(gameId, game, eventType, playerName = null) {
  console.log(`[ORGANIZER] 🎯 Notification request: ${eventType} for game ${gameId}`);
  console.log(`[ORGANIZER] Player: ${playerName || 'N/A'}, Host: ${game.hostPhone || 'N/A'}`);
  
  try {
    // Pre-flight checks
    if (!game.hostPhone) {
      console.log(`[ORGANIZER] ❌ No hostPhone found, skipping notification`);
      return { success: false, reason: 'No host phone' };
    }
    
    if (!game.notificationPreferences) {
      console.log(`[ORGANIZER] ❌ No notification preferences found, skipping notification`);
      return { success: false, reason: 'No preferences' };
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
    
    console.log(`[ORGANIZER] Checking preference for ${eventType}: ${prefs[eventType]}`);
    
    switch (eventType) {
      case 'gameFull':
        if (prefs.gameFull === true) {
          shouldSend = true;
          message = `🎯 HOST ALERT: Your pickleball game at ${locationText} on ${gameDate} is now FULL! All ${game.totalPlayers} spots are taken.`;
        }
        break;
        
      case 'playerJoins':
        if (prefs.playerJoins === true && playerName) {
          shouldSend = true;
          const spotsLeft = parseInt(game.totalPlayers) - game.players.length;
          message = `🎯 HOST ALERT: ${playerName} just joined your pickleball game at ${locationText} on ${gameDate}. ${spotsLeft} ${spotsLeft === 1 ? 'spot' : 'spots'} remaining.`;
        }
        break;
        
      case 'playerCancels':
        if (prefs.playerCancels === true && playerName) {
          shouldSend = true;
          const spotsLeft = parseInt(game.totalPlayers) - game.players.length;
          message = `🎯 HOST ALERT: ${playerName} cancelled their spot for your pickleball game at ${locationText} on ${gameDate}. ${spotsLeft} ${spotsLeft === 1 ? 'spot' : 'spots'} now available.`;
        }
        break;
        
      case 'oneSpotLeft':
        if (prefs.oneSpotLeft === true) {
          shouldSend = true;
          message = `🎯 HOST ALERT: Only 1 spot left for your pickleball game at ${locationText} on ${gameDate}!`;
        }
        break;
        
      case 'waitlistStarts':
        if (prefs.waitlistStarts === true && playerName) {
          shouldSend = true;
          message = `🎯 HOST ALERT: ${playerName} is the first person on the waitlist for your pickleball game at ${locationText} on ${gameDate}.`;
        }
        break;
        
      default:
        console.log(`[ORGANIZER] ❌ Unknown event type: ${eventType}`);
        return { success: false, reason: 'Unknown event type' };
    }
    
    if (shouldSend && message) {
      console.log(`[ORGANIZER] ✅ Sending notification to ${game.hostPhone}`);
      console.log(`[ORGANIZER] Message preview: "${message.substring(0, 100)}..."`);
      
      // Track this SMS attempt
      trackSMSAttempt('organizer_notification', eventType);
      
      const smsResult = await sendSMS(game.hostPhone, message, gameId);
      
      console.log(`[ORGANIZER] SMS result:`, {
        success: smsResult.success,
        blocked: smsResult.blocked,
        error: smsResult.error,
        protection: smsResult.protection
      });
      
      if (smsResult.success) {
        console.log(`[ORGANIZER] ✅ Successfully sent ${eventType} notification`);
        updateSMSStats('success');
      } else {
        console.log(`[ORGANIZER] ❌ Failed to send ${eventType} notification: ${smsResult.error}`);
        updateSMSStats(smsResult.blocked ? 'blocked' : 'error');
      }
      
      return smsResult;
    } else {
      console.log(`[ORGANIZER] ❌ Not sending notification - shouldSend: ${shouldSend}, hasMessage: ${!!message}`);
      return { success: false, reason: 'Notification not enabled or no message' };
    }
    
  } catch (error) {
    console.error(`[ORGANIZER] 💥 Error in sendOrganizerNotification:`, error);
    updateSMSStats('error');
    return { success: false, error: error.message };
  }
}

// SMS tracking functions
function trackSMSAttempt(endpoint, details = null) {
  const timestamp = new Date();
  
  // Update endpoint stats
  const endpointStat = SMS_MONITOR.endpointStats.get(endpoint) || { count: 0, lastUsed: null };
  endpointStat.count++;
  endpointStat.lastUsed = timestamp;
  SMS_MONITOR.endpointStats.set(endpoint, endpointStat);
  
  // Add to recent activity (keep last 100)
  SMS_MONITOR.recentActivity.push({
    timestamp,
    endpoint,
    details
  });
  
  if (SMS_MONITOR.recentActivity.length > 100) {
    SMS_MONITOR.recentActivity.shift();
  }
  
  console.log(`[SMS MONITOR] 📊 Endpoint: ${endpoint}, Details: ${details}, Total attempts: ${endpointStat.count}`);
}

function updateSMSStats(result) {
  switch (result) {
    case 'success':
      SMS_MONITOR.totalSent++;
      SMS_MONITOR.lastHourSent++;
      break;
    case 'blocked':
      SMS_MONITOR.totalBlocked++;
      break;
    case 'error':
      SMS_MONITOR.totalErrors++;
      break;
  }
  
  // Reset hourly counter
  const now = Date.now();
  if (now - SMS_MONITOR.lastHourStart > 3600000) { // 1 hour
    console.log(`[SMS MONITOR] ⏰ Hourly reset: Previous hour had ${SMS_MONITOR.lastHourSent} SMS sent`);
    SMS_MONITOR.lastHourSent = result === 'success' ? 1 : 0;
    SMS_MONITOR.lastHourStart = now;
  }
}

function getSMSMonitorStats() {
  const uptime = Math.floor((Date.now() - SMS_MONITOR.startTime.getTime()) / 1000);
  const protectionStatus = getProtectionStatus();
  
  return {
    uptime: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`,
    totals: {
      sent: SMS_MONITOR.totalSent,
      blocked: SMS_MONITOR.totalBlocked,
      errors: SMS_MONITOR.totalErrors
    },
    rates: {
      lastHour: SMS_MONITOR.lastHourSent,
      avgPerHour: Math.round(SMS_MONITOR.totalSent / Math.max(1, uptime / 3600))
    },
    protection: protectionStatus,
    endpoints: Object.fromEntries(SMS_MONITOR.endpointStats),
    recentActivity: SMS_MONITOR.recentActivity.slice(-10) // Last 10 activities
  };
}

// ============================================================================
// MIDDLEWARE & SETUP
// ============================================================================

app.set('trust proxy', 1);
initializeDatabase();

app.use(express.json());
app.use(express.static('public'));

// Enhanced logging middleware
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.url}`);
  
  // Track API calls that might send SMS
  if (req.url.includes('/api/games') && ['POST', 'PUT', 'DELETE'].includes(req.method)) {
    console.log(`[API TRACK] Potential SMS-sending endpoint: ${req.method} ${req.url}`);
  }
  
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
  console.log('[RATE LIMIT] ✅ Rate limiting enabled for production');
} else {
  console.log('[RATE LIMIT] ⚠️ Rate limiting disabled for local development');
}

// ============================================================================
// REMINDER SYSTEM WITH PROTECTION
// ============================================================================

// Enhanced reminder system with protection
async function protectedCheckAndSendReminders() {
  console.log(`[REMINDER] 🔄 Starting reminder check...`);
  
  const protectionStatus = getProtectionStatus();
  console.log(`[REMINDER] Protection status: ${JSON.stringify(protectionStatus)}`);
  
  // Check if we're near daily limit
  const currentCount = parseInt(protectionStatus.daily.split('/')[0]);
  const dailyLimit = parseInt(protectionStatus.daily.split('/')[1]);
  
  if (currentCount >= dailyLimit * 0.9) { // 90% of daily limit
    console.log(`[REMINDER] ⚠️ Near daily SMS limit (${currentCount}/${dailyLimit}), skipping reminder check`);
    return;
  }
  
  try {
    trackSMSAttempt('reminder_system');
    await checkAndSendReminders();
    console.log(`[REMINDER] ✅ Reminder check completed successfully`);
  } catch (error) {
    console.error(`[REMINDER] ❌ Error in reminder check:`, error);
    updateSMSStats('error');
  }
}

// Start reminder system - but with protection
const REMINDER_INTERVAL = parseInt(process.env.REMINDER_INTERVAL_MINUTES) || 5; // Default 5 minutes
console.log(`[REMINDER] Starting reminder system - checking every ${REMINDER_INTERVAL} minutes`);

setInterval(protectedCheckAndSendReminders, REMINDER_INTERVAL * 60 * 1000);

// Also run once on startup after a delay
setTimeout(protectedCheckAndSendReminders, 10000);

// ============================================================================
// MONITORING & ADMIN ENDPOINTS
// ============================================================================

// Health check with SMS stats
app.get('/api/health', (req, res) => {
  const smsStats = getSMSMonitorStats();
  res.json({ 
    status: 'OK', 
    message: 'Server is running', 
    database: isProduction ? 'PostgreSQL' : 'SQLite',
    sms: smsStats,
    timestamp: new Date().toISOString()
  });
});

// SMS monitoring dashboard
app.get('/api/sms/status', (req, res) => {
  const stats = getSMSMonitorStats();
  const smsStats = getSMSStats();
  
  res.json({
    monitor: stats,
    protection: smsStats,
    timestamp: new Date().toISOString()
  });
});

// Emergency SMS controls
app.post('/api/sms/emergency-stop', (req, res) => {
  console.log(`[EMERGENCY] 🚨 Emergency stop activated via API`);
  activateEmergencyStop();
  res.json({ success: true, message: 'Emergency stop activated' });
});

app.post('/api/sms/emergency-resume', (req, res) => {
  console.log(`[EMERGENCY] ✅ Emergency stop deactivated via API`);
  deactivateEmergencyStop();
  res.json({ success: true, message: 'Emergency stop deactivated' });
});

// Manual reminder test with protection
app.post('/api/test-reminders', async (req, res) => {
  console.log(`[TEST] 🧪 Manual reminder test requested`);
  
  try {
    trackSMSAttempt('manual_test');
    await protectedCheckAndSendReminders();
    res.json({ success: true, message: 'Reminder check completed' });
  } catch (error) {
    console.error('[TEST] Manual reminder test failed:', error);
    updateSMSStats('error');
    res.status(500).json({ error: 'Failed to run reminder check' });
  }
});

// ============================================================================
// GAME ENDPOINTS WITH ENHANCED LOGGING
// ============================================================================

// Create game with enhanced logging
app.post('/api/games', async (req, res) => {
  console.log(`[CREATE GAME] 🎮 New game creation request`);
  console.log(`[CREATE GAME] Request body:`, JSON.stringify(req.body, null, 2));
  
  try {
    const gameId = Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
    const hostToken = crypto.randomBytes(32).toString('hex');

    const gameData = createGameData(req.body);
    gameData.hostToken = hostToken;
    
    const hostPhone = req.body.hostPhone || req.body.organizerPhone;

    if (hostPhone && !isValidPhoneNumber(hostPhone)) {
      console.log(`[CREATE GAME] ❌ Invalid phone number: ${hostPhone}`);
      return res.status(400).json({ 
        error: 'Please enter a valid US phone number for the organizer' 
      });
    }    
    
    const formattedHostPhone = hostPhone ? formatPhoneNumber(hostPhone) : null;
    gameData.hostPhone = formattedHostPhone;
    
    console.log(`[CREATE GAME] Final game data:`);
    console.log(`  - Game ID: ${gameId}`);
    console.log(`  - Host phone: ${formattedHostPhone}`);
    console.log(`  - Location: ${gameData.location}`);
    console.log(`  - Date: ${gameData.date} ${gameData.time}`);
    console.log(`  - Notification preferences:`, gameData.notificationPreferences);
    
    await saveGame(gameId, gameData, hostToken, formattedHostPhone);
    
    const response = { 
      gameId,
      hostToken,
      playerLink: `/game.html?id=${gameId}`,
      hostLink: `/manage.html?id=${gameId}&token=${hostToken}`
    };
    
    // Send confirmation SMS to host with tracking
    let smsResult = null;
    if (hostPhone) {
      console.log(`[CREATE GAME] 📱 Sending confirmation SMS to host`);
      
      trackSMSAttempt('game_creation', `Host: ${formattedHostPhone}`);
      
      const gameDate = formatDateForSMS(gameData.date);
      const gameTime = formatTimeForSMS(gameData.time);
      let locationText = gameData.location;
      if (gameData.courtNumber && gameData.courtNumber.trim()) {
          locationText += ` - ${gameData.courtNumber}`;
      }
      const hostMessage = `Your pickleball game at ${locationText} on ${gameDate} at ${gameTime} has been created! Reply "1" for management link or "2" for game details.`;
      
      smsResult = await sendSMS(formattedHostPhone, hostMessage, gameId);
      
      if (smsResult.success) {
        updateSMSStats('success');
        console.log(`[CREATE GAME] ✅ Host SMS sent successfully`);
      } else {
        updateSMSStats(smsResult.blocked ? 'blocked' : 'error');
        console.log(`[CREATE GAME] ❌ Host SMS failed: ${smsResult.error}`);
      }
    }
    
    response.hostSms = smsResult;
    console.log(`[CREATE GAME] ✅ Game created successfully: ${gameId}`);
    res.status(201).json(response);
  } catch (error) {
    console.error(`[CREATE GAME] ❌ Error creating game:`, error);
    updateSMSStats('error');
    res.status(500).json({ error: 'Failed to create game' });
  }
});

// Get game (no changes needed)
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

// Update game with enhanced logging
app.put('/api/games/:id', async (req, res) => {
  console.log(`[UPDATE GAME] 🔄 Game update request for ${req.params.id}`);
  
  try {
    const gameId = req.params.id;
    const { token, ...updateData } = req.body;
    
    console.log(`[UPDATE GAME] Update data:`, JSON.stringify(updateData, null, 2));
    
    const game = await getGame(gameId);
    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }
    
    if (game.hostToken !== token) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    
    Object.assign(game, updateData);
    
    if (updateData.notificationPreferences) {
      game.notificationPreferences = {
        gameFull: updateData.notificationPreferences.gameFull === true,
        playerJoins: updateData.notificationPreferences.playerJoins === true,
        playerCancels: updateData.notificationPreferences.playerCancels === true,
        oneSpotLeft: updateData.notificationPreferences.oneSpotLeft === true,
        waitlistStarts: updateData.notificationPreferences.waitlistStarts === true
      };
      
      console.log(`[UPDATE GAME] Updated notification preferences:`, game.notificationPreferences);
    }
    
    await saveGame(gameId, game, game.hostToken, game.hostPhone);
    
    const savedGame = await getGame(gameId);
    console.log(`[UPDATE GAME] ✅ Game updated successfully`);
    
    res.json({ 
      success: true, 
      message: 'Game updated successfully. Use the Communication tab to notify players of changes if needed.',
      notificationPreferences: savedGame.notificationPreferences
    });
  } catch (error) {
    console.error(`[UPDATE GAME] ❌ Error updating game:`, error);
    res.status(500).json({ error: 'Failed to update game' });
  }
});

// Cancel game with enhanced logging
app.delete('/api/games/:id', async (req, res) => {
  console.log(`[CANCEL GAME] ❌ Game cancellation request for ${req.params.id}`);
  
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
    
    console.log(`[CANCEL GAME] Notifying ${game.players.length} confirmed players and ${(game.waitlist || []).length} waitlisted players`);
    
    trackSMSAttempt('game_cancellation', `Players: ${game.players.length + (game.waitlist || []).length}`);
    
    for (const player of game.players) {
      if (player.phone && !player.isOrganizer) {
        const result = await sendSMS(player.phone, cancellationMessage);
        results.push({ player: player.name, type: 'confirmed', result });
        if (result.success) {
          notificationCount++;
          updateSMSStats('success');
        } else {
          updateSMSStats(result.blocked ? 'blocked' : 'error');
        }
      }
    }
    
    for (const player of game.waitlist || []) {
      if (player.phone) {
        const result = await sendSMS(player.phone, cancellationMessage);
        results.push({ player: player.name, type: 'waitlist', result });
        if (result.success) {
          notificationCount++;
          updateSMSStats('success');
        } else {
          updateSMSStats(result.blocked ? 'blocked' : 'error');
        }
      }
    }
    
    console.log(`[CANCEL GAME] ✅ Cancellation complete. Notified ${notificationCount} players.`);
    
    res.json({ 
      success: true, 
      notificationCount,
      results 
    });
  } catch (error) {
    console.error(`[CANCEL GAME] ❌ Error cancelling game:`, error);
    updateSMSStats('error');
    res.status(500).json({ error: 'Failed to cancel game' });
  }
});

// Add player to game with enhanced logging
app.post('/api/games/:id/players', async (req, res) => {
  console.log(`[ADD PLAYER] 👤 Player signup request for game ${req.params.id}`);
  
  try {
    const gameId = req.params.id;
    const game = await getGame(gameId);
    
    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }
    
    const { name, phone, action } = req.body;
    console.log(`[ADD PLAYER] Player: ${name}, Phone: ${phone}, Action: ${action}`);
    
    // Handle "I'm Out" responses
    if (action === 'out') {
      console.log(`[ADD PLAYER] Processing "out" response`);
      
      const playerData = validatePlayerData(name, phone);
      
      if (!game.outPlayers) {
        game.outPlayers = [];
      }
      
      const outPlayer = {
        id: Date.now().toString(36) + Math.random().toString(36).substring(2, 6),
        ...playerData,
        joinedAt: new Date().toISOString()
      };
      
      game.outPlayers.push(outPlayer);
      await saveGame(gameId, game, game.hostToken, game.hostPhone);
      
      let smsResult = null;
      if (playerData.phone) {
        trackSMSAttempt('player_out', `Player: ${name}`);
        
        const gameDate = formatDateForSMS(game.date);
        const gameTime = formatTimeForSMS(game.time);
        
        let locationText = game.location;
        if (game.courtNumber && game.courtNumber.trim()) {
          locationText += ` - ${game.courtNumber}`;
        }
        
        const message = `Thanks for letting us know you can't make the pickleball game at ${locationText} on ${gameDate} at ${gameTime}. We appreciate the heads up!`;
        smsResult = await sendSMS(playerData.phone, message, gameId);
        
        if (smsResult.success) {
          updateSMSStats('success');
        } else {
          updateSMSStats(smsResult.blocked ? 'blocked' : 'error');
        }
      }
      
      console.log(`[ADD PLAYER] ✅ "Out" response processed for ${name}`);
      return res.status(201).json({ 
        action: 'out',
        playerId: outPlayer.id,
        sms: smsResult
      });
    }
    
    // Regular player signup
    const playerData = validatePlayerData(name, phone);
    
    const existingCheck = checkExistingPlayer(game, playerData.phone);
    if (existingCheck.exists) {
      console.log(`[ADD PLAYER] ❌ Player already exists: ${existingCheck.message}`);
      return res.status(400).json({ error: existingCheck.message });
    }
    
    const result = addPlayerToGame(game, playerData);
    await saveGame(gameId, game, game.hostToken, game.hostPhone);
    
    console.log(`[ADD PLAYER] Player added with status: ${result.status}, position: ${result.position}`);
    
    // Send confirmation SMS to the player
    let smsResult = null;
    if (playerData.phone) {
      trackSMSAttempt('player_signup', `${result.status}: ${name}`);
      
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
        if (result.hidePosition || game.registrationMode === 'waitlist') {
          message = `Thanks for signing up for Pickleball at ${locationText} on ${gameDate} at ${gameTime}! The organizer will review applications and select players. You'll be notified if selected. Reply 9 to cancel your application.`;
        } else {
          message = `You've been added to the waitlist for Pickleball at ${locationText}. You are #${result.position} on the waitlist. We'll notify you if a spot opens up! Reply 2 for game details or 9 to cancel.`;
        }
      }
      
      smsResult = await sendSMS(playerData.phone, message, gameId);
      
      if (smsResult.success) {
        updateSMSStats('success');
      } else {
        updateSMSStats(smsResult.blocked ? 'blocked' : 'error');
      }
    }

    // Send organizer notifications with tracking
    if (result.status === 'confirmed') {
      console.log(`[ADD PLAYER] Sending organizer notifications for confirmed player`);
      
      await sendOrganizerNotification(gameId, game, 'playerJoins', playerData.name);
      
      if (game.players.length === parseInt(game.totalPlayers)) {
        await sendOrganizerNotification(gameId, game, 'gameFull');
      } else if (game.players.length === parseInt(game.totalPlayers) - 1) {
        if (!game.notificationPreferences?.playerJoins) {
          await sendOrganizerNotification(gameId, game, 'oneSpotLeft');
        }
      }
    } else if (result.status === 'waitlist') {
      if ((game.waitlist || []).length === 1) {
        await sendOrganizerNotification(gameId, game, 'waitlistStarts', playerData.name);
      }
    }

    console.log(`[ADD PLAYER] ✅ Player signup complete for ${name}`);
    res.status(201).json({ 
      ...result,
      sms: smsResult
    });
    
  } catch (error) {
    console.error(`[ADD PLAYER] ❌ Error adding player:`, error);
    updateSMSStats('error');
    res.status(500).json({ error: error.message || 'Failed to add player' });
  }
});

// Continue with remaining endpoints...
// [The rest of the endpoints would follow the same pattern with enhanced logging]

// ============================================================================
// SMS WEBHOOK
// ============================================================================

app.post('/api/sms/webhook', express.json(), handleIncomingSMS);

// ============================================================================
// SERVER STARTUP & SHUTDOWN
// ============================================================================

// Log initial SMS status
console.log(`[SMS INIT] 📊 SMS Protection initialized:`);
console.log(`[SMS INIT] Daily limit: ${process.env.SMS_DAILY_LIMIT || 500}`);
console.log(`[SMS INIT] Minute limit: ${process.env.SMS_MINUTE_LIMIT || 10}`);
console.log(`[SMS INIT] Reminder interval: ${REMINDER_INTERVAL} minutes`);

// Graceful shutdown handlers
process.on('SIGINT', async () => {
  console.log('\n[SHUTDOWN] 🛑 Graceful shutdown initiated...');
  
  const finalStats = getSMSMonitorStats();
  console.log(`[SHUTDOWN] Final SMS stats:`, finalStats);
  
  console.log('[SHUTDOWN] Closing database connection...');
  await closeDatabaseConnection();
  
  console.log('[SHUTDOWN] ✅ Shutdown complete');
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n[SHUTDOWN] 🛑 SIGTERM received, shutting down...');
  
  const finalStats = getSMSMonitorStats();
  console.log(`[SHUTDOWN] Final SMS stats:`, finalStats);
  
  await closeDatabaseConnection();
  process.exit(0);
});

// Start the server
app.listen(PORT, () => {
  console.log(`[SERVER] 🚀 Server running on port ${PORT}`);
  console.log(`[SERVER] 🌐 Visit http://localhost:${PORT} to view your app`);
  console.log(`[SERVER] 📊 SMS monitoring: http://localhost:${PORT}/api/sms/status`);
  console.log(`[SERVER] 🏥 Health check: http://localhost:${PORT}/api/health`);
});