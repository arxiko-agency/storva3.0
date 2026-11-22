'use strict';
// Affiliate page: program facts, join form, personal link, funnel, earnings, referrals and commissions.
// Talks to /api/affiliate/*. All text is set with textContent (no innerHTML), so it runs under the strict CSP.
const $ = (s) => document.querySelector(s);
const root = $('#root');
const rupee = (n) => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const day = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (v == null) continue; if (k === 'text') n.textContent = v; else if (k === 'class') n.className = v; else n.setAttribute(k, v); }
  kids.flat().forEach((c) => { if (c != null) n.append(c.nodeType ? c : document.createTextNode(String(c))); });
  return n;
}
let toastTimer; function toast(m) { const t = $('#toast'); t.textContent = m; t.style.display = 'block'; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.style.display = 'none'; }, 3500); }
async function API(path, { method = 'GET', body } = {}) {
  const r = await fetch('/api' + path, { method, credentials: 'same-origin', headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch { /* not JSON */ }
  if (!r.ok) { const e = new Error((j && j.error && j.error.message) || 'Something went wrong. Please try again.'); e.status = r.status; e.fields = j && j.error && j.error.fields; throw e; }
  return j;
}
async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('Link copied'); }
  catch { const i = $('#afLink'); if (i) { i.select(); toast('Press Ctrl+C to copy'); } }
}

const stat = (label, value, sub) => el('div', { class: 'stat' }, el('div', { class: 'muted small', text: label }), el('b', { text: value }), sub ? el('div', { class: 'muted small', text: sub }) : null);
const facts = (p) => el('ul', { class: 'af-facts' },
  el('li', { text: `${p.commissionPercent}% commission` }), el('li', { text: `on up to ${p.maxPayments} payments per customer` }),
  el('li', { text: `payable ${p.holdDays} days after the payment` }), el('li', { text: `payouts from ${rupee(p.minPayout)} by UPI` }));

function hero(p) {
  return el('section', { class: 'af-hero' }, el('h1', { text: 'Earn with STORVA' }),
    el('p', { text: `Share your link. When someone you refer pays for a STORVA plan, you earn ${p.commissionPercent}% of what they pay.` }), facts(p));
}
function steps() {
  return el('div', { class: 'af-steps' },
    el('div', { class: 'af-step' }, el('b', { text: '1. Get your link' }), el('span', { class: 'muted small', text: 'Join in a minute with your STORVA account.' })),
    el('div', { class: 'af-step' }, el('b', { text: '2. Share it' }), el('span', { class: 'muted small', text: 'Anyone who signs up within 30 days of clicking is yours.' })),
    el('div', { class: 'af-step' }, el('b', { text: '3. Get paid' }), el('span', { class: 'muted small', text: 'Commission is credited on every paid plan payment.' })));
}

function joinForm(p) {
  const form = el('form', { class: 'card', novalidate: '' },
    el('h2', { text: 'Join the program' }),
    el('label', { for: 'afCode', text: 'Custom code (optional)' }), el('input', { id: 'afCode', name: 'code', maxlength: '16', autocomplete: 'off', placeholder: 'e.g. ANITA10 — leave empty for an automatic one' }), el('p', { class: 'err', id: 'e_code' }),
    el('label', { for: 'afUpi', text: 'UPI ID for payouts (optional now, needed before your first payout)' }), el('input', { id: 'afUpi', name: 'upiId', autocomplete: 'off', placeholder: 'name@bank' }), el('p', { class: 'err', id: 'e_upiId' }),
    el('label', { class: 'chk' }, el('input', { type: 'checkbox', name: 'acceptTerms' }), el('span', { text: `I agree to the affiliate terms: no self-referrals, no spam or misleading ads, and commissions can be reversed for refunds or abuse.` })), el('p', { class: 'err', id: 'e_acceptTerms' }),
    el('p', { class: 'err', id: 'e_form', role: 'alert' }),
    el('button', { class: 'btn', type: 'submit', text: 'Get my referral link' }));
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    document.querySelectorAll('.err').forEach((n) => { n.textContent = ''; });
    const f = new FormData(form), btn = form.querySelector('button'); btn.disabled = true;
    try { await API('/affiliate/register', { method: 'POST', body: { code: f.get('code'), upiId: f.get('upiId'), acceptTerms: f.get('acceptTerms') === 'on' } }); toast('Welcome aboard!'); await load(); }
    catch (e) {
      const fe = e.fields || {}; let shown = false;
      for (const [k, m] of Object.entries(fe)) { const n = $('#e_' + k); if (n) { n.textContent = m; shown = true; } }
      if (!shown) $('#e_form').textContent = e.message;
    } finally { btn.disabled = false; }
  });
  return form;
}

function linkCard(a) {
  const input = el('input', { id: 'afLink', readonly: '', value: a.link, 'aria-label': 'Your referral link' });
  const btn = el('button', { class: 'btn', type: 'button', text: 'Copy link' }); btn.addEventListener('click', () => copy(a.link));
  const share = el('a', { class: 'btn-link', target: '_blank', rel: 'noopener', href: 'https://wa.me/?text=' + encodeURIComponent('Build your online store from WhatsApp with STORVA: ' + a.link), text: 'Share on WhatsApp' });
  return el('section', { class: 'card' }, el('h2', { text: 'Your referral link' }), el('div', { class: 'af-link' }, input, btn, share),
    el('p', { class: 'muted small', text: `Your code: ${a.code}` + (a.status === 'suspended' ? ' · SUSPENDED: new sign-ups are not tracked. Contact support.' : '') }));
}

function table(headers, rows, empty) {
  if (!rows.length) return el('p', { class: 'muted', text: empty });
  return el('div', { class: 'scroll' }, el('table', { class: 'vt' }, el('thead', {}, el('tr', {}, headers.map((h) => el('th', { text: h })))), el('tbody', {}, rows.map((r) => el('tr', {}, r.map((c) => el('td', {}, c)))))));
}
const badge = (s) => el('span', { class: 'badge af-' + s, text: s.replace('_', ' ') });

function upiCard(a) {
  const form = el('form', { class: 'card', novalidate: '' }, el('h2', { text: 'Payout details' }),
    el('label', { for: 'afUpi2', text: 'UPI ID' }), el('input', { id: 'afUpi2', name: 'upiId', value: a.upiId || '', autocomplete: 'off', placeholder: 'name@bank' }), el('p', { class: 'err', id: 'e_upiId' }),
    el('button', { class: 'btn', type: 'submit', text: 'Save' }));
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault(); $('#e_upiId').textContent = '';
    try { await API('/affiliate/me', { method: 'PATCH', body: { upiId: new FormData(form).get('upiId') } }); toast('Saved'); }
    catch (e) { $('#e_upiId').textContent = (e.fields && e.fields.upiId) || e.message; }
  });
  return form;
}

function dashboard(me, s) {
  const f = s.funnel, e = s.earnings;
  return [
    hero(me.program), linkCard(s.affiliate),
    el('section', { class: 'card' }, el('h2', { text: 'Performance' }),
      el('div', { class: 'af-funnel' }, stat('Link clicks', String(f.clicks)), stat('Sign-ups', String(f.signups), f.clicks ? f.signupRate + '% of clicks' : ''), stat('Paying customers', String(f.customers), f.signups ? f.customerRate + '% of sign-ups' : ''))),
    el('section', { class: 'card' }, el('h2', { text: 'Earnings' }),
      el('div', { class: 'cards' }, stat('Payable now', rupee(e.payable), e.payable && e.payable < e.minPayout ? `Payouts start at ${rupee(e.minPayout)}` : 'Ready for payout'), stat('Pending', rupee(e.pending), `Held for ${me.program.holdDays} days`), stat('Paid out', rupee(e.paid)), stat('Lifetime', rupee(e.lifetime)))),
    el('section', { class: 'card' }, el('h2', { text: 'Recent referrals' }), table(['Person', 'Status', 'Joined', 'Paid plans'], s.referrals.map((r) => [r.name, badge(r.status), day(r.joinedAt), String(r.payments)]), 'No sign-ups yet. Share your link to get started.')),
    el('section', { class: 'card' }, el('h2', { text: 'Commissions' }), table(['Date', 'Plan', 'Paid by customer', 'You earn', 'Status'], s.commissions.map((c) => [day(c.createdAt), `${c.plan} · ${c.cycle}`, rupee(c.base), rupee(c.amount), el('span', {}, badge(c.status), c.status === 'pending' ? ` payable from ${day(c.availableAt)}` : '')]), 'Commissions appear here when someone you referred pays for a plan.')),
    upiCard(s.affiliate),
  ];
}

async function load() {
  let me;
  try { me = await API('/affiliate/me'); }
  catch (e) {
    if (e.status === 401) { // not signed in: show the offer and a way in
      const p = (await API('/affiliate/program')).program;
      root.replaceChildren(hero(p), steps(), el('section', { class: 'card' }, el('h2', { text: 'Ready to start?' }), el('p', { class: 'muted', text: 'Log in (or create a free account) and come back here to get your link.' }), el('a', { class: 'btn-link', href: '/#login', text: 'Log in / Sign up' })));
      return;
    }
    root.replaceChildren(el('p', { class: 'err', text: e.message })); return;
  }
  $('#who').textContent = '';
  if (!me.program.enabled) { root.replaceChildren(el('p', { class: 'muted', text: 'The affiliate program is not open right now.' })); return; }
  if (!me.affiliate) { root.replaceChildren(hero(me.program), steps(), joinForm(me.program)); return; }
  root.replaceChildren(...dashboard(me, await API('/affiliate/stats')));
}
load();
