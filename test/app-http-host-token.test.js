// Every route a host can act on, driven with the token in the X-Host-Token header and with
// nothing in the body.
//
// The management page used to prove it was the host in two different ways depending on which
// button was pressed: GET and DELETE calls sent the header, while the POST and PUT calls put
// `token` in the JSON body. The routes matched that split - ten of them read `req.body.token`
// directly - so moving the page onto one shared API client meant those ten had to accept the
// header first. They all read requestHostToken now, which still accepts the body and query
// forms, so old clients and the SMS links keep working; these tests pin the header half, and
// the last case pins the body half so the compatibility is not quietly lost later.
//
// Phone prefixes are unique per concern (555222xxxx here) so the SMS webhook's phone-based
// lookups cannot collide with fixtures from the other HTTP test files sharing the local
// SQLite database.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../app');

let server;
let base;
let game;

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
  location: 'Host Token Court',
  organizerName: 'Header Host',
  organizerPlaying: false,
  date: '2099-12-01',
  time: '18:00',
  duration: 90,
  totalPlayers: 6,
  message: '',
  registrationMode: 'fcfs',
  ...overrides
});

before(async () => {
  const app = createApp({ production: false, textbeltSecret: 'host-token-test-key' });
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;

  const created = await req('POST', '/api/games', gameBody());
  assert.equal(created.status, 201);
  game = created.json;
});

after(async () => {
  // Cancel first: permanent deletion refuses a game that is still to be played, and these
  // fixtures are dated 2099. Left behind, they turn up in the local court list and can move
  // the counts the browser smoke pins.
  if (game) {
    await req('DELETE', `/api/games/${game.gameId}`, { reason: 'host token test cleanup' }, asHost());
    await req('DELETE', `/api/games/${game.gameId}/permanent`, null, asHost());
  }
  await new Promise((resolve) => server.close(resolve));
});

/** The header the shared API client sends on every management call. */
const asHost = () => ({ 'X-Host-Token': game.hostToken });
const asStranger = () => ({ 'X-Host-Token': 'not-the-host' });

describe('host routes accept the token in the header', () => {
  it('edits the game', async () => {
    const res = await req('PUT', `/api/games/${game.gameId}`, { duration: 120 }, asHost());
    assert.equal(res.status, 200);

    const after = await req('GET', `/api/games/${game.gameId}`, null, asHost());
    assert.equal(after.json.duration, 120);
  });

  it('saves the host notes', async () => {
    const res = await req(
      'PUT',
      `/api/games/${game.gameId}/notes`,
      { hostNotes: 'gate code 4417' },
      asHost()
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.hostNotes, 'gate code 4417');
  });

  it('builds the invitation message', async () => {
    const res = await req('POST', `/api/games/${game.gameId}/invitation-message`, {}, asHost());
    assert.equal(res.status, 200);
    assert.equal(typeof res.json.message, 'string');
  });

  it('saves the intended invitees', async () => {
    const res = await req(
      'PUT',
      `/api/games/${game.gameId}/invitees`,
      { playerPhones: [] },
      asHost()
    );
    assert.equal(res.status, 200);
    assert.deepEqual(res.json.intendedInvitees, []);
  });

  it('adds a player by hand', async () => {
    const res = await req(
      'POST',
      `/api/games/${game.gameId}/manual-player`,
      { name: 'Header Added', phone: '5552220001' },
      asHost()
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.success, true);
  });

  it('moves that player to the waitlist and back', async () => {
    const roster = await req('GET', `/api/games/${game.gameId}`, null, asHost());
    const player = roster.json.players.find((entry) => entry.name === 'Header Added');
    assert.ok(player, 'the manually added player should be on the roster');

    const demoted = await req(
      'POST',
      `/api/games/${game.gameId}/move-to-waitlist/${player.id}`,
      {},
      asHost()
    );
    assert.equal(demoted.status, 200);

    const promoted = await req(
      'POST',
      `/api/games/${game.gameId}/promote-from-waitlist/${player.id}`,
      {},
      asHost()
    );
    assert.equal(promoted.status, 200);
  });

  it('sends an announcement', async () => {
    const roster = await req('GET', `/api/games/${game.gameId}`, null, asHost());
    const player = roster.json.players.find((entry) => entry.name === 'Header Added');

    const res = await req(
      'POST',
      `/api/games/${game.gameId}/announcement-individual`,
      { message: 'Courts are wet', recipients: [{ phone: player.phone, name: player.name }] },
      asHost()
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.success, true);
  });

  it('texts invitations', async () => {
    // Nobody on this host's saved roster, so the route refuses on the roster rule rather than
    // on authorization - which is exactly what proves the header was accepted.
    const res = await req(
      'POST',
      `/api/games/${game.gameId}/invitations`,
      { playerPhones: ['5552220009'] },
      asHost()
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.error, 'Every invitation must go to somebody on your saved roster.');
  });

  it('removes a player', async () => {
    const roster = await req('GET', `/api/games/${game.gameId}`, null, asHost());
    const player = roster.json.players.find((entry) => entry.name === 'Header Added');

    const res = await req(
      'DELETE',
      `/api/games/${game.gameId}/players/${player.id}`,
      null,
      asHost()
    );
    assert.equal(res.status, 200);
  });

  it('cancels the game', async () => {
    const scratch = await req('POST', '/api/games', gameBody({ location: 'Cancel Me' }));
    const res = await req(
      'DELETE',
      `/api/games/${scratch.json.gameId}`,
      { reason: 'rain' },
      { 'X-Host-Token': scratch.json.hostToken }
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.success, true);

    await req('DELETE', `/api/games/${scratch.json.gameId}/permanent`, null, {
      'X-Host-Token': scratch.json.hostToken
    });
  });
});

describe('the same routes still refuse a stranger holding the header', () => {
  const refused = [
    ['PUT', (id) => `/api/games/${id}`, { duration: 60 }],
    ['PUT', (id) => `/api/games/${id}/notes`, { hostNotes: 'nope' }],
    ['POST', (id) => `/api/games/${id}/invitation-message`, {}],
    ['PUT', (id) => `/api/games/${id}/invitees`, { playerPhones: [] }],
    ['POST', (id) => `/api/games/${id}/manual-player`, { name: 'Intruder', phone: '5552220002' }],
    ['POST', (id) => `/api/games/${id}/announcement-individual`, { message: 'hi', recipients: [{ phone: '5552220003' }] }],
    ['POST', (id) => `/api/games/${id}/invitations`, { playerPhones: ['5552220004'] }],
    ['DELETE', (id) => `/api/games/${id}`, { reason: 'nope' }],
    ['DELETE', (id) => `/api/games/${id}/permanent`, {}]
  ];

  for (const [method, path, body] of refused) {
    it(`${method} ${path('<id>')}`, async () => {
      const res = await req(method, path(game.gameId), body, asStranger());
      assert.equal(res.status, 403);
    });
  }

  it('refuses a caller with no token at all', async () => {
    const res = await req('PUT', `/api/games/${game.gameId}`, { duration: 60 });
    assert.equal(res.status, 403);
  });
});

describe('the older body-token clients keep working', () => {
  // SMS management links carry the token by design, and a page cached in somebody's browser
  // still posts it in the body. requestHostToken accepts both, and this is what says so.
  it('accepts a token in the request body', async () => {
    const res = await req('PUT', `/api/games/${game.gameId}/notes`, {
      token: game.hostToken,
      hostNotes: 'posted the old way'
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.hostNotes, 'posted the old way');
  });

  it('accepts a token in the query string', async () => {
    const res = await req(
      'POST',
      `/api/games/${game.gameId}/invitation-message?token=${game.hostToken}`,
      {}
    );
    assert.equal(res.status, 200);
  });
});
