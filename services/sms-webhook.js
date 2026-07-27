// SMS-related functions: incoming message handling, notifications, and reminders.
const {
  getAllGames,
  getGame,
  getGameHostInfo,
  saveLastCommand,
  getLastCommand,
  clearLastCommand
} = require('../database');
const { isGameUpcoming } = require('../utils/central-time');
const { departureAlertType } = require('../utils/promotion');
const { leaveGame } = require('./player-service');
const { sendSMS, sendSMSWithRetry } = require('./sms-client');
const {
  formatPhoneNumber,
  formatDateForSMS,
  formatTimeForSMS,
  formatLocationForSMS
} = require('../utils/sms-format');

const DEBUG = process.env.DEBUG === 'true' || process.env.DEBUG === '1';

async function sendOrganizerNotification(gameId, game, eventType, playerName = null) {
  try {
    if (!game.hostPhone) {
      if (DEBUG) console.log('[DEBUG] No hostPhone found, skipping notification');
      return;
    }
    if (!game.notificationPreferences) {
      if (DEBUG) console.log('[DEBUG] No notification preferences found, skipping notification');
      return;
    }

    const prefs = game.notificationPreferences;
    let shouldSend = false;
    let message = '';

    const gameDate = formatDateForSMS(game.date);
    const gameTime = formatTimeForSMS(game.time);
    const locationText = formatLocationForSMS(game);

    if (DEBUG) {
      console.log('[DEBUG] ORGANIZER NOTIFICATION:', { gameId, eventType, playerName, hostPhone: game.hostPhone });
    }

    switch (eventType) {
      case 'gameFull':
        if (prefs.gameFull === true) {
          shouldSend = true;
          message = `HOST ALERT: Your pickleball game at ${locationText} on ${gameDate} is now FULL! All ${game.totalPlayers} spots are taken.`;
        }
        break;
      case 'playerJoins':
        if (prefs.playerJoins === true && playerName) {
          shouldSend = true;
          const spotsLeft = parseInt(game.totalPlayers) - game.players.length;
          message = `HOST ALERT: ${playerName} just joined your pickleball game at ${locationText} on ${gameDate}. ${spotsLeft} ${spotsLeft === 1 ? 'spot' : 'spots'} remaining.`;
        }
        break;
      case 'playerCancels':
        if (prefs.playerCancels === true && playerName) {
          shouldSend = true;
          const spotsLeft = parseInt(game.totalPlayers) - game.players.length;
          message = `HOST ALERT: ${playerName} cancelled their spot for your pickleball game at ${locationText} on ${gameDate}. ${spotsLeft} ${spotsLeft === 1 ? 'spot' : 'spots'} now available.`;
        }
        break;
      case 'spotOpenedWaitlistMode': {
        // Deliberately NOT gated on the playerCancels preference. In approval mode nobody is
        // promoted automatically, so if the host is not told, the spot silently stays empty -
        // which is the exact problem this app exists to fix.
        shouldSend = true;
        const waiting = (game.waitlist || []).length;
        message = `HOST ALERT: ${playerName || 'A player'} gave up their confirmed spot for your pickleball game at ${locationText} on ${gameDate}. You have ${waiting} ${waiting === 1 ? 'person' : 'people'} on your waitlist - open your management link to pick a replacement.`;
        break;
      }
      case 'oneSpotLeft':
        if (prefs.oneSpotLeft === true) {
          shouldSend = true;
          message = `HOST ALERT: Only 1 spot left for your pickleball game at ${locationText} on ${gameDate}!`;
        }
        break;
      case 'waitlistStarts':
        if (prefs.waitlistStarts === true && playerName) {
          shouldSend = true;
          message = `HOST ALERT: ${playerName} is the first person on the waitlist for your pickleball game at ${locationText} on ${gameDate}.`;
        }
        break;
      default:
        if (DEBUG) console.log('[DEBUG] Unknown event type:', eventType);
    }

    if (shouldSend && message) {
      const smsResult = await sendSMS(game.hostPhone, message, gameId);
      if (smsResult.success) {
        console.log(`[ORGANIZER NOTIFICATION] Sent ${eventType} to host for game ${gameId}`);
      } else {
        console.error(`[ORGANIZER NOTIFICATION] Failed to send ${eventType}:`, smsResult.error);
      }
    }
  } catch (error) {
    console.error('Error sending organizer notification:', error);
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
      const locationText = formatLocationForSMS(game);

      await sendSMS(fromNumber, `Here's your management link for ${locationText} on ${gameDate} at ${gameTime}: ${managementLink}`);
    } else {
      console.log(`[SMS] User has ${hostGames.length} host games, sending all links`);
      let responseMessage = `You have ${hostGames.length} upcoming games:\n\n`;
      
      hostGames.forEach(({ id, game, hostInfo }, index) => {
        const baseUrl = process.env.BASE_URL || 'https://your-domain.com';
        const managementLink = `${baseUrl}/manage.html?id=${id}&token=${hostInfo.hostToken}`;
        const gameDate = formatDateForSMS(game.date);
        const gameTime = formatTimeForSMS(game.time);
        const locationText = formatLocationForSMS(game);

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
      
      // Send details for all users - buildGameDetailsMessage handles the logic
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
// Only check upcoming games
    if (!isGameUpcoming(game.date, game.time)) {
      console.log(`[SMS DEBUG] Skipping past game: ${game.location} on ${game.date}`);
      continue;
    }
    
    const hostInfo = hostInfoMap.get(id);
    if (hostInfo && hostInfo.phone === cleanedFromNumber) {
      console.log(`[SMS DEBUG] User is host of game ${id}: ${game.location}`);
      hostGames.push({ id, game, hostInfo });
    } else {
      console.log(`[SMS DEBUG] User is NOT host of game ${id}: ${game.location}`);
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
      return;
    } 
    
    if (userGames.length === 1) {
      console.log(`[SMS] Showing details for single game: ${userGames[0].game.location}`);
      const { game, role, id: gameId } = userGames[0];
      
      // Send details for all users - buildGameDetailsMessage handles the logic
      const responseMessage = await buildGameDetailsMessage(game, role, cleanedFromNumber);
      await sendSMS(fromNumber, responseMessage, gameId);
      return;
    } 
    
    // Multiple games case
    console.log(`[SMS] User has ${userGames.length} games, showing selection list`);
    await saveLastCommand(cleanedFromNumber, 'details_selection');
    const responseMessage = await buildGameListMessage(userGames);
    const firstGameId = userGames[0].id;
    await sendSMS(fromNumber, responseMessage, firstGameId);
    
  } catch (error) {
    console.error('Error in handleGameDetailsRequest:', error);
    await clearLastCommand(cleanedFromNumber);
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
    if (!isGameUpcoming(game.date, game.time)) {
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
    if (!isGameUpcoming(game.date, game.time)) {
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

async function buildGameDetailsMessage(game, role, cleanedFromNumber) {
  const gameDate = formatDateForSMS(game.date);
  const gameTime = formatTimeForSMS(game.time);
  const locationText = formatLocationForSMS(game);

  let responseMessage = `${locationText}\n${gameDate} at ${gameTime}\nDuration: ${game.duration} minutes\n\n`;
  
  // Show player details to confirmed players and hosts, even in waitlist mode
  if (game.registrationMode !== 'waitlist' || role === 'host' || role === 'confirmed') {
    responseMessage += `Confirmed Players (${game.players.length}/${game.totalPlayers}):\n`;
    if (game.players.length === 0) {
      responseMessage += `• None yet\n`;
    } else {
      game.players.forEach(player => {
        responseMessage += `• ${player.name}${player.isOrganizer ? ' (Organizer)' : ''}\n`;
      });
    }
    
    // Only show waitlist info to hosts, not to confirmed players in waitlist mode
    if (game.waitlist && game.waitlist.length > 0 && (game.registrationMode !== 'waitlist' || role === 'host')) {
      responseMessage += `\nWaitlist (${game.waitlist.length}):\n`;
      
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
    // Waitlist mode - hide player info from waitlist users only
    responseMessage += `Player selection in progress\n`;
    responseMessage += `The organizer will review all applications and select players.\n`;
  }
  
  if (role === 'host') {
    responseMessage += `\nYou are: Host/Organizer\nReply "1" for management link`;
  } else if (role === 'confirmed') {
    responseMessage += `\nYou are: Confirmed Player\nReply "9" to cancel`;
  } else if (role === 'waitlist') {
    if (game.registrationMode === 'waitlist') {
      responseMessage += `\nYou are: Application Submitted\nReply "9" to cancel application`;
    } else {
      const waitlistPosition = game.waitlist.findIndex(p => p.phone === cleanedFromNumber) + 1;
      responseMessage += `\nYou are: Waitlist #${waitlistPosition}\nReply "9" to cancel`;
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
      statusIcon = '';
      roleText = ' (Host)';
    } else if (role === 'confirmed') {
      statusIcon = '';
    } else {
      statusIcon = '';
    }
    
const locationText = formatLocationForSMS(game);
responseMessage += `${index + 1}. ${statusIcon ? statusIcon + ' ' : ''}${locationText}${roleText}\n${gameDate} at ${gameTime}\n\n`;  });
  
  return responseMessage;
}

// Helper function to build cancellation list message
async function buildCancellationListMessage(playerGames) {
  let responseMessage = `You're registered for ${playerGames.length} upcoming games. Reply with the number of the game you want to cancel:\n\n`;
  
  playerGames.forEach(({ game, status }, index) => {
    const gameDate = formatDateForSMS(game.date);
    const gameTime = formatTimeForSMS(game.time);
    const statusText = status === 'confirmed' ? 'Confirmed' : 'Waitlist';
    
const locationText = formatLocationForSMS(game);
responseMessage += `${index + 1}. ${locationText}\n${gameDate} at ${gameTime} (${statusText})\n\n`;  });
  
  return responseMessage;
}

// Helper function to cancel player from game
async function cancelPlayerFromGame(gameId, staleGame, player, status, fromNumber) {
  try {
    const result = await leaveGame(
      gameId,
      { playerId: player.id },
      { protectOrganizer: false }
    );
    if (result.status === 'game_not_found') {
      await sendSMS(fromNumber, `Sorry, we couldn't find that game anymore.`);
      return;
    }
    if (result.status === 'not_found') {
      const message = status === 'confirmed'
        ? `You're no longer registered for that game, so there was nothing to cancel.`
        : `You're no longer on that waitlist, so there was nothing to cancel.`;
      await sendSMS(fromNumber, message);
      return;
    }

    // Texts go out after the lock is released so nobody else waits on a Textbelt round trip.
    const game = result.game;
    const promotedPlayer = result.promotedPlayer;
    if (promotedPlayer && promotedPlayer.phone) {
      const promoDate = formatDateForSMS(game.date);
      const promoTime = formatTimeForSMS(game.time);
      const promoLocation = formatLocationForSMS(game);

      // Only first-come games reach this point, so there is no approval-mode wording to pick
      // between any more - promoteNextFromWaitlist never promotes in approval mode.
      const promotionMessage = `Good news! You've been selected for Pickleball at ${promoLocation} on ${promoDate} at ${promoTime}! Reply 2 for who is playing and details or 9 to cancel.`;
      // Retried: there is no screen behind this one. The promotion happened because someone
      // else texted 9, so if this text is lost the promoted player is never told at all.
      const promoResult = await sendSMSWithRetry(promotedPlayer.phone, promotionMessage, gameId);
      if (!promoResult.success) {
        console.error(`[SMS] ${promotedPlayer.name} was promoted on game ${gameId} but could not be told:`, promoResult.error);
      }
    }

    // Send organizer notification for cancellation. In approval mode, losing a confirmed player
    // means the host has to pick a replacement themselves, so they get told that instead.
    if (!player.isOrganizer) {
      await sendOrganizerNotification(
        gameId,
        game,
        departureAlertType(game, result.previousStatus === 'confirmed'),
        result.player.name
      );
    }

    const gameDate = formatDateForSMS(game.date);
    const gameTime = formatTimeForSMS(game.time);
    const locationText = formatLocationForSMS(game);

    // Different message based on status and game mode
    let statusText;
    if (result.previousStatus === 'confirmed') {
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
  sendSMSWithRetry,
  handleIncomingSMS,
  sendOrganizerNotification,
  formatPhoneNumber,
  formatDateForSMS,
  formatTimeForSMS,
  formatLocationForSMS
};
