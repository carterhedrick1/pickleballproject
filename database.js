// Compatibility facade for the split persistence modules.
const { initializeDatabase } = require('./database/schema');
const games = require('./database/games');
const locationsMedia = require('./database/locations-media');
const roster = require('./database/roster');
const devRosters = require('./database/dev-rosters');
const messagingReminders = require('./database/messaging-reminders');
const smsEvents = require('./database/sms-events');
const dev = require('./database/dev');
const messageRandomizer = require('./database/message-randomizer');
const { closeDatabaseConnection, isProduction } = require('./database/context');

module.exports = {
  initializeDatabase,
  ...games,
  ...locationsMedia,
  ...roster,
  ...devRosters,
  ...messagingReminders,
  ...smsEvents,
  ...dev,
  ...messageRandomizer,
  closeDatabaseConnection,
  isProduction
};
