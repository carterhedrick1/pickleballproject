const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { buildConfig, validateConfig, assertStartupConfig, DEFAULT_DEV_PASSWORD } = require('../config');

const PROD_ENV = Object.freeze({
  DATABASE_URL: 'postgres://example/db',
  TEXTBELT_API_KEY: 'k'.repeat(30),
  BASE_URL: 'https://inorout.club',
  DEV_PASSWORD: 'a-real-password',
  HOST_AUTH_SECRET: 's'.repeat(30)
});

describe('buildConfig', () => {
  it('treats the presence of DATABASE_URL as production, matching database/context.js', () => {
    assert.equal(buildConfig({}).isProduction, false);
    assert.equal(buildConfig({ DATABASE_URL: 'postgres://x' }).isProduction, true);
  });

  it('keeps the vibe123 default for local development only', () => {
    const local = buildConfig({});
    assert.equal(local.devPassword, DEFAULT_DEV_PASSWORD);
    assert.equal(local.devAreaEnabled, true);
  });

  it('disables the dev area in production when DEV_PASSWORD is missing', () => {
    const config = buildConfig({ DATABASE_URL: 'postgres://x' });
    assert.equal(config.devPassword, null);
    assert.equal(config.devAreaEnabled, false);
  });

  it('disables the dev area in production when DEV_PASSWORD is the known default', () => {
    const config = buildConfig({ DATABASE_URL: 'postgres://x', DEV_PASSWORD: DEFAULT_DEV_PASSWORD });
    assert.equal(config.devAreaEnabled, false);
  });

  it('enables the dev area in production with a real password', () => {
    const config = buildConfig(PROD_ENV);
    assert.equal(config.devAreaEnabled, true);
    assert.equal(config.devPassword, 'a-real-password');
  });
});

describe('validateConfig', () => {
  it('accepts a fully configured production environment', () => {
    const { errors, warnings } = validateConfig(buildConfig(PROD_ENV));
    assert.deepEqual(errors, []);
    assert.deepEqual(warnings, []);
  });

  it('is fatal when production has no TEXTBELT_API_KEY', () => {
    const { errors } = validateConfig(buildConfig({ ...PROD_ENV, TEXTBELT_API_KEY: '' }));
    assert.equal(errors.length, 1);
    assert.match(errors[0], /TEXTBELT_API_KEY/);
  });

  it('is fatal when production BASE_URL is not https', () => {
    const { errors } = validateConfig(buildConfig({ ...PROD_ENV, BASE_URL: 'http://inorout.club' }));
    assert.match(errors[0], /https/);
  });

  it('only warns when production BASE_URL is missing (fallbacks exist)', () => {
    const { errors, warnings } = validateConfig(buildConfig({ ...PROD_ENV, BASE_URL: '' }));
    assert.deepEqual(errors, []);
    assert.equal(warnings.length, 1);
  });

  it('warns rather than crashes for a default dev password (outage would be worse)', () => {
    const { errors, warnings } = validateConfig(
      buildConfig({ ...PROD_ENV, DEV_PASSWORD: DEFAULT_DEV_PASSWORD })
    );
    assert.deepEqual(errors, []);
    assert.ok(warnings.some((w) => /DEV_PASSWORD/.test(w)));
  });

  it('imposes no requirements on local development', () => {
    const { errors, warnings } = validateConfig(buildConfig({}));
    assert.deepEqual(errors, []);
    assert.deepEqual(warnings, []);
  });
});

describe('assertStartupConfig', () => {
  function capture() {
    const calls = { warned: [], errored: [], exitCode: null };
    return {
      calls,
      log: {
        warn: (message) => calls.warned.push(message),
        error: (message) => calls.errored.push(message)
      },
      exit: (code) => {
        calls.exitCode = code;
      }
    };
  }

  it('exits on fatal production errors', () => {
    const { calls, log, exit } = capture();
    assertStartupConfig(buildConfig({ ...PROD_ENV, TEXTBELT_API_KEY: '' }), { log, exit });
    assert.equal(calls.exitCode, 1);
    assert.equal(calls.errored.length, 1);
  });

  it('logs warnings but keeps booting', () => {
    const { calls, log, exit } = capture();
    assertStartupConfig(buildConfig({ ...PROD_ENV, DEV_PASSWORD: '' }), { log, exit });
    assert.equal(calls.exitCode, null);
    assert.equal(calls.warned.length, 1);
  });

  it('boots a bare local environment silently', () => {
    const { calls, log, exit } = capture();
    assertStartupConfig(buildConfig({}), { log, exit });
    assert.equal(calls.exitCode, null);
    assert.deepEqual(calls.warned, []);
  });
});
