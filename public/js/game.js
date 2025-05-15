document.addEventListener('DOMContentLoaded', () => {
    // Get game ID from URL
    const urlParams = new URLSearchParams(window.location.search);
    const gameId = urlParams.get('id');
    
    if (!gameId) {
        showError("Game not found. Please check your link.");
        return;
    }
    
    // Global variable to store the game data
    let gameData;
    
    // Fetch game data from API
    fetchGameData();
    
    async function fetchGameData() {
        try {
            console.log(`Fetching game data for ID: ${gameId}`);
            const response = await fetch(`/api/games/${gameId}`);
            
            if (!response.ok) {
                throw new Error('Game not found');
            }
            
            gameData = await response.json();
            console.log("Game data received:", gameData);
            displayGameData();
            
            // Set up event listeners after we have the data
            setupEventListeners();
            
            // Check if this device/browser has already signed up
            checkExistingSignup();
            
        } catch (error) {
            console.error("Error fetching game data:", error);
            showError("Game not found. Please check your link.");
        }
    }
    
    function setupEventListeners() {
        // Handle signup form submission
        const joinForm = document.getElementById('joinForm');
        if (joinForm) {
            joinForm.addEventListener('submit', (e) => {
                e.preventDefault();
                
                const playerName = document.getElementById('playerName').value;
                const phoneNumber = document.getElementById('phoneNumber').value;
                
                addPlayer(playerName, phoneNumber);
            });
        }
        
        // Handle Add to Calendar button
        const calendarBtn = document.getElementById('addToCalendar');
        if (calendarBtn) {
            calendarBtn.addEventListener('click', () => {
                addToCalendar();
            });
        }
        
        // Handle Cancel Spot button
        const cancelSpotBtn = document.getElementById('cancelSpot');
        if (cancelSpotBtn) {
            cancelSpotBtn.addEventListener('click', () => {
                cancelSpot();
            });
        }
        
        // Handle Cancel Waitlist button
        const cancelWaitlistBtn = document.getElementById('cancelWaitlist');
        if (cancelWaitlistBtn) {
            cancelWaitlistBtn.addEventListener('click', () => {
                cancelWaitlist();
            });
        }
    }
    
    // Helper functions
    function displayGameData() {
        document.getElementById('location').textContent = gameData.location;
        document.getElementById('date').textContent = formatDate(gameData.date);
        document.getElementById('time').textContent = formatTime(gameData.time);
        document.getElementById('duration').textContent = gameData.duration;
        document.getElementById('message').textContent = gameData.message || "None";
        
        // Initialize player list if not exists
        if (!gameData.players) {
            gameData.players = [
                { name: gameData.organizer, isOrganizer: true }
            ];
            gameData.waitlist = [];
        }
        
        // Update player list and available spots
        updatePlayerList();
    }
    
    function formatDate(dateStr) {
        const date = new Date(dateStr);
        return date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    }
    
    function formatTime(timeStr) {
        const [hours, minutes] = timeStr.split(':');
        const hour = parseInt(hours);
        const ampm = hour >= 12 ? 'PM' : 'AM';
        const hour12 = hour % 12 || 12;
        return `${hour12}:${minutes} ${ampm}`;
    }
    
    function formatICS(date) {
        return date.toISOString().replace(/-|:|\.\d+/g, '');
    }
    
    function updatePlayerList() {
        const playersList = document.getElementById('players');
        const spotsAvailable = document.getElementById('spotsAvailable');
        
        if (!playersList || !spotsAvailable) {
            console.error("Player list elements not found");
            return;
        }
        
        // Clear existing list
        playersList.innerHTML = '';
        
        // Add players to list
        gameData.players.forEach(player => {
            const li = document.createElement('li');
            li.textContent = player.name + (player.isOrganizer ? ' (Organizer)' : '');
            playersList.appendChild(li);
        });
        
        // Update spots available
        const availableSpots = parseInt(gameData.totalPlayers) - gameData.players.length;
        spotsAvailable.textContent = availableSpots;
        
        // If game is full, hide signup form only if user hasn't signed up yet
        const signupForm = document.getElementById('signupForm');
        const playerId = localStorage.getItem(`player_${gameId}`);
        
        // Check if user has already signed up before hiding the form
        if (signupForm && availableSpots <= 0 && !hasUserSignedUp(playerId)) {
            signupForm.style.display = 'none';
        }
    }
    
    function hasUserSignedUp(playerId) {
        if (!playerId) return false;
        
        // Check players list
        const inPlayers = gameData.players.some(p => p.id === playerId);
        // Check waitlist
        const inWaitlist = gameData.waitlist.some(p => p.id === playerId);
        
        return inPlayers || inWaitlist;
    }
    
    function showError(message) {
        const errorDiv = document.getElementById('errorMessage');
        if (errorDiv) {
            errorDiv.textContent = message;
            errorDiv.style.display = 'block';
            
            // Hide other sections
            const gameDetails = document.getElementById('gameDetails');
            const signupForm = document.getElementById('signupForm');
            
            if (gameDetails) gameDetails.style.display = 'none';
            if (signupForm) signupForm.style.display = 'none';
        } else {
            alert(message); // Fallback if errorDiv not found
        }
    }
    
    async function addPlayer(playerName, phoneNumber) {
        try {
            const response = await fetch(`/api/games/${gameId}/players`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    name: playerName,
                    phone: phoneNumber
                })
            });
            
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to join game');
            }
            
            const data = await response.json();
            
            // Store player ID in localStorage to identify THIS DEVICE's player
            localStorage.setItem(`player_${gameId}`, data.playerId);
            
            const signupForm = document.getElementById('signupForm');
            const confirmation = document.getElementById('confirmation');
            const waitlist = document.getElementById('waitlist');
            const confirmationMessage = document.getElementById('confirmationMessage');
            const waitlistPosition = document.getElementById('waitlistPosition');
            
            if (data.status === 'confirmed' && signupForm && confirmation && confirmationMessage) {
                // Show confirmation
                signupForm.style.display = 'none';
                confirmation.style.display = 'block';
                confirmationMessage.textContent = 
                    `You are Player ${data.position} of ${gameData.totalPlayers}.`;
            } else if (signupForm && waitlist && waitlistPosition) {
                // Show waitlist confirmation
                signupForm.style.display = 'none';
                waitlist.style.display = 'block';
                waitlistPosition.textContent = `#${data.position}`;
            }
            
            // Refresh game data
            fetchGameData();
            
        } catch (error) {
            console.error('Error joining game:', error);
            alert('Failed to join game. Please try again.');
        }
    }
    
    function addToCalendar() {
        // For simplicity, just create a Google Calendar link
        const startTime = new Date(`${gameData.date}T${gameData.time}`);
        const endTime = new Date(startTime.getTime() + parseInt(gameData.duration) * 60000);
        
        const googleCalUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=Pickleball at ${gameData.location}&dates=${formatICS(startTime)}/${formatICS(endTime)}&details=Pickleball game organized through PicklePlay Scheduler&location=${encodeURIComponent(gameData.location)}`;
        
        window.open(googleCalUrl, '_blank');
    }
    
    function checkExistingSignup() {
        const playerId = localStorage.getItem(`player_${gameId}`);
        
        if (!playerId) {
            // This user hasn't signed up yet, show the signup form if spots are available
            const signupForm = document.getElementById('signupForm');
            const availableSpots = parseInt(gameData.totalPlayers) - gameData.players.length;
            
            if (signupForm) {
                signupForm.style.display = availableSpots > 0 ? 'block' : 'none';
            }
            return;
        }
        
        // Elements we need
        const signupForm = document.getElementById('signupForm');
        const confirmation = document.getElementById('confirmation');
        const waitlist = document.getElementById('waitlist');
        const confirmationMessage = document.getElementById('confirmationMessage');
        const waitlistPosition = document.getElementById('waitlistPosition');
        
        // Check if in players list
        const playerIndex = gameData.players.findIndex(p => p.id === playerId);
        
        if (playerIndex > 0 && signupForm && confirmation && confirmationMessage) { // Index 0 is organizer
            // Player is already signed up
            signupForm.style.display = 'none';
            confirmation.style.display = 'block';
            confirmationMessage.textContent = 
                `You are Player ${playerIndex + 1} of ${gameData.totalPlayers}.`;
            return;
        }
        
        // Check if in waitlist
        const waitlistIndex = gameData.waitlist.findIndex(p => p.id === playerId);
        
        if (waitlistIndex >= 0 && signupForm && waitlist && waitlistPosition) {
            // Player is on waitlist
            signupForm.style.display = 'none';
            waitlist.style.display = 'block';
            waitlistPosition.textContent = `#${waitlistIndex + 1}`;
            return;
        }
        
        // If player ID is in localStorage but not found in the game data,
        // they might have been removed or the data was corrupted.
        // Clear the player ID and refresh the page.
        if (playerIndex < 0 && waitlistIndex < 0) {
            localStorage.removeItem(`player_${gameId}`);
            // Show signup form if there are spots available
            if (signupForm) {
                const availableSpots = parseInt(gameData.totalPlayers) - gameData.players.length;
                signupForm.style.display = availableSpots > 0 ? 'block' : 'none';
            }
        }
    }
    
    async function cancelSpot() {
        const playerId = localStorage.getItem(`player_${gameId}`);
        
        if (!playerId) {
            return;
        }
        
        try {
            const response = await fetch(`/api/games/${gameId}/players/${playerId}`, {
                method: 'DELETE'
            });
            
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to cancel spot');
            }
            
            // Remove player ID from localStorage
            localStorage.removeItem(`player_${gameId}`);
            
            // Refresh the page
            location.reload();
            
        } catch (error) {
            console.error('Error canceling spot:', error);
            alert('Failed to cancel your spot. Please try again.');
        }
    }
    
    async function cancelWaitlist() {
        const playerId = localStorage.getItem(`player_${gameId}`);
        
        if (!playerId) {
            return;
        }
        
        try {
            const response = await fetch(`/api/games/${gameId}/players/${playerId}`, {
                method: 'DELETE'
            });
            
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to remove from waitlist');
            }
            
            // Remove player ID from localStorage
            localStorage.removeItem(`player_${gameId}`);
            
            // Refresh the page
            location.reload();
            
        } catch (error) {
            console.error('Error removing from waitlist:', error);
            alert('Failed to remove from waitlist. Please try again.');
        }
    }
});