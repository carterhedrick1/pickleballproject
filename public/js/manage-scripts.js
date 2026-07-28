// manage-scripts.js - All JavaScript for manage.html (TIMEZONE FIXED)

let gameData = null;
let gameId = '';
let hostToken = '';

window.ManageApp = window.ManageApp || {};
window.ManageApp.state = {
    get gameData() { return gameData; },
    get gameId() { return gameId; },
    get hostToken() { return hostToken; }
};



// TIMEZONE FIX FUNCTIONS
function formatDateForInput(dateStr) {
    // Convert date string to proper format for HTML date input without timezone shift
    if (!dateStr) return '';
    
    // If it's already in YYYY-MM-DD format, return as-is
    if (dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
        return dateStr;
    }
    
    // Handle other date formats by creating date in local timezone
    const date = new Date(dateStr + 'T00:00:00'); // Force local midnight
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    
    return `${year}-${month}-${day}`;
}

function formatDateForDisplay(dateStr) {
    return PageUtils.formatLocalDate(dateStr, {
        weekday: 'long', 
        month: 'long', 
        day: 'numeric',
        year: 'numeric'
    });
}

function toggleManageNotification(element, checkboxId, event) {
    const checkbox = document.getElementById(checkboxId);
    const isCurrentlyChecked = checkbox.checked;
    
    // Toggle the checkbox
    checkbox.checked = !isCurrentlyChecked;
    
    // Toggle the visual state
    if (checkbox.checked) {
        element.classList.add('checked');
    } else {
        element.classList.remove('checked');
    }
    
    // Prevent the event from bubbling up
    event.stopPropagation();
}

function loadGameDetails(game) {
    // Set notification preferences and toggle states
    if (game.notificationPreferences) {
        const prefs = game.notificationPreferences;
        
        // Set checkbox values and toggle visual states
        setNotificationToggle('notifyGameFull', prefs.gameFull);
        setNotificationToggle('notifyPlayerJoins', prefs.playerJoins);
        setNotificationToggle('notifyPlayerCancels', prefs.playerCancels);
        setNotificationToggle('notifyOneSpotLeft', prefs.oneSpotLeft);
        setNotificationToggle('notifyWaitlistStarts', prefs.waitlistStarts);
    }
}

function setNotificationToggle(checkboxId, isChecked) {
    console.log(`[CLIENT] Setting notification toggle ${checkboxId} to ${isChecked}`);
    
    const checkbox = document.getElementById(checkboxId);
    
    if (!checkbox) {
        console.error(`[CLIENT] Checkbox ${checkboxId} not found in DOM`);
        return false;
    }
    
    const toggleElement = checkbox.closest('.notification-option');
    
    if (!toggleElement) {
        console.error(`[CLIENT] Toggle element for ${checkboxId} not found`);
        return false;
    }
    
    // Force the checkbox state
    checkbox.checked = Boolean(isChecked);
    
    // Force the visual state
    if (Boolean(isChecked)) {
        toggleElement.classList.add('checked');
    } else {
        toggleElement.classList.remove('checked');
    }
    
    console.log(`[CLIENT] Successfully set ${checkboxId}: checkbox.checked=${checkbox.checked}, visual class=${toggleElement.classList.contains('checked')}`);
    return true;
}

async function updateGame() {
    const updateData = {
        // ... your existing fields ...
        notificationPreferences: {
            gameFull: document.getElementById('notifyGameFull').checked,
            playerJoins: document.getElementById('notifyPlayerJoins').checked,
            playerCancels: document.getElementById('notifyPlayerCancels').checked,
            oneSpotLeft: document.getElementById('notifyOneSpotLeft').checked,
            waitlistStarts: document.getElementById('notifyWaitlistStarts').checked
        }
    };
    
    // ... rest of your update logic ...
}

function formatDateForServer(dateStr) {
    // Ensure date is sent to server in YYYY-MM-DD format without timezone
    if (!dateStr) return '';
    
    // If input is from HTML date input, it's already in correct format
    if (dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
        return dateStr;
    }
    
    // Handle other formats
    const date = new Date(dateStr);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    
    return `${year}-${month}-${day}`;
}

// Function to toggle collapsible sections
function toggleCollapsible(sectionId) {
    const content = document.getElementById(sectionId);
    const header = content.previousElementSibling;
    
    if (content.classList.contains('expanded')) {
        content.classList.remove('expanded');
        header.classList.remove('expanded');
    } else {
        content.classList.add('expanded');
        header.classList.add('expanded');
    }
}

document.addEventListener('DOMContentLoaded', () => {
    // Get game ID and host token from URL
    const urlParams = new URLSearchParams(window.location.search);
    gameId = urlParams.get('id');
    hostToken = urlParams.get('token');
    
    if (!gameId || !hostToken) {
        showUnauthorized();
        return;
    }
    
    // Fetch game data
    fetchGameData();

    // Set up event listeners
    setupEventListeners();

    setupPhotos();
    setupCourtImages();

    // Restore the active tab after everything is loaded
    setTimeout(restoreActiveTab, 100);
});

function restoreActiveTab() {
    const activeTab = localStorage.getItem('managePageActiveTab') || 'Details';
    
    // Hide all tabs first
    const tabcontent = document.getElementsByClassName("tabcontent");
    for (let i = 0; i < tabcontent.length; i++) {
        tabcontent[i].classList.remove("active");
    }
    
    const tablinks = document.getElementsByClassName("tab");
    for (let i = 0; i < tablinks.length; i++) {
        tablinks[i].classList.remove("active");
    }
    
    // Show the active tab
    const activeTabElement = document.getElementById(activeTab);
    if (activeTabElement) {
        activeTabElement.classList.add("active");
        
        // Find and activate the corresponding tab button
        for (let i = 0; i < tablinks.length; i++) {
            if (tablinks[i].dataset.tab === activeTab) {
                tablinks[i].classList.add("active");
                break;
            }
        }
        
        // Update mobile selector
        const tabSelector = document.getElementById('tabSelector');
        if (tabSelector) {
            tabSelector.value = activeTab;
        }
    }
}

// Function to open tabs
function openTab(evt, tabName) {
    // Hide all tabcontent elements
    const tabcontent = document.getElementsByClassName("tabcontent");
    for (let i = 0; i < tabcontent.length; i++) {
        tabcontent[i].classList.remove("active");
    }
    
    // Remove "active" class from all tab buttons
    const tablinks = document.getElementsByClassName("tab");
    for (let i = 0; i < tablinks.length; i++) {
        tablinks[i].classList.remove("active");
    }
    
    // Show the current tab and add "active" class to the button
    document.getElementById(tabName).classList.add("active");
    evt.currentTarget.classList.add("active");

    localStorage.setItem('managePageActiveTab', tabName);
}

function openTabFromSelect(tabName) {
    // Hide all tabcontent elements
    const tabcontent = document.getElementsByClassName("tabcontent");
    for (let i = 0; i < tabcontent.length; i++) {
        tabcontent[i].classList.remove("active");
    }
    
    // Show the selected tab
    document.getElementById(tabName).classList.add("active");
    
    // Update active tab in the regular tabs (for desktop view)
    const tablinks = document.getElementsByClassName("tab");
    for (let i = 0; i < tablinks.length; i++) {
        tablinks[i].classList.remove("active");
        if (tablinks[i].dataset.tab === tabName) {
            tablinks[i].classList.add("active");
        }
    }
    localStorage.setItem('managePageActiveTab', tabName);
}

async function fetchGameData() {
    try {
        const response = await fetch(`/api/games/${gameId}?token=${hostToken}`);
        
        if (!response.ok) {
            if (response.status === 403) {
                showUnauthorized();
                return;
            }
            throw new Error('Failed to fetch game data');
        }
        
        gameData = await response.json();
        console.log('[CLIENT] Game data received:', gameData);
        console.log('[CLIENT] Notification preferences received:', gameData.notificationPreferences);
        
        // Check if game is expired
        const gameStatus = GameUtils.getGameStatus(gameData);
        const isGameExpired = !gameStatus.canEdit;
        
        console.log('[CLIENT] Game status:', gameStatus);
        console.log('[CLIENT] Is game expired?', isGameExpired);
        
        // Show management interface
        document.getElementById('loading').style.display = 'none';
        document.getElementById('gameManagement').style.display = 'block';
        
        // Show expired warning if needed
        if (!GameUtils.getGameStatus(gameData).canEdit) {
            showExpiredGameWarning();
            // Add expired class to disable editing
            document.getElementById('gameManagement').classList.add('expired');
            // Update page title
            document.title = '[ENDED] ' + document.title;
        }
        
        // Populate game details (this will set notification preferences)
        populateGameDetails();
        
        // Populate player lists
        updatePlayerLists();
        
        // Generate share links (only if not expired)
        if (!GameUtils.getGameStatus(gameData).canEdit) {
            populateShareLinks();
        }
        
        // If game is expired, force switch to Players tab (read-only)
        if (!GameUtils.getGameStatus(gameData).canEdit) {
            // Force switch to Players tab since it's the only useful one for expired games
            setTimeout(() => {
                openTabFromSelect('Players');
            }, 100);
        }
        
    } catch (error) {
        console.error('Error:', error);
        showStatus('Error loading game: ' + error.message, 'error');
        document.getElementById('loading').style.display = 'none';
    }
}

function showExpiredGameWarning() {
    const warningSection = document.getElementById('expiredGameWarning');
    if (warningSection) {
        warningSection.style.display = 'block';
    }
}


function setupEventListeners() {
    document.querySelectorAll('[data-tab]').forEach((tab) => {
        tab.addEventListener('click', (event) => openTab(event, tab.dataset.tab));
    });

    const tabSelector = document.getElementById('tabSelector');
    if (tabSelector) {
        tabSelector.addEventListener('change', () => openTabFromSelect(tabSelector.value));
    }

    document.querySelectorAll('.notification-option[data-checkbox-id]').forEach((element) => {
        element.addEventListener('click', (event) => {
            toggleManageNotification(element, element.dataset.checkboxId, event);
        });
    });

    document.querySelectorAll('[data-collapsible]').forEach((element) => {
        element.addEventListener('click', () => toggleCollapsible(element.dataset.collapsible));
    });

    const sendToAll = document.getElementById('sendToAll');
    if (sendToAll) {
        sendToAll.addEventListener('change', () => toggleAllPlayers(sendToAll.checked));
    }
    for (const id of ['sendToPlayers', 'sendToWaitlist']) {
        const checkbox = document.getElementById(id);
        if (checkbox) checkbox.addEventListener('change', updateGroupSelections);
    }

    // Edit game form
    const editForm = document.getElementById('editForm');
    if (editForm) {
        editForm.addEventListener('submit', (e) => {
            e.preventDefault();
            updateGameDetails();
        });
    }
    
    // Add player form
    const addPlayerForm = document.getElementById('addPlayerForm');
    if (addPlayerForm) {
        addPlayerForm.addEventListener('submit', (e) => {
            e.preventDefault();
            addPlayerManually();
        });
    }
    
    // Announcement form
    const announcementForm = document.getElementById('announcementForm');
    if (announcementForm) {
        announcementForm.addEventListener('submit', (e) => {
            e.preventDefault();
            sendAnnouncement();
        });
    }
    
    // Quick message buttons
    const sendReminderBtn = document.getElementById('sendReminder');
    if (sendReminderBtn) {
        sendReminderBtn.addEventListener('click', () => {
            sendQuickMessage('reminder');
        });
    }
    
    const sendLocationUpdateBtn = document.getElementById('sendLocationUpdate');
    if (sendLocationUpdateBtn) {
        sendLocationUpdateBtn.addEventListener('click', () => {
            sendQuickMessage('location');
        });
    }
    
    // Cancel game button
    const cancelGameBtn = document.getElementById('cancelGameBtn');
    if (cancelGameBtn) {
        cancelGameBtn.addEventListener('click', () => {
            showConfirmModal(
                'Cancel Game', 
                'Are you sure you want to cancel this game? All players will be notified.', 
                cancelGame
            );
        });
    }
    
    // Copy link buttons (Details tab + persistent bar)
    const copyPlayerLinkBtn = document.getElementById('copyPlayerLink');
    if (copyPlayerLinkBtn) {
        copyPlayerLinkBtn.addEventListener('click', () => copyPlayerInvitation('copyPlayerLink'));
    }
    const copyPlayerLinkPersistentBtn = document.getElementById('copyPlayerLinkPersistent');
    if (copyPlayerLinkPersistentBtn) {
        copyPlayerLinkPersistentBtn.addEventListener('click', () => copyPlayerInvitation('copyPlayerLinkPersistent'));
    }



    // Modal close button
    const closeModalBtn = document.getElementsByClassName('close')[0];
    if (closeModalBtn) {
        closeModalBtn.addEventListener('click', closeModal);
    }
    
    // Modal cancel button
    const confirmNoBtn = document.getElementById('confirmNo');
    if (confirmNoBtn) {
        confirmNoBtn.addEventListener('click', closeModal);
    }
}


function populateGameDetails() {
    console.log('[CLIENT] Populating game details with:', gameData);
    
    // Fill the edit form with current values
    document.getElementById('location').value = gameData.location || '';
    document.getElementById('date').value = formatDateForInput(gameData.date);
    document.getElementById('time').value = gameData.time || '';
    document.getElementById('duration').value = gameData.duration || '';
    document.getElementById('players').value = gameData.totalPlayers || '';
    document.getElementById('message').value = gameData.message || '';
    
    // Set notification preferences with explicit error handling
    console.log('[CLIENT] Setting notification preferences...');
    
    // Wait for DOM to be ready, then set preferences
    setTimeout(() => {
        if (gameData.notificationPreferences) {
            const prefs = gameData.notificationPreferences;
            console.log('[CLIENT] Found preferences in game data:', prefs);
            
            // Set each preference with detailed logging
            const preferenceMap = [
                ['notifyGameFull', prefs.gameFull],
                ['notifyPlayerJoins', prefs.playerJoins],
                ['notifyPlayerCancels', prefs.playerCancels],
                ['notifyOneSpotLeft', prefs.oneSpotLeft],
                ['notifyWaitlistStarts', prefs.waitlistStarts]
            ];
            
            preferenceMap.forEach(([checkboxId, value]) => {
                console.log(`[CLIENT] Setting ${checkboxId} to ${value}`);
                setNotificationToggle(checkboxId, value === true);
            });
            
        } else {
            console.log('[CLIENT] No notification preferences found - setting defaults to true');
            // Default all to true if no preferences exist
            setNotificationToggle('notifyGameFull', true);
            setNotificationToggle('notifyPlayerJoins', true);
            setNotificationToggle('notifyPlayerCancels', true);
            setNotificationToggle('notifyOneSpotLeft', true);
            setNotificationToggle('notifyWaitlistStarts', true);
        }
        
        // Verify the settings worked
        const checkboxes = ['notifyGameFull', 'notifyPlayerJoins', 'notifyPlayerCancels', 'notifyOneSpotLeft', 'notifyWaitlistStarts'];
        checkboxes.forEach(id => {
            const checkbox = document.getElementById(id);
            if (checkbox) {
                console.log(`[CLIENT] Final state of ${id}: ${checkbox.checked}`);
            }
        });
        
    }, 250); // Small delay to ensure DOM is ready
    
    // If game is cancelled, show a notice
    if (gameData.cancelled) {
        showStatus('This game has been cancelled. Reason: ' + (gameData.cancellationReason || 'No reason provided'), 'info');
    }
}






async function updateGameDetails() {
    if (!GameUtils.getGameStatus(gameData).canEdit) {
        showStatus('Cannot update expired games', 'error');
        return;
    }
    
    try {
        showStatus('Updating game details...', 'info');
        
        // Collect notification preferences with extensive logging
        const checkboxes = ['notifyGameFull', 'notifyPlayerJoins', 'notifyPlayerCancels', 'notifyOneSpotLeft', 'notifyWaitlistStarts'];
        const notificationPreferences = {};
        
        checkboxes.forEach(id => {
            const checkbox = document.getElementById(id);
            if (checkbox) {
                notificationPreferences[id.replace('notify', '').toLowerCase()] = checkbox.checked;
                console.log(`[CLIENT] Collected ${id}: ${checkbox.checked}`);
            } else {
                console.error(`[CLIENT] Could not find checkbox ${id} when collecting preferences`);
            }
        });
        
        // Fix the key names to match what the server expects
        const formattedPreferences = {
            gameFull: notificationPreferences.gamefull || false,
            playerJoins: notificationPreferences.playerjoins || false,
            playerCancels: notificationPreferences.playercancels || false,
            oneSpotLeft: notificationPreferences.onespotleft || false,
            waitlistStarts: notificationPreferences.waitliststarts || false
        };
        
        console.log('[CLIENT] Formatted notification preferences for server:', formattedPreferences);
        
        const updatedData = {
            location: document.getElementById('location').value,
            date: formatDateForServer(document.getElementById('date').value),
            time: document.getElementById('time').value,
            duration: document.getElementById('duration').value,
            totalPlayers: document.getElementById('players').value,
            message: document.getElementById('message').value,
            notificationPreferences: formattedPreferences,
            token: hostToken
        };
        
        console.log('[CLIENT] Sending update request with data:', updatedData);
        
        const response = await fetch(`/api/games/${gameId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(updatedData)
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to update game');
        }
        
        const responseData = await response.json();
        console.log('[CLIENT] Update response:', responseData);
        
        // Force refresh game data to verify the save
        await fetchGameData();
        
        showStatus(responseData.message || 'Game details updated successfully!', 'success');
        
    } catch (error) {
        console.error('[CLIENT] Error updating game:', error);
        showStatus('Error updating game: ' + error.message, 'error');
    }
    try {
    let myGames = JSON.parse(localStorage.getItem('myGames') || '[]');
    
    // Find and update the game in localStorage
    const gameIndex = myGames.findIndex(game => game.id === gameId);
    
    if (gameIndex >= 0) {
        // Update the localStorage entry with the new values
        myGames[gameIndex] = {
            ...myGames[gameIndex], // Keep existing data
            location: document.getElementById('location').value,
            date: document.getElementById('date').value,
            time: document.getElementById('time').value,
            duration: parseInt(document.getElementById('duration').value),
            totalPlayers: parseInt(document.getElementById('players').value),
            message: document.getElementById('message').value,
            // Keep other existing properties like id, hostToken, created, etc.
        };
        
        // Save back to localStorage
        localStorage.setItem('myGames', JSON.stringify(myGames));
        console.log('[CLIENT] Updated localStorage for game:', gameId);
    }
} catch (error) {
    console.error('[CLIENT] Error updating localStorage:', error);
    // Don't throw error - this is not critical
}
}





async function cancelGame() {
    if (!GameUtils.getGameStatus(gameData).canEdit) {
        showStatus('Cannot cancel expired games', 'error');
        return;
    }
    
    try {
        const reason = document.getElementById('cancellationReason').value || 'No reason provided';
        
        showStatus('Cancelling game...', 'info');
        
        const response = await fetch(`/api/games/${gameId}?token=${hostToken}`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                reason,
                token: hostToken
            })
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to cancel game');
        }
        
        const data = await response.json();
        console.log('Game cancelled:', data);
        
        // Update UI to show game cancelled
        gameData.cancelled = true;
        gameData.cancellationReason = reason;
        
        // FIXED: Update localStorage to show game as cancelled
        try {
            let myGames = JSON.parse(localStorage.getItem('myGames') || '[]');
            console.log('[CANCEL] Looking for game ID in localStorage:', gameId);
            
            // Find and update the game in localStorage
            const gameIndex = myGames.findIndex(game => game.id === gameId);
            console.log('[CANCEL] Found game at index:', gameIndex);
            
            if (gameIndex >= 0) {
                // Mark game as cancelled in localStorage
                myGames[gameIndex] = {
                    ...myGames[gameIndex], // Keep existing data
                    cancelled: true,
                    cancellationReason: reason
                };
                
                // Save back to localStorage
                localStorage.setItem('myGames', JSON.stringify(myGames));
                console.log('[CANCEL] Updated localStorage - game marked as cancelled:', gameId);
                console.log('[CANCEL] Game data now:', myGames[gameIndex]);
            } else {
                console.log('[CANCEL] Game not found in localStorage');
                console.log('[CANCEL] Available games:', myGames.map(g => ({id: g.id, location: g.location})));
            }
        } catch (error) {
            console.error('[CANCEL] Error updating localStorage for cancellation:', error);
        }
        
        showStatus('Game cancelled successfully! All players have been notified.', 'success');
        
        // Refresh after a short delay
        setTimeout(() => {
            window.location.href = '/my-games.html'; // Go to My Games instead of home
        }, 3000);
        
    } catch (error) {
        console.error('Error cancelling game:', error);
        showStatus('Error cancelling game: ' + error.message, 'error');
    }
}

function formatTime(timeStr) {
    return PageUtils.formatTime12Hour(timeStr);
}

function showConfirmModal(title, message, confirmAction) {
    const modal = document.getElementById('confirmModal');
    const confirmTitle = document.getElementById('confirmTitle');
    const confirmMessage = document.getElementById('confirmMessage');
    const confirmYes = document.getElementById('confirmYes');
    
    confirmTitle.textContent = title;
    confirmMessage.textContent = message;
    
    // Set up the confirm action
    confirmYes.onclick = () => {
        confirmAction();
        closeModal();
    };
    
    modal.style.display = 'block';
}

function closeModal() {
    const modal = document.getElementById('confirmModal');
    modal.style.display = 'none';
}

function populateShareLinks() {
    const shareSection = document.querySelector('.share-section');
    const copyButton = document.getElementById('copyPlayerLink');
    const persistentCopyButton = document.getElementById('copyPlayerLinkPersistent');
    
    if (!shareSection || !copyButton) return;
    
    // Check if game is expired or cancelled
    const gameStatus = GameUtils.getGameStatus(gameData);
    const shouldDisable = !gameStatus.canJoin || gameData.cancelled;
    
    const disabledText = gameData.cancelled ? 'Game Cancelled - Cannot Share' : 'Game Ended - Cannot Share';
    const disabledTitle = gameData.cancelled ? 'Cannot share invitations for cancelled games' : 'Cannot share invitations for expired games';
    
    function setButtonState(btn, disabled) {
        if (!btn) return;
        btn.disabled = disabled;
        if (disabled) {
            btn.classList.add('disabled');
            btn.textContent = disabledText;
            btn.title = disabledTitle;
        } else {
            btn.classList.remove('disabled');
            btn.textContent = btn === persistentCopyButton ? 'Copy Invitation Message' : 'Copy Invitation Message';
            btn.title = '';
        }
    }
    
    setButtonState(copyButton, shouldDisable);
    setButtonState(persistentCopyButton, shouldDisable);
    
    if (shouldDisable) {
        // Update the description text in share section
        const descriptionP = shareSection.querySelector('p');
        if (descriptionP) {
            descriptionP.textContent = gameData.cancelled
                ? 'This game has been cancelled. Invitations can no longer be shared.'
                : 'This game has ended. Invitations can no longer be shared.';
        }
        const saveSuggestion = shareSection.querySelector('.save-suggestion');
        if (saveSuggestion) saveSuggestion.style.display = 'none';
    } else {
        const descriptionP = shareSection.querySelector('p');
        if (descriptionP) {
            descriptionP.textContent = 'Click the button below to copy a complete invitation message with all game details and registration link:';
        }
        const saveSuggestion = shareSection.querySelector('.save-suggestion');
        if (saveSuggestion) saveSuggestion.style.display = 'block';
    }
}


function copyPlayerInvitation(buttonId) {
    // Check if game is expired or cancelled
    if (!GameUtils.getGameStatus(gameData).canEdit) {
        showStatus('Cannot share invitations for expired games', 'error');
        return;
    }
    
    if (gameData.cancelled) {
        showStatus('Cannot share invitations for cancelled games', 'error');
        return;
    }
    
    console.log('[COPY] Original game data from server:', gameData);
    
    // Make sure we include registrationMode from the server data
    const gameDataForInvitation = {
        ...gameData,
        registrationMode: gameData.registrationMode || 'fcfs', // Ensure it exists
        organizerPlaying: gameData.organizerPlaying !== false // Ensure boolean
    };
    
    console.log('[COPY] Game data prepared for invitation:', gameDataForInvitation);
    console.log('[COPY] Registration mode being passed:', gameDataForInvitation.registrationMode);
    
    InvitationGenerator.copyInvitationToClipboard(
        gameDataForInvitation,
        gameId,
        buttonId || 'copyPlayerLink'
    );
}

function fallbackCopyMessage(text) {
    // Create a temporary textarea for older browsers
    const textArea = document.createElement('textarea');
    textArea.value = text;
    document.body.appendChild(textArea);
    textArea.select();
    
    try {
        document.execCommand('copy');
        
        const button = document.getElementById('copyPlayerLink');
        const originalText = button.textContent;
        button.textContent = 'Copied!';
        
        setTimeout(() => {
            button.textContent = originalText;
        }, 2000);
        
    } catch (err) {
        console.error('Failed to copy text: ', err);
        showStatus('Failed to copy to clipboard', 'error');
    }
    
    document.body.removeChild(textArea);
}

function copyToClipboard(elementId) {
    const element = document.getElementById(elementId);
    element.select();
    document.execCommand('copy');
    
    // Get the button that was clicked
    const buttonId = 'copy' + elementId.charAt(0).toUpperCase() + elementId.slice(1);
    const button = document.getElementById(buttonId);
    
    // Change text temporarily
    const originalText = button.textContent;
    button.textContent = 'Copied!';
    
    setTimeout(() => {
        button.textContent = originalText;
    }, 2000);
}

function showStatus(message, type) {
    const statusDiv = document.getElementById('status');
    statusDiv.textContent = message;
    statusDiv.className = `status ${type}`;
    statusDiv.style.display = 'block';
    
    // Auto-scroll to show the status message
    statusDiv.scrollIntoView({ 
        behavior: 'smooth', 
        block: 'center' 
    });
    
    if (type === 'success' || type === 'info') {
        setTimeout(() => {
            statusDiv.style.display = 'none';
        }, 5000);
    }
}

function showUnauthorized() {
    document.getElementById('loading').style.display = 'none';
    document.getElementById('unauthorizedMessage').style.display = 'block';
}

// Get selected recipients from checkboxes
// Replace your existing getSelectedRecipients function with this more robust version:



// Toggle all players checkbox


// Update group selections based on individual checkboxes


// Update individual player selection


// Clear all recipient selections
// Replace your existing clearAllRecipientSelections function with this version:




document.addEventListener('DOMContentLoaded', () => {
    
    // Update player checkboxes after everything is loaded
    setTimeout(() => {
        if (gameData) {
            updatePlayerCheckboxes();
            // Force all checkboxes to be unchecked after creation
            const allCheckboxes = document.querySelectorAll('input[type="checkbox"]');
            allCheckboxes.forEach(checkbox => {
                checkbox.checked = false;
                checkbox.indeterminate = false;
            });
        }
    }, 200);
});

// Add this function to update the group checkbox styling to match individual players






// Also call the styling function when the page loads
document.addEventListener('DOMContentLoaded', () => {
    // ... existing DOMContentLoaded code ...
    
    // Apply consistent styling after everything is loaded
    setTimeout(() => {
        updateGroupCheckboxStyling();
    }, 200);
});

window.ManageApp.core = {
    fetchGameData,
    updateGameDetails,
    showStatus
};
