'use strict';
// Module 15: database (+ uploaded images) backup and restore, using only Node and the MongoDB driver (no mongodump needed).
//
// Layout:  <BACKUP_DIR>/storva-<YYYYMMDD-HHMMSS>/
//            manifest.json             collections, document counts, sha256 of every file, app version, encrypted?
//            db/<collection>.ejson.gz  one Extended-JSON document per line (keeps ObjectIds, dates, decimals exact)
//            uploads/...               copy of UPLOAD_DIR (product / logo images)
// With BACKUP_KEY (32+ characters) every db file is encrypted (AES-256-GCM; file = 12-byte IV | ciphertext | 16-byte tag),
// so the folder can be copied to Google Drive / S3 safely. Short-lived security data (sessions, OTPs, rate-limit counters,
// visitor marks) is skipped. Old backups beyond BACKUP_KEEP (default 14) are deleted.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const readline = require('readline');
const { pipeline } = require('stream/promises');
const { once } = require('events');
const mongoose = require('mongoose');

const SKIP = new Set(['sessions', 'otps', 'ratelimithits', 'visitmarks']);
const keyFrom = (k) => (k ? crypto.createHash('sha256').update('storva-backup:' + k).digest() : null);
const sha256File = async (f) => { const h = crypto.createHash('sha256'); await pipeline(fs.createReadStream(f), h); return h.digest('hex'); };
const stamp = (d = new Date()) => d.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);

async function encryptFile(src, dst, key) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', key, iv), out = fs.createWriteStream(dst);
  out.write(iv);
  for await (const chunk of fs.createReadStream(src).pipe(c)) if (!out.write(chunk)) await once(out, 'drain');
  await new Promise((res, rej) => { out.on('error', rej); out.end(c.getAuthTag(), res); });
}
// Readable stream of the decrypted (still gzipped) bytes.
function decryptStream(file, key) {
  const size = fs.statSync(file).size; if (size < 28) throw new Error(`${path.basename(file)} is too small to be an encrypted backup file.`);
  const fd = fs.openSync(file, 'r'), iv = Buffer.alloc(12), tag = Buffer.alloc(16);
  fs.readSync(fd, iv, 0, 12, 0); fs.readSync(fd, tag, 0, 16, size - 16); fs.closeSync(fd);
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv); d.setAuthTag(tag);
  return fs.createReadStream(file, { start: 12, end: size - 17 }).pipe(d);
}

async function backup({ dir = process.env.BACKUP_DIR || './backups', key = process.env.BACKUP_KEY, uploadDir = process.env.UPLOAD_DIR, keep = Number(process.env.BACKUP_KEEP) || 14, now = new Date(), log = console.log } = {}) {
  if (key && key.length < 32) throw new Error('BACKUP_KEY must be at least 32 characters.');
  if (process.env.NODE_ENV === 'production' && !key) throw new Error('BACKUP_KEY is required in production; refusing to create an unencrypted backup.');
  const db = mongoose.connection.db; if (!db) throw new Error('Not connected to MongoDB.');
  const { EJSON } = mongoose.mongo.BSON;
  const root = path.resolve(dir), name = 'storva-' + stamp(now), out = path.join(root, name), tmp = out + '.partial';
  fs.mkdirSync(path.join(tmp, 'db'), { recursive: true });
  const k = keyFrom(key), manifest = { format: 1, app: 'storva', version: require('../../package.json').version, createdAt: now.toISOString(), database: db.databaseName, encrypted: Boolean(k), collections: [], uploads: null };
  try {
    const cols = (await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name).filter((n) => !n.startsWith('system.') && !SKIP.has(n)).sort();
    for (const c of cols) {
      const gz = path.join(tmp, 'db', `${c}.ejson.gz`); let count = 0;
      const cursor = db.collection(c).find({}, { batchSize: 1000 });
      async function* lines() { for await (const doc of cursor) { count++; yield EJSON.stringify(doc, { relaxed: false }) + '\n'; } }
      await pipeline(lines, zlib.createGzip({ level: 6 }), fs.createWriteStream(gz));
      let file = gz;
      if (k) { file = gz + '.enc'; await encryptFile(gz, file, k); fs.unlinkSync(gz); }
      const indexes = (await db.collection(c).indexes()).filter((i) => i.name !== '_id_').map(({ v, ns, ...rest }) => rest); // eslint-disable-line no-unused-vars
      manifest.collections.push({ name: c, count, file: path.relative(tmp, file), sha256: await sha256File(file), indexes });
      log(`[backup] ${c}: ${count} documents`);
    }
    if (uploadDir && fs.existsSync(uploadDir)) { fs.cpSync(uploadDir, path.join(tmp, 'uploads'), { recursive: true }); manifest.uploads = { files: countFiles(path.join(tmp, 'uploads')) }; log(`[backup] uploads: ${manifest.uploads.files} files`); }
    fs.writeFileSync(path.join(tmp, 'manifest.json'), JSON.stringify(manifest, null, 2));
    fs.renameSync(tmp, out); // only a complete backup gets the final name
  } catch (e) { fs.rmSync(tmp, { recursive: true, force: true }); throw e; }
  // retention
  const all = fs.readdirSync(root).filter((n) => /^storva-\d{8}-\d{6}$/.test(n)).sort();
  const removed = all.slice(0, Math.max(0, all.length - Math.max(1, keep)));
  removed.forEach((n) => fs.rmSync(path.join(root, n), { recursive: true, force: true }));
  return { dir: out, manifest, removed };
}
function countFiles(d) { let n = 0; for (const e of fs.readdirSync(d, { withFileTypes: true })) n += e.isDirectory() ? countFiles(path.join(d, e.name)) : 1; return n; }

// Restore. Safety: verifies every checksum first; refuses to touch a non-empty collection unless drop=true;
// `only` limits it to some collections. Recreates indexes from the manifest.
async function restore(src, { key = process.env.BACKUP_KEY, drop = false, only = null, uploadDir = process.env.UPLOAD_DIR, restoreUploads = true, log = console.log } = {}) {
  const dir = path.resolve(src), manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  if (manifest.app !== 'storva' || manifest.format !== 1) throw new Error('This folder is not a STORVA backup.');
  if (!Array.isArray(manifest.collections) || !manifest.collections.every((c) => c && typeof c.name === 'string' && typeof c.file === 'string' && Number.isSafeInteger(c.count) && c.count >= 0 && Array.isArray(c.indexes || []))) throw new Error('Backup manifest collections are invalid.');
  const safeFile = (rel) => {
    if (typeof rel !== 'string' || path.isAbsolute(rel) || rel.split(/[\\/]/).includes('..')) throw new Error('Unsafe backup file path in manifest.');
    const resolved = path.resolve(dir, rel);
    if (!resolved.startsWith(dir + path.sep)) throw new Error('Backup file path escapes its folder.');
    const st = fs.lstatSync(resolved);
    if (!st.isFile() || st.isSymbolicLink()) throw new Error('Backup entry must be a regular file, not a link or special file.');
    return resolved;
  };
  const k = keyFrom(key); if (manifest.encrypted && !k) throw new Error('This backup is encrypted: set BACKUP_KEY to the key used when it was made.');
  const db = mongoose.connection.db; if (!db) throw new Error('Not connected to MongoDB.');
  const { EJSON } = mongoose.mongo.BSON;
  const pick = manifest.collections.filter((c) => !only || only.includes(c.name));
  for (const c of pick) {
    const file = safeFile(c.file);
    const sum = await sha256File(file);
    if (sum !== c.sha256) throw new Error(`Checksum mismatch for ${c.file}: the backup is damaged. Nothing was restored.`);
  }
  // Fully decrypt, decompress and parse selected collections before destructive drop/insert operations.
  for (const c of pick) {
    const file = safeFile(c.file);
    const raw = manifest.encrypted ? decryptStream(file, k) : fs.createReadStream(file);
    const rl = readline.createInterface({ input: raw.pipe(zlib.createGunzip()), crlfDelay: Infinity });
    let n = 0;
    for await (const line of rl) { if (!line) continue; EJSON.parse(line, { relaxed: false }); n++; }
    if (n !== c.count) throw new Error(`Backup validation failed for "${c.name}": expected ${c.count} documents, found ${n}. Nothing was restored.`);
  }
  for (const c of pick) {
    const existing = await db.collection(c.name).estimatedDocumentCount().catch(() => 0);
    if (existing && !drop) throw new Error(`Collection "${c.name}" already has ${existing} documents. Re-run with --drop to replace it (nothing was changed in "${c.name}").`);
  }
  const result = [];
  for (const c of pick) {
    if (drop) await db.collection(c.name).drop().catch(() => {});
    const file = path.join(dir, c.file), raw = manifest.encrypted ? decryptStream(file, k) : fs.createReadStream(file);
    const rl = readline.createInterface({ input: raw.pipe(zlib.createGunzip()), crlfDelay: Infinity });
    let batch = [], n = 0;
    for await (const line of rl) { if (!line) continue; batch.push(EJSON.parse(line, { relaxed: false })); if (batch.length >= 1000) { await db.collection(c.name).insertMany(batch, { ordered: true }); n += batch.length; batch = []; } }
    if (batch.length) { await db.collection(c.name).insertMany(batch, { ordered: true }); n += batch.length; }
    if (n !== c.count) throw new Error(`Restored ${n} of ${c.count} documents in "${c.name}".`);
    for (const ix of c.indexes || []) { const { key: ikey, ...opts } = ix; await db.collection(c.name).createIndex(ikey, opts).catch((e) => log(`[restore] index ${ix.name} on ${c.name}: ${e.message}`)); }
    result.push({ name: c.name, count: n }); log(`[restore] ${c.name}: ${n} documents`);
  }
  if (restoreUploads && uploadDir && manifest.uploads && fs.existsSync(path.join(dir, 'uploads'))) { fs.mkdirSync(uploadDir, { recursive: true }); fs.cpSync(path.join(dir, 'uploads'), uploadDir, { recursive: true, force: false, errorOnExist: false }); log('[restore] uploads copied (existing files kept)'); }
  return { collections: result, manifest };
}
module.exports = { backup, restore, SKIP };
