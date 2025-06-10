// Add this to a new file: public/js/game-utils.js
// Game expiration utility functions

/**
 * Checks if a game has passed (date + time + duration)
 * @param {string} gameDate - Game date in YYYY-MM-DD format
 * @param {string} gameTime - Game time in HH:MM format  
 * @param {number} duration - Game duration in minutes
 * @returns {boolean} True if game has completely finished
 */
function isGameExpired(gameDate, gameTime, duration = 0) {
    if (!gameDate || !gameTime) return false;
    
    try {
        // Parse the game date and time properly
        const [year, month, day] = gameDate.split('-');
        const [hours, minutes] = gameTime.split(':');
        
        // Create the complete game start datetime in local timezone
        const gameStartTime = new Date(year, month - 1, day, hours, minutes);
        
        // Add duration to get game end time
        const gameEndTime = new Date(gameStartTime.getTime() + (duration * 60 * 1000));
        
        const now = new Date();
        
        console.log('[GAME EXPIRY] Game start:', gameStartTime);
        console.log('[GAME EXPIRY] Game end:', gameEndTime);
        console.log('[GAME EXPIRY] Current time:', now);
        console.log('[GAME EXPIRY] Is expired:', gameEndTime < now);
        
        // Game is expired if the end time has passed
        return gameEndTime < now;
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
            message: 'This game has been cancelled',
            canJoin: false,
            canEdit: false
        };
    }
    
    if (isGameExpired(game.date, game.time, game.duration)) {
        return {
            type: 'expired',
            message: 'This game has ended',
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
            return `${diffDays} day${diffDays > 1 ? 's' : ''} away`;
        } else if (diffHours > 0) {
            return `${diffHours} hour${diffHours > 1 ? 's' : ''} away`;
        } else {
            const diffMinutes = Math.floor(diffMs / (1000 * 60));
            return `${diffMinutes} minute${diffMinutes > 1 ? 's' : ''} away`;
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