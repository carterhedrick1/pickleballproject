// Real-HTTP tests against the real app, made possible by the createApp/startServer split:
// building the app starts no listener, no reminder timers, and no process handlers, so a
// test can bind it to an ephemeral port and drive the same stack production runs.
//
// Outbound SMS is simulated automatically here: with no DATABASE_URL set, the SMS client
// refuses to contact Textbelt (see services/sms-client.js localSafety), so these tests can
// exercise join/cancel flows without a single real text.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../app');
const { computeSignature } = require('../utils/textbelt-webhook');

const SECRET = 'integration-test-key';

let server;
let base;

before(async () => {
  const app = createApp({ production: false, textbeltSecret: SECRET });
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

async function req(method, path, body, headers = {}) {
  const res = await fetch(base + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json', ...headers } : headers,
    body: body ? JSON.stringify(body) : undefined
  });
  let json = null;
  try {
    json = await res.json();
  } catch {}
  return { status: res.status, json };
}

function signedWebhookHeaders(rawBody, { key = SECRET, ageSeconds = 0 } = {}) {
  const timestamp = String(Math.floor(Date.now() / 1000) - ageSeconds);
  return {
    'Content-Type': 'application/json',
    'X-textbelt-timestamp': timestamp,
    'X-textbelt-signature': computeSignature(key, timestamp, rawBody)
  };
}

async function postWebhook(body, options) {
  const rawBody = JSON.stringify(body);
  const res = await fetch(`${base}/api/sms/webhook`, {
    method: 'POST',
    headers: signedWebhookHeaders(rawBody, options),
    body: rawBody
  });
  let json = null;
  try {
    json = await res.json();
  } catch {}
  return { status: res.status, json };
}

const gameBody = (location) => ({
  location,
  organizerName: 'Gate Host',
  organizerPlaying: false,
  date: '2099-10-01',
  time: '18:00',
  duration: 90,
  totalPlayers: 4,
  message: '',
  registrationMode: 'fcfs'
});

describe('app over HTTP: health', () => {
  it('answers /api/health without any process-level startup', async () => {
    const res = await req('GET', '/api/health');
    assert.equal(res.status, 200);
    assert.equal(res.json.status, 'OK');
    assert.equal(res.json.database, 'SQLite');
  });
});

describe('app over HTTP: webhook signature gate', () => {
  it('rejects an unsigned webhook with 401', async () => {
    const res = await req('POST', '/api/sms/webhook', { fromNumber: '5559990001', text: '9' });
    assert.equal(res.status, 401);
  });

  it('rejects a webhook signed with the wrong key', async () => {
    const res = await postWebhook({ fromNumber: '5559990001', text: '9' }, { key: 'attacker-key' });
    assert.equal(res.status, 401);
  });

  it('rejects a correctly signed but stale webhook', async () => {
    const res = await postWebhook({ fromNumber: '5559990001', text: '9' }, { ageSeconds: 16 * 60 });
    assert.equal(res.status, 401);
  });

  it('accepts a correctly signed webhook and processes the reply', async () => {
    const res = await postWebhook({ fromNumber: '5559990001', text: 'hello', data: null });
    assert.equal(res.status, 200);
    assert.equal(res.json.success, true);
  });

  it('answers 400 for a signed but malformed payload', async () => {
    const res = await postWebhook({ nothing: 'useful' });
    assert.equal(res.status, 400);
  });
});

describe('app over HTTP: signup eligibility and authorization', () => {
  let cancelled; // { gameId, hostToken } - cancelled during the tests
  let ended; // { gameId, hostToken } - moved into the past during the tests

  before(async () => {
    cancelled = (await req('POST', '/api/games', gameBody('HTTP Gate Cancelled Court'))).json;
    ended = (await req('POST', '/api/games', gameBody('HTTP Gate Ended Court'))).json;
    assert.ok(cancelled.gameId && ended.gameId, 'fixture games were created');
  });

  after(async () => {
    // Both games are cancelled or past by now, which is what permanent deletion requires.
    await req('DELETE', `/api/games/${cancelled.gameId}/permanent`, { token: cancelled.hostToken });
    await req('DELETE', `/api/games/${ended.gameId}/permanent`, { token: ended.hostToken });
  });

  it('accepts a join while the game is open', async () => {
    const res = await req('POST', `/api/games/${cancelled.gameId}/players`, {
      name: 'Early Bird',
      phone: '5558880001'
    });
    assert.equal(res.status, 201);
    assert.equal(res.json.status, 'confirmed');
  });

  it('tags a duplicate join as duplicate rather than a plain failure', async () => {
    const res = await req('POST', `/api/games/${cancelled.gameId}/players`, {
      name: 'Early Bird',
      phone: '5558880001'
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.status, 'duplicate');
  });

  it('refuses to cancel a game for a caller without the host token', async () => {
    const res = await req('DELETE', `/api/games/${cancelled.gameId}`, {
      token: 'not-the-host',
      reason: 'should never work'
    });
    assert.equal(res.status, 403);
  });

  it('rejects joins with 410 once the host cancels the game', async () => {
    const cancel = await req('DELETE', `/api/games/${cancelled.gameId}`, {
      token: cancelled.hostToken,
      reason: 'integration test'
    });
    assert.equal(cancel.status, 200);

    const res = await req('POST', `/api/games/${cancelled.gameId}/players`, {
      name: 'Too Late',
      phone: '5558880002'
    });
    assert.equal(res.status, 410);
    assert.equal(res.json.status, 'game_cancelled');
  });

  it('still lets a player say OUT on a cancelled game', async () => {
    const res = await req('POST', `/api/games/${cancelled.gameId}/players`, {
      name: 'Early Bird',
      phone: '5558880001',
      action: 'out'
    });
    assert.equal(res.status, 201);
  });

  it('refuses a game edit for a caller without the host token', async () => {
    const res = await req('PUT', `/api/games/${ended.gameId}`, {
      token: 'not-the-host',
      date: '2020-01-15'
    });
    assert.equal(res.status, 403);
  });

  it('rejects joins with 410 once the game has ended', async () => {
    const past = await req('PUT', `/api/games/${ended.gameId}`, {
      token: ended.hostToken,
      date: '2020-01-15',
      time: '18:00',
      notifyPlayers: false
    });
    assert.equal(past.status, 200);

    const res = await req('POST', `/api/games/${ended.gameId}/players`, {
      name: 'Tardy',
      phone: '5558880003'
    });
    assert.equal(res.status, 410);
    assert.equal(res.json.status, 'game_ended');
  });

  it('still lets the host add a player to a finished game (roster correction)', async () => {
    const res = await req('POST', `/api/games/${ended.gameId}/manual-player`, {
      name: 'Recorded Later',
      phone: '5558880004',
      addTo: 'confirmed',
      token: ended.hostToken
    });
    assert.equal(res.status, 200);
  });

  it('refuses the manual add without the host token', async () => {
    const res = await req('POST', `/api/games/${ended.gameId}/manual-player`, {
      name: 'Intruder',
      phone: '5558880005',
      addTo: 'confirmed',
      token: 'not-the-host'
    });
    assert.equal(res.status, 403);
  });
});
