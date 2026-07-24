// End-to-end "act like a real user" flow test.
// Usage: node user-flow.js <baseUrl> [--create]
// Without --create it only runs read-only checks (safe against production).

const BASE = process.argv[2] || 'http://localhost:3002';
const DO_WRITE = process.argv.includes('--create');

const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); failures++; };
let failures = 0;

async function req(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
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
  for (const page of ['/', '/create.html', '/game.html', '/manage.html', '/lookup.html', '/my-games.html']) {
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

  if (!DO_WRITE) {
    console.log('\n(read-only mode: skipping game creation)');
    console.log(`\n=== ${failures} failure(s) ===\n`);
    process.exit(failures ? 1 : 0);
  }

  console.log('\n3. Host creates a game (no phone -> no SMS)');
  const create = await req('POST', '/api/games', {
    location: 'Homoly Home Court', courtNumber: '2', organizerName: 'Scott',
    organizerPlaying: true, date: '2026-08-15', time: '18:00', duration: 90,
    totalPlayers: 4, message: 'Deploy verification game', registrationMode: 'fcfs',
  });
  if (create.status !== 201) return bad(`create failed HTTP ${create.status}: ${create.text.slice(0, 200)}`);
  const { gameId, hostToken } = create.json;
  ok(`game created: ${gameId}`);
  create.json.hostSms === null ? ok('no SMS sent (hostSms null)') : bad(`SMS was sent: ${JSON.stringify(create.json.hostSms)}`);

  console.log('\n4. SECURITY: hostToken exposure');
  const pub = await req('GET', `/api/games/${gameId}`);
  'hostToken' in (pub.json || {}) ? bad('hostToken LEAKED on token-less GET') : ok('no token -> hostToken absent');
  pub.status === 200 ? ok('no token -> still HTTP 200 (players can view)') : bad(`no token -> HTTP ${pub.status}`);
  (pub.json || {}).location ? ok('no token -> game details still present') : bad('no token -> game details missing');

  const asHost = await req('GET', `/api/games/${gameId}?token=${hostToken}`);
  asHost.json?.hostToken === hostToken ? ok('correct token -> hostToken returned (dashboard works)') : bad('correct token -> hostToken MISSING, host dashboard would break');

  const wrong = await req('GET', `/api/games/${gameId}?token=deadbeef`);
  wrong.status === 403 ? ok('wrong token -> 403') : bad(`wrong token -> HTTP ${wrong.status}, expected 403`);

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

  console.log(`\n=== ${failures} failure(s) ===`);
  console.log(`Test game: ${gameId}\n`);
  process.exit(failures ? 1 : 0);
})();
