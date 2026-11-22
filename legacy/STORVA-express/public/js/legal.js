'use strict';
// Privacy / terms pages: fill in the brand name and support email (was an inline script; moved out for the strict CSP).
fetch('/api/config/public').then((r) => (r.ok ? r.json() : null)).then((c) => {
  if (!c) return;
  document.querySelectorAll('[data-brand]').forEach((e) => { e.textContent = c.brand; });
  const a = document.getElementById('sup'); if (a && c.supportEmail) { a.textContent = c.supportEmail; a.href = 'mailto:' + c.supportEmail; }
}).catch(() => {});
