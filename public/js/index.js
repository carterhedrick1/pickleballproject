document.addEventListener('DOMContentLoaded', () => {
    const gameForm = document.getElementById('gameForm');
    const shareLink = document.getElementById('shareLink');
    const gameLinkInput = document.getElementById('gameLink');
    const hostLinkInput = document.getElementById('hostLink');
    const copyLinkBtn = document.getElementById('copyLink');
    const copyHostLinkBtn = document.getElementById('copyHostLink');
    const hostedGamesSection = document.getElementById('hostedGames');
    const gamesList = document.getElementById('gamesList');
    
    // Set today's date as default for the date field
    const dateInput = document.getElementById('date');
    if (dateInput) {
        const today = new Date();
        const year = today.getFullYear();
        const month = String(today.getMonth() + 1).padStart(2, '0');
        const day = String(today.getDate()).padStart(2, '0');
        dateInput.value = `${year}-${month}-${day}`;
    }
    
    // Display previously hosted games
    displayHostedGames();
    
    // Handle form submission
    gameForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        try {
            // Get form data
            // Get form data
            const gameData = {
                location: document.getElementById('location').value,
                date: document.getElementById('date').value,
                time: document.getElementById('time').value,
                duration: document.getElementById('duration').value,
                totalPlayers: document.getElementById('players').value,
                message: document.getElementById('message').value,
                organizer: document.getElementById('organizerName').value,
                organizerPlaying: document.getElementById('organizerPlaying').checked
            };
            
            console.log("Submitting game data:", gameData);
            showStatus('Creating game...', 'info');
            
            // Send data to the server
            const response = await fetch('/api/games', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(gameData)
            });
            
            if (!response.ok) {
                let errorMessage = 'Failed to create game';
                try {
                    const errorData = await response.json();
                    errorMessage = errorData.error || errorMessage;
                } catch (e) {
                    console.error("Error parsing error response:", e);
                }
                throw new Error(errorMessage);
            }
            
            const data = await response.json();
            console.log("Game created successfully:", data);
            
            // Save host link in localStorage
            const hostedGames = JSON.parse(localStorage.getItem('hostedGames') || '[]');
            hostedGames.push({
                id: data.gameId,
                location: gameData.location,
                date: gameData.date,
                time: gameData.time,
                hostToken: data.hostToken,
                createdAt: new Date().toISOString()
            });
            localStorage.setItem('hostedGames', JSON.stringify(hostedGames));
            
            // Generate full URLs
            const fullPlayerLink = window.location.origin + data.playerLink;
            const fullHostLink = window.location.origin + data.hostLink;
            
            // Display links to user
            gameLinkInput.value = fullPlayerLink;
            hostLinkInput.value = fullHostLink;
            
            // Show the share link section
            shareLink.style.display = 'block';
            
            // Show success message
            showStatus('Game created successfully!', 'success');
            
            // Clear the form
            gameForm.reset();
            // Reset organizer playing checkbox to checked (default)
document.getElementById('organizerPlaying').checked = true; 
            
            // Set date back to today
            if (dateInput) {
                const today = new Date();
                const year = today.getFullYear();
                const month = String(today.getMonth() + 1).padStart(2, '0');
                const day = String(today.getDate()).padStart(2, '0');
                dateInput.value = `${year}-${month}-${day}`;
            }
            
            // Update hosted games display
            displayHostedGames();
            
        } catch (error) {
            console.error('Error creating game:', error);
            showStatus('Failed to create game: ' + error.message, 'error');
        }
    });
    
    // Copy player link button
    copyLinkBtn.addEventListener('click', () => {
        gameLinkInput.select();
        document.execCommand('copy');
        copyLinkBtn.textContent = 'Copied!';
        
        setTimeout(() => {
            copyLinkBtn.textContent = 'Copy';
        }, 2000);
    });
    
    // Copy host link button
    copyHostLinkBtn.addEventListener('click', () => {
        hostLinkInput.select();
        document.execCommand('copy');
        copyHostLinkBtn.textContent = 'Copied!';
        
        setTimeout(() => {
            copyHostLinkBtn.textContent = 'Copy';
        }, 2000);
    });
    
    // Helper function to display hosted games
    function displayHostedGames() {
        const hostedGames = JSON.parse(localStorage.getItem('hostedGames') || '[]');
        
        if (hostedGames.length === 0) {
            hostedGamesSection.style.display = 'none';
            return;
        }
        
        gamesList.innerHTML = '';
        hostedGamesSection.style.display = 'block';
        
        // Sort games by date (newest first)
        hostedGames.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        
        hostedGames.forEach(game => {
            const gameDate = new Date(game.date);
            const formattedDate = gameDate.toLocaleDateString('en-US', { 
                weekday: 'short', 
                month: 'short', 
                day: 'numeric' 
            });
            
            const gameCard = document.createElement('div');
            gameCard.className = 'game-card';
            gameCard.innerHTML = `
                <div class="game-info">
                    <h4>${game.location}</h4>
                    <p>${formattedDate} at ${formatTime(game.time)}</p>
                </div>
                <a href="/manage.html?id=${game.id}&token=${game.hostToken}" class="manage-btn">Manage</a>
            `;
            
            gamesList.appendChild(gameCard);
        });
    }
    
    // Helper function to format time
    function formatTime(timeStr) {
        if (!timeStr) return '';
        const [hours, minutes] = timeStr.split(':');
        const hour = parseInt(hours);
        const ampm = hour >= 12 ? 'PM' : 'AM';
        const hour12 = hour % 12 || 12;
        return `${hour12}:${minutes} ${ampm}`;
    }
    
    // Helper function to show status messages
    function showStatus(message, type) {
        const statusDiv = document.getElementById('status');
        if (!statusDiv) return;
        
        statusDiv.textContent = message;
        statusDiv.className = type;
        statusDiv.style.display = 'block';
        
        if (type === 'success' || type === 'info') {
            setTimeout(() => {
                statusDiv.style.display = 'none';
            }, 5000);
        }
    }
});