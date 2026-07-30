const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const {
  MAX_ATTEMPTS,
  createSessionToken,
  verifySessionToken,
  sendVerificationCode,
  confirmVerificationCode,
  resetChallengesForTests
} = require('../services/host-verification');

describe('host phone verification', () => {
  beforeEach(() => resetChallengesForTests());

  it('sends a one-time code and issues a phone-bound session after confirmation', async () => {
    let sent;
    await sendVerificationCode('5551234567', {
      code: '314159',
      now: 1000,
      send: async (phone, message, gameId, options) => {
        sent = { phone, message, gameId, options };
        return { success: true, dev: true };
      }
    });

    assert.equal(sent.phone, '5551234567');
    assert.match(sent.message, /314159/);
    assert.equal(sent.gameId, null);
    assert.equal(sent.options.eventId, 'host-verification-code');

    assert.throws(
      () => confirmVerificationCode('5551234567', '000000', 2000),
      /not correct/
    );

    const session = confirmVerificationCode('5551234567', '314159', 2000);
    assert.equal(verifySessionToken(session.token, '5551234567', 3000), true);
    assert.equal(verifySessionToken(session.token, '5559999999', 3000), false);
  });

  it('rejects expired, altered, and over-attempted credentials', async () => {
    await sendVerificationCode('5551234567', {
      code: '123456',
      now: 1000,
      send: async () => ({ success: true })
    });

    for (let attempt = 1; attempt < MAX_ATTEMPTS; attempt++) {
      assert.throws(
        () => confirmVerificationCode('5551234567', '000000', 2000),
        /not correct/
      );
    }
    assert.throws(
      () => confirmVerificationCode('5551234567', '000000', 2000),
      /Too many incorrect attempts/
    );
    assert.throws(
      () => confirmVerificationCode('5551234567', '123456', 2000),
      /expired/
    );

    const token = createSessionToken('5551234567', 5000);
    assert.equal(verifySessionToken(`${token}altered`, '5551234567', 6000), false);
    assert.equal(verifySessionToken(token, '5551234567', Number.MAX_SAFE_INTEGER), false);
  });

  it('limits code resends and does not retain a code when SMS delivery fails', async () => {
    const send = async () => ({ success: true });
    await sendVerificationCode('5551234567', { code: '111111', now: 1000, send });

    await assert.rejects(
      sendVerificationCode('5551234567', { code: '222222', now: 2000, send }),
      /Please wait/
    );

    await assert.rejects(
      sendVerificationCode('5559999999', {
        code: '333333',
        now: 1000,
        send: async () => ({ success: false, error: 'provider failed' })
      }),
      /could not send/
    );
    assert.throws(
      () => confirmVerificationCode('5559999999', '333333', 2000),
      /expired/
    );
  });
});
