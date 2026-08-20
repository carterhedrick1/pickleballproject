#!/usr/bin/env node
/**
 * Runs the PostgreSQL parity suite against a disposable database.
 *
 *   TEST_DATABASE_URL=postgres://user:pass@host:5432/inorout_test npm run test:pg
 *
 * Nothing in `npm test` or `npm run verify:deploy` depends on this: production parity is
 * worth checking before a persistence change ships, but a laptop without PostgreSQL must
 * still be able to run the deployment gate.
 *
 * Getting a database to point it at, in rough order of convenience:
 *   - Docker:    docker run --rm -e POSTGRES_PASSWORD=test -e POSTGRES_DB=inorout_test \
 *                  -p 5433:5432 postgres:16
 *                TEST_DATABASE_URL=postgres://postgres:test@127.0.0.1:5433/inorout_test
 *   - Homebrew:  brew install postgresql@16 && brew services start postgresql@16
 *                createdb inorout_test
 *                TEST_DATABASE_URL=postgres://$USER@127.0.0.1:5432/inorout_test
 *   - Render:    add a second, throwaway PostgreSQL instance. Never the production one.
 *
 * The suite creates the whole schema from the migrations and deletes the rows it made. It
 * does not clean up the schema itself; drop and recreate the database when you want a
 * genuinely fresh run (which is the interesting run for migrations).
 */

const { spawn } = require('node:child_process');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

// Loaded so the "is this production?" comparison below can see PROD_DATABASE_URL, which is
// where this project keeps the production connection string.
require('dotenv').config({ path: path.join(ROOT, '.env') });

// A production URL must never reach a suite that writes rows and creates tables. The name
// check is the important one: a disposable database should say so in its name.
const DISPOSABLE_NAME = /(test|scratch|parity|tmp|temp)/i;

function describeTarget(url) {
  try {
    const parsed = new URL(url);
    return {
      host: parsed.hostname,
      port: parsed.port || '5432',
      database: parsed.pathname.replace(/^\//, '')
    };
  } catch {
    return null;
  }
}

function fail(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

const url = process.env.TEST_DATABASE_URL;

if (!url) {
  fail(
    'TEST_DATABASE_URL is not set.\n\n' +
    'Point it at a disposable PostgreSQL database (its name must contain "test", ' +
    '"scratch", "parity" or "tmp"), for example:\n\n' +
    '  docker run --rm -e POSTGRES_PASSWORD=test -e POSTGRES_DB=inorout_test -p 5433:5432 postgres:16\n' +
    '  TEST_DATABASE_URL=postgres://postgres:test@127.0.0.1:5433/inorout_test npm run test:pg\n\n' +
    'Never point it at production.'
  );
}

const target = describeTarget(url);
if (!target || !target.database) {
  fail(`TEST_DATABASE_URL is not a usable PostgreSQL URL: ${url.slice(0, 24)}...`);
}

for (const [name, value] of Object.entries(process.env)) {
  if (name === 'TEST_DATABASE_URL') continue;
  if (/DATABASE_URL/.test(name) && value && value === url) {
    fail(
      `Refusing to run: TEST_DATABASE_URL is the same database as ${name}.\n` +
      'These tests write rows and run migrations. Use a disposable database.'
    );
  }
}

if (!DISPOSABLE_NAME.test(target.database)) {
  fail(
    `Refusing to run against a database named "${target.database}".\n` +
    'Name a disposable database so it is obvious it is one - "inorout_test" for instance - ' +
    'and this check will pass.'
  );
}

console.log(`PostgreSQL parity suite → ${target.database} on ${target.host}:${target.port}\n`);

// One file at a time: these suites share a single database and one of them creates and
// drops a schema, which is not something to do while another is migrating.
const child = spawn(
  process.execPath,
  ['--test', '--test-concurrency=1', 'test-pg/**/*.test.js'],
  {
    cwd: ROOT,
    stdio: 'inherit',
    env: {
      ...process.env,
      // What makes database/context.js choose PostgreSQL for this process.
      DATABASE_URL: url,
      NODE_ENV: process.env.NODE_ENV || 'test'
    }
  }
);

child.on('exit', (code, signal) => {
  if (signal) {
    console.error(`\nThe parity suite was killed by ${signal}.`);
    process.exit(1);
  }
  process.exit(code === null ? 1 : code);
});
