const { formatPhoneNumber } = require('./sms-format');

const PLAYER_LIST_FIELDS = ['players', 'waitlist', 'outPlayers', 'invitedPlayers'];

function chooseDeveloperRosterSource({
  production = false,
  configuredSource = '',
  requestedSource = ''
} = {}) {
  if (production) return 'production';
  // The screenshot and browser-test server sets this hard lock so no test action or query
  // string can ever redirect a fixture mutation to the live production database.
  if (configuredSource === 'local') return 'local';
  if (requestedSource === 'local' || requestedSource === 'production') return requestedSource;
  return 'production';
}

function cleanPhone(value) {
  const phone = formatPhoneNumber(value);
  return phone.length === 10 ? phone : '';
}

function sourceTime(value) {
  const time = Date.parse(value || '');
  return Number.isFinite(time) ? time : 0;
}

function playerEntries(game) {
  return PLAYER_LIST_FIELDS.flatMap((field) =>
    Array.isArray(game[field]) ? game[field].map((player) => ({ field, player })) : []
  );
}

function buildDeveloperRosters({ games = [], rosterRows = [] } = {}) {
  const hostsByPhone = new Map();
  const masterByPhone = new Map();

  function ensureHost(phone) {
    if (!hostsByPhone.has(phone)) {
      hostsByPhone.set(phone, {
        phone,
        name: '',
        nameTime: 0,
        playersByPhone: new Map()
      });
    }
    return hostsByPhone.get(phone);
  }

  function noteMaster(phone, name, time, priority) {
    const current = masterByPhone.get(phone);
    const cleanName = String(name || '').trim();
    if (!current) {
      masterByPhone.set(phone, {
        phone,
        name: cleanName,
        nameTime: time,
        namePriority: priority,
        hostPhones: new Set()
      });
      return masterByPhone.get(phone);
    }
    if (
      cleanName &&
      (!current.name || priority > current.namePriority ||
        (priority === current.namePriority && time >= current.nameTime))
    ) {
      current.name = cleanName;
      current.nameTime = time;
      current.namePriority = priority;
    }
    return current;
  }

  function noteHostPlayer(host, phone, name, time, priority) {
    const current = host.playersByPhone.get(phone);
    const cleanName = String(name || '').trim();
    if (!current) {
      host.playersByPhone.set(phone, {
        phone,
        name: cleanName,
        nameTime: time,
        namePriority: priority
      });
    } else if (
      cleanName &&
      (!current.name || priority > current.namePriority ||
        (priority === current.namePriority && time >= current.nameTime))
    ) {
      current.name = cleanName;
      current.nameTime = time;
      current.namePriority = priority;
    }
    noteMaster(phone, cleanName, time, priority).hostPhones.add(host.phone);
  }

  for (const record of games) {
    const game = record.data || {};
    const hostPhone = cleanPhone(record.hostPhone || game.hostPhone || game.organizerPhone);
    if (!hostPhone) continue;

    const host = ensureHost(hostPhone);
    const time = sourceTime(record.updatedAt || game.created || game.date);
    const hostName = String(game.organizerName || '').trim();
    if (hostName && (!host.name || time >= host.nameTime)) {
      host.name = hostName;
      host.nameTime = time;
    }

    for (const { player } of playerEntries(game)) {
      const phone = cleanPhone(player && player.phone);
      if (!phone || phone === hostPhone || player.isOrganizer === true) continue;
      noteHostPlayer(
        host,
        phone,
        player.name,
        sourceTime(player.joinedAt || player.outAt || record.updatedAt || game.created || game.date),
        1
      );
    }
  }

  // A saved roster entry is the host's deliberate version of a player's details, so it
  // takes precedence over names captured from a signup even when the game is newer.
  for (const row of rosterRows) {
    const hostPhone = cleanPhone(row.hostPhone);
    const playerPhone = cleanPhone(row.playerPhone);
    if (!hostPhone || !playerPhone || hostPhone === playerPhone) continue;
    const host = ensureHost(hostPhone);
    noteHostPlayer(host, playerPhone, row.name, sourceTime(row.updatedAt), 2);
  }

  const byNameThenPhone = (a, b) =>
    (a.name || a.phone).localeCompare(b.name || b.phone, undefined, { sensitivity: 'base' }) ||
    a.phone.localeCompare(b.phone);

  const hosts = [...hostsByPhone.values()]
    .map((host) => ({
      phone: host.phone,
      name: host.name,
      players: [...host.playersByPhone.values()]
        .map(({ phone, name }) => ({ phone, name }))
        .sort(byNameThenPhone)
    }))
    .sort(byNameThenPhone);

  const players = [...masterByPhone.values()]
    .map((player) => ({
      phone: player.phone,
      name: player.name,
      hostCount: player.hostPhones.size,
      hostRosters: [...player.hostPhones]
        .map((phone) => {
          const host = hostsByPhone.get(phone);
          return { phone, name: host ? host.name : '' };
        })
        .sort(byNameThenPhone)
    }))
    .sort(byNameThenPhone);

  return {
    hosts,
    players,
    counts: {
      hosts: hosts.length,
      players: players.length,
      rosterEntries: hosts.reduce((sum, host) => sum + host.players.length, 0)
    }
  };
}

function editPlayerInGame(game, oldPhone, newPhone, name, hostPhone = '') {
  let changed = false;
  const cleanHostPhone = cleanPhone(hostPhone || game.hostPhone || game.organizerPhone);
  for (const { player } of playerEntries(game)) {
    if (
      !player ||
      player.isOrganizer === true ||
      cleanPhone(player.phone) === cleanHostPhone ||
      cleanPhone(player.phone) !== oldPhone
    ) continue;
    player.phone = newPhone;
    player.name = name;
    changed = true;
  }
  return changed;
}

function deletePlayerFromGame(game, phone, hostPhone = '') {
  let removed = 0;
  const cleanHostPhone = cleanPhone(hostPhone || game.hostPhone || game.organizerPhone);
  for (const field of PLAYER_LIST_FIELDS) {
    if (!Array.isArray(game[field])) continue;
    const kept = game[field].filter((player) => {
      const playerPhone = cleanPhone(player && player.phone);
      const matches = player &&
        player.isOrganizer !== true &&
        playerPhone !== cleanHostPhone &&
        playerPhone === phone;
      if (matches) removed += 1;
      return !matches;
    });
    if (kept.length !== game[field].length) game[field] = kept;
  }
  return removed;
}

module.exports = {
  PLAYER_LIST_FIELDS,
  chooseDeveloperRosterSource,
  buildDeveloperRosters,
  editPlayerInGame,
  deletePlayerFromGame
};
