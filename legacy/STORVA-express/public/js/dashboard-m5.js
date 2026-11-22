'use strict';
// Dashboard views for Module 5: orders and coupons. Loaded BEFORE dashboard.js and called by its router.
// It uses helpers declared in dashboard.js (el, API, base, toast, field, select, val, showErrors, badge, inr, render);
// they are only touched when a view is opened, after dashboard.js has run. Text always goes through textContent (no HTML strings).
const NEXT_STATUS = { pending: [['confirmed', 'Confirm order'], ['cancelled', 'Cancel order']], confirmed: [['shipped', 'Mark shipped'], ['cancelled', 'Cancel order']], shipped: [['delivered', 'Mark delivered']], delivered: [], cancelled: [] };
const ONLINE_NOTE = { pending: 'Waiting for the customer to complete payment. Do not ship until it shows paid.', paid: 'Paid online. Confirmed by Razorpay.', failed: 'The customer\u2019s payment failed. They can try again from their order page.', refunded: 'This payment was refunded.' };
const when = (d) => new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
const statusBadge = (s) => el('span', { class: 'badge st-' + s, text: s });
// Payment badge (Module 6): method + money state, e.g. "COD · unpaid", "Online · paid", "Online · failed".
const payBadge = (o) => el('span', { class: 'badge pay-' + o.paymentStatus, text: (o.paymentMethod === 'razorpay' ? 'Online' : 'COD') + ' · ' + o.paymentStatus });

async function ordersView(param) {
  if (param) return orderDetail(param);
  const state = { q: '', status: '', page: 1 };
  const list = el('div', { class: 'card' }), bar = el('div', { class: 'filters' });
  const q = el('input', { type: 'search', placeholder: 'Search order #, name or phone', 'aria-label': 'Search orders' });
  const st = select('oStatus', null, [['', 'All statuses'], ['pending', 'Pending'], ['confirmed', 'Confirmed'], ['shipped', 'Shipped'], ['delivered', 'Delivered'], ['cancelled', 'Cancelled']]);
  bar.append(q, st);
  async function refresh() {
    const r = await API(base() + '/orders?' + new URLSearchParams({ q: state.q, status: state.status, page: state.page, limit: 10 }));
    const rows = r.orders.map((o) => el('a', { class: 'row-item order-row', href: '#orders/' + o.orderNumber },
      el('div', { class: 'grow' }, el('b', { text: `#${o.orderNumber} · ${o.customer.name}` }), el('div', { class: 'muted small', text: `${when(o.createdAt)} · ${o.items.reduce((n, i) => n + i.qty, 0)} item(s) · ${o.customer.phone}` })),
      el('b', { text: inr(o.total) }), statusBadge(o.status), payBadge(o)));
    list.replaceChildren(el('div', { class: 'muted small', text: `${r.total} order${r.total === 1 ? '' : 's'}` }),
      ...(rows.length ? rows : [el('p', { class: 'muted', text: state.q || state.status ? 'No orders match these filters.' : 'No orders yet. Orders placed on your storefront show up here.' })]),
      el('div', { class: 'pager' }, el('button', { class: 'link', type: 'button', text: '← Prev', disabled: r.page <= 1 ? '' : null, onclick: () => { state.page--; refresh(); } }), el('span', { class: 'muted small', text: `Page ${r.page} of ${r.pages}` }), el('button', { class: 'link', type: 'button', text: 'Next →', disabled: r.page >= r.pages ? '' : null, onclick: () => { state.page++; refresh(); } })));
  }
  let t; q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { state.q = q.value.trim(); state.page = 1; refresh(); }, 300); });
  st.querySelector('select').addEventListener('change', (e) => { state.status = e.target.value; state.page = 1; refresh(); });
  await refresh();
  return [el('div', { class: 'head' }, el('h1', { text: 'Orders' }), el('a', { class: 'btn-link', href: '/store/' + S.store.slug, target: '_blank', rel: 'noopener', text: 'View storefront ↗' })), bar, list];
}

async function orderDetail(number) {
  const { order: o } = await API(`${base()}/orders/${encodeURIComponent(number)}`);
  async function patch(body, okMsg, form) { try { await API(`${base()}/orders/${o.orderNumber}`, { method: 'PATCH', body }); toast(okMsg); render(); } catch (e) { if (form && e.fields) showErrors(form, { ...e, fields: Object.fromEntries(Object.entries(e.fields).map(([k, v]) => [k.replace('shipment.', 'sh_'), v])) }); else toast(e.message); } }
  // Module 12: courier + tracking. Filled in before "Mark shipped" it is sent with the status change, so the buyer's message includes it.
  const sh = o.shipment || {};
  const ship = el('form', { class: 'card' }, el('h2', { text: 'Shipping & tracking' }),
    el('div', { class: 'grid3' }, field('sh_carrier', 'Courier', { value: sh.carrier || '', ph: 'DTDC, India Post, Delhivery…' }), field('sh_trackingNumber', 'Tracking number', { value: sh.trackingNumber || '' }), field('sh_trackingUrl', 'Tracking link (optional)', { type: 'url', value: sh.trackingUrl || '', ph: 'https://' })),
    o.status === 'shipped' || o.status === 'delivered' ? el('button', { class: 'btn-ghost', style: 'margin-top:12px', type: 'submit', text: 'Save tracking' }) : el('p', { class: 'muted small', text: 'Fill this in, then press "Mark shipped" — the customer gets the tracking details automatically.' }));
  const shipBody = () => ({ carrier: val(ship, 'sh_carrier'), trackingNumber: val(ship, 'sh_trackingNumber'), trackingUrl: val(ship, 'sh_trackingUrl') });
  ship.addEventListener('submit', (ev) => { ev.preventDefault(); patch({ shipment: shipBody() }, 'Tracking saved', ship); });
  const noteForm = el('form', { class: 'card' }, el('h2', { text: 'Private note' }), field('ownerNote', 'Only you can see this', { value: o.ownerNote || '', area: true, ph: 'e.g. Gift wrap, call before delivery' }), el('button', { class: 'btn-ghost', style: 'margin-top:12px', type: 'submit', text: 'Save note' }));
  noteForm.addEventListener('submit', (ev) => { ev.preventDefault(); patch({ ownerNote: val(noteForm, 'ownerNote') }, 'Note saved', noteForm); });
  const actions = el('div', { class: 'row', style: 'flex-wrap:wrap' },
    ...NEXT_STATUS[o.status].map(([to, label]) => el('button', { class: 'btn' + (to === 'cancelled' ? ' danger' : ''), type: 'button', style: 'width:auto;margin-top:8px;padding:10px 16px', text: label,
      onclick: () => { if (to === 'cancelled' && !confirm('Cancel this order? Stock and the coupon use are returned.')) return; patch(to === 'shipped' ? { status: to, shipment: shipBody() } : { status: to }, 'Order ' + to, to === 'shipped' ? ship : null); } })),
    // Cash is confirmed by the owner. Online payments are confirmed only by the payment gateway, so there is no button for them.
    o.status !== 'cancelled' && o.paymentMethod === 'cod' ? el('button', { class: 'btn', type: 'button', style: 'width:auto;margin-top:8px;padding:10px 16px;background:#166534', text: o.paymentStatus === 'paid' ? 'Mark unpaid' : 'Mark paid (cash received)', onclick: () => patch({ paymentStatus: o.paymentStatus === 'paid' ? 'unpaid' : 'paid' }, 'Updated') }) : null,
    o.paymentMethod === 'razorpay' ? el('p', { class: 'muted small', style: 'width:100%;margin:8px 0 0' }, (ONLINE_NOTE[o.paymentStatus] || '') + ' ', el('a', { class: 'link', href: '#payments/' + o.orderNumber, text: 'Payment & refunds →' })) : null);
  const a = o.shippingAddress;
  return [
    el('div', { class: 'head' }, el('a', { class: 'link', href: '#orders', text: '← Orders' }), el('h1', { text: `Order #${o.orderNumber}` })),
    el('div', { class: 'card' }, el('div', { class: 'row' }, statusBadge(o.status), payBadge(o), el('span', { class: 'muted small', text: when(o.createdAt) }), o.paidAt ? el('span', { class: 'muted small', text: 'Paid ' + when(o.paidAt) }) : null), actions),
    el('div', { class: 'card' }, el('h2', { text: 'Customer' }), el('div', { text: o.customer.name }),
      el('div', {}, el('a', { href: 'tel:+' + o.customer.phone, text: '+' + o.customer.phone }), ' · ', el('a', { href: 'https://wa.me/' + o.customer.phone, target: '_blank', rel: 'noopener', text: 'WhatsApp' })),
      o.customer.email ? el('div', { class: 'muted', text: o.customer.email }) : null,
      el('p', { text: `${a.line1}${a.line2 ? ', ' + a.line2 : ''}, ${a.city}, ${a.state} – ${a.pincode}` }), o.note ? el('p', { class: 'muted', text: 'Note: ' + o.note }) : null),
    el('div', { class: 'card' }, el('h2', { text: 'Items' }),
      ...o.items.map((i) => el('div', { class: 'row-item' }, el('div', { class: 'thumb' }, i.image ? el('img', { src: i.image, alt: '' }) : null), el('div', { class: 'grow' }, el('b', { text: i.title }), el('div', { class: 'muted small', text: `${i.variantLabel ? i.variantLabel + ' · ' : ''}${inr(i.unitPrice)} × ${i.qty}` })), el('b', { text: inr(i.lineTotal) }))),
      el('div', { class: 'tot-box' }, el('div', { text: 'Subtotal: ' + inr(o.subtotal) }), o.discount > 0 ? el('div', { text: `Discount${o.couponCode ? ' (' + o.couponCode + ')' : ''}: −${inr(o.discount)}` }) : null, el('div', { text: 'Shipping: ' + (o.shipping > 0 ? inr(o.shipping) : 'Free') + (o.shippingZone ? ` (${o.shippingZone})` : '') }), o.codFee > 0 ? el('div', { text: 'COD fee: ' + inr(o.codFee) }) : null,
        o.tax > 0 && !o.taxInclusive ? el('div', { text: 'GST: ' + inr(o.tax) }) : null, el('b', { text: 'Total: ' + inr(o.total) }),
        o.tax > 0 ? el('div', { class: 'muted small', text: `${o.taxInclusive ? 'Includes ' : ''}GST ${inr(o.tax)} · ${o.taxBreakdown.igst ? 'IGST ' + inr(o.taxBreakdown.igst) : `CGST ${inr(o.taxBreakdown.cgst)} + SGST ${inr(o.taxBreakdown.sgst)}`}` }) : null,
        o.buyerGstin ? el('div', { class: 'muted small', text: 'Buyer GSTIN: ' + o.buyerGstin }) : null)),
    el('div', { class: 'card' }, el('h2', { text: 'Invoice' }),
      o.invoiceNumber ? el('div', { class: 'row', style: 'flex-wrap:wrap' }, el('b', { class: 'grow', text: o.invoiceNumber }), el('a', { class: 'btn-link', href: `/api${base()}/orders/${o.orderNumber}/invoice`, target: '_blank', rel: 'noopener', text: 'Open / print invoice' }))
        : o.status === 'pending' || o.status === 'cancelled' ? el('p', { class: 'muted small', text: o.status === 'pending' ? 'The invoice is created when you ship the order (or confirm it and create it here).' : 'No invoice for this cancelled order.' })
          : el('button', { class: 'btn-ghost', type: 'button', text: 'Create invoice now', onclick: async () => { try { await API(`${base()}/orders/${o.orderNumber}/invoice`, { method: 'POST' }); toast('Invoice created'); render(); } catch (e) { toast(e.message); } } })),
    o.status !== 'cancelled' && o.status !== 'pending' ? ship : null, noteForm,
    el('div', { class: 'card' }, el('h2', { text: 'History' }), ...o.statusHistory.map((h) => el('div', { class: 'muted small', text: `${when(h.at)} · ${h.status}` }))),
  ];
}

async function couponsView() {
  const wrap = el('div'), box = el('div', { class: 'card' });
  const { coupons } = await API(base() + '/coupons');
  const state = (c) => (!c.active ? 'inactive' : c.expiresAt && new Date(c.expiresAt) <= new Date() ? 'expired' : c.usageLimit != null && c.usedCount >= c.usageLimit ? 'used up' : 'active');
  box.append(el('div', { class: 'muted small', text: `${coupons.length} coupon${coupons.length === 1 ? '' : 's'}` }));
  if (!coupons.length) box.append(el('p', { class: 'muted', text: 'No coupons yet. Create one below, for example WELCOME10 for 10% off.' }));
  coupons.forEach((c) => box.append(el('div', { class: 'row-item' },
    el('div', { class: 'grow' }, el('b', { text: c.code }), el('div', { class: 'muted small', text: `${c.type === 'percent' ? c.value + '% off' : inr(c.value) + ' off'}${c.minOrder ? ' · min ' + inr(c.minOrder) : ''}${c.maxDiscount ? ' · max ' + inr(c.maxDiscount) : ''} · used ${c.usedCount}${c.usageLimit != null ? '/' + c.usageLimit : ''}${c.expiresAt ? ' · expires ' + new Date(c.expiresAt).toLocaleDateString('en-IN') : ''}` })),
    el('span', { class: 'badge ' + (state(c) === 'active' ? 'active' : 'archived'), text: state(c) }),
    el('button', { class: 'link', type: 'button', text: c.active ? 'Disable' : 'Enable', onclick: async () => { try { await API(`${base()}/coupons/${c.id}`, { method: 'PATCH', body: { active: !c.active } }); render(); } catch (e) { toast(e.message); } } }),
    el('button', { class: 'link danger-t', type: 'button', text: 'Delete', onclick: async () => { if (!confirm(`Delete coupon ${c.code}?`)) return; try { await API(`${base()}/coupons/${c.id}`, { method: 'DELETE' }); render(); } catch (e) { toast(e.message); } } }))));
  const form = el('form', { class: 'card' }, el('h2', { text: 'New coupon' }),
    field('code', 'Code', { ph: 'WELCOME10', hint: 'Letters, numbers, - or _ (3 to 20). Customers type this at checkout.' }),
    el('div', { class: 'two' }, select('type', 'Discount type', [['percent', 'Percent off'], ['fixed', 'Fixed amount off (₹)']]), field('value', 'Value', { type: 'number', ph: '10' })),
    el('div', { class: 'two' }, field('minOrder', 'Minimum order (₹, optional)', { type: 'number' }), field('maxDiscount', 'Maximum discount (₹, percent coupons, optional)', { type: 'number' })),
    el('div', { class: 'two' }, field('usageLimit', 'Total uses (optional)', { type: 'number' }), field('expiresAt', 'Expires on (optional)', { type: 'date' })),
    field('startsAt', 'Starts on (optional)', { type: 'date' }),
    el('button', { class: 'btn', type: 'submit', text: 'Create coupon' }));
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const d = (id, end) => { const v = val(form, id); return v ? new Date(v + (end ? 'T23:59:59' : 'T00:00:00')).toISOString() : null; };
    const body = { code: val(form, 'code'), type: form.querySelector('#type').value, value: val(form, 'value'), minOrder: val(form, 'minOrder') || null, maxDiscount: val(form, 'maxDiscount') || null, usageLimit: val(form, 'usageLimit') || null, startsAt: d('startsAt', false), expiresAt: d('expiresAt', true) };
    try { await API(base() + '/coupons', { method: 'POST', body }); toast('Coupon created'); render(); } catch (e) { showErrors(form, e); }
  });
  wrap.append(el('h1', { text: 'Coupons' }), box, form);
  return [wrap];
}
