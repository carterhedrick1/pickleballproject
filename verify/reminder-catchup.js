// Reminder catch-up verification. Stubs sendSMS so NOTHING is ever actually texted.
// Runs in-process against the local SQLite database; no server needed.
//   npm run verify:reminders
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

// Build a date/time string N hours from "now" in the same wall-clock frame the reminder
// system uses, so the test and the code agree on what "12 hours from now" means.
function offsetGame(hours) {
  const t = new Date(getCentralTimeNow().getTime() + hours * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return {
    date: `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}`,
    time: `${p(t.getHours())}:${p(t.getMinutes())}`,
  };
}

function makeGame(hours, extra = {}) {
  const { date, time } = offsetGame(hours);
  return {
    location: 'Test Court', organizerName: 'Host',
    organizerPhone: '', organizerPlaying: false, date, time, duration: 90,
    totalPlayers: 4, message: '', registrationMode: 'fcfs', waitlist: [], outPlayers: [],
    cancelled: false, created: new Date().toISOString(),
    notificationPreferences: {},
    players: [
      { id: 'p1', name: 'Player One', phone: '+15551110001', joinedAt: new Date().toISOString() },
      { id: 'p2', name: 'Player Two', phone: '+15551110002', joinedAt: new Date().toISOString() },
    ],
    ...extra,
  };
}

(async () => {
  await db.initializeDatabase();
  await new Promise((r) => setTimeout(r, 500));

  const ids = {
    catchup: 'test-catchup-' + Date.now().toString(36),
    tooEarly: 'test-early-' + Date.now().toString(36),
    past: 'test-past-' + Date.now().toString(36),
    cancelled: 'test-cancel-' + Date.now().toString(36),
    today: 'test-today-' + Date.now().toString(36),
  };

  // 12h out: well past the old 5-minute window, so the OLD code sent nothing here.
  await db.saveGame(ids.catchup, makeGame(12), 'tok1', null);
  await db.saveGame(ids.tooEarly, makeGame(30), 'tok2', null);          // >24h away
  await db.saveGame(ids.past, makeGame(-5), 'tok3', null);              // already happened
  await db.saveGame(ids.cancelled, makeGame(10, { cancelled: true }), 'tok4', null);
  await db.saveGame(ids.today, makeGame(2), 'tok5', null);              // later today

  console.log('\n=== Run 1: catch-up should fire for missed reminders ===');
  sent = [];
  await checkAndSendReminders();
  const r1 = sent.filter((s) => s.phone.startsWith('+1555111'));
  r1.length === 4
    ? ok(`sent 4 reminders (2 players x 2 eligible games) - catch-up works`)
    : bad(`expected 4 reminders, got ${r1.length}`);

  const wentToPast = sent.some((s) => s.message.includes('Test Court') && false);
  console.log('     messages:');
  for (const s of r1) console.log(`       ${s.phone}: ${s.message.slice(0, 92)}`);

  console.log('\n=== Wording is accurate (no "tomorrow" for a game today) ===');
  // Which day each game really falls on depends on the time of day this runs: 12 hours from
  // 8am is still today, 12 hours from 8pm is tomorrow. Work out the right word per game rather
  // than assuming, or this passes and fails depending on when you happen to run it.
  const centralToday = offsetGame(0).date;
  const expectedWord = (hours) => (offsetGame(hours).date === centralToday ? 'today' : 'tomorrow');
  // Both games are at Test Court, so they are told apart by the start time in the message.
  const messageFor = (hours) => {
    const label = smsHandler.formatTimeForSMS(offsetGame(hours).time);
    return r1.find((s) => s.message.includes(`at ${label} at`));
  };

  for (const hours of [2, 12]) {
    const word = expectedWord(hours);
    const msg = messageFor(hours);
    // A reminder only goes out inside 24 hours, so the answer is always today or tomorrow -
    // there is no explicit-date wording to allow for, and so nothing to hide a wrong word behind.
    if (!msg) {
      bad(`game ${hours}h away: no reminder found for its start time`);
    } else if (new RegExp(`\\b${word}\\b`).test(msg.message)) {
      ok(`game ${hours}h away says "${word}", which is correct`);
    } else {
      bad(`game ${hours}h away should say "${word}": ${msg.message.slice(0, 80)}`);
    }
  }
  r1.every((s) => !(/tomorrow/.test(s.message) && /today/.test(s.message)))
    ? ok('no message contains contradictory wording')
    : bad('a message said both today and tomorrow');

  console.log('\n=== Run 2 (immediately after): must NOT resend ===');
  sent = [];
  await checkAndSendReminders();
  const r2 = sent.filter((s) => s.phone.startsWith('+1555111'));
  r2.length === 0 ? ok('no duplicate reminders on a second run') : bad(`resent ${r2.length} reminders`);

  console.log('\n=== Run 3 (simulating a process restart: in-memory caches cleared) ===');
  // Durable reminder_log must be what prevents resends, not the in-memory cache.
  delete require.cache[require.resolve(ROOT + '/game-logic')];
  const fresh = require(ROOT + '/game-logic');
  sent = [];
  await fresh.checkAndSendReminders();
  const r3 = sent.filter((s) => s.phone.startsWith('+1555111'));
  r3.length === 0
    ? ok('still no duplicates after a restart (reminder_log is authoritative)')
    : bad(`resent ${r3.length} reminders after restart - DB dedup is not working`);

  console.log('\n=== Games that must never be reminded ===');
  const log = [];
  for (const [label, id] of [['30h away', ids.tooEarly], ['in the past', ids.past], ['cancelled', ids.cancelled]]) {
    const wasSent = await db.hasReminderBeenSent(id, '+15551110001', 'twenty_four_hours');
    wasSent ? bad(`${label} game WAS reminded`) : ok(`${label} game not reminded`);
    log.push(label);
  }

  console.log(`\n=== ${failures} failure(s) ===\n`);
  await db.closeDatabaseConnection?.();
  await cleanupTestGames();
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR:', e); process.exit(1); });
