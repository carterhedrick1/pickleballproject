// players features for the management page.

let hostRoster = [];
let hostRosterState = 'idle';

function normalizedPlayerPhone(value) {
    const digits = String(value || '').replace(/\D/g, '');
    return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
}

function currentGamePhones() {
    return new Set([
        ...(gameData?.players || []),
        ...(gameData?.waitlist || []),
        ...(gameData?.outPlayers || [])
    ].map((player) => normalizedPlayerPhone(player.phone)).filter(Boolean));
}

function updateRosterSelectionState() {
    const button = document.getElementById('addRosterPlayersBtn');
    if (!button) return;

    const count = document.querySelectorAll(
        '#rosterPlayerList .roster-player-checkbox:checked'
    ).length;
    button.disabled = count === 0;
    button.textContent = count === 1 ? 'Add 1 Selected Player' :
        (count > 1 ? `Add ${count} Selected Players` : 'Add Selected Players');
}

function renderHostRoster() {
    const list = document.getElementById('rosterPlayerList');
    const status = document.getElementById('rosterPickerStatus');
    const actions = document.getElementById('rosterPickerActions');
    if (!list || !status || !actions) return;

    list.innerHTML = '';
    status.classList.remove('error-text');

    if (hostRosterState === 'loading' || hostRosterState === 'idle') {
        status.textContent = 'Loading your roster...';
        actions.hidden = true;
        return;
    }

    if (hostRosterState === 'error') {
        status.textContent = 'Could not load your roster. Please refresh the page to try again.';
        status.classList.add('error-text');
        actions.hidden = true;
        return;
    }

    const listedPhones = currentGamePhones();
    const available = hostRoster.filter(
        (player) => !listedPhones.has(normalizedPlayerPhone(player.phone))
    );

    if (hostRoster.length === 0) {
        status.textContent =
            'Your roster is empty. Players with phone numbers appear here after they join one of your games.';
        actions.hidden = true;
        return;
    }

    if (available.length === 0) {
        status.textContent = 'Everyone on your roster is already listed for this game.';
        actions.hidden = true;
        return;
    }

    status.textContent = `${available.length} ${available.length === 1 ? 'player is' : 'players are'} available.`;
    available.forEach((player) => {
        list.appendChild(
            ManageRender.createRosterOption(document, player, updateRosterSelectionState)
        );
    });
    actions.hidden = false;
    updateRosterSelectionState();
}

async function loadHostRoster() {
    if (!gameData?.hostPhone) {
        hostRoster = [];
        hostRosterState = 'loaded';
        renderHostRoster();
        return;
    }

    if (hostRosterState === 'loaded') {
        renderHostRoster();
        return;
    }

    if (hostRosterState === 'loading') return;
    hostRosterState = 'loading';
    renderHostRoster();

    try {
        const response = await fetch(`/api/roster/${encodeURIComponent(gameData.hostPhone)}`);
        if (!response.ok) throw new Error(`Server returned ${response.status}`);
        const data = await response.json();
        hostRoster = Array.isArray(data.roster) ? data.roster : [];
        hostRosterState = 'loaded';
    } catch (error) {
        console.error('Error loading host roster:', error);
        hostRosterState = 'error';
    }

    renderHostRoster();
}

async function postHostPlayer(player, addTo) {
    const response = await fetch(`/api/games/${gameId}/manual-player?token=${hostToken}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            name: player.name,
            phone: player.phone,
            addTo,
            token: hostToken
        })
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(data.error || 'Failed to add player');
    }
    return data;
}

async function addPlayersFromRoster() {
    if (!GameUtils.getGameStatus(gameData).canEdit) {
        showStatus('Cannot add players to expired games', 'error');
        return;
    }

    const selectedPhones = new Set(
        [...document.querySelectorAll('#rosterPlayerList .roster-player-checkbox:checked')]
            .map((input) => normalizedPlayerPhone(input.dataset.phone))
    );
    const selectedPlayers = hostRoster.filter(
        (player) => selectedPhones.has(normalizedPlayerPhone(player.phone))
    );

    if (selectedPlayers.length === 0) {
        showStatus('Select at least one roster player to add', 'error');
        return;
    }

    const addTo = document.querySelector('input[name="rosterAddTo"]:checked').value;
    const button = document.getElementById('addRosterPlayersBtn');
    button.disabled = true;
    showStatus(
        `Adding ${selectedPlayers.length} roster ${selectedPlayers.length === 1 ? 'player' : 'players'}...`,
        'info'
    );

    const added = [];
    const failed = [];
    let smsFailures = 0;

    for (const player of selectedPlayers) {
        try {
            const result = await postHostPlayer(player, addTo);
            added.push(player);
            if (player.phone && result.sms && !result.sms.success) smsFailures += 1;
        } catch (error) {
            failed.push({ player, message: error.message });
        }
    }

    await fetchGameData();

    const addedText = `${added.length} roster ${added.length === 1 ? 'player' : 'players'} added`;
    if (failed.length) {
        const failedNames = failed.map(({ player }) => player.name || player.phone).join(', ');
        showStatus(
            `${added.length ? `${addedText}. ` : ''}Could not add ${failedNames}.`,
            'error'
        );
        return;
    }

    const smsText = smsFailures
        ? ` (${smsFailures} SMS ${smsFailures === 1 ? 'notification' : 'notifications'} failed)`
        : '';
    showStatus(`${addedText} successfully${smsText}`, smsFailures ? 'error' : 'success');
}

function updatePlayerLists() {
    const confirmedPlayers = document.getElementById('confirmedPlayers');
    const waitlistPlayers = document.getElementById('waitlistPlayers');
    const outPlayersContainer = document.getElementById('outPlayers'); // Add this line
    const playerCount = document.getElementById('playerCount');
    const totalPlayers = document.getElementById('totalPlayers');
    const waitlistCount = document.getElementById('waitlistCount');
    
    // Clear existing lists - MAKE SURE TO CLEAR OUT PLAYERS TOO
    confirmedPlayers.innerHTML = '';
    waitlistPlayers.innerHTML = '';
    outPlayersContainer.innerHTML = ''; // Add this line to clear out players
    
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
        confirmedPlayers.innerHTML = '<p style="text-align: center; color: var(--text-muted); font-style: italic;">No players yet</p>';
    } else {
        gameData.players.forEach((player) => {
            confirmedPlayers.appendChild(ManageRender.createPlayerItem(document, player, {
                actions: [
                    {
                        label: 'To Waitlist',
                        className: 'btn-secondary',
                        onClick: () => moveToWaitlist(player.id)
                    },
                    {
                        label: 'Remove',
                        className: 'btn-danger',
                        onClick: () => removePlayer(player.id)
                    }
                ]
            }));
        });
    }
    
    // Populate waitlist
    if (gameData.waitlist.length === 0) {
        waitlistPlayers.innerHTML = '<p style="text-align: center; color: var(--text-muted); font-style: italic;">No one waiting</p>';
    } else {
        gameData.waitlist.forEach((player, index) => {
            waitlistPlayers.appendChild(ManageRender.createPlayerItem(document, player, {
                meta: [`Position: #${index + 1}`],
                actions: [
                    {
                        label: 'Promote',
                        className: 'btn-secondary',
                        onClick: () => promoteToGame(player.id)
                    },
                    {
                        label: 'Remove',
                        className: 'btn-danger',
                        onClick: () => removeWaitlisted(player.id)
                    }
                ]
            }));
        });
    }

    // Populate out players - FIXED VERSION
    if (!gameData.outPlayers || gameData.outPlayers.length === 0) {
        outPlayersContainer.innerHTML = '<p style="text-align: center; color: var(--text-muted); font-style: italic;">No one marked as out</p>';
    } else {
        gameData.outPlayers.forEach((player) => {
            outPlayersContainer.appendChild(
                ManageRender.createPlayerItem(document, player)
            );
        });
    }
    
    // Update player checkboxes for messaging
    updatePlayerCheckboxes();
}

async function addPlayerManually() {
    if (!GameUtils.getGameStatus(gameData).canEdit) {
        showStatus('Cannot add players to expired games', 'error');
        return;
    }
    
    try {
        const name = document.getElementById('playerName').value;
        const phone = document.getElementById('playerPhone').value;
        const addTo = document.querySelector('input[name="addTo"]:checked').value;
        
        showStatus('Adding player...', 'info');

        const data = await postHostPlayer({ name, phone }, addTo);
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
      'Remove From Waitlist',
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



window.ManageApp.players = {

    updatePlayerLists,
    loadHostRoster,
    addPlayersFromRoster,
    addPlayerManually,
    moveToWaitlist,
    promoteToGame,
    removePlayer,
    removeWaitlisted,
    removeOutPlayer

};
