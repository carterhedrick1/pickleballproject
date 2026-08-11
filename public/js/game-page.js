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
                showStatus("This game link looks incomplete. Ask the organizer to resend it.", 'error');
                return;
            }
            
            // Fetch game data
            showStatus("Fetching game data...", 'info');

            // Photos load alongside the game rather than after it - they are independent, and
            // a failure here must never stop the game itself from rendering.
            loadGamePhotos(gameId);

            // Who this browser belongs to, and where they stand in this game. Started here
            // rather than after the game arrives so the two requests overlap: the signup area
            // is only revealed once both have landed, which is what stops a returning player
            // seeing an empty form for a moment before their status replaces it.
            let identity = PlayerIdentity.read();
            let playerStatus = null;
            let statusReady = fetchPlayerStatus();

            function fetchPlayerStatus() {
                if (!identity) {
                    playerStatus = null;
                    return Promise.resolve(null);
                }
                const asked = identity.phone;
                return fetch(`/api/games/${gameId}/player-status`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ phone: asked })
                })
                    .then(response => (response.ok ? response.json() : null))
                    .then(result => {
                        // The player may have pressed "Not You?" while this was in flight.
                        if (!identity || identity.phone !== asked) return playerStatus;
                        playerStatus = result;
                        return result;
                    })
                    .catch(() => {
                        // A failed lookup just means the ordinary signup form, which still works.
                        playerStatus = null;
                        return null;
                    });
            }

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
                        setupIdentityHandlers();
                        // A remembered player should never see the blank form flash up before
                        // their status replaces it, so the signup area stays hidden until the
                        // lookup started at page load has answered.
                        if (identity && signupSection) {
                            signupSection.style.display = 'none';
                        }
                        await statusReady;
                        applyIdentityView();
                    }
                })
                .catch(error => {
                    console.error("Error fetching game:", error);
                    // A dropped connection and a deleted game are different problems for the
                    // player, and telling someone with bad signal that the game is gone is worse
                    // than telling them to try again.
                    const message = navigator.onLine === false
                        ? "You appear to be offline. Check your connection and reload this page."
                        : "We couldn't load this game. It may have been deleted, or the link may be incomplete. Ask the organizer to resend it.";
                    showStatus(message, 'error');
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

                // "Join the fun on the court" under the title is an invitation, and this game
                // is not one any more.
                const subtitle = document.querySelector('.section-header .subtitle');
                if (subtitle) subtitle.style.display = 'none';

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

                        // Always, even when the game itself is unchanged: this is how a
                        // waitlisted player who was just promoted sees it without reloading.
                        refreshIdentityView();
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
                    background: var(--brand);
                    color: var(--surface);
                    padding: 12px 20px;
                    border-radius: 8px;
                    box-shadow: 0 4px 12px color-mix(in srgb, var(--brand) 30%, transparent);
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
                    li.style.color = 'var(--text-muted)';
                    li.style.fontSize = '14px';
                    li.textContent = 'None yet — be the first to join!';
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
                    const waitlistCountWord = document.getElementById('waitlistCountWord');
                    if (waitlistCountWord) {
                        waitlistCountWord.textContent = waitlistLength === 1 ? 'person' : 'people';
                    }
                    joinSectionTitle.textContent = 'Join The Waitlist';
                    joinButton.textContent = 'Join Waitlist';
                }
                
                // Always show signup form since they can join waitlist when full
                const signupForm = document.getElementById('signupForm');
                if (signupForm) {
                    signupForm.style.display = 'block';
                }
            }

            // ---------------------------------------------------------------------------
            // The returning player
            //
            // Everything below decides between three shapes for the signup area: this
            // browser's player already has an answer in this game (show it, with one tap to
            // change it), this browser knows them but they have not answered this game (fill
            // the form in for them), or nobody is known (the plain form, exactly as before).
            // ---------------------------------------------------------------------------

            function gameIsFull() {
                return gameData
                    && (parseInt(gameData.totalPlayers) - (gameData.players || []).length) <= 0;
            }

            /** What the one-tap button on the status card does, and what it should say. */
            function statusCardPlan(status) {
                const approvalMode = gameData.registrationMode === 'waitlist';

                if (status.status === 'confirmed') {
                    return {
                        mood: 'is-in',
                        title: "You're IN",
                        detail: status.totalPlayers
                            ? `Player ${status.position} of ${status.totalPlayers}`
                            : 'You have a spot in this game',
                        // The organizer's seat is reserved by the game itself, and the roster
                        // refuses to give it up - so offering the button would only produce an
                        // error. Point at the tool that can actually do it instead.
                        action: status.isOrganizer ? null : 'out',
                        actionLabel: "Can't Make It? Tap OUT",
                        note: status.isOrganizer
                            ? "You're the organizer of this game. Use your management link to change it."
                            : ''
                    };
                }

                if (status.status === 'waitlist' && approvalMode) {
                    return {
                        mood: 'is-waiting',
                        title: 'Your Application Is In',
                        detail: 'The organizer is still picking players. You’ll get a text either way.',
                        action: 'out',
                        actionLabel: 'Cancel My Application'
                    };
                }

                if (status.status === 'waitlist') {
                    return {
                        mood: 'is-waiting',
                        title: "You're On The Waitlist",
                        detail: status.position
                            ? `Number ${status.position} in line. If a spot opens up it is yours, and we’ll text you.`
                            : 'If a spot opens up we’ll text you.',
                        action: 'out',
                        actionLabel: 'Leave The Waitlist'
                    };
                }

                // They told us they were out. Getting back in is the whole reason this card
                // exists for them, so the button is the loud one.
                return {
                    mood: 'is-out',
                    title: "You're OUT",
                    detail: 'You told us you can’t make this one.',
                    action: 'in',
                    actionLabel: approvalMode
                        ? 'Apply Again'
                        : gameIsFull()
                            ? 'Changed Your Mind? Join The Waitlist'
                            : "Changed Your Mind? Tap IN"
                };
            }

            function applyIdentityView() {
                const statusSection = document.getElementById('yourStatusSection');
                const signupSection = document.getElementById('signupForm');
                const strip = document.getElementById('knownPlayerStrip');
                if (!statusSection || !signupSection) return;

                const known = Boolean(identity);
                const answered = known && playerStatus
                    && ['confirmed', 'waitlist', 'out'].includes(playerStatus.status);

                // "Join The Waitlist! Don't worry, you can still sign up" is a pitch aimed at
                // somebody with no spot. Telling it to a player who already holds one, or is
                // already waiting, reads as though their answer did not register.
                const waitlistPitch = document.querySelector('#spotsFullContainer .waitlist-info');
                if (waitlistPitch) {
                    const alreadySorted = answered
                        && ['confirmed', 'waitlist'].includes(playerStatus.status);
                    waitlistPitch.style.display = alreadySorted ? 'none' : '';
                }

                if (!known) {
                    statusSection.style.display = 'none';
                    if (strip) strip.style.display = 'none';
                    signupSection.style.display = 'block';
                    return;
                }

                // The roster is the authority on their name: the host may have corrected it.
                if (answered && playerStatus.name && playerStatus.name !== identity.name) {
                    identity = { name: playerStatus.name, phone: identity.phone };
                    PlayerIdentity.save(identity);
                }

                if (!answered) {
                    // Known, but a stranger to this particular game: fill the form in for them.
                    statusSection.style.display = 'none';
                    signupSection.style.display = 'block';
                    document.getElementById('playerName').value = identity.name;
                    document.getElementById('phoneNumber').value = PlayerIdentity.prettyPhone(identity.phone);
                    if (strip) {
                        document.getElementById('knownPlayerText').textContent =
                            `Answering as ${identity.name} · ${PlayerIdentity.prettyPhone(identity.phone)}`;
                        strip.style.display = 'flex';
                    }
                    return;
                }

                const plan = statusCardPlan(playerStatus);
                statusSection.className = `section your-status-section ${plan.mood}`;
                document.getElementById('yourStatusTitle').textContent = plan.title;
                document.getElementById('yourStatusDetail').textContent = plan.detail;
                document.getElementById('yourStatusName').textContent =
                    `${identity.name} · ${PlayerIdentity.prettyPhone(identity.phone)}`;

                // Hidden with the attribute rather than a style: design-system.css forces
                // display on every button with !important, which an inline style cannot beat,
                // and [hidden] is the escape it provides for exactly this.
                const actionButton = document.getElementById('yourStatusAction');
                actionButton.disabled = false;
                actionButton.hidden = !plan.action;
                if (plan.action) {
                    actionButton.textContent = plan.actionLabel;
                    actionButton.dataset.action = plan.action;
                }

                const note = document.getElementById('yourStatusNote');
                if (plan.note) {
                    note.textContent = plan.note;
                    note.style.display = 'block';
                } else {
                    note.style.display = 'none';
                }

                document.getElementById('notYouButton').textContent =
                    `Not ${PlayerIdentity.firstName(identity.name)}?`;

                statusSection.style.display = 'block';
                signupSection.style.display = 'none';
                if (strip) strip.style.display = 'none';
            }

            /** Hands the page back to somebody who is not the remembered player. */
            function forgetPlayer() {
                PlayerIdentity.clear();
                identity = null;
                playerStatus = null;
                statusReady = Promise.resolve(null);
                document.getElementById('playerName').value = '';
                document.getElementById('phoneNumber').value = '';
                applyIdentityView();
                document.getElementById('playerName').focus();
            }

            function setupIdentityHandlers() {
                const actionButton = document.getElementById('yourStatusAction');
                if (actionButton && !actionButton.dataset.wired) {
                    actionButton.dataset.wired = 'true';
                    actionButton.addEventListener('click', () => {
                        if (!identity) return;
                        actionButton.disabled = true;
                        actionButton.textContent = 'Saving...';
                        submitRsvp(identity.name, identity.phone, actionButton.dataset.action)
                            .catch(() => {
                                // submitRsvp has already shown the error; give the button back.
                                applyIdentityView();
                            });
                    });
                }

                [document.getElementById('notYouButton'), document.getElementById('knownPlayerSwitch')]
                    .forEach(button => {
                        if (button && !button.dataset.wired) {
                            button.dataset.wired = 'true';
                            button.addEventListener('click', forgetPlayer);
                        }
                    });
            }

            /** Refreshes this player's own standing, then redraws the signup area. */
            function refreshIdentityView() {
                statusReady = fetchPlayerStatus();
                return statusReady.then(applyIdentityView);
            }

            // FIXED showConfirmation function for public/game.html
            function showConfirmation(data) {
                // Hide other sections
                document.getElementById('gameDetails').style.display = 'none';
                document.getElementById('playerList').style.display = 'none';
                document.getElementById('signupForm').style.display = 'none';
                document.getElementById('yourStatusSection').style.display = 'none';
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
                            ? `Your spot has been cancelled and given to the next player on the waitlist. Thanks for the heads-up.`
                            : `Your spot has been cancelled and opened up for the next player. Thanks for the heads-up.`;
                        confirmStatus.textContent = `Spot Cancelled`;
                    } else if (data.cancelled) {
                        confirmTitle.textContent = "You're Out";
                        confirmMessage.textContent = `We've taken you off the list for this game. Thanks for letting us know.`;
                        confirmStatus.textContent = `Removed From The Waitlist`;
                    } else {
                        confirmTitle.textContent = "Thanks For Letting Us Know!";
                        confirmMessage.textContent = `We've recorded that you can't make this game. Thanks for letting everyone know.`;
                        confirmStatus.textContent = `Marked as "Out"`;
                    }
                } else if (data.status === 'confirmed') {
                    // Regular confirmed player
                    confirmationSection.classList.remove('waitlist', 'out');
                    confirmTitle.textContent = "You're In!";
                    confirmMessage.textContent = `Awesome! You are Player ${data.position} of ${data.totalPlayers}. Get ready to play.`;
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
                        confirmTitle.textContent = "You're On The Waitlist!";
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

                confirmLocation.textContent = gameData.location;
                confirmDateTime.textContent = `${formatDate(gameData.date)} at ${formatTime(gameData.time)}`;

                // Only somebody holding a spot gets the calendar entry. Saving a game you are
                // waiting for, applying to, or have just pulled out of would put something on
                // their calendar that is not true yet, or not true any more.
                const addToCalendarBtn = document.getElementById('addToCalendarBtn');
                if (addToCalendarBtn) {
                    if (data.action !== 'out' && data.status === 'confirmed') {
                        addToCalendarBtn.href = `/api/games/${gameId}/calendar.ics`;
                        addToCalendarBtn.style.display = 'block';
                    } else {
                        addToCalendarBtn.style.display = 'none';
                    }
                }

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
                    })
                    // Their answer is the reason they were on the confirmation screen, so the
                    // card behind it has to show the new one rather than the old one.
                    .then(refreshIdentityView);
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
            
            /**
             * The one path an answer takes, whether it came from the form or from the one-tap
             * button on a returning player's status card.
             */
            function submitRsvp(playerName, phoneNumber, action) {
                showStatus('Processing your request...', 'info');

                // Send the player data to the server
                return fetch(`/api/games/${gameId}/players`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            name: playerName,
                            phone: phoneNumber,
                            action: action || 'join'
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

                        // Remember them for next time. This is the only place an identity is
                        // captured: they have just proved the number works by using it.
                        if (PlayerIdentity.save({ name: playerName, phone: phoneNumber })) {
                            identity = PlayerIdentity.read();
                        }

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
                        throw error;
                    });
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

                    submitRsvp(
                        playerName,
                        phoneNumber,
                        event.submitter.dataset.action || 'join'
                    ).catch(() => {
                        // Already reported to the player by submitRsvp.
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
