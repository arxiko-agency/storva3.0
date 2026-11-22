#!/usr/bin/env node
'use strict';
// LIVE check of every external integration with the credentials in .env / the environment.   npm run check:integrations
// Read-only: it never creates an order, charge, refund or subscription and never sends a message.
//   --only=mongo,razorpay,whatsapp,gemini,smtp,backup   run just some checks
//   --send-test-sms=9876543210                           ALSO send one real OTP SMS through MSG91 (a fake code "123456")
//   --send-test-email=you@example.com                    ALSO send one real email through SMTP
// Exit code 1 when any enabled integration fails.
require('dotenv').config();
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const args = process.argv.slice(2);
const opt = (n) => (args.find((a) => a.startsWith(`--${n}=`)) || '').slice(n.length + 3);
const only = opt('only').split(',').filter(Boolean);
const want = (n) => !only.length || only.includes(n);
const E = process.env;
const results = [];
const rec = (name, status, detail) => { results.push({ name, status, detail }); console.log(`${{ ok: 'OK  ', fail: 'FAIL', skip: 'skip' }[status]}  ${name}: ${detail}`); };
const run = async (name, fn) => { try { const r = await fn(); if (r) rec(name, r.status || 'ok', r.detail); } catch (e) { rec(name, 'fail', String((e && e.message) || e).slice(0, 220)); } };
const get = (url, headers) => fetch(url, { headers, signal: AbortSignal.timeout(12000) });

(async () => {
  if (want('mongo')) await run('MongoDB', async () => {
    if (!E.MONGODB_URI) return { status: 'fail', detail: 'MONGODB_URI is not set' };
    const mongoose = require('mongoose');
    const t0 = Date.now();
    await mongoose.connect(E.MONGODB_URI, { serverSelectionTimeoutMS: 12000 });
    await mongoose.connection.db.admin().ping();
    const hello = await mongoose.connection.db.admin().command({ hello: 1 }).catch(() => ({}));
    const name = mongoose.connection.db.databaseName; await mongoose.disconnect();
    return { detail: `connected to database "${name}" in ${Date.now() - t0} ms${hello.setName ? ` (replica set ${hello.setName})` : ''}` };
  });

  if (want('razorpay')) {
    await run('Razorpay API keys', async () => {
      if (!E.RAZORPAY_KEY_ID || !E.RAZORPAY_KEY_SECRET) return { status: 'skip', detail: 'no keys set: cash on delivery only' };
      const r = await get('https://api.razorpay.com/v1/orders?count=1', { authorization: 'Basic ' + Buffer.from(`${E.RAZORPAY_KEY_ID}:${E.RAZORPAY_KEY_SECRET}`).toString('base64') });
      if (r.status === 401) return { status: 'fail', detail: 'Razorpay rejected the key id / secret (HTTP 401)' };
      if (!r.ok) return { status: 'fail', detail: `unexpected HTTP ${r.status}` };
      return { detail: `keys accepted (${E.RAZORPAY_KEY_ID.startsWith('rzp_live_') ? 'LIVE' : 'test'} mode)` };
    });
    await run('Razorpay webhook secret', async () => {
      if (!E.RAZORPAY_KEY_ID) return { status: 'skip', detail: 'online payments are off' };
      if (!E.RAZORPAY_WEBHOOK_SECRET) return { status: 'fail', detail: 'RAZORPAY_WEBHOOK_SECRET is empty: /webhooks/razorpay answers 503' };
      const W = require('../src/utils/razorpayWebhook'); const body = Buffer.from('{"event":"selftest"}');
      if (!W.verifyWebhookSignature(body, W.webhookSignature(body, E.RAZORPAY_WEBHOOK_SECRET), E.RAZORPAY_WEBHOOK_SECRET)) return { status: 'fail', detail: 'signature self-test failed' };
      return { detail: `set; signature self-test passed. In the Razorpay dashboard the URL must be ${(E.APP_URL || 'https://<your-domain>').replace(/\/+$/, '')}/webhooks/razorpay with the same secret (payment.*, refund.*${E.RAZORPAY_SUBSCRIPTIONS_ENABLED === 'true' ? ', subscription.*' : ''} events). That part can only be checked in the dashboard.` };
    });
    if (E.RAZORPAY_SUBSCRIPTIONS_ENABLED === 'true') await run('Razorpay Subscriptions', async () => {
      const r = await get('https://api.razorpay.com/v1/plans?count=1', { authorization: 'Basic ' + Buffer.from(`${E.RAZORPAY_KEY_ID}:${E.RAZORPAY_KEY_SECRET}`).toString('base64') });
      if (r.ok) return { detail: 'Subscriptions API reachable with these keys' };
      const j = await r.json().catch(() => ({}));
      return { status: 'fail', detail: `HTTP ${r.status} ${(j.error && j.error.description) || ''}. Subscriptions must be activated on your Razorpay account first.`.trim() };
    });
  }

  if (want('whatsapp')) await run('WhatsApp Cloud API', async () => {
    if (!E.WHATSAPP_TOKEN || !E.WHATSAPP_PHONE_NUMBER_ID) return { status: 'skip', detail: 'platform number not configured' };
    const info = await require('../src/services/whatsappApi').getPhoneInfo(E.WHATSAPP_PHONE_NUMBER_ID, E.WHATSAPP_TOKEN);
    const missing = ['WHATSAPP_VERIFY_TOKEN', 'WHATSAPP_APP_SECRET'].filter((k) => !E[k]);
    if (missing.length) return { status: 'fail', detail: `number ${info.displayPhone} reachable, but ${missing.join(' and ')} not set (webhook verification/signatures would fail)` };
    return { detail: `token accepted for ${info.displayPhone}${info.verifiedName ? ` (${info.verifiedName})` : ''}. Webhook URL in Meta: ${(E.APP_URL || 'https://<your-domain>').replace(/\/+$/, '')}/webhooks/whatsapp, subscribed to "messages".` };
  });

  if (want('gemini')) await run('Gemini API', async () => {
    if (!E.GEMINI_API_KEY) return { status: 'skip', detail: 'GEMINI_API_KEY not set: AI tools are off' };
    const model = (E.GEMINI_MODEL || 'gemini-2.5-flash').replace(/[^a-z0-9.\-]/gi, '');
    const r = await get(`https://generativelanguage.googleapis.com/v1beta/models/${model}`, { 'x-goog-api-key': E.GEMINI_API_KEY });
    if (r.status === 400 || r.status === 401 || r.status === 403) return { status: 'fail', detail: `key rejected (HTTP ${r.status})` };
    if (r.status === 404) return { status: 'fail', detail: `key works but model "${model}" does not exist: set GEMINI_MODEL` };
    if (!r.ok) return { status: 'fail', detail: `unexpected HTTP ${r.status}` };
    return { detail: `key accepted, model "${model}" available` };
  });

  if (want('smtp')) {
    await run('SMTP', async () => {
      const d = require('../src/services/delivery');
      if (!d.mailConfigured()) return { status: 'skip', detail: 'SMTP_HOST / SMTP_USER / SMTP_PASS not all set' };
      await d.verifySmtp();
      return { detail: `connected and logged in to ${E.SMTP_HOST}:${E.SMTP_PORT || 587}; sender ${E.MAIL_FROM || '(MAIL_FROM not set)'}` };
    });
    if (opt('send-test-email')) await run('SMTP test email', async () => { await require('../src/services/delivery').sendEmail(opt('send-test-email'), '123456', 'login'); return { detail: `test email sent to ${opt('send-test-email')}` }; });
  }

  if (want('msg91')) {
    await run('MSG91', async () => {
      if (!E.MSG91_AUTH_KEY || !E.MSG91_TEMPLATE_ID) return { status: 'skip', detail: 'MSG91_AUTH_KEY / MSG91_TEMPLATE_ID not set' };
      return { detail: 'auth key and template id are set. MSG91 has no free "test the key" call, so nothing was sent. Re-run with --send-test-sms=<10-digit mobile> to send one real OTP SMS.' };
    });
    if (opt('send-test-sms')) await run('MSG91 test SMS', async () => {
      const n = require('../src/utils/validate').normalizePhone(opt('send-test-sms'));
      if (!n) return { status: 'fail', detail: 'not a valid 10-digit Indian mobile number' };
      await require('../src/services/delivery').sendSms(n, '123456'); return { detail: `MSG91 accepted the request for ${n}; check the phone (the code is the fake 123456)` };
    });
  }

  if (want('backup')) await run('Backups', async () => {
    const bj = require('../src/services/backupJob'); const s = bj.settings(E); const dir = path.resolve(s.dir);
    try { fs.mkdirSync(dir, { recursive: true }); fs.accessSync(dir, fs.constants.W_OK); } catch (e) { return { status: 'fail', detail: `BACKUP_DIR ${dir} is not writable: ${e.message}` }; }
    const last = bj.latestBackupAt(dir);
    const notes = [E.BACKUP_KEY && E.BACKUP_KEY.length >= 32 ? 'encrypted' : 'NOT encrypted (BACKUP_KEY missing/short)', `scheduler ${s.enabled ? `on every ${s.intervalMs / 3600e3} h` : 'off'}`, last ? `latest backup ${last.toISOString()}` : 'no backup yet'];
    return { status: E.BACKUP_KEY && E.BACKUP_KEY.length >= 32 ? 'ok' : 'fail', detail: `${dir}: ${notes.join('; ')}` };
  });

  const failed = results.filter((r) => r.status === 'fail').length;
  console.log(`\n${results.filter((r) => r.status === 'ok').length} ok, ${failed} failed, ${results.filter((r) => r.status === 'skip').length} skipped`);
  process.exit(failed ? 1 : 0);
})();
