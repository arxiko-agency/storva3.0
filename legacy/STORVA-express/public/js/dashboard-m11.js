'use strict';
// Module 11: Customers tab – list with search, segments and sorting, CSV export (Pro), and a customer page with orders,
// private notes, tags, "block cash on delivery" and personal-data erasure. Loaded before dashboard.js. All text via textContent.
const SEGMENTS = [['', 'All'], ['new', 'New'], ['repeat', 'Repeat'], ['vip', 'VIP'], ['inactive', 'Inactive 90d+'], ['blocked', 'COD blocked']];
const SEG_LABEL = { new: 'New', repeat: 'Repeat', vip: 'VIP', inactive: 'Inactive', none: '—' };
const dshort = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { dateStyle: 'medium' }) : '—');

async function customersView(param) {
  if (param) return customerPage(param);
  const st = { q: '', segment: '', sort: 'recent', tag: '', page: 1 };
  const list = el('div', { class: 'card' }), stats = el('div', { class: 'grid3' });
  const q = el('input', { type: 'search', placeholder: 'Search name, phone or email…', 'aria-label': 'Search customers' });
  const chips = el('div', { class: 'seg', role: 'group', 'aria-label': 'Customer group', style: 'flex-wrap:wrap' });
  const sort = select('cSort', '', [['recent', 'Last order'], ['spent', 'Total spent'], ['orders', 'Most orders'], ['name', 'Name A–Z']], 'recent');
  const tagSel = el('div');
  let t;
  q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { st.q = q.value; st.page = 1; refresh(); }, 300); });
  sort.querySelector('select').addEventListener('change', (e) => { st.sort = e.target.value; refresh(); });
  const drawChips = () => chips.replaceChildren(...SEGMENTS.map(([k, label]) => el('button', { type: 'button', class: st.segment === k ? 'on' : '', text: label, onclick: () => { st.segment = k; st.page = 1; drawChips(); refresh(); } })));
  const qs = () => new URLSearchParams({ q: st.q, segment: st.segment, sort: st.sort, tag: st.tag, page: st.page, limit: 20 });
  async function refresh() {
    try {
      const r = await API(base() + '/customers?' + qs());
      const box = (label, v) => el('div', { class: 'card', style: 'margin:0' }, el('div', { class: 'muted small', text: label }), el('b', { class: 'big', text: v }));
      stats.replaceChildren(box('Customers', String(r.summary.customers)), box('Come back to buy again', r.summary.repeatRate + '%'), box('Average spend per customer', inr(r.summary.averageLifetimeValue)));
      if (r.tags.length) { const s = select('cTag', '', [['', 'All tags'], ...r.tags.map((x) => [x, '#' + x])], st.tag); s.querySelector('select').addEventListener('change', (e) => { st.tag = e.target.value; st.page = 1; refresh(); }); tagSel.replaceChildren(s); }
      list.replaceChildren(...(r.customers.length ? r.customers.map((c) => el('a', { class: 'row-item', href: '#customers/' + c.id, style: 'text-decoration:none;color:inherit' },
        el('div', { class: 'grow' }, el('b', { text: c.name || '+' + c.phone }), c.codBlocked ? el('span', { class: 'badge st-cancelled', text: 'COD blocked', style: 'margin-left:6px' }) : null,
          el('div', { class: 'muted small', text: `+${c.phone}${c.addresses[0] ? ' · ' + c.addresses[0].city : ''} · last order ${dshort(c.lastOrderAt)}` }),
          c.tags.length ? el('div', { class: 'small', text: c.tags.map((x) => '#' + x).join(' ') }) : null),
        el('div', { class: 'r' }, el('b', { text: inr(c.totalSpent) }), el('div', { class: 'muted small', text: `${c.orderCount} order${c.orderCount === 1 ? '' : 's'}` })),
        el('span', { class: 'badge ' + (c.segment === 'vip' ? 'active' : 'draft'), text: SEG_LABEL[c.segment] || c.segment }))) : [el('p', { class: 'muted', text: st.q || st.segment || st.tag ? 'No customers match.' : 'Customers appear here automatically when they place an order.' })]),
      r.pages > 1 ? el('div', { class: 'row', style: 'justify-content:center;margin-top:10px' },
        el('button', { class: 'btn-ghost', type: 'button', text: '← Prev', ...(st.page <= 1 ? { disabled: '' } : {}), onclick: () => { st.page--; refresh(); } }), el('span', { class: 'muted small', text: `Page ${r.page} of ${r.pages}` }),
        el('button', { class: 'btn-ghost', type: 'button', text: 'Next →', ...(st.page >= r.pages ? { disabled: '' } : {}), onclick: () => { st.page++; refresh(); } })) : null);
    } catch (e) { list.replaceChildren(el('p', { class: 'err', text: e.message })); }
  }
  async function exportCsv() {
    const r = await fetch(`/api${base()}/customers/export.csv?${qs()}`, { credentials: 'same-origin' });
    if (!r.ok) { const j = await r.json().catch(() => ({})); toast(j.error && j.error.code === 'upgrade_required' ? 'CSV exports are part of the Pro plan.' : (j.error && j.error.message) || 'Export failed'); return; }
    const a = el('a', { href: URL.createObjectURL(await r.blob()), download: `customers-${S.store.slug}.csv` }); document.body.append(a); a.click(); a.remove();
  }
  drawChips(); refresh();
  return [el('div', { class: 'head' }, el('h1', { text: 'Customers' }), el('div', { class: 'row' },
    el('button', { class: 'btn-ghost', type: 'button', text: '⬇ Export CSV', onclick: exportCsv }),
    el('button', { class: 'btn-ghost', type: 'button', text: '↻ Rebuild', title: 'Recalculate every customer from your orders', onclick: async () => { try { const r = await API(base() + '/customers/rebuild', { method: 'POST' }); toast(`${r.customers} customers updated`); refresh(); } catch (e) { toast(e.message); } } }))),
  stats, el('div', { class: 'card' }, el('div', { class: 'filters' }, q, sort, tagSel), chips), list];
}

async function customerPage(id) {
  const { customer: c, orders } = await API(`${base()}/customers/${encodeURIComponent(id)}`);
  const info = el('div', { class: 'card' },
    el('div', { class: 'row', style: 'flex-wrap:wrap' }, el('h2', { class: 'grow', text: c.name || 'Customer' }), el('span', { class: 'badge ' + (c.segment === 'vip' ? 'active' : 'draft'), text: SEG_LABEL[c.segment] || c.segment })),
    el('div', {}, el('a', { href: 'tel:+' + c.phone, text: '+' + c.phone }), ' · ', el('a', { href: 'https://wa.me/' + c.phone, target: '_blank', rel: 'noopener', text: 'WhatsApp' }), c.email ? ' · ' : '', c.email ? el('a', { href: 'mailto:' + c.email, text: c.email }) : null),
    el('div', { class: 'grid3', style: 'margin-top:12px' },
      ...[['Total spent', inr(c.totalSpent)], ['Orders', `${c.orderCount}${c.cancelledCount ? ` (+${c.cancelledCount} cancelled)` : ''}`], ['Average order', inr(c.averageOrder)], ['First order', dshort(c.firstOrderAt)], ['Last order', dshort(c.lastOrderAt)]]
        .map(([k, v]) => el('div', {}, el('div', { class: 'muted small', text: k }), el('b', { text: v })))),
    c.addresses.length ? el('div', { style: 'margin-top:12px' }, el('div', { class: 'muted small', text: 'Addresses' }), ...c.addresses.map((a) => el('div', { class: 'small', text: `${a.line1}${a.line2 ? ', ' + a.line2 : ''}, ${a.city}, ${a.state} – ${a.pincode}` }))) : null);

  const form = el('form', { class: 'card' }, el('h2', { text: 'Notes & tags (only you see these)' }),
    field('notes', 'Notes', { value: c.notes, area: true, ph: 'Prefers evening delivery · Wholesale buyer · Size M' }),
    field('tags', 'Tags', { value: c.tags.join(', '), hint: 'Comma separated, e.g. wholesale, kochi, festive' }),
    el('label', { class: 'chk' }, el('input', { type: 'checkbox', id: 'codBlocked', ...(c.codBlocked ? { checked: '' } : {}) }), 'Block cash on delivery for this number (they can still pay online)'),
    el('button', { class: 'btn', type: 'submit', text: 'Save' }));
  form.addEventListener('submit', async (ev) => { ev.preventDefault(); try { await API(`${base()}/customers/${c.id}`, { method: 'PATCH', body: { notes: val(form, 'notes'), tags: val(form, 'tags'), codBlocked: form.querySelector('#codBlocked').checked } }); toast('Saved'); render(); } catch (e) { showErrors(form, e); } });

  const ol = el('div', { class: 'card' }, el('h2', { text: `Orders (${orders.length})` }), ...orders.map((o) => el('a', { class: 'row-item', href: '#orders/' + o.orderNumber, style: 'text-decoration:none;color:inherit' },
    el('div', { class: 'grow' }, el('b', { text: '#' + o.orderNumber }), el('div', { class: 'muted small', text: `${dshort(o.createdAt)} · ${o.items} item${o.items === 1 ? '' : 's'} · ${o.paymentMethod === 'cod' ? 'COD' : 'Online'} ${o.paymentStatus}` })),
    el('b', { text: inr(o.total) }), el('span', { class: 'badge st-' + o.status, text: o.status }))));

  const erase = el('form', { class: 'card' }, el('h2', { text: 'Erase personal data' }),
    el('p', { class: 'muted small', text: 'If this customer asks you to delete their data: their name, phone, email and addresses are removed from your store. Orders stay for your accounts, marked "Deleted customer". This cannot be undone.' }),
    field('confirmPhone', 'Type their 10-digit number to confirm', { type: 'tel' }), el('button', { class: 'btn danger', type: 'submit', text: 'Erase customer data' }));
  erase.addEventListener('submit', async (ev) => { ev.preventDefault(); if (!confirm('Erase this customer\'s personal data permanently?')) return; try { await API(`${base()}/customers/${c.id}`, { method: 'DELETE', body: { confirmPhone: val(erase, 'confirmPhone') } }); toast('Customer data erased'); location.hash = '#customers'; } catch (e) { showErrors(erase, e); } });

  return [el('div', { class: 'head' }, el('a', { class: 'link', href: '#customers', text: '← Customers' })), info, form, ol, erase];
}
