// What a signup has to look like before anything is stored.
//
// The validator library is gone: its isMobilePhone check was wrapped in so many fallbacks
// (a try/catch, a lenient 10-15 digit branch here, another in the signup route) that any
// 10-15 digit string was accepted anyway. One shared digits-only rule in utils/sms-format.js
// now decides, and it matches what Textbelt can deliver to.
const { formatPhoneNumber, isValidUsPhone } = require('../utils/sms-format');

function validatePlayerData(name, phone) {
  const cleanName = name ? name.trim() : '';
  const cleanPhone = phone ? phone.trim() : '';

  if (!cleanName) {
    throw new Error('Player name is required.');
  }

  if (cleanPhone && !isValidUsPhone(cleanPhone)) {
    throw new Error('Please enter a valid US phone number — for example 555-123-4567.');
  }

  return {
    name: cleanName,
    phone: cleanPhone ? formatPhoneNumber(cleanPhone) : ''
  };
}

module.exports = {
  validatePlayerData
};
