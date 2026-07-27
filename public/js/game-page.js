        // TIMEZONE-FIXED JavaScript for game.html
        document.addEventListener('DOMContentLoaded', () => {
            const statusDiv = document.getElementById('status');
            let gameData;

            // Chrome iOS compatibility fixes
            const phoneInput = document.getElementById('phoneNumber');
            if (phoneInput) {
                const isChromeIOS = /CriOS/.test(navigator.userAgent);
                
                if (isChromeIOS) {
                    // Handle paste events which might cause formatting issues
                    phoneInput.addEventListener('paste', function(e) {
                        setTimeout(() => {
                            const pastedValue = e.target.value;
                            // Clean the pasted value
                            const cleaned = pastedValue.replace(/[^\d\s\(\)\-\+\.]/g, '');
                            if (cleaned !== pastedValue) {
                                e.target.value = cleaned;
                            }
                        }, 10);
                    });
                }
            }
            
            // TIMEZONE FIX FUNCTION - prevents date shifting
            function formatDate(dateStr) {
                return PageUtils.formatLocalDate(dateStr, {
                    weekday: 'long', 
                    month: 'long', 
                    day: 'numeric',
                    year: 'numeric'
                });
            }

            const backToGameBtn = document.getElementById('backToGameBtn');
            if (backToGameBtn) {
                backToGameBtn.addEventListener('click', () => window.showGameDetails());
            }
            
            // Get game ID from URL
            const urlParams = new URLSearchParams(window.location.search);
            const gameId = urlParams.get('id');
            
            if (!gameId) {
                showStatus("Game not found. Please check your link. The URL should include an 'id' parameter.", 'error');
                return;
            }
            
            // Fetch game data
            showStatus("Fetching game data...", 'info');

            // Photos load alongside the game rather than after it - they are independent, and
            // a failure here must never stop the game itself from rendering.
            loadGamePhotos(gameId);

            fetch(`/api/games/${gameId}`)
                .then(response => {
                    if (!response.ok) {
                        throw new Error(`Server responded with status: ${response.status}`);
                    }
                    return response.json();
                })
                .then(async data => {
                    gameData = data;
                    // Check if game is expired or cancelled
                    const gameStatus = GameUtils.getGameStatus(gameData);
                    
                    // Display game details
                    document.getElementById('loading').style.display = 'none';
                    document.getElementById('details').style.display = 'block';
                    
                    // Show status warning only if game is expired or cancelled; hide it when active
                    const warningSection = document.getElementById('gameStatusWarning');
                    if (!gameStatus.canJoin) {
                        showGameStatusWarning(gameStatus);
                    } else if (warningSection) {
                        warningSection.style.display = 'none';
                    }
                    
                    // Check if we should show players section based on registration mode AND game status
                    const playerListSection = document.getElementById('playerList');
                    if (gameData.registrationMode === 'waitlist' || !gameStatus.canJoin) {
                        // Hide players section for waitlist mode OR expired games
                        if (playerListSection) {
                            playerListSection.style.display = 'none';
                        }
                    } else {
                        // Show players section for regular mode on active games
                        if (playerListSection) {
                            playerListSection.style.display = 'block';
                        }
                    }
                    
                    // Populate game details
                    document.getElementById('location').textContent = gameData.location;

                    // Load selected court image if one is chosen
                    const courtImageContainer = document.getElementById('courtImageContainer');
                    const courtImageEl = document.getElementById('courtImage');
                    if (gameData.court_image_id) {
                        try {
                            const res = await fetch(`/api/court-images/${gameData.court_image_id}`);
                            if (res.ok) {
                                const blob = await res.blob();
                                courtImageEl.src = URL.createObjectURL(blob);
                                courtImageContainer.style.display = 'block';
                            }
                        } catch (err) {
                            // Image not found, that's fine
                        }
                    }

                    // Show court number if it exists
                    if (gameData.courtNumber && gameData.courtNumber.trim()) {
                        document.getElementById('courtNumber').textContent = gameData.courtNumber;
                        document.getElementById('courtDetail').style.display = 'flex';
                    } else {
                        document.getElementById('courtDetail').style.display = 'none';
                    }

                    document.getElementById('date').textContent = formatDate(gameData.date);
                    document.getElementById('time').textContent = formatTime(gameData.time);
                    document.getElementById('duration').textContent = gameData.duration;
                    
                    
                    // Show message only if it exists
                    if (gameData.message && gameData.message.trim()) {
                        document.getElementById('message').textContent = gameData.message;
                        document.getElementById('messageDetail').style.display = 'flex';
                    }
                    
                    // Update player list (only if game allows joining)
                    if (gameStatus.canJoin) {
                        updatePlayerList();
                    }
                    
                    // Show signup form only for active games
                    const signupSection = document.getElementById('signupForm');
                    if (signupSection) {
                        if (gameStatus.canJoin) {
                            signupSection.style.display = 'block';
                            signupSection.classList.remove('disabled');
                        } else {
                            signupSection.style.display = 'none';
                            signupSection.classList.add('disabled');
                        }
                    }
                    
                    // Hide the status message since game loaded successfully
                    statusDiv.style.display = 'none';
                    
                    // Set up event handlers (only for active games)
                    if (gameStatus.canJoin) {
                        setupEventHandlers();
                    }
                })
                .catch(error => {
                    console.error("Error fetching game:", error);
                    showStatus(`Game not found. Please check your link.`, 'error');
                });

            function showGameStatusWarning(gameStatus) {
                const warningSection = document.getElementById('gameStatusWarning');
                const warningTitle = document.getElementById('warningTitle');
                const warningMessage = document.getElementById('warningMessage');
                
                if (!warningSection || !warningTitle || !warningMessage) return;
                
                // Configure warning based on status type
                if (gameStatus.type === 'cancelled') {
                    warningSection.className = 'game-status-warning cancelled';
                    warningTitle.textContent = 'Game Cancelled';
                    warningMessage.textContent = gameData.cancellationReason || 'This game has been cancelled and is no longer available.';
                } else if (gameStatus.type === 'expired') {
                    warningSection.className = 'game-status-warning expired';
                    warningTitle.textContent = 'Game Has Ended';
                    warningMessage.textContent = 'This game has finished and is no longer accepting registrations. Check with the organizer for future games.';
                }
                
                // Show the warning
                warningSection.style.display = 'block';
                
                // Update page title to indicate status
                if (gameStatus.type === 'expired') {
                    document.title = '[ENDED] ' + document.title;
                } else if (gameStatus.type === 'cancelled') {
                    document.title = '[CANCELLED] ' + document.title;
                }
            }

            // AUTO-REFRESH: Add periodic refresh every 30 seconds
            setInterval(() => {
                if (!document.hidden && gameData) { // Only refresh if tab is visible and game loaded
                    fetchGameDataSilently();
                }
            }, 30000); // 30 seconds
            
            // AUTO-REFRESH: Refresh when tab becomes visible again
            document.addEventListener('visibilitychange', () => {
                if (!document.hidden && gameData) {
                    fetchGameDataSilently();
                }
            });
            
            // Silent refresh function (no loading messages)
            function fetchGameDataSilently() {
                fetch(`/api/games/${gameId}`)
                    .then(response => {
                        if (!response.ok) {
                            throw new Error(`Server responded with status: ${response.status}`);
                        }
                        return response.json();
                    })
                    .then(data => {
                        const oldData = JSON.stringify(gameData);
                        const newData = JSON.stringify(data);
                        
                        // Only update if data actually changed
                        if (oldData !== newData) {
                            gameData = data;
                            
                            // Update all the game details - TIMEZONE FIXED
                            document.getElementById('location').textContent = gameData.location;
                            document.getElementById('date').textContent = formatDate(gameData.date);
                            document.getElementById('time').textContent = formatTime(gameData.time);
                            document.getElementById('duration').textContent = gameData.duration;
                            
                            // Update message
                            if (gameData.message && gameData.message.trim()) {
                                document.getElementById('message').textContent = gameData.message;
                                document.getElementById('messageDetail').style.display = 'flex';
                            } else {
                                document.getElementById('messageDetail').style.display = 'none';
                            }
                            
                            updatePlayerList();
                            
                            // Show subtle update notification
                            showUpdateNotification();
                        }
                    })
                    .catch(error => {
                        console.error("Silent refresh failed:", error);
                        // Fail silently - don't show error to user
                    });
            }
            
            // Show subtle update notification
            function showUpdateNotification() {
                const notification = document.createElement('div');
                notification.style.cssText = `
                    position: fixed;
                    top: 20px;
                    right: 20px;
                    background: linear-gradient(135deg, #4CAF50 0%, #45a049 100%);
                    color: white;
                    padding: 12px 20px;
                    border-radius: 8px;
                    box-shadow: 0 4px 12px rgba(76, 175, 80, 0.3);
                    z-index: 1000;
                    font-size: 14px;
                    font-weight: bold;
                    opacity: 0;
                    transition: opacity 0.3s ease;
                `;
                notification.textContent = 'Game details updated!';
                
                document.body.appendChild(notification);
                
                // Fade in
                setTimeout(() => {
                    notification.style.opacity = '1';
                }, 100);
                
                // Fade out and remove
                setTimeout(() => {
                    notification.style.opacity = '0';
                    setTimeout(() => {
                        if (notification.parentNode) {
                            notification.parentNode.removeChild(notification);
                        }
                    }, 300);
                }, 3000);
            }
                
            function updatePlayerList() {
                const playersList = document.getElementById('players');
                const spotsAvailable = document.getElementById('spotsAvailable');
                const spotsAvailableBar = document.getElementById('spotsAvailableBar');
                const spotsFullContainer = document.getElementById('spotsFullContainer');
                const waitlistCount = document.getElementById('waitlistCount');
                const joinSectionTitle = document.getElementById('joinSectionTitle');
                const joinButton = document.getElementById('joinButton');
                const playerListSection = document.getElementById('playerList');
                
                if (!playersList || !spotsAvailable) {
                    return;
                }
                
                // Check if game is in waitlist mode
                const isWaitlistMode = gameData.registrationMode === 'waitlist';
                
                if (isWaitlistMode) {
                    // Hide the entire players section in waitlist mode - NO PLAYER INFO VISIBLE
                    if (playerListSection) {
                        playerListSection.style.display = 'none';
                    }
                    
                    // Update join section for waitlist mode - CHANGED: Now just shows "Join This Game" and "IN"
                    if (joinSectionTitle && joinButton) {
                        joinSectionTitle.textContent = 'Join This Game';
                        joinButton.textContent = 'IN';
                    }
                    
                    // Show waitlist mode info at top of tips
                    const waitlistModeInfo = document.getElementById('waitlistModeInfo');
                    if (waitlistModeInfo) {
                        waitlistModeInfo.style.display = 'inline';
                    }
                    
                    // Show signup form
                    const signupForm = document.getElementById('signupForm');
                    if (signupForm) {
                        signupForm.style.display = 'block';
                    }
                    
                    return; // Exit early for waitlist mode - NO PLAYER DATA SHOWN
                }
                
                // Regular mode - show players section with full transparency
                if (playerListSection) {
                    playerListSection.style.display = 'block';
                }
                
                // Hide waitlist mode info for regular games
                const waitlistModeInfo = document.getElementById('waitlistModeInfo');
                if (waitlistModeInfo) {
                    waitlistModeInfo.style.display = 'none';
                }
                
                // Clear existing list
                playersList.innerHTML = '';
                
                // Check if there are any players
                if (gameData.players.length === 0) {
                    // No players yet - show helpful hint
                    const li = document.createElement('li');
                    li.style.fontStyle = 'italic';
                    li.style.color = '#999';
                    li.style.fontSize = '14px';
                    li.textContent = 'None yet - be the first to join!';
                    playersList.appendChild(li);
                } else {
                    // Add players to list
                    gameData.players.forEach(player => {
                        const li = document.createElement('li');
                        li.textContent = player.name + (player.isOrganizer ? ' (Organizer)' : '');
                        playersList.appendChild(li);
                    });
                }
                
                // Update spots available
                const availableSpots = parseInt(gameData.totalPlayers) - gameData.players.length;
                const waitlistLength = gameData.waitlist ? gameData.waitlist.length : 0;
                
                if (availableSpots > 0) {
                    // Show spots available
                    spotsAvailable.textContent = availableSpots;
                    spotsAvailableBar.style.display = 'block';
                    spotsFullContainer.style.display = 'none';
                    joinSectionTitle.textContent = 'Join This Game';
                    joinButton.textContent = 'IN';
                    
                    // FIXED: Update spots text to be singular/plural
                    const spotsText = document.getElementById('spotsText');
                    if (spotsText) {
                        spotsText.textContent = availableSpots === 1 ? 'spot' : 'spots';
                    }
                    
                } else {
                    // Show game is full with waitlist info
                    spotsAvailableBar.style.display = 'none';
                    spotsFullContainer.style.display = 'block';
                    waitlistCount.textContent = waitlistLength;
                    joinSectionTitle.textContent = 'Join the Waitlist';
                    joinButton.textContent = 'Join Waitlist';
                }
                
                // Always show signup form since they can join waitlist when full
                const signupForm = document.getElementById('signupForm');
                if (signupForm) {
                    signupForm.style.display = 'block';
                }
            }

            // FIXED showConfirmation function for public/game.html
            function showConfirmation(data) {
                // Hide other sections
                document.getElementById('gameDetails').style.display = 'none';
                document.getElementById('playerList').style.display = 'none';
                document.getElementById('signupForm').style.display = 'none';
                document.querySelector('.section-header').style.display = 'none';
                
                // Show confirmation section
                const confirmationSection = document.getElementById('confirmationSection');
                confirmationSection.style.display = 'block';
                
                const confirmTitle = document.getElementById('confirmationTitle');
                const confirmMessage = document.getElementById('confirmationMessage');
                const confirmStatus = document.getElementById('confirmStatus');
                const confirmLocation = document.getElementById('confirmLocation');
                const confirmDateTime = document.getElementById('confirmDateTime');
                
                if (data.action === 'out') {
                    confirmationSection.classList.remove('waitlist');
                    confirmationSection.classList.add('out');

                    if (data.cancelled && data.wasConfirmed) {
                        // They gave up a real spot, so say what actually happened to it.
                        confirmTitle.textContent = "You're Out";
                        confirmMessage.textContent = data.promoted
                            ? `Your spot has been cancelled and given to the next player on the waitlist. Thanks for the heads up.`
                            : `Your spot has been cancelled and opened up for the next player. Thanks for the heads up.`;
                        confirmStatus.textContent = `Spot cancelled`;
                    } else if (data.cancelled) {
                        confirmTitle.textContent = "You're Out";
                        confirmMessage.textContent = `We've taken you off the list for this game. Thanks for letting us know.`;
                        confirmStatus.textContent = `Removed from the waitlist`;
                    } else {
                        confirmTitle.textContent = "Thanks for Letting Us Know!";
                        confirmMessage.textContent = `We've recorded that you can't make this game. Thanks for being courteous to other players!`;
                        confirmStatus.textContent = `Marked as "Out"`;
                    }
                } else if (data.status === 'confirmed') {
                    // Regular confirmed player
                    confirmationSection.classList.remove('waitlist', 'out');
                    confirmTitle.textContent = "You're In!";
                    confirmMessage.textContent = `Awesome! You are Player ${data.position} of ${data.totalPlayers}. Get ready to play!`;
                    confirmStatus.textContent = `Player ${data.position} of ${data.totalPlayers}`;
                } else if (data.status === 'waitlist') {
                    // Waitlisted player
                    confirmationSection.classList.add('waitlist');
                    confirmationSection.classList.remove('out');
                    
                    if (data.hidePosition || gameData.registrationMode === 'waitlist') {
                        confirmTitle.textContent = "Application Submitted!";
                        confirmMessage.textContent = `Thanks for signing up! The organizer will review all applications and select players. You'll be notified if you're selected.`;
                        confirmStatus.textContent = `Application Under Review`;
                    } else {
                        confirmTitle.textContent = "You're on the Waitlist!";
                        confirmMessage.textContent = `The game is full, but you're #${data.position} on the waitlist. If someone cancels, you'll get their spot automatically!`;
                        confirmStatus.textContent = `Waitlist Position #${data.position}`;
                    }
                }
                
                // The action itself is saved either way, but the page used to promise a text
                // unconditionally. If the text did not go out, say so here instead of leaving
                // the player waiting for a message that is never coming.
                const smsWarning = document.getElementById('smsWarning');
                const smsWarningText = document.getElementById('smsWarningText');
                const smsFailed = data.sms && data.sms.success === false;

                if (smsWarning && smsWarningText) {
                    if (smsFailed) {
                        smsWarningText.textContent = data.action === 'out'
                            ? "Heads up: we couldn't send your confirmation text, so you won't get one. Your response was still recorded - the organizer can see you're out."
                            : "Heads up: we couldn't send your confirmation text, so you won't get one. Your spot is still saved - but you won't get text reminders or be able to reply 2 or 9. Let the organizer know so they can check your number.";
                        smsWarning.style.display = 'block';
                    } else {
                        smsWarning.style.display = 'none';
                    }
                }

                // Include court number in confirmation location
                let locationText = gameData.location;
                if (gameData.courtNumber && gameData.courtNumber.trim()) {
                    locationText += ` - ${gameData.courtNumber}`;
                }
                
                confirmLocation.textContent = locationText;
                confirmDateTime.textContent = `${formatDate(gameData.date)} at ${formatTime(gameData.time)}`;
                
                // Handle "What's Next?" section visibility
                const nextStepsSection = document.getElementById('nextStepsSection');
                const seeWhosPlayingInstruction = document.getElementById('seeWhosPlayingInstruction');

                if (nextStepsSection) {
                    // Every bullet in "What's Next?" describes something that happens by text.
                    // With no text going out, the whole list is untrue, so hide it rather than
                    // tell the player to reply to a message they will never receive.
                    if (data.action === 'out' || smsFailed || !data.sms) {
                        nextStepsSection.style.display = 'none';
                    } else {
                        nextStepsSection.style.display = 'block';
                        
                        // Hide "text 2" instruction for waitlist games
                        if (seeWhosPlayingInstruction && gameData.registrationMode === 'waitlist') {
                            seeWhosPlayingInstruction.style.display = 'none';
                        } else if (seeWhosPlayingInstruction) {
                            seeWhosPlayingInstruction.style.display = 'block';
                        }
                    }
                }
                
                // Scroll to top to show confirmation
                window.scrollTo(0, 0);
            }

            window.showGameDetails = function() {
                // Show game sections again AND the header
                document.getElementById('gameDetails').style.display = 'block';
                document.getElementById('playerList').style.display = 'block';
                document.getElementById('signupForm').style.display = 'block';
                document.querySelector('.section-header').style.display = 'block';
                
                // Hide confirmation section
                document.getElementById('confirmationSection').style.display = 'none';
                
                // Refresh the game data to show updated player list
                fetch(`/api/games/${gameId}`)
                    .then(response => response.json())
                    .then(updatedData => {
                        gameData = updatedData;
                        updatePlayerList();
                    })
                    .catch(error => {
                        console.error('Error refreshing game data:', error);
                    });
            }       

            // Client-side phone validation
            function validatePhoneClientSide(phoneNumber) {
                if (!phoneNumber) return true; // Optional field
                
                const cleaned = ('' + phoneNumber).replace(/\D/g, '');
                
                // Check basic length requirements
                if (cleaned.length === 10 || (cleaned.length === 11 && cleaned.startsWith('1'))) {
                    return true;
                }
                
                return false;
            }
            
            function setupEventHandlers() {
                // Set up join form submission
                const joinForm = document.getElementById('joinForm');
                joinForm.addEventListener('submit', event => {
                    event.preventDefault();
                    const playerName = document.getElementById('playerName').value;
                    const phoneNumber = document.getElementById('phoneNumber').value;
                    
                    // Pre-validate on client side for better error messages
                    if (phoneNumber && !validatePhoneClientSide(phoneNumber)) {
                        const isChromeIOS = /CriOS/.test(navigator.userAgent);
                        const errorMsg = isChromeIOS 
                            ? 'Please check your phone number format. Try entering just the 10 digits (e.g., 5551234567) or with dashes (555-123-4567).'
                            : 'Please enter a valid US phone number (e.g., (555) 123-4567)';
                        
                        showStatus(errorMsg, 'error');
                        return;
                    }
                    
                    showStatus('Processing your request...', 'info');
                    
                    // Send the player data to the server
                    fetch(`/api/games/${gameId}/players`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            name: playerName,
                            phone: phoneNumber,
                            action: event.submitter.dataset.action || 'join'
                        })
                    })
                    .then(async response => {
                        if (!response.ok) {
                            const errorData = await response.json().catch(() => ({}));
                            throw new Error(errorData.error || 'Failed to join game');
                        }
                        return response.json();
                    })
                    .then(data => {
                        // Hide status message
                        statusDiv.style.display = 'none';
                        
                        // Show confirmation page
                        showConfirmation(data);
                        
                        // Clear the form
                        document.getElementById('playerName').value = '';
                        document.getElementById('phoneNumber').value = '';
                        
                        // Update game data in background
                        fetch(`/api/games/${gameId}`)
                            .then(response => response.json())
                            .then(updatedData => {
                                gameData = updatedData;
                            })
                            .catch(error => {
                                console.error('Error refreshing game data:', error);
                            });
                    })
                    .catch(error => {
                        console.error('Error joining game:', error);
                        showStatus(error.message, 'error');
                    });
                });
            }
            
            function formatTime(timeStr) {
                return PageUtils.formatTime12Hour(timeStr);
            }
            
            // Photos the host has added. The whole section stays hidden when there are none,
            // so a game without photos looks exactly as it did before.
            async function loadGamePhotos(id) {
                try {
                    const response = await fetch(`/api/games/${id}/photos`);
                    if (!response.ok) return;

                    const { photos = [] } = await response.json();
                    if (!photos.length) return;

                    const gallery = document.getElementById('photoGallery');
                    const section = document.getElementById('photosSection');
                    if (!gallery || !section) return;

                    photos.forEach(photo => {
                        const figure = document.createElement('figure');

                        const link = document.createElement('a');
                        link.href = photo.url;
                        link.target = '_blank';
                        link.rel = 'noopener';

                        const img = document.createElement('img');
                        img.src = photo.url;
                        img.alt = photo.caption || 'Game photo';
                        img.loading = 'lazy';
                        link.appendChild(img);
                        figure.appendChild(link);

                        if (photo.caption) {
                            const caption = document.createElement('figcaption');
                            caption.textContent = photo.caption;
                            figure.appendChild(caption);
                        }

                        gallery.appendChild(figure);
                    });

                    section.style.display = 'block';
                } catch (error) {
                    console.error('Could not load photos:', error);
                }
            }

            function showStatus(message, type) {
                statusDiv.textContent = message;
                statusDiv.className = type;
                statusDiv.style.display = 'block';
                
                // Auto-scroll to show the status message  
                statusDiv.scrollIntoView({ 
                    behavior: 'smooth', 
                    block: 'center' 
                });
                
                if (type === 'error') {
                    document.getElementById('loading').style.display = 'none';
                }
                
                // Auto-hide success messages after 5 seconds
                if (type === 'success' || type === 'info') {
                    setTimeout(() => {
                        statusDiv.style.display = 'none';
                    }, 5000);
                }
            }
        });
