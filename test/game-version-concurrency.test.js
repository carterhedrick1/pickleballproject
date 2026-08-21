// Proof that overlapping game writes cannot lose a roster change.
//
// utils/game-lock.js already queues mutations inside one Node process, so these tests
// deliberately go around it and talk to the repository directly: that is exactly what a
// second app instance would do, and it is the case the in-memory lock cannot cover.
//
// Game ids use the gate-version- prefix so parallel test files sharing the local SQLite
// database cannot collide.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { initializeDatabase } = require('../database/schema');
const { getGame, saveGame, updateGame, deleteGamePermanently } = require('../database/games');
const { sqliteGet } = require('../database/context');

const { updateDeveloperPlayer } = require('../database/dev-rosters');

const ids = {
  stale: 'gate-version-stale',
  retry: 'gate-version-retry',
  exhausted: 'gate-version-exhausted',
  blob: 'gate-version-blob',
  devEdit: 'gate-version-dev-edit'
};

// Only this game uses these numbers, so the developer-area edit below cannot reach into
// games other test files are working on.
const DEV_EDIT_PHONE = '5556120001';
const DEV_EDIT_NEW_PHONE = '5556120002';

function newGame(extra = {}) {
  return {
    gameName: 'Version Test',
    date: '2026-09-01',
    time: '18:00',
    location: 'Char Bar',
    totalPlayers: 8,
    players: [],
    waitlist: [],
    hostToken: 'tok-version',
    hostPhone: null,
    ...extra
  };
}

const player = (name) => ({ id: `p-${name}`, name, phone: null, joinedAt: '2026-08-20T00:00:00.000Z' });
const names = (game) => (game.players || []).map((entry) => entry.name).sort();

/** Releases every waiting caller once `count` of them have arrived. */
function createBarrier(count) {
  let arrived = 0;
  let open;
  const gate = new Promise((resolve) => { open = resolve; });
  return () => {
    arrived += 1;
    if (arrived >= count) open();
    return gate;
  };
}

before(async () => {
  await initializeDatabase();
  for (const id of Object.values(ids)) {
    await deleteGamePermanently(id);
    const game = id === ids.devEdit
      ? newGame({ players: [{ ...player('Renamable'), phone: `+1${DEV_EDIT_PHONE}` }] })
      : newGame();
    await saveGame(id, game, 'tok-version', null);
  }
});

after(async () => {
  for (const id of Object.values(ids)) {
    await deleteGamePermanently(id);
  }
});

describe('optimistic concurrency on game writes', () => {
  it('gives a newly created game a version, and every save moves it on', async () => {
    const created = await getGame(ids.stale);
    assert.equal(created.version, 1, 'a fresh insert starts at version 1');

    created.players.push(player('First'));
    await saveGame(ids.stale, created, created.hostToken, created.hostPhone);

    const saved = await getGame(ids.stale);
    assert.equal(saved.version, 2);
    assert.deepEqual(names(saved), ['First']);
  });

  it('refuses a write from a copy that was read before someone else wrote', async () => {
    // Two readers, one game, the shape of two instances serving the same signup link.
    const readerA = await getGame(ids.stale);
    const readerB = await getGame(ids.stale);
    assert.equal(readerA.version, readerB.version);

    readerA.players.push(player('Ada'));
    await saveGame(ids.stale, readerA, readerA.hostToken, readerA.hostPhone);

    readerB.players.push(player('Bo'));
    await assert.rejects(
      () => saveGame(ids.stale, readerB, readerB.hostToken, readerB.hostPhone),
      (err) => {
        assert.equal(err.code, 'GAME_VERSION_CONFLICT');
        assert.equal(err.gameId, ids.stale);
        return true;
      },
      'the stale write must be refused, not applied'
    );

    // Without the version check, reader B's save would have written a roster that never
    // contained Ada - the lost update this whole mechanism exists to prevent.
    const stored = await getGame(ids.stale);
    assert.deepEqual(names(stored), ['Ada', 'First']);
  });

  it('keeps both roster changes when two overlapping updates race', async () => {
    const bothHaveRead = createBarrier(2);

    // Each caller reads, then waits for the other to have read too, so the writes are
    // guaranteed to overlap. Whichever loses re-reads and re-applies.
    const join = (name) =>
      updateGame(ids.retry, async (game, attempt) => {
        game.players.push(player(name));
        if (attempt === 1) await bothHaveRead();
        return { save: true, result: { name, attempt } };
      });

    const [first, second] = await Promise.all([join('Cleo'), join('Dev')]);

    const stored = await getGame(ids.retry);
    assert.deepEqual(names(stored), ['Cleo', 'Dev'], 'neither signup may be erased');
    assert.equal(stored.version, 3, 'one insert plus two saves');

    // Exactly one of them had to try twice; the other won the first time.
    const attempts = [first.attempt, second.attempt].sort();
    assert.deepEqual(attempts, [1, 2]);
  });

  it('gives up rather than looping forever when conflicts never clear', async () => {
    const stale = await getGame(ids.exhausted);

    await assert.rejects(
      () => updateGame(
        ids.exhausted,
        async (game) => {
          game.players.push(player('Eve'));
          // Simulate another writer landing between every read and write.
          const current = await getGame(ids.exhausted);
          current.players.push(player(`Interloper-${current.version}`));
          await saveGame(ids.exhausted, current, current.hostToken, current.hostPhone);
          return { save: true, result: 'never gets here' };
        },
        { attempts: 2 }
      ),
      (err) => err.code === 'GAME_VERSION_CONFLICT'
    );

    const stored = await getGame(ids.exhausted);
    assert.ok(stored.version > stale.version, 'the interloping writes still landed');
    assert.ok(!names(stored).includes('Eve'), 'the abandoned change was never written');
  });

  it('never writes the version into the stored game data', async () => {
    const game = await getGame(ids.blob);
    game.players.push(player('Fern'));
    await saveGame(ids.blob, game, game.hostToken, game.hostPhone);

    const row = await sqliteGet('SELECT data, version FROM games WHERE id = ?', [ids.blob]);
    const stored = JSON.parse(row.data);
    assert.equal(stored.version, undefined, 'version belongs to the column, not the blob');
    assert.equal(row.version, 2);
    assert.deepEqual(stored.players.map((entry) => entry.name), ['Fern']);
  });

  it('moves the version when the developer area rewrites a roster', async () => {
    // The Players tab edits every game at once with its own SQL rather than saveGame. If it
    // left the version alone, a signup read a moment earlier could be saved on top and
    // quietly bring back the player Scott just renamed.
    const before = await getGame(ids.devEdit);
    assert.deepEqual(names(before), ['Renamable']);

    const result = await updateDeveloperPlayer(DEV_EDIT_PHONE, DEV_EDIT_NEW_PHONE, 'Renamed');
    assert.equal(result.gameOccurrences, 1);

    const after = await getGame(ids.devEdit);
    assert.equal(after.version, before.version + 1, 'the bulk edit moved the version');
    assert.deepEqual(names(after), ['Renamed']);

    before.players.push(player('Sneaky'));
    await assert.rejects(
      () => saveGame(ids.devEdit, before, before.hostToken, before.hostPhone),
      (err) => err.code === 'GAME_VERSION_CONFLICT'
    );
    assert.deepEqual(names(await getGame(ids.devEdit)), ['Renamed']);
  });

  it('lets a caller opt out of the check for an unconditional write', async () => {
    const stale = await getGame(ids.blob);
    const fresh = await getGame(ids.blob);
    fresh.players.push(player('Gus'));
    await saveGame(ids.blob, fresh, fresh.hostToken, fresh.hostPhone);

    // expectedVersion: null is what game creation uses - there is nothing to compare to.
    stale.players.push(player('Hal'));
    await saveGame(ids.blob, stale, stale.hostToken, stale.hostPhone, { expectedVersion: null });

    const stored = await getGame(ids.blob);
    assert.deepEqual(names(stored), ['Fern', 'Hal'], 'an unconditional write wins on purpose');
  });
});
