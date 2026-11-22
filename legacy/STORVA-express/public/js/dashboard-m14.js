'use strict';
// Module 14: Home (today at a glance + what needs attention) and Analytics (sales, visitors, products, customers, funnel,
// traffic sources, states, busy hours, GST summary, CSV exports). Loaded before dashboard.js. All text via textContent;
// charts are inline SVG built with createElementNS (no external chart library, works under the dashboard CSP).
const SVGNS = 'http://www.w3.org/2000/svg';
function svg(tag, attrs = {}, ...kids) { const n = document.createElementNS(SVGNS, tag); for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, v); kids.flat().forEach((c) => c && n.append(c)); return n; }
const short = (n) => (n >= 1e7 ? (n / 1e7).toFixed(1) + 'Cr' : n >= 1e5 ? (n / 1e5).toFixed(1) + 'L' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(Math.round(n)));
const dayLabel = (d) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });

// Bars = net sales, line = orders. Hover/tap a bar for the exact numbers (native <title> tooltip, accessible).
function salesChart(daily) {
  const W = 760, Hh = 220, P = { l: 44, r: 36, t: 12, b: 26 }, n = daily.length, iw = W - P.l - P.r, ih = Hh - P.t - P.b;
  const maxS = Math.max(1, ...daily.map((d) => d.netSales)), maxO = Math.max(1, ...daily.map((d) => d.orders)), bw = iw / n;
  const g = svg('svg', { viewBox: `0 0 ${W} ${Hh}`, class: 'chart', role: 'img', 'aria-label': 'Daily sales and orders' });
  for (let i = 0; i <= 4; i++) { const y = P.t + ih - (ih * i) / 4; g.append(svg('line', { x1: P.l, x2: W - P.r, y1: y, y2: y, class: 'grid' }), svg('text', { x: P.l - 6, y: y + 4, 'text-anchor': 'end', class: 'ax' }, document.createTextNode('₹' + short((maxS * i) / 4)))); }
  daily.forEach((d, i) => {
    const h = (d.netSales / maxS) * ih, x = P.l + i * bw;
    g.append(svg('rect', { x: x + bw * 0.15, y: P.t + ih - h, width: Math.max(1, bw * 0.7), height: Math.max(h, d.netSales ? 1 : 0), rx: Math.min(4, bw / 4), class: 'bar' }, svg('title', {}, document.createTextNode(`${dayLabel(d.day)}: ${inr(d.netSales)} · ${d.orders} order${d.orders === 1 ? '' : 's'} · ${d.visitors} visitor${d.visitors === 1 ? '' : 's'}`))));
    if (n <= 14 || i % Math.ceil(n / 10) === 0) g.append(svg('text', { x: x + bw / 2, y: Hh - 8, 'text-anchor': 'middle', class: 'ax' }, document.createTextNode(dayLabel(d.day))));
  });
  const pts = daily.map((d, i) => `${P.l + i * bw + bw / 2},${P.t + ih - (d.orders / maxO) * ih}`).join(' ');
  g.append(svg('polyline', { points: pts, class: 'line' }), svg('text', { x: W - P.r + 4, y: P.t + 8, class: 'ax' }, document.createTextNode(maxO + ' ord')));
  return el('div', {}, g, el('div', { class: 'legend' }, el('span', { class: 'lg-bar', text: 'Net sales' }), el('span', { class: 'lg-line', text: 'Orders' })));
}
const hbar = (rows, valueKey, labelFn, fmt) => { const max = Math.max(1, ...rows.map((r) => r[valueKey])); return el('div', { class: 'hbars' }, rows.map((r) => el('div', { class: 'hb' }, el('span', { class: 'hb-l', text: labelFn(r) }), el('span', { class: 'hb-t' }, el('span', { class: 'hb-f', style: `width:${Math.round((r[valueKey] / max) * 100)}%` })), el('b', { class: 'hb-v', text: fmt(r) })))); };
function delta(v, invert) { if (v == null) return el('span', { class: 'delta up', text: 'new' }); if (!v) return el('span', { class: 'delta', text: '0%' }); const good = invert ? v < 0 : v > 0; return el('span', { class: 'delta ' + (good ? 'up' : 'down'), text: (v > 0 ? '▲ ' : '▼ ') + Math.abs(v) + '%' }); }
const kpi = (label, value, ch, sub) => el('div', { class: 'kpi' }, el('div', { class: 'muted small', text: label }), el('div', { class: 'kpi-v', text: value }), el('div', { class: 'small' }, ch === undefined ? null : delta(ch), sub ? el('span', { class: 'muted', text: ' ' + sub }) : null));

async function download(path, filename) {
  const res = await fetch('/api' + path, { credentials: 'same-origin' });
  if (!res.ok) { let m = 'Download failed.'; try { const j = await res.json(); m = (j.error && j.error.message) || m; } catch { /* not JSON */ } toast(m); return; }
  const url = URL.createObjectURL(await res.blob()); const a = el('a', { href: url, download: filename }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// ---------------- Home ----------------
async function homeView() {
  const [today, pending, confirmed, products, ship] = await Promise.all([
    API(base() + '/analytics?days=7').catch(() => null),
    API(base() + '/orders?status=pending&limit=5'), API(base() + '/orders?status=confirmed&limit=5'), API(base() + '/products?status=active&limit=100').catch(() => ({ products: [] })),
    API(base() + '/shipping').catch(() => null),
  ]);
  const t = today && today.daily.length ? today.daily[today.daily.length - 1] : { orders: 0, netSales: 0, visitors: 0 };
  const low = (products.products || []).filter((p) => p.trackInventory && p.totalStock <= 3).sort((a, b) => a.totalStock - b.totalStock).slice(0, 6);
  const hour = Number(new Date().toLocaleString('en-IN', { hour: 'numeric', hour12: false, timeZone: 'Asia/Kolkata' }));
  const hello = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const todo = [];
  if (pending.total) todo.push(el('a', { class: 'todo', href: '#orders' }, el('b', { text: pending.total }), ` new order${pending.total === 1 ? '' : 's'} to confirm`));
  if (confirmed.total) todo.push(el('a', { class: 'todo', href: '#orders' }, el('b', { text: confirmed.total }), ` order${confirmed.total === 1 ? '' : 's'} to pack and ship`));
  low.forEach((p) => todo.push(el('a', { class: 'todo warn', href: '#products' }, el('b', { text: p.totalStock ? p.totalStock + ' left' : 'Out of stock' }), ' · ' + p.title)));
  const setup = [
    [(products.products || []).length > 0, 'Add your first product', '#products'], [S.store.whatsappNumber, 'Add your WhatsApp number', '#settings'],
    [S.store.logoUrl || S.store.logo, 'Upload a logo in Designer', '#designer'], [ship && (ship.shipping.mode !== 'free' || ship.tax.enabled), 'Set delivery charges, COD and GST', '#shipping'], [false, 'Share your store link or QR code', '#whatsapp'],
  ].filter(([done]) => !done).slice(0, 3);
  const w = today ? today.summary : null;
  return [
    el('div', { class: 'head' }, el('h1', { text: `${hello}, ${(ME && ME.name || '').split(' ')[0] || 'there'} 👋` })),
    el('div', { class: 'kpis' }, kpi('Sales today', inr(t.netSales)), kpi('Orders today', String(t.orders)), kpi('Visitors today', String(t.visitors)),
      w ? kpi('Last 7 days', inr(w.netSales), today.change.netSales, 'vs previous 7') : null),
    el('div', { class: 'card' }, el('h2', { text: 'Needs your attention' }), todo.length ? el('div', { class: 'todos' }, todo) : el('p', { class: 'muted', text: 'All caught up. 🎉 New orders and low stock show up here.' })),
    today ? el('div', { class: 'card' }, el('div', { class: 'row' }, el('h2', { class: 'grow', text: 'Last 7 days' }), el('a', { href: '#analytics', text: 'Full analytics →' })), salesChart(today.daily)) : null,
    setup.length ? el('div', { class: 'card' }, el('h2', { text: 'Get more sales' }), el('ul', { class: 'checklist' }, setup.map(([, label, href]) => el('li', {}, el('a', { href, text: label + ' →' }))))) : null,
  ];
}

// ---------------- Analytics ----------------
const AN = { days: 30, from: '', to: '' };
async function analyticsView() {
  root.classList.add('wide'); root.style.maxWidth = '1040px';
  const q = AN.from && AN.to ? `from=${AN.from}&to=${AN.to}` : `days=${AN.days}`;
  let d;
  try { d = await API(`${base()}/analytics?${q}`); }
  catch (e) { if (e.code === 'upgrade_required') { AN.from = AN.to = ''; AN.days = 30; toast(e.message); d = await API(`${base()}/analytics?days=30`); } else throw e; }
  const s = d.summary, locked = (k) => d.locked.includes(k);
  const presets = el('div', { class: 'seg' }, [7, 30, 90, 365].map((n) => el('button', { type: 'button', class: !AN.from && AN.days === n ? 'on' : '', text: n === 365 ? '1 year' : n + ' days', onclick: () => { AN.days = n; AN.from = AN.to = ''; render(); } })));
  const from = el('input', { type: 'date', value: d.range.from, 'aria-label': 'From' }), to = el('input', { type: 'date', value: d.range.to, 'aria-label': 'To' });
  const custom = el('div', { class: 'an-custom' }, from, el('span', { text: '–' }), to, el('button', { class: 'btn-ghost', type: 'button', text: 'Apply', onclick: () => { AN.from = from.value; AN.to = to.value; render(); } }));
  const rangeQ = `from=${d.range.from}&to=${d.range.to}`;
  const exportsCard = el('div', { class: 'card' }, el('h2', { text: 'Download reports (CSV, opens in Excel / Google Sheets)' }), el('div', { class: 'row', style: 'flex-wrap:wrap' },
    el('button', { class: 'btn-ghost', type: 'button', text: '⬇ Orders', onclick: () => download(`${base()}/analytics/export/orders.csv?${rangeQ}`, `orders-${d.range.from}-to-${d.range.to}.csv`) }),
    el('button', { class: 'btn-ghost', type: 'button', text: '⬇ Product sales', onclick: () => download(`${base()}/analytics/export/products.csv?${rangeQ}`, `products-${d.range.from}-to-${d.range.to}.csv`) }),
    el('button', { class: 'btn-ghost', type: 'button', text: '⬇ Customers', onclick: () => download(`${base()}/customers/export.csv`, 'customers.csv') })));
  const out = [
    el('div', { class: 'head' }, el('h1', { text: 'Analytics' }), el('span', { class: 'muted small', text: `${dayLabel(d.range.from)} – ${dayLabel(d.range.to)} · compared with the ${d.range.days} days before` })),
    el('div', { class: 'an-range' }, presets, locked('basic') ? null : custom),
    el('div', { class: 'kpis' }, kpi('Net sales', inr(s.netSales), d.change.netSales), kpi('Orders', String(s.orders), d.change.orders), kpi('Average order', inr(s.averageOrder), d.change.averageOrder),
      kpi('Visitors', String(s.visitors), d.change.visitors), kpi('Conversion', s.conversionRate + '%', undefined, 'of visitors ordered')),
    el('div', { class: 'card' }, el('h2', { text: 'Sales by day' }), salesChart(d.daily),
      el('p', { class: 'muted small', text: `Gross ${inr(s.grossSales)} − refunds ${inr(s.refunds)} = net ${inr(s.netSales)} · ${s.itemsSold} items · discounts ${inr(s.discounts)} · delivery & COD fees ${inr(s.shippingCollected)}${s.gst ? ' · GST ' + inr(s.gst) : ''}. Cancelled and unpaid online orders are not counted.` })),
  ];
  if (locked('basic')) { out.push(upgradeNote('Top products, payment split, new vs returning customers, custom date ranges and CSV downloads are on the Pro plan.', 'analytics:basic')); return out; }
  out.push(
    el('div', { class: 'grid2' },
      el('div', { class: 'card' }, el('h2', { text: '🏆 Top products' }), d.topProducts.length ? hbar(d.topProducts, 'revenue', (r) => r.title, (r) => `${inr(r.revenue)} · ${r.units} sold`) : el('p', { class: 'muted', text: 'No sales in this period yet.' })),
      el('div', { class: 'card' }, el('h2', { text: '💳 Payments' }), hbar(d.payments.map((p) => ({ ...p, label: p.method === 'cod' ? 'Cash on delivery' : 'Online (UPI / cards)' })), 'orders', (r) => r.label, (r) => `${r.orders} · ${r.share}% · ${inr(r.sales)}`),
        el('h3', { text: 'Customers' }), el('p', { text: `${d.customers.new.customers} new (${inr(d.customers.new.sales)}) · ${d.customers.returning.customers} returning (${inr(d.customers.returning.sales)})` }), el('p', { class: 'muted small', text: `${d.customers.repeatRate}% of buyers in this period had ordered before.` }))),
    el('div', { class: 'grid2' },
      el('div', { class: 'card' }, el('h2', { text: '📅 Best days' }), hbar(d.weekdays, 'orders', (r) => r.day, (r) => `${r.orders} · ${inr(r.sales)}`)),
      el('div', { class: 'card' }, el('h2', { text: '🏷️ Coupons & order status' }), d.coupons.length ? hbar(d.coupons, 'uses', (r) => r.code, (r) => `${r.uses} uses · −${inr(r.discount)}`) : el('p', { class: 'muted small', text: 'No coupons used in this period.' }),
        el('p', { class: 'small', text: Object.entries(d.statuses).map(([k, v]) => `${k}: ${v}`).join(' · ') || 'No orders.' }))),
    exportsCard);
  if (locked('advanced')) { out.push(upgradeNote('Conversion funnel, traffic sources, sales by state, busy hours, product conversion and the GST filing summary are on the Advanced plan.', 'analytics:advanced')); return out; }
  const heat = el('div', { class: 'heat', role: 'table', 'aria-label': 'Orders by weekday and hour' }); const hmax = Math.max(1, ...d.hours.flat());
  ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].forEach((dn, i) => heat.append(el('div', { class: 'heat-row', role: 'row' }, el('span', { class: 'heat-l', text: dn }), d.hours[i].map((n, h) => el('span', { class: 'heat-c', role: 'cell', title: `${dn} ${h}:00 – ${n} order${n === 1 ? '' : 's'}`, style: `opacity:${n ? 0.15 + 0.85 * (n / hmax) : 0.06}` })))));
  const SRC = { direct: 'Direct / typed', whatsapp: 'WhatsApp', instagram: 'Instagram', facebook: 'Facebook', google: 'Google', youtube: 'YouTube', x: 'X (Twitter)', qr: 'QR code', other: 'Other websites' };
  out.push(
    el('div', { class: 'card' }, el('h2', { text: '🧭 Conversion funnel' }), el('div', { class: 'funnel' }, d.funnel.map((f, i) => el('div', { class: 'fn' }, el('span', { class: 'fn-bar', style: `width:${Math.max(2, f.ofVisitors)}%` }), el('span', { class: 'fn-l', text: f.step }), el('b', { text: String(f.count) }), el('span', { class: 'muted small', text: i && d.funnel[i - 1].count ? ` ${f.ofPrevious}% of previous step` : '' })))),
      el('p', { class: 'muted small', text: 'Visitors are counted without cookies and without storing anyone\'s details. Link previews and bots are ignored.' })),
    el('div', { class: 'grid2' },
      el('div', { class: 'card' }, el('h2', { text: '📣 Where visitors come from' }), d.sources.length ? hbar(d.sources, 'visitors', (r) => SRC[r.source] || r.source, (r) => `${r.visitors} · ${r.share}%`) : el('p', { class: 'muted small', text: 'No visits recorded yet. Share links from the WhatsApp tab are tagged automatically.' })),
      el('div', { class: 'card' }, el('h2', { text: '📍 Sales by state' }), d.states.length ? hbar(d.states, 'sales', (r) => r.state, (r) => `${inr(r.sales)} · ${r.orders}`) : el('p', { class: 'muted small', text: 'No sales in this period.' }))),
    el('div', { class: 'card' }, el('h2', { text: '⏰ When people order (India time)' }), heat, el('div', { class: 'heat-ax muted small' }, el('span', { text: '12 am' }), el('span', { text: '6 am' }), el('span', { text: '12 pm' }), el('span', { text: '6 pm' }), el('span', { text: '11 pm' }))),
    el('div', { class: 'card' }, el('h2', { text: '👀 Most viewed products' }), d.productConversion.length ? el('table', { class: 'tbl' }, el('thead', {}, el('tr', {}, ['Product', 'Views', 'Orders', 'Conversion'].map((h) => el('th', { text: h })))), el('tbody', {}, d.productConversion.map((p) => el('tr', {}, el('td', { text: p.title }), el('td', { text: String(p.views) }), el('td', { text: String(p.orders) }), el('td', { text: p.conversion + '%' }))))) : el('p', { class: 'muted small', text: 'No product views yet.' })));
  const gstCard = el('div', { class: 'card' }, el('h2', { text: '🧾 GST summary (for filing)' }), el('p', { class: 'muted small', text: 'Loading…' }));
  out.push(gstCard);
  API(`${base()}/analytics/gst?${rangeQ}`).then((g) => {
    const tot = (rows, k) => rows.reduce((a, r) => a + r[k], 0);
    gstCard.replaceChildren(el('h2', { text: '🧾 GST summary (for filing)' }),
      el('p', { class: 'small', text: `Invoices by invoice date: ${g.documents.issued} issued${g.documents.cancelled ? `, ${g.documents.cancelled} cancelled` : ''}${g.documents.first ? ` (${g.documents.first} to ${g.documents.last})` : ''}.` }),
      el('div', { class: 'kpis' }, kpi('Taxable value', inr(Math.round((tot(g.hsn, 'taxable')) * 100) / 100)), kpi('CGST', inr(Math.round(tot(g.hsn, 'cgst') * 100) / 100)), kpi('SGST', inr(Math.round(tot(g.hsn, 'sgst') * 100) / 100)), kpi('IGST', inr(Math.round(tot(g.hsn, 'igst') * 100) / 100))),
      el('p', { class: 'muted small', text: `${g.b2b.length} business (B2B) invoice line${g.b2b.length === 1 ? '' : 's'} · ${g.b2c.length} consumer (B2C) state/rate group${g.b2c.length === 1 ? '' : 's'} · ${g.hsn.length} HSN line${g.hsn.length === 1 ? '' : 's'}. Share these with your accountant or use them for GSTR-1.` }),
      el('div', { class: 'row', style: 'flex-wrap:wrap' }, ['b2b', 'b2c', 'hsn'].map((p) => el('button', { class: 'btn-ghost', type: 'button', text: `⬇ ${p.toUpperCase()} CSV`, onclick: () => download(`${base()}/analytics/gst/${p}.csv?${rangeQ}`, `gst-${p}-${d.range.from}-to-${d.range.to}.csv`) }))));
  }).catch((e) => gstCard.replaceChildren(el('h2', { text: '🧾 GST summary' }), el('p', { class: 'err', text: e.message })));
  return out;
}
