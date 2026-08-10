// One definition of the roster shown to a host and accepted by roster-backed actions.
//
// Older games predate the host_roster table, so the visible roster is deliberately the union
// of saved rows and everyone with a phone number from the host's games. Keeping that merge here
// prevents a page from offering somebody whom a later server action then rejects.

const { getGamesByHostPhone, getRosterForHost } = require('../database');
const { formatPhoneNumber } = require('../utils/sms-format');

function buildVisibleHostRoster(hostPhone, rosterRows = [], games = []) {
  const normalizedHostPhone = formatPhoneNumber(hostPhone);
  const byPhone = new Map();

  for (const game of games) {
    const countedThisGame = new Set();
    const entries = [
      ...(game.players || []),
      ...(game.waitlist || []),
      ...(game.outPlayers || [])
    ];

    for (const entry of entries) {
      if (!entry || !entry.phone) continue;
      const phone = formatPhoneNumber(entry.phone);
      if (phone.length !== 10 || phone === normalizedHostPhone) continue;

      let record = byPhone.get(phone);
      if (!record) {
        record = {
          phone,
          name: '',
          duprId: '',
          duprRating: null,
          isAndroid: null,
          lastSeen: null,
          gamesCount: 0
        };
        byPhone.set(phone, record);
      }

      // A player on both the waitlist and the out list is still one game.
      if (!countedThisGame.has(phone)) {
        countedThisGame.add(phone);
        record.gamesCount += 1;
      }

      const when = entry.joinedAt || entry.outAt || game.created || game.date || null;
      if (when && (!record.lastSeen || when > record.lastSeen)) {
        record.lastSeen = when;
        if (entry.name) record.name = entry.name;
      } else if (entry.name && !record.name) {
        record.name = entry.name;
      }
    }
  }

  // Explicit saved values win over names and details captured from old games.
  for (const row of rosterRows) {
    const phone = formatPhoneNumber(row.playerPhone);
    if (phone.length !== 10 || phone === normalizedHostPhone) continue;
    const record = byPhone.get(phone) || {
      phone,
      name: '',
      duprId: '',
      duprRating: null,
      isAndroid: null,
      lastSeen: null,
      gamesCount: 0
    };
    if (row.name) record.name = row.name;
    record.duprId = row.duprId;
    record.duprRating = row.duprRating;
    record.isAndroid = row.isAndroid;
    byPhone.set(phone, record);
  }

  return [...byPhone.values()].sort((a, b) =>
    (a.name || a.phone).localeCompare(b.name || b.phone, undefined, { sensitivity: 'base' })
  );
}

async function getVisibleHostRoster(hostPhone) {
  const normalizedHostPhone = formatPhoneNumber(hostPhone);
  const [rosterRows, games] = await Promise.all([
    getRosterForHost(normalizedHostPhone),
    getGamesByHostPhone(normalizedHostPhone)
  ]);
  return buildVisibleHostRoster(normalizedHostPhone, rosterRows, games);
}

module.exports = { buildVisibleHostRoster, getVisibleHostRoster };
