        document.addEventListener('DOMContentLoaded', () => {
            // Set up form submission
            const gameForm = document.getElementById('gameForm');
            gameForm.addEventListener('submit', createGame);
            
            // Set up copy button - simplified
            document.getElementById('copyLink').addEventListener('click', copyToClipboard);
            // TIMEZONE FIX: Set default date to tomorrow using local date
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            
            // Format date as YYYY-MM-DD for HTML date input (local timezone)
            const year = tomorrow.getFullYear();
            const month = String(tomorrow.getMonth() + 1).padStart(2, '0');
            const day = String(tomorrow.getDate()).padStart(2, '0');
            const tomorrowStr = `${year}-${month}-${day}`;
            
            document.getElementById('date').value = tomorrowStr;
            // Set default start time to 6:00 PM
            document.getElementById('time').value = '18:00';
            setupLocationPicker();
            document.querySelectorAll('[data-checkbox-id]').forEach((element) => {
                element.addEventListener('click', (event) => {
                    toggleNotification(element, element.dataset.checkboxId, event);
                });
            });
            document.querySelectorAll('[data-radio-id]').forEach((element) => {
                element.addEventListener('click', (event) => {
                    toggleRegistrationMode(element, element.dataset.radioId, event);
                });
            });
        });

        // ---------------------------------------------------------------------------
        // Location picker
        //
        // The dropdown is a convenience on top of the #location text input, never a
        // replacement for it: picking a court copies the name into that input, which is
        // still what gets submitted. If /api/locations is slow or down, the input is simply
        // left visible as a plain text field and the form works exactly as it did before.
        // ---------------------------------------------------------------------------

        const NEW_LOCATION_VALUE = '__new__';

        async function loadCourtImage(courtName) {
            const container = document.getElementById('courtImageContainer');
            const gallery = document.getElementById('courtImageGallery');
            if (!courtName) {
                container.style.display = 'none';
                return;
            }
            try {
                const res = await fetch(`/api/courts/${encodeURIComponent(courtName)}/library`);
                if (res.ok) {
                    const data = await res.json();
                    const images = data.images || [];
                    gallery.innerHTML = '';

                    if (images.length > 0) {
                        images.forEach((image) => {
                            const label = document.createElement('label');
                            label.style.cursor = 'pointer';
                            label.style.position = 'relative';

                            const input = document.createElement('input');
                            input.type = 'radio';
                            input.name = 'selectedCourtImage';
                            input.value = image.id;
                            input.style.position = 'absolute';
                            input.style.top = '5px';
                            input.style.left = '5px';
                            input.style.zIndex = '10';

                            const img = document.createElement('img');
                            img.src = `/api/court-images/${image.id}`;
                            img.alt = 'Court image';
                            img.style.width = '100%';
                            img.style.height = '80px';
                            img.style.objectFit = 'cover';
                            img.style.borderRadius = '8px';
                            img.style.border = '2px solid #ddd';
                            img.style.display = 'block';

                            label.appendChild(input);
                            label.appendChild(img);
                            gallery.appendChild(label);
                        });
                        container.style.display = 'block';
                    } else {
                        container.style.display = 'none';
                    }
                } else {
                    container.style.display = 'none';
                }
            } catch (err) {
                container.style.display = 'none';
            }
        }

        async function setupLocationPicker() {
            const select = document.getElementById('locationSelect');
            const freeText = document.getElementById('locationFreeText');
            const input = document.getElementById('location');
            if (!select || !input) return;

            select.addEventListener('change', () => {
                if (select.value === NEW_LOCATION_VALUE) {
                    freeText.style.display = 'block';
                    input.value = '';
                    input.focus();
                    loadCourtImage('');
                } else {
                    // Keep the input in the DOM and populated - createGame() reads it.
                    input.value = select.value;
                    freeText.style.display = select.value ? 'none' : 'block';
                    loadCourtImage(select.value);
                }
            });

            try {
                const response = await fetch('/api/locations');
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const { locations = [] } = await response.json();

                if (!locations.length) throw new Error('no saved courts yet');

                select.innerHTML = '';
                const placeholder = document.createElement('option');
                placeholder.value = '';
                placeholder.textContent = 'Choose a court...';
                select.appendChild(placeholder);

                locations.forEach((name) => {
                    const option = document.createElement('option');
                    option.value = name;
                    option.textContent = name;
                    select.appendChild(option);
                });

                const newOption = document.createElement('option');
                newOption.value = NEW_LOCATION_VALUE;
                newOption.textContent = 'Somewhere new...';
                select.appendChild(newOption);
            } catch (error) {
                // Never block creating a game on this. Hide the dropdown, keep the text box.
                console.warn('Could not load saved courts, falling back to free text:', error);
                select.required = false;
                select.closest('.form-group').style.display = 'none';
                freeText.style.display = 'block';
            }
        }

        function toggleNotification(element, checkboxId, event) {
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

        function toggleRegistrationMode(element, radioId, event) {
            // Get all mode options
            const allModeOptions = document.querySelectorAll('.mode-option');
            const selectedRadio = document.getElementById(radioId);
            
            // Remove checked class from all options
            allModeOptions.forEach(option => {
                option.classList.remove('checked');
            });
            
            // Add checked class to clicked option
            element.classList.add('checked');
            
            // Check the corresponding radio button
            selectedRadio.checked = true;
            
            // Prevent event bubbling
            event.stopPropagation();
        }

async function createGame(e) {
    e.preventDefault();
    
    const formData = new FormData(e.target);
    
    // Collect notification preferences explicitly
    const notificationPreferences = {
        gameFull: formData.get('notifyGameFull') === 'on',
        playerJoins: formData.get('notifyPlayerJoins') === 'on',
        playerCancels: formData.get('notifyPlayerCancels') === 'on',
        oneSpotLeft: formData.get('notifyOneSpotLeft') === 'on',
        waitlistStarts: formData.get('notifyWaitlistStarts') === 'on'
    };
    
    const gameData = {
        location: formData.get('location'),
        courtNumber: formData.get('courtNumber') || '',
        organizerName: formData.get('organizerName'),
        organizerPhone: formData.get('organizerPhone'),
        organizerPlaying: formData.get('organizerPlaying') === 'on',
        date: formData.get('date'),
        time: formData.get('time'),
        duration: parseInt(formData.get('duration')),
        totalPlayers: parseInt(formData.get('players')),
        message: formData.get('message'),
        registrationMode: formData.get('registrationMode'),
        notificationPreferences: notificationPreferences,
        hostPhone: formData.get('organizerPhone')
    };
    
    try {
        showStatus('Creating game...', 'info');
        
        const response = await fetch('/api/games', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(gameData)
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to create game');
        }
        
        const data = await response.json();
        // Set the selected court image for this game if one was chosen
        const selectedImage = document.querySelector('input[name="selectedCourtImage"]:checked');
        if (selectedImage && selectedImage.value !== 'none') {
            try {
                await fetch(`/api/games/${data.gameId}/court-image/${selectedImage.value}?token=${data.hostToken}`, {
                    method: 'PUT'
                });
            } catch (err) {
                console.error('Could not set court image:', err);
            }
        }

        // Save enough detail for the post-create invitation and browser history.
        let myGames = JSON.parse(localStorage.getItem('myGames') || '[]');
        myGames.push({
            id: data.gameId,
            hostToken: data.hostToken,
            location: gameData.location,
            courtNumber: gameData.courtNumber,
            date: gameData.date,
            time: gameData.time,
            duration: gameData.duration,
            totalPlayers: gameData.totalPlayers,
            organizerPlaying: gameData.organizerPlaying,
            registrationMode: gameData.registrationMode,
            message: gameData.message,
            created: new Date().toISOString(),
            cancelled: false
        });
        localStorage.setItem('myGames', JSON.stringify(myGames));

        
        // Show game links
        showGameLinks(data.gameId);
        
        // Clear form
        document.getElementById('gameForm').reset();
        
        // Set tomorrow's date and default time again
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const year = tomorrow.getFullYear();
        const month = String(tomorrow.getMonth() + 1).padStart(2, '0');
        const day = String(tomorrow.getDate()).padStart(2, '0');
        const tomorrowStr = `${year}-${month}-${day}`;
        document.getElementById('date').value = tomorrowStr;
        document.getElementById('time').value = '18:00';
        
        // Check SMS status and show appropriate message
        if (data.hostSms && data.hostSms.success) {
            showStatus('Game created successfully! Check your phone for confirmation. Reply "1" to get your management link.', 'success');
        } else if (data.hostSms && !data.hostSms.success) {
            showStatus('Game created successfully! However, we couldn\'t send the confirmation text.', 'success');
        } else if (data.hostSms && data.hostSms.dev) {
            showStatus('Game created successfully! (SMS confirmation disabled in development mode)', 'success');
        } else {
            showStatus('Game created successfully!', 'success');
        }
        
    } catch (error) {
        console.error('[CLIENT] Error creating game:', error);
        showStatus('Error creating game: ' + error.message, 'error');
    }
}

        function showGameLinks(gameId) {
            // Store the game ID for the copy function
            window.currentGameId = gameId;
            
            // Show the share link section
            document.getElementById('shareLink').style.display = 'block';
            
            // Scroll to the links
            document.getElementById('shareLink').scrollIntoView({ behavior: 'smooth' });
        }

        function copyToClipboard() {
            const currentGameData = InvitationGenerator.getCurrentGameDataFromStorage();
            if (!currentGameData.registrationMode) {
                currentGameData.registrationMode = 'fcfs';
            }
            InvitationGenerator.copyInvitationToClipboard(
                currentGameData,
                window.currentGameId,
                'copyLink'
            );
        }

        function showStatus(message, type) {
    const statusDiv = document.getElementById('status');
    statusDiv.textContent = message;
    statusDiv.className = type;
    statusDiv.style.display = 'block';
    
    // Scroll to top to show the status message
    statusDiv.scrollIntoView({ 
        behavior: 'smooth', 
        block: 'center' 
    });
    
    // Auto-hide success and info messages
    if (type === 'success' || type === 'info') {
        setTimeout(() => {
            statusDiv.style.display = 'none';
        }, 5000);
    }
    
    // Keep error messages visible until manually dismissed
    // You could add a click handler to dismiss errors if desired
}
