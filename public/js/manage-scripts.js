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
    // Get game ID from the URL; the host token comes from the URL once and is then kept
    // out of it (see captureHostToken), so copying the address bar can no longer hand
    // control of the game to whoever the URL is pasted to.
    const urlParams = new URLSearchParams(window.location.search);
    gameId = urlParams.get('id');
    hostToken = captureHostToken(gameId, urlParams);

    if (!gameId || !hostToken) {
        showUnauthorized();
        return;
    }
    
    fetchGameData();

    // Loaded once rather than with every roster refresh: the log is a look-back, and it has
    // its own Refresh button for the "I never got the reminder" conversation.
    loadDeliveryLog();

    // Set up event listeners
    setupEventListeners();

    setupPhotos();
    setupCourtImages();

    // Restore the active tab after everything is loaded
    setTimeout(restoreActiveTab, 100);
});

const HOST_TOKEN_STORAGE_PREFIX = 'inorout.hostToken.';

/**
 * The management link is the host's key, and it arrives with the token in the query
 * string (that is how the SMS link has always worked, and it keeps working). Once seen,
 * the token is remembered per game on this device and stripped from the address bar, so
 * browser history and copied URLs no longer carry it. A revisit without the token on the
 * same device falls back to the remembered one; a new device needs the SMS link again.
 */
function captureHostToken(gameId, urlParams) {
    let token = urlParams.get('token') || '';
    try {
        if (token && gameId) {
            localStorage.setItem(HOST_TOKEN_STORAGE_PREFIX + gameId, token);
        } else if (!token && gameId) {
            token = localStorage.getItem(HOST_TOKEN_STORAGE_PREFIX + gameId) || '';
        }
    } catch (storageError) {
        // Storage blocked (private mode): the URL token still runs this page view.
    }
    if (urlParams.get('token')) {
        try {
            const url = new URL(window.location);
            url.searchParams.delete('token');
            history.replaceState(history.state, '', url);
        } catch (historyError) {
            // A browser that cannot rewrite the URL simply keeps the old behavior.
        }
    }
    return token;
}

/** Headers that prove host-ness to the API without putting the token in a URL. */
function hostAuthHeaders(extra = {}) {
    return hostToken ? { ...extra, 'X-Host-Token': hostToken } : { ...extra };
}

function restoreActiveTab() {
    // A tab named in the URL wins (new games link straight to Invite), then the tab
    // from the last visit, then Invite - the first job
    // on a fresh game is getting players into it.
    const requestedTab = new URLSearchParams(window.location.search).get('tab');
    let activeTab = requestedTab || localStorage.getItem('managePageActiveTab') || 'Invite';
    if (!document.getElementById(activeTab)) {
        activeTab = 'Invite';
    }
    
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

    // Keep the mobile picker in agreement, or a resize to a narrow window shows a
    // selector naming a tab the host left long ago.
    const tabSelector = document.getElementById('tabSelector');
    if (tabSelector) {
        tabSelector.value = tabName;
    }

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
    // This function is also called programmatically, so the mobile picker has to be told
    // which tab it is now showing rather than assuming the user drove it.
    const tabSelector = document.getElementById('tabSelector');
    if (tabSelector) {
        tabSelector.value = tabName;
    }
    localStorage.setItem('managePageActiveTab', tabName);
}

async function fetchGameData() {
    try {
        const response = await fetch(`/api/games/${gameId}`, { headers: hostAuthHeaders() });
        
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
        const gameStatus = CentralTime.getGameStatus(gameData);
        const isGameExpired = !gameStatus.canEdit;
        
        console.log('[CLIENT] Game status:', gameStatus);
        console.log('[CLIENT] Is game expired?', isGameExpired);
        
        // Show management interface
        document.getElementById('loading').style.display = 'none';
        document.getElementById('gameManagement').style.display = 'block';
        
        // Show expired warning if needed
        if (!CentralTime.getGameStatus(gameData).canEdit) {
            showExpiredGameWarning(gameStatus.type);
            // Add expired class to disable editing
            document.getElementById('gameManagement').classList.add('expired');
            // Update page title
            document.title = (gameStatus.type === 'cancelled' ? '[CANCELLED] ' : '[ENDED] ') + document.title;
        }
        
        // Populate game details (this will set notification preferences).
        populateGameDetails();
        updateGameSummary();
        updatePlayerLinkField();

        // Populate player lists
        updatePlayerLists();

        // Populate the host's saved roster picker. The first load fetches the roster;
        // later game refreshes only re-filter the cached roster against the current players.
        loadHostRoster();
        
        // Generate share links (only if not expired)
        if (CentralTime.getGameStatus(gameData).canEdit) {
            populateShareLinks();
        }

        showCreationNotice();
        
        // If game is expired, force switch to Players tab (read-only)
        if (!CentralTime.getGameStatus(gameData).canEdit) {
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

function showCreationNotice() {
    const params = new URLSearchParams(window.location.search);
    if (params.get('created') !== '1') return;

    let notice = { type: 'success', message: 'Game created.' };
    try {
        const saved = sessionStorage.getItem(`gameCreationNotice:${gameId}`);
        if (saved) notice = JSON.parse(saved);
        sessionStorage.removeItem(`gameCreationNotice:${gameId}`);
    } catch (storageError) {
        console.warn('Could not read the new-game notice:', storageError);
    }

    showStatus(notice.message, notice.type);

    // One Realist line for the moment the game exists. Fail-silent, and empty until
    // the surface is enabled in the Developer Area.
    const realistLine = document.getElementById('postCreateRealistLine');
    if (realistLine) {
        fetch(`/api/random-message?surface=post-create-success&gameId=${encodeURIComponent(gameId)}`)
            .then((response) => (response.ok ? response.json() : null))
            .then((data) => {
                const text = data && data.text ? String(data.text).trim() : '';
                if (!text) return;
                realistLine.textContent = text;
                realistLine.style.display = 'block';
            })
            .catch(() => {});
    }

    params.delete('created');
    const cleanUrl = `${window.location.pathname}?${params.toString()}${window.location.hash}`;
    window.history.replaceState({}, '', cleanUrl);
}

function showExpiredGameWarning(statusType) {
    const warningSection = document.getElementById('expiredGameWarning');
    if (!warningSection) return;
    // A cancelled game did not "finish" - saying so right under the cancellation banner
    // reads like the app lost the plot. Name what actually happened.
    if (statusType === 'cancelled') {
        const title = warningSection.querySelector('h3');
        const body = warningSection.querySelector('p');
        if (title) title.textContent = 'Game Cancelled';
        if (body) {
            body.textContent = 'Your players were texted that it is off.';
        }
    }
    warningSection.style.display = 'block';
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

    const organizerPlayingToggle = document.getElementById('organizerPlaying');
    if (organizerPlayingToggle) {
        organizerPlayingToggle.addEventListener('change', () => {
            // "Give up your spot" means the seat goes to somebody else, not that the court
            // shrinks. The count field switches meaning with the tick box (others-needed vs
            // total-needed), so adjust its value in step to keep the number of seats the same.
            // The host sees the new number before saving and can still change it.
            const players = document.getElementById('players');
            if (players) {
                const current = parseInt(players.value, 10);
                if (!Number.isNaN(current)) {
                    const adjusted = organizerPlayingToggle.checked ? current - 1 : current + 1;
                    players.value = Math.max(adjusted, 1);
                }
            }
            updateOrganizerPlayingCopy();
        });
    }

    const refreshDeliveryLog = document.getElementById('refreshDeliveryLog');
    if (refreshDeliveryLog) {
        refreshDeliveryLog.addEventListener('click', loadDeliveryLog);
    }

    const copyLinkOnly = document.getElementById('copyPlayerLinkOnly');
    if (copyLinkOnly) {
        copyLinkOnly.addEventListener('click', copyPlayerLinkOnly);
    }

    const sendToAll = document.getElementById('sendToAll');
    if (sendToAll) {
        sendToAll.addEventListener('change', () => toggleAllPlayers(sendToAll.checked));
    }
    for (const id of ['sendToPlayers', 'sendToWaitlist', 'sendToOut']) {
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

    const addRosterPlayersBtn = document.getElementById('addRosterPlayersBtn');
    if (addRosterPlayersBtn) {
        addRosterPlayersBtn.addEventListener('click', addPlayersFromRoster);
    }

    const addPersonBtn = document.getElementById('inviteAddPerson');
    if (addPersonBtn) {
        addPersonBtn.addEventListener('click', addPersonToRoster);
    }

    const textInvitationsBtn = document.getElementById('textInvitations');
    if (textInvitationsBtn) {
        textInvitationsBtn.addEventListener('click', () => textInvitations());
    }

    const nudgeBtn = document.getElementById('nudgeNonResponders');
    if (nudgeBtn) {
        nudgeBtn.addEventListener('click', () => {
            const waiting = InviteStatus.inviteStatus(gameData || {}).nonResponders;
            textInvitations(waiting.map((person) => person.phone), {
                confirmTitle: 'Text Everyone Waiting',
                confirmQuestion:
                    `Send the invitation again to the ${waiting.length} ` +
                    `${waiting.length === 1 ? 'person' : 'people'} who have not replied?`
            });
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

    // Game-day card: the same two sends, plus a jump to the log that proves they went out.
    const gameDayReminderBtn = document.getElementById('gameDayReminder');
    if (gameDayReminderBtn) {
        gameDayReminderBtn.addEventListener('click', () => sendQuickMessage('reminder'));
    }

    const gameDayLocationBtn = document.getElementById('gameDayLocation');
    if (gameDayLocationBtn) {
        gameDayLocationBtn.addEventListener('click', () => sendQuickMessage('location'));
    }

    const gameDayLogBtn = document.getElementById('gameDayLog');
    if (gameDayLogBtn) {
        gameDayLogBtn.addEventListener('click', () => {
            openTabFromSelect('Communication');
            document.querySelector('.delivery-log')
                ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
    
    // Copy invitation button (Invite tab)
    const copyPlayerLinkBtn = document.getElementById('copyPlayerLink');
    if (copyPlayerLinkBtn) {
        copyPlayerLinkBtn.addEventListener('click', () => copyPlayerInvitation('copyPlayerLink'));
    }

    // Share invitation button (Invite tab) - phones only, see populateShareLinks
    const sharePlayerLinkBtn = document.getElementById('sharePlayerLink');
    if (sharePlayerLinkBtn) {
        sharePlayerLinkBtn.addEventListener('click', () => sharePlayerInvitation('sharePlayerLink'));
    }

    // The "N more below" count follows the scroll position, and the cap itself changes at the
    // phone breakpoint, so a rotated phone or a resized window recounts.
    const inviteeList = document.getElementById('intendedInviteeList');
    if (inviteeList) {
        inviteeList.addEventListener('scroll', updateInviteOverflowHint);
        window.addEventListener('resize', updateInviteOverflowHint);
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


// The player-count field means "how many others" only while the host is playing, so its label
// has to follow the tick box rather than waiting for a save. The label carries the whole
// rule; no helper sentence is needed under it.
function updateOrganizerPlayingCopy() {
    const playing = document.getElementById('organizerPlaying')?.checked === true;
    const label = document.getElementById('playersLabel');
    if (label) {
        label.textContent = playing
            ? 'Players Needed (Besides You):'
            : 'Total Players Needed:';
    }
}

function populateGameDetails() {
    console.log('[CLIENT] Populating game details with:', gameData);
    
    // Fill the edit form with current values
    document.getElementById('location').value = gameData.location || '';
    document.getElementById('date').value = formatDateForInput(gameData.date);
    document.getElementById('time').value = gameData.time || '';
    document.getElementById('duration').value = gameData.duration || '';
    const organizerPlaying = gameData.organizerPlaying === true;
    document.getElementById('organizerPlaying').checked = organizerPlaying;
    document.getElementById('players').value = PlayerCapacity.additionalFromTotal(
        gameData.totalPlayers,
        organizerPlaying
    );
    updateOrganizerPlayingCopy();
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
    if (!CentralTime.getGameStatus(gameData).canEdit) {
        showStatus('This game has ended and can no longer be edited.', 'error');
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
            playersNeeded: document.getElementById('players').value,
            organizerPlaying: document.getElementById('organizerPlaying').checked,
            message: document.getElementById('message').value,
            personalityId: gameData.personalityId || 'realist',
            notificationPreferences: formattedPreferences,
            // The server only acts on this when the court, date, time, or duration actually
            // changed, so leaving it checked never texts anyone about a copy edit.
            notifyPlayers: document.getElementById('notifyPlayersOfChange')?.checked !== false,
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
        
        showStatus(responseData.message || 'Game details updated.', 'success');
        
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
            totalPlayers: PlayerCapacity.totalFromAdditional(
                document.getElementById('players').value,
                document.getElementById('organizerPlaying').checked
            ),
            message: document.getElementById('message').value,
            personalityId: gameData.personalityId || 'realist',
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
    if (!CentralTime.getGameStatus(gameData).canEdit) {
        showStatus('This game has already ended.', 'error');
        return;
    }
    
    try {
        const reason = document.getElementById('cancellationReason').value || 'No reason provided';
        
        showStatus('Cancelling game...', 'info');
        
        const response = await fetch(`/api/games/${gameId}`, {
            method: 'DELETE',
            headers: hostAuthHeaders({
                'Content-Type': 'application/json'
            }),
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
        
        showStatus('Game cancelled. All players have been notified.', 'success');
        
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

// `destructive` decides the colour of the confirm button. Sending an invitation used to offer a
// red "Confirm", which reads as a warning about the very thing the host came here to do.
function showConfirmModal(
    title,
    message,
    confirmAction,
    { destructive = true, confirmLabel = 'Confirm' } = {}
) {
    const modal = document.getElementById('confirmModal');
    const confirmTitle = document.getElementById('confirmTitle');
    const confirmMessage = document.getElementById('confirmMessage');
    const confirmYes = document.getElementById('confirmYes');

    confirmTitle.textContent = title;
    confirmMessage.textContent = message;
    confirmYes.className = destructive ? 'btn-danger' : 'btn-primary';
    confirmYes.textContent = confirmLabel;

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

// The page used to open straight into form fields with nothing saying which game they belong
// to. This sits outside the tab panes, so the answer travels with the host.
function updateGameSummary() {
    const summary = document.getElementById('gameSummary');
    if (!summary || !gameData) return;

    const dateText = PageUtils.formatLocalDate(gameData.date, {
        weekday: 'short',
        month: 'short',
        day: 'numeric'
    });
    const timeText = formatTime(gameData.time);
    const when = [dateText, timeText].filter(Boolean).join(' at ');
    document.getElementById('gameSummaryHeadline').textContent = gameData.location
        ? `${when} — ${gameData.location}`
        : when;

    const confirmed = (gameData.players || []).length;
    const total = parseInt(gameData.totalPlayers, 10) || confirmed;
    const waiting = (gameData.waitlist || []).length;
    const out = (gameData.outPlayers || []).length;

    const parts = [`${confirmed} of ${total} in`];
    if (waiting) parts.push(`${waiting} waiting`);
    if (out) parts.push(`${out} out`);

    const status = CentralTime.getGameStatus(gameData);
    if (status.type === 'cancelled') {
        parts.push('Game cancelled');
    } else if (status.type === 'expired') {
        parts.push('Game ended');
    } else {
        const countdown = CentralTime.getTimeUntilGame(gameData.date, gameData.time);
        if (countdown) parts.push(countdown === 'Game has started' ? countdown : `starts in ${countdown.replace(' away', '')}`);
    }

    document.getElementById('gameSummaryMeta').textContent = parts.join(' · ');
    summary.hidden = false;
    updateGameDayCard();
}

const GAME_DAY_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Milliseconds until the game starts, negative once it has, or null if the game has no time. */
function millisecondsUntilGameStart() {
    const [year, month, day] = String(gameData?.date || '').split('-').map(Number);
    const [hours, minutes] = String(gameData?.time || '').split(':').map(Number);
    if ([year, month, day, hours, minutes].some((part) => !Number.isFinite(part))) return null;
    return new Date(year, month - 1, day, hours, minutes).getTime() - Date.now();
}

// Inside the last day the host's job changes from filling the game to running it. This lifts the
// two day-of actions out of the Communication tab, where they were three taps away, and puts
// them where the host lands. A cancelled or finished game has no day-of actions left, so it
// gets no card.
function updateGameDayCard() {
    const card = document.getElementById('gameDayCard');
    if (!card) return;

    const untilStart = millisecondsUntilGameStart();
    const isGameDay = CentralTime.getGameStatus(gameData || {}).canEdit &&
        untilStart !== null &&
        untilStart <= GAME_DAY_WINDOW_MS;
    card.hidden = !isGameDay;
    if (!isGameDay) return;

    const countdown = CentralTime.getTimeUntilGame(gameData.date, gameData.time);
    const when = document.getElementById('gameDayWhen');
    if (when) {
        when.textContent = countdown === 'Game has started'
            ? 'Game has started'
            : `Starts in ${String(countdown).replace(' away', '')}`;
    }
}

// Hosts kept having to dig the bare URL back out of the copied invitation text to build a QR
// code or put it in a group chat description.
function updatePlayerLinkField() {
    const field = document.getElementById('playerLinkField');
    if (!field) return;
    field.value = `${window.location.origin}/game.html?id=${gameId}`;
}

async function copyPlayerLinkOnly() {
    const field = document.getElementById('playerLinkField');
    const button = document.getElementById('copyPlayerLinkOnly');
    if (!field || !field.value) return;

    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(field.value);
        } else {
            field.select();
            document.execCommand('copy');
        }
        if (button) {
            const originalText = button.textContent;
            button.textContent = 'Copied!';
            setTimeout(() => { button.textContent = originalText; }, 2000);
        }
        showStatus('Player link copied.', 'success');
    } catch (error) {
        console.error('Could not copy the player link:', error);
        field.select();
        showStatus('Could not copy. The text is selected, so copy it by hand.', 'error');
    }
}

function populateShareLinks() {
    const shareSection = document.querySelector('.share-section');
    const copyButton = document.getElementById('copyPlayerLink');
    const shareButton = document.getElementById('sharePlayerLink');

    if (!shareSection || !copyButton) return;

    // Check if game is expired or cancelled
    const gameStatus = CentralTime.getGameStatus(gameData);
    const shouldDisable = !gameStatus.canJoin || gameData.cancelled;
    
    const disabledText = gameData.cancelled ? 'Game Cancelled — Cannot Share' : 'Game Ended — Cannot Share';
    const disabledTitle = gameData.cancelled ? 'This game is cancelled, so its invitation can no longer be shared.' : 'This game has ended, so its invitation can no longer be shared.';
    
    function setButtonState(btn, disabled) {
        if (!btn) return;
        btn.disabled = disabled;
        if (disabled) {
            btn.classList.add('disabled');
            btn.textContent = disabledText;
            btn.title = disabledTitle;
        } else {
            btn.classList.remove('disabled');
            btn.textContent = 'Copy Invitation Message';
            btn.title = '';
        }
    }
    
    setButtonState(copyButton, shouldDisable);

    // The share sheet is the phone's, not ours: offer it only where the browser has one, and
    // never on a game whose invitation is no longer allowed out.
    const canShare = !shouldDisable &&
        typeof InvitationGenerator !== 'undefined' &&
        InvitationGenerator.canShareInvitation();
    if (shareButton) {
        shareButton.hidden = !canShare;
        shareButton.disabled = !canShare;
    }

}


// Both send paths need the same two answers: may this invitation still go out, and what does
// the generator need that the server response does not already spell out?
function invitationGameData() {
    if (!CentralTime.getGameStatus(gameData).canEdit) {
        showStatus('This game has ended, so its invitation can no longer be shared.', 'error');
        return null;
    }

    if (gameData.cancelled) {
        showStatus('This game is cancelled, so its invitation can no longer be shared.', 'error');
        return null;
    }

    return {
        ...gameData,
        registrationMode: gameData.registrationMode || 'fcfs', // Ensure it exists
        organizerPlaying: gameData.organizerPlaying !== false // Ensure boolean
    };
}

// The phone's own share sheet, carrying the same text the copy button produces. Recording only
// happens if the share really went through, so backing out of the sheet invites nobody.
async function sharePlayerInvitation(buttonId) {
    const gameDataForInvitation = invitationGameData();
    if (!gameDataForInvitation) return;

    const shared = await InvitationGenerator.shareInvitation(
        gameDataForInvitation,
        gameId,
        buttonId || 'sharePlayerLink',
        null,
        hostToken
    );
    if (!shared) return;

    await recordCopiedInvitees();
}

async function copyPlayerInvitation(buttonId) {
    const gameDataForInvitation = invitationGameData();
    if (!gameDataForInvitation) return;

    await InvitationGenerator.copyInvitationToClipboard(
        gameDataForInvitation,
        gameId,
        buttonId || 'copyPlayerLink',
        null,
        hostToken
    );

    // Anyone ticked in the picker is being invited by this copy, so they join the invited list
    // here rather than needing a second button press to say so.
    await recordCopiedInvitees();
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
        showStatus('Could not copy. The text is selected, so copy it by hand.', 'error');
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




// There used to be a timer here that unchecked every checkbox on the page 200ms after load. It
// raced the notification preferences, which are restored at 250ms and only won by luck, and it
// silently cancelled the "Confirmed Players" default that updatePlayerCheckboxes sets. The
// recipient list already renders itself from the roster, so nothing needs to be reset here.

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
