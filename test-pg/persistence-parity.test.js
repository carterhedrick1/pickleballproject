// The PostgreSQL half of the shared persistence suite.
//
// This directory is outside the `test/**/*.test.js` glob on purpose: `npm test` (and so the
// deployment gate) must never need a PostgreSQL server. Run it with:
//
//   TEST_DATABASE_URL=postgres://.../inorout_test npm run test:pg
//
// scripts/run-postgres-tests.js is what points DATABASE_URL at the disposable database
// before this file is loaded, which is what makes database/context.js choose PostgreSQL.
const assert = require('node:assert/strict');
const { registerPersistenceCases } = require('../test/support/persistence-cases');

const { isProduction } = require('../database/context');
assert.ok(
  isProduction,
  'The PostgreSQL parity suite was loaded without a PostgreSQL connection. Run it through `npm run test:pg`.'
);

registerPersistenceCases('PostgreSQL');
