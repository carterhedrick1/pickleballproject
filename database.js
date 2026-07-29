// Compatibility facade for the split persistence modules.
const { initializeDatabase } = require('./database/schema');
const games = require('./database/games');
const locationsMedia = require('./database/locations-media');
const roster = require('./database/roster');
const devRosters = require('./database/dev-rosters');
const messagingReminders = require('./database/messaging-reminders');
const dev = require('./database/dev');
const { closeDatabaseConnection, isProduction } = require('./database/context');

module.exports = {
  initializeDatabase,
  ...games,
  ...locationsMedia,
  ...roster,
  ...devRosters,
  ...messagingReminders,
  ...dev,
  closeDatabaseConnection,
  isProduction
};
