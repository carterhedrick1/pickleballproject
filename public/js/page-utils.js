// Dates, times and elapsed-time phrases, spelled the same way on every page.
//
// These are the browser's half of how a game reads: the *browser's* local calendar, for filling
// in a form and saying "3 hours ago". Whether a game has started or ended is a different
// question with a Central Time answer, and that lives in central-time.js.
function parseLocalDate(dateStr) {
    if (!dateStr) return null;
    const [year, month, day] = String(dateStr).split('-').map(Number);
    if (![year, month, day].every(Number.isFinite)) return null;
    return new Date(year, month - 1, day);
}

function formatLocalDate(dateStr, options) {
    const date = parseLocalDate(dateStr);
    return date
        ? date.toLocaleDateString('en-US', options)
        : '';
}

function formatTime12Hour(timeStr) {
    if (!timeStr) return '';
    const [hours, minutes] = String(timeStr).split(':');
    const hour = parseInt(hours, 10);
    if (!Number.isFinite(hour) || minutes === undefined) return '';
    return `${hour % 12 || 12}:${minutes} ${hour >= 12 ? 'PM' : 'AM'}`;
}

function isGameCompleted(gameDate, gameTime, now = new Date()) {
    if (!gameDate || !gameTime) return false;
    const [year, month, day] = String(gameDate).split('-').map(Number);
    const [hours, minutes] = String(gameTime).split(':').map(Number);
    if (![year, month, day, hours, minutes].every(Number.isFinite)) return false;
    return new Date(year, month - 1, day, hours, minutes) < now;
}

// "3 hours" reads better than a timestamp on a roster a host scans in a hurry, and it is
// the same phrase whether it answers "when did they sign up" or "how long have they waited".
function formatDuration(fromIso, now = new Date()) {
    if (!fromIso) return '';
    const started = new Date(fromIso);
    if (isNaN(started.getTime())) return '';

    const minutes = Math.floor((now.getTime() - started.getTime()) / 60000);
    if (minutes < 0) return 'just now';
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;

    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;

    const days = Math.floor(hours / 24);
    return `${days} ${days === 1 ? 'day' : 'days'}`;
}

function formatTimeAgo(fromIso, now = new Date()) {
    const duration = formatDuration(fromIso, now);
    if (!duration) return '';
    return duration === 'just now' ? 'just now' : `${duration} ago`;
}

// Repeating a game means next week, same day, same time. Stepping in weeks rather than
// "today plus seven" keeps a Tuesday game on a Tuesday however long ago it was played.
function nextWeeklyDate(dateStr, now = new Date()) {
    const original = parseLocalDate(dateStr);
    if (!original) return '';

    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const next = new Date(original.getFullYear(), original.getMonth(), original.getDate());
    while (next <= today) {
        next.setDate(next.getDate() + 7);
    }

    const pad = (value) => String(value).padStart(2, '0');
    return `${next.getFullYear()}-${pad(next.getMonth() + 1)}-${pad(next.getDate())}`;
}

function belongsInPastGames(game, now = new Date()) {
    return Boolean(game?.cancelled) ||
        isGameCompleted(game?.date, game?.time, now);
}

function canPermanentlyDelete(game, now = new Date()) {
    return Boolean(game?.cancelled) ||
        isGameCompleted(game?.date, game?.time, now);
}

export {
    parseLocalDate,
    formatLocalDate,
    formatTime12Hour,
    formatDuration,
    formatTimeAgo,
    nextWeeklyDate,
    isGameCompleted,
    belongsInPastGames,
    canPermanentlyDelete
};
