// Builds the database every test file starts from, once per `npm test` run.
//
// Node's test runner gives each test file its own process, and support/isolated-database.mjs
// gives each of those processes its own copy of the file this makes. That is what stopped the
// SQLITE_BUSY flake: the files used to share one SQLite database, so two of them writing at the
// same moment contended on it, and `npm test` had to serialize the files with
// --test-concurrency=1 to stay green. Nothing contends now, so the files run in parallel again.
//
// It is a template rather than per-file migration because migrating costs ~50ms and a dozen log
// lines each time, while copying the finished 240kb file costs about a millisecond and says
// nothing. The content is identical either way - the app's own three boot stages produce it.

import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const TEMPLATE_DIR = path.join(ROOT, '.test-databases');
export const TEMPLATE_FILE = path.join(TEMPLATE_DIR, 'template.db');

export async function globalSetup() {
  fs.rmSync(TEMPLATE_DIR, { recursive: true, force: true });
  fs.mkdirSync(TEMPLATE_DIR, { recursive: true });

  // Read before database/context.js is loaded, so it has to be set before the require below.
  // DATABASE_URL is cleared for the same reason: a developer with a PostgreSQL URL in their
  // environment would otherwise build the template against it, and `npm test` is SQLite-only.
  process.env.SQLITE_DB_FILE = TEMPLATE_FILE;
  delete process.env.DATABASE_URL;

  const { initializeDatabase } = require('../../database/schema');
  const { closeDatabaseConnection } = require('../../database/context');
  await initializeDatabase();
  // Closing checkpoints the WAL into the file, which is what makes a plain copy complete.
  await closeDatabaseConnection();
}

export async function globalTeardown() {
  fs.rmSync(TEMPLATE_DIR, { recursive: true, force: true });
}
