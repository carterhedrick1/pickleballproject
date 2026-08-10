// Describes what a host actually changed about a game, in the words a player needs.
//
// Editing a game used to save silently and leave the host to go write an announcement, which
// is how four people end up at a court thirty minutes after everyone else left. Only the
// fields a player would show up wrong for count as notifiable: where, when, and how long.
// Changing the message copy, the personality, or the host's own alert preferences is not
// something to text anybody about.

const { formatDateForSMS, formatTimeForSMS, formatLocationForSMS } = require('../sms-handler');

const NOTIFIABLE_FIELDS = Object.freeze(['location', 'date', 'time', 'duration']);

function describeValue(field, game) {
  switch (field) {
    case 'location':
      return formatLocationForSMS(game);
    case 'date':
      return formatDateForSMS(game.date);
    case 'time':
      return formatTimeForSMS(game.time);
    case 'duration':
      return `${game.duration} minutes`;
    default:
      return String(game[field] == null ? '' : game[field]);
  }
}

/** A snapshot of only the fields worth comparing, taken before the update is applied. */
function snapshotGame(game) {
  return {
    location: game.location,
    date: game.date,
    time: game.time,
    duration: game.duration
  };
}

/**
 * @returns the list of notifiable fields whose value actually changed.
 */
function changedFields(before, after) {
  return NOTIFIABLE_FIELDS.filter(
    (field) => String(before[field] == null ? '' : before[field]) !==
      String(after[field] == null ? '' : after[field])
  );
}

/**
 * The text players receive. Returns null when nothing player-visible changed, which is what
 * callers use to decide whether to send anything at all.
 */
function buildChangeMessage(before, after, fields = changedFields(before, after)) {
  if (!fields.length) return null;

  const movedCourt = fields.includes('location');
  const movedTime = fields.includes('date') || fields.includes('time');

  const headline = movedCourt && movedTime
    ? 'UPDATED: Your pickleball game moved.'
    : movedCourt
      ? 'UPDATED: Your pickleball game moved courts.'
      : movedTime
        ? 'UPDATED: Your pickleball game changed time.'
        : 'UPDATED: Your pickleball game details changed.';

  // Always restate the whole when-and-where, not just the delta. A player reading
  // "the time changed" still has to go look up what it changed to.
  const details = [
    `${describeValue('location', after)}`,
    `${describeValue('date', after)} at ${describeValue('time', after)}`,
    `Duration: ${describeValue('duration', after)}`
  ].join('\n');

  return `${headline}\n\n${details}\n\nReply 2 for details, or 9 to cancel.`;
}

/** A short past-tense summary for the host's own confirmation toast. */
function summarizeForHost(before, after, fields = changedFields(before, after)) {
  if (!fields.length) return '';
  const labels = {
    location: 'court',
    date: 'date',
    time: 'time',
    duration: 'duration'
  };
  const named = fields.map((field) => labels[field] || field);
  if (named.length === 1) return named[0];
  return `${named.slice(0, -1).join(', ')} and ${named[named.length - 1]}`;
}

module.exports = {
  NOTIFIABLE_FIELDS,
  snapshotGame,
  changedFields,
  buildChangeMessage,
  summarizeForHost
};
