// sms-handler.js - All SMS-related functions - FIXED VERSION
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

// Main SMS webhook handler - FIXED VERSION
async function handleIncomingSMS(req, res) {
  try {
    const { fromNumber, text, data: gameId } = req.body;
    
    console.log(`Received SMS from ${fromNumber}: "${text}" for game ${gameId}`);
    
    const cleanedFromNumber = formatPhoneNumber(fromNumber);
    const messageText = text.trim();
    const lastCommand = await getLastCommand(cleanedFromNumber);

    console.log(`[SMS] Last command for ${cleanedFromNumber}: ${lastCommand}`);

    // Handle numbered responses first (1, 2, 3, etc.) when we're expecting them
    if (/^\d+$/.test(messageText) && lastCommand) {
      await handleNumberResponse(fromNumber, cleanedFromNumber, messageText, lastCommand);
    } 
    // Handle primary commands
    else if (messageText === '1') {
      await clearLastCommand(cleanedFromNumber); // Clear any pending state
      await handleManagementLinkRequest(fromNumber, cleanedFromNumber);
    } 
    else if (messageText === '2') {
      await clearLastCommand(cleanedFromNumber); // Clear any pending state first
      await handleGameDetailsRequest(fromNumber, cleanedFromNumber);
    } 
    else if (messageText === '9') {
      await clearLastCommand(cleanedFromNumber); // Clear any pending state
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

// Handle numbered responses (1, 2, 3, etc.) - FIXED VERSION
async function handleNumberResponse(fromNumber, cleanedFromNumber, messageText, lastCommand) {
  const selection = parseInt(messageText) - 1;
  
  console.log(`[SMS] Handling number response: ${messageText} (index: ${selection}) for command: ${lastCommand}`);
  
  if (lastCommand === 'details_selection') {
    await handleGameDetailsSelection(fromNumber, cleanedFromNumber, selection);
  } else if (lastCommand === 'cancellation_selection') {
    await handleCancellationSelection(fromNumber, cleanedFromNumber, selection);
  } else {
    // Invalid state - clear and give help
    console.log(`[SMS] Invalid command state: ${lastCommand}`);
    await clearLastCommand(cleanedFromNumber);
    await sendSMS(fromNumber, `Reply "1" for management link, "2" for game details, or "9" to cancel your reservation.`);
  }
}

// Handle game details selection - ENHANCED VERSION
async function handleGameDetailsSelection(fromNumber, cleanedFromNumber, selection) {
  try {
    const allGames = await getAllGames();
    const userGames = await getUserGames(cleanedFromNumber, allGames);
    
    console.log(`[SMS] Game selection ${selection + 1} of ${userGames.length} games`);
    
    if (selection >= 0 && selection < userGames.length) {
      const { game, role } = userGames[selection];
      const responseMessage = await buildGameDetailsMessage(game, role, cleanedFromNumber);
      await sendSMS(fromNumber, responseMessage);
      await clearLastCommand(cleanedFromNumber);
    } else {
      console.log(`[SMS] Invalid selection: ${selection + 1}, valid range: 1-${userGames.length}`);
      // Don't clear the command - let them try again
      await sendSMS(fromNumber, `Invalid game number. Please reply with a number from 1 to ${userGames.length}, or text "2" to see the list again.`);
    }
  } catch (error) {
    console.error('[SMS] Error in handleGameDetailsSelection:', error);
    await clearLastCommand(cleanedFromNumber);
    await sendSMS(fromNumber, `Sorry, there was an error. Please text "2" to try again.`);
  }
}

// Handle cancellation selection
async function handleCancellationSelection(fromNumber, cleanedFromNumber, selection) {
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
}

// Handle management link requests (command "1")
async function handleManagementLinkRequest(fromNumber, cleanedFromNumber) {
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
    await sendSMS(fromNumber, `Sorry, we couldn't find any upcoming games that you're hosting.`);
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
  }
}

// Handle game details requests (command "2") - FIXED VERSION
async function handleGameDetailsRequest(fromNumber, cleanedFromNumber) {
  // DON'T clear last command immediately - wait until we know what we're doing
  const allGames = await getAllGames();
  const userGames = await getUserGames(cleanedFromNumber, allGames);
  
  console.log(`[SMS] User ${cleanedFromNumber} has ${userGames.length} upcoming games`);
  
  if (userGames.length === 0) {
    await sendSMS(fromNumber, `You don't have any upcoming games registered to this phone number.`);
  } else if (userGames.length === 1) {
    // Single game - send details immediately and we're done
    const { game, role } = userGames[0];
    const responseMessage = await buildGameDetailsMessage(game, role, cleanedFromNumber);
    await sendSMS(fromNumber, responseMessage);
  } else {
    // Multiple games - we need to track state for follow-up
    await saveLastCommand(cleanedFromNumber, 'details_selection');
    const responseMessage = await buildGameListMessage(userGames);
    await sendSMS(fromNumber, responseMessage);
  }
}

// Handle cancellation requests (command "9")
async function handleCancellationRequest(fromNumber, cleanedFromNumber) {
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
}

// Helper function to get user's games
async function getUserGames(cleanedFromNumber, allGames) {
  const gameEntries = Object.entries(allGames);
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
  const now = new Date();
  
  for (const [id, game] of gameEntries) {
    const gameDate = new Date(game.date);
    
    if (gameDate >= now || (gameDate.toDateString() === now.toDateString())) {
      let userRole = null;
      
      const playerInConfirmed = game.players.find(p => p.phone === cleanedFromNumber);
      if (playerInConfirmed) {
        userRole = playerInConfirmed.isOrganizer ? 'host' : 'confirmed';
      }
      
      if (!userRole) {
        const playerInWaitlist = (game.waitlist || []).find(p => p.phone === cleanedFromNumber);
        if (playerInWaitlist) {
          userRole = 'waitlist';
        }
      }
      
      if (!userRole) {
        const hostInfo = hostInfoMap.get(id);
        if (hostInfo && hostInfo.phone === cleanedFromNumber) {
          userRole = 'host';
        }
      }
      
      if (userRole) {
        userGames.push({ id, game, role: userRole });
      }
    }
  }
  
  return userGames;
}

// Helper function to get player's games (for cancellation)
async function getPlayerGames(cleanedFromNumber, allGames) {
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
  
  return playerGames;
}

// Helper function to build game details message
async function buildGameDetailsMessage(game, role, cleanedFromNumber) {
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
  
  return responseMessage;
}

// Helper function to build game list message - ENHANCED VERSION
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
    
    responseMessage += `${index + 1}. ${statusIcon} ${game.location}${roleText}\n${gameDate} at ${gameTime}\n\n`;
  });
  
  return responseMessage;
}

// Helper function to build cancellation list message
async function buildCancellationListMessage(playerGames) {
  let responseMessage = `You're registered for ${playerGames.length} upcoming games. Reply with the number of the game you want to cancel:\n\n`;
  
  playerGames.forEach(({ game, status }, index) => {
    const gameDate = formatDateForSMS(game.date);
    const gameTime = formatTimeForSMS(game.time);
    const statusText = status === 'confirmed' ? 'Confirmed' : 'Waitlist';
    
    responseMessage += `${index + 1}. ${game.location}\n${gameDate} at ${gameTime} (${statusText})\n\n`;
  });
  
  return responseMessage;
}

// Helper function to cancel player from game
async function cancelPlayerFromGame(gameId, game, player, status, fromNumber) {
  if (status === 'confirmed') {
    const playerIndex = game.players.findIndex(p => p.id === player.id);
    game.players.splice(playerIndex, 1);
    
    if (game.waitlist && game.waitlist.length > 0) {
      const promotedPlayer = game.waitlist.shift();
      game.players.push(promotedPlayer);
      
      const gameDate = formatDateForSMS(game.date);
      const gameTime = formatTimeForSMS(game.time);
      const promotionMessage = `Good news! You've been moved from the waitlist to confirmed for Pickleball at ${game.location} on ${gameDate} at ${gameTime}! Reply 2 for game details or 9 to cancel.`;
      
      await sendSMS(promotedPlayer.phone, promotionMessage, gameId);
    }
  } else {
    const waitlistIndex = game.waitlist.findIndex(p => p.id === player.id);
    game.waitlist.splice(waitlistIndex, 1);
  }
  
  await saveGame(gameId, game, game.hostToken, game.hostPhone);
  
  const gameDate = formatDateForSMS(game.date);
  const gameTime = formatTimeForSMS(game.time);
  const statusText = status === 'confirmed' ? 'reservation' : 'waitlist spot';
  await sendSMS(fromNumber, `Your pickleball ${statusText} at ${game.location} on ${gameDate} at ${gameTime} has been cancelled. Thanks for letting us know!`);
}

module.exports = {
  sendSMS,
  handleIncomingSMS,
  formatPhoneNumber,
  formatDateForSMS,
  formatTimeForSMS
};