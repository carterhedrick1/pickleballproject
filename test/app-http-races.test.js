// Gate versions of the race rigs (verify/signup-race.js, capacity-race.js, mixed-race.js)
// and the SMS "reply 9" cancellation flow (verify/sms-cancel.js) - the behaviors that used
// to be checked only when somebody remembered to run them by hand. They drive the real app
// over HTTP on an ephemeral port; outbound SMS is simulated (no DATABASE_URL).
//
// Phone prefixes are unique per concern (555666xxxx here) so the SMS webhook's
// phone-based game lookups cannot collide with fixtures from other test files sharing the
// local SQLite database.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../app');
const { computeSignature } = require('../utils/textbelt-webhook');

const SECRET = 'race-test-key';

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

async function signedWebhook(fromNumber, text, gameId = null) {
  const rawBody = JSON.stringify({ fromNumber, text, data: gameId });
  const timestamp = String(Math.floor(Date.now() / 1000));
  return fetch(`${base}/api/sms/webhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-textbelt-timestamp': timestamp,
      'X-textbelt-signature': computeSignature(SECRET, timestamp, rawBody)
    },
    body: rawBody
  });
}

const gameBody = (location, totalPlayers) => ({
  location,
  organizerName: 'Race Host',
  organizerPlaying: false,
  date: '2099-11-01',
  time: '18:00',
  duration: 90,
  totalPlayers,
  message: '',
  registrationMode: 'fcfs'
});

async function createGame(location, totalPlayers) {
  const created = await req('POST', '/api/games', gameBody(location, totalPlayers));
  assert.equal(created.status, 201);
  return created.json;
}

async function readGame(fixture) {
  const res = await req('GET', `/api/games/${fixture.gameId}`, null, {
    'X-Host-Token': fixture.hostToken
  });
  assert.equal(res.status, 200);
  return res.json;
}

async function destroyGame(fixture) {
  await req('DELETE', `/api/games/${fixture.gameId}`, {
    token: fixture.hostToken,
    reason: 'race test cleanup'
  });
  await req('DELETE', `/api/games/${fixture.gameId}/permanent`, { token: fixture.hostToken });
}

describe('concurrent player mutations cannot lose roster changes', () => {
  it('accepts every simultaneous signup below capacity, none vanish', async () => {
    const fixture = await createGame('Gate Race Court', 12);
    try {
      const names = Array.from({ length: 6 }, (_, i) => `Racer${i + 1}`);
      const results = await Promise.all(
        names.map((name) => req('POST', `/api/games/${fixture.gameId}/players`, { name }))
      );
      assert.deepEqual(results.map((r) => r.status), [201, 201, 201, 201, 201, 201]);

      const game = await readGame(fixture);
      const roster = game.players.map((p) => p.name);
      for (const name of names) {
        assert.ok(roster.includes(name), `${name} was told they were in but is not on the roster`);
      }
    } finally {
      await destroyGame(fixture);
    }
  });

  it('fills exactly to capacity under simultaneous pressure, overflow waitlists', async () => {
    const fixture = await createGame('Gate Capacity Court', 4);
    try {
      const results = await Promise.all(
        Array.from({ length: 12 }, (_, i) =>
          req('POST', `/api/games/${fixture.gameId}/players`, {
            name: `Crowd${i + 1}`,
            phone: `55566610${String(i + 1).padStart(2, '0')}`
          })
        )
      );
      const outcomes = results.map((r) => `${r.status}:${r.json?.status || JSON.stringify(r.json)}`);
      const confirmed = results.filter((r) => r.json?.status === 'confirmed').length;
      const waitlisted = results.filter((r) => r.json?.status === 'waitlist').length;
      assert.equal(confirmed, 4, `exactly capacity confirmed (${outcomes.join(' | ')})`);
      assert.equal(waitlisted, 8, `everyone else waitlisted (${outcomes.join(' | ')})`);

      const game = await readGame(fixture);
      assert.equal(game.players.length, 4);
      assert.equal(game.waitlist.length, 8);
      const phones = [...game.players, ...game.waitlist].map((p) => p.phone);
      assert.equal(new Set(phones).size, phones.length, 'nobody appears twice');
    } finally {
      await destroyGame(fixture);
    }
  });

  it('keeps the roster consistent when joins and leaves overlap', async () => {
    const fixture = await createGame('Gate Mixed Court', 4);
    try {
      for (let i = 1; i <= 4; i++) {
        await req('POST', `/api/games/${fixture.gameId}/players`, {
          name: `Seed${i}`,
          phone: `555666200${i}`
        });
      }
      // Two confirmed players tap OUT at the same moment three newcomers tap IN.
      await Promise.all([
        req('POST', `/api/games/${fixture.gameId}/players`, {
          name: 'Seed1', phone: '5556662001', action: 'out'
        }),
        req('POST', `/api/games/${fixture.gameId}/players`, {
          name: 'Seed2', phone: '5556662002', action: 'out'
        }),
        req('POST', `/api/games/${fixture.gameId}/players`, { name: 'New1', phone: '5556662101' }),
        req('POST', `/api/games/${fixture.gameId}/players`, { name: 'New2', phone: '5556662102' }),
        req('POST', `/api/games/${fixture.gameId}/players`, { name: 'New3', phone: '5556662103' })
      ]);

      const game = await readGame(fixture);
      assert.ok(game.players.length <= 4, `roster ${game.players.length} exceeds capacity`);
      const phones = [...game.players, ...(game.waitlist || [])].map((p) => p.phone);
      assert.equal(new Set(phones).size, phones.length, 'nobody appears twice');
      const rosterPhones = game.players.map((p) => p.phone);
      assert.ok(!rosterPhones.includes('5556662001'), 'Seed1 is off the roster');
      assert.ok(!rosterPhones.includes('5556662002'), 'Seed2 is off the roster');
      // 2 remaining seeds + 3 newcomers = 5 people for 4 spots: the game must end full.
      assert.equal(game.players.length, 4, 'open spots were refilled');
    } finally {
      await destroyGame(fixture);
    }
  });
});

describe('SMS reply 9 cancels through the signed webhook', () => {
  it('cancels the sender, promotes the waitlist, and a repeat 9 changes nothing', async () => {
    const fixture = await createGame('Gate SMS Cancel Court', 2);
    try {
      await req('POST', `/api/games/${fixture.gameId}/players`, { name: 'Alpha', phone: '5556663001' });
      await req('POST', `/api/games/${fixture.gameId}/players`, { name: 'Bravo', phone: '5556663002' });
      await req('POST', `/api/games/${fixture.gameId}/players`, { name: 'Waiting', phone: '5556663003' });

      let game = await readGame(fixture);
      assert.deepEqual(game.players.map((p) => p.name), ['Alpha', 'Bravo']);
      assert.deepEqual(game.waitlist.map((p) => p.name), ['Waiting']);

      const reply = await signedWebhook('5556663001', '9', fixture.gameId);
      assert.equal(reply.status, 200);

      game = await readGame(fixture);
      assert.ok(!game.players.some((p) => p.name === 'Alpha'), 'Alpha was cancelled');
      assert.ok(game.players.some((p) => p.name === 'Waiting'), 'Waiting was promoted');
      assert.equal(game.players.length, 2, 'game is full again');
      assert.equal(game.waitlist.length, 0);

      // The dangerous repeat: a second 9 from someone already gone must not splice
      // somebody else off the roster.
      const before = game.players.map((p) => p.name).join(',');
      await signedWebhook('5556663001', '9', fixture.gameId);
      game = await readGame(fixture);
      assert.equal(game.players.map((p) => p.name).join(','), before, 'repeat 9 changed nothing');
    } finally {
      await destroyGame(fixture);
    }
  });
});
