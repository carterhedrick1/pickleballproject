// What a signup has to look like before anything is stored.
//
// The validator library is gone: its isMobilePhone check was wrapped in so many fallbacks
// (a try/catch, a lenient 10-15 digit branch here, another in the signup route) that any
// 10-15 digit string was accepted anyway. One shared digits-only rule in utils/sms-format.js
// now decides, and it matches what Textbelt can deliver to.
const { requiredText, optionalUsPhone } = require('../utils/request-validation');

const PLAYER_NAME_MAX = 100;
const PHONE_MESSAGE = 'Please enter a valid US phone number — for example 555-123-4567.';

function validatePlayerData(name, phone) {
  // Both messages and the order they are decided in are unchanged: a player reads them on the
  // signup form. What changed is the failure - a ValidationError, which utils/route-error.js
  // answers with 400 wherever it is thrown. The host's manual-add route had no catch of its
  // own for this and answered a missing name with a 500.
  return {
    name: requiredText(name == null ? '' : name, 'Player name', { max: PLAYER_NAME_MAX }),
    phone: optionalUsPhone(phone, 'The phone number', { message: PHONE_MESSAGE })
  };
}

module.exports = {
  validatePlayerData,
  PLAYER_NAME_MAX,
  PHONE_MESSAGE
};
