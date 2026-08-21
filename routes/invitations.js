// Texting the invitation, chasing the people who never answered it, and showing the host what
// this game has actually texted to whom.
//
// Every other invite path in the app is a clipboard copy, which is why the app could tell a host
// who replied but never who was asked. This route sends the same invitation body that the Copy
// Invitation button produces - built once in services/invitation-message.js - and writes down
// who it went to and when, so invitedPlayers finally means something.
//
// Only numbers already on the host's saved roster can be texted. The host's own contact list is
// not a broadcast list, and a route that texts arbitrary numbers on request is a route that gets
// used to text arbitrary numbers.

const { getGame, saveGame } = require('../database/games');
const { getSmsEventsForGame, recipientHash } = require('../database/sms-events');

const { describeSmsEvents } = require('../utils/delivery-log');

const { sendSMS } = require('../services/sms-client');
const {
  formatPhoneNumber,
  formatDateForSMS,
  formatTimeForSMS,
  formatLocationForSMS
} = require('../utils/sms-format');

const { acquireGameLock } = require('../utils/game-lock');
const { routeFailed } = require('../utils/route-error');
const { isHost, requestHostToken } = require('../utils/host-auth');
const { list } = require('../utils/request-validation');
const { isGameUpcoming } = require('../public/js/central-time');
const { buildDeterministicInvitation } = require('../services/invitation-message');
const { getVisibleHostRoster } = require('../services/host-roster');
const { resolveTextMessage } = require('../services/text-message-rotation');
const { normalizePhone } = require('../public/js/invite-status');

const MAX_INVITES_PER_REQUEST = 50;
// A far looser bound on the raw list, so the friendly "invite up to 50 at a time" below is
// still what a host with a big roster reads. This one only refuses a body nobody could tick.
const MAX_INVITE_LIST_ENTRIES = 500;
const INVITATION_SEND_CONCURRENCY = 5;

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(Math.max(1, limit), items.length) },
    async () => {
      while (nextIndex < items.length) {
        const index = nextIndex++;
        results[index] = await mapper(items[index], index);
      }
    }
  );
  await Promise.all(workers);
  return results;
}

module.exports = function mountInvitationRoutes(app) {
  // "I never got the reminder" used to be unanswerable. Every send is already recorded; this
  // reads back the rows for one game, named rather than hashed.
  app.get('/api/games/:id/sms-events', async (req, res) => {
    const gameId = req.params.id;
    try {
      const game = await getGame(gameId);
      if (!game) return res.status(404).json({ error: 'Game not found' });
      if (!isHost(game, requestHostToken(req))) {
        return res.status(403).json({ error: 'Unauthorized' });
      }

      const rows = await getSmsEventsForGame(gameId);
      res.json(describeSmsEvents(game, rows, recipientHash));
    } catch (error) {
      routeFailed(req, res, error, 'Failed to load the delivery log');
    }
  });

  app.post('/api/games/:id/invitations', async (req, res) => {
    const gameId = req.params.id;
    try {
      const token = requestHostToken(req);
      const { playerPhones } = req.body || {};

      const game = await getGame(gameId);
      if (!game) return res.status(404).json({ error: 'Game not found' });
      if (!isHost(game, token)) return res.status(403).json({ error: 'Unauthorized' });
      if (game.cancelled) {
        return res.status(400).json({ error: 'This game is cancelled, so there is nobody to invite.' });
      }
      if (!isGameUpcoming(game.date, game.time)) {
        return res.status(400).json({ error: 'This game has already started, so invitations can no longer be sent.' });
      }

      // The list shape is checked before its entries: playerPhones sent as a bare string used
      // to be read as an empty selection and answered "Choose at least one person to invite",
      // which told the caller nothing about what was actually wrong.
      const requested = [...new Set(
        list(playerPhones || [], 'The people to invite', { max: MAX_INVITE_LIST_ENTRIES })
          .map(formatPhoneNumber)
          .filter((phone) => phone.length === 10)
      )];
      if (requested.length === 0) {
        return res.status(400).json({ error: 'Choose at least one person to invite.' });
      }
      if (requested.length > MAX_INVITES_PER_REQUEST) {
        return res.status(400).json({
          error: `Invite up to ${MAX_INVITES_PER_REQUEST} people at a time.`
        });
      }

      // Validate against the exact same union shown in the picker. That includes players from
      // older games created before the separate saved-roster table existed.
      const roster = await getVisibleHostRoster(game.hostPhone);
      const rosterByPhone = new Map(
        roster.map((player) => [formatPhoneNumber(player.phone), player])
      );
      const unknown = requested.filter((phone) => !rosterByPhone.has(phone));
      if (unknown.length) {
        return res.status(400).json({ error: 'Every invitation must go to somebody on your saved roster.' });
      }

      // The body is built once, from the same builder the copy button uses. The editable
      // category can wrap it, but it cannot replace it with something out of date.
      const baseUrl = `${req.protocol}://${req.get('host')}`;
      const invitation = buildDeterministicInvitation(game, gameId, baseUrl);

      // A host normally invites a handful of people. Those texts are independent, so send a
      // small bounded group together instead of making three provider round trips serially.
      // The bound also prevents a 50-person roster from becoming a 50-request burst.
      const results = await mapWithConcurrency(
        requested,
        INVITATION_SEND_CONCURRENCY,
        async (phone) => {
          const message = await resolveTextMessage(
            'game-invitation',
            invitation,
            {
              LOCATION: formatLocationForSMS(game),
              DATE: formatDateForSMS(game.date),
              TIME: formatTimeForSMS(game.time),
              ORGANIZER: game.organizerName || ''
            },
            {
              game,
              gameId,
              recipientPhone: phone,
              audience: 'invitation-copy'
            }
          );
          const result = await sendSMS(phone, message, gameId, { eventId: 'game-invitation' });
          return {
            phone,
            name: rosterByPhone.get(phone).name || '',
            success: Boolean(result.success),
            error: result.success ? null : result.error || 'Text could not be sent'
          };
        }
      );

      // The game is only re-read and written after the texts, so a slow carrier never holds the
      // game lock. Recording a send that failed still matters: the host needs to see the attempt.
      const releaseLock = await acquireGameLock(gameId);
      let invitedPlayers;
      try {
        const current = await getGame(gameId);
        if (!current) return res.status(404).json({ error: 'Game not found' });
        current.invitedPlayers = recordInvitations(current.invitedPlayers, results);
        await saveGame(gameId, current, current.hostToken, current.hostPhone);
        invitedPlayers = current.invitedPlayers;
      } finally {
        releaseLock();
      }

      const sentCount = results.filter((result) => result.success).length;
      res.json({
        success: true,
        sentCount,
        failedCount: results.length - sentCount,
        results,
        invitedPlayers
      });
    } catch (error) {
      routeFailed(req, res, error, 'Failed to send invitations');
    }
  });
};

/** Merges this send into the game's invitee list, keeping the first invitation date. */
function recordInvitations(existing, results, now = new Date().toISOString()) {
  const invited = (existing || []).map((entry) => ({ ...entry }));
  const byPhone = new Map(invited.map((entry) => [normalizePhone(entry.phone), entry]));

  for (const result of results) {
    const key = normalizePhone(result.phone);
    let entry = byPhone.get(key);
    if (!entry) {
      entry = { phone: result.phone, name: result.name };
      invited.push(entry);
      byPhone.set(key, entry);
    }
    if (result.name && !entry.name) entry.name = result.name;
    if (!entry.invitedAt) entry.invitedAt = now;
    entry.lastTextedAt = now;
    entry.textCount = (entry.textCount || 0) + 1;
    entry.lastTextStatus = result.success ? 'sent' : 'failed';
  }

  return invited;
}

module.exports.recordInvitations = recordInvitations;
module.exports.mapWithConcurrency = mapWithConcurrency;
module.exports.INVITATION_SEND_CONCURRENCY = INVITATION_SEND_CONCURRENCY;
