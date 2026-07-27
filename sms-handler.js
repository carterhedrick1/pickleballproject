// Compatibility facade. Callers can keep requiring ./sms-handler while the
// provider, formatting, and inbound command responsibilities live separately.
const {
  handleIncomingSMS,
  sendOrganizerNotification
} = require('./services/sms-webhook');
const {
  sendSMS,
  sendSMSWithRetry
} = require('./services/sms-client');
const {
  formatPhoneNumber,
  formatDateForSMS,
  formatTimeForSMS,
  formatLocationForSMS
} = require('./utils/sms-format');

module.exports = {
  sendSMS,
  sendSMSWithRetry,
  handleIncomingSMS,
  sendOrganizerNotification,
  formatPhoneNumber,
  formatDateForSMS,
  formatTimeForSMS,
  formatLocationForSMS
};
