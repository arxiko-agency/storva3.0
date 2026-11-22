'use strict';
// Module 13: Notifications tab (alerts list, preferences, delivery log, test messages) and the unread bell in the header.
// Loaded before dashboard.js (uses its helpers at call time). All text via textContent.
const NOTIF_ICON = { 'order.new': '🛍️', 'payment.received': '💰', 'payment.failed': '⚠️', 'refund.processed': '↩️', 'stock.low': '📦', 'plan.activated': '⭐', 'plan.expiring': '⏳', 'plan.expired': '⏳', 'payment.issue': '🚩' };
const ago = (d) => { const s = Math.max(1, Math.round((Date.now() - new Date(d)) / 1000)); return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : new Date(d).toLocaleDateString('en-IN', { dateStyle: 'medium' }); };

let unreadTimer = null;
async function refreshUnread() {
  if (!S.store) return;
  let n = 0;
  try { n = (await API(base() + '/notifications?limit=1')).unread; } catch { return; }
  let bell = document.querySelector('#bell');
  if (!bell) { bell = el('a', { id: 'bell', class: 'bell', href: '#notifications', 'aria-label': 'Notifications', text: '🔔' }); document.querySelector('#who').before(bell); }
  bell.querySelector('.unread-dot')?.remove();
  bell.setAttribute('aria-label', n ? `Notifications, ${n} unread` : 'Notifications');
  if (n) bell.append(el('span', { class: 'unread-dot', text: n > 99 ? '99+' : String(n) }));
  const tab = document.querySelector('[data-unread-tab]');
  if (tab) { tab.querySelector('.unread-dot')?.remove(); if (n) tab.append(el('span', { class: 'unread-dot', text: n > 99 ? '99+' : String(n) })); }
  if (!unreadTimer) unreadTimer = setInterval(() => { if (!document.hidden) refreshUnread(); }, 60000);
}

async function notificationsView() {
  const [list, cfg] = await Promise.all([API(base() + '/notifications?limit=50'), API(base() + '/notifications/settings')]);
  const out = [el('div', { class: 'head' }, el('h1', { text: 'Notifications' }),
    list.unread ? el('button', { class: 'btn-ghost', type: 'button', text: 'Mark all as read', onclick: async () => { await API(base() + '/notifications/read', { method: 'POST', body: {} }); render(); } }) : null)];

  // --- list ---
  const box = el('div', { class: 'card' });
  const draw = (rows) => box.replaceChildren(...(rows.length ? rows.map((n) => el('a', { class: `notif ${n.severity}${n.read ? '' : ' unread'}`, href: n.link || '#notifications', onclick: () => { if (!n.read) API(base() + '/notifications/read', { method: 'POST', body: { ids: [n.id] } }).catch(() => {}); } },
    el('span', { class: 'ico', 'aria-hidden': 'true', text: NOTIF_ICON[n.type] || '🔔' }),
    el('span', { class: 'grow' }, el('span', { text: n.title }), n.read ? null : el('span', { class: 'unread-dot', text: 'new', style: 'font-size:10px' }), n.body ? el('div', { class: 'body', text: n.body }) : null, el('div', { class: 'when', text: ago(n.createdAt) })))) : [el('p', { class: 'muted', text: 'No notifications yet. New orders, payments, refunds, low stock and plan reminders will appear here.' })]));
  draw(list.notifications);
  const more = list.notifications.length === 50 ? el('button', { class: 'btn-ghost', type: 'button', text: 'Load older', onclick: async (ev) => {
    const before = list.notifications[list.notifications.length - 1].createdAt;
    const r = await API(base() + '/notifications?limit=50&before=' + encodeURIComponent(before)); list.notifications.push(...r.notifications); draw(list.notifications); if (r.notifications.length < 50) ev.target.remove();
  } }) : null;
  out.push(box, more);

  // --- preferences ---
  const s = cfg.settings;
  const chk = (id, label, on, disabled) => el('label', { class: 'chk' }, el('input', { type: 'checkbox', id, ...(on ? { checked: '' } : {}), ...(disabled ? { disabled: '' } : {}) }), label);
  const waOff = !cfg.whatsappAlertsAvailable;
  const prefs = el('form', { class: 'card toggles' }, el('h2', { text: 'What should we tell you?' }),
    el('p', { class: 'muted small' }, 'Alerts go to ', el('b', { text: cfg.sendTo.email || 'no email set' }), ' and WhatsApp ', el('b', { text: cfg.sendTo.whatsapp ? '+' + cfg.sendTo.whatsapp : 'no number set' }), '. Change them in ', el('a', { class: 'link', href: '#settings', text: 'Store settings' }), '.'),
    el('div', { class: 'grid2' },
      el('div', {}, el('h3', { text: '📧 Email me when…' }), chk('e_newOrder', 'A new order arrives', s.ownerEmail.newOrder), chk('e_paymentFailed', 'An online payment fails', s.ownerEmail.paymentFailed), chk('e_refund', 'A refund is processed', s.ownerEmail.refund),
        chk('e_lowStock', 'A product runs low', s.ownerEmail.lowStock), chk('e_issues', 'A payment needs review', s.ownerEmail.issues), chk('e_plan', 'My plan is about to end', s.ownerEmail.plan), chk('e_dailySummary', 'Daily summary at 9 pm', s.ownerEmail.dailySummary)),
      el('div', {}, el('h3', { text: '💬 WhatsApp me when…' }), chk('w_newOrder', 'A new order arrives', s.ownerWhatsapp.newOrder, waOff), chk('w_lowStock', 'A product runs low', s.ownerWhatsapp.lowStock, waOff),
        el('h3', { text: '🧾 Tell my customers' }), chk('b_email', 'By email (confirmation, shipping, refunds)', s.buyerEmail), chk('b_whatsapp', 'On WhatsApp (confirmation, shipping, refunds)', s.buyerWhatsapp, waOff),
        waOff ? upgradeNote('WhatsApp alerts are part of Pro.', 'whatsappNotifications') : null)),
    field('lowStockThreshold', 'Low stock means … or fewer left', { type: 'number', value: String(s.lowStockThreshold) }),
    el('button', { class: 'btn', type: 'submit', text: 'Save preferences' }));
  prefs.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const c = (id) => prefs.querySelector('#' + id).checked;
    const body = { ownerEmail: { newOrder: c('e_newOrder'), paymentFailed: c('e_paymentFailed'), refund: c('e_refund'), lowStock: c('e_lowStock'), issues: c('e_issues'), plan: c('e_plan'), dailySummary: c('e_dailySummary') }, buyerEmail: c('b_email'), lowStockThreshold: parseInt(val(prefs, 'lowStockThreshold'), 10) };
    if (!waOff) { body.ownerWhatsapp = { newOrder: c('w_newOrder'), lowStock: c('w_lowStock') }; body.buyerWhatsapp = c('b_whatsapp'); }
    try { await API(base() + '/notifications/settings', { method: 'PUT', body }); toast('Preferences saved'); } catch (e) { showErrors(prefs, e); }
  });
  out.push(prefs);

  // --- channels + test ---
  const test = async (channel, btn) => { btn.disabled = true; try { const r = await API(base() + '/notifications/test', { method: 'POST', body: { channel } }); const st = r.message && r.message.status; toast(st === 'sent' ? 'Test sent ✓' : st === 'skipped' ? `Not sent: ${r.message.lastError}` : st === 'failed' ? `Failed: ${r.message.lastError}` : 'Test queued'); loadLog(); } catch (e) { toast(e.message); } finally { btn.disabled = false; } };
  out.push(el('div', { class: 'card' }, el('h2', { text: 'Delivery channels' }),
    el('div', { class: 'row-item' }, el('span', { class: 'status-dot ' + (cfg.channels.email ? 'on' : 'warn') }), el('div', { class: 'grow' }, el('b', { text: 'Email' }), el('div', { class: 'muted small', text: cfg.channels.email ? 'Ready' : 'Email sending (SMTP) is not configured on this server yet.' })),
      el('button', { class: 'btn-ghost', type: 'button', text: 'Send test email', onclick: (e) => test('email', e.target) })),
    el('div', { class: 'row-item' }, el('span', { class: 'status-dot ' + (cfg.channels.whatsapp ? 'on' : 'warn') }), el('div', { class: 'grow' }, el('b', { text: 'WhatsApp' }), el('div', { class: 'muted small', text: cfg.channels.whatsapp ? 'Ready' : 'WhatsApp is not configured on this server yet.' })),
      el('button', { class: 'btn-ghost', type: 'button', text: 'Send test WhatsApp', ...(waOff ? { disabled: '' } : {}), onclick: (e) => test('whatsapp', e.target) }))));

  // --- delivery log ---
  const log = el('div', { class: 'card' }, el('h2', { text: 'Message log' }), el('p', { class: 'muted small', text: 'Loading…' }));
  async function loadLog() {
    try {
      const r = await API(base() + '/notifications/messages?limit=40');
      const sum = {}; r.last30Days.forEach((x) => { sum[x.status] = (sum[x.status] || 0) + x.count; });
      log.replaceChildren(el('h2', { text: 'Message log' }), el('p', { class: 'muted small', text: `Last 30 days: ${['sent', 'delivered', 'read', 'failed', 'skipped'].map((k) => `${sum[k] || 0} ${k}`).join(' · ')}` }),
        ...(r.messages.length ? r.messages.map((m) => el('div', { class: 'row-item' }, el('span', { text: m.channel === 'email' ? '📧' : '💬' }),
          el('div', { class: 'grow' }, el('b', { class: 'small', text: m.kind.replace(/_/g, ' ') }), el('div', { class: 'muted small', text: `${m.audience === 'buyer' ? 'Customer' : 'You'} · ${m.to} · ${ago(m.createdAt)}` }), m.lastError && m.status !== 'sent' ? el('div', { class: 'small err', text: m.lastError }) : null),
          el('span', { class: 'msg-st ' + m.status, text: m.status }))) : [el('p', { class: 'muted small', text: 'No messages yet.' })]));
    } catch (e) { log.replaceChildren(el('p', { class: 'err', text: e.message })); }
  }
  loadLog(); out.push(log);
  return out;
}
