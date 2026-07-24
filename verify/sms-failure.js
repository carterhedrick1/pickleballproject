// SMS failure visibility verification.
// Usage: node sms-failure.js [baseUrl]
//
// The bug this pins down: when Textbelt failed on a join or an "I'm out", the database write
// still succeeded and the player was told nothing. The confirmation screen promised "You'll
// receive a confirmation text message shortly" and then no text ever arrived, which is exactly
// the "it just doesn't work sometimes" feeling. There was also no retry, so a single blip lost
// the text for good.
//
// NOTHING here can send a real text, for two independent reasons:
//   1. The server must be started with SMS_SIMULATE_FAILURE=1, which returns a failure from
//      sendSMS before any Textbelt request is built.
//   2. It must also be started with TEXTBELT_API_KEY="", so if the flag above were ever
//      forgotten, sendSMS falls into dev mode and still contacts nobody - and this script
//      fails loudly rather than quietly texting someone.
//
//   TEXTBELT_API_KEY="" SMS_SIMULATE_FAILURE=1 PORT=3002 node server.js
//   npm run verify:sms-failure

const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const BASE = process.argv[2] || 'http://localhost:3002';

// Unlike the other verify scripts, this one signs players up WITH phone numbers - it has to,
// because it is testing what happens when a text fails. That is only safe against a server
// started with SMS_SIMULATE_FAILURE=1. Pointed at production it would ask Textbelt to text
// those numbers for real, so refuse to run anywhere but a local server.
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(BASE)) {
  console.error(`\n  REFUSING to run against ${BASE}.`);
  console.error('  This script uses real phone numbers and is only safe against a local server');
  console.error('  started with SMS_SIMULATE_FAILURE=1.\n');
  process.exit(1);
}

let failures = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); failures++; };

async function req(method, p, body) {
  const res = await fetch(BASE + p, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text };
}

// ---------------------------------------------------------------------------
// Part A: retry policy, in-process. global fetch is stubbed, so no request ever
// leaves this process regardless of what is in .env.
// ---------------------------------------------------------------------------
async function retryPolicyChecks() {
  console.log('\n=== A: retry policy (in-process, fetch stubbed - no network) ===');

  delete process.env.SMS_SIMULATE_FAILURE;      // exercise the real code path
  process.env.TEXTBELT_API_KEY = 'stub-key';    // so sendSMS does not take the dev-mode branch

  const { sendSMSWithRetry } = require(ROOT + '/sms-handler');

  const realFetch = globalThis.fetch;
  let calls = 0;
  const stub = (responses) => {
    calls = 0;
    globalThis.fetch = async () => {
      const body = responses[Math.min(calls, responses.length - 1)];
      calls++;
      return { json: async () => body };
    };
  };

  // A transient failure should be retried exactly once.
  stub([{ success: false, error: 'Temporarily unavailable' }]);
  let r = await sendSMSWithRetry('+15550100001', 'test', null, { delayMs: 5 });
  calls === 2 && r.success === false
    ? ok(`transient failure retried once (${calls} attempts, still failed)`)
    : bad(`transient failure made ${calls} attempt(s), expected 2`);

  // A retry that succeeds is the whole point: the user gets their text after a blip.
  stub([{ success: false, error: 'Temporarily unavailable' }, { success: true, textId: 'abc' }]);
  r = await sendSMSWithRetry('+15550100002', 'test', null, { delayMs: 5 });
  calls === 2 && r.success === true
    ? ok('a blip followed by success delivers the text (recovered on retry)')
    : bad(`retry did not recover: ${calls} attempts, success=${r.success}`);

  // Permanent errors must NOT be retried - it cannot help and delays telling the user.
  for (const err of ['Out of quota', 'Invalid phone number']) {
    stub([{ success: false, error: err }]);
    r = await sendSMSWithRetry('+15550100003', 'test', null, { delayMs: 5 });
    calls === 1 && r.permanent === true
      ? ok(`"${err}" not retried (1 attempt, flagged permanent)`)
      : bad(`"${err}" made ${calls} attempt(s), permanent=${r.permanent}, expected 1 and true`);
  }

  // The happy path must not have become slower or chattier.
  stub([{ success: true, textId: 'xyz' }]);
  r = await sendSMSWithRetry('+15550100004', 'test', null, { delayMs: 5 });
  calls === 1 && r.success === true
    ? ok('successful send still takes exactly 1 attempt')
    : bad(`successful send made ${calls} attempt(s), expected 1`);

  globalThis.fetch = realFetch;
  delete process.env.TEXTBELT_API_KEY;
}

// ---------------------------------------------------------------------------
// Part B: what a real user's request actually returns when the text fails.
// ---------------------------------------------------------------------------
(async () => {
  await retryPolicyChecks();

  console.log(`\n=== B: user-facing actions against ${BASE} ===`);

  const health = await req('GET', '/api/health');
  if (health.status !== 200) {
    console.log(`\n  Server not reachable at ${BASE}. Start it with:`);
    console.log('    TEXTBELT_API_KEY="" SMS_SIMULATE_FAILURE=1 PORT=3002 node server.js\n');
    process.exit(1);
  }

  const create = await req('POST', '/api/games', {
    location: 'Test Court', courtNumber: '1', organizerName: 'Verify Host',
    organizerPlaying: false, date: '2030-01-15', time: '18:00', duration: 90,
    totalPlayers: 4, message: 'SMS failure verification', registrationMode: 'fcfs',
  });
  if (create.status !== 201) {
    bad(`could not create test game: HTTP ${create.status} ${create.text.slice(0, 160)}`);
    process.exit(1);
  }
  const { gameId, hostToken } = create.json;
  console.log(`     test game ${gameId}`);

  console.log('\n  Joining with a phone number, while every text is failing:');
  const join = await req('POST', `/api/games/${gameId}/players`, {
    name: 'Failing Phone', phone: '5550100011',
  });

  join.status === 201
    ? ok('the signup itself still succeeds (HTTP 201)')
    : bad(`signup returned HTTP ${join.status}`);

  // This is the heart of it: the client is told the text failed, so the page can say so.
  join.json?.sms && join.json.sms.success === false
    ? ok(`response reports the SMS failure (sms.success=false, error="${join.json.sms.error}")`)
    : bad(`response did not report an SMS failure: sms=${JSON.stringify(join.json?.sms)}`);

  join.json?.sms?.attempts === 2
    ? ok('the failed text was retried once before giving up (attempts=2)')
    : bad(`expected 2 attempts, got ${join.json?.sms?.attempts}`);

  const after = await req('GET', `/api/games/${gameId}`);
  (after.json?.players || []).some((p) => p.name === 'Failing Phone')
    ? ok('the player is on the roster despite the failed text (no data lost)')
    : bad('player is missing from the roster - the failed text lost the signup');

  console.log('\n  Tapping "I\'m out", while every text is failing:');
  const out = await req('POST', `/api/games/${gameId}/players`, {
    name: 'Out Person', phone: '5550100012', action: 'out',
  });

  out.status === 201 ? ok('the "out" response is recorded (HTTP 201)') : bad(`out returned HTTP ${out.status}`);
  out.json?.sms && out.json.sms.success === false
    ? ok('response reports the SMS failure')
    : bad(`out did not report an SMS failure: sms=${JSON.stringify(out.json?.sms)}`);
  out.json?.sms?.attempts === 2
    ? ok('the failed text was retried once (attempts=2)')
    : bad(`expected 2 attempts, got ${out.json?.sms?.attempts}`);

  const afterOut = await req('GET', `/api/games/${gameId}`);
  (afterOut.json?.outPlayers || []).some((p) => p.name === 'Out Person')
    ? ok('the "out" is on the list despite the failed text')
    : bad('the "out" response was lost');

  console.log('\n  Joining without a phone number:');
  const noPhone = await req('POST', `/api/games/${gameId}/players`, { name: 'No Phone' });
  noPhone.json?.sms === null
    ? ok('sms is null, so the page knows not to promise a text')
    : bad(`expected sms null for a player with no phone, got ${JSON.stringify(noPhone.json?.sms)}`);

  console.log('\n  Cleaning up');
  const del = await req('DELETE', `/api/games/${gameId}`, {
    token: hostToken, reason: 'Automated verification - test game',
  });
  del.status === 200 ? ok('test game cancelled') : bad(`cleanup failed HTTP ${del.status}, game ${gameId} left behind`);

  console.log(`\n=== ${failures} failure(s) ===\n`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR:', e); process.exit(1); });
