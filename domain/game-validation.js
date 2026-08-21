/**
 * What a game has to look like before it is created or edited.
 *
 * This sits in front of domain/game-factory.js and utils/game-update.js, which both trusted
 * whatever the request contained: `parseInt(formData.duration)` on "soon" stored NaN, a
 * totalPlayers of -4 created a game nobody could join, and `date: "next tuesday"` produced a
 * game whose reminder never fired because no clock could parse it. Neither of those files
 * changed - they still build and apply. They are simply no longer the first thing to see the
 * request.
 *
 * The bounds are deliberately wider than the create and manage forms allow (duration min=30
 * step=15, players min=1 max=50), so a host filling the form in normally can never meet one.
 * They exist to stop values the forms cannot produce.
 */
const PlayerCapacity = require('../public/js/player-capacity');
const {
  requiredText,
  optionalText,
  calendarDate,
  clockTime,
  wholeNumber,
  choice,
  optionalUsPhone,
  objectBody,
  flag,
  hasField,
  invalid
} = require('../utils/request-validation');

const LOCATION_MAX = 200;
const ORGANIZER_NAME_MAX = 100;
const MESSAGE_MAX = 2000;
const PERSONALITY_ID_MAX = 64;
const HOST_NOTES_MAX = 5000;
const CANCELLATION_REASON_MAX = 500;

const DURATION_MIN_MINUTES = 15;
const DURATION_MAX_MINUTES = 1440;

const ADDITIONAL_PLAYERS_MAX = 99;
const TOTAL_PLAYERS_MIN = 1;
const TOTAL_PLAYERS_MAX = 100;

const REGISTRATION_MODES = ['fcfs', 'waitlist'];

// The organizer's own wording, kept exactly as it was: this is the one message on this path a
// host filling the form in normally can actually see.
const ORGANIZER_PHONE_MESSAGE = 'Please enter a valid US phone number for the organizer.';

function validateDuration(value) {
  return wholeNumber(value, 'The duration in minutes', {
    min: DURATION_MIN_MINUTES,
    max: DURATION_MAX_MINUTES
  });
}

function validateAdditionalPlayers(value) {
  return wholeNumber(value, 'The number of players needed', {
    min: 0,
    max: ADDITIONAL_PLAYERS_MAX
  });
}

function validateTotalPlayers(value) {
  return wholeNumber(value, 'The player count', {
    min: TOTAL_PLAYERS_MIN,
    max: TOTAL_PLAYERS_MAX
  });
}

/**
 * The create-game request, normalized into exactly what createGameData reads.
 *
 * Capacity arrives one of two ways - the forms send `playersNeeded` (players besides the
 * organizer), older and test clients send `totalPlayers` - and both end up as a bounded
 * totalPlayers here so the factory never has to guess.
 */
function validateGameCreate(body) {
  const data = objectBody(body, 'The game');
  const organizerPlaying = flag(data.organizerPlaying);

  const totalPlayers = hasField(data, 'playersNeeded')
    ? PlayerCapacity.totalFromAdditional(
        validateAdditionalPlayers(data.playersNeeded),
        organizerPlaying
      )
    : validateTotalPlayers(data.totalPlayers);

  // Reachable only through playersNeeded: 0 players besides an organizer who is not playing
  // is a game with nobody in it.
  if (totalPlayers < TOTAL_PLAYERS_MIN) {
    invalid('A game needs room for at least one player.');
  }

  const organizerPhone = optionalUsPhone(data.organizerPhone, 'The organizer phone number', {
    message: ORGANIZER_PHONE_MESSAGE
  });
  // hostPhone is what the game is filed under for the host's own lookups; the create form sends
  // the same number in both fields, and older clients sent only one of them.
  const hostPhone = hasField(data, 'hostPhone') && data.hostPhone
    ? optionalUsPhone(data.hostPhone, 'The organizer phone number', {
        message: ORGANIZER_PHONE_MESSAGE
      })
    : organizerPhone;

  if (hasField(data, 'notificationPreferences') && data.notificationPreferences != null) {
    objectBody(data.notificationPreferences, 'The notification preferences');
  }

  return {
    location: requiredText(data.location, 'The court or location', { max: LOCATION_MAX }),
    organizerName: optionalText(data.organizerName, 'The organizer name', {
      max: ORGANIZER_NAME_MAX,
      fallback: 'Organizer'
    }),
    organizerPhone,
    hostPhone: hostPhone || null,
    organizerPlaying,
    date: calendarDate(data.date, 'The game date'),
    time: clockTime(data.time, 'The start time'),
    duration: validateDuration(data.duration),
    totalPlayers,
    message: optionalText(data.message, 'The message to invitees', { max: MESSAGE_MAX }),
    registrationMode: hasField(data, 'registrationMode') && data.registrationMode != null
      ? choice(data.registrationMode, 'The registration mode', REGISTRATION_MODES)
      : 'fcfs',
    personalityId: optionalText(data.personalityId, 'The personality', {
      max: PERSONALITY_ID_MAX,
      fallback: 'realist'
    }),
    notificationPreferences: data.notificationPreferences
  };
}

/**
 * The edit-game request. Only the fields actually present are checked, because the management
 * page sends the whole form while other callers send one field, and both are allowed.
 *
 * Everything else in the body is passed through untouched: applyGameUpdate has its own
 * allowlist, and the route still reads notifyPlayers and the notification preferences from
 * what comes back.
 */
function validateGameUpdate(body) {
  const data = objectBody(body, 'The game update');
  const clean = { ...data };

  if (hasField(data, 'location')) {
    clean.location = requiredText(data.location, 'The court or location', { max: LOCATION_MAX });
  }
  if (hasField(data, 'date')) {
    clean.date = calendarDate(data.date, 'The game date');
  }
  if (hasField(data, 'time')) {
    clean.time = clockTime(data.time, 'The start time');
  }
  if (hasField(data, 'duration')) {
    clean.duration = validateDuration(data.duration);
  }
  if (hasField(data, 'playersNeeded')) {
    clean.playersNeeded = validateAdditionalPlayers(data.playersNeeded);
  }
  if (hasField(data, 'totalPlayers')) {
    clean.totalPlayers = validateTotalPlayers(data.totalPlayers);
  }
  if (hasField(data, 'message')) {
    clean.message = optionalText(data.message, 'The message to invitees', { max: MESSAGE_MAX });
  }
  if (hasField(data, 'registrationMode')) {
    clean.registrationMode = choice(data.registrationMode, 'The registration mode', REGISTRATION_MODES);
  }
  if (hasField(data, 'personalityId')) {
    clean.personalityId = requiredText(data.personalityId, 'The personality', {
      max: PERSONALITY_ID_MAX
    });
  }
  if (hasField(data, 'notificationPreferences') && data.notificationPreferences != null) {
    objectBody(data.notificationPreferences, 'The notification preferences');
  }

  return clean;
}

/** The host's private notes. No expiry and no cancelled check - see the route. */
function validateHostNotes(value) {
  return optionalText(value, 'Your notes', { max: HOST_NOTES_MAX });
}

/** Why a game is off. Optional: a host can cancel without giving a reason. */
function validateCancellationReason(value) {
  return optionalText(value, 'The cancellation reason', { max: CANCELLATION_REASON_MAX });
}

module.exports = {
  validateGameCreate,
  validateGameUpdate,
  validateHostNotes,
  validateCancellationReason,
  REGISTRATION_MODES,
  DURATION_MIN_MINUTES,
  DURATION_MAX_MINUTES,
  TOTAL_PLAYERS_MIN,
  TOTAL_PLAYERS_MAX,
  ADDITIONAL_PLAYERS_MAX,
  LOCATION_MAX,
  ORGANIZER_NAME_MAX,
  MESSAGE_MAX,
  HOST_NOTES_MAX,
  CANCELLATION_REASON_MAX
};
