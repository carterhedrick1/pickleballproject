/**
 * The field rules every route checks its request against, and one way of saying no.
 *
 * Each route used to decide for itself what a bad request looked like, so the answers
 * disagreed: a missing player name came back as 400 from the signup route and 500 from the
 * host's manual-add route, a duration of "soon" became NaN and was stored, and a totalPlayers
 * of -4 created a game nobody could join. The primitives here are deliberately small - a
 * shape, a bound, a pattern - and the shapes built from them live next to the rules they
 * belong to (domain/game-validation.js, domain/player-validation.js).
 *
 * Everything throws ValidationError rather than returning a result object, because the route
 * bodies are already inside try/catch: utils/route-error.js recognises the code and answers
 * 400 with the message written here, so a caller error never reaches the Errors tab as if the
 * server had faulted.
 *
 * Phone numbers are not re-decided here. isValidUsPhone in utils/sms-format.js is the one
 * phone rule in the app; usPhone below only adds the wording and the formatting.
 */
const { formatPhoneNumber, isValidUsPhone } = require('./sms-format');

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
    this.code = 'REQUEST_VALIDATION';
    this.status = 400;
  }
}

function invalid(message) {
  throw new ValidationError(message);
}

// Text fields accept a number too - an old client sending `duration: 90` as a string and a new
// one sending it as a number should not get different answers. Objects, arrays and booleans are
// the shapes that actually break things downstream, so those are refused.
function textOrRefuse(value, label) {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  invalid(`${label} must be text.`);
}

function requiredText(value, label, { max = 200 } = {}) {
  if (value == null) invalid(`${label} is required.`);
  const text = textOrRefuse(value, label).trim();
  if (!text) invalid(`${label} is required.`);
  if (text.length > max) invalid(`${label} can be up to ${max} characters.`);
  return text;
}

function optionalText(value, label, { max = 200, fallback = '' } = {}) {
  if (value == null) return fallback;
  const text = textOrRefuse(value, label).trim();
  if (!text) return fallback;
  if (text.length > max) invalid(`${label} can be up to ${max} characters.`);
  return text;
}

const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A calendar date, YYYY-MM-DD, that really exists - 2026-02-30 does not. */
function calendarDate(value, label) {
  if (value == null || (typeof value === 'string' && !value.trim())) {
    invalid(`${label} is required.`);
  }
  const text = textOrRefuse(value, label).trim();
  const match = CALENDAR_DATE.exec(text);
  if (!match) invalid(`${label} must be a date like 2026-08-21.`);

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  // Date.UTC rolls a day past the end of its month into the next one, which is exactly the
  // tell: February 30th comes back as March 2nd.
  const asDate = new Date(Date.UTC(year, month - 1, day));
  if (
    asDate.getUTCFullYear() !== year ||
    asDate.getUTCMonth() !== month - 1 ||
    asDate.getUTCDate() !== day
  ) {
    invalid(`${label} is not a real date.`);
  }
  return text;
}

const CLOCK_TIME = /^([01]\d|2[0-3]):([0-5]\d)(:[0-5]\d)?$/;

/** A 24-hour clock time. Seconds are accepted and dropped: games are scheduled to the minute. */
function clockTime(value, label) {
  if (value == null || (typeof value === 'string' && !value.trim())) {
    invalid(`${label} is required.`);
  }
  const text = textOrRefuse(value, label).trim();
  const match = CLOCK_TIME.exec(text);
  if (!match) invalid(`${label} must be a time like 18:30.`);
  return `${match[1]}:${match[2]}`;
}

function wholeNumber(value, label, { min = null, max = null } = {}) {
  if (value == null || value === '') invalid(`${label} is required.`);
  if (typeof value !== 'string' && typeof value !== 'number') {
    invalid(`${label} must be a number.`);
  }
  const text = String(value).trim();
  if (!/^-?\d+$/.test(text)) invalid(`${label} must be a whole number.`);

  const number = Number(text);
  if (min !== null && max !== null && (number < min || number > max)) {
    invalid(`${label} must be between ${min} and ${max}.`);
  }
  if (min !== null && number < min) invalid(`${label} must be at least ${min}.`);
  if (max !== null && number > max) invalid(`${label} can be at most ${max}.`);
  return number;
}

function choice(value, label, allowed) {
  const text = typeof value === 'string' ? value.trim() : value;
  if (!allowed.includes(text)) {
    invalid(`${label} must be one of: ${allowed.join(', ')}.`);
  }
  return text;
}

/** Delegates to the app's one phone rule and hands back the stored 10-digit form. */
function usPhone(value, label, { message = null } = {}) {
  const text = value == null ? '' : String(value).trim();
  if (!text || !isValidUsPhone(text)) {
    invalid(message || `${label} must be a valid US phone number — for example 555-123-4567.`);
  }
  return formatPhoneNumber(text);
}

function optionalUsPhone(value, label, options) {
  const text = value == null ? '' : String(value).trim();
  if (!text) return '';
  return usPhone(text, label, options);
}

function list(value, label, { min = 0, max = null } = {}) {
  if (!Array.isArray(value)) invalid(`${label} must be a list.`);
  if (value.length < min) {
    invalid(min === 1 ? `${label} needs at least one entry.` : `${label} needs at least ${min} entries.`);
  }
  if (max !== null && value.length > max) {
    invalid(`${label} can contain up to ${max} entries.`);
  }
  return value;
}

/** A JSON object body - not a string, not an array, not null. */
function objectBody(value, label = 'The request body') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    invalid(`${label} must be a JSON object.`);
  }
  return value;
}

/** Checkbox-shaped input: HTML forms send "on", JSON clients send true. */
function flag(value) {
  return value === true || value === 'true' || value === 'on';
}

function hasField(body, field) {
  return Boolean(body) && Object.prototype.hasOwnProperty.call(body, field);
}

module.exports = {
  ValidationError,
  invalid,
  requiredText,
  optionalText,
  calendarDate,
  clockTime,
  wholeNumber,
  choice,
  usPhone,
  optionalUsPhone,
  list,
  objectBody,
  flag,
  hasField
};
