'use strict';
// Dashboard view for Module 6 step 4: owner payments and refunds. Loaded BEFORE dashboard.js, uses its helpers (el, API, base, toast, field, select, val, showErrors, inr, render)
// only when a view is opened. Text always goes through textContent. The browser never sends a refund limit: the server validates every amount against the saved order.
const PAY_TEXT = { paid: 'Paid', pending: 'Payment pending', failed: 'Payment failed', refunded: 'Fully refunded', partially_refunded: 'Partially refunded', refund_pending: 'Refund in progress', cod_paid: 'Cash received', cod_unpaid: 'Cash not received' };
const RF_TEXT = { pending: 'Sending to Razorpay', created: 'In progress', processed: 'Refunded', failed: 'Failed' };
const whenP = (d) => (d ? new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '');
const dsBadge = (p) => el('span', { class: 'badge ds-' + p.displayStatus, text: p.statusText || PAY_TEXT[p.displayStatus] || p.displayStatus });
const rfBadge = (s) => el('span', { class: 'badge rf-' + s, text: RF_TEXT[s] || s });
const refundKeys = {}; // order number -> request key. Reused until the server gives a final answer, so a double click or a retry after a lost response cannot refund twice.
const newKey = () => (window.crypto && crypto.randomUUID ? crypto.randomUUID() : Array.from({ length: 4 }, () => Math.random().toString(36).slice(2, 10)).join('')).replace(/[^A-Za-z0-9_-]/g, '').padEnd(16, 'x').slice(0, 64);

async function paymentsView(param) {
  if (param) return paymentDetail(param);
  const state = { q: '', status: '', method: 'online', page: 1 };
  const cards = el('div', { class: 'cards' }), list = el('div', { class: 'card' }), bar = el('div', { class: 'filters' });
  const q = el('input', { type: 'search', placeholder: 'Search order #, name, phone or pay_… id', 'aria-label': 'Search payments' });
  const st = select('pStatus', null, [['', 'All statuses'], ['paid', 'Paid'], ['pending', 'Pending'], ['failed', 'Failed'], ['partially_refunded', 'Partially refunded'], ['refund_pending', 'Refund in progress'], ['refunded', 'Fully refunded']]);
  const me = select('pMethod', null, [['online', 'Online payments'], ['cod', 'Cash on delivery']]);
  bar.append(q, st, me);
  const stat = (label, big, sub) => el('div', { class: 'stat' }, el('div', { class: 'muted small', text: label }), el('b', { class: 'big', text: big }), el('div', { class: 'muted small', text: sub }));
  const n = (c) => `${c} order${c === 1 ? '' : 's'}`;
  async function loadCards() {
    const { summary: s } = await API(base() + '/payments/summary');
    cards.replaceChildren(
      stat('Successful payments', inr(s.successful.amount), n(s.successful.count)), stat('Pending payments', inr(s.pending.amount), n(s.pending.count)),
      stat('Failed payments', inr(s.failed.amount), n(s.failed.count)), stat('Refunded', inr(s.refunded.amount), s.refundsInProgress.count ? `${inr(s.refundsInProgress.amount)} in progress` : 'processed refunds'),
      stat('Net collected online', inr(s.netCollected), 'successful minus refunded'), stat('Cash on delivery', inr(s.cod.paid.amount), `${inr(s.cod.unpaid.amount)} still to collect`));
  }
  async function refresh() {
    const r = await API(base() + '/payments/transactions?' + new URLSearchParams({ q: state.q, status: state.status, method: state.method === 'cod' ? 'cod' : '', page: state.page, limit: 10 }));
    const rows = r.transactions.map((p) => el('a', { class: 'row-item order-row', href: '#payments/' + p.orderNumber },
      el('div', { class: 'grow' }, el('b', { text: `#${p.orderNumber} · ${p.customer.name}` }), el('div', { class: 'muted small', text: `${whenP(p.createdAt)}${p.refundedAmount > 0 ? ' · refunded ' + inr(p.refundedAmount) : ''}` })),
      el('b', { text: inr(p.amount) }), dsBadge(p)));
    list.replaceChildren(el('div', { class: 'muted small', text: `${r.total} transaction${r.total === 1 ? '' : 's'}` }),
      ...(rows.length ? rows : [el('p', { class: 'muted', text: state.q || state.status ? 'No payments match these filters.' : 'No payments yet. Online payments from your storefront show up here.' })]),
      el('div', { class: 'pager' }, el('button', { class: 'link', type: 'button', text: '← Prev', disabled: r.page <= 1 ? '' : null, onclick: () => { state.page--; refresh(); } }), el('span', { class: 'muted small', text: `Page ${r.page} of ${r.pages}` }), el('button', { class: 'link', type: 'button', text: 'Next →', disabled: r.page >= r.pages ? '' : null, onclick: () => { state.page++; refresh(); } })));
  }
  let t; q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { state.q = q.value.trim(); state.page = 1; refresh(); }, 300); });
  st.querySelector('select').addEventListener('change', (e) => { state.status = e.target.value; state.page = 1; refresh(); });
  me.querySelector('select').addEventListener('change', (e) => { state.method = e.target.value; state.page = 1; refresh(); });
  const issues = el('div');
  async function loadIssues() { // discrepancies with Razorpay that were NOT fixed automatically and need a human look
    const { issues: rows } = await API(base() + '/payments/issues');
    issues.replaceChildren(...(rows.length ? [el('div', { class: 'card' }, el('h2', { text: 'Needs your review' }), el('p', { class: 'muted small', text: 'Your records and Razorpay do not agree on these orders. Nothing was changed automatically.' }),
      ...rows.map((i) => el('div', { class: 'row-item' }, el('div', { class: 'grow' }, el('a', { class: 'link', href: '#payments/' + i.orderNumber, text: 'Order #' + i.orderNumber }), el('div', { class: 'small', text: i.message }), el('div', { class: 'muted small', text: [i.detail, 'last seen ' + whenP(i.lastSeenAt)].filter(Boolean).join(' · ') })),
        el('button', { class: 'link', type: 'button', text: 'Dismiss', onclick: async (ev) => { ev.target.disabled = true; try { await API(`${base()}/payments/issues/${encodeURIComponent(i.id)}/dismiss`, { method: 'POST', body: {} }); loadIssues(); } catch (e) { toast(e.message); ev.target.disabled = false; } } }))))] : []));
  }
  await Promise.all([loadCards(), refresh(), loadIssues().catch(() => {})]);
  return [el('div', { class: 'head' }, el('h1', { text: 'Payments' })), issues, cards, bar, list];
}

async function paymentDetail(number) {
  const { payment: p } = await API(`${base()}/payments/${encodeURIComponent(number)}`);
  const ledger = el('div', { class: 'card' }, el('h2', { text: 'Refunds' }));
  if (!p.refunds.length) ledger.append(el('p', { class: 'muted', text: 'No refunds on this payment.' }));
  p.refunds.forEach((x) => ledger.append(el('div', { class: 'row-item' },
    el('div', { class: 'grow' }, el('b', { text: inr(x.amount) }), ' ', rfBadge(x.status),
      el('div', { class: 'muted small', text: [whenP(x.createdAt), x.source === 'dashboard' ? 'from this dashboard' : x.source === 'auto' ? 'automatic (order cancelled)' : 'from Razorpay', x.reason ? 'Reason: ' + x.reason : '', x.refundId || ''].filter(Boolean).join(' · ') }),
      x.error ? el('div', { class: 'small', style: 'color:#991b1b', text: x.error }) : null),
    x.canRetry ? el('button', { class: 'link', type: 'button', text: 'Check / retry', onclick: async (ev) => {
      ev.target.disabled = true;
      try { await API(`${base()}/payments/${p.orderNumber}/refunds/${encodeURIComponent(x.idempotencyKey)}/retry`, { method: 'POST', body: {} }); toast('Refund updated'); } catch (e) { toast(e.message); }
      render();
    } }) : null)));
  const sum = el('div', { class: 'card' }, el('div', { class: 'row' }, dsBadge(p), el('span', { class: 'muted small', text: p.paidAt ? 'Paid ' + whenP(p.paidAt) : 'Placed ' + whenP(p.createdAt) })),
    el('div', { class: 'tot-box' }, el('div', { text: 'Order total: ' + inr(p.amount) }), el('div', { text: 'Refunded: ' + inr(p.refundedAmount) }),
      p.refundInProgressAmount > 0 ? el('div', { text: 'Refund in progress: ' + inr(p.refundInProgressAmount) }) : null, el('b', { text: 'Still refundable: ' + inr(p.refundableAmount) })),
    el('div', { class: 'muted small', text: `${p.customer.name} · +${p.customer.phone}` }),
    p.razorpayPaymentId ? el('div', { class: 'muted small', text: 'Payment: ' + p.razorpayPaymentId }) : null, p.razorpayOrderId ? el('div', { class: 'muted small', text: 'Razorpay order: ' + p.razorpayOrderId }) : null,
    p.paymentError ? el('div', { class: 'small', style: 'color:#991b1b', text: 'Last failure: ' + p.paymentError }) : null,
    p.method === 'online' && p.displayStatus !== 'refunded' ? el('p', {}, el('button', { class: 'link', type: 'button', text: 'Check with Razorpay', onclick: async (ev) => {
      ev.target.disabled = true;
      try {
        const r = await API(`${base()}/payments/${p.orderNumber}/reconcile`, { method: 'POST', body: {} });
        toast(r.issues.length ? r.issues[0].message : r.changed ? 'Updated from Razorpay' : 'Already up to date');
      } catch (e) { toast(e.message); }
      render();
    } })) : null,
    el('p', {}, el('a', { class: 'link', href: '#orders/' + p.orderNumber, text: 'Open order #' + p.orderNumber + ' →' })));
  return [el('div', { class: 'head' }, el('a', { class: 'link', href: '#payments', text: '← Payments' }), el('h1', { text: `Payment · Order #${p.orderNumber}` })), sum, p.canRefund ? refundForm(p) : el('div', { class: 'card' }, el('h2', { text: 'Issue a refund' }), el('p', { class: 'muted', text: p.refundBlockedReason })), ledger];
}

function refundForm(p) {
  const form = el('form', { class: 'card' }, el('h2', { text: 'Issue a refund' }),
    el('label', { class: 'chk' }, el('input', { type: 'radio', name: 'rtype', value: 'full', checked: '' }), `Full refund (${inr(p.refundableAmount)})`),
    el('label', { class: 'chk' }, el('input', { type: 'radio', name: 'rtype', value: 'partial' }), 'Partial refund'),
    field('amount', 'Amount to refund (₹)', { type: 'number', ph: '0.00', hint: `At most ${inr(p.refundableAmount)}. The server checks this again.` }),
    field('reason', 'Reason (optional, for your records)', { ph: 'Item returned' }), el('div', { class: 'err', id: 'idempotencyKeyErr' }), el('div', { class: 'err', id: 'typeErr' }),
    el('button', { class: 'btn', type: 'submit', text: 'Refund via Razorpay' }));
  const amt = form.querySelector('#amount'); amt.step = '0.01'; amt.min = '0.01'; amt.disabled = true;
  form.querySelectorAll('input[name=rtype]').forEach((r) => r.addEventListener('change', () => { amt.disabled = form.querySelector('input[name=rtype]:checked').value !== 'partial'; if (amt.disabled) amt.value = ''; }));
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const type = form.querySelector('input[name=rtype]:checked').value, btn = form.querySelector('button[type=submit]');
    const text = type === 'full' ? inr(p.refundableAmount) : '₹' + (val(form, 'amount') || '0');
    if (!confirm(`Refund ${text} to the customer through Razorpay? This cannot be undone.`)) return;
    btn.disabled = true; refundKeys[p.orderNumber] = refundKeys[p.orderNumber] || newKey();
    try {
      await API(`${base()}/payments/${p.orderNumber}/refunds`, { method: 'POST', body: { type, amount: type === 'partial' ? val(form, 'amount') : undefined, reason: val(form, 'reason'), idempotencyKey: refundKeys[p.orderNumber] } });
      delete refundKeys[p.orderNumber]; toast('Refund requested'); render();
    } catch (e) {
      // A 4xx is a final "no": the next attempt gets a fresh key. Anything else (503, lost connection) may have reached Razorpay, so the SAME key is kept and the page shows the entry to retry.
      if (e.status >= 400 && e.status < 500 && e.status !== 409 && e.status !== 429) delete refundKeys[p.orderNumber];
      btn.disabled = false; showErrors(form, e); if (e.status >= 500 || !e.status) render();
    }
  });
  return form;
}
