// server.js - process startup only. The app itself is built by app.js.
//
// This is the one file allowed to have side effects on the process: it validates the
// configuration, starts the listener, starts the reminder timers, and installs the
// process-level error and shutdown handlers. Importing app.js (or anything below it)
// does none of that, which is what lets tests drive the real app over HTTP.
require('dotenv').config();

// Refuse to boot a misconfigured production process before anything else loads. A failed
// boot leaves the previous deploy running on Render; serving with a broken configuration
// would not. Warnings (including a disabled developer area) are logged, not fatal.
const { assertStartupConfig } = require('./config');
assertStartupConfig();

const { createApp } = require('./app');
const { checkAndSendReminders } = require('./services/reminders');
const { logAppError, closeDatabaseConnection } = require('./database');

const PORT = process.env.PORT || 3001;
const REMINDER_INTERVAL_MS = 2 * 60 * 1000;
const REMINDER_STARTUP_DELAY_MS = 10000;

let reminderInterval = null;
let reminderKickoff = null;
let httpServer = null;

function startSchedulers() {
  // Check every 2 minutes, plus once shortly after startup so a restart cannot delay an
  // imminent reminder by a full interval.
  reminderInterval = setInterval(checkAndSendReminders, REMINDER_INTERVAL_MS);
  reminderKickoff = setTimeout(checkAndSendReminders, REMINDER_STARTUP_DELAY_MS);
  console.log('[REMINDER] Reminder system started - checking every 2 minutes');
}

function stopSchedulers() {
  if (reminderInterval) clearInterval(reminderInterval);
  if (reminderKickoff) clearTimeout(reminderKickoff);
  reminderInterval = null;
  reminderKickoff = null;
}

async function shutdown() {
  stopSchedulers();
  if (httpServer) {
    await new Promise((resolve) => httpServer.close(resolve));
    httpServer = null;
  }
  console.log('Closing database connection...');
  await closeDatabaseConnection();
}

function startServer() {
  const app = createApp();
  startSchedulers();
  httpServer = app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Visit http://localhost:${PORT} to view your app`);
  });
  return httpServer;
}

process.on('unhandledRejection', (reason) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  console.error('Unhandled promise rejection:', err);
  logAppError('server', { message: `Unhandled rejection: ${err.message}`, stack: err.stack });
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  // The process is in an unknown state, so record what happened and let Render restart
  // us rather than limping along. The timeout guarantees we exit even if the database
  // write hangs - which it can, since the database may be the thing that just broke.
  const exit = () => process.exit(1);
  setTimeout(exit, 1000);
  logAppError('server', { message: `Uncaught exception: ${err.message}`, stack: err.stack })
    .then(exit, exit);
});

// Graceful shutdown handlers
process.on('SIGINT', async () => {
  await shutdown();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await shutdown();
  process.exit(0);
});

// `node server.js` (npm start) boots the process; importing this file does not.
if (require.main === module) {
  startServer();
}

module.exports = { startServer, startSchedulers, stopSchedulers, shutdown };
