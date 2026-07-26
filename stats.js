// stats.js - works out a host's numbers from their games.
//
// Deliberately pure: it takes the games and the roster and returns an object. No database, no
// network, no clock beyond "is this game still upcoming". That makes it testable in-process and
// keeps every formula in one readable place.
//
// Everything here is computed from data the app actually records. Where a number is only
// partly knowable, it says so in `notes` rather than quietly presenting a half-truth - and the
// stats that need invite tracking to be honest are left as nulls under `parked`.

const { isGameUpcoming } = require('./utils/central-time');

/** People are identified by phone. Failing that, by lowercased name - two phoneless "daves"
 *  in different games are treated as one person, which is the best guess available. */
function identityKey(person) {
  if (person.phone) return `p:${person.phone}`;
  if (person.name) return `n:${person.name.trim().toLowerCase()}`;
  return null;
}

/** Parsed field by field. `new Date('2026-08-15')` is parsed as UTC and can land on the
 *  previous day in a US timezone, which would report the wrong weekday. */
function weekdayOf(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const [year, month, day] = dateStr.split('-').map(Number);
  if (!year || !month || !day) return null;
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString('en-US', { weekday: 'long' });
}

function median(numbers) {
  if (!numbers.length) return null;
  const sorted = [...numbers].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

const roundTo = (value, places) => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

/** Highest count first, then alphabetically so equal counts do not shuffle between loads. */
function topEntries(counts, displayNames, limit, countKey = 'games') {
  return [...counts.entries()]
    .map(([key, count]) => ({ name: displayNames.get(key) || 'Unknown player', [countKey]: count, key }))
    .sort((a, b) => b[countKey] - a[countKey] || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map(({ key, ...rest }) => rest);
}

function emptyStats(phone) {
  return {
    phoneNumber: phone,
    summary: { gamesHosted: 0, upcoming: 0, completed: 0, cancelled: 0 },
    fillRate: { average: null, gamesCounted: 0 },
    players: { distinctCount: 0, top: [], waitlistRegulars: [], outs: [] },
    signupSpeed: [],
    schedule: { busiestLocation: null, favoriteDay: null, favoriteTime: null },
    dupr: { ratedPlayers: 0, min: null, max: null, average: null },
    notes: [],
    parked: { nonResponders: null, responseTimes: null }
  };
}

/**
 * @param {string} phone   the host's number, already formatted
 * @param {object[]} games every game they have hosted (from getGamesByHostPhone)
 * @param {object[]} roster their saved roster rows (from getRosterForHost)
 */
function computeHostStats(phone, games = [], roster = []) {
  if (!games.length) {
    const zeroed = emptyStats(phone);
    // A roster can exist without games if the host typed people in by hand.
    zeroed.dupr = duprSpread(roster);
    return zeroed;
  }

  const summary = { gamesHosted: games.length, upcoming: 0, completed: 0, cancelled: 0 };
  const completedGames = [];

  for (const game of games) {
    if (game.cancelled) {
      summary.cancelled += 1;
    } else if (isGameUpcoming(game.date, game.time)) {
      summary.upcoming += 1;
    } else {
      summary.completed += 1;
      completedGames.push(game);
    }
  }

  // Display names: what the host called them wins, then the most recent name they signed up
  // with, then a placeholder.
  const displayNames = new Map();
  const rosterByKey = new Map();
  for (const entry of roster) {
    const key = `p:${entry.playerPhone}`;
    rosterByKey.set(key, entry);
    if (entry.name) displayNames.set(key, entry.name);
  }

  const playerGames = new Map();      // times on the confirmed roster
  const waitlistCounts = new Map();   // times left waiting
  const outCounts = new Map();        // times they said they were out
  const confirmedCancels = new Map(); // ...of which, times they gave up a confirmed spot
  const everyone = new Set();

  const noteName = (key, person) => {
    if (person.name && !rosterByKey.has(key)) displayNames.set(key, person.name);
  };
  const bump = (map, key) => map.set(key, (map.get(key) || 0) + 1);

  const signupMinutes = new Map();

  for (const game of games) {
    const organizerPhone = game.organizerPhone || game.hostPhone;

    for (const player of game.players || []) {
      if (player.isOrganizer) continue;                       // the host is not their own regular
      const key = identityKey(player);
      if (!key || (organizerPhone && player.phone === organizerPhone)) continue;
      everyone.add(key);
      noteName(key, player);
      bump(playerGames, key);

      // How quickly people sign up once a game is posted. First-come games only: in approval
      // mode people apply against a deadline the host set, which is a different thing entirely.
      if (game.registrationMode !== 'waitlist' && player.joinedAt && game.created) {
        const minutes = (new Date(player.joinedAt) - new Date(game.created)) / 60000;
        if (Number.isFinite(minutes) && minutes >= 0) {
          if (!signupMinutes.has(key)) signupMinutes.set(key, []);
          signupMinutes.get(key).push(minutes);
        }
      }
    }

    for (const player of game.waitlist || []) {
      const key = identityKey(player);
      if (!key || (organizerPhone && player.phone === organizerPhone)) continue;
      everyone.add(key);
      noteName(key, player);
      bump(waitlistCounts, key);
    }

    // Legacy games contain duplicate out entries for the same person, from before these were
    // deduped on write. Collapse them per game so an old game cannot inflate somebody's count.
    const countedOuts = new Set();
    for (const player of game.outPlayers || []) {
      const key = identityKey(player);
      if (!key || countedOuts.has(key)) continue;
      if (organizerPhone && player.phone === organizerPhone) continue;
      countedOuts.add(key);
      everyone.add(key);
      noteName(key, player);
      bump(outCounts, key);
      if (player.wasConfirmed) bump(confirmedCancels, key);
    }
  }

  // Fill rate: how full the games that actually happened ended up.
  const fillRates = [];
  for (const game of completedGames) {
    const capacity = parseInt(game.totalPlayers, 10);
    if (!capacity || Number.isNaN(capacity)) continue;
    fillRates.push(Math.min(1, (game.players || []).length / capacity));
  }
  const fillRate = {
    average: fillRates.length ? roundTo(fillRates.reduce((a, b) => a + b, 0) / fillRates.length, 3) : null,
    gamesCounted: fillRates.length
  };

  // Where and when they play.
  const locationCounts = new Map();
  const dayCounts = new Map();
  const timeCounts = new Map();
  for (const game of games) {
    if (game.location) bump(locationCounts, game.location);
    const day = weekdayOf(game.date);
    if (day) bump(dayCounts, day);
    if (game.time) bump(timeCounts, game.time);
  }
  const mostCommon = (map) => {
    let best = null;
    for (const [value, count] of map.entries()) {
      if (!best || count > best.count || (count === best.count && value < best.value)) {
        best = { value, count };
      }
    }
    return best;
  };
  const busiestLocation = mostCommon(locationCounts);
  const favoriteDay = mostCommon(dayCounts);
  const favoriteTime = mostCommon(timeCounts);

  // Signup speed: a per-person median, and only for people with enough samples to mean anything.
  const signupSpeed = [...signupMinutes.entries()]
    .filter(([, samples]) => samples.length >= 2)
    .map(([key, samples]) => ({
      name: displayNames.get(key) || 'Unknown player',
      medianMinutes: Math.round(median(samples)),
      samples: samples.length
    }))
    .sort((a, b) => a.medianMinutes - b.medianMinutes || a.name.localeCompare(b.name))
    .slice(0, 5);

  const outs = [...outCounts.entries()]
    .map(([key, timesOut]) => ({
      name: displayNames.get(key) || 'Unknown player',
      timesOut,
      confirmedCancels: confirmedCancels.get(key) || 0,
      key
    }))
    .sort((a, b) => b.timesOut - a.timesOut || a.name.localeCompare(b.name))
    .slice(0, 5)
    .map(({ key, ...rest }) => rest);

  // Honest caveats, shown on the page rather than buried here.
  const notes = [];
  if (outCounts.size) {
    notes.push('Cancellations are only counted from when this feature was added - earlier text-message cancellations are not counted.');
  }
  if (signupSpeed.length) {
    notes.push('Signup speed is how long after you posted a game somebody signed up, in first-come games only. It is not how fast they reply to a text - the app does not know when you invited them.');
  }
  if (!fillRate.gamesCounted) {
    notes.push('Fill rate needs at least one finished game.');
  }

  return {
    phoneNumber: phone,
    summary,
    fillRate,
    players: {
      distinctCount: everyone.size,
      top: topEntries(playerGames, displayNames, 5),
      waitlistRegulars: topEntries(waitlistCounts, displayNames, 5, 'times'),
      outs
    },
    signupSpeed,
    schedule: {
      busiestLocation: busiestLocation ? { name: busiestLocation.value, games: busiestLocation.count } : null,
      favoriteDay: favoriteDay ? { name: favoriteDay.value, games: favoriteDay.count } : null,
      favoriteTime: favoriteTime ? { name: favoriteTime.value, games: favoriteTime.count } : null
    },
    dupr: duprSpread(roster),
    notes,
    // These need invite tracking - the app never learns who was invited, only who replied - so
    // they stay null rather than being guessed at. See the plan's parked section.
    parked: { nonResponders: null, responseTimes: null }
  };
}

function duprSpread(roster = []) {
  const ratings = roster
    .map((entry) => entry.duprRating)
    .filter((rating) => typeof rating === 'number' && Number.isFinite(rating));

  if (!ratings.length) return { ratedPlayers: 0, min: null, max: null, average: null };

  return {
    ratedPlayers: ratings.length,
    min: Math.min(...ratings),
    max: Math.max(...ratings),
    average: roundTo(ratings.reduce((a, b) => a + b, 0) / ratings.length, 2)
  };
}

module.exports = { computeHostStats };
