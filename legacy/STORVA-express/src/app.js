'use strict';
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const compression = require('compression');
const morgan = require('morgan');
const { env } = require('./config/env');
const { apiLimiter } = require('./middleware/rateLimit');
const { notFoundApi, errorHandler } = require('./middleware/error');
const { originGuard } = require('./middleware/auth');

function createApp() {
  const app = express();
  require('./services/webhooks').setPostApplyHook(require('./services/orderSettlement').settleFullRefund); // full refund of a not-yet-shipped order -> cancel + return stock (Module 6 hardening)
  require('./services/notifications').register();
  require('./services/autoRefund').register(); // cancelled paid online order -> automatic Razorpay refund (idempotent; the background sweep repairs anything missed)
  require('./services/affiliates').register(); // referral program: a paid plan payment by a referred customer -> one commission (idempotent)
  require('./services/customers').register(); // Module 11: customer records follow their orders // Module 13: domain events -> in-app alerts, emails, WhatsApp (idempotent)
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // Render / most hosts sit behind one proxy
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));

  // Module 15: request id on every response (X-Request-Id) so a customer's error can be matched to the exact log line.
  app.use((req, res, next) => { const inbound = req.get('x-request-id'); req.id = inbound && /^[\w-]{8,64}$/.test(inbound) ? inbound : require('crypto').randomBytes(8).toString('hex'); res.setHeader('X-Request-Id', req.id); next(); });

  // Module 15: strict Content-Security-Policy everywhere. Landing, legal pages, dashboard and storefront use only our own
  // scripts (Tailwind is pre-built, no inline handlers), so no inline / eval'd / third-party script runs except Razorpay Checkout.
  // style-src keeps 'unsafe-inline' (style attributes; styles cannot run script). APP_CSP=relaxed is an emergency escape hatch.
  const relaxed = process.env.APP_CSP === 'relaxed';
  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'script-src': relaxed ? ["'self'", "'unsafe-inline'", 'https://checkout.razorpay.com'] : ["'self'", 'https://checkout.razorpay.com'],
        'script-src-attr': [relaxed ? "'unsafe-inline'" : "'none'"],
        'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        'font-src': ["'self'", 'https://fonts.gstatic.com'],
        'img-src': ["'self'", 'data:', 'blob:', 'https:'],
        'connect-src': ["'self'", 'https://lumberjack.razorpay.com', 'https://api.razorpay.com', 'https://checkout.razorpay.com'],
        'frame-src': ["'self'", 'https://api.razorpay.com', 'https://checkout.razorpay.com'],
        'form-action': ["'self'", 'https://api.razorpay.com'],
        'object-src': ["'none'"], 'base-uri': ["'self'"], 'frame-ancestors': ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  }));
  app.use((req, res, next) => { res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(self "https://checkout.razorpay.com" "https://api.razorpay.com"), usb=(), interest-cohort=()'); next(); });
  app.use(compression());
  if (!env.isProd || process.env.LOG_HTTP === '1') app.use(morgan('dev'));
  else if (process.env.LOG_HTTP === 'json') app.use(morgan((t, req, res) => JSON.stringify({ level: 'info', at: new Date().toISOString(), id: req.id, method: req.method, path: req.path, status: Number(t.status(req, res)), ms: Number(t['response-time'](req, res)) }))); // Module 15: structured access log (no query strings, no IPs)

  app.use(cors({ origin: env.appUrl, credentials: true }));
  // Raw body routes (Razorpay / WhatsApp webhooks) are mounted BEFORE this in later modules.
  app.use('/webhooks', require('./routes/webhooks')); // Module 6 step 3: POST /webhooks/razorpay (HMAC-verified raw body)
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  app.use('/api', apiLimiter, originGuard, require('./routes'), notFoundApi);

  // Module 5: server-rendered storefront pages (/store/:slug, product, cart, checkout, order). Must come before the static handler.
  app.use('/store', require('./utils/csp').storefrontCspMiddleware(), require('./routes/storefrontPages')); // strict CSP (no inline / eval script) for the public storefront

  // Affiliate referral links: /r/CODE counts the click, remembers the code for 30 days and sends the visitor to sign-up.
  app.use('/r', require('./routes/referralLink'));

  // User uploads: images only (validated by magic bytes on upload), never executed or sniffed as another type.
  app.use('/uploads', express.static(env.uploadDir, { index: false, dotfiles: 'deny', fallthrough: false, maxAge: env.isProd ? '7d' : 0,
    setHeaders: (res) => { res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Content-Security-Policy', "default-src 'none'"); res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin'); } }));
  app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'], maxAge: env.isProd ? '1h' : 0 }));

  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
