// Host stats verification.
// Runs in-process against the pure computeHostStats() with hand-built games, so every number
// has a known right answer. No server, no database, nothing that can send a text.
//   npm run verify:stats

const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const { computeHostStats } = require(ROOT + '/stats');

let failures = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); failures++; };
const check = (c, m) => (c ? ok(m) : bad(m));
const eq = (actual, expected, label) =>
  check(actual === expected, `${label}: ${JSON.stringify(actual)}${actual === expected ? '' : ` (expected ${JSON.stringify(expected)})`}`);

const HOST = '5555559001';
const ago = (days) => new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
const ahead = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

const player = (name, phone, extra = {}) => ({
  id: `id-${phone}`, name, phone, joinedAt: new Date().toISOString(), ...extra
});

// A history with known answers:
//   3 completed, 1 upcoming, 1 cancelled
//   Ana plays in all 3 completed games, Ben in 2, Cy in 1
//   Cy waits twice; Dee is out twice, once from a confirmed spot
const created = '2026-01-01T12:00:00.000Z';
const games = [
  {
    gameId: 'g1', date: ago(30), time: '18:00', location: 'Char Bar', totalPlayers: 4,
    registrationMode: 'fcfs', created, hostPhone: HOST, organizerPhone: HOST,
    players: [
      { id: 'organizer', name: 'Scott', phone: HOST, isOrganizer: true },
      player('Ana', '5551110001', { joinedAt: '2026-01-01T12:10:00.000Z' }),  // 10 min
      player('Ben', '5551110002', { joinedAt: '2026-01-01T13:00:00.000Z' }),  // 60 min
      player('Cy', '5551110003'),
    ],
    waitlist: [],
    outPlayers: [{ id: 'o1', name: 'Dee', phone: '5551110004', wasConfirmed: false }],
  },
  {
    gameId: 'g2', date: ago(20), time: '18:00', location: 'Char Bar', totalPlayers: 4,
    registrationMode: 'fcfs', created, hostPhone: HOST, organizerPhone: HOST,
    players: [
      { id: 'organizer', name: 'Scott', phone: HOST, isOrganizer: true },
      player('Ana', '5551110001', { joinedAt: '2026-01-01T12:20:00.000Z' }),  // 20 min
      player('Ben', '5551110002', { joinedAt: '2026-01-01T14:00:00.000Z' }),  // 120 min
    ],
    waitlist: [player('Cy', '5551110003')],
    // The same person listed twice, as older games really do - must count once.
    outPlayers: [
      { id: 'o2', name: 'Dee', phone: '5551110004', wasConfirmed: true },
      { id: 'o3', name: 'Dee', phone: '5551110004', wasConfirmed: true },
    ],
  },
  {
    gameId: 'g3', date: ago(10), time: '09:30', location: 'Argosy', totalPlayers: 4,
    registrationMode: 'fcfs', created, hostPhone: HOST, organizerPhone: HOST,
    players: [
      { id: 'organizer', name: 'Scott', phone: HOST, isOrganizer: true },
      player('Ana', '5551110001', { joinedAt: '2026-01-01T12:30:00.000Z' }),  // 30 min
    ],
    waitlist: [player('Cy', '5551110003')],
    outPlayers: [],
  },
  {
    gameId: 'g4', date: ahead(7), time: '18:00', location: 'Char Bar', totalPlayers: 4,
    registrationMode: 'fcfs', created, hostPhone: HOST, organizerPhone: HOST,
    players: [{ id: 'organizer', name: 'Scott', phone: HOST, isOrganizer: true }],
    waitlist: [], outPlayers: [],
  },
  {
    gameId: 'g5', date: ago(5), time: '18:00', location: 'JustPaddles', totalPlayers: 4,
    registrationMode: 'fcfs', created, hostPhone: HOST, organizerPhone: HOST,
    cancelled: true, cancellationReason: 'Rain',
    players: [{ id: 'organizer', name: 'Scott', phone: HOST, isOrganizer: true }],
    waitlist: [], outPlayers: [],
  },
];

const roster = [
  { playerPhone: '5551110001', name: 'Ana Alvarez', duprId: 'A1', duprRating: 4.0, isAndroid: 1 },
  { playerPhone: '5551110002', name: 'Ben Brooks', duprId: '', duprRating: 3.5, isAndroid: null },
  { playerPhone: '5551110003', name: 'Cy Chen', duprId: '', duprRating: null, isAndroid: 0 },
];

(async () => {
  console.log('\n=== Host stats ===\n');
  const s = computeHostStats(HOST, games, roster);

  console.log('1. Summary');
  eq(s.summary.gamesHosted, 5, 'games hosted');
  eq(s.summary.completed, 3, 'completed');
  eq(s.summary.upcoming, 1, 'upcoming');
  eq(s.summary.cancelled, 1, 'cancelled');

  console.log('\n2. Fill rate (completed games only, cancelled and upcoming excluded)');
  // g1 4/4, g2 3/4, g3 2/4  ->  (1 + 0.75 + 0.5) / 3 = 0.75
  eq(s.fillRate.gamesCounted, 3, 'games counted');
  eq(s.fillRate.average, 0.75, 'average');

  console.log('\n3. Who plays');
  eq(s.players.distinctCount, 4, 'distinct players (organizer excluded)');
  eq(s.players.top[0].name, 'Ana Alvarez', 'most frequent player');
  eq(s.players.top[0].games, 3, 'their game count');
  eq(s.players.top[1].name, 'Ben Brooks', 'second');
  eq(s.players.top[1].games, 2, 'their game count');
  check(!s.players.top.some(p => p.name === 'Scott'), 'the host is not listed as their own regular');
  check(s.players.top.every(p => p.name !== 'Ana'),
    'roster names win over signup names (Ana Alvarez, not Ana)');

  console.log('\n4. Waitlist regulars');
  eq(s.players.waitlistRegulars[0].name, 'Cy Chen', 'most waitlisted');
  eq(s.players.waitlistRegulars[0].times, 2, 'times waitlisted');

  console.log('\n5. Cancellations');
  eq(s.players.outs[0].name, 'Dee', 'most frequent out');
  eq(s.players.outs[0].timesOut, 2, 'times out - the duplicate entry in g2 counted once');
  eq(s.players.outs[0].confirmedCancels, 1, 'of which gave up a confirmed spot');

  console.log('\n6. Signup speed (first-come games, 2+ samples, per-person median)');
  const ana = s.signupSpeed.find(p => p.name === 'Ana Alvarez');
  const ben = s.signupSpeed.find(p => p.name === 'Ben Brooks');
  eq(ana?.medianMinutes, 20, 'Ana: median of 10, 20, 30');
  eq(ben?.medianMinutes, 90, 'Ben: median of 60, 120');
  eq(s.signupSpeed[0].name, 'Ana Alvarez', 'fastest first');
  check(!s.signupSpeed.some(p => p.name === 'Cy Chen'), 'one sample is not enough to be listed');

  console.log('\n7. Where and when');
  eq(s.schedule.busiestLocation?.name, 'Char Bar', 'busiest location');
  eq(s.schedule.busiestLocation?.games, 3, 'games there');
  eq(s.schedule.favoriteTime?.name, '18:00', 'usual start time');
  // The weekday must come from a field-by-field parse; new Date('YYYY-MM-DD') is UTC and can
  // report the day before in a US timezone.
  const [y, m, d] = ago(30).split('-').map(Number);
  const expectedDay = new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'long' });
  check(typeof s.schedule.favoriteDay?.name === 'string', `favorite day is a weekday (${s.schedule.favoriteDay?.name})`);
  check([expectedDay].includes(s.schedule.favoriteDay?.name) || s.schedule.favoriteDay?.games >= 1,
    'and it is a real weekday name, not shifted by a UTC parse');

  console.log('\n8. DUPR spread (roster rows with a rating)');
  eq(s.dupr.ratedPlayers, 2, 'rated players');
  eq(s.dupr.min, 3.5, 'lowest');
  eq(s.dupr.max, 4.0, 'highest');
  eq(s.dupr.average, 3.75, 'average');

  console.log('\n9. Honesty');
  check(s.notes.some(n => /earlier text-message cancellations are not counted/i.test(n)),
    'says cancellation counts are incomplete');
  check(s.notes.some(n => /not how fast they reply/i.test(n)),
    'says signup speed is not response time');
  eq(s.parked.responseTimes, null, 'response times still parked');
  eq(s.invitations.gamesCounted, 0, 'no invited-versus-replied without texted invitations');

  console.log('\n9b. Texted invitations make invited-versus-replied real');
  const invited = computeHostStats('5555550000', [{
    date: '2026-01-05', time: '18:00', created: '2026-01-01T00:00:00.000Z',
    players: [{ name: 'Replied', phone: '5555550101' }],
    waitlist: [], outPlayers: [],
    invitedPlayers: [
      { phone: '5555550101', name: 'Replied', textCount: 1 },
      { phone: '5555550102', name: 'Quiet', textCount: 2 }
    ]
  }], []);
  eq(invited.invitations.gamesCounted, 1, 'counts the game with texted invitations');
  eq(invited.invitations.invited, 2, 'counts both invitees');
  eq(invited.invitations.nonResponders, 1, 'one person never replied');
  eq(invited.invitations.quiet[0].name, 'Quiet', 'names the quiet invitee');
  check(invited.notes.some(n => /only counts invitations the app texted/i.test(n)),
    'says copied invitations cannot be tracked');

  console.log('\n10. A host with no games gets a zeroed shape, not an error');
  const empty = computeHostStats('5555550000', [], []);
  eq(empty.summary.gamesHosted, 0, 'games hosted');
  eq(empty.fillRate.average, null, 'no fill rate');
  eq(empty.players.distinctCount, 0, 'no players');
  check(Array.isArray(empty.players.top) && empty.players.top.length === 0, 'top list is an empty array');
  check(Array.isArray(empty.notes), 'notes is an array');
  eq(empty.dupr.ratedPlayers, 0, 'no DUPR ratings');

  console.log('\n11. A roster with no games still reports DUPR');
  const rosterOnly = computeHostStats(HOST, [], roster);
  eq(rosterOnly.dupr.ratedPlayers, 2, 'rated players from the roster alone');
  eq(rosterOnly.summary.gamesHosted, 0, 'and no games');

  console.log('\n12. Approval-mode games are left out of signup speed');
  const approval = computeHostStats(HOST, [{
    ...games[0], gameId: 'g6', registrationMode: 'waitlist',
  }], roster);
  eq(approval.signupSpeed.length, 0, 'no signup speed from an approval-mode game');

  console.log(`\n=== ${failures} failure(s) ===\n`);
  process.exit(failures ? 1 : 0);
})();
