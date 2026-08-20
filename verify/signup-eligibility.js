// Proves the API itself - not just the browser - refuses signups to cancelled and
// finished games, while OUT (leave) still works for a cancelled game.
// Run like the other rigs, against a local server: node verify/signup-eligibility.js http://localhost:3902
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

const gameBody = (location) => ({
  location, organizerName: 'Host', organizerPlaying: false,
  date: '2099-09-23', time: '18:00', duration: 90, totalPlayers: 4,
  message: '', registrationMode: 'fcfs',
});

(async () => {
  // --- Cancelled game -------------------------------------------------------
  const a = (await req('POST', '/api/games', gameBody('Eligibility Cancelled Court'))).json;
  const joinOpen = await req('POST', `/api/games/${a.gameId}/players`, { name: 'Early', phone: '5557780001' });
  check(joinOpen.status === 201, 'join succeeds while the game is open');

  await req('DELETE', `/api/games/${a.gameId}`, { token: a.hostToken, reason: 'eligibility test' });

  const joinCancelled = await req('POST', `/api/games/${a.gameId}/players`, { name: 'Late', phone: '5557780002' });
  check(joinCancelled.status === 410 && joinCancelled.json?.status === 'game_cancelled',
    `join after cancellation rejected with 410/game_cancelled (got ${joinCancelled.status}/${joinCancelled.json?.status})`);

  const outCancelled = await req('POST', `/api/games/${a.gameId}/players`,
    { name: 'Early', phone: '5557780001', action: 'out' });
  check(outCancelled.status === 201, `OUT still works on a cancelled game (got ${outCancelled.status})`);

  // --- Finished game --------------------------------------------------------
  const b = (await req('POST', '/api/games', gameBody('Eligibility Ended Court'))).json;
  const past = await req('PUT', `/api/games/${b.gameId}`,
    { token: b.hostToken, date: '2020-01-15', time: '18:00', notifyPlayers: false });
  check(past.status === 200, `host can move the game into the past for this test (got ${past.status})`);

  const joinEnded = await req('POST', `/api/games/${b.gameId}/players`, { name: 'Tardy', phone: '5557780003' });
  check(joinEnded.status === 410 && joinEnded.json?.status === 'game_ended',
    `join after game end rejected with 410/game_ended (got ${joinEnded.status}/${joinEnded.json?.status})`);

  // Host manual add is deliberately NOT gated: hosts correct rosters after the fact.
  const hostAdd = await req('POST', `/api/games/${b.gameId}/manual-player`,
    { name: 'Recorded', phone: '5557780004', addTo: 'confirmed', token: b.hostToken });
  check(hostAdd.status === 200, `host manual add still works on a finished game (got ${hostAdd.status})`);

  // --- Cleanup --------------------------------------------------------------
  await req('DELETE', `/api/games/${b.gameId}`, { token: b.hostToken, reason: 'eligibility test cleanup' });
  await req('DELETE', `/api/games/${a.gameId}/permanent`, { token: a.hostToken });
  await req('DELETE', `/api/games/${b.gameId}/permanent`, { token: b.hostToken });
  await require('./_cleanup').sweepLocalTestRows(BASE);

  console.log(`\n=== ${failures} failure(s) ===\n`);
  process.exit(failures ? 1 : 0);
})();
