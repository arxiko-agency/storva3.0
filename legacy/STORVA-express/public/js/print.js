'use strict';
// Print button for invoices (no inline handlers, so pages work under a strict Content-Security-Policy).
document.querySelectorAll('[data-print]').forEach((b) => b.addEventListener('click', () => window.print()));
