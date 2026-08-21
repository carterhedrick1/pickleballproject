// The 400s, over real HTTP, through the real app.
//
// The unit tests next door prove the rules; this proves the routes actually reach them and
// that a caller's mistake comes back as 400 with the validator's sentence in it. Two of these
// used to be 500s recorded in the developer area's Errors tab as if the server had faulted:
// a manual add with no name, and a court name that could not be URL-decoded.
//
// Phone prefixes are unique per concern (555999xxxx here) so the SMS webhook's phone-based
// game lookups cannot collide with fixtures from the other HTTP test files sharing the local
// SQLite database.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../app');

let server;
let base;
let game;

/** Every game these tests create, so the after hook can take them all away again. */
const createdGames = [];

after(async () => {
  // These fixtures are dated 2099, and permanent deletion refuses a game still to be played -
  // so cancel first. Left behind, they turn up in the local court list and can move the counts
  // the browser smoke pins.
  for (const created of createdGames) {
    const asHost = { 'X-Host-Token': created.hostToken };
    await req('DELETE', `/api/games/${created.gameId}`, { reason: 'validation test cleanup' }, asHost);
    await req('DELETE', `/api/games/${created.gameId}/permanent`, null, asHost);
  }
  await new Promise((resolve) => server.close(resolve));
});

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

const gameBody = (overrides = {}) => ({
  location: 'Validation Court',
  organizerName: 'Val Host',
  organizerPlaying: false,
  date: '2099-11-04',
  time: '18:00',
  duration: 90,
  totalPlayers: 4,
  message: '',
  registrationMode: 'fcfs',
  ...overrides
});

before(async () => {
  const app = createApp({ production: false, textbeltSecret: 'validation-test-key' });
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;

  const created = await req('POST', '/api/games', gameBody());
  assert.equal(created.status, 201);
  game = created.json;
  createdGames.push(game);
});

describe('creating a game: caller errors answer 400', () => {
  it('still creates a well-formed game', async () => {
    const res = await req('POST', '/api/games', gameBody({ location: 'Second Court' }));
    assert.equal(res.status, 201);
    assert.equal(res.json.totalPlayers, 4);
    createdGames.push(res.json);
  });

  const refused = [
    ['a duration nothing can parse', { duration: 'soon' }, 'The duration in minutes must be a whole number.'],
    ['a date that does not exist', { date: '2099-02-30' }, 'The game date is not a real date.'],
    ['a date in the wrong shape', { date: '11/04/2099' }, 'The game date must be a date like 2026-08-21.'],
    ['a time no clock shows', { time: '25:00' }, 'The start time must be a time like 18:30.'],
    ['a negative player count', { totalPlayers: -4 }, 'The player count must be between 1 and 100.'],
    ['a registration mode nothing understands', { registrationMode: 'lottery' }, 'The registration mode must be one of: fcfs, waitlist.'],
    ['no court at all', { location: '   ' }, 'The court or location is required.'],
    ['an organizer phone that cannot receive a text', { organizerPhone: '312555' }, 'Please enter a valid US phone number for the organizer.']
  ];

  for (const [what, overrides, message] of refused) {
    it(`refuses ${what}`, async () => {
      const res = await req('POST', '/api/games', gameBody(overrides));
      assert.equal(res.status, 400);
      assert.equal(res.json.error, message);
    });
  }

  it('refuses a missing duration rather than storing NaN', async () => {
    const { duration, ...withoutDuration } = gameBody();
    const res = await req('POST', '/api/games', withoutDuration);
    assert.equal(res.status, 400);
    assert.equal(res.json.error, 'The duration in minutes is required.');
  });
});

describe('editing a game: caller errors answer 400 and change nothing', () => {
  it('refuses the edit and leaves the game as it was', async () => {
    const res = await req('PUT', `/api/games/${game.gameId}`, {
      token: game.hostToken,
      location: 'Validation Court',
      date: '2099-11-04',
      time: '18:00',
      duration: '',
      playersNeeded: '3'
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.error, 'The duration in minutes is required.');

    const after = await req('GET', `/api/games/${game.gameId}`, null, {
      'X-Host-Token': game.hostToken
    });
    assert.equal(after.json.duration, 90);
    assert.equal(after.json.totalPlayers, 4);
  });

  it('answers 403 before 400 when the caller is not the host', async () => {
    const res = await req('PUT', `/api/games/${game.gameId}`, {
      token: 'not-the-host',
      duration: 'soon'
    });
    assert.equal(res.status, 403);
  });

  it('accepts the same edit once the duration is a number', async () => {
    const res = await req('PUT', `/api/games/${game.gameId}`, {
      token: game.hostToken,
      duration: '120',
      playersNeeded: '3'
    });
    assert.equal(res.status, 200);

    const after = await req('GET', `/api/games/${game.gameId}`, null, {
      'X-Host-Token': game.hostToken
    });
    assert.equal(after.json.duration, 120);
  });
});

describe('player identity: the same answer whichever route asks', () => {
  it('refuses a signup with no name', async () => {
    const res = await req('POST', `/api/games/${game.gameId}/players`, {
      phone: '5559990001'
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.error, 'Player name is required.');
  });

  it('refuses the host’s manual add with no name — this used to be a 500', async () => {
    const res = await req('POST', `/api/games/${game.gameId}/manual-player`, {
      token: game.hostToken,
      phone: '5559990002'
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.error, 'Player name is required.');
  });

  it('refuses an unreachable phone number the same way on both routes', async () => {
    const message = 'Please enter a valid US phone number — for example 555-123-4567.';
    const signup = await req('POST', `/api/games/${game.gameId}/players`, {
      name: 'Short Number',
      phone: '312555'
    });
    assert.equal(signup.status, 400);
    assert.equal(signup.json.error, message);

    const manual = await req('POST', `/api/games/${game.gameId}/manual-player`, {
      token: game.hostToken,
      name: 'Short Number',
      phone: '312555'
    });
    assert.equal(manual.status, 400);
    assert.equal(manual.json.error, message);
  });

  it('keeps the status lookup wording a player reads', async () => {
    const res = await req('POST', `/api/games/${game.gameId}/player-status`, { phone: '312' });
    assert.equal(res.status, 400);
    assert.equal(res.json.error, 'A 10-digit phone number is required.');
  });
});

describe('lists: a string is not a list of people', () => {
  it('refuses recipients sent as a string instead of texting nobody', async () => {
    const res = await req('POST', `/api/games/${game.gameId}/announcement-individual`, {
      token: game.hostToken,
      message: 'Courts are wet',
      recipients: '5559990003'
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.error, 'The recipients must be a list.');
  });

  it('keeps the empty-selection wording the Communication tab shows', async () => {
    const res = await req('POST', `/api/games/${game.gameId}/announcement-individual`, {
      token: game.hostToken,
      message: 'Courts are wet',
      recipients: []
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.error, 'At least one recipient is required');
  });

  it('refuses invitees sent as a string instead of silently emptying the list', async () => {
    const res = await req('PUT', `/api/games/${game.gameId}/invitees`, {
      token: game.hostToken,
      playerPhones: '5559990004'
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.error, 'The intended invitees must be a list.');
  });

  it('refuses invitations sent as a string', async () => {
    const res = await req('POST', `/api/games/${game.gameId}/invitations`, {
      token: game.hostToken,
      playerPhones: '5559990005'
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.error, 'The people to invite must be a list.');
  });
});

describe('media metadata', () => {
  // No image was ever uploaded for these courts, so 404 is the answer that says the name
  // itself was read: the failure being tested for is a 500.
  it('reads a court name with a per-cent sign in it — this used to be a 500', async () => {
    const res = await fetch(`${base}/api/courts/${encodeURIComponent('50% Off Courts')}/image`);
    assert.equal(res.status, 404);
  });

  it('still reads a court name with a space in it', async () => {
    const res = await fetch(`${base}/api/courts/${encodeURIComponent('Validation Court')}/image`);
    assert.equal(res.status, 404);
  });

  it('leaves a genuinely malformed path to Express, which already answers 400', async () => {
    const res = await fetch(`${base}/api/courts/%E0%A4%A/image`);
    assert.equal(res.status, 400);
  });

  it('refuses a caption longer than the box allows instead of cutting it in half', async () => {
    const res = await fetch(
      `${base}/api/games/${game.gameId}/photos?caption=${'x'.repeat(201)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'image/png', 'X-Host-Token': game.hostToken },
        // A real PNG signature padded past the 12-byte sniff, so the image check is not
        // what refuses this.
        body: Buffer.concat([
          Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
          Buffer.alloc(8)
        ])
      }
    );
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, 'The caption can be up to 200 characters.');
  });
});
