// Which games an inbound SMS sender belongs to, by phone number and role.
//
// Every command the webhook answers ("1" for management links, "2" for details, "9" to
// cancel) starts with one of these lookups. They take the already-loaded allGames map
// rather than querying themselves so one webhook request loads the games exactly once.
//
// Known cost, accepted for now: these scan every game in JS because games are stored as
// whole JSON blobs. At this app's scale (dozens of games) that is fine; SQL-side lookup
// tables are the refactor backlog's persistence item if scale ever changes.
const { getGameHostInfo } = require('../database');
const { isGameUpcoming, isGameRecentlyFinished } = require('../utils/central-time');
const { maskPhone } = require('../utils/sms-format');

const DEBUG = process.env.DEBUG === 'true' || process.env.DEBUG === '1';

// Soonest game first, and the same order every time. Database order shifts whenever a
// game is re-saved, which used to renumber a reply list between two texts.
function compareGameEntries(a, b) {
  return `${a.game.date}T${a.game.time}`.localeCompare(`${b.game.date}T${b.game.time}`);
}

async function loadHostInfoMap(gameEntries) {
  const allHostInfo = await Promise.all(gameEntries.map(async ([id]) => {
    try {
      return { id, hostInfo: await getGameHostInfo(id) };
    } catch (error) {
      console.error(`Error getting host info for game ${id}:`, error);
      return { id, hostInfo: null };
    }
  }));
  return new Map(allHostInfo.map(({ id, hostInfo }) => [id, hostInfo]));
}

/**
 * Games this phone number hosts. Upcoming ones always; recently finished ones too when
 * asked, because a host texting right after a game is usually there to add photos.
 * @returns {Promise<Array<{ id, game, hostInfo, upcoming }>>} unsorted
 */
async function getUserHostGames(cleanedFromNumber, allGames, { includeRecent = false } = {}) {
  const gameEntries = Object.entries(allGames);
  if (DEBUG) console.log(`[SMS DEBUG] Checking ${gameEntries.length} total games for host privileges for user ${maskPhone(cleanedFromNumber)}`);

  const hostInfoMap = await loadHostInfoMap(gameEntries);
  const hostGames = [];

  for (const [id, game] of gameEntries) {
    const upcoming = isGameUpcoming(game.date, game.time);
    const recent = includeRecent && isGameRecentlyFinished(game.date, game.time);
    if (!upcoming && !recent) {
      if (DEBUG) console.log(`[SMS DEBUG] Skipping past game: ${game.location} on ${game.date}`);
      continue;
    }

    const hostInfo = hostInfoMap.get(id);
    if (hostInfo && hostInfo.phone === cleanedFromNumber) {
      if (DEBUG) console.log(`[SMS DEBUG] User is host of game ${id}: ${game.location}`);
      hostGames.push({ id, game, hostInfo, upcoming });
    } else {
      if (DEBUG) console.log(`[SMS DEBUG] User is NOT host of game ${id}: ${game.location}`);
    }
  }

  if (DEBUG) console.log(`[SMS DEBUG] Final result: ${hostGames.length} host games for user ${maskPhone(cleanedFromNumber)}`);
  return hostGames;
}

/**
 * Every upcoming game this phone number appears in, with the sender's role in each:
 * 'host', 'confirmed', or 'waitlist'. Used by the details command ("2").
 * @returns {Promise<Array<{ id, game, role }>>} soonest first
 */
async function getUserGames(cleanedFromNumber, allGames) {
  const gameEntries = Object.entries(allGames);
  if (DEBUG) console.log(`[SMS DEBUG] Checking ${gameEntries.length} total games for user ${maskPhone(cleanedFromNumber)}`);

  const hostInfoMap = await loadHostInfoMap(gameEntries);
  const userGames = [];

  for (const [id, game] of gameEntries) {
    if (!isGameUpcoming(game.date, game.time)) {
      if (DEBUG) console.log(`[SMS DEBUG] Skipping past game: ${game.location} on ${game.date}`);
      continue;
    }

    let userRole = null;

    const playerInConfirmed = game.players.find(p => p.phone === cleanedFromNumber);
    if (playerInConfirmed) {
      userRole = playerInConfirmed.isOrganizer ? 'host' : 'confirmed';
      if (DEBUG) console.log(`[SMS DEBUG] Found user in confirmed players: ${game.location} (${userRole})`);
    }

    if (!userRole) {
      const playerInWaitlist = (game.waitlist || []).find(p => p.phone === cleanedFromNumber);
      if (playerInWaitlist) {
        userRole = 'waitlist';
        if (DEBUG) console.log(`[SMS DEBUG] Found user in waitlist: ${game.location} (${userRole})`);
      }
    }

    if (!userRole) {
      const hostInfo = hostInfoMap.get(id);
      if (hostInfo && hostInfo.phone === cleanedFromNumber) {
        userRole = 'host';
        if (DEBUG) console.log(`[SMS DEBUG] Found user as host: ${game.location} (${userRole})`);
      }
    }

    if (userRole) {
      userGames.push({ id, game, role: userRole });
    } else {
      if (DEBUG) console.log(`[SMS DEBUG] User not found in game: ${game.location}`);
    }
  }

  if (DEBUG) console.log(`[SMS DEBUG] Final result: ${userGames.length} games for user ${maskPhone(cleanedFromNumber)}`);
  return userGames.sort(compareGameEntries);
}

/**
 * The upcoming games this phone number could cancel out of: confirmed spots (never the
 * organizer's own reserved one) and waitlist places. Used by the cancel command ("9").
 * @returns {Promise<Array<{ id, game, player, status }>>} soonest first
 */
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

  return playerGames.sort(compareGameEntries);
}

module.exports = {
  compareGameEntries,
  getUserHostGames,
  getUserGames,
  getPlayerGames
};
