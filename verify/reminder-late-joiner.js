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

// The reminder service holds the sms-client module and resolves sendSMS at call time, so
// replacing it here is enough - no matter what has already been required.
const smsClient = require(ROOT + '/services/sms-client');
let sent = [];
smsClient.sendSMS = async (phone, message) => {
  sent.push({ phone, message });
  return { success: true, stubbed: true };
};

const { initializeDatabase } = require(ROOT + '/database/schema');
const { saveGame, getGame } = require(ROOT + '/database/games');
const { hasReminderBeenSent } = require(ROOT + '/database/messaging-reminders');
const { closeDatabaseConnection } = require(ROOT + '/database/context');
const { checkAndSendReminders } = require(ROOT + '/services/reminders');
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

// Hours, not days: the quiet window below is measured in hours.
const hoursAgo = (hours) => new Date(Date.now() - hours * 3600 * 1000).toISOString();

// Settled players signed up well before the reminder window, which is the ordinary case.
// A player who signed up minutes ago is a separate case, tested at the end of this file.
const player = (n, joinedAt = hoursAgo(30)) => ({
  id: `p${n}`,
  name: `Player ${n}`,
  phone: `+1555222000${n}`,
  joinedAt,
});

const textsTo = (phone) => sent.filter((s) => s.phone === phone).length;

(async () => {
  await initializeDatabase();
  await new Promise((r) => setTimeout(r, 500));

  const gameId = 'test-latejoin-' + Date.now().toString(36);

  // A game 12 hours out, so it is already inside the 24-hour reminder window.
  await saveGame(gameId, makeGame(12, [player(1), player(2)]), 'tok-lj', null);

  console.log('\n=== Run 1: the two players already on the roster get reminded ===');
  sent = [];
  await checkAndSendReminders();
  textsTo('+15552220001') === 1 && textsTo('+15552220002') === 1
    ? ok('both original players reminded exactly once')
    : bad(`expected 1 text each, got ${textsTo('+15552220001')} and ${textsTo('+15552220002')}`);

  // This is the moment the bug is created: every player is now reminded, so the game gets
  // cached as done. A real signup landing here is an ordinary, common event.
  console.log('\n=== A third player joins AFTER everyone else was reminded ===');
  const game = await getGame(gameId);
  game.players.push(player(3));
  await saveGame(gameId, game, 'tok-lj', null);
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
  const g2 = await getGame(gameId);
  g2.players.push(player(4));
  await saveGame(gameId, g2, 'tok-lj', null);
  const g3 = await getGame(gameId);
  g3.players = g3.players.filter((p) => p.phone !== '+15552220004');
  await saveGame(gameId, g3, 'tok-lj', null);
  sent = [];
  await checkAndSendReminders();
  textsTo('+15552220004') === 0
    ? ok('player who left before the check was not texted')
    : bad('texted a player who is no longer on the roster');

  console.log('\n=== A player who signs up minutes ago is not "reminded" about it ===');
  // The double-text: joining a game already inside the 24-hour window produced a "You're IN"
  // text and then, a couple of minutes later, a reminder about the game they had just chosen.
  const g4 = await getGame(gameId);
  g4.players.push(player(5, new Date().toISOString()));
  await saveGame(gameId, g4, 'tok-lj', null);
  sent = [];
  await checkAndSendReminders();
  textsTo('+15552220005') === 0
    ? ok('signup from moments ago was not immediately reminded')
    : bad(`fresh signup got ${textsTo('+15552220005')} reminder(s) minutes after joining`);

  console.log('\n=== ...but is reminded once the quiet window has passed ===');
  // Held, not dropped. Backdating the signup is how "three hours later" happens in a test.
  const g5 = await getGame(gameId);
  const held = g5.players.find((p) => p.phone === '+15552220005');
  held.joinedAt = hoursAgo(4);
  await saveGame(gameId, g5, 'tok-lj', null);
  sent = [];
  await checkAndSendReminders();
  textsTo('+15552220005') === 1
    ? ok('held reminder was delivered on a later check, exactly once')
    : bad(`expected 1 reminder after the quiet window, got ${textsTo('+15552220005')}`);

  console.log('\n=== The durable log agrees with what was sent ===');
  for (const n of [1, 2, 3]) {
    const logged = await hasReminderBeenSent(gameId, `+1555222000${n}`, 'twenty_four_hours');
    logged ? ok(`player ${n} recorded in reminder_log`) : bad(`player ${n} missing from reminder_log`);
  }

  console.log(`\n=== ${failures} failure(s) ===\n`);
  await closeDatabaseConnection?.();
  await cleanupTestGames();
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR:', e); process.exit(1); });
