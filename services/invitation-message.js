const { resolveRandomizedMessage } = require('./message-randomizer');
const { queuePoolRefill } = require('./message-generation');

function formatInvitationDate(dateStr) {
  if (!dateStr) return '';
  const [year, month, day] = String(dateStr).split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  });
}

function formatInvitationTime(timeStr) {
  if (!timeStr) return '';
  const [hours, minutes] = String(timeStr).split(':');
  const hour = parseInt(hours, 10);
  return `${hour % 12 || 12}:${minutes} ${hour >= 12 ? 'PM' : 'AM'}`;
}

function additionalPlayers(game) {
  const totalPlayers = parseInt(game.totalPlayers, 10);
  return game.organizerPlaying === false ? totalPlayers : Math.max(totalPlayers - 1, 0);
}

function buildDeterministicInvitation(game, gameId, baseUrl) {
  const gameLink = `${String(baseUrl).replace(/\/+$/, '')}/game.html?id=${gameId}`;
  const availableSpots = additionalPlayers(game);
  const spotsText = availableSpots === 1 ? 'Spot' : 'Spots';
  const isFirstCome = (game.registrationMode || 'fcfs') === 'fcfs';
  const firstComeMessage = isFirstCome
    ? `\nFirst ${availableSpots} to respond ${availableSpots === 1 ? 'is' : 'are'} in.`
    : '';
  return `Let us know if you're IN or OUT for pickleball by clicking the link below:

${gameLink}

Location: ${game.location}
Date: ${formatInvitationDate(game.date)}
Time: ${formatInvitationTime(game.time)}
Duration: ${game.duration} minutes
${spotsText}: ${availableSpots}
${game.message ? `\n${game.message}` : ''}
${firstComeMessage}

`;
}

async function buildRandomizedInvitation(game, gameId, baseUrl, database = require('../database')) {
  const deterministic = buildDeterministicInvitation(game, gameId, baseUrl);
  const result = await resolveRandomizedMessage({
    database,
    personalityId: game.personalityId,
    surfaceId: 'invitation-opening',
    game,
    gameId,
    audience: 'invitation-copy',
    deterministicDetails: deterministic,
    fallbackText: deterministic
  });
  if (result.personalityId) {
    queuePoolRefill({
      database,
      personalityId: result.personalityId,
      surfaceId: 'invitation-opening'
    });
  }
  return result;
}

module.exports = {
  formatInvitationDate,
  formatInvitationTime,
  additionalPlayers,
  buildDeterministicInvitation,
  buildRandomizedInvitation
};
