// Demonstrates (and later verifies the fix for) the concurrent-signup race:
// several friends tapping the invite link at the same instant.
const BASE = process.argv[2] || 'http://localhost:3002';
const N = parseInt(process.argv[3] || '6', 10);

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
  const create = await req('POST', '/api/games', {
    location: 'Race Test Court', organizerName: 'Host', organizerPlaying: false,
    date: '2026-09-20', time: '18:00', duration: 90, totalPlayers: 12,
    message: '', registrationMode: 'fcfs',
  });
  if (create.status !== 201) {
    console.error('could not create game:', create.status, create.text.slice(0, 200));
    process.exit(1);
  }
  const { gameId, hostToken } = create.json;
  console.log(`game ${gameId} created, capacity 12\n`);

  // All N tap "I'm IN" at the same moment.
  const names = Array.from({ length: N }, (_, i) => `Friend${i + 1}`);
  const results = await Promise.all(
    names.map((name) => req('POST', `/api/games/${gameId}/players`, { name }))
  );

  const accepted = results.filter((r) => r.status === 201).length;
  const rejected = results.filter((r) => r.status !== 201);

  const after = await req('GET', `/api/games/${gameId}`);
  const roster = (after.json?.players || []).map((p) => p.name);
  const missing = names.filter((n) => !roster.includes(n));

  console.log(`server said OK to : ${accepted}/${N}`);
  if (rejected.length) {
    console.log(`server rejected    : ${rejected.length} (${rejected.map((r) => r.status).join(', ')})`);
  }
  console.log(`actually on roster : ${roster.length}  [${roster.join(', ')}]`);

  if (missing.length) {
    console.log(`\n  *** ${missing.length} SIGNUP(S) VANISHED: ${missing.join(', ')}`);
    console.log(`  Each was told they were in, but got overwritten by a simultaneous save.`);
  } else {
    console.log(`\n  OK: every confirmed signup survived.`);
  }

  // Clean up so repeated runs do not pile up games.
  await req('DELETE', `/api/games/${gameId}`, { token: hostToken, reason: 'race test cleanup' });

  process.exit(missing.length ? 1 : 0);
})();
