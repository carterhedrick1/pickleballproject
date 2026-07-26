// Publishes the generated documentation pages into the running app, so the
// developer area's Screens tab shows the app as it is right now.
//
//   npm run docs                    build the pages first
//   npm run docs:publish            push them to https://inorout.club
//   npm run docs:publish -- --local push them to a local server on port 3002
//
// The pages are stored in the database rather than committed, because screens.html
// is several megabytes of inlined screenshots and Render gives the app no disk.

const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
require('dotenv').config({ path: path.join(ROOT, '.env') });

const PAGES = [
  { name: 'screens', file: 'docs/screens.html', label: 'Actual Screens' },
  { name: 'containers', file: 'docs/containers.html', label: 'Panel View' },
  { name: 'copy-deck', file: 'docs/copy-deck.html', label: 'Copy Deck' }
];

const args = process.argv.slice(2);
const isLocal = args.includes('--local');
const explicitBase = args.find((a) => a.startsWith('http'));
const BASE = explicitBase || (isLocal ? 'http://localhost:3002' : 'https://inorout.club');
const PASSWORD = process.env.DEV_PASSWORD || 'vibe123';

(async () => {
  const screensPath = path.join(ROOT, 'docs/screens.html');
  if (!fs.existsSync(screensPath)) {
    console.error('docs/screens.html does not exist yet. Run `npm run docs` first.');
    process.exit(1);
  }

  console.log(`Publishing to ${BASE}\n`);
  let published = 0;
  let failed = 0;

  for (const page of PAGES) {
    const fullPath = path.join(ROOT, page.file);
    if (!fs.existsSync(fullPath)) {
      console.log(`- ${page.label.padEnd(16)} skipped (${page.file} not built)`);
      continue;
    }

    const content = fs.readFileSync(fullPath, 'utf8');
    const sizeMb = (content.length / 1024 / 1024).toFixed(1);

    try {
      const response = await fetch(`${BASE}/api/dev/assets/${page.name}`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/html', 'X-Dev-Password': PASSWORD },
        body: content
      });

      if (response.ok) {
        console.log(`✓ ${page.label.padEnd(16)} published (${sizeMb} MB)`);
        published++;
      } else {
        const body = await response.text();
        console.error(`✗ ${page.label.padEnd(16)} failed - HTTP ${response.status} ${body.slice(0, 200)}`);
        if (response.status === 401) {
          console.error('  The server did not accept DEV_PASSWORD. Check .env and the Render environment.');
        }
        failed++;
      }
    } catch (err) {
      console.error(`✗ ${page.label.padEnd(16)} failed - ${err.message}`);
      if (isLocal) console.error('  Is the app running? Try `PORT=3002 npm start` in another terminal.');
      failed++;
    }
  }

  console.log(`\n${published} page(s) published${failed ? `, ${failed} failed` : ''}.`);
  if (published) console.log(`View them at ${BASE}/dev.html (Screens tab).`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
