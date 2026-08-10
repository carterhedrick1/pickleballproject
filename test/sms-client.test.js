const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { sendSMS, SMS_PROVIDER_TIMEOUT_MS } = require('../services/sms-client');

const ORIGINAL_ENV = {
  DATABASE_URL: process.env.DATABASE_URL,
  TEXTBELT_API_KEY: process.env.TEXTBELT_API_KEY,
  ALLOW_LOCAL_SMS: process.env.ALLOW_LOCAL_SMS,
  SMS_SIMULATE_FAILURE: process.env.SMS_SIMULATE_FAILURE,
  SMS_DISABLE_EVENT_LOGGING: process.env.SMS_DISABLE_EVENT_LOGGING,
  BASE_URL: process.env.BASE_URL
};
const ORIGINAL_FETCH = global.fetch;

function setEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

beforeEach(() => {
  process.env.SMS_DISABLE_EVENT_LOGGING = '1';
});

afterEach(() => {
  Object.entries(ORIGINAL_ENV).forEach(([name, value]) => setEnv(name, value));
  global.fetch = ORIGINAL_FETCH;
});

describe('SMS environment safety', () => {
  it('does not contact Textbelt for a game stored in local SQLite', async () => {
    delete process.env.DATABASE_URL;
    delete process.env.ALLOW_LOCAL_SMS;
    delete process.env.SMS_SIMULATE_FAILURE;
    process.env.TEXTBELT_API_KEY = 'live-looking-key';
    process.env.BASE_URL = 'https://inorout.club';
    global.fetch = async () => {
      throw new Error('Textbelt should not be contacted');
    };

    const result = await sendSMS('5551234567', 'Game created', 'local-game-id');

    assert.deepEqual(result, { success: true, dev: true, localSafety: true });
  });

  it('allows an explicit local SMS test override', async () => {
    delete process.env.DATABASE_URL;
    delete process.env.SMS_SIMULATE_FAILURE;
    process.env.ALLOW_LOCAL_SMS = '1';
    process.env.TEXTBELT_API_KEY = 'test-key';
    process.env.BASE_URL = 'https://reachable-tunnel.example';
    let request;
    global.fetch = async (url, options) => {
      request = { url, options };
      return { json: async () => ({ success: true, textId: 'text-1' }) };
    };

    const result = await sendSMS('5551234567', 'Game created', 'local-game-id');

    assert.equal(result.success, true);
    assert.equal(request.url, 'https://textbelt.com/text');
    assert.equal(request.options.signal.aborted, false);
    assert.equal(SMS_PROVIDER_TIMEOUT_MS, 12000);
    assert.equal(
      request.options.body.get('replyWebhookUrl'),
      'https://reachable-tunnel.example/api/sms/webhook'
    );
  });

  it('keeps real SMS enabled for the production database environment', async () => {
    process.env.DATABASE_URL = 'postgres://production.example/database';
    delete process.env.ALLOW_LOCAL_SMS;
    delete process.env.SMS_SIMULATE_FAILURE;
    process.env.TEXTBELT_API_KEY = 'test-key';
    process.env.BASE_URL = 'https://inorout.club';
    let calls = 0;
    global.fetch = async () => {
      calls++;
      return { json: async () => ({ success: true, textId: 'text-2' }) };
    };

    const result = await sendSMS('5551234567', 'Game created', 'production-game-id');

    assert.equal(result.success, true);
    assert.equal(calls, 1);
  });
});
