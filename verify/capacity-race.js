// Harder race: more people tap IN at once than the game has seats.
// Correct behaviour: seats fill exactly to capacity, everyone else lands on the waitlist,
// and nobody is lost.
const BASE = process.argv[2] || 'http://localhost:3002';
const CAPACITY = 4;
const RUSH = 10;

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
    location: 'Capacity Race Court', organizerName: 'Host', organizerPlaying: false,
    date: '2026-09-21', time: '18:00', duration: 90, totalPlayers: CAPACITY,
    message: '', registrationMode: 'fcfs',
  });
  const { gameId, hostToken } = create.json;
  console.log(`game ${gameId}: ${CAPACITY} seats, ${RUSH} people tapping IN simultaneously\n`);

  const names = Array.from({ length: RUSH }, (_, i) => `Rush${i + 1}`);
  const results = await Promise.all(
    names.map((name) => req('POST', `/api/games/${gameId}/players`, { name }))
  );

  const after = await req('GET', `/api/games/${gameId}`);
  const g = after.json || {};
  const roster = (g.players || []).map((p) => p.name);
  const waitlist = (g.waitlist || []).map((p) => p.name);
  const accounted = new Set([...roster, ...waitlist]);
  const missing = names.filter((n) => !accounted.has(n));

  console.log(`confirmed (${roster.length}): ${roster.join(', ')}`);
  console.log(`waitlist  (${waitlist.length}): ${waitlist.join(', ')}`);

  let failures = 0;
  const check = (cond, msg) => { console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) failures++; };

  check(roster.length === CAPACITY, `exactly ${CAPACITY} confirmed (no overbooking, no empty seat)`);
  check(waitlist.length === RUSH - CAPACITY, `${RUSH - CAPACITY} waitlisted`);
  check(missing.length === 0, `nobody lost${missing.length ? ': ' + missing.join(', ') : ''}`);
  check(new Set(roster).size === roster.length, 'no duplicate names on the roster');

  // What each person was TOLD should match where they actually ended up.
  let mismatched = 0;
  results.forEach((r, i) => {
    const told = r.json?.status;
    const name = names[i];
    const actually = roster.includes(name) ? 'confirmed' : waitlist.includes(name) ? 'waitlist' : 'missing';
    if (told && told !== actually) mismatched++;
  });
  check(mismatched === 0, `everyone's confirmation matched reality (${mismatched} mismatched)`);

  await req('DELETE', `/api/games/${gameId}`, { token: hostToken, reason: 'capacity race cleanup' });
  await require('./_cleanup').sweepLocalTestRows(BASE);
  console.log(`\n=== ${failures} failure(s) ===\n`);
  process.exit(failures ? 1 : 0);
})();
