// sms-handler.js - All SMS-related functions - FINAL PRODUCTION VERSION
const { 
  getAllGames, 
  getGameHostInfo, 
  saveGame,
  saveLastCommand,
  getLastCommand,
  clearLastCommand
} = require('./database');

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

// Helper function to check if a game date is today or in the future
function isGameUpcoming(gameDate) {
  const today = new Date();
  const game = new Date(gameDate);
  
  // Set both dates to start of day for fair comparison
  today.setHours(0, 0, 0, 0);
  game.setHours(0, 0, 0, 0);
  
  return game >= today;
}

// SMS sending function
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
      params.webhookData = gameId;
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

// Main SMS webhook handler
async function handleIncomingSMS(req, res) {
  try {
    const { fromNumber, text, data: gameId } = req.body;
    
    console.log(`Received SMS from ${fromNumber}: "${text}" for game ${gameId}`);
    
    const cleanedFromNumber = formatPhoneNumber(fromNumber);
    const messageText = text.trim();
    const lastCommand = await getLastCommand(cleanedFromNumber);

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
      await sendSMS(fromNumber, `Reply 1 for host management, 2 for your game details, or 9 to cancel a spot. If you need anything else, reach out to the organizer.`);
      await clearLastCommand(cleanedFromNumber);
    }
    
    res.json({ success: true });
    
  } catch (error) {
    console.error('Error handling incoming SMS:', error);
    res.json({ success: true, message: "Error processing webhook, please try again or contact support." });
  }
}

// Handle numbered responses (1, 2, 3, etc.)
async function handleNumberResponse(fromNumber, cleanedFromNumber, messageText, lastCommand) {
  const selection = parseInt(messageText) - 1;
  
  if (lastCommand === 'details_selection') {
    await handleGameDetailsSelection(fromNumber, cleanedFromNumber, selection);
  } else if (lastCommand === 'cancellation_selection') {
    await handleCancellationSelection(fromNumber, cleanedFromNumber, selection);
  } else {
    await clearLastCommand(cleanedFromNumber);
    await sendSMS(fromNumber, `Reply "1" for management link, "2" for game details, or "9" to cancel your reservation.`);
  }
}

async function handleManagementLinkRequest(fromNumber, cleanedFromNumber) {
  try {
    const allGames = await getAllGames();
    const hostGames = await getUserHostGames(cleanedFromNumber, allGames);
    
    console.log(`[SMS] User ${cleanedFromNumber} has ${hostGames.length} host games`);
    console.log(`[SMS DEBUG] Host games found:`, hostGames.map(g => `${g.game.location}`));
    
    if (hostGames.length === 0) {
      await sendSMS(fromNumber, `Sorry, we couldn't find any upcoming games that you're hosting.`);
    } else if (hostGames.length === 1) {
      console.log(`[SMS] Sending single management link for: ${hostGames[0].game.location}`);
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
      console.log(`[SMS] User has ${hostGames.length} host games, sending all links`);
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
      
      // Check message length and truncate if needed
      if (responseMessage.length > 1500) {
        console.log(`[SMS DEBUG] Message too long (${responseMessage.length} chars), sending shortened version`);
        responseMessage = `You have ${hostGames.length} upcoming games. Please visit the website to manage them.`;
      }
      
      await sendSMS(fromNumber, responseMessage);
    }
  } catch (error) {
    console.error('Error in handleManagementLinkRequest:', error);
    await sendSMS(fromNumber, `Sorry, there was an error retrieving your management links. Please try again.`);
  }
}

// Handle game details selection
async function handleGameDetailsSelection(fromNumber, cleanedFromNumber, selection) {
  try {
    const allGames = await getAllGames();
    const userGames = await getUserGames(cleanedFromNumber, allGames);
    
    if (selection >= 0 && selection < userGames.length) {
      const { game, role } = userGames[selection];
      const responseMessage = await buildGameDetailsMessage(game, role, cleanedFromNumber);
      await sendSMS(fromNumber, responseMessage);
      await clearLastCommand(cleanedFromNumber);
    } else {
      await sendSMS(fromNumber, `Invalid game number. Please reply with a number from 1 to ${userGames.length}, or text "2" to see the list again.`);
    }
  } catch (error) {
    console.error('Error in handleGameDetailsSelection:', error);
    await clearLastCommand(cleanedFromNumber);
    await sendSMS(fromNumber, `Sorry, there was an error. Please text "2" to try again.`);
  }
}

// Handle cancellation selection
async function handleCancellationSelection(fromNumber, cleanedFromNumber, selection) {
  try {
    const allGames = await getAllGames();
    const playerGames = await getPlayerGames(cleanedFromNumber, allGames);
    
    if (selection >= 0 && selection < playerGames.length) {
      const { id, game, player, status } = playerGames[selection];
      await cancelPlayerFromGame(id, game, player, status, fromNumber);
      await clearLastCommand(cleanedFromNumber);
    } else {
      await sendSMS(fromNumber, `Invalid selection. Please reply with a valid number from the list or text "9" to try cancelling again.`);
      await clearLastCommand(cleanedFromNumber);
    }
  } catch (error) {
    console.error('Error in handleCancellationSelection:', error);
    await clearLastCommand(cleanedFromNumber);
    await sendSMS(fromNumber, `Sorry, there was an error. Please text "9" to try again.`);
  }
}

// Handle management link requests (command "1")
async function getUserHostGames(cleanedFromNumber, allGames) {
  const gameEntries = Object.entries(allGames);
  console.log(`[SMS DEBUG] Checking ${gameEntries.length} total games for host privileges for user ${cleanedFromNumber}`);
  
  // Pre-fetch all host info in parallel for efficiency
  const hostInfoPromises = gameEntries.map(async ([id, game]) => {
    try {
      const hostInfo = await getGameHostInfo(id);
      return { id, hostInfo };
    } catch (error) {
      console.error(`Error getting host info for game ${id}:`, error);
      return { id, hostInfo: null };
    }
  });
  
  const allHostInfo = await Promise.all(hostInfoPromises);
  const hostInfoMap = new Map(allHostInfo.map(({ id, hostInfo }) => [id, hostInfo]));
  
  const hostGames = [];
  
  for (const [id, game] of gameEntries) {
    // Only check upcoming games
    if (!isGameUpcoming(game.date)) {
      console.log(`[SMS DEBUG] Skipping past game: ${game.location} on ${game.date}`);
      continue;
    }
    
    const hostInfo = hostInfoMap.get(id);
    if (hostInfo && hostInfo.phone === cleanedFromNumber) {
      console.log(`[SMS DEBUG] ✅ User is host of game ${id}: ${game.location}`);
      hostGames.push({ id, game, hostInfo });
    } else {
      console.log(`[SMS DEBUG] ❌ User is NOT host of game ${id}: ${game.location}`);
    }
  }
  
  console.log(`[SMS DEBUG] Final result: ${hostGames.length} host games for user ${cleanedFromNumber}`);
  return hostGames;
}

// Handle game details requests (command "2")
async function handleGameDetailsRequest(fromNumber, cleanedFromNumber) {
  try {
    const allGames = await getAllGames();
    const userGames = await getUserGames(cleanedFromNumber, allGames);
    
    console.log(`[SMS] User ${cleanedFromNumber} has ${userGames.length} upcoming games`);
    console.log(`[SMS DEBUG] Games found:`, userGames.map(g => `${g.game.location} (${g.role})`));
    
    if (userGames.length === 0) {
      await sendSMS(fromNumber, `You don't have any upcoming games registered to this phone number.`);
    } else if (userGames.length === 1) {
      // FIXED: Only show single game details if truly one game
      console.log(`[SMS] Showing details for single game: ${userGames[0].game.location}`);
      const { game, role } = userGames[0];
      
      // Check if this is a waitlist mode game and user is not host
      if (game.registrationMode === 'waitlist' && role !== 'host' && role === 'waitlist') {
        await sendSMS(fromNumber, `Your application for the pickleball game is under review. You'll be notified if selected. Reply 9 to cancel your application.`);
      } else {
        const responseMessage = await buildGameDetailsMessage(game, role, cleanedFromNumber);
        await sendSMS(fromNumber, responseMessage);
      }
    } else {
      // FIXED: Always show list first for multiple games - this should be the behavior you want
      console.log(`[SMS] User has ${userGames.length} games, showing selection list`);
      await saveLastCommand(cleanedFromNumber, 'details_selection');
      const responseMessage = await buildGameListMessage(userGames);
      await sendSMS(fromNumber, responseMessage);
    }
  } catch (error) {
    console.error('Error in handleGameDetailsRequest:', error);
    await sendSMS(fromNumber, `Sorry, there was an error retrieving your game details. Please try again.`);
  }
}


// Handle cancellation requests (command "9")
async function handleCancellationRequest(fromNumber, cleanedFromNumber) {
  try {
    const allGames = await getAllGames();
    const playerGames = await getPlayerGames(cleanedFromNumber, allGames);
    
    if (playerGames.length === 0) {
      await sendSMS(fromNumber, `We couldn't find any upcoming game registrations for your number.`);
    } else if (playerGames.length === 1) {
      const { id, game, player, status } = playerGames[0];
      await cancelPlayerFromGame(id, game, player, status, fromNumber);
    } else {
      const responseMessage = await buildCancellationListMessage(playerGames);
      await sendSMS(fromNumber, responseMessage);
      await saveLastCommand(cleanedFromNumber, 'cancellation_selection');
    }
  } catch (error) {
    console.error('Error in handleCancellationRequest:', error);
    await sendSMS(fromNumber, `Sorry, there was an error processing your cancellation request. Please try again.`);
  }
}

// Helper function to get user's games - OPTIMIZED VERSION
async function getUserGames(cleanedFromNumber, allGames) {
  const gameEntries = Object.entries(allGames);
  console.log(`[SMS DEBUG] Checking ${gameEntries.length} total games for user ${cleanedFromNumber}`);
  
  // Pre-fetch all host info in parallel for efficiency
  const hostInfoPromises = gameEntries.map(async ([id, game]) => {
    try {
      const hostInfo = await getGameHostInfo(id);
      return { id, hostInfo };
    } catch (error) {
      console.error(`Error getting host info for game ${id}:`, error);
      return { id, hostInfo: null };
    }
  });
  
  const allHostInfo = await Promise.all(hostInfoPromises);
  const hostInfoMap = new Map(allHostInfo.map(({ id, hostInfo }) => [id, hostInfo]));
  
  const userGames = [];
  
  for (const [id, game] of gameEntries) {
    // Only check upcoming games
    if (!isGameUpcoming(game.date)) {
      console.log(`[SMS DEBUG] Skipping past game: ${game.location} on ${game.date}`);
      continue;
    }
    
    let userRole = null;
    
    // Check confirmed players
    const playerInConfirmed = game.players.find(p => p.phone === cleanedFromNumber);
    if (playerInConfirmed) {
      userRole = playerInConfirmed.isOrganizer ? 'host' : 'confirmed';
      console.log(`[SMS DEBUG] Found user in confirmed players: ${game.location} (${userRole})`);
    }
    
    // Check waitlist
    if (!userRole) {
      const playerInWaitlist = (game.waitlist || []).find(p => p.phone === cleanedFromNumber);
      if (playerInWaitlist) {
        userRole = 'waitlist';
        console.log(`[SMS DEBUG] Found user in waitlist: ${game.location} (${userRole})`);
      }
    }
    
    // Check if they're the host
    if (!userRole) {
      const hostInfo = hostInfoMap.get(id);
      if (hostInfo && hostInfo.phone === cleanedFromNumber) {
        userRole = 'host';
        console.log(`[SMS DEBUG] Found user as host: ${game.location} (${userRole})`);
      }
    }
    
    if (userRole) {
      userGames.push({ id, game, role: userRole });
    } else {
      console.log(`[SMS DEBUG] User not found in game: ${game.location}`);
    }
  }
  
  console.log(`[SMS DEBUG] Final result: ${userGames.length} games for user ${cleanedFromNumber}`);
  return userGames;
}

// Helper function to get player's games (for cancellation)
async function getPlayerGames(cleanedFromNumber, allGames) {
  const playerGames = [];
  
  for (const [id, game] of Object.entries(allGames)) {
    if (!isGameUpcoming(game.date)) {
      continue;
    }
    
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
  
  return playerGames;
}

// Update buildGameDetailsMessage function in sms-handler.js
// 1. Fix buildGameDetailsMessage function
async function buildGameDetailsMessage(game, role, cleanedFromNumber) {
  const gameDate = formatDateForSMS(game.date);
  const gameTime = formatTimeForSMS(game.time);
  
  let locationText = game.location;
  if (game.courtNumber && game.courtNumber.trim()) {
    locationText += ` - ${game.courtNumber}`;
  }
  
  let responseMessage = `🏓 ${locationText}\n📅 ${gameDate} at ${gameTime}\n⏱️ Duration: ${game.duration} minutes\n\n`;
  
  // Only show player details if NOT in waitlist mode OR if user is the host
  if (game.registrationMode !== 'waitlist' || role === 'host') {
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
      
      // Check if game is in waitlist mode
      if (game.registrationMode === 'waitlist') {
        responseMessage += `• Applications under review\n`;
      } else {
        game.waitlist.forEach((player, index) => {
          responseMessage += `• ${player.name} (#${index + 1})\n`;
        });
      }
    }
  } else {
    // Waitlist mode - hide player info from non-hosts
    responseMessage += `👥 Player selection in progress\n`;
    responseMessage += `The organizer will review all applications and select players.\n`;
  }
  
  if (role === 'host') {
    responseMessage += `\nYou are: 🎯 Host/Organizer\nReply "1" for management link`;
  } else if (role === 'confirmed') {
    responseMessage += `\nYou are: ✅ Confirmed Player\nReply "9" to cancel`;
  } else if (role === 'waitlist') {
    if (game.registrationMode === 'waitlist') {
      responseMessage += `\nYou are: ⏳ Application Submitted\nReply "9" to cancel application`;
    } else {
      const waitlistPosition = game.waitlist.findIndex(p => p.phone === cleanedFromNumber) + 1;
      responseMessage += `\nYou are: ⏳ Waitlist #${waitlistPosition}\nReply "9" to cancel`;
    }
  }
  
  return responseMessage;
}

// Helper function to build game list message
async function buildGameListMessage(userGames) {
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
    
let locationText = game.location;
if (game.courtNumber && game.courtNumber.trim()) {
    locationText += ` - ${game.courtNumber}`;
}
responseMessage += `${index + 1}. ${statusIcon} ${locationText}${roleText}\n${gameDate} at ${gameTime}\n\n`;  });
  
  return responseMessage;
}

// Helper function to build cancellation list message
async function buildCancellationListMessage(playerGames) {
  let responseMessage = `You're registered for ${playerGames.length} upcoming games. Reply with the number of the game you want to cancel:\n\n`;
  
  playerGames.forEach(({ game, status }, index) => {
    const gameDate = formatDateForSMS(game.date);
    const gameTime = formatTimeForSMS(game.time);
    const statusText = status === 'confirmed' ? 'Confirmed' : 'Waitlist';
    
let locationText = game.location;
if (game.courtNumber && game.courtNumber.trim()) {
    locationText += ` - ${game.courtNumber}`;
}
responseMessage += `${index + 1}. ${locationText}\n${gameDate} at ${gameTime} (${statusText})\n\n`;  });
  
  return responseMessage;
}

// Helper function to cancel player from game
// Update cancelPlayerFromGame function in sms-handler.js
async function cancelPlayerFromGame(gameId, game, player, status, fromNumber) {
  try {
    if (status === 'confirmed') {
      const playerIndex = game.players.findIndex(p => p.id === player.id);
      game.players.splice(playerIndex, 1);
      
      if (game.waitlist && game.waitlist.length > 0) {
        const promotedPlayer = game.waitlist.shift();
        game.players.push(promotedPlayer);
        
        const gameDate = formatDateForSMS(game.date);
        const gameTime = formatTimeForSMS(game.time);
        let locationText = game.location;
        if (game.courtNumber && game.courtNumber.trim()) {
          locationText += ` - ${game.courtNumber}`;
        }
        
        // Different promotion message based on game mode
        let promotionMessage;
        if (game.registrationMode === 'waitlist') {
          promotionMessage = `Good news! You've been selected for Pickleball at ${locationText} on ${gameDate} at ${gameTime}! Reply 9 to cancel if needed.`;
        } else {
          promotionMessage = `Good news! You've been selected for Pickleball at ${locationText} on ${gameDate} at ${gameTime}! Reply 2 for game details or 9 to cancel.`;
        }
        await sendSMS(promotedPlayer.phone, promotionMessage, gameId);
      }
    } else {
      const waitlistIndex = game.waitlist.findIndex(p => p.id === player.id);
      game.waitlist.splice(waitlistIndex, 1);
    }
    
    await saveGame(gameId, game, game.hostToken, game.hostPhone);
    
    const gameDate = formatDateForSMS(game.date);
    const gameTime = formatTimeForSMS(game.time);
    let locationText = game.location;
    if (game.courtNumber && game.courtNumber.trim()) {
      locationText += ` - ${game.courtNumber}`;
    }
    
    // Different message based on status and game mode
    let statusText;
    if (status === 'confirmed') {
      statusText = 'reservation';
    } else {
      // Check if waitlist mode
      statusText = (game.registrationMode === 'waitlist') ? 'application' : 'waitlist spot';
    }
    
    await sendSMS(fromNumber, `Your pickleball ${statusText} at ${locationText} on ${gameDate} at ${gameTime} has been cancelled. Thanks for letting us know!`);
  } catch (error) {
    console.error('Error cancelling player from game:', error);
    await sendSMS(fromNumber, `Sorry, there was an error cancelling your registration. Please try again or contact the organizer.`);
  }
}

module.exports = {
  sendSMS,
  handleIncomingSMS,
  formatPhoneNumber,
  formatDateForSMS,
  formatTimeForSMS
};