/**
 * Turns recorded SMS events into a list a host can read.
 *
 * sms_events stores a hash of the recipient's number rather than the number itself, so the only
 * way to put a name on a row is to hash the numbers this game already knows and match. That is
 * a feature, not a workaround: the log can never name somebody the host cannot already see.
 *
 * The hash function is passed in so this stays a pure function with no database behind it.
 */
const { SMS_EVENT_DEFINITIONS } = require('../sms-event-catalog');

const EVENT_TITLES = new Map(SMS_EVENT_DEFINITIONS.map((event) => [event.id, event.title]));

const UNKNOWN_RECIPIENT = 'Someone no longer on this game';

function knownRecipients(game, hashPhone) {
  const known = new Map();
  const remember = (person, role) => {
    if (!person || !person.phone) return;
    const hash = hashPhone(person.phone);
    // First mention wins, so somebody's current role beats an older one.
    if (!known.has(hash)) {
      known.set(hash, { name: person.name || person.phone, phone: person.phone, role });
    }
  };

  for (const player of (game && game.players) || []) {
    remember(player, player.isOrganizer ? 'organizer' : 'confirmed');
  }
  for (const player of (game && game.waitlist) || []) remember(player, 'waitlist');
  for (const player of (game && game.outPlayers) || []) remember(player, 'out');
  for (const person of (game && game.invitedPlayers) || []) remember(person, 'invited');
  if (game && game.hostPhone) {
    remember({ phone: game.hostPhone, name: game.organizerName || 'You' }, 'organizer');
  }

  return known;
}

function describeSmsEvents(game, rows = [], hashPhone) {
  const known = knownRecipients(game, hashPhone);

  const events = rows.map((row) => {
    const person = known.get(row.recipientHash);
    return {
      event: EVENT_TITLES.get(row.eventId) || 'Other Text',
      eventId: row.eventId,
      name: person ? person.name : UNKNOWN_RECIPIENT,
      phone: person ? person.phone : null,
      role: person ? person.role : null,
      status: row.status,
      attempts: row.attempts,
      error: row.error || null,
      sentAt: row.sentAt
    };
  });

  const counts = events.reduce((totals, event) => {
    totals[event.status] = (totals[event.status] || 0) + 1;
    return totals;
  }, {});

  return { events, counts };
}

module.exports = {
  UNKNOWN_RECIPIENT,
  knownRecipients,
  describeSmsEvents
};
