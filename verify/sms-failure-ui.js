// Proves the CONFIRMATION SCREEN tells the truth when a text could not be sent.
// Usage: node sms-failure-ui.js [baseUrl]
//
// The server-side half of this is verify/sms-failure.js: it proves the API reports the failure.
// But the bug a player actually experienced was on the page - it said "You'll receive a
// confirmation text message shortly" and then nothing arrived. So this drives the real page in
// a real browser and reads what is on screen after tapping IN.
//
// Uses headless Chrome over the DevTools Protocol. No npm dependency: Node's built-in WebSocket
// speaks to Chrome directly. Skips (exit 0) if Chrome is not installed.
//
//   TEXTBELT_API_KEY="" SMS_SIMULATE_FAILURE=1 PORT=3002 node server.js
//   npm run verify:sms-failure-ui

const fs = require('fs');
const { spawn } = require('child_process');

const BASE = process.argv[2] || 'http://localhost:3002';
const DEBUG_PORT = 9333;
const CHROME_PATHS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];

// Same rule as sms-failure.js: this signs up a player WITH a phone number, which is only safe
// against a local server started with SMS_SIMULATE_FAILURE=1.
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(BASE)) {
  console.error(`\n  REFUSING to run against ${BASE}.`);
  console.error('  This script uses a real phone number and is only safe against a local server');
  console.error('  started with SMS_SIMULATE_FAILURE=1.\n');
  process.exit(1);
}

let failures = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); failures++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function cdp(ws, method, params = {}) {
  const id = Math.floor(Math.random() * 1e6);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('CDP timeout: ' + method)), 20000);
    const onMsg = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id === id) {
        clearTimeout(timer);
        ws.removeEventListener('message', onMsg);
        resolve(msg.result);
      }
    };
    ws.addEventListener('message', onMsg);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

(async () => {
  const chromePath = CHROME_PATHS.find((p) => fs.existsSync(p));
  if (!chromePath) {
    console.log('\n  SKIP  no Chrome/Chromium found - cannot run the browser check\n');
    process.exit(0);
  }

  const health = await fetch(BASE + '/api/health').catch(() => null);
  if (!health || !health.ok) {
    console.log(`\n  Server not reachable at ${BASE}. Start it with:`);
    console.log('    TEXTBELT_API_KEY="" SMS_SIMULATE_FAILURE=1 PORT=3002 node server.js\n');
    process.exit(1);
  }

  console.log(`\n=== Confirmation screen when the text fails (${BASE}) ===`);

  const created = await (await fetch(BASE + '/api/games', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      location: 'Browser Test Court', courtNumber: '1', organizerName: 'Verify',
      organizerPlaying: false, date: '2030-02-20', time: '18:00', duration: 90,
      totalPlayers: 4, message: '', registrationMode: 'fcfs',
    }),
  })).json();
  const { gameId, hostToken } = created;
  console.log(`     test game ${gameId}`);

  const chrome = spawn(chromePath, [
    '--headless=new', `--remote-debugging-port=${DEBUG_PORT}`,
    '--no-first-run', '--no-default-browser-check',
    '--user-data-dir=/tmp/cdp-profile-inorout',
    'about:blank',
  ], { stdio: 'ignore' });

  let ws;
  try {
    await sleep(2500);
    const targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)).json();
    const page = targets.find((t) => t.type === 'page');
    ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((r) => ws.addEventListener('open', r, { once: true }));

    await cdp(ws, 'Page.enable');
    await cdp(ws, 'Runtime.enable');
    await cdp(ws, 'Page.navigate', { url: `${BASE}/game.html?id=${gameId}` });
    await sleep(3000);

    const evaluate = async (expression) => {
      const r = await cdp(ws, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300));
      return r.result.value;
    };

    // Tap IN with a phone number, exactly as a player would.
    await evaluate(`
      (() => {
        document.getElementById('playerName').value = 'Browser Player';
        document.getElementById('phoneNumber').value = '5550100077';
        document.getElementById('joinForm').dispatchEvent(new SubmitEvent('submit', {
          submitter: document.getElementById('joinButton'), cancelable: true, bubbles: true,
        }));
        return true;
      })()
    `);
    await sleep(3500);

    const screen = await evaluate(`
      (() => {
        const vis = (id) => {
          const el = document.getElementById(id);
          return el ? getComputedStyle(el).display !== 'none' : false;
        };
        return {
          confirmationVisible: vis('confirmationSection'),
          warningVisible: vis('smsWarning'),
          warningText: (document.getElementById('smsWarningText') || {}).textContent || '',
          nextStepsVisible: vis('nextStepsSection'),
          promisesAText: /receive a confirmation text message shortly/.test(document.body.innerText),
        };
      })()
    `);

    screen.confirmationVisible
      ? ok('the signup is still confirmed on screen (the spot was saved)')
      : bad('confirmation screen did not appear at all');

    screen.warningVisible
      ? ok('a visible warning tells the player the text did not go out')
      : bad('NO warning shown - the player is left waiting for a text that will never arrive');

    /couldn't send your confirmation text/.test(screen.warningText)
      ? ok(`warning text is specific: "${screen.warningText.slice(0, 60)}..."`)
      : bad(`warning text is not informative: "${screen.warningText}"`);

    !screen.promisesAText
      ? ok('the page no longer promises "a confirmation text message shortly"')
      : bad('the page STILL promises a confirmation text that is not coming');

    !screen.nextStepsVisible
      ? ok('the "What\'s Next?" text-based instructions are hidden')
      : bad('"What\'s Next?" still tells the player to reply to a text they never got');

  } finally {
    try { ws?.close(); } catch {}
    chrome.kill();
    await fetch(`${BASE}/api/games/${gameId}`, {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: hostToken, reason: 'Automated verification - test game' }),
    }).catch(() => {});
  }

  await require('./_cleanup').sweepLocalTestRows(BASE);

  console.log(`\n=== ${failures} failure(s) ===\n`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR:', e.message); process.exit(1); });
