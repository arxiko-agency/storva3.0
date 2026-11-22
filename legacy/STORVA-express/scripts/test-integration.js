'use strict';
// Runs the integration suites against a REAL MongoDB. Resolution order:
//   1. MONGODB_URI from the environment (database name must contain "test"; the suites refuse to run otherwise)
//   2. `mongodb-memory-server`, if you installed it:  npm i -D mongodb-memory-server   (downloads a mongod binary on first run)
//   3. otherwise exit with code 2 and instructions. This script NEVER reports success without having run the suites.
// Also see docker-compose.test.yml:  docker compose -f docker-compose.test.yml up -d
const { spawnSync } = require('child_process');
const path = require('path');

async function main() {
  let uri = process.env.MONGODB_URI, stop = async () => {};
  if (!uri) {
    let MongoMemoryServer;
    try { ({ MongoMemoryServer } = require('mongodb-memory-server')); } catch { /* not installed */ }
    if (!MongoMemoryServer) {
      console.error([
        'No MongoDB available, so the integration suites were NOT run.',
        'Pick one:',
        '  a) docker compose -f docker-compose.test.yml up -d && MONGODB_URI=mongodb://127.0.0.1:27018/storva_test npm run test:integration',
        '  b) MONGODB_URI=mongodb://127.0.0.1:27017/storva_test npm run test:integration   (your own mongod)',
        '  c) npm i -D mongodb-memory-server && npm run test:integration',
      ].join('\n'));
      process.exit(2);
    }
    const mem = await MongoMemoryServer.create();
    uri = mem.getUri('storva_test'); stop = () => mem.stop();
    console.log('[test-integration] using in-memory MongoDB at', uri);
  }
  const r = spawnSync(process.execPath, [path.join(__dirname, 'run-tests.js'), 'integration'], { stdio: 'inherit', env: { ...process.env, MONGODB_URI: uri } });
  await stop();
  process.exit(r.status === null ? 1 : r.status);
}
main().catch((e) => { console.error(e); process.exit(1); });
