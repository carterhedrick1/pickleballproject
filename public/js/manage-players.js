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
    renderIntendedInvitees();
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
        const response = await fetch(`/api/roster/${encodeURIComponent(gameData.hostPhone)}`, {
            headers: {
                'X-Game-Id': gameId,
                'X-Host-Token': hostToken
            }
        });
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

function renderIntendedInvitees() {
    const list = document.getElementById('intendedInviteeList');
    const status = document.getElementById('intendedInviteeStatus');
    const button = document.getElementById('saveIntendedInvitees');
    if (!list || !status || !button) return;
    list.innerHTML = '';
    if (hostRosterState === 'loading' || hostRosterState === 'idle') {
        status.textContent = 'Loading your roster...';
        button.disabled = true;
        return;
    }
    if (hostRosterState === 'error') {
        status.textContent = 'Could not load your roster.';
        button.disabled = true;
        return;
    }
    const selectedPhones = new Set(
        (gameData?.invitedPlayers || []).map((player) => normalizedPlayerPhone(player.phone))
    );
    if (!hostRoster.length) {
        status.textContent = 'Your roster is empty.';
        button.disabled = true;
        return;
    }
    hostRoster.forEach((player) => {
        const label = document.createElement('label');
        label.className = 'roster-picker-option';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.className = 'intended-invitee-checkbox';
        input.dataset.phone = player.phone;
        input.checked = selectedPhones.has(normalizedPlayerPhone(player.phone));
        const name = document.createElement('span');
        name.textContent = player.name || player.phone;
        label.append(input, name);
        list.appendChild(label);
    });
    status.textContent = `${selectedPhones.size} intended invitee${selectedPhones.size === 1 ? '' : 's'} saved. Copying an invitation does not confirm delivery.`;
    button.disabled = false;
}

async function saveIntendedInvitees() {
    const button = document.getElementById('saveIntendedInvitees');
    const status = document.getElementById('intendedInviteeStatus');
    const playerPhones = Array.from(document.querySelectorAll(
        '.intended-invitee-checkbox:checked'
    )).map((input) => input.dataset.phone);
    button.disabled = true;
    status.textContent = 'Saving intended invitees...';
    try {
        const response = await fetch(`/api/games/${gameId}/invitees`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: hostToken, playerPhones })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'Could not save intended invitees');
        gameData.invitedPlayers = data.intendedInvitees || [];
        renderIntendedInvitees();
    } catch (error) {
        status.textContent = error.message;
        button.disabled = false;
    }
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
        showStatus('This game has ended, so players can no longer be added.', 'error');
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
        showStatus('Please select at least one player to add.', 'error');
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
    showStatus(`${addedText} successfully${smsText}.`, smsFailures ? 'error' : 'success');
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
            // The organizer's seat is held by organizerPlaying, which nothing on this page can
            // switch off, so offering Remove or To Waitlist here only leads to a game that is
            // permanently one player short.
            const actions = player.isOrganizer ? [] : [
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
            ];
            confirmedPlayers.appendChild(ManageRender.createPlayerItem(document, player, {
                meta: player.isOrganizer ? ['You are hosting this game'] : [],
                actions
            }));
        });
    }
    
    // Populate waitlist
    if (gameData.waitlist.length === 0) {
        waitlistPlayers.innerHTML = '<p style="text-align: center; color: var(--text-muted); font-style: italic;">Nobody waiting</p>';
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
        outPlayersContainer.innerHTML = '<p style="text-align: center; color: var(--text-muted); font-style: italic;">Nobody marked as out</p>';
    } else {
        gameData.outPlayers.forEach((player) => {
            outPlayersContainer.appendChild(
                ManageRender.createPlayerItem(document, player, {
                    actions: [
                        {
                            label: 'Add Back',
                            className: 'btn-secondary',
                            onClick: () => addOutPlayerBackToGame(player.id)
                        },
                        {
                            label: 'Clear',
                            className: 'btn-danger',
                            onClick: () => removeOutPlayer(player.id)
                        }
                    ]
                })
            );
        });
    }
    
    // Update player checkboxes for messaging
    updatePlayerCheckboxes();
}

async function addPlayerManually() {
    if (!GameUtils.getGameStatus(gameData).canEdit) {
        showStatus('This game has ended, so players can no longer be added.', 'error');
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
        let statusMessage = `${name} added`;
        
        // Add SMS status info
        if (phone && data.sms && data.sms.success) {
            statusMessage += ' and notified via SMS';
        } else if (phone && data.sms && !data.sms.success) {
            statusMessage += ' (SMS notification failed)';
        } else if (!phone) {
            statusMessage += ' — they will not get texts';
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
    let statusMessage = `${player.name} moved to waitlist`;
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
    let statusMessage = `${player.name} promoted to confirmed players`;
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
          let statusMessage = `${player.name} removed from game`;
          
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
          let statusMessage = `${player.name} removed from waitlist`;
          
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

// Somebody who said OUT and then found a sitter is the most common roster change there is, and
// until now the only way back in was for the host to retype their name and number by hand.
async function addOutPlayerBackToGame(playerId) {
  if (!GameUtils.getGameStatus(gameData).canEdit) {
    showStatus('This game has ended, so players can no longer be added.', 'error');
    return;
  }

  const player = (gameData.outPlayers || []).find((entry) => entry.id === playerId);
  if (!player) {
    showStatus('That player is no longer on the "out" list.', 'error');
    return;
  }

  const gameIsFull = gameData.players.length >= parseInt(gameData.totalPlayers, 10);
  const destination = gameIsFull ? 'waitlist' : 'add';
  const destinationLabel = gameIsFull ? 'the waitlist' : 'the confirmed players';

  showConfirmModal(
    'Add Player Back',
    `Add ${player.name} back to ${destinationLabel}?`,
    async () => {
      try {
        showStatus('Adding player back...', 'info');
        const data = await postHostPlayer({ name: player.name, phone: player.phone }, destination);

        // Clearing the "out" entry second means a failure above leaves the roster untouched
        // rather than dropping the player off both lists.
        await fetch(`/api/games/${gameId}/out-players/${playerId}?token=${hostToken}`, {
          method: 'DELETE'
        });

        await fetchGameData();

        let statusMessage = `${player.name} added back to ${destinationLabel}`;
        if (player.phone && data.sms && data.sms.success) {
          statusMessage += ' and notified by text.';
        } else if (player.phone && data.sms && !data.sms.success) {
          statusMessage += ', but the text did not go out.';
        } else {
          statusMessage += '.';
        }
        showStatus(statusMessage, 'success');
      } catch (error) {
        console.error('Error adding out player back:', error);
        showStatus('Could not add that player back: ' + error.message, 'error');
      }
    }
  );
}

async function removeOutPlayer(playerId) {
  try {
    const player = (gameData.outPlayers || []).find((entry) => entry.id === playerId);
    showConfirmModal(
      'Remove Player',
      `Remove ${player ? player.name : 'this player'} from the "out" list?`,
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
          
          showStatus('Player removed from the "out" list.', 'success');
          
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
    removeOutPlayer,
    addOutPlayerBackToGame

};
