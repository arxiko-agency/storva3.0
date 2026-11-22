'use strict';
// Production configuration check. Pure (takes an env object, touches nothing), so it is unit-tested and shared by
//   - assertEnv()            -> prints warnings at boot (fatal only with ENV_STRICT=true)
//   - npm run check:env      -> exits 1 when anything is an "error"
// Levels: error = a feature is broken or unsafe as configured; warn = works but weakens production; info = optional feature is off.
function evaluate(e = process.env) {
  const out = [];
  const add = (level, key, message) => out.push({ level, key, message });
  const has = (k) => Boolean(e[k] && String(e[k]).trim());
  const prod = e.NODE_ENV === 'production';

  // Core
  if (!has('MONGODB_URI')) add('error', 'MONGODB_URI', 'Required.');
  else if (prod && /(localhost|127\.0\.0\.1|\[::1\])/.test(e.MONGODB_URI)) add('error', 'MONGODB_URI', 'Points at a local database while NODE_ENV=production.');
  for (const k of ['JWT_SECRET', 'OTP_PEPPER']) {
    if (prod && !has(k)) add('error', k, 'Required in production (32+ random characters).');
    else if (has(k) && String(e[k]).length < 32) add(prod ? 'error' : 'warn', k, 'Must be at least 32 characters.');
  }
  if (prod && !has('APP_URL')) add('error', 'APP_URL', 'Required in production (your public https URL, no trailing slash).');
  else if (prod && has('APP_URL') && !/^https:\/\//i.test(e.APP_URL)) add('error', 'APP_URL', 'Must start with https:// in production (cookies, Razorpay and Meta webhooks need it).');
  if (has('SECRETS_KEY') && !/^[a-f0-9]{64}$/i.test(e.SECRETS_KEY)) add('error', 'SECRETS_KEY', 'Must be exactly 64 hex characters.');
  else if (prod && !has('SECRETS_KEY')) add('warn', 'SECRETS_KEY', 'Not set: stores\' WhatsApp tokens are encrypted with a key derived from JWT_SECRET, so rotating JWT_SECRET would break them.');

  // OTP delivery: sign-up and login need at least one working channel.
  const sms = has('MSG91_AUTH_KEY') && has('MSG91_TEMPLATE_ID');
  const mail = has('SMTP_HOST') && has('SMTP_USER') && has('SMTP_PASS');
  if (prod && !sms && !mail) add('error', 'MSG91_AUTH_KEY / SMTP_HOST', 'No OTP channel is configured: nobody can register or reset a password (the API answers 503).');
  else {
    if (!sms) add(prod ? 'warn' : 'info', 'MSG91_AUTH_KEY / MSG91_TEMPLATE_ID', 'SMS OTP is off: phone sign-ups and phone sign-in will fail until both are set.');
    if (!mail) add(prod ? 'warn' : 'info', 'SMTP_HOST / SMTP_USER / SMTP_PASS', 'Email is off: email OTP and every order/plan email will fail until all three are set.');
  }
  if (mail && !has('MAIL_FROM')) add('warn', 'MAIL_FROM', 'Not set: defaults to no-reply@localhost, which most SMTP providers reject.');

  // Razorpay
  const kid = has('RAZORPAY_KEY_ID'), ksec = has('RAZORPAY_KEY_SECRET');
  if (kid !== ksec) add('error', 'RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET', 'Set both or neither.');
  if (kid && ksec) {
    if (!/^rzp_(test|live)_/.test(e.RAZORPAY_KEY_ID)) add('error', 'RAZORPAY_KEY_ID', 'Must start with rzp_test_ or rzp_live_.');
    else if (prod && /^rzp_test_/.test(e.RAZORPAY_KEY_ID)) add('warn', 'RAZORPAY_KEY_ID', 'A TEST key is used in production: no real money will move.');
    else if (!prod && /^rzp_live_/.test(e.RAZORPAY_KEY_ID)) add('warn', 'RAZORPAY_KEY_ID', 'A LIVE key is used outside production.');
    if (!has('RAZORPAY_WEBHOOK_SECRET')) add('error', 'RAZORPAY_WEBHOOK_SECRET', 'Not set: /webhooks/razorpay answers 503, so failed payments, late captures, refunds and subscription charges never sync.');
  } else add('info', 'RAZORPAY_KEY_ID', 'Online payments are off (cash on delivery only).');
  if (e.RAZORPAY_SUBSCRIPTIONS_ENABLED === 'true' && !(kid && ksec)) add('error', 'RAZORPAY_SUBSCRIPTIONS_ENABLED', 'Needs RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.');

  // WhatsApp Cloud API
  if (has('WHATSAPP_TOKEN') || has('WHATSAPP_PHONE_NUMBER_ID')) {
    if (!has('WHATSAPP_TOKEN') || !has('WHATSAPP_PHONE_NUMBER_ID')) add('error', 'WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID', 'Set both.');
    if (!has('WHATSAPP_VERIFY_TOKEN')) add('error', 'WHATSAPP_VERIFY_TOKEN', 'Not set: Meta\'s webhook verification (GET) will be refused.');
    if (!has('WHATSAPP_APP_SECRET')) add(prod ? 'error' : 'warn', 'WHATSAPP_APP_SECRET', 'Not set: incoming webhooks cannot be verified and are rejected (503) in production.');
  } else add('info', 'WHATSAPP_TOKEN', 'Platform WhatsApp number is off.');
  if (prod && e.WHATSAPP_ALLOW_UNSIGNED === 'true') add('warn', 'WHATSAPP_ALLOW_UNSIGNED', 'Ignored in production, remove it.');

  // Gemini
  if (!has('GEMINI_API_KEY')) add('info', 'GEMINI_API_KEY', 'AI tools are off.');

  // Backups, monitoring, storage
  if (has('BACKUP_KEY') && String(e.BACKUP_KEY).length < 32) add('error', 'BACKUP_KEY', 'Must be at least 32 characters.');
  else if (prod && !has('BACKUP_KEY')) add('warn', 'BACKUP_KEY', 'Not set: backups would be unencrypted, so scheduled backups stay off in production until it is set.');
  if (prod && !has('BACKUP_DIR')) add('warn', 'BACKUP_DIR', 'Not set: backups go to ./backups on the app disk. Point it at a persistent disk and copy it off-site.');
  if (prod && !has('UPLOAD_DIR')) add('warn', 'UPLOAD_DIR', 'Not set: product images go to ./uploads, which many hosts wipe on every deploy. Use a persistent disk.');
  if (prod && !(has('HEALTH_TOKEN') && String(e.HEALTH_TOKEN).length >= 16)) add('warn', 'HEALTH_TOKEN', 'Not set (16+ chars): /api/ready cannot show job and queue details to your monitor.');
  if (prod && !has('ALERT_WEBHOOK_URL')) add('warn', 'ALERT_WEBHOOK_URL', 'Not set: server errors, failed jobs and failed backups will only appear in the logs.');
  if (prod && !has('PLATFORM_LEGAL_NAME')) add('warn', 'PLATFORM_LEGAL_NAME', 'Not set: plan invoices print the brand name instead of your legal entity (and PLATFORM_GSTIN is needed for a tax invoice).');
  return out;
}
const hasErrors = (items) => items.some((i) => i.level === 'error');
module.exports = { evaluate, hasErrors };
