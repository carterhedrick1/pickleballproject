// Starts a throwaway copy of the app for the documentation scripts to photograph.
//
// Two things matter here and both are safety rather than convenience:
//
//   1. TEXTBELT_API_KEY is blanked. sendSMS falls back to dev mode in that state, logging
//      "[DEV MODE] SMS would be sent to ..." and returning success without contacting Textbelt.
//      The screenshots involve creating games and signing up, both of which send texts.
//   2. It refuses to start if DATABASE_URL is set, and refuses to continue unless the running
//      app reports SQLite. The scripts create and then delete fixture games; that must never
//      happen against production.
//
// It also picks its own free port rather than reusing 3001/3002, so a server you already have
// running is left alone.

const { spawn } = require('child_process');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_DB_FILE = path.join(ROOT, 'pickleball.db');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The password the throwaway server's developer area answers to.
//
// It is pinned here rather than read from .env because these scripts are the only thing that
// signs in to it, and the day a real DEV_PASSWORD was added to the local .env they stopped
// agreeing: the spawned server took the real one while the scripts, which never load dotenv,
// went on sending the 'vibe123' default. Every developer-area assertion in the browser smoke
// and every developer-area screenshot failed on a password mismatch, which took the whole
// deployment gate down with them. Nothing outside these scripts uses this value - the real
// local server on 3002 and production both keep reading DEV_PASSWORD as before.
const DEV_PASSWORD = 'local-scripts-dev-password';

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

/**
 * Boots the app and resolves once /api/health answers.
 *
 * `isolatedDatabase` gives the server an empty SQLite file in a temporary directory, which the
 * app migrates and seeds at boot exactly as it would any new database. The browser smoke asks
 * for one so that nothing a developer has saved locally can decide an assertion: a saved
 * `youre-in-config` used to shadow the shipped defaults the smoke pins its message count to,
 * and every leftover test game added a court to the create page's picker. Screenshots stay on
 * the shared database on purpose - `npm run docs` photographs the app a developer actually has.
 *
 * `dbFile` is always returned, isolated or not, so callers can hand it to lib/fixtures.js
 * without having to know which kind of server they asked for.
 *
 * @returns {Promise<{baseUrl:string, port:number, dbFile:string, log:()=>string, stop:()=>Promise<void>}>}
 */
async function start({ isolatedDatabase = false } = {}) {
  if (process.env.DATABASE_URL) {
    throw new Error(
      'DATABASE_URL is set, which points the app at Postgres (production).\n' +
      'These scripts create and delete fixture games and must only ever run against local SQLite.\n' +
      'Unset DATABASE_URL and try again.'
    );
  }

  const port = await freePort();
  const baseUrl = `http://localhost:${port}`;
  let output = '';

  const scratchDir = isolatedDatabase
    ? fs.mkdtempSync(path.join(os.tmpdir(), 'inorout-local-server-'))
    : null;
  const dbFile = scratchDir ? path.join(scratchDir, 'pickleball.db') : DEFAULT_DB_FILE;

  const proc = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      BASE_URL: baseUrl,
      SQLITE_DB_FILE: dbFile,
      TEXTBELT_API_KEY: '', // rule 1 above - keeps every send in dev mode
      DEV_PASSWORD, // see the note above: the scripts and this server must agree on it
      // Fixture sends prove the UI behavior but are not real operational events.
      SMS_DISABLE_EVENT_LOGGING: '1',
      // Browser tests and screenshots must stay on their seeded SQLite rows. Without these,
      // local Developer tools default to live production data for day-to-day operational use.
      DEV_ROSTER_SOURCE: 'local',
      DEV_IMAGE_SOURCE: 'local',
      DEV_STATUS_SOURCE: 'local',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', (d) => { output += d.toString(); });
  proc.stderr.on('data', (d) => { output += d.toString(); });

  const stop = async () => {
    try { proc.kill(); } catch {}
    await sleep(300);
    // Takes the -wal and -shm sidecars with it. Only ever a directory this call made.
    if (scratchDir) fs.rmSync(scratchDir, { recursive: true, force: true });
  };

  for (let i = 0; i < 60; i++) {
    await sleep(250);
    if (proc.exitCode !== null) {
      await stop();  // the process is already gone; this is here to remove the scratch directory
      throw new Error(`server.js exited before it was ready:\n${output.slice(-800)}`);
    }
    try {
      const health = await (await fetch(`${baseUrl}/api/health`)).json();
      if (health.status !== 'OK') continue;
      if (health.database !== 'SQLite') {
        await stop();
        throw new Error(
          `The app reported database "${health.database}", expected SQLite. Refusing to seed ` +
          'fixture games against anything but the local database.'
        );
      }
      return { baseUrl, port, dbFile, stop, log: () => output };
    } catch (e) {
      if (e.message.startsWith('The app reported')) throw e;
      // not listening yet
    }
  }

  await stop();
  throw new Error(`The app did not answer on ${baseUrl} within 15s:\n${output.slice(-800)}`);
}

// Counts the sends that took the dev-mode branch, so a run can report what it did rather than
// just claiming it was safe. Note the actual guarantee is the blanked TEXTBELT_API_KEY above:
// sendSMS checks the key before it builds a request, so with no key there is no Textbelt call to
// find in the log. This is corroboration, not the safeguard.
function countDevModeSends(log) {
  return (log.match(/\[DEV MODE\] SMS would be sent/g) || []).length;
}

module.exports = { start, countDevModeSends, DEV_PASSWORD };
