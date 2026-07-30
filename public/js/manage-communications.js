// communications features for the management page.

async function sendAnnouncement() {
    if (!GameUtils.getGameStatus(gameData).canEdit) {
        showStatus('Cannot send announcements for expired games', 'error');
        return;
    }
    
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
                personalityWrapper: document.getElementById(
                    'announcementPersonalityWrapper'
                ).checked,
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
        document.getElementById('announcementPersonalityWrapper').checked = false;
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
                background: var(--surface) !important;
                border: 2px solid var(--border) !important;
                border-radius: 8px !important;
                transition: all 0.2s ease !important;
                box-shadow: 0 1px 3px color-mix(in srgb, var(--ink) 10%, transparent) !important;
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
        sendToAll.style.borderLeft = '4px solid var(--brand) !important';
    }
    
    const sendToPlayers = document.getElementById('sendToPlayers')?.parentElement;
    if (sendToPlayers) {
        sendToPlayers.style.borderLeft = '4px solid var(--brand) !important';
    }
    
    const sendToWaitlist = document.getElementById('sendToWaitlist')?.parentElement;
    if (sendToWaitlist) {
        sendToWaitlist.style.borderLeft = '4px solid var(--warning) !important';
    }
}

function updatePlayerCheckboxes() {
    const container = document.getElementById('playerCheckboxes');
    if (!container) return;
    
    container.innerHTML = '';
    
    // Add confirmed players
    gameData.players.forEach(player => {
        if (player.phone && !player.isOrganizer) { // Only players with phones who aren't organizers
            const checkboxItem = ManageRender.createRecipientOption(
                document,
                player,
                'confirmed',
                updateIndividualSelection
            );
            
            // Styling to match group checkboxes
            checkboxItem.style.cssText = `
                display: flex !important;
                flex-direction: row !important;
                align-items: center !important;
                gap: 12px !important;
                padding: 12px 15px !important;
                background: var(--surface) !important;
                border: 2px solid var(--border) !important;
                border-radius: 8px !important;
                border-left: 4px solid var(--brand) !important;
                transition: all 0.2s ease !important;
                box-shadow: 0 1px 3px color-mix(in srgb, var(--ink) 10%, transparent) !important;
                margin-bottom: 8px !important;
                font-size: inherit !important;
                line-height: inherit !important;
            `;
            
            container.appendChild(checkboxItem);
        }
    });
    
    // Add waitlist players
    if (gameData.waitlist) {
        gameData.waitlist.forEach(player => {
            if (player.phone) {
                const checkboxItem = ManageRender.createRecipientOption(
                    document,
                    player,
                    'waitlist',
                    updateIndividualSelection
                );
                
                // Styling to match group checkboxes
                checkboxItem.style.cssText = `
                    display: flex !important;
                    flex-direction: row !important;
                    align-items: center !important;
                    gap: 12px !important;
                    padding: 12px 15px !important;
                    background: var(--surface) !important;
                    border: 2px solid var(--border) !important;
                    border-radius: 8px !important;
                    border-left: 4px solid var(--warning) !important;
                    transition: all 0.2s ease !important;
                    box-shadow: 0 1px 3px color-mix(in srgb, var(--ink) 10%, transparent) !important;
                    margin-bottom: 8px !important;
                    font-size: inherit !important;
                    line-height: inherit !important;
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



window.ManageApp.communications = {

    sendAnnouncement,
    sendQuickMessage,
    getSelectedRecipients,
    toggleAllPlayers,
    updateGroupSelections,
    updateIndividualSelection,
    clearAllRecipientSelections,
    updateGroupCheckboxStyling,
    updatePlayerCheckboxes

};
