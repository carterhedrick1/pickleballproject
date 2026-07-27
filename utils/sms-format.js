function formatPhoneNumber(phoneNumber) {
  const cleaned = String(phoneNumber == null ? '' : phoneNumber).replace(/\D/g, '');
  if (cleaned.length === 10) return cleaned;
  if (cleaned.length === 11 && cleaned.startsWith('1')) return cleaned.substring(1);
  return cleaned;
}

function formatDateForSMS(dateStr) {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric'
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
  let locationText = game.location || '';
  if (game.courtNumber && game.courtNumber.trim()) {
    locationText += ` - ${game.courtNumber}`;
  }
  return locationText;
}

module.exports = {
  formatPhoneNumber,
  formatDateForSMS,
  formatTimeForSMS,
  formatLocationForSMS
};
