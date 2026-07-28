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
        const UPLOAD_IMAGE_VALUE = '__upload__';
        const MAX_COURT_IMAGE_BYTES = 5 * 1024 * 1024;
        const ACCEPTED_COURT_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
        let currentCourtImages = [];
        let courtImagePreviewUrl = null;
        let courtImageRequestSerial = 0;
        let courtImageLookupTimer = null;
        let courtImageLoadPromise = Promise.resolve();

        function setCourtImageStatus(message, isError = false) {
            const status = document.getElementById('courtImageStatus');
            status.textContent = message;
            status.classList.toggle('is-error', isError);
        }

        function updateCourtImageCount() {
            const count = document.getElementById('courtImageCount');
            const hasUpload = Boolean(document.getElementById('courtImageUpload').files[0]);
            if (!currentCourtImages.length && !hasUpload) {
                count.textContent = '';
                return;
            }
            count.textContent = `${currentCourtImages.length} saved${hasUpload ? ' + 1 new' : ''}`;
        }

        function makeImageChoice(value, imageUrl, alt, extraClass = '') {
            const label = document.createElement('label');
            label.className = `court-image-choice court-image-choice--photo ${extraClass}`.trim();

            const input = document.createElement('input');
            input.type = 'radio';
            input.name = 'selectedCourtImage';
            input.value = value;
            input.setAttribute('aria-label', alt);

            const image = document.createElement('img');
            image.src = imageUrl;
            image.alt = alt;

            label.append(input, image);
            return label;
        }

        function renderCourtImageGallery(preferredValue) {
            const gallery = document.getElementById('courtImageGallery');
            const previouslySelected = document.querySelector(
                'input[name="selectedCourtImage"]:checked'
            )?.value;
            const wanted = preferredValue || previouslySelected;
            const availableValues = new Set();
            gallery.replaceChildren();

            currentCourtImages.forEach((image, index) => {
                availableValues.add(image.id);
                gallery.appendChild(makeImageChoice(
                    image.id,
                    `/api/court-images/${encodeURIComponent(image.id)}`,
                    `Court photo ${index + 1}`
                ));
            });

            if (courtImagePreviewUrl) {
                availableValues.add(UPLOAD_IMAGE_VALUE);
                gallery.appendChild(makeImageChoice(
                    UPLOAD_IMAGE_VALUE,
                    courtImagePreviewUrl,
                    'New court photo preview',
                    'court-image-choice--upload'
                ));
            }

            const selectedValue = availableValues.has(wanted)
                ? wanted
                : (currentCourtImages[0]?.id || (courtImagePreviewUrl ? UPLOAD_IMAGE_VALUE : null));
            const selectedInput = Array.from(
                gallery.querySelectorAll('input[name="selectedCourtImage"]')
            ).find((input) => input.value === selectedValue);
            if (selectedInput) selectedInput.checked = true;
            updateCourtImageCount();
        }

        function clearCourtImageUpload() {
            const upload = document.getElementById('courtImageUpload');
            upload.value = '';
            if (courtImagePreviewUrl) URL.revokeObjectURL(courtImagePreviewUrl);
            courtImagePreviewUrl = null;
        }

        function resetCourtImagePicker() {
            const container = document.getElementById('courtImageContainer');
            clearTimeout(courtImageLookupTimer);
            courtImageRequestSerial++;
            courtImageLoadPromise = Promise.resolve();
            clearCourtImageUpload();
            currentCourtImages = [];
            document.getElementById('courtImageGallery').replaceChildren();
            document.getElementById('courtImageCount').textContent = '';
            setCourtImageStatus('');
            container.hidden = true;
        }

        async function loadCourtImages(courtName) {
            const container = document.getElementById('courtImageContainer');
            const normalizedName = String(courtName || '').trim();
            const requestSerial = ++courtImageRequestSerial;
            container.hidden = false;

            if (!normalizedName) {
                currentCourtImages = [];
                renderCourtImageGallery();
                setCourtImageStatus('Enter the new court name, then choose or upload a photo.');
                return;
            }

            setCourtImageStatus('Loading every photo saved for this court…');
            try {
                const response = await fetch(
                    `/api/courts/${encodeURIComponent(normalizedName)}/library`
                );
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const data = await response.json();
                if (requestSerial !== courtImageRequestSerial) return;

                currentCourtImages = Array.isArray(data.images) ? data.images : [];
                renderCourtImageGallery();
                setCourtImageStatus(currentCourtImages.length
                    ? `Showing all ${currentCourtImages.length} saved photo${currentCourtImages.length === 1 ? '' : 's'}.`
                    : 'No saved photos yet. Upload one if you like, or create the game without an image.');
            } catch (err) {
                if (requestSerial !== courtImageRequestSerial) return;
                currentCourtImages = [];
                renderCourtImageGallery();
                setCourtImageStatus(
                    'Saved photos could not be loaded. You can still upload a new one.',
                    true
                );
            }
        }

        async function setupLocationPicker() {
            const select = document.getElementById('locationSelect');
            const freeText = document.getElementById('locationFreeText');
            const input = document.getElementById('location');
            const upload = document.getElementById('courtImageUpload');
            if (!select || !input) return;

            select.addEventListener('change', () => {
                clearTimeout(courtImageLookupTimer);
                clearCourtImageUpload();
                currentCourtImages = [];
                if (select.value === NEW_LOCATION_VALUE) {
                    freeText.style.display = 'block';
                    input.value = '';
                    input.focus();
                    courtImageLoadPromise = loadCourtImages('');
                } else {
                    // Keep the input in the DOM and populated - createGame() reads it.
                    input.value = select.value;
                    freeText.style.display = select.value ? 'none' : 'block';
                    if (select.value) {
                        renderCourtImageGallery();
                        courtImageLoadPromise = loadCourtImages(select.value);
                    } else {
                        resetCourtImagePicker();
                    }
                }
            });

            input.addEventListener('input', () => {
                clearTimeout(courtImageLookupTimer);
                courtImageRequestSerial++;
                currentCourtImages = [];
                renderCourtImageGallery();
                const courtName = input.value.trim();
                if (!courtName) {
                    setCourtImageStatus('Enter the new court name, then choose or upload a photo.');
                    return;
                }
                setCourtImageStatus('Checking for photos already saved under this court name…');
                courtImageLookupTimer = setTimeout(() => {
                    courtImageLoadPromise = loadCourtImages(courtName);
                }, 300);
            });

            upload.addEventListener('change', () => {
                const file = upload.files[0];
                if (!file) {
                    clearCourtImageUpload();
                    renderCourtImageGallery();
                    return;
                }
                if (!ACCEPTED_COURT_IMAGE_TYPES.has(file.type)) {
                    clearCourtImageUpload();
                    renderCourtImageGallery();
                    setCourtImageStatus('Please choose a JPEG, PNG or WebP image.', true);
                    return;
                }
                if (file.size > MAX_COURT_IMAGE_BYTES) {
                    clearCourtImageUpload();
                    renderCourtImageGallery();
                    setCourtImageStatus('That photo is larger than 5 MB. Please choose a smaller image.', true);
                    return;
                }
                if (courtImagePreviewUrl) URL.revokeObjectURL(courtImagePreviewUrl);
                courtImagePreviewUrl = URL.createObjectURL(file);
                renderCourtImageGallery(UPLOAD_IMAGE_VALUE);
                setCourtImageStatus(
                    `${file.name} will be added to this court's saved photos and used for this game.`
                );
            });

            document.getElementById('courtImageGallery').addEventListener('change', (event) => {
                if (!event.target.matches('input[name="selectedCourtImage"]')) return;
                const file = upload.files[0];
                if (!file) return;
                if (event.target.value === UPLOAD_IMAGE_VALUE) {
                    setCourtImageStatus(
                        `${file.name} will be added to this court's saved photos and used for this game.`
                    );
                } else {
                    setCourtImageStatus(
                        `${file.name} will be added to this court's saved photos. The other selected photo will show on this game.`
                    );
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
                courtImageLoadPromise = loadCourtImages(input.value);
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

async function saveCourtImageChoice(gameId, hostToken, selectedValue, uploadFile) {
    const warnings = [];
    let uploadedImageId = null;

    if (uploadFile) {
        try {
            showStatus('Game created. Uploading the court photo…', 'info');
            const uploadResponse = await fetch(
                `/api/games/${encodeURIComponent(gameId)}/court-images?token=${encodeURIComponent(hostToken)}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': uploadFile.type },
                    body: uploadFile
                }
            );
            const uploadData = await uploadResponse.json().catch(() => ({}));
            if (!uploadResponse.ok || !uploadData.imageId) {
                throw new Error(uploadData.error || `HTTP ${uploadResponse.status}`);
            }
            uploadedImageId = uploadData.imageId;
        } catch (error) {
            console.error('Could not upload court image:', error);
            warnings.push('The court photo could not be uploaded.');
        }
    }

    const imageId = selectedValue === UPLOAD_IMAGE_VALUE ? uploadedImageId : selectedValue;
    if (imageId && imageId !== 'none' && imageId !== UPLOAD_IMAGE_VALUE) {
        try {
            const selectResponse = await fetch(
                `/api/games/${encodeURIComponent(gameId)}/court-image/${encodeURIComponent(imageId)}?token=${encodeURIComponent(hostToken)}`,
                { method: 'PUT' }
            );
            if (!selectResponse.ok) {
                const selectData = await selectResponse.json().catch(() => ({}));
                throw new Error(selectData.error || `HTTP ${selectResponse.status}`);
            }
        } catch (error) {
            console.error('Could not select court image:', error);
            warnings.push('The game was created, but its court image could not be selected.');
        }
    }

    return warnings.join(' ');
}

async function createGame(e) {
    e.preventDefault();
    
    const formData = new FormData(e.target);
    clearTimeout(courtImageLookupTimer);
    if (document.getElementById('locationSelect').value === NEW_LOCATION_VALUE) {
        courtImageLoadPromise = loadCourtImages(formData.get('location'));
    }
    await courtImageLoadPromise;
    const selectedImageValue = document.querySelector(
        'input[name="selectedCourtImage"]:checked'
    )?.value || 'none';
    const courtImageUpload = document.getElementById('courtImageUpload').files[0] || null;
    
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
        // The upload route requires the newly-created game's host token. This lets the public
        // create page offer an upload without opening an anonymous write endpoint.
        const courtImageWarning = await saveCourtImageChoice(
            data.gameId,
            data.hostToken,
            selectedImageValue,
            courtImageUpload
        );

        // Save enough detail for the post-create invitation and browser history. Keep an
        // in-memory copy too: a storage problem must never make a successfully-created game
        // look like it failed or prevent the invitation from being copied.
        const createdGame = {
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
        };
        window.currentGameData = createdGame;
        try {
            const storedGames = JSON.parse(localStorage.getItem('myGames') || '[]');
            const myGames = Array.isArray(storedGames) ? storedGames : [];
            myGames.push(createdGame);
            localStorage.setItem('myGames', JSON.stringify(myGames));
        } catch (storageError) {
            console.warn('Could not save the created game in browser history:', storageError);
        }

        
        // Replace the completed form with the invitation step.
        showGameLinks(data.gameId);
        
        // Clear form
        document.getElementById('gameForm').reset();
        resetCourtImagePicker();
        document.getElementById('locationFreeText').style.display = 'none';
        
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
        let successMessage;
        if (data.hostSms && data.hostSms.dev) {
            successMessage = 'Game created successfully! SMS confirmation is disabled in development mode.';
        } else if (data.hostSms && data.hostSms.success) {
            successMessage = 'Game created successfully! Check your phone for confirmation. Reply "1" to get your management link.';
        } else if (data.hostSms && !data.hostSms.success) {
            successMessage = 'Game created successfully! However, we couldn\'t send the confirmation text.';
        } else {
            successMessage = 'Game created successfully!';
        }
        showStatus(
            courtImageWarning ? `${successMessage} ${courtImageWarning}` : successMessage,
            courtImageWarning ? 'warning' : 'success'
        );
        
    } catch (error) {
        console.error('[CLIENT] Error creating game:', error);
        showStatus('Error creating game: ' + error.message, 'error');
    }
}

        function showGameLinks(gameId) {
            // Store the game ID for the copy function
            window.currentGameId = gameId;
            
            // A successful submission advances to a distinct result view. Leaving a reset form
            // above this panel makes the page look as though nothing was created, especially on
            // a phone when the status message scrolls back to the top.
            document.querySelector('.form-section').hidden = true;
            document.querySelector('.page-header h1').textContent = 'Game Created';
            document.getElementById('shareLink').style.display = 'block';
        }

        function copyToClipboard() {
            const currentGameData = window.currentGameData ||
                InvitationGenerator.getCurrentGameDataFromStorage();
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
