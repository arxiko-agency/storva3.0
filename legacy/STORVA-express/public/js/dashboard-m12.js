'use strict';
// Module 12: "Shipping & tax" tab – delivery charges (free / flat / by region with delivery days and COD per region), PIN codes
// you don't deliver to, cash-on-delivery fee + limit, GST registration and invoice settings, and a live "what will a shopper pay" check.
// Loaded before dashboard.js. All text via textContent.
async function shippingView() {
  const D = await API(base() + '/shipping');
  const S = D.shipping, T = D.tax;
  let zones = S.zones.map((z) => ({ ...z }));
  const num = (v) => (v === '' || v == null ? null : Number(v));

  // ---------- delivery ----------
  const modeSel = select('mode', 'How do you charge for delivery?', [['free', 'Free delivery on every order'], ['flat', 'One flat charge'], ['zones', 'Different charges by state / region']], S.mode);
  const flat = el('div', { class: 'two' }, field('flatRate', 'Delivery charge (₹)', { type: 'number', value: S.flatRate ?? '' }), field('freeAbove', 'Free delivery above (₹, optional)', { type: 'number', value: S.freeAbove ?? '' }));
  const zoneBox = el('div');
  const ship = el('form', { class: 'card' }, el('h2', { text: '🚚 Delivery charges' }), modeSel, flat, zoneBox,
    field('blockedPincodes', 'PIN codes you do not deliver to (optional)', { value: S.blockedPincodes.join(', '), hint: 'Full PIN codes or their first digits, separated by commas. Example: 744, 194101' }),
    el('div', { class: 'err', id: 'shipErr' }), el('button', { class: 'btn', type: 'submit', text: 'Save delivery settings' }));
  const showMode = () => { const m = modeSel.querySelector('select').value; flat.style.display = m === 'flat' ? '' : 'none'; zoneBox.style.display = m === 'zones' ? '' : 'none'; if (m === 'free') flat.style.display = 'none'; };
  modeSel.querySelector('select').addEventListener('change', showMode);

  function drawZones() {
    const used = new Set(zones.flatMap((z) => z.states));
    zoneBox.replaceChildren(el('p', { class: 'muted small', text: 'Each state can be in one region. A region with no states covers the rest of India.' }),
      ...zones.map((z, i) => {
        const states = el('div', { class: 'share-pick', style: 'max-height:160px' }, ...D.states.map((s) => { const cb = el('input', { type: 'checkbox', value: s, ...(z.states.includes(s) ? { checked: '' } : {}), ...(used.has(s) && !z.states.includes(s) ? { disabled: '' } : {}) }); cb.addEventListener('change', () => { z.states = cb.checked ? [...z.states, s] : z.states.filter((x) => x !== s); drawZones(); }); return el('label', {}, cb, s); }));
        const inp = (k, label, type = 'text', ph = '') => { const n = el('input', { type, placeholder: ph, 'aria-label': label }); n.value = z[k] ?? ''; n.addEventListener('input', () => { z[k] = type === 'number' ? num(n.value) : n.value; }); return el('div', {}, el('label', { text: label }), n); };
        const cod = el('input', { type: 'checkbox', ...(z.codAvailable !== false ? { checked: '' } : {}) }); cod.addEventListener('change', () => { z.codAvailable = cod.checked; });
        return el('div', { class: 'card', style: 'background:#fcfaf6' },
          el('div', { class: 'row' }, el('b', { class: 'grow', text: z.name || 'New region' }), el('button', { class: 'btn-ghost', type: 'button', text: 'Remove', onclick: () => { zones.splice(i, 1); drawZones(); } })),
          el('div', { class: 'grid3' }, inp('name', 'Region name', 'text', 'Kerala'), inp('rate', 'Charge (₹)', 'number'), inp('freeAbove', 'Free above (₹)', 'number'), inp('etaDays', 'Delivery days', 'text', '2-4')),
          el('label', { class: 'chk' }, cod, 'Cash on delivery available here'),
          el('details', { ...(z.states.length ? {} : { open: '' }) }, el('summary', { text: z.states.length ? `${z.states.length} state${z.states.length === 1 ? '' : 's'}: ${z.states.slice(0, 4).join(', ')}${z.states.length > 4 ? '…' : ''}` : 'Rest of India (no states chosen)' }), states));
      }),
      el('div', { class: 'row', style: 'flex-wrap:wrap' },
        el('button', { class: 'btn-ghost', type: 'button', text: '+ Add region', onclick: () => { zones.push({ name: '', states: [], rate: 0, freeAbove: null, etaDays: '', codAvailable: true }); drawZones(); } }),
        !zones.length ? el('button', { class: 'btn-ghost', type: 'button', text: 'Use a Kerala-first template', onclick: () => { zones = [
          { name: 'Kerala', states: ['Kerala'], rate: 40, freeAbove: 999, etaDays: '1-3', codAvailable: true },
          { name: 'South India', states: ['Tamil Nadu', 'Karnataka', 'Puducherry', 'Andhra Pradesh', 'Telangana', 'Lakshadweep'], rate: 60, freeAbove: 1499, etaDays: '3-5', codAvailable: true },
          { name: 'Rest of India', states: [], rate: 90, freeAbove: null, etaDays: '5-8', codAvailable: false }]; drawZones(); } }) : null));
  }
  drawZones(); showMode();
  ship.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const m = modeSel.querySelector('select').value;
    const body = { shipping: { mode: m, blockedPincodes: val(ship, 'blockedPincodes') } };
    if (m === 'flat') Object.assign(body.shipping, { flatRate: num(val(ship, 'flatRate')) ?? 0, freeAbove: num(val(ship, 'freeAbove')) });
    if (m === 'zones') body.shipping.zones = zones.map((z) => ({ id: z.id, name: z.name, states: z.states, rate: z.rate ?? 0, freeAbove: z.freeAbove, etaDays: z.etaDays || '', codAvailable: z.codAvailable !== false }));
    try { const r = await API(base() + '/shipping', { method: 'PUT', body }); zones = r.shipping.zones.map((z) => ({ ...z })); drawZones(); $('#shipErr').textContent = ''; toast('Delivery settings saved'); }
    catch (e) { ship.querySelector('#shipErr').textContent = e.fields ? Object.values(e.fields).join(' ') : e.message; }
  });

  // ---------- cash on delivery ----------
  const cod = el('form', { class: 'card' }, el('h2', { text: '💵 Cash on delivery' }),
    el('label', { class: 'chk' }, el('input', { type: 'checkbox', id: 'codEnabled', ...(S.cod.enabled ? { checked: '' } : {}) }), 'Offer cash on delivery'),
    el('div', { class: 'two' }, field('codFee', 'Extra fee for COD (₹)', { type: 'number', value: S.cod.fee || '' , hint: 'Many shops charge ₹30–50 to cover courier COD charges.' }), field('codMax', 'Only for orders up to (₹, optional)', { type: 'number', value: S.cod.maxOrder ?? '' })),
    el('p', { class: 'muted small', text: 'You can also block COD for a single customer from their page in Customers.' }),
    el('button', { class: 'btn', type: 'submit', text: 'Save COD settings' }));
  cod.addEventListener('submit', async (ev) => { ev.preventDefault(); try { await API(base() + '/shipping', { method: 'PUT', body: { shipping: { cod: { enabled: cod.querySelector('#codEnabled').checked, fee: num(val(cod, 'codFee')) ?? 0, maxOrder: num(val(cod, 'codMax')) } } } }); toast('COD settings saved'); } catch (e) { showErrors(cod, { ...e, fields: e.fields && Object.fromEntries(Object.entries(e.fields).map(([k, v]) => [k.endsWith('fee') ? 'codFee' : 'codMax', v])) }); } });

  // ---------- GST ----------
  const gst = el('form', { class: 'card' }, el('h2', { text: '🧾 GST & invoices' }),
    el('label', { class: 'chk' }, el('input', { type: 'checkbox', id: 'gstEnabled', ...(T.enabled ? { checked: '' } : {}) }), 'I am GST registered – show GST and issue tax invoices'),
    el('div', { class: 'two' }, field('gstin', 'GSTIN', { value: T.gstin, ph: '32ABCDE1234F1Z5' }), field('legalName', 'Legal business name', { value: T.legalName })),
    field('gstAddress', 'Business address (on invoices)', { value: T.address, area: true }),
    el('div', { class: 'two' }, select('defaultRate', 'Default GST rate for products', D.gstRates.map((r) => [String(r), r + '%']), String(T.defaultRate)),
      field('invoicePrefix', 'Invoice number prefix', { value: T.invoicePrefix, hint: 'Invoices are numbered like ' + (T.invoicePrefix || 'INV') + '/26-27/00001' })),
    el('label', { class: 'chk' }, el('input', { type: 'checkbox', id: 'pricesIncludeTax', ...(T.pricesIncludeTax ? { checked: '' } : {}) }), 'My product prices already include GST (recommended for shoppers)'),
    el('label', { class: 'chk' }, el('input', { type: 'checkbox', id: 'shippingTaxable', ...(T.shippingTaxable ? { checked: '' } : {}) }), 'Charge GST on delivery and COD fees too'),
    el('p', { class: 'muted small', text: 'Since 22 September 2025 most goods are taxed at 5% or 18%. Set a different rate on any product. Same-state orders get CGST + SGST, other states IGST. Check rates with your accountant.' }),
    el('button', { class: 'btn', type: 'submit', text: 'Save GST settings' }));
  gst.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const c = (id) => gst.querySelector('#' + id).checked;
    try { await API(base() + '/shipping', { method: 'PUT', body: { tax: { enabled: c('gstEnabled'), gstin: val(gst, 'gstin'), legalName: val(gst, 'legalName'), address: val(gst, 'gstAddress'), defaultRate: Number(gst.querySelector('#defaultRate').value), invoicePrefix: val(gst, 'invoicePrefix'), pricesIncludeTax: c('pricesIncludeTax'), shippingTaxable: c('shippingTaxable') } } }); toast('GST settings saved'); }
    catch (e) { showErrors(gst, { ...e, fields: e.fields && Object.fromEntries(Object.entries(e.fields).map(([k, v]) => [k.replace('tax.', '').replace('address', 'gstAddress'), v])) }); }
  });

  // ---------- check ----------
  const out = el('div', { class: 'preview-text', text: 'Choose a state and amount to see what a shopper pays.' });
  const stSel = select('pvState', 'Shopper state', [['', 'Choose…'], ...D.states.map((s) => [s, s])], '');
  const check = el('div', { class: 'card' }, el('h2', { text: '🔎 Check what a shopper pays' }),
    el('div', { class: 'grid3' }, field('pvAmount', 'Cart value (₹)', { type: 'number', value: '1000' }), stSel, field('pvPin', 'PIN code (optional)'), select('pvPay', 'Payment', [['razorpay', 'Online'], ['cod', 'Cash on delivery']], 'cod')),
    el('button', { class: 'btn-ghost', type: 'button', style: 'margin-top:10px', text: 'Calculate', onclick: async () => {
      try {
        const r = await API(base() + '/shipping/preview', { method: 'POST', body: { subtotal: Number(val(check, 'pvAmount')), state: check.querySelector('#pvState').value, pincode: val(check, 'pvPin'), paymentMethod: check.querySelector('#pvPay').value } });
        out.textContent = !r.serviceable ? '❌ ' + r.problem : [`Region: ${r.zone || '—'}${r.etaDays ? ` · ${r.etaDays} days` : ''}`, `Delivery: ${r.shipping ? inr(r.shipping) : 'Free'}`, r.codFee ? `COD fee: ${inr(r.codFee)}` : null, r.tax ? `GST: ${inr(r.tax)} ${r.taxInclusive ? '(included)' : '(added)'} – ${r.taxBreakdown.igst ? 'IGST ' + inr(r.taxBreakdown.igst) : `CGST ${inr(r.taxBreakdown.cgst)} + SGST ${inr(r.taxBreakdown.sgst)}`}` : null, `Shopper pays: ${inr(r.total)}`, r.cod ? 'COD: available' : `COD: not available${r.codReason ? ' – ' + r.codReason : ''}`].filter(Boolean).join('\n');
      } catch (e) { out.textContent = e.message; }
    } }), el('div', { style: 'margin-top:10px' }, out));

  return [el('div', { class: 'head' }, el('h1', { text: 'Shipping & tax' })), ship, cod, gst, check];
}
