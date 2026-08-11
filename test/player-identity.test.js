const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const PlayerIdentity = require('../public/js/player-identity');

/** A stand-in for localStorage, including the browsers that refuse to co-operate. */
function fakeStorage({ failing = false, initial = null } = {}) {
  let value = initial;
  return {
    getItem() {
      if (failing) throw new Error('storage disabled');
      return value;
    },
    setItem(key, next) {
      if (failing) throw new Error('storage disabled');
      value = next;
    },
    removeItem() {
      if (failing) throw new Error('storage disabled');
      value = null;
    },
    peek: () => value
  };
}

describe('player identity storage', () => {
  it('saves a player and reads them back', () => {
    const storage = fakeStorage();
    assert.equal(PlayerIdentity.save({ name: 'Priya Patel', phone: '(312) 555-0101' }, storage), true);
    assert.deepEqual(PlayerIdentity.read(storage), { name: 'Priya Patel', phone: '3125550101' });
  });

  it('drops the country code so the saved number matches the roster', () => {
    const storage = fakeStorage();
    PlayerIdentity.save({ name: 'Priya', phone: '1-312-555-0101' }, storage);
    assert.equal(PlayerIdentity.read(storage).phone, '3125550101');
  });

  it('refuses to remember a half-filled identity', () => {
    const storage = fakeStorage();
    assert.equal(PlayerIdentity.save({ name: 'Priya', phone: '312555' }, storage), false);
    assert.equal(PlayerIdentity.save({ name: '   ', phone: '3125550101' }, storage), false);
    assert.equal(PlayerIdentity.save(null, storage), false);
    assert.equal(PlayerIdentity.read(storage), null);
  });

  it('treats corrupt or outdated saved data as nobody', () => {
    assert.equal(PlayerIdentity.read(fakeStorage({ initial: 'not json' })), null);
    assert.equal(PlayerIdentity.read(fakeStorage({ initial: '"just a string"' })), null);
    assert.equal(PlayerIdentity.read(fakeStorage({ initial: '{"name":"Priya"}' })), null);
    assert.equal(PlayerIdentity.read(fakeStorage({ initial: '{"phone":"3125550101"}' })), null);
  });

  it('forgets the player on request', () => {
    const storage = fakeStorage();
    PlayerIdentity.save({ name: 'Priya Patel', phone: '3125550101' }, storage);
    PlayerIdentity.clear(storage);
    assert.equal(PlayerIdentity.read(storage), null);
  });

  it('never throws when the browser blocks storage', () => {
    const blocked = fakeStorage({ failing: true });
    assert.equal(PlayerIdentity.read(blocked), null);
    assert.equal(PlayerIdentity.save({ name: 'Priya Patel', phone: '3125550101' }, blocked), false);
    assert.doesNotThrow(() => PlayerIdentity.clear(blocked));
    assert.equal(PlayerIdentity.read(null), null);
    assert.equal(PlayerIdentity.save({ name: 'Priya Patel', phone: '3125550101' }, null), false);
  });

  it('formats a phone number the way a player wrote it', () => {
    assert.equal(PlayerIdentity.prettyPhone('3125550101'), '(312) 555-0101');
    assert.equal(PlayerIdentity.prettyPhone('13125550101'), '(312) 555-0101');
    assert.equal(PlayerIdentity.prettyPhone('312555'), '312555');
    assert.equal(PlayerIdentity.prettyPhone(''), '');
  });

  it('greets a player by their first name', () => {
    assert.equal(PlayerIdentity.firstName('Priya Patel'), 'Priya');
    assert.equal(PlayerIdentity.firstName('  Marcus  '), 'Marcus');
    assert.equal(PlayerIdentity.firstName(''), '');
  });
});
