// The SQLite half of the shared persistence suite. The PostgreSQL half runs the very same
// cases against a disposable database via `npm run test:pg` - see test-pg/.
const { registerPersistenceCases } = require('./support/persistence-cases');

registerPersistenceCases('SQLite');
