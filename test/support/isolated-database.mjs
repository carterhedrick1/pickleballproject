// Gives one `node --test` file its own SQLite database, by copying the template that
// support/database-template.mjs built. Loaded with --import, so it runs before the test file
// itself and therefore before anything requires database/context.js, which reads
// SQLITE_DB_FILE once at load.
//
// Running a single file by hand - `node --test test/app-http.test.js` - skips this and uses the
// working directory's pickleball.db, exactly as it always did.

import fs from 'node:fs';
import path from 'node:path';
import { TEMPLATE_DIR, TEMPLATE_FILE } from './database-template.mjs';

// --import applies to the runner's own process too, where argv[1] is the glob rather than a
// test file. Only the per-file processes want a database.
const testFile = process.argv[1] || '';

if (/\.test\.js$/.test(testFile) && fs.existsSync(TEMPLATE_FILE)) {
  // The basename is unique across the suite and the pid keeps a repeated run from reusing a
  // file that a previous process still has open.
  const name = `${path.basename(testFile, '.test.js')}-${process.pid}.db`;
  const dbFile = path.join(TEMPLATE_DIR, name);
  fs.copyFileSync(TEMPLATE_FILE, dbFile);
  process.env.SQLITE_DB_FILE = dbFile;
}
