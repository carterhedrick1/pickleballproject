const test = require('node:test');
const assert = require('node:assert/strict');
const { currentAttendance } = require('../public/js/current-attendance');
const { textableAudience } = require('../utils/game-audience');
const { joinPlayer, leavePlayer, promotePlayer } = require('../domain/player-transitions');
const { computeHostStats } = require('../stats');
const { invitationAvailability } = require('../public/js/invitation-availability');
const { generateInvitationMessage, buildInvitationMessage } = require('../public/js/invitation-generator');
const { buildDeterministicInvitation } = require('../services/invitation-message');
const { capacityExplanation } = require('../public/js/player-capacity');
const base = () => ({ date: '2099-01-01', time: '12:00', duration: 60, totalPlayers: 1,
  organizerPlaying: false, registrationMode: 'fcfs', players: [], waitlist: [], outPlayers: [] });
const person = { name: 'Test River', phone: '5555550111' };

test('confirmed and waiting rejoin have one current status, retaining cancellation history', () => {
  for (const full of [false, true]) {
    const game = base();
    if (full) joinPlayer(game, { name: 'Full', phone: '5555550112' });
    joinPlayer(game, person);
    leavePlayer(game, { phone: person.phone });
    joinPlayer(game, person);
    const current = currentAttendance(game);
    assert.equal(current.outPlayers.length, 0);
    assert.equal(current[full ? 'waitlist' : 'players'].filter(p => p.phone === person.phone).length, 1);
    assert.equal(textableAudience(game).filter(p => p.player.phone === person.phone).length, 1);
    assert.equal(game.outPlayers.length, 1);
    assert.equal(game.outPlayers[0][full ? 'wasWaitlisted' : 'wasConfirmed'], true);
  }
});

test('legacy formatted duplicates use current status and do not merge phoneless names', () => {
  const game = { players: [person], waitlist: [{ ...person, phone: '+1 (555) 555-0111' }],
    outPlayers: [{ ...person }, { name: 'Dave', id: 'a' }, { name: 'Dave', id: 'b' }] };
  assert.equal(currentAttendance(game).waitlist.length, 0);
  assert.equal(currentAttendance(game).outPlayers.length, 2);
});

test('invitation server and browser agree on full, open, host-selected, and non-playing availability', () => {
  const game = { ...base(), totalPlayers: 5, organizerPlaying: true,
    players: [{ isOrganizer: true }, {}, {}, {}, {}] };
  assert.match(invitationAvailability(game), /full.*waitlist/);
  for (const variant of [game, { ...game, players: game.players.slice(0, 2) },
    { ...game, registrationMode: 'waitlist' }, { ...base(), totalPlayers: 4 }]) {
    const detail = invitationAvailability(variant);
    assert.ok(generateInvitationMessage(variant, 'id', 'http://test').includes(detail));
    assert.ok(buildDeterministicInvitation(variant, 'id', 'http://test').includes(detail));
  }
  assert.match(invitationAvailability({ ...game, players: game.players.slice(0, 2) }), /Spots: 3/);
  assert.doesNotMatch(invitationAvailability({ ...game, registrationMode: 'waitlist' }), /First|Spots:|#\d/);
  assert.match(invitationAvailability({ ...base(), totalPlayers: 4 }), /Spots: 4/);
});

test('invitation fallback honors refusals and re-fetches availability when generation fails', async () => {
  const original = global.fetch;
  try {
    global.fetch = async () => new Response(JSON.stringify({ error: 'Cancelled' }), { status: 400 });
    await assert.rejects(buildInvitationMessage(base(), 'id', 'http://test', 'token'), /Cancelled/);
    let calls = 0;
    global.fetch = async () => ++calls === 1
      ? new Response('{}', { status: 503 })
      : new Response(JSON.stringify({ ...base(), players: [person] }));
    assert.match(await buildInvitationMessage(base(), 'id', 'http://test', 'token'), /full.*waitlist/);
    global.fetch = async () => { throw new Error('offline'); };
    await assert.rejects(buildInvitationMessage(base(), 'id', 'http://test', 'token'));
    await assert.rejects(buildInvitationMessage({ ...base(), cancelled: true }, 'id', 'http://test'));
    await assert.rejects(buildInvitationMessage({ ...base(), date: '2000-01-01' }, 'id', 'http://test'));
  } finally { global.fetch = original; }
});

test('finished registrations exclude upcoming and cancelled games; waiting evidence survives promotion', () => {
  const game = base();
  joinPlayer(game, { name: 'Full', phone: '5555550112' });
  const joined = joinPlayer(game, person);
  game.totalPlayers = 2;
  promotePlayer(game, joined.player.id);
  let stats = computeHostStats('5555550199', [game, { ...game, cancelled: true }]);
  assert.deepEqual(stats.players.top, []);
  assert.equal(stats.players.waitlistRegulars.find(p => p.name === person.name).times, 2);
  assert.equal(stats.players.currentlyWaiting, 0);
  stats = computeHostStats('5555550199', [{ ...game, date: '2000-01-01' }]);
  assert.equal(stats.players.top.find(p => p.name === person.name).games, 1);
  assert.match(stats.notes.join(' '), /not verified attendance/);
  const legacy = { ...base(), players: [{ ...person, promotedAt: '2000-01-01' }] };
  assert.equal(computeHostStats('', [legacy]).players.waitlistRegulars.length, 1);
  assert.equal(computeHostStats('', [{ ...legacy, registrationMode: 'waitlist' }]).players.waitlistRegulars.length, 0);
  assert.equal(computeHostStats('', [{ ...base(), players: [person] }]).players.waitlistRegulars.length, 0);
});

test('capacity explanation follows host playing status', () => {
  assert.equal(capacityExplanation(3, true), 'You + 3 others = 4 total players.');
  assert.equal(capacityExplanation(4, false), '4 total players. You are hosting, not playing.');
});


test('cleared OUT records remain historical cancellations without current recipients', () => {
  const game = { ...base(), cancellationHistory: [{ ...person, wasConfirmed: true, wasWaitlisted: true }] };
  const stats = computeHostStats('', [game]);
  assert.equal(stats.players.outs[0].confirmedCancels, 1);
  assert.equal(stats.players.waitlistRegulars[0].times, 1);
  assert.equal(textableAudience(game).length, 0);
});
