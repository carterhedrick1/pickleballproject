        document.addEventListener('DOMContentLoaded', () => {
            // Set up form submission
            const gameForm = document.getElementById('gameForm');
            gameForm.addEventListener('submit', createGame);

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
            const organizerPlaying = document.getElementById('organizerPlaying');
            organizerPlaying.addEventListener('change', () => {
                // The count field switches meaning with this tick box (others-needed vs
                // total-needed), so adjust its value in step: a host who typed 3 meaning
                // "3 plus me" still has a four-player game after unticking.
                const players = document.getElementById('players');
                const current = parseInt(players.value, 10);
                if (!Number.isNaN(current)) {
                    players.value = Math.max(organizerPlaying.checked ? current - 1 : current + 1, 1);
                }
                updatePlayersHelp();
            });
            updatePlayersHelp();
            const ready = setupLocationPicker();
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

            // "Run It Again" from My Games lands here. The form is filled in but never
            // submitted: the host confirms the new date and presses Create Game themselves.
            const params = new URLSearchParams(window.location.search);
            const repeatId = params.get('repeat');
            if (repeatId) {
                ready.then(() => prefillFromGame(repeatId, params.get('token')));
            }
        });

        function setNotificationToggle(checkboxId, isChecked) {
            const checkbox = document.getElementById(checkboxId);
            if (!checkbox) return;
            checkbox.checked = isChecked;
            const option = document.querySelector(`[data-checkbox-id="${checkboxId}"]`);
            if (option) option.classList.toggle('checked', isChecked);
        }

        function setRegistrationMode(mode) {
            const radioId = mode === 'waitlist' ? 'waitlistMode' : 'fcfsMode';
            const radio = document.getElementById(radioId);
            if (radio) radio.checked = true;
            document.querySelectorAll('.mode-option').forEach((option) => {
                option.classList.toggle('checked', option.dataset.radioId === radioId);
            });
        }

        function setRepeatLocation(location) {
            const select = document.getElementById('locationSelect');
            const input = document.getElementById('location');
            const freeText = document.getElementById('locationFreeText');
            if (!input) return;

            const saved = select && [...select.options].some((option) => option.value === location);
            if (select) {
                select.value = saved ? location : NEW_LOCATION_VALUE;
                select.dispatchEvent(new Event('change', { bubbles: true }));
            }
            if (!saved) {
                // A court the host has since renamed or removed is still typed in for them.
                input.value = location;
                if (freeText) freeText.style.display = 'block';
                input.dispatchEvent(new Event('input', { bubbles: true }));
            }
        }

        async function prefillFromGame(gameId, token) {
            const notice = document.getElementById('repeatNotice');
            try {
                const response = await fetch(
                    `/api/games/${encodeURIComponent(gameId)}?token=${encodeURIComponent(token || '')}`
                );
                if (!response.ok) throw new Error(`Server returned ${response.status}`);
                const game = await response.json();

                setRepeatLocation(game.location || '');
                document.getElementById('date').value =
                    PageUtils.nextWeeklyDate(game.date) || document.getElementById('date').value;
                document.getElementById('time').value = game.time || '18:00';
                document.getElementById('duration').value = game.duration || 90;
                document.getElementById('organizerName').value = game.organizerName || '';
                document.getElementById('organizerPhone').value =
                    game.organizerPhone || game.hostPhone || '';

                const organizerPlaying = game.organizerPlaying === true;
                document.getElementById('organizerPlaying').checked = organizerPlaying;
                document.getElementById('players').value = PlayerCapacity.additionalFromTotal(
                    game.totalPlayers,
                    organizerPlaying
                );
                updatePlayersHelp();

                document.getElementById('message').value = game.message || '';

                setRegistrationMode(game.registrationMode || 'fcfs');

                const preferences = game.notificationPreferences || {};
                setNotificationToggle('notifyGameFull', preferences.gameFull === true);
                setNotificationToggle('notifyPlayerJoins', preferences.playerJoins === true);
                setNotificationToggle('notifyPlayerCancels', preferences.playerCancels === true);
                setNotificationToggle('notifyOneSpotLeft', preferences.oneSpotLeft === true);
                setNotificationToggle('notifyWaitlistStarts', preferences.waitlistStarts === true);

                if (notice) {
                    const when = PageUtils.formatLocalDate(game.date, {
                        weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'
                    });
                    notice.textContent =
                        `Copied from your ${game.location} game on ${when}. ` +
                        'Check the date and anything else you want to change, then create it.';
                    notice.hidden = false;
                }
            } catch (error) {
                console.error('Could not repeat that game:', error);
                if (notice) {
                    notice.textContent =
                        'We could not load that game, so this form is blank. Fill it in as usual.';
                    notice.hidden = false;
                }
            }
        }

        function updatePlayersHelp() {
            const organizerPlaying = document.getElementById('organizerPlaying').checked;
            const help = document.getElementById('playersHelp');
            help.textContent = organizerPlaying
                ? 'You are already Player 1. Enter 3 for a four-player game.'
                : 'Enter the total number of players you need. No organizer will be added.';
        }

        // ---------------------------------------------------------------------------
        // Location picker
        //
        // The dropdown is a convenience on top of the #location text input, never a
        // replacement for it: picking a court copies the name into that input, which is
        // still what gets submitted. If /api/locations is slow or down, the input is simply
        // left visible as a plain text field and the form works exactly as it did before.
        // ---------------------------------------------------------------------------

        const NEW_LOCATION_VALUE = '__new__';
        let currentCourtImages = [];
        let courtImageRequestSerial = 0;
        let courtImageLookupTimer = null;
        let courtImageLoadPromise = Promise.resolve();
        let pendingGameCreation = null;

        function newCreationRequestId() {
            const bytes = new Uint8Array(16);
            crypto.getRandomValues(bytes);
            return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
        }

        function creationRequestFor(gameData) {
            const fingerprint = JSON.stringify(gameData);
            if (!pendingGameCreation || pendingGameCreation.fingerprint !== fingerprint) {
                pendingGameCreation = {
                    fingerprint,
                    requestId: newCreationRequestId()
                };
            }
            return pendingGameCreation.requestId;
        }

        async function postGameWithRetry(gameData, requestId) {
            const retryDelays = [500, 2000, 5000];
            let lastError;

            for (let attempt = 0; attempt <= retryDelays.length; attempt++) {
                try {
                    const response = await fetch('/api/games', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Idempotency-Key': requestId
                        },
                        body: JSON.stringify(gameData)
                    });

                    const retryableStatus = [500, 502, 503, 504].includes(response.status);
                    if (!retryableStatus || attempt === retryDelays.length) {
                        return response;
                    }
                } catch (error) {
                    lastError = error;
                    if (attempt === retryDelays.length) throw error;
                }

                await new Promise((resolve) => setTimeout(resolve, retryDelays[attempt]));
            }

            throw lastError || new Error('Failed to create game');
        }

        function setCourtImageStatus(message, isError = false) {
            const status = document.getElementById('courtImageStatus');
            status.textContent = message;
            status.classList.toggle('is-error', isError);
        }

        function updateCourtImageCount() {
            const count = document.getElementById('courtImageCount');
            if (!currentCourtImages.length) {
                count.textContent = '';
                return;
            }
            count.textContent = `${currentCourtImages.length} saved ${currentCourtImages.length === 1 ? 'photo' : 'photos'}`;
        }

        function makeImageChoice(value, imageUrl, alt) {
            const label = document.createElement('label');
            label.className = 'court-image-choice court-image-choice--photo';

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

            const selectedValue = availableValues.has(wanted)
                ? wanted
                : currentCourtImages[0]?.id;
            const selectedInput = Array.from(
                gallery.querySelectorAll('input[name="selectedCourtImage"]')
            ).find((input) => input.value === selectedValue);
            if (selectedInput) selectedInput.checked = true;
            updateCourtImageCount();
        }

        function resetCourtImagePicker() {
            const container = document.getElementById('courtImageContainer');
            clearTimeout(courtImageLookupTimer);
            courtImageRequestSerial++;
            courtImageLoadPromise = Promise.resolve();
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
            container.hidden = true;

            if (!normalizedName) {
                currentCourtImages = [];
                renderCourtImageGallery();
                setCourtImageStatus('');
                return;
            }

            setCourtImageStatus('Loading every photo saved for this court...');
            try {
                const response = await fetch(
                    `/api/courts/${encodeURIComponent(normalizedName)}/library`
                );
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const data = await response.json();
                if (requestSerial !== courtImageRequestSerial) return;

                currentCourtImages = Array.isArray(data.images) ? data.images : [];
                renderCourtImageGallery();
                container.hidden = currentCourtImages.length === 0;
                setCourtImageStatus(currentCourtImages.length
                    ? `Showing all ${currentCourtImages.length} saved photo${currentCourtImages.length === 1 ? '' : 's'}.`
                    : '');
            } catch (err) {
                if (requestSerial !== courtImageRequestSerial) return;
                currentCourtImages = [];
                renderCourtImageGallery();
                container.hidden = true;
                setCourtImageStatus('');
            }
        }

        async function setupLocationPicker() {
            const select = document.getElementById('locationSelect');
            const freeText = document.getElementById('locationFreeText');
            const input = document.getElementById('location');
            if (!select || !input) return;

            select.addEventListener('change', () => {
                clearTimeout(courtImageLookupTimer);
                currentCourtImages = [];
                document.getElementById('courtImageContainer').hidden = true;
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
                    document.getElementById('courtImageContainer').hidden = true;
                    setCourtImageStatus('');
                    return;
                }
                courtImageLookupTimer = setTimeout(() => {
                    courtImageLoadPromise = loadCourtImages(courtName);
                }, 300);
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

async function saveCourtImageChoice(gameId, hostToken, selectedValue) {
    const warnings = [];

    if (selectedValue && selectedValue !== 'none') {
        try {
            const selectResponse = await fetch(
                `/api/games/${encodeURIComponent(gameId)}/court-image/${encodeURIComponent(selectedValue)}?token=${encodeURIComponent(hostToken)}`,
                { method: 'PUT' }
            );
            if (!selectResponse.ok) {
                const selectData = await selectResponse.json().catch(() => ({}));
                throw new Error(selectData.error || `HTTP ${selectResponse.status}`);
            }
        } catch (error) {
            console.error('Could not select court image:', error);
            warnings.push('Your game was created, but we could not attach the court photo. You can add it from the manage page.');
        }
    }

    return warnings.join(' ');
}

async function createGame(e) {
    e.preventDefault();

    const formData = new FormData(e.target);
    setCreatingState(true);
    clearTimeout(courtImageLookupTimer);
    if (document.getElementById('locationSelect').value === NEW_LOCATION_VALUE) {
        courtImageLoadPromise = loadCourtImages(formData.get('location'));
    }
    await courtImageLoadPromise;
    const selectedImageValue = document.querySelector(
        'input[name="selectedCourtImage"]:checked'
    )?.value || 'none';
    
    // Collect notification preferences explicitly
    const notificationPreferences = {
        gameFull: formData.get('notifyGameFull') === 'on',
        playerJoins: formData.get('notifyPlayerJoins') === 'on',
        playerCancels: formData.get('notifyPlayerCancels') === 'on',
        oneSpotLeft: formData.get('notifyOneSpotLeft') === 'on',
        waitlistStarts: formData.get('notifyWaitlistStarts') === 'on'
    };
    
    const organizerPlaying = formData.get('organizerPlaying') === 'on';
    const playersNeeded = parseInt(formData.get('players'), 10);
    const gameData = {
        location: formData.get('location'),
        organizerName: formData.get('organizerName'),
        organizerPhone: formData.get('organizerPhone'),
        organizerPlaying,
        date: formData.get('date'),
        time: formData.get('time'),
        duration: parseInt(formData.get('duration')),
        playersNeeded,
        message: formData.get('message'),
        registrationMode: formData.get('registrationMode'),
        personalityId: 'realist',
        notificationPreferences: notificationPreferences,
        hostPhone: formData.get('organizerPhone')
    };
    
    try {
        const response = await postGameWithRetry(
            gameData,
            creationRequestFor(gameData)
        );
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to create game');
        }
        
        const data = await response.json();
        pendingGameCreation = null;
        const courtImageWarning = await saveCourtImageChoice(
            data.gameId,
            data.hostToken,
            selectedImageValue
        );

        // Save enough detail for browser history. A storage problem must never make a
        // successfully-created game look like it failed or block Game Management.
        const createdGame = {
            id: data.gameId,
            hostToken: data.hostToken,
            location: gameData.location,
            date: gameData.date,
            time: gameData.time,
            duration: gameData.duration,
            totalPlayers: data.totalPlayers ??
                PlayerCapacity.totalFromAdditional(playersNeeded, organizerPlaying),
            organizerPlaying: gameData.organizerPlaying,
            registrationMode: gameData.registrationMode,
            personalityId: gameData.personalityId,
            message: gameData.message,
            created: new Date().toISOString(),
            cancelled: false
        };
        try {
            const storedGames = JSON.parse(localStorage.getItem('myGames') || '[]');
            const myGames = Array.isArray(storedGames) ? storedGames : [];
            myGames.push(createdGame);
            localStorage.setItem('myGames', JSON.stringify(myGames));
        } catch (storageError) {
            console.warn('Could not save the created game in browser history:', storageError);
        }

        
        rememberCreationNotice(data.gameId, data.hostSms, courtImageWarning);

        // The Invite tab already contains every sharing option. Keep the loading screen in
        // place until this navigation begins so the reset create form never flashes again.
        const manageUrl = new URL(data.hostLink, window.location.origin);
        manageUrl.searchParams.set('tab', 'Invite');
        manageUrl.searchParams.set('created', '1');
        window.location.replace(`${manageUrl.pathname}${manageUrl.search}`);
        
    } catch (error) {
        console.error('[CLIENT] Error creating game:', error);
        setCreatingState(false);
        showStatus('Error creating game: ' + error.message, 'error');
    }
}

function setCreatingState(isCreating) {
    const overlay = document.getElementById('createLoadingOverlay');
    const form = document.getElementById('gameForm');
    const submit = form?.querySelector('button[type="submit"]');
    if (overlay) overlay.hidden = !isCreating;
    if (form) form.setAttribute('aria-busy', String(isCreating));
    if (submit) submit.disabled = isCreating;
}

function rememberCreationNotice(gameId, hostSms, courtImageWarning) {
    const warnings = [];
    if (hostSms && !hostSms.success && !hostSms.dev) {
        warnings.push('we could not send your confirmation text');
    }
    if (courtImageWarning) {
        warnings.push('we could not attach the court photo');
    }

    const notice = warnings.length
        ? {
            type: 'warning',
            message: `Game created, but ${warnings.join(' and ')}. You can keep managing it here.`
        }
        : { type: 'success', message: 'Game created. Invite your players below.' };

    try {
        sessionStorage.setItem(`gameCreationNotice:${gameId}`, JSON.stringify(notice));
    } catch (storageError) {
        console.warn('Could not save the new-game notice:', storageError);
    }
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
