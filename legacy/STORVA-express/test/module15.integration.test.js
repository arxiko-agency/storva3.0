'use strict';
// Module 15 against a REAL MongoDB + HTTP: strict CSP on every page, no inline script/handlers in shipped HTML, request ids,
// readiness endpoint, encrypted backup -> restore round trip (exact types, indexes, tamper detection), shared rate-limit store.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'); const os = require('os'); const path = require('path');
const H = require('./helpers/harness');
if (!H.enabled) { H.skip(test, 'module 15'); return; }
test.before(H.start); test.after(H.stop);
let A;
test('setup', async () => { A = await H.owner({ plan: 'pro' }); await H.product(A, { title: 'Backup me', price: 123.45, stock: 3 }); });

test('strict Content-Security-Policy on landing, dashboard, legal pages and storefront; request ids', async () => {
  for (const p of ['/', '/dashboard.html', '/privacy.html', '/terms.html', `/store/${A.slug}`]) {
    const r = await H.page(p); assert.equal(r.status, 200, p);
    const csp = r.headers.get('content-security-policy'); const script = (csp.match(/script-src ([^;]+)/) || [])[1];
    assert.ok(!/unsafe-inline|unsafe-eval|tailwindcss/.test(script), `${p}: ${script}`); assert.match(csp, /script-src-attr 'none'/); assert.match(csp, /object-src 'none'/);
    assert.match(r.headers.get('x-request-id'), /^[0-9a-f]{16}$/); assert.match(r.headers.get('permissions-policy'), /camera=\(\)/);
    if (p.endsWith('.html') || p === '/') { assert.ok(!/<script>(?!\s*<\/script>)/.test(r.text) && !/<script(?![^>]*\bsrc=)[^>]*>/.test(r.text), `${p} has an inline script`); assert.ok(!/\son(click|change|submit|load|input)=/i.test(r.text), `${p} has an inline handler`); }
  }
  const css = await H.page('/css/tailwind.css'); assert.equal(css.status, 200); assert.ok(css.text.includes('.bg-ink'), 'compiled Tailwind contains the brand colours');
  const id = 'abc12345-test'; assert.equal((await H.page('/api/health', { headers: { 'x-request-id': id } })).headers.get('x-request-id'), id);
});

test('readiness: database ping + jobs/queue details outside production', async () => {
  const r = await H.api(null, '/ready'); assert.equal(r.status, 200);
  assert.equal(r.json.ok, true); assert.equal(r.json.db, 'up'); assert.ok(r.json.queue && typeof r.json.queue.waiting === 'number'); assert.ok(Array.isArray(r.json.jobs)); assert.ok(r.json.memoryMb.rss > 0);
});

test('backup -> restore round trip: encrypted, exact values, indexes, damaged files refused', async () => {
  const mongoose = require('mongoose'); const { backup, restore } = require('../src/services/backup');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'storva-bk-')), up = fs.mkdtempSync(path.join(os.tmpdir(), 'storva-up-'));
  fs.writeFileSync(path.join(up, 'a.jpg'), 'img');
  const key = 'k'.repeat(40);
  const b = await backup({ dir, key, uploadDir: up, keep: 2, log: () => {} });
  assert.ok(b.manifest.encrypted); const prod = b.manifest.collections.find((c) => c.name === 'products'); assert.ok(prod.count >= 1); assert.ok(!b.manifest.collections.some((c) => c.name === 'sessions'), 'sessions are not backed up');
  const raw = fs.readFileSync(path.join(b.dir, prod.file)); assert.ok(!raw.includes(Buffer.from('Backup me')), 'file is encrypted');
  // restore into a separate database on the same server
  const other = mongoose.createConnection(process.env.MONGODB_URI.replace(/\/([^/?]+)(\?|$)/, '/$1_restore$2')); await other.asPromise(); await other.dropDatabase();
  const real = mongoose.connection.db; Object.defineProperty(mongoose.connection, 'db', { value: other.db, configurable: true });
  try {
    await assert.rejects(restore(b.dir, { key: undefined, log: () => {} }), /encrypted/);
    const r = await restore(b.dir, { key, uploadDir: fs.mkdtempSync(path.join(os.tmpdir(), 'storva-up2-')), log: () => {} });
    assert.ok(r.collections.find((c) => c.name === 'products').count >= 1);
    const p = await other.db.collection('products').findOne({ title: 'Backup me' });
    assert.equal(p.pricePaise, 12345); assert.ok(p._id instanceof mongoose.mongo.ObjectId); assert.ok(p.createdAt instanceof Date);
    const idx = await other.db.collection('orders').indexes(); assert.ok(idx.some((i) => i.unique && i.key.orderNumber), 'unique indexes recreated');
    await assert.rejects(restore(b.dir, { key, log: () => {} }), /already has/, 'refuses to overwrite without drop');
    const f = path.join(b.dir, prod.file); const buf = fs.readFileSync(f); buf[buf.length - 20] ^= 1; fs.writeFileSync(f, buf);
    await assert.rejects(restore(b.dir, { key, drop: true, log: () => {} }), /Checksum mismatch/);
  } finally { Object.defineProperty(mongoose.connection, 'db', { value: real, configurable: true }); await other.dropDatabase(); await other.close(); }
  // retention keeps the newest `keep`
  await backup({ dir, keep: 2, now: new Date(Date.now() + 1000), log: () => {} }); const third = await backup({ dir, keep: 2, now: new Date(Date.now() + 2000), log: () => {} });
  assert.equal(third.removed.length, 1); assert.equal(fs.readdirSync(dir).filter((n) => n.startsWith('storva-')).length, 2);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('shared rate-limit store counts across limiter instances and resets after the window', async () => {
  const { MongoStore } = require('../src/middleware/rateLimitStore');
  const s1 = new MongoStore('it-test'), s2 = new MongoStore('it-test'); s1.init({ windowMs: 400 }); s2.init({ windowMs: 400 });
  const key = 'ip-' + Date.now();
  assert.equal((await s1.increment(key)).totalHits, 1); assert.equal((await s2.increment(key)).totalHits, 2, 'second "instance" sees the first one\'s hits');
  const par = await Promise.all(Array.from({ length: 8 }, () => s1.increment(key))); assert.equal(Math.max(...par.map((x) => x.totalHits)), 10);
  await new Promise((r) => setTimeout(r, 450)); assert.equal((await s2.increment(key)).totalHits, 1, 'new window');
  await s1.resetKey(key);
});
