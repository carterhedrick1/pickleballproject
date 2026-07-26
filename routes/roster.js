// The host's roster - everyone they have ever played with - and the stats built from it.
//
// Auth is the host's phone number and nothing more. That matches the existing
// /api/games/by-phone route, which already hands out management links (and therefore full
// control of a game) to anyone who knows the number. This is a private app for one friend
// group, so the accepted risk is the same one already taken there; if that ever changes,
// both routes need a real token together.

const {
  getGamesByHostPhone,
  getRosterForHost,
  upsertRosterEntry
} = require('../database');

const { formatPhoneNumber } = require('../sms-handler');
const { computeHostStats } = require('../stats');
const { routeFailed } = require('../utils/route-error');

module.exports = function mountRosterRoutes(app) {
  // Everyone this host has ever played with: their saved roster rows, plus anyone who has
  // appeared in one of their games. Roster values win over whatever a player typed at signup.
  app.get('/api/roster/:phone', async (req, res) => {
    try {
      const hostPhone = formatPhoneNumber(req.params.phone);

      const [rosterRows, games] = await Promise.all([
        getRosterForHost(hostPhone),
        getGamesByHostPhone(hostPhone)
      ]);

      const byPhone = new Map();

      for (const game of games) {
        const countedThisGame = new Set();
        const entries = [
          ...(game.players || []),
          ...(game.waitlist || []),
          ...(game.outPlayers || [])
        ];

        for (const entry of entries) {
          if (!entry || !entry.phone) continue;                 // phoneless entries can't be matched
          const phone = formatPhoneNumber(entry.phone);
          if (!phone || phone === hostPhone) continue;          // the host is not on their own roster

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
            if (entry.name) record.name = entry.name;           // most recent name they signed up with
          } else if (entry.name && !record.name) {
            record.name = entry.name;
          }
        }
      }

      for (const row of rosterRows) {
        const record = byPhone.get(row.playerPhone) || {
          phone: row.playerPhone,
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
        byPhone.set(row.playerPhone, record);
      }

      const roster = [...byPhone.values()].sort((a, b) =>
        (a.name || a.phone).localeCompare(b.name || b.phone, undefined, { sensitivity: 'base' })
      );

      res.json({ phoneNumber: hostPhone, count: roster.length, roster });
    } catch (error) {
      routeFailed(req, res, error, 'Failed to load roster');
    }
  });

  // Host edits one player's details.
  app.put('/api/roster/:phone/:playerPhone', async (req, res) => {
    try {
      const hostPhone = formatPhoneNumber(req.params.phone);
      const playerPhone = formatPhoneNumber(req.params.playerPhone);

      if (!hostPhone || !playerPhone) {
        return res.status(400).json({ error: 'A host phone number and a player phone number are required' });
      }

      const { name, duprId, duprRating } = req.body || {};
      const cleanName = name == null ? '' : String(name).trim().slice(0, 100);
      const cleanDuprId = duprId == null ? '' : String(duprId).trim().slice(0, 50);

      let cleanRating = null;
      if (duprRating !== undefined && duprRating !== null && String(duprRating).trim() !== '') {
        const parsed = Number(duprRating);
        if (!Number.isFinite(parsed) || parsed < 0 || parsed > 10) {
          return res.status(400).json({ error: 'DUPR rating should be a number between 0 and 10 (for example 3.75)' });
        }
        cleanRating = parsed;
      }

      await upsertRosterEntry(hostPhone, playerPhone, cleanName, cleanDuprId, cleanRating);

      res.json({
        success: true,
        player: { phone: playerPhone, name: cleanName, duprId: cleanDuprId, duprRating: cleanRating }
      });
    } catch (error) {
      routeFailed(req, res, error, 'Failed to save roster entry');
    }
  });

  // A host's numbers. Same phone-only access as the roster and by-phone routes above.
  app.get('/api/stats/:phone', async (req, res) => {
    try {
      const hostPhone = formatPhoneNumber(req.params.phone);

      const [games, roster] = await Promise.all([
        getGamesByHostPhone(hostPhone),
        getRosterForHost(hostPhone)
      ]);

      res.json(computeHostStats(hostPhone, games, roster));
    } catch (error) {
      routeFailed(req, res, error, 'Failed to load stats');
    }
  });
};
