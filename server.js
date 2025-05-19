const express = require('express');
const path = require('path');
require('dotenv').config(); // Load environment variables
const twilio = require('twilio');
const app = express();
const PORT = process.env.PORT || 3000;

// Initialize Twilio client (if credentials are available)
let twilioClient = null;
let twilioPhoneNumber = null;

if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
  twilioClient = twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
  );
  twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER;
}

// Function to send SMS
async function sendSMS(to, message) {
  try {
    // Check if Twilio is configured
    if (!twilioClient) {
      console.log(`[DEV MODE] SMS would be sent to ${to}: ${message}`);
      return { success: true, dev: true };
    }
    
    // Send actual SMS
    const result = await twilioClient.messages.create({
      body: message,
      from: twilioPhoneNumber,
      to: to
    });
    
    console.log(`SMS sent to ${to}, SID: ${result.sid}`);
    return { success: true, sid: result.sid };
  } catch (error) {
    console.error('Error sending SMS:', error);
    return { success: false, error: error.message };
  }
}

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

// Add player to game - WITH SMS NOTIFICATION
app.post('/api/games/:id/players', async (req, res) => {
  try {
    const gameId = req.params.id;
    const game = games[gameId];
    
    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }
    
    const { name, phone } = req.body;
    
    // Format phone number
    const formattedPhone = formatPhoneNumber(phone);
    
    // Generate a unique player ID
    const playerId = Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
    const playerData = { id: playerId, name, phone: formattedPhone };
    
    console.log(`Attempting to add player ${name} to game ${gameId}`);
    
    // Check if spots are available
    let smsResult;
    
    if (game.players.length < parseInt(game.totalPlayers)) {
      // Add to players
      game.players.push(playerData);
      
      // Send confirmation SMS
      const gameDate = formatDateForSMS(game.date);
      const gameTime = formatTimeForSMS(game.time);
      // In the player signup route, update the confirmation message
        const message = `You're confirmed for Pickleball at ${game.location} on ${gameDate} at ${gameTime}! You are Player ${game.players.length} of ${game.totalPlayers}. Reply with '9' to cancel.`;
      
      smsResult = await sendSMS(formattedPhone, message);
      
      console.log(`Player ${name} added to game ${gameId} as player ${game.players.length}`);
      res.status(201).json({ 
        status: 'confirmed', 
        position: game.players.length,
        playerId,
        totalPlayers: game.totalPlayers,
        sms: smsResult
      });
    } else {
      // Add to waitlist
      game.waitlist.push(playerData);
      
      // Send waitlist SMS
      // In the player signup route, update the waitlist message
        const message = `You've been added to the waitlist for Pickleball at ${game.location}. You are #${game.waitlist.length} on the waitlist. We'll notify you if a spot opens up! Reply with '9' to cancel your spot on the waitlist.`;
      
      smsResult = await sendSMS(formattedPhone, message);
      
      console.log(`Player ${name} added to waitlist for game ${gameId} at position ${game.waitlist.length}`);
      res.status(201).json({ 
        status: 'waitlist', 
        position: game.waitlist.length,
        playerId,
        sms: smsResult
      });
    }
  } catch (error) {
    console.error('Error adding player:', error);
    res.status(500).json({ error: 'Failed to add player' });
  }
});

// Cancel player spot - WITH SMS NOTIFICATION FOR PROMOTED PLAYERS
app.delete('/api/games/:id/players/:playerId', async (req, res) => {
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
      let smsResult = null;
      
      if (game.waitlist.length > 0) {
        promotedPlayer = game.waitlist.shift();
        game.players.push(promotedPlayer);
        
        console.log(`Player ${promotedPlayer.name} promoted from waitlist for game ${gameId}`);
        
        // Send promotion SMS
        const gameDate = formatDateForSMS(game.date);
        const gameTime = formatTimeForSMS(game.time);
        const message = `Good news! You've been moved from the waitlist to confirmed for Pickleball at ${game.location} on ${gameDate} at ${gameTime}! You are Player ${game.players.length} of ${game.totalPlayers}.`;
        
        smsResult = await sendSMS(promotedPlayer.phone, message);
      }
      
      res.json({ 
        status: 'removed',
        promotedPlayer,
        sms: smsResult 
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

// Send reminders to all confirmed players
app.post('/api/games/:id/send-reminders', async (req, res) => {
  try {
    const gameId = req.params.id;
    const game = games[gameId];
    
    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }
    
    const gameDate = formatDateForSMS(game.date);
    const gameTime = formatTimeForSMS(game.time);
    
    // Send reminder to all confirmed players
    const results = [];
    for (const player of game.players) {
      if (player.phone && !player.isOrganizer) {
        const message = `Reminder: Your pickleball game at ${game.location} is today at ${gameTime}. See you there!`;
        const result = await sendSMS(player.phone, message);
        results.push({ player: player.name, result });
      }
    }
    
    res.json({ success: true, results });
  } catch (error) {
    console.error('Error sending reminders:', error);
    res.status(500).json({ error: 'Failed to send reminders' });
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

// Helper Functions
// Format phone number
function formatPhoneNumber(phoneNumber) {
  // Remove any non-numeric characters
  const cleaned = ('' + phoneNumber).replace(/\D/g, '');
  
  // Ensure it has country code (US)
  if (cleaned.length === 10) {
    return '+1' + cleaned;
  } else if (cleaned.length > 10 && cleaned.startsWith('1')) {
    return '+' + cleaned;
  } else if (cleaned.length > 10) {
    return '+' + cleaned;
  }
  
  // Return as is if we can't determine format
  return phoneNumber;
}

// Format date for SMS
function formatDateForSMS(dateStr) {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

// Format time for SMS
function formatTimeForSMS(timeStr) {
  const [hours, minutes] = timeStr.split(':');
  const hour = parseInt(hours);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const hour12 = hour % 12 || 12;
  return `${hour12}:${minutes} ${ampm}`;
}

// Add this route to your server.js file, before the "Start the server" line
// Handle incoming SMS from Twilio
app.post('/api/sms/webhook', express.urlencoded({ extended: false }), async (req, res) => {
  try {
    // Get the incoming message details
    const from = req.body.From; // Phone number that sent the message
    const body = req.body.Body.trim(); // Message content
    
    console.log(`Received SMS from ${from}: "${body}"`);
    
    // Check if the message is "9" (cancel code)
    if (body === '9') {
      // Find the player in all games
      let playerFound = false;
      
      // Search through all games
      for (const gameId in games) {
        const game = games[gameId];
        
        // Check confirmed players
        const playerIndex = game.players.findIndex(p => p.phone === from);
        if (playerIndex > 0) { // Skip organizer (index 0)
          playerFound = true;
          const player = game.players[playerIndex];
          
          // Remove the player
          game.players.splice(playerIndex, 1);
          console.log(`Player ${player.name} cancelled via SMS from game ${gameId}`);
          
          // Promote from waitlist if available
          let promotedPlayer = null;
          if (game.waitlist.length > 0) {
            promotedPlayer = game.waitlist.shift();
            game.players.push(promotedPlayer);
            
            // Send promotion notification to promoted player
            const gameDate = formatDateForSMS(game.date);
            const gameTime = formatTimeForSMS(game.time);
            const promotionMessage = `Good news! You've been moved from the waitlist to confirmed for Pickleball at ${game.location} on ${gameDate} at ${gameTime}!`;
            
            await sendSMS(promotedPlayer.phone, promotionMessage);
            console.log(`Player ${promotedPlayer.name} promoted from waitlist for game ${gameId}`);
          }
          
          // Confirm cancellation to the user
          const responseMessage = `Your pickleball reservation at ${game.location} has been cancelled. Thanks for letting us know!`;
          
          // Send SMS response using TwiML
          const twiml = new twilio.twiml.MessagingResponse();
          twiml.message(responseMessage);
          res.type('text/xml').send(twiml.toString());
          return;
        }
        
        // Check waitlist
        const waitlistIndex = game.waitlist.findIndex(p => p.phone === from);
        if (waitlistIndex >= 0) {
          playerFound = true;
          const player = game.waitlist[waitlistIndex];
          
          // Remove from waitlist
          game.waitlist.splice(waitlistIndex, 1);
          console.log(`Player ${player.name} cancelled from waitlist via SMS for game ${gameId}`);
          
          // Confirm cancellation
          const responseMessage = `You've been removed from the waitlist for pickleball at ${game.location}. Thanks for letting us know!`;
          
          // Send SMS response using TwiML
          const twiml = new twilio.twiml.MessagingResponse();
          twiml.message(responseMessage);
          res.type('text/xml').send(twiml.toString());
          return;
        }
      }
      
      if (!playerFound) {
        // If player not found in any game
        const twiml = new twilio.twiml.MessagingResponse();
        twiml.message("We couldn't find your registration for any upcoming pickleball games. Please contact the organizer if you need assistance.");
        res.type('text/xml').send(twiml.toString());
      }
    } else {
      // If message is not "9"
      const twiml = new twilio.twiml.MessagingResponse();
      twiml.message("To cancel your pickleball reservation, please reply with just the number 9. For all other inquiries, please contact the organizer.");
      res.type('text/xml').send(twiml.toString());
    }
  } catch (error) {
    console.error('Error handling incoming SMS:', error);
    // Respond with a generic message to avoid errors back to Twilio
    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message("Sorry, we encountered an error processing your request. Please try again later or contact the organizer.");
    res.type('text/xml').send(twiml.toString());
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Visit http://localhost:${PORT} to view your app`);
});