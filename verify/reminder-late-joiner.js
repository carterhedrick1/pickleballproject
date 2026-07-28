// Late joiner reminder verification. Stubs sendSMS so NOTHING is ever actually texted.
// Runs in-process against the local SQLite database; no server needed.
//   npm run verify:late-joiner
//
// The bug this pins down: once every player on a game had been reminded, the game was cached
// as finished and skipped on every later check. Anyone who joined after that point never got
// a 24-hour reminder at all. It is a silent drop, not a duplicate, so nothing surfaced it.
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const { cleanupTestGames } = require('./_cleanup');

// Patch sendSMS BEFORE game-logic requires it (game-logic destructures at load time).
const smsHandler = require(ROOT + '/sms-handler');
let sent = [];
smsHandler.sendSMS = async (phone, message) => {
  sent.push({ phone, message });
  return { success: true, stubbed: true };
};

const db = require(ROOT + '/database');
const { checkAndSendReminders } = require(ROOT + '/game-logic');
const { getCentralTimeNow } = require(ROOT + '/utils/central-time');

let failures = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); failures++; };

// Same wall-clock frame the reminder system uses, so "12 hours from now" means the same
// thing to the test and to the code.
function offsetGame(hours) {
  const t = new Date(getCentralTimeNow().getTime() + hours * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return {
    date: `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}`,
    time: `${p(t.getHours())}:${p(t.getMinutes())}`,
  };
}

function makeGame(hours, players, extra = {}) {
  const { date, time } = offsetGame(hours);
  return {
    location: 'Test Court', organizerName: 'Host',
    organizerPhone: '', organizerPlaying: false, date, time, duration: 90,
    totalPlayers: 8, message: '', registrationMode: 'fcfs', waitlist: [], outPlayers: [],
    cancelled: false, created: new Date().toISOString(),
    notificationPreferences: {},
    players,
    ...extra,
  };
}

const player = (n) => ({
  id: `p${n}`,
  name: `Player ${n}`,
  phone: `+1555222000${n}`,
  joinedAt: new Date().toISOString(),
});

const textsTo = (phone) => sent.filter((s) => s.phone === phone).length;

(async () => {
  await db.initializeDatabase();
  await new Promise((r) => setTimeout(r, 500));

  const gameId = 'test-latejoin-' + Date.now().toString(36);

  // A game 12 hours out, so it is already inside the 24-hour reminder window.
  await db.saveGame(gameId, makeGame(12, [player(1), player(2)]), 'tok-lj', null);

  console.log('\n=== Run 1: the two players already on the roster get reminded ===');
  sent = [];
  await checkAndSendReminders();
  textsTo('+15552220001') === 1 && textsTo('+15552220002') === 1
    ? ok('both original players reminded exactly once')
    : bad(`expected 1 text each, got ${textsTo('+15552220001')} and ${textsTo('+15552220002')}`);

  // This is the moment the bug is created: every player is now reminded, so the game gets
  // cached as done. A real signup landing here is an ordinary, common event.
  console.log('\n=== A third player joins AFTER everyone else was reminded ===');
  const game = await db.getGame(gameId);
  game.players.push(player(3));
  await db.saveGame(gameId, game, 'tok-lj', null);
  console.log(`     roster is now ${game.players.length} players; +15552220003 has never been texted`);

  console.log('\n=== Run 2: the late joiner must still get a reminder ===');
  sent = [];
  await checkAndSendReminders();
  const lateJoinerTexts = textsTo('+15552220003');
  lateJoinerTexts === 1
    ? ok('late joiner reminded exactly once')
    : bad(`late joiner got ${lateJoinerTexts} reminders, expected 1 - they were silently skipped`);

  console.log('\n=== ...without re-texting anyone who was already reminded ===');
  textsTo('+15552220001') === 0 && textsTo('+15552220002') === 0
    ? ok('no duplicate reminders to the original two players')
    : bad(`resent to already-reminded players (${textsTo('+15552220001')}, ${textsTo('+15552220002')})`);

  console.log('\n=== Run 3: nobody is texted again once the whole roster is covered ===');
  sent = [];
  await checkAndSendReminders();
  const anyResend = sent.filter((s) => s.phone.startsWith('+1555222')).length;
  anyResend === 0 ? ok('steady state: no further texts') : bad(`resent ${anyResend} reminders`);

  console.log('\n=== A player who joins and is removed again is not texted ===');
  const g2 = await db.getGame(gameId);
  g2.players.push(player(4));
  await db.saveGame(gameId, g2, 'tok-lj', null);
  const g3 = await db.getGame(gameId);
  g3.players = g3.players.filter((p) => p.phone !== '+15552220004');
  await db.saveGame(gameId, g3, 'tok-lj', null);
  sent = [];
  await checkAndSendReminders();
  textsTo('+15552220004') === 0
    ? ok('player who left before the check was not texted')
    : bad('texted a player who is no longer on the roster');

  console.log('\n=== The durable log agrees with what was sent ===');
  for (const n of [1, 2, 3]) {
    const logged = await db.hasReminderBeenSent(gameId, `+1555222000${n}`, 'twenty_four_hours');
    logged ? ok(`player ${n} recorded in reminder_log`) : bad(`player ${n} missing from reminder_log`);
  }

  console.log(`\n=== ${failures} failure(s) ===\n`);
  await db.closeDatabaseConnection?.();
  await cleanupTestGames();
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR:', e); process.exit(1); });
