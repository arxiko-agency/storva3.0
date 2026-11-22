'use strict';
// Real isolated MongoDB; no credentials, production data, or skipped-success reports.
const { MongoMemoryServer } = require('mongodb-memory-server');
const { spawn } = require('node:child_process');
const path = require('node:path');
async function main() {
  const mongo = await MongoMemoryServer.create();
  try {
    const status = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['--test', '--test-concurrency=1',
        path.join(__dirname, '../test/module2.unit.test.js'),
        path.join(__dirname, '../test/module2.integration.test.js'),
        path.join(__dirname, '../test/registration.security.integration.test.js'),
        path.join(__dirname, '../test/throttle.durable.integration.test.js')], {
        stdio: 'inherit', env: { ...process.env, MONGODB_URI: mongo.getUri('storva_task2_test') },
      });
      child.on('error', reject); child.on('exit', resolve);
    });
    process.exitCode = status === 0 ? 0 : 1;
  } finally { await mongo.stop(); }
}
main().catch((e) => { console.error(e.message); process.exitCode = 1; });