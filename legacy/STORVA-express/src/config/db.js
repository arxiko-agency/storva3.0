'use strict';
const mongoose = require('mongoose');
const { env } = require('./env');
const { retry } = require('../utils/retry');

mongoose.set('strictQuery', true);

// Never print credentials: mongodb+srv://user:password@host -> mongodb+srv://***@host
const redact = (s) => String(s || '').replace(/\/\/[^@/\s]*@/g, '//***@');

let listening = false;
function listen() {
  if (listening) return; listening = true; // connectDb may be called more than once (tests): attach the handlers only once
  const c = mongoose.connection;
  c.on('error', (e) => console.error('[mongo] error:', redact(e.message)));
  c.on('disconnected', () => console.warn('[mongo] disconnected (the driver reconnects on its own)'));
  c.on('reconnected', () => console.log('[mongo] reconnected'));
}

// A wrong password or a malformed URI will never fix itself: fail at once with a clear message. Network, DNS, Atlas IP-allow-list
// propagation and "database is still starting" problems are retried with backoff.
function isPermanent(e) {
  const m = String((e && e.message) || '');
  return Boolean(e && (e.name === 'MongoParseError' || e.code === 18 || e.code === 13)) || /bad auth|authentication failed|invalid scheme|invalid connection string/i.test(m);
}

async function connectDb(uri = env.mongoUri, { attempts = Math.max(1, Number(process.env.MONGO_CONNECT_ATTEMPTS) || 5) } = {}) {
  if (!/^mongodb(\+srv)?:\/\//.test(String(uri || ''))) throw new Error('MONGODB_URI must start with mongodb:// or mongodb+srv://');
  listen();
  const options = {
    serverSelectionTimeoutMS: Number(process.env.MONGO_SERVER_SELECTION_MS) || 10000,
    maxPoolSize: Number(process.env.MONGO_POOL_SIZE) || 20,
    ...(Number(process.env.MONGO_SOCKET_TIMEOUT_MS) ? { socketTimeoutMS: Number(process.env.MONGO_SOCKET_TIMEOUT_MS) } : {}),
  };
  try {
    await retry(() => mongoose.connect(uri, options), {
      attempts, baseMs: 2000, maxMs: 20000, retryable: (e) => !isPermanent(e),
      onRetry: (e, i, d) => console.warn(`[mongo] connect attempt ${i}/${attempts} failed (${redact(e.message)}); retrying in about ${Math.round(d / 1000)}s`),
    });
  } catch (e) { throw new Error(`Could not connect to MongoDB: ${redact(e.message)}`); }
  console.log('[mongo] connected');
}

async function disconnectDb() {
  await mongoose.disconnect();
}

module.exports = { connectDb, disconnectDb, redact, isPermanent };
