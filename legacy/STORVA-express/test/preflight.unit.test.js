'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluate, hasErrors } = require('../src/config/preflight');

const GOOD = {
  NODE_ENV: 'production', MONGODB_URI: 'mongodb+srv://u:p@cluster0.example.mongodb.net/storva', APP_URL: 'https://shop.example.com',
  JWT_SECRET: 'j'.repeat(40), OTP_PEPPER: 'o'.repeat(40), MSG91_AUTH_KEY: 'k', MSG91_TEMPLATE_ID: 't', SMTP_HOST: 'smtp.example.com', SMTP_USER: 'u', SMTP_PASS: 'p', MAIL_FROM: 'Shop <hi@example.com>',
  BACKUP_KEY: 'b'.repeat(40), BACKUP_DIR: '/var/data/backups', UPLOAD_DIR: '/var/data/uploads', HEALTH_TOKEN: 'h'.repeat(20), ALERT_WEBHOOK_URL: 'https://hooks.example.com/x', PLATFORM_LEGAL_NAME: 'Acme', SECRETS_KEY: 'a'.repeat(64),
};
const levels = (e, level) => evaluate(e).filter((i) => i.level === level).map((i) => i.key);

test('a complete production configuration has no errors and no warnings', () => {
  const r = evaluate(GOOD);
  assert.deepEqual(r.filter((i) => i.level !== 'info'), []);
  assert.equal(hasErrors(r), false);
});
test('production without any OTP channel is an error; one channel is only a warning for the other', () => {
  const none = { ...GOOD, MSG91_AUTH_KEY: '', SMTP_HOST: '' };
  assert.equal(hasErrors(evaluate(none)), true);
  const smsOnly = { ...GOOD, SMTP_HOST: '' };
  assert.equal(hasErrors(evaluate(smsOnly)), false); assert.ok(levels(smsOnly, 'warn').some((k) => k.startsWith('SMTP_HOST')));
});
test('APP_URL must be https in production; a local database is refused', () => {
  assert.ok(levels({ ...GOOD, APP_URL: 'http://shop.example.com' }, 'error').includes('APP_URL'));
  assert.ok(levels({ ...GOOD, MONGODB_URI: 'mongodb://127.0.0.1:27017/x' }, 'error').includes('MONGODB_URI'));
});
test('Razorpay: half a key pair, a missing webhook secret and malformed ids are errors; a test key in production is a warning', () => {
  const rz = { ...GOOD, RAZORPAY_KEY_ID: 'rzp_live_abc', RAZORPAY_KEY_SECRET: 's', RAZORPAY_WEBHOOK_SECRET: 'w' };
  assert.equal(hasErrors(evaluate(rz)), false);
  assert.ok(levels({ ...GOOD, RAZORPAY_KEY_ID: 'rzp_live_abc' }, 'error').includes('RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET'));
  assert.ok(levels({ ...rz, RAZORPAY_WEBHOOK_SECRET: '' }, 'error').includes('RAZORPAY_WEBHOOK_SECRET'));
  assert.ok(levels({ ...rz, RAZORPAY_KEY_ID: 'key_123' }, 'error').includes('RAZORPAY_KEY_ID'));
  assert.ok(levels({ ...rz, RAZORPAY_KEY_ID: 'rzp_test_abc' }, 'warn').includes('RAZORPAY_KEY_ID'));
  assert.ok(levels({ ...GOOD, RAZORPAY_SUBSCRIPTIONS_ENABLED: 'true' }, 'error').includes('RAZORPAY_SUBSCRIPTIONS_ENABLED'));
});
test('WhatsApp: a token without verify token or app secret is an error in production', () => {
  const wa = { ...GOOD, WHATSAPP_TOKEN: 't', WHATSAPP_PHONE_NUMBER_ID: '123' };
  const errs = levels(wa, 'error'); assert.ok(errs.includes('WHATSAPP_VERIFY_TOKEN') && errs.includes('WHATSAPP_APP_SECRET'));
  assert.equal(hasErrors(evaluate({ ...wa, WHATSAPP_VERIFY_TOKEN: 'v', WHATSAPP_APP_SECRET: 's' })), false);
  assert.ok(levels({ ...GOOD, WHATSAPP_TOKEN: 't' }, 'error').includes('WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID'));
});
test('keys: short BACKUP_KEY and a SECRETS_KEY that is not 64 hex characters are errors; missing backup/monitoring settings warn', () => {
  assert.ok(levels({ ...GOOD, BACKUP_KEY: 'short' }, 'error').includes('BACKUP_KEY'));
  assert.ok(levels({ ...GOOD, SECRETS_KEY: 'nothex' }, 'error').includes('SECRETS_KEY'));
  const w = levels({ ...GOOD, BACKUP_KEY: '', BACKUP_DIR: '', HEALTH_TOKEN: '', ALERT_WEBHOOK_URL: '' }, 'warn');
  for (const k of ['BACKUP_KEY', 'BACKUP_DIR', 'HEALTH_TOKEN', 'ALERT_WEBHOOK_URL']) assert.ok(w.includes(k), k);
});
test('development is lenient: missing OTP channels are only informational', () => {
  const dev = { NODE_ENV: 'development', MONGODB_URI: 'mongodb://127.0.0.1:27017/x' };
  assert.equal(hasErrors(evaluate(dev)), false); assert.deepEqual(levels(dev, 'warn'), []);
});
test('messages never contain secret values', () => {
  const text = JSON.stringify(evaluate({ ...GOOD, RAZORPAY_KEY_ID: 'rzp_live_SECRETID', RAZORPAY_KEY_SECRET: 'TOPSECRETVALUE', JWT_SECRET: 'short-jwt' }));
  assert.ok(!text.includes('TOPSECRETVALUE') && !text.includes('short-jwt'));
});
