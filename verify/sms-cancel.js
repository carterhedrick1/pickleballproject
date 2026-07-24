// Drives the real "text 9 to cancel" flow through the webhook.
// The server under test must run with TEXTBELT_API_KEY unset, so sendSMS is in dev mode
// and no real texts leave the machine.
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

const sms = (fromNumber, text, gameId) =>
  req('POST', '/api/sms/webhook', { fromNumber, text, data: gameId });

let failures = 0;
const check = (cond, msg) => { console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) failures++; };

(async () => {
  const create = await req('POST', '/api/games', {
    location: 'SMS Cancel Court', organizerName: 'Host', organizerPlaying: false,
    date: '2026-09-23', time: '18:00', duration: 90, totalPlayers: 3,
    message: '', registrationMode: 'fcfs',
  });
  const { gameId, hostToken } = create.json;

  const people = [
    { name: 'Alpha', phone: '5557770001' },
    { name: 'Bravo', phone: '5557770002' },
    { name: 'Charlie', phone: '5557770003' },
    { name: 'Delta', phone: '5557770004' }, // 4th -> waitlist
  ];
  for (const p of people) {
    await req('POST', `/api/games/${gameId}/players`, { name: p.name, phone: p.phone });
  }

  let g = (await req('GET', `/api/games/${gameId}?token=${hostToken}`)).json;
  console.log(`before: confirmed [${g.players.map(p => p.name)}] waitlist [${g.waitlist.map(p => p.name)}]`);
  check(g.players.length === 3 && g.waitlist.length === 1, 'seeded 3 confirmed + 1 waitlisted');

  // Alpha texts 9, then picks the first listed game.
  console.log('\nAlpha texts "9" then "1"...');
  await sms('5557770001', '9', gameId);
  await sms('5557770001', '1', gameId);

  g = (await req('GET', `/api/games/${gameId}?token=${hostToken}`)).json;
  const names = g.players.map(p => p.name);
  const waiting = (g.waitlist || []).map(p => p.name);
  console.log(`after:  confirmed [${names}] waitlist [${waiting}]`);

  check(!names.includes('Alpha'), 'Alpha was cancelled');
  check(names.includes('Delta'), 'Delta was promoted off the waitlist');
  check(names.includes('Bravo') && names.includes('Charlie'), 'Bravo and Charlie untouched');
  check(g.players.length === 3, `roster still 3 (was ${g.players.length})`);
  check(waiting.length === 0, 'waitlist now empty');

  // The dangerous case the -1 guard prevents: a cancel arriving for someone already gone must
  // not splice the last player off the roster instead.
  console.log('\nAlpha texts "9" again (already cancelled)...');
  const before = g.players.map(p => p.name).join(',');
  await sms('5557770001', '9', gameId);
  await sms('5557770001', '1', gameId);
  g = (await req('GET', `/api/games/${gameId}?token=${hostToken}`)).json;
  const after = g.players.map(p => p.name).join(',');
  check(before === after, `roster unchanged by a repeat cancel (${after || 'empty'})`);

  await req('DELETE', `/api/games/${gameId}`, { token: hostToken, reason: 'sms cancel test cleanup' });
  console.log(`\n=== ${failures} failure(s) ===\n`);
  process.exit(failures ? 1 : 0);
})();
