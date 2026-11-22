'use strict';
// Module 15 pure checks: alert de-duplication and caps, CSP helper, no CDN / inline handlers left in the shipped pages.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'); const path = require('path');
const M = require('../src/services/monitor');

test('alerts: same error once per 10 minutes, at most 30 per hour', () => {
  M._reset(); const t = Date.now();
  assert.equal(M._shouldAlert('a', t), true); assert.equal(M._shouldAlert('a', t + 60e3), false); assert.equal(M._shouldAlert('a', t + 11 * 60e3), true);
  M._reset(); let sent = 0; for (let i = 0; i < 50; i++) if (M._shouldAlert('fp' + i, t)) sent++; assert.equal(sent, 30);
});

test('shipped pages: no Tailwind CDN, no inline handlers, no inline scripts', () => {
  const pub = path.join(__dirname, '..', 'public');
  for (const f of ['index.html', 'privacy.html', 'terms.html', 'dashboard.html']) {
    const s = fs.readFileSync(path.join(pub, f), 'utf8');
    assert.ok(!s.includes('cdn.tailwindcss.com'), f); assert.ok(!/\son(click|change|submit|input|load)=/i.test(s), f); assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/.test(s), f + ' inline script');
  }
  for (const f of fs.readdirSync(path.join(pub, 'js'))) { const s = fs.readFileSync(path.join(pub, 'js', f), 'utf8'); assert.ok(!/\son(click|change|submit|input)=["\\]/.test(s), `${f} builds an inline handler`); assert.ok(!/\beval\(|new Function\(/.test(s), `${f} uses eval`); }
});
