(function attachPageUtils(root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.PageUtils = api;
})(typeof window !== 'undefined' ? window : globalThis, function buildPageUtils() {
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

    function belongsInPastGames(game, now = new Date()) {
        return Boolean(game?.cancelled) ||
            isGameCompleted(game?.date, game?.time, now);
    }

    function canPermanentlyDelete(game, now = new Date()) {
        return Boolean(game?.cancelled) ||
            isGameCompleted(game?.date, game?.time, now);
    }

    return {
        parseLocalDate,
        formatLocalDate,
        formatTime12Hour,
        formatDuration,
        formatTimeAgo,
        isGameCompleted,
        belongsInPastGames,
        canPermanentlyDelete
    };
});
