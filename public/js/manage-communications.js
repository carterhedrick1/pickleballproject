// communications features for the management page.

async function postAnnouncement(message, recipients, { personalityWrapper = false } = {}) {
    const response = await fetch(
        `/api/games/${gameId}/announcement-individual?token=${hostToken}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message,
                recipients,
                personalityWrapper,
                token: hostToken
            })
        }
    );

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(data.error || 'Failed to send announcement');
    }
    return data;
}

async function sendAnnouncement() {
    if (!GameUtils.getGameStatus(gameData).canEdit) {
        showStatus('This game has ended, so announcements can no longer be sent.', 'error');
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

        const data = await postAnnouncement(message, recipients, {
            personalityWrapper: document.getElementById(
                'announcementPersonalityWrapper'
            ).checked
        });
        console.log('Announcement sent:', data);
        
        // Reset form
        document.getElementById('announcementText').value = '';
        document.getElementById('announcementPersonalityWrapper').checked = false;
        clearAllRecipientSelections();
        
        showStatus(`Announcement sent to ${data.recipientCount} ${data.recipientCount === 1 ? 'player' : 'players'}.`, 'success');
        
    } catch (error) {
        console.error('Error sending announcement:', error);
        showStatus('Error sending announcement: ' + error.message, 'error');
    }
}

function quickMessageText(type) {
    if (type === 'reminder') {
        // TIMEZONE FIX: Use proper date formatting
        const formattedDate = formatDateForDisplay(gameData.date);

        return `Reminder: Your pickleball game is on ${formattedDate} at ${formatTime(gameData.time)} — ${gameData.location}. Looking forward to seeing you there!`;
    }

    if (type === 'location') {
        // Repeating the location a player already has is not worth a text. The gate code in the
        // host's private notes is - but only when the host has seen it in the confirmation and
        // chosen to send it.
        const notes = String(gameData.hostNotes || '').trim();
        const base = `Location details for our pickleball game: ${gameData.location}. Game starts at ${formatTime(gameData.time)}.`;
        return notes ? `${base} ${notes}` : base;
    }

    return '';
}

// Confirmed players only. A waitlisted player has no spot yet, so "your game is on Saturday"
// and directions to the court would both be wrong for them.
function confirmedRecipients() {
    return (gameData?.players || [])
        .filter((player) => player.phone && !player.isOrganizer)
        .map((player) => ({
            id: player.id,
            phone: player.phone,
            name: player.name,
            type: 'confirmed'
        }));
}

function sendQuickMessage(type) {
    if (!GameUtils.getGameStatus(gameData).canEdit) {
        showStatus('This game has ended, so announcements can no longer be sent.', 'error');
        return;
    }

    const message = quickMessageText(type);
    if (!message) return;

    const recipients = confirmedRecipients();
    if (recipients.length === 0) {
        showStatus('None of your confirmed players have a phone number to text.', 'error');
        return;
    }

    const includesNotes = type === 'location' && Boolean(String(gameData.hostNotes || '').trim());
    const audience = `${recipients.length} confirmed ${recipients.length === 1 ? 'player' : 'players'}`;
    const notesWarning = includesNotes
        ? '\n\nThis includes your private host notes.'
        : '';

    showConfirmModal(
        type === 'reminder' ? 'Send Game Reminder' : 'Send Location Details',
        `Text this to ${audience} now?\n\n"${message}"${notesWarning}`,
        async () => {
            try {
                showStatus('Sending...', 'info');
                const data = await postAnnouncement(message, recipients);
                showStatus(
                    `Sent to ${data.recipientCount} ${data.recipientCount === 1 ? 'player' : 'players'}.`,
                    'success'
                );
            } catch (error) {
                console.error('Error sending quick message:', error);
                showStatus('Error sending message: ' + error.message, 'error');
            }
        }
    );
}

function getSelectedRecipients() {
    const recipients = [];

    // Only the two real group toggles count. The old fallback selectors could bind
    // "send to players" to any checked checkbox on the page, including a notification
    // preference toggle that has nothing to do with this announcement.
    const sendToPlayers = document.getElementById('sendToPlayers')?.checked || false;
    const sendToWaitlist = document.getElementById('sendToWaitlist')?.checked || false;

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
    }

    // Individual picks live inside the recipient list only. Scanning the whole document swept
    // in unrelated checkboxes such as the notification preferences.
    const individualContainer = document.getElementById('playerCheckboxes');
    const playerCheckboxes = individualContainer
        ? individualContainer.querySelectorAll('input[type="checkbox"]:checked')
        : [];

    playerCheckboxes.forEach(checkbox => {
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
    
    return recipients;
}

// The recipient rows are inputs with the class, not wrappers around one, so the old
// ".player-checkbox input" selectors matched nothing and the group toggles never reached the
// individual rows. Everything here is scoped to the recipient list for the same reason.
function recipientCheckboxes(type) {
    const container = document.getElementById('playerCheckboxes');
    if (!container) return [];
    const selector = type
        ? `.player-checkbox[data-type="${type}"]`
        : '.player-checkbox';
    return Array.from(container.querySelectorAll(selector));
}

function toggleAllPlayers(checked) {
    // Update group checkboxes
    document.getElementById('sendToPlayers').checked = checked;
    document.getElementById('sendToWaitlist').checked = checked;

    // Update individual player checkboxes
    recipientCheckboxes().forEach(checkbox => {
        checkbox.checked = checked;
    });
}

function updateGroupSelections() {
    const sendToPlayers = document.getElementById('sendToPlayers').checked;
    const sendToWaitlist = document.getElementById('sendToWaitlist').checked;
    const sendToAll = document.getElementById('sendToAll');
    
    // Update individual checkboxes based on group selections
    const confirmedCheckboxes = recipientCheckboxes('confirmed');
    const waitlistCheckboxes = recipientCheckboxes('waitlist');
    
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
    const confirmedCheckboxes = recipientCheckboxes('confirmed');
    const waitlistCheckboxes = recipientCheckboxes('waitlist');
    
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
    recipientCheckboxes().forEach(checkbox => {
        checkbox.checked = false;
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

const RECIPIENT_GROUP_IDS = ['sendToAll', 'sendToPlayers', 'sendToWaitlist'];

function updatePlayerCheckboxes() {
    const container = document.getElementById('playerCheckboxes');
    if (!container) return;

    // This runs on every roster refresh, so a host who is halfway through picking recipients
    // must get their picks back rather than watching them clear underneath them.
    const firstRender = container.dataset.rendered !== 'true';
    const selectedIds = new Set(
        Array.from(container.querySelectorAll('input[type="checkbox"]:checked'))
            .map((checkbox) => checkbox.value)
    );
    const groupState = {};
    RECIPIENT_GROUP_IDS.forEach((id) => {
        const checkbox = document.getElementById(id);
        groupState[id] = {
            checked: Boolean(checkbox && checkbox.checked),
            indeterminate: Boolean(checkbox && checkbox.indeterminate)
        };
    });

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
    
    container.dataset.rendered = 'true';

    if (firstRender) {
        // A fresh page starts with the confirmed players as the default audience.
        container.querySelectorAll('input[type="checkbox"]').forEach((checkbox) => {
            checkbox.checked = false;
        });
        RECIPIENT_GROUP_IDS.forEach((id) => {
            const checkbox = document.getElementById(id);
            if (checkbox) {
                checkbox.checked = id === 'sendToPlayers';
                checkbox.indeterminate = false;
            }
        });
        return;
    }

    container.querySelectorAll('input[type="checkbox"]').forEach((checkbox) => {
        checkbox.checked = selectedIds.has(checkbox.value);
    });
    RECIPIENT_GROUP_IDS.forEach((id) => {
        const checkbox = document.getElementById(id);
        if (checkbox) {
            checkbox.checked = groupState[id].checked;
            checkbox.indeterminate = groupState[id].indeterminate;
        }
    });
}



window.ManageApp.communications = {

    sendAnnouncement,
    sendQuickMessage,
    quickMessageText,
    getSelectedRecipients,
    toggleAllPlayers,
    updateGroupSelections,
    updateIndividualSelection,
    clearAllRecipientSelections,
    updateGroupCheckboxStyling,
    updatePlayerCheckboxes

};
