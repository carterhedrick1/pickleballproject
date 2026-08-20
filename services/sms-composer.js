// Builds the texts the SMS webhook sends back: game details, selection lists, and the
// host alert for a player cancellation. Pure string-building over game data - no database
// access and no sending, so each message shape is unit-testable on its own.
const {
  formatDateForSMS,
  formatTimeForSMS,
  formatLocationForSMS
} = require('../utils/sms-format');
const { appendCustomReplyInstructions } = require('../sms-reply-options');

/**
 * What the host is told when a player drops out of a first-come game.
 *
 * A full game with a waitlist refills itself in the same instant, so "0 spots now
 * available" on its own read as a contradiction and never named the replacement. The
 * alert has to say who took the spot, because that is the part the host would otherwise
 * have to go and look up.
 */
function playerCancelledAlert({ playerName, locationText, gameDate, spotsLeft, promotedName }) {
  const opening = `HOST ALERT: ${playerName} cancelled their spot for your pickleball game at ${locationText} on ${gameDate}.`;
  const spots = `${spotsLeft} ${spotsLeft === 1 ? 'spot' : 'spots'} now available.`;

  if (!promotedName) return `${opening} ${spots}`;
  if (spotsLeft <= 0) {
    return `${opening} ${promotedName} moved up from the waitlist to take it, so your game is still full.`;
  }
  return `${opening} ${promotedName} moved up from the waitlist. ${spots}`;
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
    responseMessage += `Player selection is still in progress.\n`;
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
      // findIndex returns -1 when the roster shifted between lookups, which would print "#0".
      responseMessage += waitlistPosition > 0
        ? `\nYou are: Waitlist #${waitlistPosition}\nReply "9" to cancel`
        : `\nYou are: On the waitlist\nReply "9" to cancel`;
    }
  }

  return appendCustomReplyInstructions(
    responseMessage,
    role === 'host' ? 'host' : 'player'
  );
}

async function buildGameListMessage(userGames) {
  let responseMessage = `You have ${userGames.length} upcoming games. Reply with a number to see details:\n\n`;

  userGames.forEach(({ game, role }, index) => {
    const gameDate = formatDateForSMS(game.date);
    const gameTime = formatTimeForSMS(game.time);
    const roleText = role === 'host' ? ' (Host)' : '';
    const locationText = formatLocationForSMS(game);
    responseMessage += `${index + 1}. ${locationText}${roleText}\n${gameDate} at ${gameTime}\n\n`;
  });

  return responseMessage;
}

async function buildCancellationListMessage(playerGames) {
  let responseMessage = `You're signed up for ${playerGames.length} upcoming games. Reply with the number of the game you want to cancel:\n\n`;

  playerGames.forEach(({ game, status }, index) => {
    const gameDate = formatDateForSMS(game.date);
    const gameTime = formatTimeForSMS(game.time);
    const statusText = status === 'confirmed' ? 'Confirmed' : 'Waitlist';
    const locationText = formatLocationForSMS(game);
    responseMessage += `${index + 1}. ${locationText}\n${gameDate} at ${gameTime} (${statusText})\n\n`;
  });

  return responseMessage;
}

module.exports = {
  playerCancelledAlert,
  buildGameDetailsMessage,
  buildGameListMessage,
  buildCancellationListMessage
};
