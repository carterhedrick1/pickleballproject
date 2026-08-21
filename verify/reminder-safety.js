// Verifies the duplicate-send safeguards. Stubs sendSMS so NOTHING is ever actually texted.
// Runs in-process against the local SQLite database; no server needed.
//   npm run verify:reminder-safety
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const { cleanupTestGames } = require('./_cleanup');

const smsClient = require(ROOT + '/services/sms-client');
let attempts = [];
// One stable wrapper installed once; behaviour is swapped per test via smsBehavior.
let smsBehavior = async () => ({ success: true, stubbed: true });
smsClient.sendSMS = async (phone, message) => {
  attempts.push({ phone, message, at: Date.now() });
  return smsBehavior(phone, message);
};

const { initializeDatabase } = require(ROOT + '/database/schema');
const { saveGame } = require(ROOT + '/database/games');
const { closeDatabaseConnection } = require(ROOT + '/database/context');
const { checkAndSendReminders } = require(ROOT + '/services/reminders');
const { getCentralTimeNow } = require(ROOT + '/utils/central-time');

let failures = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); failures++; };

function makeGame(hours, phones) {
  const t = new Date(getCentralTimeNow().getTime() + hours * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return {
    location: 'Safety Court', organizerName: 'Host', organizerPhone: '',
    organizerPlaying: false,
    date: `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}`,
    time: `${p(t.getHours())}:${p(t.getMinutes())}`,
    duration: 90, totalPlayers: 8, message: '', registrationMode: 'fcfs',
    waitlist: [], outPlayers: [], cancelled: false, created: new Date().toISOString(),
    notificationPreferences: {},
    // Signed up two days ago: a signup from minutes ago is held back from the 24-hour
    // reminder on purpose, and these tests are about duplicate sends, not join recency.
    players: phones.map((phone, i) => ({
      id: 'p' + i, name: 'Player ' + i, phone,
      joinedAt: new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString(),
    })),
  };
}

(async () => {
  await initializeDatabase();
  await new Promise((r) => setTimeout(r, 500));

  // --- Test A: a number that always fails must stop after MAX_SEND_ATTEMPTS ---
  console.log('\n=== A: permanently failing send is capped (not retried forever) ===');
  const failGame = 'test-safety-fail-' + Date.now().toString(36);
  await saveGame(failGame, makeGame(6, ['+15552220001']), 'tokA', null);

  smsBehavior = async () => ({ success: false, error: 'simulated network failure' });
  attempts = [];
  for (let i = 0; i < 8; i++) await checkAndSendReminders();
  const failTries = attempts.filter((a) => a.phone === '+15552220001').length;
  failTries === 3
    ? ok(`stopped after 3 attempts across 8 checks (was unbounded: would be 8, and ~720 in production)`)
    : bad(`expected 3 attempts, got ${failTries}`);

  // --- Test B: overlapping runs must not double-send ---
  console.log('\n=== B: two overlapping checks must not both text the same player ===');
  const raceGame = 'test-safety-race-' + Date.now().toString(36);
  await saveGame(raceGame, makeGame(6, ['+15553330001', '+15553330002']), 'tokB', null);

  // Slow send so the second check starts while the first is still awaiting Textbelt.
  smsBehavior = async () => {
    await new Promise((r) => setTimeout(r, 400));
    return { success: true, stubbed: true };
  };
  attempts = [];
  await Promise.all([checkAndSendReminders(), checkAndSendReminders()]);
  const raceTries = attempts.filter((a) => a.phone.startsWith('+1555333'));
  const perPhone = {};
  for (const a of raceTries) perPhone[a.phone] = (perPhone[a.phone] || 0) + 1;
  const anyDuplicate = Object.values(perPhone).some((n) => n > 1);
  !anyDuplicate
    ? ok(`no player texted twice by concurrent checks (${JSON.stringify(perPhone)})`)
    : bad(`duplicate sends from overlapping runs: ${JSON.stringify(perPhone)}`);
  raceTries.length === 2 ? ok('both players still reminded exactly once') : bad(`expected 2 sends, got ${raceTries.length}`);

  // --- Test C: a successful send is still never repeated ---
  console.log('\n=== C: successful sends are not repeated on later checks ===');
  attempts = [];
  await checkAndSendReminders();
  const repeats = attempts.filter((a) => a.phone.startsWith('+1555333')).length;
  repeats === 0 ? ok('no repeat sends after success') : bad(`resent ${repeats} times`);

  console.log(`\n=== ${failures} failure(s) ===\n`);
  await closeDatabaseConnection?.();
  await cleanupTestGames();
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR:', e); process.exit(1); });
