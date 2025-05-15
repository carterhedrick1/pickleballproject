document.addEventListener('DOMContentLoaded', () => {
    const gameForm = document.getElementById('gameForm');
    const shareLink = document.getElementById('shareLink');
    const gameLinkInput = document.getElementById('gameLink');
    const copyLinkBtn = document.getElementById('copyLink');
    
    // Handle form submission
    gameForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        try {
            // Get form data
            const gameData = {
                location: document.getElementById('location').value,
                date: document.getElementById('date').value,
                time: document.getElementById('time').value,
                duration: document.getElementById('duration').value,
                totalPlayers: document.getElementById('players').value,
                message: document.getElementById('message').value,
                organizer: 'You' // For now, hardcoded
            };
            
            console.log("Submitting game data:", gameData);
            
            // Send data to the server
            const response = await fetch('/api/games', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(gameData)
            });
            
            console.log("Response status:", response.status);
            
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
            const gameId = data.gameId;
            
            // Generate shareable link
            const gameUrl = `${window.location.origin}/game.html?id=${gameId}`;
            gameLinkInput.value = gameUrl;
            
            // Show the share link section
            shareLink.style.display = 'block';
            
        } catch (error) {
            console.error('Error creating game:', error);
            alert('Failed to create game. Please try again.');
        }
    });
    
    // Copy link button
    copyLinkBtn.addEventListener('click', () => {
        gameLinkInput.select();
        document.execCommand('copy');
        copyLinkBtn.textContent = 'Copied!';
        
        setTimeout(() => {
            copyLinkBtn.textContent = 'Copy';
        }, 2000);
    });
});