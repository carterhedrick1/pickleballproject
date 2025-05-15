const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

// In-memory database for storing games
const games = {};

// Middleware for parsing JSON and serving static files
app.use(express.json());
app.use(express.static('public'));

// Log all incoming requests for debugging
app.use((req, res, next) => {
  console.log(`${req.method} ${req.url}`);
  next();
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  console.log('Health check endpoint called');
  res.json({ status: 'OK', message: 'Server is running' });
});

// API Routes
// Create a new game
app.post('/api/games', (req, res) => {
  try {
    console.log('Received game creation request:', req.body);
    
    const gameData = req.body;
    const gameId = Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
    
    // Initialize players array with organizer
    gameData.players = [
      { id: 'organizer', name: gameData.organizer || 'Organizer', isOrganizer: true }
    ];
    
    // Initialize waitlist
    gameData.waitlist = [];
    
    // Store game in our "database"
    games[gameId] = gameData;
    
    console.log(`Game created with ID: ${gameId}`);
    console.log('Current games:', Object.keys(games));
    
    res.status(201).json({ gameId });
  } catch (error) {
    console.error('Error creating game:', error);
    res.status(500).json({ error: 'Failed to create game' });
  }
});

// Get game details
app.get('/api/games/:id', (req, res) => {
  const gameId = req.params.id;
  console.log(`Fetching game with ID: ${gameId}`);
  console.log('Available games:', Object.keys(games));
  
  const game = games[gameId];
  
  if (!game) {
    console.log(`Game not found: ${gameId}`);
    return res.status(404).json({ error: 'Game not found' });
  }
  
  console.log(`Found game: ${gameId}`);
  res.json(game);
});

// Add player to game
app.post('/api/games/:id/players', (req, res) => {
  try {
    const gameId = req.params.id;
    const game = games[gameId];
    
    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }
    
    const { name, phone } = req.body;
    
    // Generate a unique player ID
    const playerId = Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
    const playerData = { id: playerId, name, phone };
    
    console.log(`Attempting to add player ${name} to game ${gameId}`);
    
    // Check if spots are available
    if (game.players.length < parseInt(game.totalPlayers)) {
      // Add to players
      game.players.push(playerData);
      console.log(`Player ${name} added to game ${gameId} as player ${game.players.length}`);
      res.status(201).json({ 
        status: 'confirmed', 
        position: game.players.length,
        playerId,
        totalPlayers: game.totalPlayers
      });
    } else {
      // Add to waitlist
      game.waitlist.push(playerData);
      console.log(`Player ${name} added to waitlist for game ${gameId} at position ${game.waitlist.length}`);
      res.status(201).json({ 
        status: 'waitlist', 
        position: game.waitlist.length,
        playerId 
      });
    }
  } catch (error) {
    console.error('Error adding player:', error);
    res.status(500).json({ error: 'Failed to add player' });
  }
});

// Cancel player spot
app.delete('/api/games/:id/players/:playerId', (req, res) => {
  try {
    const gameId = req.params.id;
    const playerId = req.params.playerId;
    const game = games[gameId];
    
    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }
    
    console.log(`Attempting to remove player ${playerId} from game ${gameId}`);
    
    // Find player in the list
    const playerIndex = game.players.findIndex(p => p.id === playerId);
    
    if (playerIndex > 0) { // Don't allow removing the organizer
      const removedPlayer = game.players.splice(playerIndex, 1)[0];
      console.log(`Player ${removedPlayer.name} removed from game ${gameId}`);
      
      // Promote first person from waitlist if available
      let promotedPlayer = null;
      if (game.waitlist.length > 0) {
        promotedPlayer = game.waitlist.shift();
        game.players.push(promotedPlayer);
        
        console.log(`Player ${promotedPlayer.name} promoted from waitlist for game ${gameId}`);
        // In a real app, send SMS notification here
      }
      
      res.json({ 
        status: 'removed',
        promotedPlayer 
      });
    } else if (playerIndex === 0) {
      // Trying to remove organizer
      console.log(`Cannot remove organizer from game ${gameId}`);
      res.status(403).json({ error: 'Cannot remove the organizer' });
    } else {
      // Check waitlist
      const waitlistIndex = game.waitlist.findIndex(p => p.id === playerId);
      
      if (waitlistIndex >= 0) {
        const removedPlayer = game.waitlist.splice(waitlistIndex, 1)[0];
        console.log(`Player ${removedPlayer.name} removed from waitlist for game ${gameId}`);
        res.json({ status: 'removed from waitlist' });
      } else {
        console.log(`Player ${playerId} not found in game ${gameId}`);
        res.status(404).json({ error: 'Player not found' });
      }
    }
  } catch (error) {
    console.error('Error removing player:', error);
    res.status(500).json({ error: 'Failed to remove player' });
  }
});

// Debug route to list all games
app.get('/api/debug/games', (req, res) => {
  const gamesList = Object.keys(games).map(gameId => {
    return {
      id: gameId,
      location: games[gameId].location,
      date: games[gameId].date,
      players: games[gameId].players.length,
      waitlist: games[gameId].waitlist.length
    };
  });
  
  res.json({ 
    gamesCount: Object.keys(games).length,
    games: gamesList 
  });
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Visit http://localhost:${PORT} to view your app`);
});