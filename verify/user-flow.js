// End-to-end "act like a real user" flow test.
// Usage: node user-flow.js <baseUrl> [--create]
// Without --create it only runs read-only checks (safe against production).

const BASE = process.argv[2] || 'http://localhost:3002';
const DO_WRITE = process.argv.includes('--create');

// A few checks need a host with a phone number, and players who have one too - that is the
// only way to see the roster fill up or to compare the two host-history views. Those are only
// safe against a local dev-mode server, so they are skipped anywhere else.
const IS_LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(BASE);
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36';

const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); failures++; };
let failures = 0;

async function req(method, path, body, extraHeaders) {
  const res = await fetch(BASE + path, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(extraHeaders || {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text };
}

(async () => {
  console.log(`\n=== Testing ${BASE} ===\n`);

  console.log('1. Health check');
  const health = await req('GET', '/api/health');
  health.status === 200 && health.json?.status === 'OK'
    ? ok(`health OK (db: ${health.json.database})`)
    : bad(`health returned ${health.status}: ${health.text.slice(0, 120)}`);

  console.log('\n2. Pages a user actually visits load');
  for (const page of ['/', '/create.html', '/game.html', '/manage.html', '/lookup.html',
                      '/my-games.html', '/roster.html', '/stats.html']) {
    const r = await req('GET', page);
    r.status === 200 ? ok(`${page} (${r.text.length} bytes)`) : bad(`${page} -> HTTP ${r.status}`);
  }

  console.log('\n2b. New (Phase 1-4) front-end assets are the ones being served');
  const home = await req('GET', '/');
  /guide\.css/.test(home.text) ? ok('home page references guide.css (new build)') : bad('home page is the OLD build');
  for (const asset of ['/css/guide.css', '/js/guide.js']) {
    const r = await req('GET', asset);
    r.status === 200 ? ok(`${asset} (${r.text.length} bytes)`) : bad(`${asset} -> HTTP ${r.status}`);
  }

  console.log('\n2c. Saved courts (the create form\'s location picker reads these)');
  const locs = await req('GET', '/api/locations');
  const locations = locs.json?.locations || [];
  locs.status === 200 && Array.isArray(locations)
    ? ok(`/api/locations returned ${locations.length} court(s)`)
    : bad(`/api/locations -> HTTP ${locs.status}: ${locs.text.slice(0, 120)}`);
  const SEEDS = ['Homoly Home Court', 'Chicken and Pickle', 'JustPaddles', 'Char Bar', 'Argosy'];
  const missingSeeds = SEEDS.filter((s) => !locations.includes(s));
  missingSeeds.length === 0
    ? ok('all five seeded courts are present')
    : bad(`seeded courts missing: ${missingSeeds.join(', ')}`);
  locations.some((location) => ['wimbledom', 'wimbledon', 'wimbleton'].includes(location.toLowerCase()))
    ? bad('Wimbledon is still present')
    : ok('Wimbledon is absent');

  if (!DO_WRITE) {
    console.log('\n(read-only mode: skipping game creation)');
    console.log(`\n=== ${failures} failure(s) ===\n`);
    process.exit(failures ? 1 : 0);
  }

  console.log('\n3. Host creates a game (no phone -> no SMS)');
  const createRequestId = 'verify-create-request-00000001';
  const createBody = {
    location: 'Homoly Home Court', organizerName: 'Scott',
    organizerPlaying: true, date: '2026-08-15', time: '18:00', duration: 90,
    totalPlayers: 4, message: 'Deploy verification game', registrationMode: 'fcfs',
  };
  const create = await req('POST', '/api/games', createBody, {
    'Idempotency-Key': createRequestId
  });
  if (create.status !== 201) return bad(`create failed HTTP ${create.status}: ${create.text.slice(0, 200)}`);
  const { gameId, hostToken } = create.json;
  ok(`game created: ${gameId}`);
  create.json.hostSms === null ? ok('no SMS sent (hostSms null)') : bad(`SMS was sent: ${JSON.stringify(create.json.hostSms)}`);

  const replay = await req('POST', '/api/games', createBody, {
    'Idempotency-Key': createRequestId
  });
  replay.status === 200 &&
    replay.json?.replayed === true &&
    replay.json?.gameId === gameId &&
    replay.json?.hostToken === hostToken
    ? ok('an interrupted create safely replays the original game and host link')
    : bad(`create replay was not idempotent: HTTP ${replay.status} ${replay.text.slice(0, 160)}`);

  console.log('\n4. SECURITY: hostToken exposure');
  const pub = await req('GET', `/api/games/${gameId}`);
  'hostToken' in (pub.json || {}) ? bad('hostToken LEAKED on token-less GET') : ok('no token -> hostToken absent');
  pub.status === 200 ? ok('no token -> still HTTP 200 (players can view)') : bad(`no token -> HTTP ${pub.status}`);
  (pub.json || {}).location ? ok('no token -> game details still present') : bad('no token -> game details missing');
  const pubGame = pub.json || {};
  ('hostPhone' in pubGame || 'organizerPhone' in pubGame || 'notificationPreferences' in pubGame)
    ? bad('host contact/settings LEAKED on token-less GET')
    : ok('no token -> host phone and settings absent');
  const pubPeople = [...(pubGame.players || []), ...(pubGame.waitlist || []), ...(pubGame.outPlayers || [])];
  pubPeople.some((p) => p && 'phone' in p)
    ? bad('player phone numbers LEAKED on token-less GET')
    : ok('no token -> player phone numbers absent');
  (pubGame.players || []).every((p) => typeof p.name === 'string')
    ? ok('no token -> player names still present for the roster list')
    : bad('no token -> player names missing, game page roster would break');

  const asHost = await req('GET', `/api/games/${gameId}?token=${hostToken}`);
  asHost.json?.hostToken === hostToken ? ok('correct token -> hostToken returned (dashboard works)') : bad('correct token -> hostToken MISSING, host dashboard would break');

  const wrong = await req('GET', `/api/games/${gameId}?token=deadbeef`);
  wrong.status === 403 ? ok('wrong token -> 403') : bad(`wrong token -> HTTP ${wrong.status}, expected 403`);

  console.log('\n4b. Host edits cannot overwrite protected game state');
  const protectedEdit = await req('PUT', `/api/games/${gameId}`, {
    token: hostToken,
    message: 'Allowed edit',
    hostToken: 'replacement-token',
    hostPhone: '0000000000',
    players: [],
    cancelled: true,
    created: 'replaced'
  });
  protectedEdit.status === 200
    ? ok('host update still accepts known editable fields')
    : bad(`host update -> HTTP ${protectedEdit.status}`);
  const afterProtectedEdit = await req('GET', `/api/games/${gameId}?token=${hostToken}`);
  afterProtectedEdit.json?.hostToken === hostToken
    ? ok('hostToken ignored in the update body')
    : bad('hostToken was overwritten');
  afterProtectedEdit.json?.players?.some((player) => player.isOrganizer)
    ? ok('players ignored in the update body')
    : bad('players were overwritten');
  afterProtectedEdit.json?.cancelled === false
    ? ok('cancellation state ignored in the update body')
    : bad('cancellation state was overwritten');
  afterProtectedEdit.json?.message === 'Allowed edit'
    ? ok('editable message was saved')
    : bad('editable message did not save');

  console.log('\n5. Players tap IN (fills 3 open spots of 4)');
  for (const name of ['Alice', 'Bob', 'Carla']) {
    const r = await req('POST', `/api/games/${gameId}/players`, { name });
    r.status === 201 ? ok(`${name} joined (${r.json?.action || 'in'})`) : bad(`${name} join -> HTTP ${r.status}: ${r.text.slice(0, 150)}`);
  }

  console.log('\n6. Game is full -> next player should go to WAITLIST');
  const overflow = await req('POST', `/api/games/${gameId}/players`, { name: 'Dave' });
  const act = overflow.json?.action || overflow.json?.status;
  /wait/i.test(JSON.stringify(overflow.json || {}))
    ? ok(`Dave waitlisted (action: ${act})`)
    : bad(`expected waitlist, got HTTP ${overflow.status}: ${overflow.text.slice(0, 200)}`);

  console.log('\n7. A player taps OUT');
  const out = await req('POST', `/api/games/${gameId}/players`, { name: 'Eve', action: 'out' });
  out.status === 201 ? ok(`Eve marked out (action: ${out.json?.action})`) : bad(`out -> HTTP ${out.status}`);

  console.log('\n8. Final roster state');
  const final = await req('GET', `/api/games/${gameId}`);
  const g = final.json || {};
  console.log(`     players:   ${(g.players || []).map(p => p.name).join(', ') || '(none)'}`);
  console.log(`     waitlist:  ${(g.waitlist || []).map(p => p.name).join(', ') || '(none)'}`);
  console.log(`     out:       ${(g.outPlayers || []).map(p => p.name).join(', ') || '(none)'}`);
  (g.players || []).length === 4 ? ok('roster capped at 4') : bad(`roster has ${(g.players || []).length}, expected 4`);
  (g.waitlist || []).length === 1 ? ok('1 player on waitlist') : bad(`waitlist has ${(g.waitlist || []).length}, expected 1`);

  console.log('\n8b. Which phone somebody signed up on is recorded');
  await req('POST', `/api/games/${gameId}/players`, { name: 'Pixel Pat' }, { 'User-Agent': ANDROID_UA });
  // Read back with the host token: device flags are host-roster data, and the public
  // (token-less) response strips them along with phone numbers.
  const withPat = (await req('GET', `/api/games/${gameId}?token=${hostToken}`)).json || {};
  const everyone = [...(withPat.players || []), ...(withPat.waitlist || []), ...(withPat.outPlayers || [])];
  const pat = everyone.find((p) => p.name === 'Pixel Pat');
  const alice = everyone.find((p) => p.name === 'Alice');
  pat?.isAndroid === true ? ok('an Android signup is flagged') : bad(`Pixel Pat isAndroid = ${pat?.isAndroid}`);
  alice?.isAndroid === false ? ok('a non-Android signup is flagged false') : bad(`Alice isAndroid = ${alice?.isAndroid}`);

  console.log('\n9a. The host can save private notes on a game');
  const noNote = await req('PUT', `/api/games/${gameId}/notes`, { hostNotes: 'sneaky' });
  noNote.status === 403 ? ok('no token -> 403') : bad(`notes without a token -> HTTP ${noNote.status}, expected 403`);

  const NOTE = 'Gate code 4417. Bring the spare net.';
  const saveNote = await req('PUT', `/api/games/${gameId}/notes`, { token: hostToken, hostNotes: NOTE });
  saveNote.status === 200 ? ok('note saved with the host token') : bad(`notes -> HTTP ${saveNote.status}: ${saveNote.text.slice(0, 150)}`);

  const asHostAgain = await req('GET', `/api/games/${gameId}?token=${hostToken}`);
  asHostAgain.json?.hostNotes === NOTE ? ok('the host reads their note back') : bad(`host GET hostNotes = ${JSON.stringify(asHostAgain.json?.hostNotes)}`);

  const asPlayer = await req('GET', `/api/games/${gameId}`);
  'hostNotes' in (asPlayer.json || {}) ? bad('PRIVACY: hostNotes visible on the public game page') : ok('players never see the note');

  console.log('\n9b. Private host pages reject an unverified phone number');
  const unverifiedRoster = await req('GET', '/api/roster/5555559009');
  unverifiedRoster.status === 401
    ? ok('an unverified phone cannot read a roster')
    : bad(`/api/roster -> HTTP ${unverifiedRoster.status}, expected 401`);

  const localGameIds = [];
  if (!IS_LOCAL) {
    console.log('\n9c. Host history and roster checks (skipped - only safe against a local server)');
  } else {
    console.log('\n9c. Host history and roster, as a host with a phone number');
    const HOST_PHONE = '5555559001';
    const PLAYER_PHONE = '5555559002';
    const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

    // An old game that was cancelled: the default view drops it after a week, ?all=1 keeps it.
    const old = await req('POST', '/api/games', {
      location: 'Homoly Home Court', organizerName: 'Scott', organizerPhone: HOST_PHONE,
      organizerPlaying: false, date: daysAgo(30), time: '18:00', duration: 90,
      totalPlayers: 4, message: 'Verification - old cancelled game', registrationMode: 'fcfs',
    });
    localGameIds.push(old.json?.gameId);
    await req('DELETE', `/api/games/${old.json?.gameId}`, { token: old.json?.hostToken, reason: 'Rained out' });

    // A current game, joined by somebody on an Android phone.
    const live = await req('POST', '/api/games', {
      location: 'Homoly Home Court', organizerName: 'Scott', organizerPhone: HOST_PHONE,
      organizerPlaying: false, date: '2026-08-20', time: '18:00', duration: 90,
      totalPlayers: 4, message: 'Verification - host history game', registrationMode: 'fcfs',
    });
    localGameIds.push(live.json?.gameId);
    await req('POST', `/api/games/${live.json?.gameId}/players`,
      { name: 'Signup Typed Name', phone: PLAYER_PHONE }, { 'User-Agent': ANDROID_UA });

    const { getLocalHostAuthHeaders } = require('./_host-verification');
    const hostAuth = await getLocalHostAuthHeaders(BASE, HOST_PHONE);
    const dflt = await req('GET', `/api/games/by-phone/${HOST_PHONE}`, null, hostAuth);
    const all = await req('GET', `/api/games/by-phone/${HOST_PHONE}?all=1`, null, hostAuth);
    const dfltIds = (dflt.json?.games || []).map((g) => g.gameId);
    const allIds = (all.json?.games || []).map((g) => g.gameId);
    dfltIds.every((id) => allIds.includes(id))
      ? ok(`?all=1 is a superset of the default view (${dfltIds.length} of ${allIds.length})`)
      : bad(`default view has games ?all=1 does not: ${dfltIds.filter((id) => !allIds.includes(id))}`);
    allIds.includes(old.json?.gameId) ? ok('?all=1 keeps the old cancelled game') : bad('?all=1 dropped the old cancelled game');
    !dfltIds.includes(old.json?.gameId) ? ok('the default view drops it, as before') : bad('the default view still shows a cancelled game from 30 days ago');

    const oldCard = (all.json?.games || []).find((g) => g.gameId === old.json?.gameId);
    oldCard?.cancellationReason === 'Rained out' ? ok('the cancellation reason comes through') : bad(`cancellationReason = ${JSON.stringify(oldCard?.cancellationReason)}`);
    oldCard?.registrationMode === 'fcfs' && oldCard?.duration === 90
      ? ok('registrationMode and duration come through')
      : bad(`registrationMode=${oldCard?.registrationMode} duration=${oldCard?.duration}`);

    await req('PUT', `/api/games/${live.json?.gameId}/notes`, { token: live.json?.hostToken, hostNotes: 'Bring cones' });
    const allAgain = await req('GET', `/api/games/by-phone/${HOST_PHONE}?all=1`, null, hostAuth);
    const liveCard = (allAgain.json?.games || []).find((g) => g.gameId === live.json?.gameId);
    liveCard?.hostNotes === 'Bring cones' ? ok('notes show up in the host history') : bad(`hostNotes in history = ${JSON.stringify(liveCard?.hostNotes)}`);

    const r1 = await req('GET', `/api/roster/${HOST_PHONE}`, null, hostAuth);
    const player = (r1.json?.roster || []).find((p) => p.phone === PLAYER_PHONE);
    player ? ok('somebody who joined a game is on the roster') : bad(`roster: ${JSON.stringify(r1.json?.roster)}`);
    player?.isAndroid === 1 ? ok('their Android signup was captured') : bad(`roster isAndroid = ${player?.isAndroid}`);
    player?.gamesCount === 1 ? ok('games played counted') : bad(`gamesCount = ${player?.gamesCount}`);
    !(r1.json?.roster || []).some((p) => p.phone === HOST_PHONE) ? ok('the host is not on their own roster') : bad('the host appears on their own roster');

    const put = await req('PUT', `/api/roster/${HOST_PHONE}/${PLAYER_PHONE}`,
      { name: 'Host Typed Name', duprId: 'DUPR-4417', duprRating: '3.75' }, hostAuth);
    put.status === 200 ? ok('the host can edit a roster entry') : bad(`roster PUT -> HTTP ${put.status}: ${put.text.slice(0, 150)}`);

    const r2 = await req('GET', `/api/roster/${HOST_PHONE}`, null, hostAuth);
    const edited = (r2.json?.roster || []).find((p) => p.phone === PLAYER_PHONE);
    edited?.name === 'Host Typed Name' ? ok('the host-typed name wins over the signup name') : bad(`name = ${JSON.stringify(edited?.name)}`);
    edited?.duprId === 'DUPR-4417' && edited?.duprRating === 3.75 ? ok('DUPR id and rating persist') : bad(`duprId=${edited?.duprId} duprRating=${edited?.duprRating}`);
    edited?.isAndroid === 1 ? ok('the edit did not wipe the Android flag') : bad(`isAndroid after edit = ${edited?.isAndroid}`);

    const badRating = await req(
      'PUT',
      `/api/roster/${HOST_PHONE}/${PLAYER_PHONE}`,
      { name: 'x', duprRating: 'abc' },
      hostAuth
    );
    badRating.status === 400 ? ok('a nonsense DUPR rating is rejected') : bad(`bad rating -> HTTP ${badRating.status}, expected 400`);
  }

  console.log('\n9. Host dashboard access with token');
  const mg = await req('GET', `/manage.html?id=${gameId}&token=${hostToken}`);
  mg.status === 200 ? ok('manage page loads') : bad(`manage page -> HTTP ${mg.status}`);

  // Clean up in-process. The public GET no longer returns hostToken, so once this script exits
  // the token is unrecoverable and the test game can never be cancelled.
  console.log('\n10. Cleaning up the test game');
  const del = await req('DELETE', `/api/games/${gameId}`, {
    token: hostToken, reason: 'Automated verification - test game',
  });
  if (del.status === 200) {
    ok(`test game cancelled (notifications sent: ${del.json?.notificationCount ?? 0})`);
  } else {
    bad(`cleanup failed HTTP ${del.status} - game ${gameId} left behind, token ${hostToken}`);
  }

  // The host-history section above writes roster rows and games that a cancel would only mark
  // cancelled, so locally they are removed from the database outright.
  if (IS_LOCAL) {
    const { cleanupTestRosterAndLocations, deleteGamesById } = require('./_cleanup');
    const removed = await deleteGamesById(localGameIds.filter(Boolean));
    await cleanupTestRosterAndLocations();
    ok(`host-history fixtures removed (${removed} game(s), roster rows cleared)`);
  }

  console.log(`\n=== ${failures} failure(s) ===`);
  console.log(`Test game: ${gameId}\n`);
  process.exit(failures ? 1 : 0);
})();
