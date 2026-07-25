// Checks the Textbelt quota and records it, so an unexpected drop is visible.
//
//   npm run quota
//
// Textbelt has no self-service key rotation, so if a key is exposed the practical defence is
// noticing usage you did not cause. Every check is appended to .textbelt-quota-log (git-ignored)
// and compared against the previous one.

const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
require('dotenv').config({ path: path.join(ROOT, '.env') });

const LOG = path.join(ROOT, '.textbelt-quota-log');
const KEY = process.env.TEXTBELT_API_KEY;

(async () => {
  if (!KEY) { console.error('TEXTBELT_API_KEY is not set in .env'); process.exit(1); }

  const res = await fetch(`https://textbelt.com/quota/${KEY}`);
  const body = await res.json();
  if (!body.success) {
    console.error('Textbelt rejected the quota check:', JSON.stringify(body));
    process.exit(1);
  }

  const now = body.quotaRemaining;
  // Identify the key by a short fingerprint rather than storing the key itself.
  const fingerprint = `${KEY.slice(0, 4)}..${KEY.slice(-4)}`;

  let previous = null;
  if (fs.existsSync(LOG)) {
    const lines = fs.readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean);
    const lastSameKey = [...lines].reverse().find((l) => l.includes(fingerprint));
    if (lastSameKey) {
      const m = lastSameKey.match(/quota=(\d+)/);
      if (m) previous = { value: parseInt(m[1], 10), line: lastSameKey };
    }
  }

  const stamp = new Date().toISOString();
  fs.appendFileSync(LOG, `${stamp} key=${fingerprint} quota=${now}\n`);

  console.log(`Textbelt quota: ${now}   (key ${fingerprint})`);

  if (previous === null) {
    console.log('No previous reading for this key - baseline recorded.');
    return;
  }

  const used = previous.value - now;
  if (used === 0) {
    console.log(`Unchanged since last check (${previous.line.slice(0, 19)}). Nothing sent.`);
  } else if (used > 0) {
    console.log(`${used} text(s) sent since ${previous.line.slice(0, 19)}.`);
    console.log('If you did not expect that, treat the key as being used by someone else.');
  } else {
    console.log(`Quota went UP by ${-used} - credits were added, or this is a different key.`);
  }
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
