// sms-handler.js - PROTECTED VERSION with comprehensive logging and safeguards
const { 
  getAllGames, 
  getGameHostInfo, 
  saveGame,
  saveLastCommand,
  getLastCommand,
  clearLastCommand
} = require('./database');

// ============================================================================
// SMS PROTECTION & MONITORING SYSTEM
// ============================================================================

// Global SMS tracking and protection
const SMS_PROTECTION = {
  // Rate limiting: phone number -> array of timestamps
  rateLimits: new Map(),
  
  // Daily counters
  dailyCount: 0,
  dailyLimit: parseInt(process.env.SMS_DAILY_LIMIT) || 2000, // Default 2000/day
  dailyDate: new Date().toDateString(),
  
  // Per-minute tracking
  minuteCount: 0,
  minuteLimit: parseInt(process.env.SMS_MINUTE_LIMIT) || 10, // Default 10/minute
  minuteStart: Date.now(),
  
  // Total session counter
  sessionCount: 0,
  
  // Emergency brake
  emergencyStop: false,
  
  // Suspicious pattern detection
  suspiciousPatterns: new Map() // phone -> count in last hour
};

// Check and update daily counter
function checkDailyReset() {
  const today = new Date().toDateString();
  if (SMS_PROTECTION.dailyDate !== today) {
    console.log(`[SMS PROTECTION] 🔄 Daily reset: Previous day had ${SMS_PROTECTION.dailyCount} SMS sent`);
    SMS_PROTECTION.dailyCount = 0;
    SMS_PROTECTION.dailyDate = today;
  }
}

// Check and update minute counter
function checkMinuteReset() {
  const now = Date.now();
  const minutesPassed = Math.floor((now - SMS_PROTECTION.minuteStart) / 60000);
  
  if (minutesPassed >= 1) {
    if (SMS_PROTECTION.minuteCount > 0) {
      console.log(`[SMS PROTECTION] ⏱️ Minute reset: Previous minute had ${SMS_PROTECTION.minuteCount} SMS sent`);
    }
    SMS_PROTECTION.minuteCount = 0;
    SMS_PROTECTION.minuteStart = now;
  }
}

// Rate limiting check (max 1 SMS per phone per 30 seconds)
function checkRateLimit(phoneNumber) {
  const now = Date.now();
  const phoneHistory = SMS_PROTECTION.rateLimits.get(phoneNumber) || [];
  
  // Remove entries older than 30 seconds
  const recent = phoneHistory.filter(timestamp => (now - timestamp) < 30000);
  
  if (recent.length > 0) {
    const lastSent = Math.max(...recent);
    const secondsAgo = Math.floor((now - lastSent) / 1000);
    console.log(`[SMS PROTECTION] ⚠️ Rate limit triggered for ${phoneNumber} (last SMS ${secondsAgo}s ago)`);
    return false;
  }
  
  // Update history
  recent.push(now);
  SMS_PROTECTION.rateLimits.set(phoneNumber, recent);
  return true;
}

// Suspicious pattern detection
function checkSuspiciousPatterns(phoneNumber) {
  const now = Date.now();
  const hourAgo = now - (60 * 60 * 1000);
  
  // Get or create pattern tracking for this phone
  const patterns = SMS_PROTECTION.suspiciousPatterns.get(phoneNumber) || [];
  
  // Remove entries older than 1 hour
  const recentPatterns = patterns.filter(timestamp => timestamp > hourAgo);
  
  // Add current attempt
  recentPatterns.push(now);
  SMS_PROTECTION.suspiciousPatterns.set(phoneNumber, recentPatterns);
  
  // Check if suspicious (more than 20 SMS in 1 hour to same number)
  if (recentPatterns.length > 20) {
    console.log(`[SMS PROTECTION] 🚨 SUSPICIOUS PATTERN: ${recentPatterns.length} SMS to ${phoneNumber} in last hour`);
    return true;
  }
  
  return false;
}

// Check all protection systems
function checkAllProtections(phoneNumber) {
  checkDailyReset();
  checkMinuteReset();
  
  // Emergency stop check
  if (SMS_PROTECTION.emergencyStop) {
    return { allowed: false, reason: 'Emergency stop activated' };
  }
  
  // Daily limit check
  if (SMS_PROTECTION.dailyCount >= SMS_PROTECTION.dailyLimit) {
    console.log(`[SMS PROTECTION] 🛑 DAILY LIMIT REACHED: ${SMS_PROTECTION.dailyCount}/${SMS_PROTECTION.dailyLimit}`);
    return { allowed: false, reason: `Daily limit reached (${SMS_PROTECTION.dailyLimit})` };
  }
  
  // Per-minute limit check
  if (SMS_PROTECTION.minuteCount >= SMS_PROTECTION.minuteLimit) {
    console.log(`[SMS PROTECTION] 🛑 MINUTE LIMIT REACHED: ${SMS_PROTECTION.minuteCount}/${SMS_PROTECTION.minuteLimit}`);
    return { allowed: false, reason: `Per-minute limit reached (${SMS_PROTECTION.minuteLimit})` };
  }
  
  // Rate limiting check
  if (!checkRateLimit(phoneNumber)) {
    return { allowed: false, reason: 'Rate limited (30 second cooldown per phone)' };
  }
  
  // Suspicious pattern check
  if (checkSuspiciousPatterns(phoneNumber)) {
    return { allowed: false, reason: 'Suspicious pattern detected (too many SMS to same number)' };
  }
  
  return { allowed: true };
}

// Update protection counters after successful send
function updateProtectionCounters() {
  SMS_PROTECTION.dailyCount++;
  SMS_PROTECTION.minuteCount++;
  SMS_PROTECTION.sessionCount++;
  
  // Log milestone warnings
  if (SMS_PROTECTION.dailyCount % 50 === 0) {
    console.log(`[SMS PROTECTION] ⚠️ Daily SMS count: ${SMS_PROTECTION.dailyCount}/${SMS_PROTECTION.dailyLimit}`);
  }
  
  if (SMS_PROTECTION.sessionCount % 100 === 0) {
    console.log(`[SMS PROTECTION] 📊 Session SMS count: ${SMS_PROTECTION.sessionCount} total sent`);
  }
}

// Get protection status for logging
// Change this function to return the format the dashboard expects:
function getProtectionStatus() {
  return {
    daily: `${SMS_PROTECTION.dailyCount}/${SMS_PROTECTION.dailyLimit}`,  // ← Add this format
    minute: `${SMS_PROTECTION.minuteCount}/${SMS_PROTECTION.minuteLimit}`, // ← Add this format
    session: SMS_PROTECTION.sessionCount,
    emergencyStop: SMS_PROTECTION.emergencyStop
  };
}

// Emergency stop function (can be called externally)
function activateEmergencyStop() {
  SMS_PROTECTION.emergencyStop = true;
  console.log(`[SMS PROTECTION] 🚨 EMERGENCY STOP ACTIVATED! All SMS sending halted.`);
}

function deactivateEmergencyStop() {
  SMS_PROTECTION.emergencyStop = false;
  console.log(`[SMS PROTECTION] ✅ Emergency stop deactivated. SMS sending resumed.`);
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

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

function isGameUpcoming(gameDate) {
  const today = new Date();
  const game = new Date(gameDate);
  today.setHours(0, 0, 0, 0);
  game.setHours(0, 0, 0, 0);
  return game >= today;
}

// ============================================================================
// ENHANCED SMS SENDING FUNCTION
// ============================================================================

// Add this new function before sendSMS
async function checkTextBeltQuota() {
  try {
    if (!process.env.TEXTBELT_API_KEY) {
      return { success: false, reason: 'No API key in dev mode' };
    }
    
    const response = await fetch(`https://textbelt.com/quota/${process.env.TEXTBELT_API_KEY}`);
    const data = await response.json();
    
    return {
      success: true,
      quotaRemaining: data.quotaRemaining || 0,
      quotaUsed: data.quotaUsed || 0
    };
  } catch (error) {
    console.log(`[QUOTA CHECK] ❌ Failed to check TextBelt quota: ${error.message}`);
    return { success: false, error: error.message };
  }
}

async function sendSMS(to, message, gameId = null) {
  const startTime = Date.now();
  const cleanedTo = formatPhoneNumber(to);
  const protection = getProtectionStatus();
  
  // Enhanced logging - BEFORE sending
  console.log(`[SMS REQUEST] ==========================================`);
  console.log(`[SMS REQUEST] 📱 To: ${cleanedTo}`);
  console.log(`[SMS REQUEST] 🎮 Game ID: ${gameId || 'N/A'}`);
  console.log(`[SMS REQUEST] 📝 Message length: ${message.length} chars`);
  console.log(`[SMS REQUEST] 📊 Protection status: Daily ${protection.daily}, Minute ${protection.minute}, Session ${protection.session}`);
  console.log(`[SMS REQUEST] 💬 Message preview: "${message.substring(0, 100)}${message.length > 100 ? '...' : ''}"`);

  const quotaCheck = await checkTextBeltQuota();
if (quotaCheck.success) {
  console.log(`[SMS REQUEST] 💰 TextBelt quota: ${quotaCheck.quotaRemaining} remaining, ${quotaCheck.quotaUsed || 'Unknown'} used`);
} else {
  console.log(`[SMS REQUEST] 💰 TextBelt quota: ${quotaCheck.reason || quotaCheck.error}`);
}
  
  try {
    // Check all protection systems
    const protectionCheck = checkAllProtections(cleanedTo);
    
    if (!protectionCheck.allowed) {
      console.log(`[SMS BLOCKED] ❌ ${protectionCheck.reason}`);
      console.log(`[SMS BLOCKED] Protection status: ${JSON.stringify(protection)}`);
      console.log(`[SMS BLOCKED] ==========================================`);
      return { 
        success: false, 
        error: protectionCheck.reason,
        blocked: true,
        protection: protection
      };
    }
    
    // Development mode check
    if (!process.env.TEXTBELT_API_KEY) {
      console.log(`[SMS DEV] 🔧 Development mode - SMS simulated`);
      console.log(`[SMS DEV] ==========================================`);
      
      // Still update counters in dev mode for testing
      updateProtectionCounters();
      
      return { 
        success: true, 
        dev: true,
        protection: getProtectionStatus()
      };
    }
    
    // Prepare TextBelt parameters
    const params = {
      phone: cleanedTo,
      message: message,
      key: process.env.TEXTBELT_API_KEY
    };
    
    if (gameId) {
      params.replyWebhookUrl = `${process.env.BASE_URL || 'https://your-domain.com'}/api/sms/webhook`;
      params.webhookData = gameId;
    }
    
    console.log(`[SMS SEND] 🚀 Sending to TextBelt...`);
    
    // Send to TextBelt
    const response = await fetch('https://textbelt.com/text', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(params)
    });

    const result = await response.json();
    const endTime = Date.now();
    const duration = endTime - startTime;
    
    if (result.success) {
      // Update protection counters
      updateProtectionCounters();
      const newProtection = getProtectionStatus();
      
      console.log(`[SMS SUCCESS] ✅ SMS sent successfully!`);
      console.log(`[SMS SUCCESS] 🆔 TextBelt ID: ${result.textId}`);
      console.log(`[SMS SUCCESS] ⏱️ Duration: ${duration}ms`);
      console.log(`[SMS SUCCESS] 📊 Updated counts: Daily ${newProtection.daily}, Session ${newProtection.session}`);
      console.log(`[SMS SUCCESS] 💰 Estimated remaining credits: ${result.quotaRemaining || 'Unknown'}`);
      console.log(`[SMS SUCCESS] ==========================================`);
      
      return { 
        success: true, 
        textId: result.textId,
        quotaRemaining: result.quotaRemaining,
        duration: duration,
        protection: newProtection
      };
    } else {
      console.log(`[SMS ERROR] ❌ TextBelt error: ${result.error}`);
      console.log(`[SMS ERROR] 💰 Quota remaining: ${result.quotaRemaining || 'Unknown'}`);
      console.log(`[SMS ERROR] ⏱️ Duration: ${duration}ms`);
      console.log(`[SMS ERROR] Protection status: ${JSON.stringify(protection)}`);
      console.log(`[SMS ERROR] ==========================================`);
      
      return { 
        success: false, 
        error: result.error,
        quotaRemaining: result.quotaRemaining,
        duration: duration,
        protection: protection
      };
    }
  } catch (error) {
    const endTime = Date.now();
    const duration = endTime - startTime;
    
    console.log(`[SMS EXCEPTION] 💥 SMS sending failed with exception:`);
    console.log(`[SMS EXCEPTION] Error: ${error.message}`);
    console.log(`[SMS EXCEPTION] Duration: ${duration}ms`);
    console.log(`[SMS EXCEPTION] Protection status: ${JSON.stringify(protection)}`);
    console.log(`[SMS EXCEPTION] ==========================================`);
    
    return { 
      success: false, 
      error: error.message,
      exception: true,
      duration: duration,
      protection: protection
    };
  }
}

// ============================================================================
// SMS WEBHOOK HANDLER (Enhanced with protection)
// ============================================================================

async function handleIncomingSMS(req, res) {
  const requestTime = Date.now();
  console.log(`[SMS WEBHOOK] 📨 Incoming SMS webhook received`);
  console.log(`[SMS WEBHOOK] Headers: ${JSON.stringify(req.headers, null, 2)}`);
  console.log(`[SMS WEBHOOK] Body: ${JSON.stringify(req.body, null, 2)}`);
  
  try {
    const { fromNumber, text, data: gameId } = req.body;
    
    if (!fromNumber || !text) {
      console.log(`[SMS WEBHOOK] ❌ Missing required fields: fromNumber=${fromNumber}, text=${text}`);
      return res.json({ success: false, error: 'Missing required fields' });
    }
    
    const cleanedFromNumber = formatPhoneNumber(fromNumber);
    const messageText = text.trim();
    
    console.log(`[SMS WEBHOOK] 📱 From: ${cleanedFromNumber}`);
    console.log(`[SMS WEBHOOK] 💬 Message: "${messageText}"`);
    console.log(`[SMS WEBHOOK] 🎮 Game ID: ${gameId || 'N/A'}`);
    
    // Get last command for this user
    const lastCommand = await getLastCommand(cleanedFromNumber);
    console.log(`[SMS WEBHOOK] 📋 Last command: ${lastCommand || 'None'}`);
    
    // Protection check before processing
    const protectionCheck = checkAllProtections(cleanedFromNumber);
    if (!protectionCheck.allowed) {
      console.log(`[SMS WEBHOOK] 🛑 Response blocked by protection: ${protectionCheck.reason}`);
      return res.json({ success: true, message: 'Response blocked by protection system' });
    }

    // Handle numbered responses first when we're expecting them
    if (/^\d+$/.test(messageText) && lastCommand) {
      await handleNumberResponse(fromNumber, cleanedFromNumber, messageText, lastCommand);
    } 
    // Handle primary commands
    else if (messageText === '1') {
      await clearLastCommand(cleanedFromNumber);
      await handleManagementLinkRequest(fromNumber, cleanedFromNumber);
    } 
    else if (messageText === '2') {
      await clearLastCommand(cleanedFromNumber);
      await handleGameDetailsRequest(fromNumber, cleanedFromNumber);
    } 
    else if (messageText === '9') {
      await clearLastCommand(cleanedFromNumber);
      await handleCancellationRequest(fromNumber, cleanedFromNumber);
    } 
    // Default response for unrecognized commands
    else {
      console.log(`[SMS WEBHOOK] ❓ Unrecognized command: "${messageText}"`);
      await sendSMS(fromNumber, `Reply 1 for host management, 2 for your game details, or 9 to cancel a spot. If you need anything else, reach out to the organizer.`);
      await clearLastCommand(cleanedFromNumber);
    }
    
    const duration = Date.now() - requestTime;
    console.log(`[SMS WEBHOOK] ✅ Webhook processed successfully in ${duration}ms`);
    res.json({ success: true });
    
  } catch (error) {
    const duration = Date.now() - requestTime;
    console.log(`[SMS WEBHOOK] 💥 Error processing webhook after ${duration}ms:`);
    console.log(`[SMS WEBHOOK] Error: ${error.message}`);
    console.log(`[SMS WEBHOOK] Stack: ${error.stack}`);
    
    res.json({ 
      success: true, 
      message: "Error processing webhook, please try again or contact support.",
      error: error.message
    });
  }
}

// ============================================================================
// WEBHOOK HANDLER FUNCTIONS (keeping existing logic but with better logging)
// ============================================================================

async function handleNumberResponse(fromNumber, cleanedFromNumber, messageText, lastCommand) {
  const selection = parseInt(messageText) - 1;
  console.log(`[SMS HANDLER] 🔢 Number response: ${messageText} (selection: ${selection}) for command: ${lastCommand}`);
  
  if (lastCommand === 'details_selection') {
    await handleGameDetailsSelection(fromNumber, cleanedFromNumber, selection);
  } else if (lastCommand === 'cancellation_selection') {
    await handleCancellationSelection(fromNumber, cleanedFromNumber, selection);
  } else {
    console.log(`[SMS HANDLER] ❓ Unknown last command: ${lastCommand}`);
    await clearLastCommand(cleanedFromNumber);
    await sendSMS(fromNumber, `Reply "1" for management link, "2" for game details, or "9" to cancel your reservation.`);
  }
}

// Continue with all the other handler functions (keeping existing logic but with enhanced logging)...
// [The rest of the functions remain largely the same but with console.log statements added]

async function handleManagementLinkRequest(fromNumber, cleanedFromNumber) {
  console.log(`[SMS HANDLER] 🎯 Management link request from ${cleanedFromNumber}`);
  
  try {
    const allGames = await getAllGames();
    const hostGames = await getUserHostGames(cleanedFromNumber, allGames);
    
    console.log(`[SMS HANDLER] Found ${hostGames.length} host games for ${cleanedFromNumber}`);
    
    if (hostGames.length === 0) {
      await sendSMS(fromNumber, `Sorry, we couldn't find any upcoming games that you're hosting.`);
    } else if (hostGames.length === 1) {
      const { id, game, hostInfo } = hostGames[0];
      const baseUrl = process.env.BASE_URL || 'https://your-domain.com';
      const managementLink = `${baseUrl}/manage.html?id=${id}&token=${hostInfo.hostToken}`;
      const gameDate = formatDateForSMS(game.date);
      const gameTime = formatTimeForSMS(game.time);
      
      let locationText = game.location;
      if (game.courtNumber && game.courtNumber.trim()) {
        locationText += ` - ${game.courtNumber}`;
      }
      
      await sendSMS(fromNumber, `Here's your management link for ${locationText} on ${gameDate} at ${gameTime}: ${managementLink}`);
    } else {
      let responseMessage = `You have ${hostGames.length} upcoming games:\n\n`;
      
      hostGames.forEach(({ id, game, hostInfo }, index) => {
        const baseUrl = process.env.BASE_URL || 'https://your-domain.com';
        const managementLink = `${baseUrl}/manage.html?id=${id}&token=${hostInfo.hostToken}`;
        const gameDate = formatDateForSMS(game.date);
        const gameTime = formatTimeForSMS(game.time);
        
        let locationText = game.location;
        if (game.courtNumber && game.courtNumber.trim()) {
          locationText += ` - ${game.courtNumber}`;
        }
        
        responseMessage += `${index + 1}. ${locationText}\n${gameDate} at ${gameTime}\n${managementLink}\n\n`;
      });
      
      if (responseMessage.length > 1500) {
        console.log(`[SMS HANDLER] ⚠️ Message too long (${responseMessage.length} chars), shortening`);
        responseMessage = `You have ${hostGames.length} upcoming games. Please visit the website to manage them.`;
      }
      
      await sendSMS(fromNumber, responseMessage);
    }
  } catch (error) {
    console.log(`[SMS HANDLER] ❌ Error in handleManagementLinkRequest: ${error.message}`);
    await sendSMS(fromNumber, `Sorry, there was an error retrieving your management links. Please try again.`);
  }
}

// Continue with all remaining functions... (I'll include a few more key ones)

async function handleGameDetailsRequest(fromNumber, cleanedFromNumber) {
  console.log(`[SMS HANDLER] 📋 Game details request from ${cleanedFromNumber}`);
  
  try {
    const allGames = await getAllGames();
    const userGames = await getUserGames(cleanedFromNumber, allGames);
    
    console.log(`[SMS HANDLER] Found ${userGames.length} user games for ${cleanedFromNumber}`);
    
    if (userGames.length === 0) {
      await sendSMS(fromNumber, `You don't have any upcoming games registered to this phone number.`);
    } else if (userGames.length === 1) {
      const { game, role } = userGames[0];
      
      if (game.registrationMode === 'waitlist' && role !== 'host' && role === 'waitlist') {
        await sendSMS(fromNumber, `Your application for the pickleball game is under review. You'll be notified if selected. Reply 9 to cancel your application.`);
      } else {
        const responseMessage = await buildGameDetailsMessage(game, role, cleanedFromNumber);
        await sendSMS(fromNumber, responseMessage);
      }
    } else {
      console.log(`[SMS HANDLER] Multiple games found, showing selection list`);
      await saveLastCommand(cleanedFromNumber, 'details_selection');
      const responseMessage = await buildGameListMessage(userGames);
      await sendSMS(fromNumber, responseMessage);
    }
  } catch (error) {
    console.log(`[SMS HANDLER] ❌ Error in handleGameDetailsRequest: ${error.message}`);
    await sendSMS(fromNumber, `Sorry, there was an error retrieving your game details. Please try again.`);
  }
}

// [Include all the remaining helper functions with enhanced logging...]

// ============================================================================
// EXPORT FUNCTIONS + PROTECTION CONTROLS
// ============================================================================

module.exports = {
  sendSMS,
  handleIncomingSMS,
  formatPhoneNumber,
  formatDateForSMS,
  formatTimeForSMS,
  
  // Protection system controls
  activateEmergencyStop,
  deactivateEmergencyStop,
  getProtectionStatus,
  
  // For monitoring/debugging
  getSMSStats: () => ({
    daily: SMS_PROTECTION.dailyCount,
    session: SMS_PROTECTION.sessionCount,
    limits: {
      daily: SMS_PROTECTION.dailyLimit,
      minute: SMS_PROTECTION.minuteLimit
    },
    emergencyStop: SMS_PROTECTION.emergencyStop
  })
};