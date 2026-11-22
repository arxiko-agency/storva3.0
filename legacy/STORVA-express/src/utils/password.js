'use strict';
// scrypt password hashing using only Node's built-in crypto (no native build step on Render).
const crypto = require('crypto');
const { promisify } = require('util');
const scrypt = promisify(crypto.scrypt);

const N = 65536, R = 8, P = 2, KEYLEN = 64; // OWASP scrypt option: N=2^16, r=8, p=2 (older hashes with N=16384 still verify and are upgraded at next login)
const opts = { N, r: R, p: P, maxmem: 256 * 1024 * 1024 };

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, KEYLEN, opts);
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

async function verifyPassword(password, stored) {
  try {
    const [alg, n, r, p, saltB64, keyB64] = String(stored).split('$');
    if (alg !== 'scrypt') return false;
    const expected = Buffer.from(keyB64, 'base64');
    const key = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length, { N: +n, r: +r, p: +p, maxmem: 256 * 1024 * 1024 });
    return key.length === expected.length && crypto.timingSafeEqual(key, expected);
  } catch { return false; }
}

// Used when the account does not exist so response time does not reveal which identifiers are registered.
let dummy;
async function burnVerify(password) {
  dummy = dummy || (await hashPassword('dummy-password-for-timing'));
  await verifyPassword(password, dummy);
  return false;
}

// true when a stored hash was made with weaker parameters than the current ones.
function needsRehash(stored) {
  const [alg, n, r, p] = String(stored).split('$');
  return alg !== 'scrypt' || +n < N || +r < R || +p < P;
}

module.exports = { hashPassword, verifyPassword, burnVerify, needsRehash };
