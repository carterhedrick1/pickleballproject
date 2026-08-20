// Proves the SMS webhook rejects anything Textbelt did not sign.
//
// Unlike sms-cancel.js, the server under test must run WITH a TEXTBELT_API_KEY set (any
// value), and this rig must run with the same value so it can sign like Textbelt does.
// Outbound texts stay simulated as long as the server has no DATABASE_URL.
//
//   TEXTBELT_API_KEY=test-key PORT=3902 npm start        # server terminal
//   TEXTBELT_API_KEY=test-key node verify/webhook-auth.js http://localhost:3902
const { computeSignature } = require('../utils/textbelt-webhook');

const BASE = process.argv[2] || 'http://localhost:3002';
const KEY = process.env.TEXTBELT_API_KEY;

if (!KEY) {
  console.error('Set TEXTBELT_API_KEY to the same value the server under test uses.');
  process.exit(1);
}

let failures = 0;
const check = (cond, msg) => { console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) failures++; };

async function post(body, { sign = true, key = KEY, ageSeconds = 0, headers = {} } = {}) {
  const rawBody = typeof body === 'string' ? body : JSON.stringify(body);
  const allHeaders = { 'Content-Type': 'application/json', ...headers };
  if (sign) {
    const timestamp = String(Math.floor(Date.now() / 1000) - ageSeconds);
    allHeaders['X-textbelt-timestamp'] = timestamp;
    allHeaders['X-textbelt-signature'] = computeSignature(key, timestamp, rawBody);
  }
  const res = await fetch(`${BASE}/api/sms/webhook`, { method: 'POST', headers: allHeaders, body: rawBody });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json };
}

(async () => {
  const payload = { fromNumber: '5559990001', text: 'hello', data: null };

  const unsigned = await post(payload, { sign: false });
  check(unsigned.status === 401, `unsigned webhook rejected with 401 (got ${unsigned.status})`);

  const wrongKey = await post(payload, { key: 'not-the-real-key' });
  check(wrongKey.status === 401, `wrongly signed webhook rejected with 401 (got ${wrongKey.status})`);

  const stale = await post(payload, { ageSeconds: 16 * 60 });
  check(stale.status === 401, `stale-timestamp webhook rejected with 401 (got ${stale.status})`);

  const valid = await post(payload);
  check(valid.status === 200 && valid.json?.success === true,
    `correctly signed webhook accepted (got ${valid.status})`);

  // Signed but nonsense payload: authentication passes, validation answers 400.
  const malformed = await post({ nothing: 'useful' });
  check(malformed.status === 400, `signed but malformed payload rejected with 400 (got ${malformed.status})`);

  console.log(`\n=== ${failures} failure(s) ===\n`);
  process.exit(failures ? 1 : 0);
})();
