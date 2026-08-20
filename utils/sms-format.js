function formatPhoneNumber(phoneNumber) {
  const cleaned = String(phoneNumber == null ? '' : phoneNumber).replace(/\D/g, '');
  if (cleaned.length === 10) return cleaned;
  if (cleaned.length === 11 && cleaned.startsWith('1')) return cleaned.substring(1);
  return cleaned;
}

// The one US phone rule for the whole app: valid when the digits alone are a 10-digit
// number, or 11 digits with the leading country-code 1. Anything else cannot receive a
// Textbelt message, so accepting it just records a number nobody can text.
function isValidUsPhone(phoneNumber) {
  const cleaned = String(phoneNumber == null ? '' : phoneNumber).replace(/\D/g, '');
  return cleaned.length === 10 || (cleaned.length === 11 && cleaned.startsWith('1'));
}

// The one phone form allowed in a log line: enough to tell two players apart while never
// writing a full number where logs are kept.
function maskPhone(phoneNumber) {
  const digits = String(phoneNumber == null ? '' : phoneNumber).replace(/\D/g, '');
  return digits.length >= 4 ? `***${digits.slice(-4)}` : '(no phone)';
}

function formatDateForSMS(dateStr) {
  const calendarDate = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr));
  const date = calendarDate
    ? new Date(Date.UTC(
        Number(calendarDate[1]),
        Number(calendarDate[2]) - 1,
        Number(calendarDate[3])
      ))
    : new Date(dateStr);

  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    // A game's YYYY-MM-DD value is a calendar date, not a moment in time. Formatting it in
    // UTC preserves that exact date instead of shifting it backward on Central Time servers.
    ...(calendarDate ? { timeZone: 'UTC' } : {})
  });
}

function formatTimeForSMS(timeStr) {
  const [hours, minutes] = timeStr.split(':');
  const hour = parseInt(hours);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const hour12 = hour % 12 || 12;
  return `${hour12}:${minutes} ${ampm}`;
}

function formatLocationForSMS(game) {
  return game.location || '';
}

module.exports = {
  formatPhoneNumber,
  isValidUsPhone,
  maskPhone,
  formatDateForSMS,
  formatTimeForSMS,
  formatLocationForSMS
};
