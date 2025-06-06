// manage-scripts.js - All JavaScript for manage.html (TIMEZONE FIXED)

let gameData = null;
let gameId = '';
let hostToken = '';

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
    // Format date for display without timezone conversion
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

// ADD this JavaScript function to your manage-scripts.js file:

function toggleManageNotification(element, checkboxId) {
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
    if (event) {
        event.stopPropagation();
    }
}

// UPDATE your loadGameDetails function to set the toggle states:
function loadGameDetails(game) {
    // ... your existing code ...
    
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

// Helper function to set both checkbox and visual state
// REPLACE your setNotificationToggle function with this improved version:

function setNotificationToggle(checkboxId, isChecked) {
    console.log(`[CLIENT] Setting notification toggle ${checkboxId} to ${isChecked}`);
    
    const checkbox = document.getElementById(checkboxId);
    
    if (!checkbox) {
        console.error(`[CLIENT] ❌ Checkbox ${checkboxId} not found in DOM`);
        return false;
    }
    
    const toggleElement = checkbox.closest('.notification-option');
    
    if (!toggleElement) {
        console.error(`[CLIENT] ❌ Toggle element for ${checkboxId} not found`);
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
    
    console.log(`[CLIENT] ✅ Successfully set ${checkboxId}: checkbox.checked=${checkbox.checked}, visual class=${toggleElement.classList.contains('checked')}`);
    return true;
}

// UPDATE your updateGame function to include notification preferences:
async function updateGame() {
    // ... your existing form data collection ...
    
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
            if (tablinks[i].getAttribute("onclick") && tablinks[i].getAttribute("onclick").includes(activeTab)) {
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
        if (tablinks[i].textContent.includes(tabName) || 
            tablinks[i].getAttribute("onclick").includes(tabName)) {
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
        
        // Show management interface
        document.getElementById('loading').style.display = 'none';
        document.getElementById('gameManagement').style.display = 'block';
        
        // Populate game details (this will set notification preferences)
        populateGameDetails();
        
        // Populate player lists
        updatePlayerLists();
        
        // Generate share links
        populateShareLinks();
        
    } catch (error) {
        console.error('Error:', error);
        showStatus('Error loading game: ' + error.message, 'error');
        document.getElementById('loading').style.display = 'none';
    }
}


function setupEventListeners() {
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
    
    // Copy link buttons
const copyPlayerLinkBtn = document.getElementById('copyPlayerLink');
if (copyPlayerLinkBtn) {
    copyPlayerLinkBtn.addEventListener('click', () => {
        copyPlayerInvitation();
    });
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

// REPLACE your populateGameDetails function with this updated version:

function populateGameDetails() {
    console.log('[CLIENT] Populating game details with:', gameData);
    
    // Fill the edit form with current values
    document.getElementById('location').value = gameData.location || '';
    document.getElementById('courtNumber').value = gameData.courtNumber || '';
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


function updatePlayerLists() {
    const confirmedPlayers = document.getElementById('confirmedPlayers');
    const waitlistPlayers = document.getElementById('waitlistPlayers');
    const playerCount = document.getElementById('playerCount');
    const totalPlayers = document.getElementById('totalPlayers');
    const waitlistCount = document.getElementById('waitlistCount');
    
    // Clear existing lists
    confirmedPlayers.innerHTML = '';
    waitlistPlayers.innerHTML = '';
    
    // Update counts
    playerCount.textContent = gameData.players.length;
    totalPlayers.textContent = gameData.totalPlayers;
    waitlistCount.textContent = gameData.waitlist.length;

    

// Add this new code for dynamic text:
const playerCountElement = document.querySelector('.player-section.confirmed .player-count');
if (playerCountElement) {
    const count = gameData.players.length;
    const total = gameData.totalPlayers;
    const playerText = count === 1 ? 'player' : 'players';
    playerCountElement.innerHTML = `<span id="playerCount">${count}</span>/<span id="totalPlayers">${total}</span> ${playerText}`;
}

const waitlistCountElement = document.querySelector('.player-section.waitlist .player-count');
if (waitlistCountElement) {
    const count = gameData.waitlist.length;
    const playerText = count === 1 ? 'player' : 'players';
    waitlistCountElement.innerHTML = `<span id="waitlistCount">${count}</span> ${playerText} waiting`;
}

const outCount = document.getElementById('outCount');
if (outCount) {
    const count = (gameData.outPlayers || []).length;
    const outCountElement = document.querySelector('.player-section.out-players .player-count');
    if (outCountElement) {
        const playerText = count === 1 ? 'player' : 'players';
        outCountElement.innerHTML = `<span id="outCount">${count}</span> ${playerText} can't make it`;
    }
}
    
    // Populate confirmed players
    if (gameData.players.length === 0) {
        confirmedPlayers.innerHTML = '<p style="text-align: center; color: #6c757d; font-style: italic;">No players yet</p>';
    } else {
        gameData.players.forEach((player, index) => {
            const playerItem = document.createElement('div');
            playerItem.className = 'player-item';
            
            let playerActions = '';

            // Show actions for all players, including organizer
            playerActions = `
                <div class="player-actions">
                    <button class="btn-secondary" onclick="moveToWaitlist('${player.id}')">⏳ To Waitlist</button>
                    <button class="btn-danger" onclick="removePlayer('${player.id}')">❌ Remove</button>
                </div>
            `;
            
            playerItem.innerHTML = `
                <div class="player-info">
                    <div class="player-name">${player.name}${player.isOrganizer ? ' (Organizer)' : ''}</div>
                    ${player.phone ? '<div class="player-phone">📱 ' + player.phone + '</div>' : ''}
                </div>
                ${playerActions}
            `;
            
            confirmedPlayers.appendChild(playerItem);
        });
    }
    
    // Populate waitlist
    if (gameData.waitlist.length === 0) {
        waitlistPlayers.innerHTML = '<p style="text-align: center; color: #6c757d; font-style: italic;">No one waiting</p>';
    } else {
        gameData.waitlist.forEach((player, index) => {
            const playerItem = document.createElement('div');
            playerItem.className = 'player-item';
            
            playerItem.innerHTML = `
                <div class="player-info">
                    <div class="player-name">${player.name}</div>
                    ${player.phone ? '<div class="player-phone">📱 ' + player.phone + '</div>' : ''}
                    <div class="player-phone">Position: #${index + 1}</div>
                </div>
                <div class="player-actions">
                    <button class="btn-secondary" onclick="promoteToGame('${player.id}')">✅ Promote</button>
                    <button class="btn-danger" onclick="removeWaitlisted('${player.id}')">❌ Remove</button>
                </div>
            `;
            
            waitlistPlayers.appendChild(playerItem);
        });
    }

    // Populate out players
// Populate out players
const outPlayersContainer = document.getElementById('outPlayers');
if (outPlayersContainer) {
    if (!gameData.outPlayers || gameData.outPlayers.length === 0) {
        outPlayersContainer.innerHTML = '<p style="text-align: center; color: #6c757d; font-style: italic;">No one marked as out</p>';
    } else {
        gameData.outPlayers.forEach((player) => {
            const playerItem = document.createElement('div');
            playerItem.className = 'player-item';
            
            playerItem.innerHTML = `
                <div class="player-info">
                    <div class="player-name">${player.name}</div>
                    ${player.phone ? '<div class="player-phone">📱 ' + player.phone + '</div>' : ''}
                </div>
            `;
            
            outPlayersContainer.appendChild(playerItem);
        });
    }
}
    
    // Update player checkboxes for messaging
    updatePlayerCheckboxes();
}


// UPDATE your updateGameDetails function in manage-scripts.js:

async function updateGameDetails() {
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
                console.error(`[CLIENT] ❌ Could not find checkbox ${id} when collecting preferences`);
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
            courtNumber: document.getElementById('courtNumber').value || '',
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
}

function debugNotificationPreferences() {
    console.log('=== NOTIFICATION PREFERENCES DEBUG ===');
    console.log('Game data:', gameData);
    console.log('Notification preferences in game data:', gameData?.notificationPreferences);
    
    const checkboxes = ['notifyGameFull', 'notifyPlayerJoins', 'notifyPlayerCancels', 'notifyOneSpotLeft', 'notifyWaitlistStarts'];
    checkboxes.forEach(id => {
        const checkbox = document.getElementById(id);
        const toggle = checkbox?.closest('.notification-option');
        console.log(`${id}:`, {
            found: !!checkbox,
            checked: checkbox?.checked,
            hasCheckedClass: toggle?.classList.contains('checked')
        });
    });
    console.log('=== END DEBUG ===');
}

// Updated addPlayerManually function - enhanced to show SMS status  
async function addPlayerManually() {
  try {
    const name = document.getElementById('playerName').value;
    const phone = document.getElementById('playerPhone').value;
    const action = document.querySelector('input[name="addTo"]:checked').value;
    
    showStatus('Adding player...', 'info');
    
    const response = await fetch(`/api/games/${gameId}/manual-player?token=${hostToken}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name,
        phone,
        action,
        token: hostToken
      })
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Failed to add player');
    }
    
    const data = await response.json();
    console.log('Player added manually:', data);
    
    // Reset form
    document.getElementById('playerName').value = '';
    document.getElementById('playerPhone').value = '';
    
    // Refresh game data
    await fetchGameData();
    
    // Build status message
    let statusMessage = `Player ${name} added successfully`;
    
    // Add SMS status info
    if (phone && data.sms && data.sms.success) {
      statusMessage += ' and notified via SMS';
    } else if (phone && data.sms && !data.sms.success) {
      statusMessage += ' (SMS notification failed)';
    } else if (!phone) {
      statusMessage += ' (no phone number provided)';
    }
    
    showStatus(statusMessage, 'success');
    
  } catch (error) {
    console.error('Error adding player:', error);
    showStatus('Error adding player: ' + error.message, 'error');
  }
}

// Updated moveToWaitlist function - now uses dedicated endpoint with SMS
async function moveToWaitlist(playerId) {
  try {
    showStatus('Moving player to waitlist...', 'info');
    
    // First find the player in the game data
    const player = gameData.players.find(p => p.id === playerId);
    if (!player) {
      throw new Error('Player not found');
    }
    
    // Use new dedicated endpoint
    const response = await fetch(`/api/games/${gameId}/move-to-waitlist/${playerId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        token: hostToken
      })
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Failed to move player to waitlist');
    }
    
    const data = await response.json();
    console.log('Player moved to waitlist:', data);
    
    // Refresh game data
    await fetchGameData();
    
    // Show status with SMS info
    let statusMessage = `Player ${player.name} moved to waitlist`;
    if (data.sms && data.sms.success) {
      statusMessage += ' and notified via SMS';
    } else if (data.sms && !data.sms.success) {
      statusMessage += ' (SMS notification failed)';
    }
    
    showStatus(statusMessage, 'success');
    
  } catch (error) {
    console.error('Error moving player:', error);
    showStatus('Error moving player: ' + error.message, 'error');
  }
}


// Updated promoteToGame function - now uses dedicated endpoint with SMS
async function promoteToGame(playerId) {
  try {
    // Check if game is full before promoting
    if (gameData.players.length >= parseInt(gameData.totalPlayers)) {
      showStatus('Cannot promote: Game is already full', 'error');
      return;
    }
    
    showStatus('Promoting player to game...', 'info');
    
    // First find the player in the waitlist
    const player = gameData.waitlist.find(p => p.id === playerId);
    if (!player) {
      throw new Error('Player not found in waitlist');
    }
    
    // Use new dedicated endpoint
    const response = await fetch(`/api/games/${gameId}/promote-from-waitlist/${playerId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        token: hostToken
      })
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Failed to promote player');
    }
    
    const data = await response.json();
    console.log('Player promoted:', data);
    
    // Refresh game data
    await fetchGameData();
    
    // Show status with SMS info
    let statusMessage = `Player ${player.name} promoted to confirmed players`;
    if (data.sms && data.sms.success) {
      statusMessage += ' and notified via SMS';
    } else if (data.sms && !data.sms.success) {
      statusMessage += ' (SMS notification failed)';
    }
    
    showStatus(statusMessage, 'success');
    
  } catch (error) {
    console.error('Error promoting player:', error);
    showStatus('Error promoting player: ' + error.message, 'error');
    
    // Refresh to ensure UI is consistent
    await fetchGameData();
  }
}

async function removePlayer(playerId) {
  try {
    // First find the player in the game data
    const player = gameData.players.find(p => p.id === playerId);
    if (!player) {
      throw new Error('Player not found');
    }
    
    showConfirmModal(
      'Remove Player', 
      `Are you sure you want to remove ${player.name} from the game?`, 
      async () => {
        try {
          showStatus('Removing player...', 'info');
          
          const response = await fetch(`/api/games/${gameId}/players/${playerId}?token=${hostToken}`, {
            method: 'DELETE'
          });
          
          if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to remove player');
          }
          
          const data = await response.json();
          console.log('Player removal response:', data);
          
          // Refresh game data
          await fetchGameData();
          
          // Build status message
          let statusMessage = `Player ${player.name} removed from game`;
          
          // Add SMS status info
          if (data.removalSms && data.removalSms.success) {
            statusMessage += ', player notified via SMS';
          } else if (data.removalSms && !data.removalSms.success) {
            statusMessage += ' (SMS notification to removed player failed)';
          }
          
          // Add promotion info if someone was promoted
          if (data.promotedPlayer) {
            statusMessage += `. ${data.promotedPlayer.name} promoted from waitlist`;
            if (data.promotionSms && data.promotionSms.success) {
              statusMessage += ' and notified via SMS';
            } else if (data.promotionSms && !data.promotionSms.success) {
              statusMessage += ' (promotion SMS failed)';
            }
          }
          
          showStatus(statusMessage, 'success');
          
        } catch (error) {
          console.error('Error removing player:', error);
          showStatus('Error removing player: ' + error.message, 'error');
        }
      }
    );
    
  } catch (error) {
    console.error('Error removing player:', error);
    showStatus('Error removing player: ' + error.message, 'error');
  }
}

async function removeWaitlisted(playerId) {
  try {
    // First find the player in the waitlist
    const player = gameData.waitlist.find(p => p.id === playerId);
    if (!player) {
      throw new Error('Player not found in waitlist');
    }
    
    showConfirmModal(
      'Remove from Waitlist', 
      `Are you sure you want to remove ${player.name} from the waitlist?`, 
      async () => {
        try {
          showStatus('Removing from waitlist...', 'info');
          
          const response = await fetch(`/api/games/${gameId}/players/${playerId}?token=${hostToken}`, {
            method: 'DELETE'
          });
          
          if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to remove from waitlist');
          }
          
          const data = await response.json();
          console.log('Waitlist removal response:', data);
          
          // Refresh game data
          await fetchGameData();
          
          // Build status message
          let statusMessage = `Player ${player.name} removed from waitlist`;
          
          // Add SMS status info if applicable
          if (data.removalSms && data.removalSms.success) {
            statusMessage += ', player notified via SMS';
          } else if (data.removalSms && !data.removalSms.success) {
            statusMessage += ' (SMS notification failed)';
          }
          
          showStatus(statusMessage, 'success');
          
        } catch (error) {
          console.error('Error removing from waitlist:', error);
          showStatus('Error removing from waitlist: ' + error.message, 'error');
        }
      }
    );
    
  } catch (error) {
    console.error('Error removing from waitlist:', error);
    showStatus('Error removing from waitlist: ' + error.message, 'error');
  }
}

async function sendAnnouncement() {
    try {
        const message = document.getElementById('announcementText').value;
        
        if (!message) {
            throw new Error('Please enter a message');
        }
        
        // Get selected recipients
        const recipients = getSelectedRecipients();
        
        if (recipients.length === 0) {
            throw new Error('Please select at least one recipient');
        }
        
        showStatus('Sending announcement...', 'info');
        
        // Send to individual players
        const response = await fetch(`/api/games/${gameId}/announcement-individual?token=${hostToken}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                message,
                recipients: recipients,
                token: hostToken
            })
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to send announcement');
        }
        
        const data = await response.json();
        console.log('Announcement sent:', data);
        
        // Reset form
        document.getElementById('announcementText').value = '';
        clearAllRecipientSelections();
        
        showStatus(`Announcement sent to ${data.recipientCount} players`, 'success');
        
    } catch (error) {
        console.error('Error sending announcement:', error);
        showStatus('Error sending announcement: ' + error.message, 'error');
    }
}

function sendQuickMessage(type) {
    let message = '';
    
    if (type === 'reminder') {
        // TIMEZONE FIX: Use proper date formatting
        const formattedDate = formatDateForDisplay(gameData.date);
        
        message = `Reminder: Your pickleball game is on ${formattedDate} at ${formatTime(gameData.time)} at ${gameData.location}. Looking forward to seeing you there!`;
    } else if (type === 'location') {
        message = `Location details for our pickleball game: ${gameData.location}. Game starts at ${formatTime(gameData.time)}.`;
    }
    
    // Pre-fill the announcement form
    document.getElementById('announcementText').value = message;
    document.getElementById('sendToPlayers').checked = true;
    document.getElementById('sendToWaitlist').checked = false;
    
    // Switch to Communication tab
    openTabFromSelect('Communication');
}

async function cancelGame() {
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
        
        showStatus('Game cancelled successfully! All players have been notified.', 'success');
        
        // Refresh after a short delay
        setTimeout(() => {
            window.location.href = '/';
        }, 3000);
        
    } catch (error) {
        console.error('Error cancelling game:', error);
        showStatus('Error cancelling game: ' + error.message, 'error');
    }
}

function formatTime(timeStr) {
    if (!timeStr) return '';
    const [hours, minutes] = timeStr.split(':');
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const hour12 = hour % 12 || 12;
    return `${hour12}:${minutes} ${ampm}`;
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
    // No longer need to populate visible links since we removed them
    // The copy function will build the links when needed
}

function copyPlayerInvitation() {
    // Use the shared invitation generator with current game data
    InvitationGenerator.copyInvitationToClipboard(
        gameData, // This is the global gameData variable in manage-scripts.js
        gameId,   // This is the global gameId variable in manage-scripts.js
        'copyPlayerLink'
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
        button.textContent = '✅ Copied!';
        
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
    button.textContent = '✅ Copied!';
    
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

function getSelectedRecipients() {
    const recipients = [];
    
    console.log('Checking recipients...'); // Debug log
    
    // Check if group checkboxes are selected - try multiple possible IDs
    const sendToPlayersEl = document.getElementById('sendToPlayers') || 
                           document.querySelector('input[type="checkbox"][id*="Players"]') ||
                           document.querySelector('input[type="checkbox"]:checked');
    
    const sendToWaitlistEl = document.getElementById('sendToWaitlist') || 
                            document.querySelector('input[type="checkbox"][id*="Waitlist"]');
    
    const sendToPlayers = sendToPlayersEl?.checked || false;
    const sendToWaitlist = sendToWaitlistEl?.checked || false;
    
    console.log('Group selections:', { sendToPlayers, sendToWaitlist }); // Debug log
    
    // If group checkboxes are selected, add all players from those groups
    if (sendToPlayers && gameData?.players) {
        gameData.players.forEach(player => {
            if (player.phone && !player.isOrganizer) {
                recipients.push({
                    id: player.id,
                    phone: player.phone,
                    name: player.name,
                    type: 'confirmed'
                });
            }
        });
        console.log('Added confirmed players:', recipients.length); // Debug log
    }
    
    if (sendToWaitlist && gameData?.waitlist) {
        gameData.waitlist.forEach(player => {
            if (player.phone) {
                recipients.push({
                    id: player.id,
                    phone: player.phone,
                    name: player.name,
                    type: 'waitlist'
                });
            }
        });
        console.log('Added waitlist players:', recipients.length); // Debug log
    }
    
    // Also check individual player checkboxes (for partial selections)
    const playerCheckboxes = document.querySelectorAll('input[type="checkbox"]:checked');
    console.log('Found checked checkboxes:', playerCheckboxes.length); // Debug log
    
    playerCheckboxes.forEach(checkbox => {
        // Skip if it's a group checkbox
        if (checkbox.id === 'sendToPlayers' || checkbox.id === 'sendToWaitlist' || checkbox.id === 'sendToAll') {
            return;
        }
        
        // Only add if not already included from group selection and has required data
        if (checkbox.dataset?.phone && checkbox.dataset?.name) {
            const existingRecipient = recipients.find(r => r.id === checkbox.value);
            if (!existingRecipient) {
                recipients.push({
                    id: checkbox.value,
                    phone: checkbox.dataset.phone,
                    name: checkbox.dataset.name,
                    type: checkbox.dataset.type || 'individual'
                });
            }
        }
    });
    
    console.log('Final recipients:', recipients); // Debug log
    return recipients;
}

// Toggle all players checkbox
function toggleAllPlayers(checked) {
    // Update group checkboxes
    document.getElementById('sendToPlayers').checked = checked;
    document.getElementById('sendToWaitlist').checked = checked;
    
    // Update individual player checkboxes
    const playerCheckboxes = document.querySelectorAll('.player-checkbox input[type="checkbox"]');
    playerCheckboxes.forEach(checkbox => {
        checkbox.checked = checked;
    });
}

// Update group selections based on individual checkboxes
function updateGroupSelections() {
    const sendToPlayers = document.getElementById('sendToPlayers').checked;
    const sendToWaitlist = document.getElementById('sendToWaitlist').checked;
    const sendToAll = document.getElementById('sendToAll');
    
    // Update individual checkboxes based on group selections
    const confirmedCheckboxes = document.querySelectorAll('.player-checkbox input[data-type="confirmed"]');
    const waitlistCheckboxes = document.querySelectorAll('.player-checkbox input[data-type="waitlist"]');
    
    confirmedCheckboxes.forEach(checkbox => {
        checkbox.checked = sendToPlayers;
    });
    
    waitlistCheckboxes.forEach(checkbox => {
        checkbox.checked = sendToWaitlist;
    });
    
    // Update "All Players" checkbox
    const allChecked = sendToPlayers && sendToWaitlist && 
                      confirmedCheckboxes.length > 0 && waitlistCheckboxes.length > 0;
    const someChecked = sendToPlayers || sendToWaitlist;
    
    if (allChecked) {
        sendToAll.checked = true;
        sendToAll.indeterminate = false;
    } else if (someChecked) {
        sendToAll.checked = false;
        sendToAll.indeterminate = true;
    } else {
        sendToAll.checked = false;
        sendToAll.indeterminate = false;
    }
}

// Update individual player selection
function updateIndividualSelection() {
    const confirmedCheckboxes = document.querySelectorAll('.player-checkbox input[data-type="confirmed"]');
    const waitlistCheckboxes = document.querySelectorAll('.player-checkbox input[data-type="waitlist"]');
    
    // Check group checkbox states
    const allConfirmedChecked = Array.from(confirmedCheckboxes).every(cb => cb.checked);
    const allWaitlistChecked = Array.from(waitlistCheckboxes).every(cb => cb.checked);
    const anyConfirmedChecked = Array.from(confirmedCheckboxes).some(cb => cb.checked);
    const anyWaitlistChecked = Array.from(waitlistCheckboxes).some(cb => cb.checked);
    
    // Update group checkboxes
    const sendToPlayers = document.getElementById('sendToPlayers');
    const sendToWaitlist = document.getElementById('sendToWaitlist');
    const sendToAll = document.getElementById('sendToAll');
    
    // Update confirmed players checkbox
    if (confirmedCheckboxes.length > 0) {
        if (allConfirmedChecked) {
            sendToPlayers.checked = true;
            sendToPlayers.indeterminate = false;
        } else if (anyConfirmedChecked) {
            sendToPlayers.checked = false;
            sendToPlayers.indeterminate = true;
        } else {
            sendToPlayers.checked = false;
            sendToPlayers.indeterminate = false;
        }
    }
    
    // Update waitlist checkbox
    if (waitlistCheckboxes.length > 0) {
        if (allWaitlistChecked) {
            sendToWaitlist.checked = true;
            sendToWaitlist.indeterminate = false;
        } else if (anyWaitlistChecked) {
            sendToWaitlist.checked = false;
            sendToWaitlist.indeterminate = true;
        } else {
            sendToWaitlist.checked = false;
            sendToWaitlist.indeterminate = false;
        }
    }
    
    // Update "All Players" checkbox
    const allPlayersChecked = allConfirmedChecked && allWaitlistChecked && 
                             confirmedCheckboxes.length > 0 && waitlistCheckboxes.length > 0;
    const anyPlayersChecked = anyConfirmedChecked || anyWaitlistChecked;
    
    if (allPlayersChecked) {
        sendToAll.checked = true;
        sendToAll.indeterminate = false;
    } else if (anyPlayersChecked) {
        sendToAll.checked = false;
        sendToAll.indeterminate = true;
    } else {
        sendToAll.checked = false;
        sendToAll.indeterminate = false;
    }
}

// Clear all recipient selections
// Replace your existing clearAllRecipientSelections function with this version:

function clearAllRecipientSelections() {
    // Clear all group checkboxes - start with nothing selected
    document.getElementById('sendToAll').checked = false;
    document.getElementById('sendToAll').indeterminate = false;
    document.getElementById('sendToPlayers').checked = false;  // Changed from true to false
    document.getElementById('sendToPlayers').indeterminate = false;
    document.getElementById('sendToWaitlist').checked = false;
    document.getElementById('sendToWaitlist').indeterminate = false;
    
    // Clear all individual player checkboxes
    const playerCheckboxes = document.querySelectorAll('.player-checkbox input[type="checkbox"]');
    playerCheckboxes.forEach(checkbox => {
        checkbox.checked = false;  // Changed to false for all players
    });
}


// Add this function to update the group checkbox styling to match individual players
function updateGroupCheckboxStyling() {
    // Style the group checkbox containers
    const groupCheckboxes = [
        document.getElementById('sendToAll')?.parentElement,
        document.getElementById('sendToPlayers')?.parentElement, 
        document.getElementById('sendToWaitlist')?.parentElement
    ];
    
    groupCheckboxes.forEach(container => {
        if (container) {
            // Apply consistent styling to match individual players
            container.style.cssText = `
                display: flex !important;
                flex-direction: row !important;
                align-items: center !important;
                gap: 12px !important;
                padding: 12px 15px !important;
                background: white !important;
                border: 2px solid #dee2e6 !important;
                border-radius: 8px !important;
                transition: all 0.2s ease !important;
                box-shadow: 0 1px 3px rgba(0,0,0,0.1) !important;
                margin-bottom: 8px !important;
            `;
            
            // Style the checkbox input
            const checkbox = container.querySelector('input[type="checkbox"]');
            if (checkbox) {
                checkbox.style.cssText = `
                    width: 18px !important; 
                    height: 18px !important; 
                    margin: 0 !important; 
                    flex-shrink: 0 !important;
                `;
            }
            
            // Style the label
            const label = container.querySelector('label');
            if (label) {
                label.style.cssText = `
                    margin: 0 !important; 
                    font-weight: 500 !important; 
                    cursor: pointer !important; 
                    flex: 1 !important;
                `;
            }
        }
    });
    
    // Add specific border colors for different groups
    const sendToAll = document.getElementById('sendToAll')?.parentElement;
    if (sendToAll) {
        sendToAll.style.borderLeft = '4px solid #007bff !important';
    }
    
    const sendToPlayers = document.getElementById('sendToPlayers')?.parentElement;
    if (sendToPlayers) {
        sendToPlayers.style.borderLeft = '4px solid #28a745 !important';
    }
    
    const sendToWaitlist = document.getElementById('sendToWaitlist')?.parentElement;
    if (sendToWaitlist) {
        sendToWaitlist.style.borderLeft = '4px solid #ffc107 !important';
    }
}


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
function updateGroupCheckboxStyling() {
    // Style the group checkbox containers
    const groupCheckboxes = [
        document.getElementById('sendToAll')?.parentElement,
        document.getElementById('sendToPlayers')?.parentElement, 
        document.getElementById('sendToWaitlist')?.parentElement
    ];
    
    groupCheckboxes.forEach(container => {
        if (container) {
            // Apply consistent styling to match individual players
            container.style.cssText = `
                display: flex !important;
                flex-direction: row !important;
                align-items: center !important;
                gap: 12px !important;
                padding: 12px 15px !important;
                background: white !important;
                border: 2px solid #dee2e6 !important;
                border-radius: 8px !important;
                transition: all 0.2s ease !important;
                box-shadow: 0 1px 3px rgba(0,0,0,0.1) !important;
                margin-bottom: 8px !important;
            `;
            
            // Style the checkbox input
            const checkbox = container.querySelector('input[type="checkbox"]');
            if (checkbox) {
                checkbox.style.cssText = `
                    width: 18px !important; 
                    height: 18px !important; 
                    margin: 0 !important; 
                    flex-shrink: 0 !important;
                `;
            }
            
            // Style the label
            const label = container.querySelector('label');
            if (label) {
                label.style.cssText = `
                    margin: 0 !important; 
                    font-weight: 500 !important; 
                    cursor: pointer !important; 
                    flex: 1 !important;
                `;
            }
        }
    });
    
    // Add specific border colors for different groups
    const sendToAll = document.getElementById('sendToAll')?.parentElement;
    if (sendToAll) {
        sendToAll.style.borderLeft = '4px solid #007bff !important';
    }
    
    const sendToPlayers = document.getElementById('sendToPlayers')?.parentElement;
    if (sendToPlayers) {
        sendToPlayers.style.borderLeft = '4px solid #28a745 !important';
    }
    
    const sendToWaitlist = document.getElementById('sendToWaitlist')?.parentElement;
    if (sendToWaitlist) {
        sendToWaitlist.style.borderLeft = '4px solid #ffc107 !important';
    }
}

function updatePlayerCheckboxes() {
    const container = document.getElementById('playerCheckboxes');
    if (!container) return;
    
    container.innerHTML = '';
    
    // Add confirmed players
    gameData.players.forEach(player => {
        if (player.phone && !player.isOrganizer) { // Only players with phones who aren't organizers
            const checkboxItem = document.createElement('div');
            checkboxItem.className = 'player-checkbox-item confirmed';
            
            // Styling to match group checkboxes
            checkboxItem.style.cssText = `
                display: flex !important;
                flex-direction: row !important;
                align-items: center !important;
                gap: 12px !important;
                padding: 12px 15px !important;
                background: white !important;
                border: 2px solid #dee2e6 !important;
                border-radius: 8px !important;
                border-left: 4px solid #28a745 !important;
                transition: all 0.2s ease !important;
                box-shadow: 0 1px 3px rgba(0,0,0,0.1) !important;
                margin-bottom: 8px !important;
                font-size: inherit !important;
                line-height: inherit !important;
            `;
            
            checkboxItem.innerHTML = `
                <input type="checkbox" 
                       class="player-checkbox" 
                       value="${player.id}" 
                       data-phone="${player.phone}" 
                       data-name="${player.name}" 
                       data-type="confirmed"
                       onchange="updateIndividualSelection()"
                       style="width: 18px !important; height: 18px !important; margin: 0 !important; flex-shrink: 0 !important;">
                <label style="margin: 0 !important; cursor: pointer !important; flex: 1 !important; font-size: inherit !important; line-height: inherit !important;">${player.name}</label>
            `;
            
            container.appendChild(checkboxItem);
        }
    });
    
    // Add waitlist players
    if (gameData.waitlist) {
        gameData.waitlist.forEach(player => {
            if (player.phone) {
                const checkboxItem = document.createElement('div');
                checkboxItem.className = 'player-checkbox-item waitlist';
                
                // Styling to match group checkboxes
                checkboxItem.style.cssText = `
                    display: flex !important;
                    flex-direction: row !important;
                    align-items: center !important;
                    gap: 12px !important;
                    padding: 12px 15px !important;
                    background: white !important;
                    border: 2px solid #dee2e6 !important;
                    border-radius: 8px !important;
                    border-left: 4px solid #ffc107 !important;
                    transition: all 0.2s ease !important;
                    box-shadow: 0 1px 3px rgba(0,0,0,0.1) !important;
                    margin-bottom: 8px !important;
                    font-size: inherit !important;
                    line-height: inherit !important;
                `;
                
                checkboxItem.innerHTML = `
                    <input type="checkbox" 
                           class="player-checkbox" 
                           value="${player.id}" 
                           data-phone="${player.phone}" 
                           data-name="${player.name}" 
                           data-type="waitlist"
                           onchange="updateIndividualSelection()"
                           style="width: 18px !important; height: 18px !important; margin: 0 !important; flex-shrink: 0 !important;">
                    <label style="margin: 0 !important; cursor: pointer !important; flex: 1 !important; font-size: inherit !important; line-height: inherit !important;">${player.name}</label>
                `;
                
                container.appendChild(checkboxItem);
            }
        });
    }
    
    // Show section only if there are players with phones
    const individualSection = document.getElementById('individualPlayersSection');
    if (individualSection) {
        const hasPlayers = container.children.length > 0;
        individualSection.style.display = hasPlayers ? 'block' : 'none';
    }
    
    // Explicitly uncheck all checkboxes on initial load
    const allPlayerCheckboxes = document.querySelectorAll('.player-checkbox');
    allPlayerCheckboxes.forEach(checkbox => {
        checkbox.checked = false;
    });
    
    // Also uncheck group checkboxes
    const groupCheckboxes = ['sendToAll', 'sendToPlayers', 'sendToWaitlist'];
    groupCheckboxes.forEach(id => {
        const checkbox = document.getElementById(id);
        if (checkbox) {
            checkbox.checked = false;
        }
    });
    
    // Set "Confirmed Players" as default checked
    const sendToPlayersCheckbox = document.getElementById('sendToPlayers');
    if (sendToPlayersCheckbox) {
        sendToPlayersCheckbox.checked = true;
    }
}

async function removeOutPlayer(playerId) {
  try {
    showConfirmModal(
      'Remove Player', 
      'Are you sure you want to remove this player from the "out" list?', 
      async () => {
        try {
          showStatus('Removing player...', 'info');
          
          const response = await fetch(`/api/games/${gameId}/out-players/${playerId}?token=${hostToken}`, {
            method: 'DELETE'
          });
          
          if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to remove player');
          }
          
          // Refresh game data
          await fetchGameData();
          
          showStatus('Player removed from "out" list', 'success');
          
        } catch (error) {
          console.error('Error removing out player:', error);
          showStatus('Error removing player: ' + error.message, 'error');
        }
      }
    );
  } catch (error) {
    console.error('Error removing out player:', error);
    showStatus('Error removing player: ' + error.message, 'error');
  }
}

// Also call the styling function when the page loads
document.addEventListener('DOMContentLoaded', () => {
    // ... existing DOMContentLoaded code ...
    
    // Apply consistent styling after everything is loaded
    setTimeout(() => {
        updateGroupCheckboxStyling();
    }, 200);
});

