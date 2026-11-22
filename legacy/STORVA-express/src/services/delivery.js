'use strict';
// Sends OTP codes by SMS (MSG91) or email (SMTP via Nodemailer).
// If a provider is not configured: production fails loudly (503); development prints the code to the
// server console only. Codes are never returned in an API response.
const { env } = require('../config/env');
const AppError = require('../utils/AppError');

const smsConfigured = () => !!(env.msg91.authKey && env.msg91.templateId);
const mailConfigured = () => !!(env.smtp.host && env.smtp.user && env.smtp.pass);

async function sendSms(phone, code) {
  if (!smsConfigured()) return devFallback('SMS', phone, code);
  const url = new URL('https://control.msg91.com/api/v5/otp');
  url.search = new URLSearchParams({ template_id: env.msg91.templateId, mobile: phone, otp: code, otp_expiry: '10' }).toString();
  let res, data;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { authkey: env.msg91.authKey, 'content-type': 'application/json', accept: 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(10000),
    });
    data = await res.json().catch(() => ({}));
  } catch (e) {
    console.error('[msg91] request failed:', e.message);
    throw new AppError('Could not send the SMS right now. Please try again.', 502, 'sms_failed');
  }
  if (!res.ok || data.type === 'error') {
    console.error('[msg91] rejected:', res.status, data.message);
    throw new AppError('Could not send the SMS right now. Please try again.', 502, 'sms_failed');
  }
}

let transporter;
function getTransporter() {
  if (!transporter) {
    const nodemailer = require('nodemailer');
    transporter = nodemailer.createTransport({
      host: env.smtp.host, port: env.smtp.port, secure: env.smtp.port === 465,
      auth: { user: env.smtp.user, pass: env.smtp.pass },
      // Without timeouts a dead SMTP server would hang the request (OTP) or the outbox worker indefinitely.
      connectionTimeout: Number(process.env.SMTP_CONNECTION_TIMEOUT_MS) || 10000, greetingTimeout: 10000, socketTimeout: 20000,
      // Port 587 = STARTTLS: refuse to send the password over a connection that could not be upgraded (SMTP_REQUIRE_TLS=false to allow).
      ...(env.smtp.port === 587 && process.env.SMTP_REQUIRE_TLS !== 'false' ? { requireTLS: true } : {}),
    });
  }
  return transporter;
}

const PURPOSE_TEXT = { register: 'verify your email', login: 'log in', reset: 'reset your password' };

async function sendEmail(to, code, purpose) {
  if (!mailConfigured()) return devFallback('EMAIL', to, code);
  const brand = env.brandName;
  try {
    await getTransporter().sendMail({
      from: env.smtp.from, to,
      subject: `${code} is your ${brand} verification code`,
      text: `Use ${code} to ${PURPOSE_TEXT[purpose] || 'continue'} on ${brand}. It expires in 10 minutes. If you did not request this, ignore this email.`,
      html: `<div style="font-family:system-ui,sans-serif;max-width:420px"><h2 style="margin:0 0 8px">${brand}</h2><p>Use this code to ${PURPOSE_TEXT[purpose] || 'continue'}:</p><p style="font-size:32px;font-weight:800;letter-spacing:6px;margin:12px 0">${code}</p><p style="color:#666">It expires in 10 minutes. If you did not request this, you can ignore this email.</p></div>`,
    });
  } catch (e) {
    console.error('[mail] send failed:', e.message);
    throw new AppError('Could not send the email right now. Please try again.', 502, 'email_failed');
  }
}

function devFallback(kind, to, code) {
  if (env.isProd) {
    console.error(`[delivery] ${kind} provider is not configured`);
    throw new AppError('Verification messages are not available right now.', 503, 'delivery_unavailable');
  }
  console.warn(`[dev-otp] ${kind} provider not configured. Code for ${to}: ${code}`);
}

// Live connection + login check against the real SMTP server (used by scripts/check-integrations.js). Sends nothing.
const verifySmtp = () => getTransporter().verify();

module.exports = { sendSms, sendEmail, smsConfigured, mailConfigured, getTransporter, verifySmtp };
