'use strict';
// Module 8: Plan tab + the shared "upgrade" notice used by every gated feature. Loaded before dashboard.js (uses its helpers at call time).
function upgradeNote(message, feature) {
  return el('div', { class: 'upgrade', role: 'note' }, el('span', { text: message || 'This feature needs a higher plan.' }), el('a', { href: '#plan' + (feature ? '/' + encodeURIComponent(feature) : ''), text: 'See plans →' }));
}
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { dateStyle: 'medium' }) : '');
function meter(label, used, max) {
  const pct = max == null ? 0 : Math.min(100, Math.round((used / Math.max(1, max)) * 100));
  return el('div', { class: 'meter' + (pct >= 90 ? ' hot' : '') }, el('div', { class: 'row' }, el('span', { class: 'grow small', text: label }), el('b', { class: 'small', text: max == null ? `${used} · unlimited` : `${used} / ${max}` })),
    el('div', { class: 'bar' }, el('i', { style: `width:${pct}%` })));
}
let rzpScript = null;
const loadRazorpay = () => rzpScript || (rzpScript = new Promise((resolve, reject) => {
  if (window.Razorpay) return resolve();
  const s = document.createElement('script'); s.src = 'https://checkout.razorpay.com/v1/checkout.js'; s.onload = resolve; s.onerror = () => { rzpScript = null; reject(new Error('Could not load the payment window. Check your connection.')); }; document.head.append(s);
}));

async function planView() {
  const B = await API(base() + '/billing');
  let cycle = 'yearly';
  const cur = B.current;
  const head = el('div', { class: 'card plan-now' },
    el('div', { class: 'row' }, el('div', { class: 'grow' }, el('div', { class: 'muted small', text: 'Current plan' }), el('h2', { class: 'big', text: cur.name })),
      cur.expiresAt ? el('div', { class: 'r' }, el('div', { class: 'muted small', text: cur.inGrace ? 'Ended — grace period' : 'Renews / ends' }), el('b', { text: fmtDate(cur.expiresAt) })) : null),
    cur.inGrace ? el('p', { class: 'err', text: `Your plan period has ended. Paid features stay on for ${cur.graceDays} days. Renew to keep them.` }) : null,
    meter('Active products', B.usage.activeProducts, cur.limits.activeProducts), meter('All products (incl. drafts)', B.usage.totalProducts, cur.limits.totalProducts),
    cur.limits.aiCreditsPerMonth ? meter('AI credits this month', B.usage.aiCreditsUsed, cur.limits.aiCreditsPerMonth) : null, meter('Stores', B.usage.stores, cur.limits.stores));
  const grid = el('div', { class: 'plans' });
  const toggle = el('div', { class: 'seg', role: 'group', 'aria-label': 'Billing period' });
  function drawToggle() { toggle.replaceChildren(...[['monthly', 'Monthly'], ['yearly', 'Yearly · save 20%']].map(([k, t]) => el('button', { type: 'button', class: k === cycle ? 'on' : '', text: t, onclick: () => { cycle = k; drawToggle(); drawPlans(); } }))); }
  async function buy(plan) {
    try {
      if (!B.checkout.online && B.checkout.devMode) {
        if (!confirm(`Development mode: activate ${plan} (${cycle}) without paying?`)) return;
        await API(base() + '/billing/dev-activate', { method: 'POST', body: { plan, cycle } }); toast('Plan activated (test)'); await load(); location.hash = '#plan'; return;
      }
      const q = (await API(base() + '/billing/quote', { method: 'POST', body: { plan, cycle } })).quote;
      const msg = `${q.renewal ? 'Renew' : 'Upgrade to'} ${plan === 'pro' ? 'Pro' : 'Advanced'} for ${inr(q.amount)}?\nNew period: ${fmtDate(q.periodStart)} – ${fmtDate(q.periodEnd)}${q.creditDays ? `\nIncludes ${q.creditDays} extra days for the unused time on your current plan.` : ''}`;
      if (!confirm(msg)) return;
      const { checkout: c } = await API(base() + '/billing/checkout', { method: 'POST', body: { plan, cycle } });
      await loadRazorpay();
      const rzp = new window.Razorpay({ key: c.keyId, order_id: c.razorpayOrderId, amount: c.amount, currency: c.currency, name: c.name, description: c.description, prefill: c.prefill, theme: { color: '#1c1917' },
        handler: async (resp) => { try { await API(base() + '/billing/verify', { method: 'POST', body: resp }); toast('Payment received. Your plan is active!'); await load(); location.hash = '#plan'; } catch (e) { toast(e.message); } },
        modal: { ondismiss: () => toast('Payment cancelled. You were not charged.') } });
      rzp.on('payment.failed', (r) => toast((r.error && r.error.description) || 'Payment failed. You were not charged.'));
      rzp.open();
    } catch (e) { toast(e.message); }
  }
  async function subscribe(plan) {
    try {
      if (!confirm(`Turn on auto-renew for ${plan === 'pro' ? 'Pro' : 'Advanced'} (${cycle})?\nRazorpay will charge your payment method every ${cycle === 'yearly' ? 'year' : 'month'} until you turn it off here.`)) return;
      const { checkout: c } = await API(base() + '/billing/subscribe', { method: 'POST', body: { plan, cycle } });
      await loadRazorpay();
      const rzp = new window.Razorpay({ key: c.keyId, subscription_id: c.subscriptionId, name: c.name, description: c.description, prefill: c.prefill, theme: { color: '#1c1917' },
        handler: async (resp) => { try { await API(base() + '/billing/subscription/verify', { method: 'POST', body: resp }); toast(c.startsAt ? 'Auto-renew is on. Your next charge is on ' + fmtDate(c.startsAt) + '.' : 'Payment received. Auto-renew is on!'); await load(); location.hash = '#plan'; } catch (e) { toast(e.message); } },
        modal: { ondismiss: () => toast('Cancelled. You were not charged.') } });
      rzp.on('payment.failed', (r) => toast((r.error && r.error.description) || 'Payment failed. You were not charged.'));
      rzp.open();
    } catch (e) { toast(e.message); }
  }
  async function stopAutoRenew() {
    if (!confirm('Turn off auto-renew? Your plan stays active until the end of the period you already paid for.')) return;
    try { await API(base() + '/billing/subscription/cancel', { method: 'POST' }); toast('Auto-renew is off.'); await load(); location.hash = '#plan'; } catch (e) { toast(e.message); }
  }
  const sub = B.subscription, subLive = sub && ['authenticated', 'active', 'pending'].includes(sub.status);
  function drawPlans() {
    grid.replaceChildren(...B.plans.map((p) => {
      const isCur = p.id === cur.id, price = cycle === 'yearly' ? p.price.yearlyPerMonth : p.price.monthly;
      const curRank = (B.plans.find((x) => x.id === cur.id) || { rank: 0 }).rank;
      const cta = p.id === 'free' ? null : isCur ? el('button', { class: 'btn', type: 'button', text: 'Renew', onclick: () => buy(p.id) }) : p.rank > curRank ? el('button', { class: 'btn', type: 'button', text: 'Upgrade', onclick: () => buy(p.id) }) : el('button', { class: 'btn', type: 'button', disabled: '', text: 'Available when your plan ends' });
      const auto = B.checkout.subscriptions && !subLive && p.id !== 'free' && (isCur || p.rank > curRank) ? el('button', { class: 'btn-ghost', type: 'button', text: 'Pay & auto-renew', onclick: () => subscribe(p.id) }) : null;
      return el('div', { class: 'plan' + (p.popular ? ' pop' : '') + (isCur ? ' cur' : '') }, p.popular ? el('span', { class: 'pill', text: 'Most popular' }) : null, isCur ? el('span', { class: 'pill cur', text: 'Your plan' }) : null,
        el('h3', { text: p.name }), el('p', { class: 'price' }, el('b', { text: price ? inr(price) : 'Free' }), price ? el('span', { class: 'muted', text: ' /month' }) : null),
        cycle === 'yearly' && p.price.yearly ? el('div', { class: 'muted small', text: `${inr(p.price.yearly)} billed once a year` }) : el('div', { class: 'muted small', text: p.price.monthly ? 'billed monthly' : 'forever' }),
        el('p', { class: 'muted small', text: p.tagline }), el('ul', {}, p.highlights.map((h) => el('li', { text: h }))), cta, auto);
    }));
  }
  drawToggle(); drawPlans();
  const hist = el('div', { class: 'card' }, el('h2', { text: 'Billing history' }),
    ...(B.payments.length ? B.payments.map((p) => el('div', { class: 'row-item' }, el('div', { class: 'grow' }, el('b', { text: `${p.plan === 'pro' ? 'Pro' : 'Advanced'} · ${p.cycle}` }), el('div', { class: 'muted small', text: [fmtDate(p.paidAt || p.createdAt), p.periodEnd ? 'until ' + fmtDate(p.periodEnd) : '', p.source === 'dev' ? 'test activation' : '', p.source === 'subscription' ? 'auto-renew' : ''].filter(Boolean).join(' · ') })),
      el('b', { text: inr(p.amount) }), el('span', { class: 'badge ' + (p.status === 'paid' ? 'active' : p.status === 'failed' ? 'st-cancelled' : 'draft'), text: p.status }),
      p.status === 'paid' && p.source !== 'dev' ? el('a', { class: 'link', href: `/api${base()}/billing/payments/${p.id}/invoice`, target: '_blank', rel: 'noopener', text: 'Invoice' }) : null)) : [el('p', { class: 'muted', text: 'No payments yet.' })]));
  const planName = (id) => (id === 'pro' ? 'Pro' : 'Advanced');
  const subCard = sub ? el('div', { class: 'card' }, el('h2', { text: 'Auto-renew' }),
    el('p', { class: sub.status === 'halted' ? 'err' : 'muted', text: sub.status === 'halted' ? 'Your last automatic payment could not be collected, so auto-renew stopped. Renew below to keep your plan.' : sub.cancelAtCycleEnd ? `Auto-renew is off. Your plan ends on ${fmtDate(cur.expiresAt)}.` : `Auto-renew is on for ${planName(sub.plan)} (${sub.cycle}, ${inr(sub.amount)}).${sub.nextChargeAt ? ' Next charge: ' + fmtDate(sub.nextChargeAt) + '.' : ''}` }),
    subLive && !sub.cancelAtCycleEnd ? el('button', { class: 'btn-ghost', type: 'button', text: 'Turn off auto-renew', onclick: stopAutoRenew }) : null) : null;
  const note = !B.checkout.online ? el('p', { class: 'muted small', text: B.checkout.devMode ? 'Development mode: Razorpay keys are not set, so upgrades activate instantly without payment.' : 'Online plan payments are not configured yet.' }) : null;
  return [el('div', { class: 'head' }, el('h1', { text: 'Plan & billing' })), head, el('div', { class: 'head' }, el('h2', { text: 'Choose a plan' }), toggle), grid, subCard, note, hist];
}
