// manage-scripts.js - All JavaScript for manage.html

let gameData = null;
let gameId = '';
let hostToken = '';

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

// Add this new function right after the existing openTab function
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
        console.log('Game data:', gameData);
        
        // Show management interface
        document.getElementById('loading').style.display = 'none';
        document.getElementById('gameManagement').style.display = 'block';
        
        // Populate game details
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

    const copyHostLinkBtn = document.getElementById('copyHostLink');
    if (copyHostLinkBtn) {
        copyHostLinkBtn.addEventListener('click', () => {
            copyToClipboard('hostLink');
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

function populateGameDetails() {
    // Fill the edit form with current values
    document.getElementById('location').value = gameData.location;
    document.getElementById('date').value = gameData.date;
    document.getElementById('time').value = gameData.time;
    document.getElementById('duration').value = gameData.duration;
    document.getElementById('players').value = gameData.totalPlayers;
    document.getElementById('message').value = gameData.message || '';
    
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
}

function populateShareLinks() {
    const playerLink = document.getElementById('playerLink');
    const hostLink = document.getElementById('hostLink');
    
    const baseUrl = window.location.origin;
    
    playerLink.value = `${baseUrl}/game.html?id=${gameId}`;
    hostLink.value = `${baseUrl}/manage.html?id=${gameId}&token=${hostToken}`;
}

async function updateGameDetails() {
    try {
        showStatus('Updating game details...', 'info');
        
        const updatedData = {
            location: document.getElementById('location').value,
            date: document.getElementById('date').value,
            time: document.getElementById('time').value,
            duration: document.getElementById('duration').value,
            totalPlayers: document.getElementById('players').value,
            message: document.getElementById('message').value,
            token: hostToken
        };
        
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
        
        const data = await response.json();
        console.log('Game updated:', data);
        
        // Refresh game data
        await fetchGameData();
        
        showStatus('Game details updated successfully! Players have been notified.', 'success');
        
    } catch (error) {
        console.error('Error updating game:', error);
        showStatus('Error updating game: ' + error.message, 'error');
    }
}

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
                addTo: action,
                token: hostToken
            })
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to add player');
        }
        
        const data = await response.json();
        console.log('Player added:', data);
        
        // Reset form
        document.getElementById('playerName').value = '';
        document.getElementById('playerPhone').value = '';
        
        // Refresh game data
        await fetchGameData();
        
        showStatus(`Player ${name} added successfully!`, 'success');
        
    } catch (error) {
        console.error('Error adding player:', error);
        showStatus('Error adding player: ' + error.message, 'error');
    }
}

async function moveToWaitlist(playerId) {
    try {
        showStatus('Moving player to waitlist...', 'info');
        
        // First find the player in the game data
        const player = gameData.players.find(p => p.id === playerId);
        if (!player) {
            throw new Error('Player not found');
        }
        
        // Remove from confirmed
        const response = await fetch(`/api/games/${gameId}/players/${playerId}?token=${hostToken}`, {
            method: 'DELETE'
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to remove player');
        }
        
        // Add to waitlist
        const addResponse = await fetch(`/api/games/${gameId}/manual-player?token=${hostToken}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                name: player.name,
                phone: player.phone,
                addTo: 'waitlist',
                token: hostToken
            })
        });
        
        if (!addResponse.ok) {
            const errorData = await addResponse.json();
            throw new Error(errorData.error || 'Failed to add to waitlist');
        }
        
        // Refresh game data
        await fetchGameData();
        
        showStatus(`Player ${player.name} moved to waitlist`, 'success');
        
    } catch (error) {
        console.error('Error moving player:', error);
        showStatus('Error moving player: ' + error.message, 'error');
    }
}

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
            throw new Error('Player not found');
        }
        
        // Remove from waitlist first
        const removeResponse = await fetch(`/api/games/${gameId}/players/${playerId}?token=${hostToken}`, {
            method: 'DELETE'
        });
        
        if (!removeResponse.ok) {
            const errorData = await removeResponse.json();
            throw new Error(errorData.error || 'Failed to remove from waitlist');
        }
        
        // Add to confirmed players
        const addResponse = await fetch(`/api/games/${gameId}/manual-player?token=${hostToken}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                name: player.name,
                phone: player.phone,
                addTo: 'add',
                token: hostToken
            })
        });
        
        if (!addResponse.ok) {
            const errorData = await addResponse.json();
            
            // If adding to game failed, try to add back to waitlist
            try {
                await fetch(`/api/games/${gameId}/manual-player?token=${hostToken}`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        name: player.name,
                        phone: player.phone,
                        addTo: 'waitlist',
                        token: hostToken
                    })
                });
            } catch (restoreError) {
                console.error('Failed to restore player to waitlist:', restoreError);
            }
            
            throw new Error(errorData.error || 'Failed to add to game');
        }
        
        const addData = await addResponse.json();
        
        // Check if they were actually added to confirmed players (not back to waitlist)
        if (addData.status === 'waitlist') {
            throw new Error('Game is full - player was moved back to waitlist');
        }
        
        // Refresh game data
        await fetchGameData();
        
        showStatus(`Player ${player.name} promoted to game`, 'success');
        
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
                    
                    // Refresh game data
                    await fetchGameData();
                    
                    showStatus(`Player ${player.name} removed from game`, 'success');
                    
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
            throw new Error('Player not found');
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
                    
                    // Refresh game data
                    await fetchGameData();
                    
                    showStatus(`Player ${player.name} removed from waitlist`, 'success');
                    
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
        const sendToPlayers = document.getElementById('sendToPlayers').checked;
        const sendToWaitlist = document.getElementById('sendToWaitlist').checked;
        
        if (!message) {
            throw new Error('Please enter a message');
        }
        
        if (!sendToPlayers && !sendToWaitlist) {
            throw new Error('Please select at least one recipient group');
        }
        
        showStatus('Sending announcement...', 'info');
        
        const response = await fetch(`/api/games/${gameId}/announcement?token=${hostToken}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                message,
                includeConfirmed: sendToPlayers,
                includeWaitlist: sendToWaitlist,
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
        
        showStatus(`Announcement sent to ${data.recipientCount} players`, 'success');
        
    } catch (error) {
        console.error('Error sending announcement:', error);
        showStatus('Error sending announcement: ' + error.message, 'error');
    }
}

function sendQuickMessage(type) {
    let message = '';
    
    if (type === 'reminder') {
        const date = new Date(gameData.date);
        const formattedDate = date.toLocaleDateString('en-US', { 
            weekday: 'short', 
            month: 'short', 
            day: 'numeric' 
        });
        
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

function copyPlayerInvitation() {
    const gameLink = document.getElementById('playerLink').value;
    
    // Format the date and time nicely
    const gameDate = new Date(gameData.date);
    const formattedDate = gameDate.toLocaleDateString('en-US', { 
        weekday: 'long', 
        month: 'long', 
        day: 'numeric' 
    });
    
    const formattedTime = formatTime(gameData.time);
    
    // Create a complete message with the link and instructions
    const message = `🏓 Join our pickleball game!

📍 Location: ${gameData.location}
📅 Date: ${formattedDate}
⏰ Time: ${formattedTime}
⏱️ Duration: ${gameData.duration} minutes
👥 Spots: ${gameData.totalPlayers} spots${gameData.message ? '\n💬 ' + gameData.message : ''}

Click this link to sign up:
${gameLink}

You'll get text confirmations and can easily cancel by replying "9" to any message. See you on the court! 🏓`;
    
    try {
        // Copy the complete message to clipboard
        navigator.clipboard.writeText(message).then(() => {
            // Show feedback
            const button = document.getElementById('copyPlayerLink');
            const originalText = button.textContent;
            button.textContent = '✅ Copied!';
            
            setTimeout(() => {
                button.textContent = originalText;
            }, 2000);
        }).catch(() => {
            // Fallback for older browsers
            fallbackCopyMessage(message);
        });
        
    } catch (err) {
        // Fallback for older browsers
        fallbackCopyMessage(message);
    }
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