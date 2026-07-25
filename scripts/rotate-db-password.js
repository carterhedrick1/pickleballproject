// Rotates the production Postgres password for the app's database user.
//
//   node scripts/rotate-db-password.js --check    # verify current access, change nothing
//   node scripts/rotate-db-password.js --rotate   # ALTER USER, then rewrite .env
//
// Reads the new password from .new-db-password.local (git-ignored) so no secret is ever typed
// into a chat or a shell argument. Never prints the password.
//
// IMPORTANT: run --rotate only when Render's DATABASE_URL is staged and ready to save. Between
// the rotation and that save, the live app cannot open new database connections.

const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
require('dotenv').config({ path: path.join(ROOT, '.env') });
const { Client } = require('pg');

const ENV_PATH = path.join(ROOT, '.env');
const PW_PATH = path.join(ROOT, '.new-db-password.local');
const MODE = process.argv.includes('--rotate') ? 'rotate' : 'check';

function readNewPassword() {
  const text = fs.readFileSync(PW_PATH, 'utf8');
  const m = text.match(/NEW PASSWORD \(this is the only part you need to change in Render\):\s*\n(\S+)\s*\n/);
  if (!m) throw new Error(`Could not find the new password in ${PW_PATH}`);
  return m[1];
}

async function connect(connectionString, label) {
  const c = new Client({ connectionString, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 20000 });
  const t = Date.now();
  await c.connect();
  const r = await c.query('SELECT current_user AS u, (SELECT count(*)::int FROM games) AS games');
  console.log(`  ${label}: connected in ${Date.now() - t}ms as ${r.rows[0].u}, ${r.rows[0].games} games visible`);
  return c;
}

(async () => {
  const currentUrl = process.env.PROD_DATABASE_URL;
  if (!currentUrl) throw new Error('PROD_DATABASE_URL is not set in .env');

  const u = new URL(currentUrl);
  const newPassword = readNewPassword();

  if (newPassword === u.password) {
    console.log('The password in .env already matches the new one - rotation has already happened.');
    const c = await connect(currentUrl, 'current .env');
    await c.end();
    return;
  }

  console.log(`user: ${u.username}   host: ${u.hostname}   db: ${u.pathname.replace('/', '')}`);

  if (MODE === 'check') {
    console.log('\n=== CHECK ONLY - nothing will change ===');
    const c = await connect(currentUrl, 'current credentials');
    await c.end();
    console.log('\nReady. Re-run with --rotate when Render is staged and ready to save.');
    return;
  }

  console.log('\n=== ROTATING ===');
  const c = await connect(currentUrl, 'before rotation');

  // A role may always change its own password. Parameterising the identifier is not possible,
  // so the password goes through a quoted literal; it is generated alphanumeric-only.
  if (!/^[A-Za-z0-9]+$/.test(newPassword)) throw new Error('Refusing: new password is not alphanumeric');
  await c.query(`ALTER USER ${u.username} WITH PASSWORD '${newPassword}'`);
  console.log('  ALTER USER done - the old password is now dead');
  await c.end();

  // Rewrite .env so local tooling keeps working.
  const newUrl = `${u.protocol}//${u.username}:${newPassword}@${u.host}${u.pathname}`;
  const env = fs.readFileSync(ENV_PATH, 'utf8');
  const updated = env.replace(/^PROD_DATABASE_URL=.*$/m, `PROD_DATABASE_URL=${newUrl}`);
  if (updated === env) throw new Error('Could not find PROD_DATABASE_URL line to update in .env');
  fs.writeFileSync(ENV_PATH, updated);
  console.log('  .env PROD_DATABASE_URL updated');

  // Prove the new credentials work on a brand new connection.
  const c2 = await connect(newUrl, 'with NEW password');
  await c2.end();

  // Prove the old ones no longer do.
  try {
    const old = new Client({ connectionString: currentUrl, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000 });
    await old.connect();
    await old.end();
    console.log('  WARNING: the OLD password still works - rotation did not take effect');
    process.exit(1);
  } catch {
    console.log('  confirmed: the old password is rejected');
  }

  console.log('\nNow save DATABASE_URL in Render. The site stays down until you do.');
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
