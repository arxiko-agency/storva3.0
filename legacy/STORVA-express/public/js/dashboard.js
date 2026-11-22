'use strict';
// Store dashboard (Module 3). All text goes through textContent / value, never innerHTML with user data.
const $ = (s, r = document) => r.querySelector(s);
const root = $('#root');
let ME = null;

async function API(path, { method = 'GET', body } = {}) {
  const r = await fetch('/api' + path, { method, credentials: 'same-origin', headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error((j.error && j.error.message) || 'Something went wrong'); e.status = r.status; e.fields = j.error && j.error.fields; e.code = j.error && j.error.code; e.details = j.error && j.error.details; throw e; }
  return j;
}
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.style.display = 'block'; clearTimeout(toast.t); toast.t = setTimeout(() => { t.style.display = 'none'; }, 2500); }
function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (v == null || v === false) continue; if (k === 'text') n.textContent = v; else if (k === 'class') n.className = v; else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v); }
  kids.flat().forEach((c) => c && n.append(c)); return n;
}
function field(id, label, { type = 'text', value = '', hint = '', area = false, ph = '' } = {}) {
  const input = el(area ? 'textarea' : 'input', { id, name: id, placeholder: ph, ...(area ? {} : { type }) }); input.value = value;
  return el('div', {}, el('label', { for: id, text: label }), input, hint && el('div', { class: 'hint', text: hint }), el('div', { class: 'err', id: id + 'Err' }));
}
function showErrors(form, e) {
  form.querySelectorAll('.err').forEach((n) => { n.textContent = ''; });
  let shown = false;
  if (e.fields) Object.entries(e.fields).forEach(([k, m]) => { const n = form.querySelector('#' + k + 'Err'); if (n) { n.textContent = m; shown = true; } });
  if (!shown) toast(e.message || 'Something went wrong');
}
const val = (form, id) => form.querySelector('#' + id).value.trim();

function slugWatcher(form, currentSlug) {
  const input = form.querySelector('#slug'), msg = form.querySelector('#slugErr'); let t;
  input.addEventListener('input', () => {
    clearTimeout(t); const s = input.value.trim().toLowerCase();
    if (!s || s === currentSlug) { msg.textContent = ''; return; }
    t = setTimeout(async () => {
      try { const r = await API('/stores/slug-check?slug=' + encodeURIComponent(s)); msg.className = r.available ? 'err ok' : 'err'; msg.textContent = r.available ? 'Available ✓' : r.reason; } catch { /* ignore */ }
    }, 350);
  });
}

function createView() {
  const form = el('form', { class: 'card' },
    el('h2', { text: 'Create your store' }),
    field('name', 'Store name', { ph: 'Priya Boutique' }),
    field('slug', 'Store address', { hint: 'Lowercase letters, numbers and hyphens (3 to 30).', ph: 'priya-boutique' }),
    field('whatsappNumber', 'WhatsApp number', { type: 'tel', ph: '9876543210', hint: 'Customers will message this number to order.' }),
    field('tagline', 'Tagline (optional)'),
    el('button', { class: 'btn', type: 'submit', text: 'Create store' }));
  const name = form.querySelector('#name'), slug = form.querySelector('#slug');
  let touched = false; slug.addEventListener('input', () => { touched = true; });
  name.addEventListener('input', () => { if (!touched) { slug.value = name.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30); slug.dispatchEvent(new Event('input')); } });
  slugWatcher(form, '');
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try { await API('/stores', { method: 'POST', body: { name: val(form, 'name'), slug: val(form, 'slug'), whatsappNumber: val(form, 'whatsappNumber'), tagline: val(form, 'tagline') } }); toast('Store created'); load(); }
    catch (e) { showErrors(form, e); }
  });
  return form;
}

function manageView(s) {
  const form = el('form', { class: 'card' },
    el('h2', { text: 'Store settings' }),
    field('name', 'Store name', { value: s.name }), field('slug', 'Store address', { value: s.slug, hint: 'Changing it keeps your old link reserved.' }),
    field('tagline', 'Tagline', { value: s.tagline }), field('description', 'About your store', { value: s.description, area: true }),
    field('whatsappNumber', 'WhatsApp number', { type: 'tel', value: s.whatsappNumber.replace(/^91/, '') }),
    field('contactEmail', 'Contact email', { type: 'email', value: s.contactEmail }), field('address', 'Address', { value: s.address }),
    el('label', { class: 'chk' }, el('input', { type: 'checkbox', id: 'showcase' }), 'Show my store in the public showcase'),
    el('button', { class: 'btn', type: 'submit', text: 'Save changes' }));
  form.querySelector('#showcase').checked = s.showcase;
  slugWatcher(form, s.slug);
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try { await API('/stores/' + s.id, { method: 'PATCH', body: { name: val(form, 'name'), slug: val(form, 'slug'), tagline: val(form, 'tagline'), description: val(form, 'description'), whatsappNumber: val(form, 'whatsappNumber'), contactEmail: val(form, 'contactEmail'), address: val(form, 'address'), showcase: form.querySelector('#showcase').checked } }); toast('Saved'); load(); }
    catch (e) { showErrors(form, e); }
  });
  const del = el('form', { class: 'card' }, el('h2', { text: 'Delete store' }), el('p', { class: 'muted', text: `This permanently deletes the store and all its data. Type "${s.slug}" to confirm.` }),
    field('confirmSlug', 'Store address'), el('button', { class: 'btn danger', type: 'submit', text: 'Delete store' }));
  del.addEventListener('submit', async (ev) => { ev.preventDefault(); try { await API('/stores/' + s.id, { method: 'DELETE', body: { confirmSlug: val(del, 'confirmSlug') } }); toast('Store deleted'); load(); } catch (e) { showErrors(del, e); } });
  return [form, del];
}


// ================= Module 4: products, collections =================
const inr = (n) => (n == null ? '' : '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 }));
const S = { stores: [], store: null };
const base = () => '/stores/' + S.store.id;
function select(id, label, opts, value) {
  const sel = el('select', { id, name: id }, opts.map(([v, t]) => el('option', { value: v, text: t })));
  sel.value = value == null ? opts[0][0] : value;
  return el('div', {}, label && el('label', { for: id, text: label }), sel);
}
const badge = (t) => el('span', { class: 'badge ' + t, text: t });

async function productsView(param) {
  if (param) return productForm(param === 'new' ? null : param);
  const state = { q: '', status: '', category: '', sort: 'newest', page: 1 };
  const list = el('div', { class: 'card' }), bar = el('div', { class: 'filters' });
  const q = el('input', { type: 'search', placeholder: 'Search title, SKU, tag…', 'aria-label': 'Search products' });
  const cats = (await API(base() + '/products/categories')).categories;
  const st = select('fStatus', null, [['', 'All statuses'], ['active', 'Active'], ['draft', 'Draft'], ['archived', 'Archived']]);
  const ca = select('fCat', null, [['', 'All categories'], ...cats.map((c) => [c.name, `${c.name} (${c.count})`])]);
  const so = select('fSort', null, [['newest', 'Newest'], ['oldest', 'Oldest'], ['price_asc', 'Price ↑'], ['price_desc', 'Price ↓'], ['title', 'Title A–Z']]);
  bar.append(q, st, ca, so);
  const add = el('a', { class: 'btn-link', href: '#products/new', text: '+ Add product' });
  async function refresh() {
    const qs = new URLSearchParams({ q: state.q, status: state.status, category: state.category, sort: state.sort, page: state.page, limit: 10 });
    const r = await API(base() + '/products?' + qs);
    const rows = r.products.map((p) => el('div', { class: 'row-item' },
      el('div', { class: 'thumb' }, p.images[0] ? el('img', { src: p.images[0].url, alt: p.images[0].alt || p.title, loading: 'lazy' }) : null),
      el('div', { class: 'grow' }, el('b', { text: p.title }), el('div', { class: 'muted small', text: `${inr(p.price)} · ${p.trackInventory ? p.totalStock + ' in stock' : 'not tracked'}${p.variants.length ? ' · ' + p.variants.length + ' variants' : ''}${p.category ? ' · ' + p.category : ''}` })),
      badge(p.status),
      el('a', { class: 'link', href: '#products/' + p.id, text: 'Edit' }),
      el('button', { class: 'link danger-t', type: 'button', text: 'Delete', onclick: async () => { if (!confirm(`Delete "${p.title}"?`)) return; try { await API(base() + '/products/' + p.id, { method: 'DELETE' }); toast('Deleted'); refresh(); } catch (e) { toast(e.message); } } })));
    list.replaceChildren(el('div', { class: 'muted small', text: `${r.total} product${r.total === 1 ? '' : 's'}` }),
      ...(rows.length ? rows : [el('p', { class: 'muted', text: state.q || state.status || state.category ? 'No products match these filters.' : 'No products yet. Add your first product.' })]),
      el('div', { class: 'pager' }, el('button', { class: 'link', type: 'button', text: '← Prev', disabled: r.page <= 1 ? '' : null, onclick: () => { state.page--; refresh(); } }), el('span', { class: 'muted small', text: `Page ${r.page} of ${r.pages}` }), el('button', { class: 'link', type: 'button', text: 'Next →', disabled: r.page >= r.pages ? '' : null, onclick: () => { state.page++; refresh(); } })));
  }
  let t; q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { state.q = q.value.trim(); state.page = 1; refresh(); }, 300); });
  [[st, 'status'], [ca, 'category'], [so, 'sort']].forEach(([w, k]) => w.querySelector('select').addEventListener('change', (e) => { state[k] = e.target.value; state.page = 1; refresh(); }));
  await refresh();
  return [el('div', { class: 'head' }, el('h1', { text: 'Products' }), el('div', { class: 'row' }, typeof aiPhotoButton === 'function' ? aiPhotoButton() : null, add)), bar, list];
}

async function productForm(id) {
  let p = id ? (await API(`${base()}/products/${id}`)).product : null;
  const cols = (await API(base() + '/collections')).collections;
  const form = el('form', { class: 'card' });
  const v = (k, d = '') => (p && p[k] != null ? p[k] : d);
  form.append(
    field('title', 'Title', { value: v('title') }), field('description', 'Description', { value: v('description'), area: true }),
    el('div', { class: 'two' }, field('price', 'Price (₹)', { type: 'number', value: v('price') }), field('compareAtPrice', 'Compare-at price (₹)', { type: 'number', value: v('compareAtPrice') })),
    el('div', { class: 'two' }, field('category', 'Category', { value: v('category') }), field('sku', 'SKU', { value: v('sku') })),
    el('div', { class: 'two' }, select('gstRate', 'GST rate', [['', 'Store default'], ...[0, 0.25, 3, 5, 12, 18, 28, 40].map((r) => [String(r), r + '%'])], p && p.gstRate != null ? String(p.gstRate) : ''), field('hsn', 'HSN code', { value: v('hsn'), hint: '4, 6 or 8 digits (printed on GST invoices)' })),
    field('tags', 'Tags (comma separated)', { value: (p ? p.tags : []).join(', ') }),
    el('div', { class: 'two' }, select('status', 'Status', [['draft', 'Draft (hidden)'], ['active', 'Active (visible)'], ['archived', 'Archived']], v('status', 'draft')), field('stock', 'Stock (when no variants)', { type: 'number', value: v('stock', 0) })),
    el('label', { class: 'chk' }, el('input', { type: 'checkbox', id: 'trackInventory' }), 'Track inventory'),
    el('div', { class: 'err', id: 'variantsErr' }), el('div', { class: 'err', id: 'optionsErr' }));
  form.querySelector('#trackInventory').checked = p ? p.trackInventory : true;
  // ---- options + variants editor
  const optBox = el('div', { class: 'card inner' }), varBox = el('div'), optRows = [];
  const existing = new Map((p ? p.variants : []).map((x) => [x.key, x]));
  function addOpt(name = '', values = '') {
    const row = el('div', { class: 'row' }, el('input', { placeholder: 'Option (e.g. Size)', value: name, 'aria-label': 'Option name' }), el('input', { placeholder: 'Values: S, M, L', value: values, 'aria-label': 'Option values' }),
      el('button', { type: 'button', class: 'link danger-t', text: '✕', 'aria-label': 'Remove option', onclick: () => { optRows.splice(optRows.indexOf(row), 1); row.remove(); buildVariants(); } }));
    row.querySelectorAll('input').forEach((i) => i.addEventListener('change', buildVariants)); optRows.push(row); optBox.insertBefore(row, optBox.querySelector('.addopt'));
  }
  const readOpts = () => optRows.map((r) => { const [n, vs] = r.querySelectorAll('input'); return { name: n.value.trim(), values: [...new Set(vs.value.split(',').map((x) => x.trim()).filter(Boolean))] }; }).filter((o) => o.name && o.values.length);
  const combos = (opts) => opts.reduce((acc, o) => acc.flatMap((a) => o.values.map((val) => [...a, [o.name, val]])), [[]]);
  const typed = new Map();
  function buildVariants() {
    varBox.querySelectorAll('tr[data-key]').forEach((tr) => typed.set(tr.dataset.key, [...tr.querySelectorAll('input')].map((i) => i.value)));
    const opts = readOpts(); varBox.replaceChildren(); if (!opts.length) return;
    const tbl = el('table', { class: 'vt' }, el('thead', {}, el('tr', {}, ['Variant', 'Price ₹ (optional)', 'Stock', 'SKU'].map((h) => el('th', { text: h })))));
    const tb = el('tbody'); combos(opts).forEach((c) => {
      const key = c.map((x) => x[1]).join('|'), old = typed.get(key) || (existing.has(key) ? [existing.get(key).price ?? '', existing.get(key).stock, existing.get(key).sku] : ['', 0, '']);
      const tr = el('tr', { 'data-key': key, 'data-opts': JSON.stringify(Object.fromEntries(c)) }, el('td', { text: c.map((x) => x[1]).join(' / ') }),
        ...[['number', old[0]], ['number', old[1]], ['text', old[2]]].map(([type, val]) => el('td', {}, el('input', { type, value: val, min: type === 'number' ? '0' : null }))));
      tb.append(tr);
    }); tbl.append(tb); varBox.append(el('div', { class: 'scroll' }, tbl));
  }
  optBox.append(el('h2', { text: 'Variants' }), el('p', { class: 'muted small', text: 'Add options like Size or Color, with comma-separated values.' }), el('button', { type: 'button', class: 'link addopt', text: '+ Add option', onclick: () => { if (optRows.length < 3) addOpt(); } }));
  (p ? p.options : []).forEach((o) => addOpt(o.name, o.values.join(', '))); buildVariants(); form.append(optBox, varBox);
  // ---- collections
  if (cols.length) form.append(el('div', {}, el('label', { text: 'Collections' }), ...cols.map((c) => el('label', { class: 'chk' }, el('input', { type: 'checkbox', value: c.id, class: 'colchk', ...(p && p.collections.includes(c.id) ? { checked: '' } : {}) }), c.name))));
  form.append(el('button', { class: 'btn', type: 'submit', text: p ? 'Save product' : 'Create product' }));
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault(); const opts = readOpts();
    const variants = [...varBox.querySelectorAll('tr[data-key]')].map((tr) => { const [pr, st, sk] = [...tr.querySelectorAll('input')].map((i) => i.value); return { options: JSON.parse(tr.dataset.opts), price: pr === '' ? null : Number(pr), stock: Number(st || 0), sku: sk }; });
    const body = { title: val(form, 'title'), description: val(form, 'description'), price: val(form, 'price'), compareAtPrice: val(form, 'compareAtPrice') || null, category: val(form, 'category'), sku: val(form, 'sku'), gstRate: form.querySelector('#gstRate').value === '' ? null : Number(form.querySelector('#gstRate').value), hsn: val(form, 'hsn'),
      tags: val(form, 'tags').split(',').map((x) => x.trim()).filter(Boolean), status: form.querySelector('#status').value, stock: Number(val(form, 'stock') || 0), trackInventory: form.querySelector('#trackInventory').checked,
      options: opts, variants, collections: [...form.querySelectorAll('.colchk:checked')].map((c) => c.value) };
    try {
      const r = await API(id ? `${base()}/products/${id}` : base() + '/products', { method: id ? 'PATCH' : 'POST', body });
      toast('Saved'); if (!id) location.hash = '#products/' + r.product.id; else render();
    } catch (e) { showErrors(form, e); }
  });
  // ---- images (only after the product exists)
  const imgCard = el('div', { class: 'card' }, el('h2', { text: 'Images' }));
  if (!p) imgCard.append(el('p', { class: 'muted', text: 'Save the product first, then add images (JPEG, PNG or WebP, up to 5 MB, max 8).' }));
  else {
    const grid = el('div', { class: 'imgs' });
    const draw = () => { grid.replaceChildren(...p.images.map((im) => el('div', { class: 'img' }, el('img', { src: im.url, alt: im.alt || p.title }), el('button', { type: 'button', class: 'x', 'aria-label': 'Remove image', text: '✕', onclick: async () => { try { p = (await API(`${base()}/products/${p.id}/images/${im.id}`, { method: 'DELETE' })).product; draw(); } catch (e) { toast(e.message); } } })))); };
    const file = el('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', multiple: '' });
    file.addEventListener('change', async () => {
      for (const f of file.files) {
        if (f.size > 5 * 1024 * 1024) { toast(f.name + ' is larger than 5 MB'); continue; }
        try { const r = await fetch(`/api${base()}/products/${p.id}/images`, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': f.type }, body: f }); const j = await r.json(); if (!r.ok) throw new Error(j.error.message); p = j.product; draw(); } catch (e) { toast(e.message); }
      } file.value = '';
    });
    draw(); imgCard.append(grid, file);
  }
  return [el('div', { class: 'head' }, el('a', { class: 'link', href: '#products', text: '← Products' }), el('h1', { text: p ? 'Edit product' : 'New product' })), typeof aiAssistCard === 'function' ? aiAssistCard(form, p) : null, form, imgCard];
}

async function collectionsView() {
  const wrap = el('div'); const box = el('div', { class: 'card' });
  const form = el('form', { class: 'card' }, el('h2', { text: 'New collection' }), field('name', 'Name'), field('description', 'Description (optional)'), el('button', { class: 'btn', type: 'submit', text: 'Create collection' }));
  form.addEventListener('submit', async (ev) => { ev.preventDefault(); try { await API(base() + '/collections', { method: 'POST', body: { name: val(form, 'name'), description: val(form, 'description') } }); toast('Created'); render(); } catch (e) { showErrors(form, e); } });
  const { collections } = await API(base() + '/collections');
  const { products } = await API(base() + '/products?limit=100&sort=title');
  box.append(el('div', { class: 'muted small', text: `${collections.length} collection${collections.length === 1 ? '' : 's'}` }));
  if (!collections.length) box.append(el('p', { class: 'muted', text: 'No collections yet. Create one to group products (for example "Festive offers").' }));
  for (const c of collections) {
    const members = el('div', { class: 'members hidden' });
    const row = el('div', { class: 'row-item' }, el('div', { class: 'grow' }, el('b', { text: c.name }), el('div', { class: 'muted small', text: `${c.productCount} product${c.productCount === 1 ? '' : 's'}${c.description ? ' · ' + c.description : ''}` })),
      el('button', { class: 'link', type: 'button', text: 'Products', onclick: () => members.classList.toggle('hidden') }),
      el('button', { class: 'link', type: 'button', text: 'Rename', onclick: async () => { const n = prompt('New name', c.name); if (!n) return; try { await API(`${base()}/collections/${c.id}`, { method: 'PATCH', body: { name: n } }); render(); } catch (e) { toast(e.message); } } }),
      el('button', { class: 'link danger-t', type: 'button', text: 'Delete', onclick: async () => { if (!confirm(`Delete collection "${c.name}"? Products are kept.`)) return; try { await API(`${base()}/collections/${c.id}`, { method: 'DELETE' }); render(); } catch (e) { toast(e.message); } } }));
    const inCol = new Set((await API(`${base()}/products?collection=${c.id}&limit=100`)).products.map((p) => p.id));
    members.append(...(products.length ? products.map((p) => el('label', { class: 'chk' }, el('input', { type: 'checkbox', value: p.id, ...(inCol.has(p.id) ? { checked: '' } : {}) }), p.title)) : [el('p', { class: 'muted', text: 'Add products first.' })]),
      products.length ? el('button', { class: 'btn', type: 'button', text: 'Save products', onclick: async () => { try { await API(`${base()}/collections/${c.id}/products`, { method: 'PUT', body: { productIds: [...members.querySelectorAll('input:checked')].map((i) => i.value) } }); toast('Saved'); render(); } catch (e) { toast(e.message); } } }) : null);
    box.append(row, members);
  }
  wrap.append(el('h1', { text: 'Collections' }), box, form); return [wrap];
}

// ================= shell / routing =================
// Tabs: [hash, label, view]. Views from later modules live in dashboard-m*.js (loaded first). A tab whose view file is missing is hidden.
const TABS = [
  ['home', 'Home', () => (typeof homeView === 'function' ? homeView() : productsView())],
  ['products', 'Products', (p) => productsView(p)], ['collections', 'Collections', () => collectionsView()],
  ['orders', 'Orders', (p) => ordersView(p)], ['customers', 'Customers', (p) => customersView(p)], ['payments', 'Payments', (p) => paymentsView(p)],
  ['coupons', 'Coupons', () => couponsView()], ['designer', 'Designer', () => designerView()], ['analytics', 'Analytics', () => analyticsView()],
  ['whatsapp', 'WhatsApp', () => whatsappView()], ['shipping', 'Shipping & tax', () => shippingView()], ['notifications', 'Notifications', () => notificationsView()],
  ['plan', 'Plan', (p) => planView(p)], ['settings', 'Store settings', () => manageView(S.store)],
];
const VIEW_FN = { home: 'homeView', customers: 'customersView', designer: 'designerView', analytics: 'analyticsView', whatsapp: 'whatsappView', shipping: 'shippingView', notifications: 'notificationsView', plan: 'planView' };
const tabAvailable = (k) => !VIEW_FN[k] || k === 'home' || typeof window[VIEW_FN[k]] === 'function';  // top-level function declarations in classic scripts are window properties
async function render() {
  root.classList.remove('wide'); root.style.maxWidth = '';
  const [tabRaw, param] = (location.hash.slice(1) || 'home').split('/');
  const tabs = TABS.filter(([k]) => tabAvailable(k));
  const entry = tabs.find(([k]) => k === tabRaw) || tabs[0];
  const tab = entry[0];
  const nav = el('nav', { class: 'tabs' }, tabs.map(([k, t]) => el('a', { href: '#' + k, class: k === tab ? 'on' : '', text: t, ...(k === 'notifications' ? { 'data-unread-tab': '' } : {}) })));
  const links = S.store ? el('p', { class: 'muted small' }, 'Your store address: ', el('a', { href: '/store/' + S.store.slug, target: '_blank', rel: 'noopener', text: '/store/' + S.store.slug }), S.stores.length > 1 ? ' (switch store below)' : '') : null;
  let body;
  try { body = await entry[2](param); }
  catch (e) { if (e.status === 401) { location.href = '/#login'; return; } body = [e.code === 'upgrade_required' && typeof upgradeNote === 'function' ? upgradeNote(e.message, e.details && e.details.feature) : el('p', { class: 'err', text: e.message })]; }
  root.replaceChildren(nav, links, ...[].concat(body));
  if (typeof refreshUnread === 'function') refreshUnread();
}
async function load() {
  try {
    if (!ME) { ME = (await API('/auth/me')).user; $('#who').textContent = ME.name; }
    const { stores, limit } = await API('/stores');
    S.stores = stores; S.store = stores.find((x) => S.store && x.id === S.store.id) || stores[0] || null;
    if (!S.store) { root.replaceChildren(el('h1', { text: 'Welcome 👋' }), createView()); return; }
    await render();
    if (stores.length < limit) root.append(createView());
  } catch (e) { if (e.status === 401) location.href = '/#login'; else root.replaceChildren(el('p', { class: 'err', text: e.message })); }
}
window.addEventListener('hashchange', () => { if (S.store) render(); });
$('#logout').addEventListener('click', async () => { try { await API('/auth/logout', { method: 'POST' }); } finally { location.href = '/'; } });
load();
