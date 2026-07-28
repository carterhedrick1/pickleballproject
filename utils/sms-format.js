function formatPhoneNumber(phoneNumber) {
  const cleaned = String(phoneNumber == null ? '' : phoneNumber).replace(/\D/g, '');
  if (cleaned.length === 10) return cleaned;
  if (cleaned.length === 11 && cleaned.startsWith('1')) return cleaned.substring(1);
  return cleaned;
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
  formatDateForSMS,
  formatTimeForSMS,
  formatLocationForSMS
};
