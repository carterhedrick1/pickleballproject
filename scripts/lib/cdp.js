// Minimal Chrome DevTools Protocol client, used by capture-screens.js.
//
// Why not Puppeteer: it would add a dependency (and a second Chromium download) to take a few
// screenshots. Node has had a global WebSocket since v22 and Chrome ships a debugging port, so
// the whole client is the sixty lines below. Nothing here is general-purpose - it does exactly
// what the screenshot script needs and nothing else.

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);

function findChrome() {
  for (const p of CHROME_CANDIDATES) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error(
    'Could not find Chrome. Set CHROME_PATH to the browser binary, e.g.\n' +
    '  CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" npm run docs:screens'
  );
}

class Browser {
  constructor(proc, ws, profileDir) {
    this.proc = proc;
    this.ws = ws;
    this.profileDir = profileDir;
    this.nextId = 0;
    this.pending = new Map();
    this.events = [];
    ws.addEventListener('message', (e) => {
      const msg = JSON.parse(e.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(msg.method + ': ' + JSON.stringify(msg.error))) : resolve(msg.result);
      } else if (msg.method) {
        this.events.push(msg);
      }
    });
  }

  send(method, params = {}, sessionId) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
    });
  }

  async waitForEvent(method, sessionId, timeoutMs = 15000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const i = this.events.findIndex((e) => e.method === method && (!sessionId || e.sessionId === sessionId));
      if (i > -1) return this.events.splice(i, 1)[0];
      await sleep(40);
    }
    return null; // callers treat a missed load event as "carry on after the settle delay"
  }

  /** Opens a tab at the given viewport and returns a small handle for it. */
  async newPage({ width, height = 1000, deviceScaleFactor = 1, mobile = false }) {
    const { targetId } = await this.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await this.send('Target.attachToTarget', { targetId, flatten: true });
    await this.send('Page.enable', {}, sessionId);
    await this.send('Runtime.enable', {}, sessionId);
    await this.send('Emulation.setDeviceMetricsOverride',
      { width, height, deviceScaleFactor, mobile }, sessionId);

    const browser = this;
    return {
      async goto(url, { settleMs = 1400 } = {}) {
        await browser.send('Page.navigate', { url }, sessionId);
        await browser.waitForEvent('Page.loadEventFired', sessionId);
        await sleep(settleMs);
      },
      /** Runs JS in the page. Throws if the page threw, so a broken step fails loudly. */
      async evaluate(expression) {
        const res = await browser.send('Runtime.evaluate',
          { expression, returnByValue: true, awaitPromise: true }, sessionId);
        if (res.exceptionDetails) {
          throw new Error('page threw: ' + (res.exceptionDetails.exception?.description
            || res.exceptionDetails.text));
        }
        return res.result?.value;
      },
      async size() {
        return this.evaluate(
          '[document.documentElement.scrollWidth, document.documentElement.scrollHeight]');
      },
      /** WebP beats JPEG by roughly 2x on these flat, text-heavy pages. */
      async screenshot({ format = 'webp', quality = 70 } = {}) {
        const { data } = await browser.send('Page.captureScreenshot',
          { format, quality, captureBeyondViewport: true }, sessionId);
        return Buffer.from(data, 'base64');
      },
      close() {
        return browser.send('Target.closeTarget', { targetId });
      },
    };
  }

  async close() {
    try { this.ws.close(); } catch {}
    try { this.proc.kill(); } catch {}
    await sleep(200);
    try { fs.rmSync(this.profileDir, { recursive: true, force: true }); } catch {}
  }
}

/** Launches headless Chrome on a private profile and connects to it. */
async function launch({ port = 9222 } = {}) {
  const binary = findChrome();
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inorout-shots-'));
  const proc = spawn(binary, [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--hide-scrollbars',
    'about:blank',
  ], { stdio: 'ignore' });

  for (let i = 0; i < 60; i++) {
    await sleep(250);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      const info = await res.json();
      const ws = new WebSocket(info.webSocketDebuggerUrl);
      await new Promise((resolve, reject) => {
        ws.addEventListener('open', resolve);
        ws.addEventListener('error', reject);
      });
      return new Browser(proc, ws, profileDir);
    } catch { /* not up yet */ }
  }
  try { proc.kill(); } catch {}
  throw new Error(`Chrome did not open a debugging port on ${port} within 15s`);
}

module.exports = { launch, findChrome, sleep };
