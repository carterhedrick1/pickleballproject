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
const net = require('net');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
 * @returns {Promise<{baseUrl:string, port:number, log:()=>string, stop:()=>Promise<void>}>}
 */
async function start() {
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

  const proc = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      BASE_URL: baseUrl,
      TEXTBELT_API_KEY: '', // rule 1 above - keeps every send in dev mode
      // Browser tests and screenshots must stay on their seeded SQLite rows. Without this,
      // the local Developer roster defaults to live production data for day-to-day use.
      DEV_ROSTER_SOURCE: 'local',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', (d) => { output += d.toString(); });
  proc.stderr.on('data', (d) => { output += d.toString(); });

  const stop = async () => {
    try { proc.kill(); } catch {}
    await sleep(300);
  };

  for (let i = 0; i < 60; i++) {
    await sleep(250);
    if (proc.exitCode !== null) {
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
      return { baseUrl, port, stop, log: () => output };
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

module.exports = { start, countDevModeSends };
