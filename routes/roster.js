// The host's roster - everyone they have ever played with - and the stats built from it.
//
// Phone-number access requires the shared SMS verification session used by My Games and Stats.
// A valid per-game host token may read the roster from that game's management page, but roster
// edits always require the verified phone session.

const { getGamesByHostPhone } = require('../database/games');
const { getRosterForHost, upsertRosterEntry } = require('../database/roster');

const { formatPhoneNumber } = require('../utils/sms-format');
const { computeHostStats } = require('../stats');
const { getVisibleHostRoster } = require('../services/host-roster');
const { routeFailed } = require('../utils/route-error');
const { requireVerifiedHostPhone } = require('../utils/host-auth');

module.exports = function mountRosterRoutes(app) {
  // Everyone this host has ever played with: their saved roster rows, plus anyone who has
  // appeared in one of their games. Roster values win over whatever a player typed at signup.
  app.get(
    '/api/roster/:phone',
    requireVerifiedHostPhone({ allowGameToken: true }),
    async (req, res) => {
    try {
      const hostPhone = formatPhoneNumber(req.params.phone);

      const roster = await getVisibleHostRoster(hostPhone);

      res.json({ phoneNumber: hostPhone, count: roster.length, roster });
    } catch (error) {
      routeFailed(req, res, error, 'Failed to load roster');
    }
    }
  );

  // Host edits one player's details.
  app.put(
    '/api/roster/:phone/:playerPhone',
    requireVerifiedHostPhone(),
    async (req, res) => {
    try {
      const hostPhone = formatPhoneNumber(req.params.phone);
      const playerPhone = formatPhoneNumber(req.params.playerPhone);

      // A number that is not exactly 10 digits can never be texted, and the send path
      // silently drops it - so refuse to store one instead of creating a ghost entry.
      if (hostPhone.length !== 10 || playerPhone.length !== 10) {
        return res.status(400).json({ error: 'Phone numbers need all 10 digits' });
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
    }
  );

  // A host's numbers. This uses the same verified phone session as the roster.
  app.get('/api/stats/:phone', requireVerifiedHostPhone(), async (req, res) => {
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
