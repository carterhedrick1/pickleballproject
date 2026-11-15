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

const UNKNOWN_RECIPIENT = 'Name Unavailable';

function knownRecipients(game, hashPhone) {
  const known = new Map();
  const remember = (person, role) => {
    if (!person || !person.phone) return;
    const digits = String(person.phone).replace(/\D/g, '');
    const formats = [person.phone];
    // Incoming replies include +1 while saved US numbers often have ten digits. Match both
    // historical hashes without rewriting telemetry or treating other country codes as US.
    if (digits.length === 10) formats.push(`1${digits}`);
    if (digits.length === 11 && digits.startsWith('1')) formats.push(digits.slice(1));
    for (const phone of formats) {
      const hash = hashPhone(phone);
      // First mention wins, so somebody's current role beats an older one in either format.
      if (!known.has(hash)) {
        known.set(hash, { name: person.name || person.phone, phone: person.phone, role });
      }
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
