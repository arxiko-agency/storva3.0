'use strict';
require('dotenv').config();

const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT) || 3000,
  appUrl: (process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, ''),
  brandName: process.env.BRAND_NAME || 'STORVA',
  supportEmail: process.env.SUPPORT_EMAIL || '',
  instagramUrl: process.env.SOCIAL_INSTAGRAM || '',
  supportWhatsapp: (process.env.SUPPORT_WHATSAPP || '').replace(/\D/g, ''),
  mongoUri: process.env.MONGODB_URI || '',
  maxStoresPerUser: Math.max(1, Number(process.env.MAX_STORES_PER_USER) || 1), // plan gating arrives in Module 8
  uploadDir: require('path').resolve(process.env.UPLOAD_DIR || './uploads'), // product images; must be a persistent disk in production
  maxProductsPerStore: Math.max(1, Number(process.env.MAX_PRODUCTS_PER_STORE) || 50), // plan gating replaces this in Module 8
  // Auth (Module 2)
  sessionSecret: process.env.JWT_SECRET || '',
  otpPepper: process.env.OTP_PEPPER || '',
  sessionDays: Number(process.env.SESSION_DAYS) || 30,
  msg91: { authKey: process.env.MSG91_AUTH_KEY || '', templateId: process.env.MSG91_TEMPLATE_ID || '' },
  // Razorpay (Module 6). Only the PUBLIC key id ever reaches the browser; the secrets stay on the server.
  razorpay: {
    keyId: process.env.RAZORPAY_KEY_ID || '', keySecret: process.env.RAZORPAY_KEY_SECRET || '', webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET || '',
    get enabled() { return Boolean(this.keyId && this.keySecret); },
  },
  // Payment reconciliation (Module 6 step 4 part 2): background check of unsettled online orders against Razorpay. Safe to leave on; it only reads from Razorpay.
  reconcile: {
    enabled: process.env.RECONCILE_ENABLED !== 'false',
    intervalMs: Math.max(5, Number(process.env.RECONCILE_INTERVAL_MINUTES) || 15) * 60 * 1000,
    minAgeMs: Math.max(2, Number(process.env.RECONCILE_MIN_AGE_MINUTES) || 15) * 60 * 1000,
    batch: Math.min(200, Math.max(1, Number(process.env.RECONCILE_BATCH) || 50)),
  },
  // Abandoned online orders (Module 6 hardening): unpaid Razorpay orders older than this are cancelled and their stock released (after Razorpay confirms no payment exists).
  abandon: {
    enabled: process.env.ABANDON_CLEANUP_ENABLED !== 'false',
    maxAgeMs: Math.max(30, Number(process.env.ABANDON_ORDER_MINUTES) || 120) * 60 * 1000,
    intervalMs: Math.max(5, Number(process.env.ABANDON_INTERVAL_MINUTES) || 15) * 60 * 1000,
    batch: Math.min(200, Math.max(1, Number(process.env.ABANDON_BATCH) || 50)),
  },
  // Automatic refund of cancelled, paid online orders (Razorpay). Set AUTO_REFUND_ENABLED=false to go back to owner-initiated refunds only.
  autoRefund: {
    enabled: process.env.AUTO_REFUND_ENABLED !== 'false',
    intervalMs: Math.max(1, Number(process.env.AUTO_REFUND_INTERVAL_MINUTES) || 5) * 60 * 1000,
    maxAttempts: Math.min(10, Math.max(1, Number(process.env.AUTO_REFUND_MAX_ATTEMPTS) || 3)),
    retryBackoffMs: Math.max(1, Number(process.env.AUTO_REFUND_RETRY_MINUTES) || 15) * 60 * 1000,
    verifyAfterMs: Math.max(1, Number(process.env.AUTO_REFUND_VERIFY_MINUTES) || 5) * 60 * 1000,
    batch: Math.min(200, Math.max(1, Number(process.env.AUTO_REFUND_BATCH) || 50)),
  },
  smtp: {
    host: process.env.SMTP_HOST || '', port: Number(process.env.SMTP_PORT) || 587,
    user: process.env.SMTP_USER || '', pass: process.env.SMTP_PASS || '',
    from: process.env.MAIL_FROM || `${process.env.BRAND_NAME || 'STORVA'} <no-reply@localhost>`,
  },
};
env.isProd = env.nodeEnv === 'production';

// Variables that must exist for the app to boot. Each module adds its own keys here.
const REQUIRED = ['MONGODB_URI'];
// In production the auth secrets must be real; in development a throwaway value is generated per boot.
const REQUIRED_IN_PROD = ['JWT_SECRET', 'OTP_PEPPER', 'APP_URL'];

function assertEnv() {
  const rz = env.razorpay; // both or neither: half a configuration would silently disable (or break) online payment
  if (Boolean(rz.keyId) !== Boolean(rz.keySecret)) throw new Error('Set both RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET, or leave both empty to run with cash on delivery only.');
  if (rz.enabled && !rz.webhookSecret) console.warn('[env] RAZORPAY_WEBHOOK_SECRET is empty: POST /webhooks/razorpay answers 503, so failed payments, late captures and refunds will NOT sync.');
  if (rz.keyId && !/^rzp_(test|live)_/.test(rz.keyId)) throw new Error('RAZORPAY_KEY_ID must start with rzp_test_ or rzp_live_.');
  const needed = env.isProd ? REQUIRED.concat(REQUIRED_IN_PROD) : REQUIRED;
  const missing = needed.filter((k) => !process.env[k]);
  if (env.isProd) {
    const weak = ['JWT_SECRET', 'OTP_PEPPER'].filter((k) => process.env[k] && process.env[k].length < 32);
    if (weak.length) throw new Error(`${weak.join(', ')} must be at least 32 characters in production.`);
  } else {
    const crypto = require('crypto');
    if (!env.sessionSecret) env.sessionSecret = crypto.randomBytes(32).toString('hex');
    if (!env.otpPepper) env.otpPepper = crypto.randomBytes(32).toString('hex');
  }
  if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}. Copy .env.example to .env and fill them in.`);
  }
  // Production readiness report: warnings only, so an existing deployment keeps booting. ENV_STRICT=true makes errors fatal; `npm run check:env` exits 1 on errors.
  if (env.isProd) {
    const items = require('./preflight').evaluate(process.env).filter((i) => i.level !== 'info');
    items.forEach((i) => (i.level === 'error' ? console.error : console.warn)(`[env] ${i.key}: ${i.message}`));
    if (process.env.ENV_STRICT === 'true' && items.some((i) => i.level === 'error')) throw new Error('Production environment check failed (ENV_STRICT=true). See the [env] lines above.');
  }
}

module.exports = { env, assertEnv };
