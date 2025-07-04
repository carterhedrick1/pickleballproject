// public/js/invitation-generator.js - Fixed registration mode handling

/**
 * Generates a complete invitation message for a pickleball game
 * @param {Object} gameData - Game information
 * @param {string} gameData.location - Game location
 * @param {string} gameData.courtNumber - Court number (optional)
 * @param {string} gameData.date - Game date (YYYY-MM-DD format)
 * @param {string} gameData.time - Game time (HH:MM format)
 * @param {number} gameData.duration - Game duration in minutes
 * @param {number} gameData.totalPlayers - Total number of players
 * @param {boolean} gameData.organizerPlaying - Whether organizer is playing
 * @param {string} gameData.registrationMode - Registration mode ('fcfs' or 'waitlist')
 * @param {string} gameData.message - Optional message (optional)
 * @param {string} gameId - Game ID for generating the link
 * @param {string} baseUrl - Base URL for the application (optional, defaults to current origin)
 * @returns {string} Complete invitation message
 */
function generateInvitationMessage(gameData, gameId, baseUrl = null) {
    // Use current origin if baseUrl not provided
    const base = baseUrl || window.location.origin;
    const gameLink = `${base}/game.html?id=${gameId}`;
    
    // Format date without timezone issues
    const formattedDate = formatDateForDisplay(gameData.date);
    const formattedTime = formatTime(gameData.time);
    
    // Build location text with court number if provided
    let locationText = gameData.location;
    if (gameData.courtNumber && gameData.courtNumber.trim()) {
        locationText += ` - ${gameData.courtNumber}`;
    }
    
    // Calculate available spots
    const totalPlayers = parseInt(gameData.totalPlayers);
    const organizerPlaying = gameData.organizerPlaying !== false; // Default to true if not specified
    const availableSpots = organizerPlaying ? totalPlayers - 1 : totalPlayers;
    
    // Handle singular/plural spots
    const spotsText = availableSpots === 1 ? 'Spot' : 'Spots';
    const spotsWord = availableSpots === 1 ? 'spot' : 'spots';
    
    // Get registration mode - check multiple possible property names
    const registrationMode = gameData.registrationMode || gameData.gameMode || 'fcfs';
    
    console.log('[INVITATION] Registration mode detected:', registrationMode); // Debug log
    console.log('[INVITATION] Game data:', gameData); // Debug log
    
    // Determine if we should add "First X are in" mes
    // sage
    // Only show for first-come-first-serve mode
    const isFirstCome = registrationMode === 'fcfs';
    
    const firstComeMessage = isFirstCome ? `\nFirst ${availableSpots} are in.` : '';
    
    console.log('[INVITATION] First come mode:', isFirstCome, '- Message:', firstComeMessage); // Debug log
    
    // Build the complete invitation message
    const message = `Let us know if you're IN or OUT for pickleball by clicking the link below:  

${gameLink}

Location: ${locationText}
Date: ${formattedDate}
Time: ${formattedTime}
Duration: ${gameData.duration} minutes
${spotsText}: ${availableSpots} 
${gameData.message ? '\n' + gameData.message : ''}

Even if you can't make it, your response helps us plan and find additional players if needed. Please use the link above to respond - do not reply to this text message.
${firstComeMessage}

`;

    console.log('[INVITATION] Final message generated:', message); // Debug log
    return message;
}

/**
 * Formats a date string for display without timezone issues
 * @param {string} dateStr - Date in YYYY-MM-DD format
 * @returns {string} Formatted date string
 */
function formatDateForDisplay(dateStr) {
    if (!dateStr) return '';
    
    // Parse as local date to avoid timezone shift
    const [year, month, day] = dateStr.split('-');
    const date = new Date(year, month - 1, day); // Local date constructor
    
    return date.toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric'
    });
}

/**
 * Formats a time string for display
 * @param {string} timeStr - Time in HH:MM format
 * @returns {string} Formatted time string
 */
function formatTime(timeStr) {
    if (!timeStr) return '';
    const [hours, minutes] = timeStr.split(':');
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const hour12 = hour % 12 || 12;
    return `${hour12}:${minutes} ${ampm}`;
}

/**
 * Copies the invitation message to clipboard and shows feedback
 * @param {Object} gameData - Game information
 * @param {string} gameId - Game ID
 * @param {string} buttonId - ID of the button to show feedback on
 * @param {string} baseUrl - Base URL (optional)
 */
function copyInvitationToClipboard(gameData, gameId, buttonId, baseUrl = null) {
    console.log('[COPY] Copying invitation with game data:', gameData); // Debug log
    
    const message = generateInvitationMessage(gameData, gameId, baseUrl);
    
    try {
        // Try modern clipboard API first
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(message).then(() => {
                showCopyFeedback(buttonId, '✅ Message Copied!');
            }).catch(() => {
                // Fallback for clipboard API failure
                fallbackCopy(message, buttonId);
            });
        } else {
            // Fallback for older browsers
            fallbackCopy(message, buttonId);
        }
    } catch (err) {
        // Final fallback
        fallbackCopy(message, buttonId);
    }
}

/**
 * Fallback copy method for older browsers
 * @param {string} text - Text to copy
 * @param {string} buttonId - Button ID for feedback
 */
function fallbackCopy(text, buttonId) {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-999999px';
    textArea.style.top = '-999999px';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    
    try {
        document.execCommand('copy');
        showCopyFeedback(buttonId, '✅ Message Copied!');
    } catch (err) {
        console.error('Failed to copy text: ', err);
        showCopyFeedback(buttonId, '❌ Copy Failed', true);
    }
    
    document.body.removeChild(textArea);
}

/**
 * Shows feedback on the copy button
 * @param {string} buttonId - ID of the button
 * @param {string} message - Feedback message
 * @param {boolean} isError - Whether this is an error message
 */
function showCopyFeedback(buttonId, message, isError = false) {
    const button = document.getElementById(buttonId);
    if (!button) return;
    
    const originalText = button.textContent;
    const originalStyle = {
        background: button.style.background,
        color: button.style.color
    };
    
    // Update button appearance
    button.textContent = message;
    if (isError) {
        button.style.background = 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)';
    } else {
        button.style.background = 'linear-gradient(135deg, #4CAF50 0%, #45a049 100%)';
    }
    
    // Reset after 3 seconds
    setTimeout(() => {
        button.textContent = originalText;
        button.style.background = originalStyle.background;
        button.style.color = originalStyle.color;
    }, 3000);
}

/**
 * Gets current game data from localStorage (for recently created games)
 * @returns {Object} Game data object
 */
function getCurrentGameDataFromStorage() {
    const myGames = JSON.parse(localStorage.getItem('myGames') || '[]');
    
    if (myGames.length === 0) {
        return {
            location: 'Game Location',
            courtNumber: '',
            date: new Date().toISOString().split('T')[0], // Today's date
            time: '18:00', // 6 PM default
            duration: '90',
            totalPlayers: '4',
            organizerPlaying: true,
            registrationMode: 'fcfs', // Ensure this is set
            message: ''
        };
    }
    
    // Return the most recent game
    const mostRecentGame = myGames[myGames.length - 1];
    
    // Ensure registrationMode is set, default to 'fcfs' if missing
    if (!mostRecentGame.registrationMode) {
        mostRecentGame.registrationMode = 'fcfs';
    }
    
    console.log('[STORAGE] Retrieved game data:', mostRecentGame); // Debug log
    
    return mostRecentGame;
}

// Export functions for use in other scripts
window.InvitationGenerator = {
    generateInvitationMessage,
    copyInvitationToClipboard,
    getCurrentGameDataFromStorage,
    formatDateForDisplay,
    formatTime
};