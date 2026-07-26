// Promotion rules and the real web cancel.
// Usage: node promotion-modes.js [baseUrl]
//
// The behaviour this pins down, all of which was wrong or missing before:
//   - a confirmed player tapping OUT on the web actually LOSES THEIR SPOT. It used to just
//     append them to the "out" list and leave them on the roster, which is the exact
//     last-minute-cancellation problem the app exists to fix.
//   - promotion is first-come-only. Texting 9 used to auto-promote in approval mode too,
//     silently overriding a host who had chosen to pick players by hand.
//   - an approval-mode host gets told a spot opened, because nobody will fill it otherwise.
//   - tapping OUT twice leaves ONE entry, not a pile of duplicates.
//   - removing a player without the host token is refused.
//
// Players here have phone numbers, so this needs a dev-mode server and refuses to run
// anywhere but localhost:
//   TEXTBELT_API_KEY="" PORT=3002 node server.js
//   npm run verify:promotion

const BASE = process.argv[2] || 'http://localhost:3002';

if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(BASE)) {
  console.error(`\n  REFUSING to run against ${BASE}.`);
  console.error('  This script signs players up with phone numbers and is only safe against a');
  console.error('  local server started with TEXTBELT_API_KEY="".\n');
  process.exit(1);
}

let failures = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); failures++; };
const check = (c, m) => (c ? ok(m) : bad(m));

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

const HOST = '5555559001';
const P = (n) => `55555591${String(n).padStart(2, '0')}`;

async function makeGame(mode, seats) {
  const created = await req('POST', '/api/games', {
    location: 'Test Court', courtNumber: '1', organizerName: 'Host', organizerPhone: HOST,
    organizerPlaying: false, date: '2026-09-12', time: '18:00', duration: 90,
    totalPlayers: seats, message: 'promotion mode verification', registrationMode: mode,
  });
  if (created.status !== 201) throw new Error(`create failed: ${created.text.slice(0, 160)}`);
  return created.json;
}

const readGame = async (id, token) => (await req('GET', `/api/games/${id}?token=${token}`)).json;

(async () => {
  console.log(`\n=== Promotion rules and the web cancel (${BASE}) ===\n`);
  const createdIds = [];

  // -------------------------------------------------------------------------------------
  console.log('1. First-come game: texting 9 cancels and promotes');
  {
    const { gameId, hostToken } = await makeGame('fcfs', 3);
    createdIds.push(gameId);
    for (let i = 1; i <= 4; i++) {
      await req('POST', `/api/games/${gameId}/players`, { name: `Player${i}`, phone: P(i) });
    }

    await sms(P(1), '9', gameId);
    await sms(P(1), '1', gameId);

    const g = await readGame(gameId, hostToken);
    const names = g.players.map((p) => p.name);
    check(!names.includes('Player1'), 'the canceller is off the roster');
    check(names.includes('Player4'), 'the waitlisted player was promoted');
    check(g.waitlist.length === 0, 'the waitlist is empty');

    const promoted = g.players.find((p) => p.name === 'Player4');
    check(!!promoted?.promotedAt, `the promotion is timestamped (promotedAt: ${promoted?.promotedAt || 'MISSING'})`);

    const out = (g.outPlayers || []).find((p) => p.phone === P(1));
    check(!!out, 'the canceller was recorded in outPlayers - the stats need this');
    check(out?.wasConfirmed === true, 'recorded as having given up a confirmed spot');
    check(!!out?.outAt, `recorded with an outAt timestamp (${out?.outAt || 'MISSING'})`);
  }

  // -------------------------------------------------------------------------------------
  console.log('\n2. Approval-mode game: texting 9 must NOT auto-promote');
  {
    const { gameId, hostToken } = await makeGame('waitlist', 2);
    createdIds.push(gameId);
    // In approval mode everyone lands on the waitlist, so the host promotes two by hand.
    for (let i = 1; i <= 4; i++) {
      await req('POST', `/api/games/${gameId}/players`, { name: `Applicant${i}`, phone: P(10 + i) });
    }
    let g = await readGame(gameId, hostToken);
    for (const p of g.waitlist.slice(0, 2)) {
      await req('POST', `/api/games/${gameId}/promote-from-waitlist/${p.id}`, { token: hostToken });
    }
    g = await readGame(gameId, hostToken);
    check(g.players.length === 2 && g.waitlist.length === 2, 'set up: 2 selected, 2 still applying');

    const before = g.waitlist.map((p) => p.name).join(',');
    await sms(P(11), '9', gameId);
    await sms(P(11), '1', gameId);

    g = await readGame(gameId, hostToken);
    check(g.players.length === 1, `nobody was auto-promoted (roster ${g.players.length}, expected 1)`);
    check(g.waitlist.map((p) => p.name).join(',') === before, 'the waitlist is untouched - the host still chooses');
    const out = (g.outPlayers || []).find((p) => p.phone === P(11));
    check(out?.wasConfirmed === true, 'the approval-mode canceller was still recorded');
  }

  // -------------------------------------------------------------------------------------
  console.log('\n3. Web OUT by a confirmed player actually cancels their spot');
  {
    const { gameId, hostToken } = await makeGame('fcfs', 3);
    createdIds.push(gameId);
    for (let i = 1; i <= 4; i++) {
      await req('POST', `/api/games/${gameId}/players`, { name: `Web${i}`, phone: P(20 + i) });
    }

    const out = await req('POST', `/api/games/${gameId}/players`, {
      name: 'Web1', phone: P(21), action: 'out',
    });
    check(out.status === 201, `OUT accepted (HTTP ${out.status})`);
    check(out.json?.cancelled === true, 'the response says the spot was cancelled');
    check(out.json?.wasConfirmed === true, 'the response says they were confirmed');
    check(out.json?.promoted === 'Web4', `the response names who took the spot (${out.json?.promoted})`);

    const g = await readGame(gameId, hostToken);
    const names = g.players.map((p) => p.name);
    check(!names.includes('Web1'), 'they are off the roster - the old bug left them on it');
    check(names.includes('Web4'), 'the waitlisted player took the spot');
    check(g.players.length === 3, `the game is full again (${g.players.length} of 3)`);
  }

  // -------------------------------------------------------------------------------------
  console.log('\n4. Web OUT twice leaves one entry, and a waitlister can leave too');
  {
    const { gameId, hostToken } = await makeGame('fcfs', 2);
    createdIds.push(gameId);
    for (let i = 1; i <= 3; i++) {
      await req('POST', `/api/games/${gameId}/players`, { name: `Dup${i}`, phone: P(30 + i) });
    }

    await req('POST', `/api/games/${gameId}/players`, { name: 'Dup1', phone: P(31), action: 'out' });
    const second = await req('POST', `/api/games/${gameId}/players`, { name: 'Dup1', phone: P(31), action: 'out' });
    check(second.json?.cancelled === false, 'the second OUT finds nothing left to cancel');

    let g = await readGame(gameId, hostToken);
    const entries = (g.outPlayers || []).filter((p) => p.phone === P(31));
    check(entries.length === 1, `one outPlayers entry, not ${entries.length} - deduped by phone`);

    // Dup3 was pushed to the waitlist, then Dup1 leaving promoted them. Refill and test a
    // genuine waitlister leaving.
    await req('POST', `/api/games/${gameId}/players`, { name: 'Dup4', phone: P(34) });
    g = await readGame(gameId, hostToken);
    check((g.waitlist || []).length === 1, 'set up: one person waiting');

    const wOut = await req('POST', `/api/games/${gameId}/players`, { name: 'Dup4', phone: P(34), action: 'out' });
    check(wOut.json?.cancelled === true && wOut.json?.wasConfirmed === false,
      'a waitlister leaving reports cancelled, not confirmed');
    g = await readGame(gameId, hostToken);
    check((g.waitlist || []).length === 0, 'they are off the waitlist');
    check((g.outPlayers || []).find((p) => p.phone === P(34))?.wasWaitlisted === true,
      'recorded as having been on the waitlist');
  }

  // -------------------------------------------------------------------------------------
  console.log('\n5. An unknown phone tapping OUT is still just an RSVP of no');
  {
    const { gameId, hostToken } = await makeGame('fcfs', 4);
    createdIds.push(gameId);
    await req('POST', `/api/games/${gameId}/players`, { name: 'Known', phone: P(40) });

    const before = await readGame(gameId, hostToken);
    const out = await req('POST', `/api/games/${gameId}/players`, {
      name: 'Stranger', phone: P(99), action: 'out',
    });
    check(out.status === 201, 'accepted');
    check(out.json?.cancelled === false, 'nothing was cancelled');

    const after = await readGame(gameId, hostToken);
    check(after.players.length === before.players.length, 'the roster is untouched');
    check((after.outPlayers || []).some((p) => p.phone === P(99)), 'they are recorded as out');
  }

  // -------------------------------------------------------------------------------------
  console.log('\n6. The organizer cannot tap OUT of their own game');
  {
    const created = await req('POST', '/api/games', {
      location: 'Test Court', courtNumber: '1', organizerName: 'Playing Host',
      organizerPhone: HOST, organizerPlaying: true, date: '2026-09-12', time: '18:00',
      duration: 90, totalPlayers: 4, message: 'organizer out check', registrationMode: 'fcfs',
    });
    createdIds.push(created.json.gameId);

    const out = await req('POST', `/api/games/${created.json.gameId}/players`, {
      name: 'Playing Host', phone: HOST, action: 'out',
    });
    check(out.status === 400, `refused with HTTP ${out.status} (expected 400)`);
    check(/management link/i.test(out.json?.error || ''), 'and points them at their management link');

    const g = await readGame(created.json.gameId, created.json.hostToken);
    check(g.players.some((p) => p.isOrganizer), 'the organizer is still on the roster');
  }

  // -------------------------------------------------------------------------------------
  console.log('\n7. Removing a player needs the host token');
  {
    const { gameId, hostToken } = await makeGame('fcfs', 4);
    createdIds.push(gameId);
    await req('POST', `/api/games/${gameId}/players`, { name: 'Victim', phone: P(50) });
    const g = await readGame(gameId, hostToken);
    const victim = g.players.find((p) => p.name === 'Victim');

    const noToken = await req('DELETE', `/api/games/${gameId}/players/${victim.id}`);
    check(noToken.status === 403, `no token -> HTTP ${noToken.status} (expected 403)`);

    const wrongToken = await req('DELETE', `/api/games/${gameId}/players/${victim.id}?token=deadbeef`);
    check(wrongToken.status === 403, `wrong token -> HTTP ${wrongToken.status} (expected 403)`);

    const still = await readGame(gameId, hostToken);
    check(still.players.some((p) => p.id === victim.id), 'the player is still on the roster');

    const withToken = await req('DELETE', `/api/games/${gameId}/players/${victim.id}?token=${hostToken}`);
    check(withToken.status === 200, `the host CAN still remove them (HTTP ${withToken.status})`);
  }

  // -------------------------------------------------------------------------------------
  console.log('\n8. Cleaning up');
  const { deleteGamesById, cleanupTestRosterAndLocations } = require('./_cleanup');
  const removed = await deleteGamesById(createdIds);
  await cleanupTestRosterAndLocations();
  ok(`removed ${removed} test game(s)`);

  console.log(`\n=== ${failures} failure(s) ===\n`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR:', e); process.exit(1); });
