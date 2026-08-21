// Game-day reminder verification. Stubs sendSMS so NOTHING is ever actually texted.
// Runs in-process against the local SQLite database; no server needed.
//   npm run verify:game-day
//
// Two reminders now exist, and the thing that must never happen is both landing at once. A
// game created the same afternoon it is played is inside both lead times from the moment it
// exists, so overlapping windows would send two texts in the same pass.
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const { cleanupTestGames } = require('./_cleanup');

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
const { centralWallClock } = require(ROOT + '/public/js/central-time');

let failures = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); failures++; };

function offsetGame(hours) {
  return centralWallClock(new Date(Date.now() + hours * 3600 * 1000));
}

// Settled players: a signup from minutes ago is held back on purpose.
const hoursAgo = (hours) => new Date(Date.now() - hours * 3600 * 1000).toISOString();

function makeGame(hours, phone) {
  const { date, time } = offsetGame(hours);
  return {
    location: 'Game Day Court', organizerName: 'Host', organizerPhone: '',
    organizerPlaying: false, date, time, duration: 90, totalPlayers: 8,
    message: '', registrationMode: 'fcfs', waitlist: [], outPlayers: [],
    cancelled: false, created: new Date().toISOString(), notificationPreferences: {},
    players: [{ id: 'p1', name: 'Player One', phone, joinedAt: hoursAgo(40) }],
  };
}

const textsTo = (phone) => sent.filter((s) => s.phone === phone).length;
const messagesTo = (phone) => sent.filter((s) => s.phone === phone).map((s) => s.message);

(async () => {
  await initializeDatabase();
  await new Promise((r) => setTimeout(r, 500));

  const stamp = Date.now().toString(36);
  const ids = {
    dayBefore: 'test-gameday-24-' + stamp,
    soon: 'test-gameday-2-' + stamp,
    early: 'test-gameday-early-' + stamp,
  };

  // 12 hours out: inside the 24-hour window, nowhere near the game-day one.
  await saveGame(ids.dayBefore, makeGame(12, '+15554440001'), 'tokA', null);
  // 1 hour out: inside the game-day window only.
  await saveGame(ids.soon, makeGame(1, '+15554440002'), 'tokB', null);
  // 30 hours out: too early for either.
  await saveGame(ids.early, makeGame(30, '+15554440003'), 'tokC', null);

  console.log('\n=== A game a day away gets the 24-hour reminder, and only that ===');
  sent = [];
  await checkAndSendReminders();
  textsTo('+15554440001') === 1
    ? ok('exactly one reminder')
    : bad(`expected 1 reminder, got ${textsTo('+15554440001')}`);
  /is (today|tomorrow)/.test(messagesTo('+15554440001')[0] || '')
    ? ok('it is the 24-hour wording')
    : bad(`wrong wording: ${messagesTo('+15554440001')[0]}`);

  console.log('\n=== A game starting within the hour gets the game-day reminder instead ===');
  const soonMessage = messagesTo('+15554440002')[0] || '';
  textsTo('+15554440002') === 1
    ? ok('exactly one reminder - not one of each')
    : bad(`expected 1 reminder, got ${textsTo('+15554440002')}: ${messagesTo('+15554440002').join(' || ')}`);
  /starts at/.test(soonMessage)
    ? ok('it is the game-day wording')
    : bad(`wrong wording: ${soonMessage}`);
  !/tomorrow/.test(soonMessage)
    ? ok('it does not say "tomorrow" about a game starting within the hour')
    : bad(`says tomorrow: ${soonMessage}`);

  console.log('\n=== A game 30 hours out is still too early for anything ===');
  textsTo('+15554440003') === 0
    ? ok('not reminded yet')
    : bad(`reminded too early (${textsTo('+15554440003')})`);

  console.log('\n=== Neither reminder repeats on later checks ===');
  sent = [];
  await checkAndSendReminders();
  const resent = sent.filter((s) => s.phone.startsWith('+1555444')).length;
  resent === 0 ? ok('steady state: no further texts') : bad(`resent ${resent}`);

  console.log('\n=== A player reminded a day out still gets the game-day reminder later ===');
  // Same game, moved so that it now starts in an hour: the 24-hour reminder is already
  // logged, so only the second one may go out.
  const game = await getGame(ids.dayBefore);
  Object.assign(game, offsetGame(1));
  await saveGame(ids.dayBefore, game, 'tokA', null);
  sent = [];
  await checkAndSendReminders();
  textsTo('+15554440001') === 1
    ? ok('the second reminder is sent once')
    : bad(`expected 1 game-day reminder, got ${textsTo('+15554440001')}`);
  /starts at/.test(messagesTo('+15554440001')[0] || '')
    ? ok('and it is the game-day wording, not the 24-hour one again')
    : bad(`wrong wording: ${messagesTo('+15554440001')[0]}`);

  console.log('\n=== Both reminder types are recorded separately in the log ===');
  for (const [type, id, phone] of [
    ['twenty_four_hours', ids.dayBefore, '+15554440001'],
    ['game_day', ids.dayBefore, '+15554440001'],
    ['game_day', ids.soon, '+15554440002'],
  ]) {
    const logged = await hasReminderBeenSent(id, phone, type);
    logged ? ok(`${type} recorded for ${phone}`) : bad(`${type} missing for ${phone}`);
  }
  await hasReminderBeenSent(ids.soon, '+15554440002', 'twenty_four_hours')
    ? bad('the one-hour game was also logged as a 24-hour reminder')
    : ok('the one-hour game was never counted as a 24-hour reminder');

  console.log(`\n=== ${failures} failure(s) ===\n`);
  await closeDatabaseConnection?.();
  await cleanupTestGames();
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR:', e); process.exit(1); });
