// Add this to a new file: public/js/game-utils.js
// Game expiration utility functions

/**
 * Gets the Central Time (America/Chicago) offset for a given date.
 * US DST: 2nd Sunday March - 1st Sunday November.
 * @param {number} year
 * @param {number} month 1-12
 * @param {number} day
 * @returns {string} ISO offset e.g. '-05:00' (CDT) or '-06:00' (CST)
 */
function getCentralOffset(year, month, day) {
    // DST in US: 2nd Sunday March to 1st Sunday November
    const isDST = (m, d) => {
        if (m < 3 || m > 11) return false;
        if (m > 3 && m < 11) return true;
        if (m === 3) {
            const firstOfMonth = new Date(year, 2, 1);
            const dayOfWeek = firstOfMonth.getDay();
            const secondSunday = 1 + (7 - dayOfWeek) % 7 + 7;
            return d >= secondSunday;
        }
        if (m === 11) {
            const firstOfMonth = new Date(year, 10, 1);
            const dayOfWeek = firstOfMonth.getDay();
            const firstSunday = 1 + (7 - dayOfWeek) % 7;
            return d < firstSunday;
        }
        return false;
    };
    return isDST(month, day) ? '-05:00' : '-06:00';
}

/**
 * Checks if a game has passed (date + time + duration).
 * Uses America/Chicago (Central Time) since games are scheduled in Central.
 * @param {string} gameDate - Game date in YYYY-MM-DD format
 * @param {string} gameTime - Game time in HH:MM format
 * @param {number} duration - Game duration in minutes
 * @returns {boolean} True if game has completely finished
 */
function isGameExpired(gameDate, gameTime, duration = 0) {
    if (!gameDate || !gameTime) return false;

    try {
        const [year, month, day] = gameDate.split('-').map(Number);
        const [hours, minutes] = gameTime.split(':').map(Number);
        if (isNaN(year) || isNaN(month) || isNaN(day) || isNaN(hours) || isNaN(minutes)) {
            return false;
        }

        const totalMins = (minutes || 0) + (duration || 0);
        const endHours = hours + Math.floor(totalMins / 60);
        const endMinutes = totalMins % 60;
        const endTimeStr = `${String(endHours).padStart(2, '0')}:${String(endMinutes).padStart(2, '0')}:00`;

        const offset = getCentralOffset(year, month, day);
        const gameEndISO = `${gameDate}T${endTimeStr}${offset}`;
        const gameEnd = new Date(gameEndISO);
        const now = new Date();

        if (isNaN(gameEnd.getTime())) {
            return false;
        }

        return now > gameEnd;
    } catch (error) {
        console.error('[GAME EXPIRY] Error checking game expiration:', error);
        return false;
    }
}

/**
 * Gets a human-readable status for a game
 * @param {Object} game - Game object with date, time, duration, cancelled properties
 * @returns {Object} Status object with type and message
 */
function getGameStatus(game) {
    if (game.cancelled) {
        return {
            type: 'cancelled',
            message: 'This game has been cancelled.',
            canJoin: false,
            canEdit: false
        };
    }
    
    if (isGameExpired(game.date, game.time, game.duration)) {
        return {
            type: 'expired',
            message: 'This game has ended.',
            canJoin: false,
            canEdit: false
        };
    }
    
    return {
        type: 'active',
        message: 'Game is active',
        canJoin: true,
        canEdit: true
    };
}

/**
 * Formats time remaining until game starts
 * @param {string} gameDate - Game date in YYYY-MM-DD format
 * @param {string} gameTime - Game time in HH:MM format
 * @returns {string} Human readable time remaining
 */
function getTimeUntilGame(gameDate, gameTime) {
    if (!gameDate || !gameTime) return '';
    
    try {
        const [year, month, day] = gameDate.split('-');
        const [hours, minutes] = gameTime.split(':');
        const gameDateTime = new Date(year, month - 1, day, hours, minutes);
        const now = new Date();
        
        const diffMs = gameDateTime.getTime() - now.getTime();
        
        if (diffMs < 0) {
            return 'Game has started';
        }
        
        const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
        const diffDays = Math.floor(diffHours / 24);
        
        if (diffDays > 0) {
            return `${diffDays} day${diffDays !== 1 ? 's' : ''} away`;
        } else if (diffHours > 0) {
            return `${diffHours} hour${diffHours !== 1 ? 's' : ''} away`;
        } else {
            const diffMinutes = Math.floor(diffMs / (1000 * 60));
            return `${diffMinutes} minute${diffMinutes !== 1 ? 's' : ''} away`;
        }
    } catch (error) {
        return '';
    }
}

// Export for use in other scripts
if (typeof window !== 'undefined') {
    window.GameUtils = {
        isGameExpired,
        getGameStatus,
        getTimeUntilGame
    };
}
// Export for Node (tests)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { isGameExpired, getGameStatus, getTimeUntilGame };
}