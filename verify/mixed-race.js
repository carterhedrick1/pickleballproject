// Host actions and player signups hitting the same game at the same moment.
// Checks invariants rather than one exact end state, since several orderings are legitimate.
const BASE = process.argv[2] || 'http://localhost:3002';

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

let failures = 0;
const check = (cond, msg) => { console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) failures++; };

(async () => {
  const CAP = 4;
  const create = await req('POST', '/api/games', {
    location: 'Mixed Race Court', organizerName: 'Host', organizerPlaying: false,
    date: '2026-09-22', time: '18:00', duration: 90, totalPlayers: CAP,
    message: '', registrationMode: 'fcfs',
  });
  const { gameId, hostToken } = create.json;

  // Seed sequentially so the starting state is known: 4 confirmed, 3 waitlisted.
  for (let i = 1; i <= CAP + 3; i++) {
    await req('POST', `/api/games/${gameId}/players`, { name: `Seed${i}` });
  }
  let g = (await req('GET', `/api/games/${gameId}?token=${hostToken}`)).json;
  console.log(`seeded: ${g.players.length} confirmed, ${g.waitlist.length} waitlisted`);

  const victim = g.players[1];
  const promotee = g.waitlist[g.waitlist.length - 1];

  // Everything at once: host removes someone, host promotes someone from the bottom of the
  // waitlist, host moves someone down, and two new people tap IN.
  console.log('\nfiring 5 simultaneous operations on the same game...');
  await Promise.all([
    req('DELETE', `/api/games/${gameId}/players/${victim.id}`, { token: hostToken }),
    req('POST', `/api/games/${gameId}/promote-from-waitlist/${promotee.id}`, { token: hostToken }),
    req('POST', `/api/games/${gameId}/move-to-waitlist/${g.players[3].id}`, { token: hostToken }),
    req('POST', `/api/games/${gameId}/players`, { name: 'LateA' }),
    req('POST', `/api/games/${gameId}/players`, { name: 'LateB' }),
  ]);

  g = (await req('GET', `/api/games/${gameId}?token=${hostToken}`)).json;
  const players = g.players || [];
  const waitlist = g.waitlist || [];
  const ids = [...players, ...waitlist].map((p) => p.id);
  const names = [...players, ...waitlist].map((p) => p.name);

  console.log(`\nconfirmed (${players.length}): ${players.map((p) => p.name).join(', ')}`);
  console.log(`waitlist  (${waitlist.length}): ${waitlist.map((p) => p.name).join(', ')}`);

  check(new Set(ids).size === ids.length, 'no player appears twice (no duplicate ids)');
  check(players.length <= CAP, `confirmed roster never exceeds capacity (${players.length} <= ${CAP})`);
  check(!names.includes(victim.name), `removed player (${victim.name}) is gone`);
  check(names.includes('LateA') && names.includes('LateB'), 'both late signups survived');

  const confirmedIds = new Set(players.map((p) => p.id));
  check(!waitlist.some((p) => confirmedIds.has(p.id)), 'nobody is on the roster and the waitlist at once');

  // Seeds 1..7 minus the removed one, plus the two late joiners, should all still be present.
  const expected = [];
  for (let i = 1; i <= CAP + 3; i++) if (`Seed${i}` !== victim.name) expected.push(`Seed${i}`);
  expected.push('LateA', 'LateB');
  const lost = expected.filter((n) => !names.includes(n));
  check(lost.length === 0, `nobody lost${lost.length ? ': ' + lost.join(', ') : ''}`);

  await req('DELETE', `/api/games/${gameId}`, { token: hostToken, reason: 'mixed race cleanup' });
  console.log(`\n=== ${failures} failure(s) ===\n`);
  process.exit(failures ? 1 : 0);
})();
