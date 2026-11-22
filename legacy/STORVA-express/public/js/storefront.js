'use strict';
// STORVA storefront client (Module 5): product page, cart and checkout. Module 6 adds online payment (Razorpay Checkout).
// The cart in the browser holds ONLY product ids and quantities. Names, prices, stock, coupons and totals always come
// from the server (POST /api/public/stores/:slug/cart/quote), and the server re-prices everything when the order is placed.
// All dynamic text is written through textContent or element attributes (no HTML strings).
// PAYMENTS: this file never sees a secret. The server returns only the PUBLIC key id; the browser hands Razorpay's proof of payment
// back to the server, which checks the signature with the secret key and is the only thing that can mark an order paid.
(function () {
  const body = document.body, slug = body.dataset.slug, page = body.dataset.page;
  if (!slug) return;
  const API = '/api/public/stores/' + encodeURIComponent(slug);
  const CART_KEY = 'storva_cart_' + slug, COUPON_KEY = 'storva_coupon_' + slug, IDEM_KEY = 'storva_idem_' + slug;
  const FLASH_KEY = 'storva_payflash_' + slug;
  const pvKey = (n) => 'storva_pv_' + slug + '_' + n, attemptKey = (n) => 'storva_pa_' + slug + '_' + n;
  const MAX_QTY = 20;
  const $ = (s, r = document) => r.querySelector(s);
  const money = (n) => '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });

  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'text') n.textContent = v; else if (k === 'class') n.className = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v === true ? '' : v);
    }
    kids.flat().forEach((c) => { if (c != null && c !== false) n.append(c); });
    return n;
  }
  function toast(msg) { const t = $('#sf-toast'); if (!t) return; t.textContent = msg; t.style.display = 'block'; clearTimeout(toast.t); toast.t = setTimeout(() => { t.style.display = 'none'; }, 2600); }

  // ---- storage (can be unavailable in private mode: every access is guarded) ----
  const store = {
    get(area, k) { try { return window[area].getItem(k); } catch { return null; } },
    set(area, k, v) { try { window[area].setItem(k, v); } catch { /* ignore */ } },
    del(area, k) { try { window[area].removeItem(k); } catch { /* ignore */ } },
  };
  const OID = /^[a-f0-9]{24}$/i;
  const cart = {
    load() {
      let raw; try { raw = JSON.parse(store.get('localStorage', CART_KEY) || '[]'); } catch { raw = []; }
      if (!Array.isArray(raw)) return [];
      return raw.filter((i) => i && OID.test(i.productId) && (i.variantId == null || OID.test(i.variantId)) && Number.isInteger(i.qty) && i.qty >= 1)
        .map((i) => ({ productId: i.productId, variantId: i.variantId || null, qty: Math.min(MAX_QTY, i.qty) }));
    },
    save(items) { store.set('localStorage', CART_KEY, JSON.stringify(items)); cart.badge(); },
    clear() { store.del('localStorage', CART_KEY); store.del('sessionStorage', COUPON_KEY); store.del('sessionStorage', IDEM_KEY); cart.badge(); },
    add(productId, variantId, qty) {
      const items = cart.load(), hit = items.find((i) => i.productId === productId && (i.variantId || null) === (variantId || null));
      if (hit) hit.qty = Math.min(MAX_QTY, hit.qty + qty); else items.push({ productId, variantId: variantId || null, qty });
      cart.save(items);
      // Module 14: anonymous "added to cart" count for the shop's funnel (no personal data).
      try { const blob = new Blob([JSON.stringify({ type: 'cart_add', productId })], { type: 'application/json' }); if (!(navigator.sendBeacon && navigator.sendBeacon(API + '/events', blob))) fetch(API + '/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'cart_add', productId }), keepalive: true }).catch(() => {}); } catch { /* never block the cart */ }
    },
    count() { return cart.load().reduce((n, i) => n + i.qty, 0); },
    badge() { const n = cart.count(); document.querySelectorAll('[data-cart-count]').forEach((b) => { b.textContent = n > 99 ? '99+' : String(n); b.hidden = n === 0; }); },
  };
  window.addEventListener('storage', (e) => { if (e.key === CART_KEY) cart.badge(); });

  async function api(path, method, payload) {
    let res;
    try { res = await fetch(API + path, { method, headers: payload ? { 'content-type': 'application/json' } : {}, body: payload ? JSON.stringify(payload) : undefined }); }
    catch { return { network: true, status: 0, data: {} }; }
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  }
  const errMsg = (r) => (r.network ? 'Could not reach the store. Check your connection and try again.' : (r.data.error && r.data.error.message) || 'Something went wrong. Please try again.');
  const quote = (items, code, extra = {}) => api('/cart/quote', 'POST', { items, couponCode: code || undefined, ...extra }); // extra (Module 12): { address: { state, pincode }, paymentMethod }
  const STATES = ['Andaman and Nicobar Islands', 'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chandigarh', 'Chhattisgarh', 'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jammu and Kashmir', 'Jharkhand', 'Karnataka', 'Kerala', 'Ladakh', 'Lakshadweep', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Puducherry', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal'];

  // ---- every page ----
  cart.badge();
  document.querySelectorAll('select[data-autosubmit]').forEach((s) => s.addEventListener('change', () => s.form.submit()));

  // ================= product page =================
  function productPage() {
    const node = $('#product-data'); if (!node) return;
    const p = JSON.parse(node.textContent);
    const priceEl = $('#pdp-price'), cmpEl = $('#pdp-compare'), stockEl = $('#pdp-stock'), qtyEl = $('#pdp-qty'), errEl = $('#pdp-err'), addBtn = $('#pdp-add');
    const selects = [...document.querySelectorAll('[data-option]')];

    document.querySelectorAll('.sf-thumb').forEach((b) => b.addEventListener('click', () => {
      const main = $('#pdp-main'); if (!main) return;
      main.src = b.dataset.img; main.alt = b.dataset.alt;
      document.querySelectorAll('.sf-thumb').forEach((x) => x.classList.toggle('on', x === b));
    }));

    function current() {
      if (!p.hasVariants) return { variant: null, complete: true, maxQty: p.maxQty, inStock: p.inStock, price: p.price };
      const chosen = selects.map((s) => s.value), complete = chosen.every(Boolean);
      const variant = complete ? p.variants.find((v) => v.key === chosen.join('|')) || null : null;
      return { variant, complete, maxQty: variant ? variant.maxQty : p.maxQty, inStock: variant ? variant.inStock : p.inStock, price: variant ? variant.price : p.priceFrom };
    }
    function refresh() {
      const c = current();
      priceEl.textContent = money(c.price);
      if (cmpEl && !p.hasVariants && p.compareAtPrice > p.price) { cmpEl.hidden = false; cmpEl.textContent = money(p.compareAtPrice); } else if (cmpEl) cmpEl.hidden = true;
      stockEl.className = 'sf-stock';
      if (p.hasVariants && !c.complete) stockEl.textContent = '';
      else if (!c.inStock || !c.variant && p.hasVariants) { stockEl.textContent = c.variant || !p.hasVariants ? 'Out of stock' : 'This combination is not available'; stockEl.classList.add('out'); }
      else if (c.maxQty < MAX_QTY && c.maxQty <= 5) { stockEl.textContent = `Only ${c.maxQty} left`; stockEl.classList.add('low'); }
      else { stockEl.textContent = 'In stock'; stockEl.classList.add('in'); }
      const ok = c.inStock && (!p.hasVariants || (c.complete && c.variant));
      addBtn.disabled = !ok && (!p.hasVariants || c.complete);
      qtyEl.max = String(Math.max(1, c.maxQty)); clampQty();
      errEl.textContent = '';
    }
    function clampQty() { const c = current(); let n = parseInt(qtyEl.value, 10); if (!Number.isFinite(n) || n < 1) n = 1; qtyEl.value = String(Math.min(n, Math.max(1, c.maxQty))); }
    selects.forEach((s) => s.addEventListener('change', refresh));
    $('#qty-minus').addEventListener('click', () => { qtyEl.value = String((parseInt(qtyEl.value, 10) || 1) - 1); clampQty(); });
    $('#qty-plus').addEventListener('click', () => { qtyEl.value = String((parseInt(qtyEl.value, 10) || 1) + 1); clampQty(); });
    qtyEl.addEventListener('change', clampQty);
    addBtn.addEventListener('click', () => {
      const c = current();
      if (p.hasVariants && !c.complete) { errEl.textContent = 'Please choose ' + selects.filter((s) => !s.value).map((s) => s.dataset.option.toLowerCase()).join(' and ') + '.'; return; }
      if (p.hasVariants && !c.variant) { errEl.textContent = 'This combination is not available.'; return; }
      if (!c.inStock) { errEl.textContent = 'Sorry, this item is out of stock.'; return; }
      clampQty();
      cart.add(p.id, c.variant ? c.variant.id : null, parseInt(qtyEl.value, 10));
      toast('Added to cart');
    });
    refresh();
  }

  // ================= cart page =================
  const summary = (q, { withCoupon, onCoupon }) => {
    const rows = [el('div', {}, el('dt', { text: 'Subtotal' }), el('dd', { text: money(q.subtotal) }))];
    if (q.discount > 0) rows.push(el('div', { class: 'disc' }, el('dt', { text: 'Discount' + (q.coupon && q.coupon.valid ? ' (' + q.coupon.code + ')' : '') }), el('dd', { text: '−' + money(q.discount) })));
    // Module 12: delivery by region, cash-on-delivery fee and GST, exactly as the server calculated them.
    const shipText = q.needsAddress ? (q.shippingFrom > 0 ? 'From ' + money(q.shippingFrom) : 'Calculated at checkout') : q.shipping > 0 ? money(q.shipping) : 'Free';
    rows.push(el('div', {}, el('dt', { text: 'Shipping' + (q.zone ? ' (' + q.zone + ')' : '') }), el('dd', { text: shipText })));
    if (q.codFee > 0) rows.push(el('div', {}, el('dt', { text: 'Cash on delivery fee' }), el('dd', { text: money(q.codFee) })));
    if (q.tax > 0 && !q.taxInclusive) rows.push(el('div', {}, el('dt', { text: 'GST' }), el('dd', { text: money(q.tax) })));
    rows.push(el('div', { class: 'tot' }, el('dt', { text: 'Total' }), el('dd', { text: money(q.total) })));
    if (q.tax > 0 && q.taxInclusive) rows.push(el('div', { class: 'small muted' }, el('dt', { text: 'Includes GST' }), el('dd', { text: money(q.tax) })));
    const left = q.freeShippingAbove ? Math.round((q.freeShippingAbove - (q.subtotal - q.discount)) * 100) / 100 : 0;
    if (left > 0) rows.push(el('div', { class: 'sf-hint' }, el('dt', { text: `Add ${money(left)} more for free delivery 🚚` })));
    if (q.etaDays) rows.push(el('div', { class: 'small muted' }, el('dt', { text: `Delivery in about ${q.etaDays} days` })));
    const nodes = [];
    if (withCoupon) {
      const input = el('input', { type: 'text', id: 'coupon', placeholder: 'Coupon code', maxlength: '20', autocomplete: 'off', 'aria-label': 'Coupon code' });
      input.value = store.get('sessionStorage', COUPON_KEY) || '';
      const apply = el('button', { class: 'sf-btn sf-btn-g', type: 'button', text: q.coupon && q.coupon.valid ? 'Remove' : 'Apply', onclick: () => onCoupon(q.coupon && q.coupon.valid ? '' : input.value.trim()) });
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); onCoupon(input.value.trim()); } });
      if (q.coupon && q.coupon.valid) input.readOnly = true;
      nodes.push(el('div', { class: 'sf-coupon' }, input, apply));
      if (q.coupon) nodes.push(el('p', { class: 'sf-cmsg ' + (q.coupon.valid ? 'ok' : 'bad'), text: q.coupon.message, role: 'status' }));
    }
    nodes.push(el('dl', { class: 'sf-sum' }, rows));
    return nodes;
  };

  async function cartPage() {
    const root = $('#cart-root');
    async function draw() {
      const items = cart.load();
      if (!items.length) {
        root.replaceChildren(el('div', { class: 'sf-empty', style: 'grid-column:1/-1' }, el('h2', { text: 'Your cart is empty' }), el('p', { class: 'muted', text: 'Add something you like and it will show up here.' }), el('a', { class: 'sf-btn sf-btn-p', href: '/store/' + slug, text: 'Start shopping' })));
        return;
      }
      const code = store.get('sessionStorage', COUPON_KEY) || '';
      const r = await quote(items, code);
      if (!r.ok) { root.replaceChildren(el('p', { class: 'err', text: errMsg(r) }), el('button', { class: 'sf-btn', type: 'button', text: 'Try again', onclick: draw })); return; }
      const q = r.data;
      if (q.coupon && !q.coupon.valid) store.del('sessionStorage', COUPON_KEY);

      const list = el('section', { class: 'sf-box' }, el('h2', { text: `Items (${items.reduce((n, i) => n + i.qty, 0)})` }));
      q.lines.forEach((l) => {
        const idx = items.findIndex((i) => i.productId === l.productId && (i.variantId || null) === (l.variantId || null));
        const setQty = (n) => { const all = cart.load(); const it = all[idx]; if (!it) return; it.qty = Math.max(1, Math.min(MAX_QTY, l.maxQty || MAX_QTY, n)); cart.save(all); draw(); };
        const remove = () => { const all = cart.load(); all.splice(idx, 1); cart.save(all); draw(); };
        const qtyInput = el('input', { type: 'number', min: '1', max: String(MAX_QTY), value: String(l.qty), inputmode: 'numeric', 'aria-label': 'Quantity for ' + l.title });
        qtyInput.addEventListener('change', () => setQty(parseInt(qtyInput.value, 10) || 1));
        list.append(el('div', { class: 'sf-line' },
          el('span', { class: 'sf-thumb-s' }, l.image ? el('img', { src: l.image, alt: '', loading: 'lazy' }) : null),
          el('div', { class: 'grow' },
            l.slug ? el('a', { href: `/store/${slug}/product/${encodeURIComponent(l.slug)}`, text: l.title, style: 'font-weight:700;text-decoration:none' }) : el('b', { text: l.title }),
            l.variantLabel ? el('div', { class: 'muted small', text: l.variantLabel }) : null,
            l.ok ? el('div', { class: 'muted small', text: money(l.unitPrice) + ' each' }) : null,
            !l.ok ? el('div', { class: 'bad', text: l.problem, role: 'alert' }) : null),
          el('div', { class: 'sf-line-end' },
            l.ok || l.maxQty > 0 ? el('div', { class: 'sf-qty' }, el('button', { type: 'button', text: '−', 'aria-label': 'Decrease quantity', onclick: () => setQty(l.qty - 1) }), qtyInput, el('button', { type: 'button', text: '+', 'aria-label': 'Increase quantity', onclick: () => setQty(l.qty + 1) })) : null,
            l.ok ? el('b', { text: money(l.lineTotal) }) : null,
            el('button', { class: 'sf-rm', type: 'button', text: 'Remove', onclick: remove }))));
      });
      const side = el('aside', { class: 'sf-box sf-sticky' }, el('h2', { text: 'Order summary' }),
        ...summary(q, { withCoupon: true, onCoupon: (c) => { if (c) store.set('sessionStorage', COUPON_KEY, c.toUpperCase()); else store.del('sessionStorage', COUPON_KEY); draw(); } }),
        q.canCheckout ? el('a', { class: 'sf-btn sf-btn-p sf-wide', href: `/store/${slug}/checkout`, text: 'Proceed to checkout' }) : el('p', { class: 'err', text: 'Fix the items marked above to continue.' }),
        el('a', { class: 'sf-btn sf-btn-g sf-wide', href: '/store/' + slug, text: 'Continue shopping' }));
      root.replaceChildren(list, side);
    }
    draw();
  }

  // ================= online payment (Module 6) =================
  const RZP_SRC = 'https://checkout.razorpay.com/v1/checkout.js';
  let rzpLoading = null;
  // Razorpay's script is only fetched when the shopper is actually paying online (never for COD or browsing).
  function loadRazorpay() {
    if (window.Razorpay) return Promise.resolve();
    if (!rzpLoading) {
      rzpLoading = new Promise((resolve, reject) => {
        const s = document.createElement('script'); s.src = RZP_SRC; s.async = true;
        s.onload = () => { if (window.Razorpay) resolve(); else { rzpLoading = null; reject(new Error('missing')); } };
        s.onerror = () => { rzpLoading = null; s.remove(); reject(new Error('blocked')); };
        document.head.append(s);
      });
    }
    return rzpLoading;
  }
  const go = (url) => { location.href = url; };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const flash = { set: (m) => store.set('sessionStorage', FLASH_KEY, m), take() { const m = store.get('sessionStorage', FLASH_KEY); store.del('sessionStorage', FLASH_KEY); return m; } };
  const definiteNo = (r) => Boolean(r.status) && r.status < 500 && r.status !== 429; // the server answered and refused (as opposed to being unreachable / busy)
  const pbtn = (text, fn, primary) => el('button', { class: 'sf-btn ' + (primary ? 'sf-btn-p' : 'sf-btn-g'), type: 'button', text, onclick: fn });

  // Full-screen status layer: "opening payment", "confirming", and the failure / pending states that need a decision.
  const overlay = {
    node: null,
    show({ title, text, busy, actions }) {
      if (!overlay.node) { overlay.node = el('div', { class: 'sf-pay-ov', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'pay-ov-t', 'aria-describedby': 'pay-ov-d' }); document.body.append(overlay.node); }
      const card = el('div', { class: 'sf-pay-card', tabindex: '-1' }, busy ? el('div', { class: 'sf-spin', 'aria-hidden': 'true' }) : null,
        el('h2', { id: 'pay-ov-t', text: title }), el('p', { id: 'pay-ov-d', class: 'muted', text }),
        actions && actions.length ? el('div', { class: 'sf-pay-actions' }, actions) : null);
      overlay.node.replaceChildren(card); overlay.node.hidden = false;
      (card.querySelector('button') || card).focus();
    },
    hide() { if (overlay.node) overlay.node.hidden = true; },
  };

  // Hands Razorpay's proof (order id, payment id, signature) to OUR server. Only the server's answer can mark the order paid.
  async function confirmPayment(o, proof) {
    store.set('sessionStorage', pvKey(o.orderNumber), JSON.stringify(proof)); // lets the order page finish the job if this tab is closed mid-way
    overlay.show({ title: 'Confirming your payment…', text: 'Please keep this page open and do not pay again.', busy: true });
    let r;
    for (let i = 0; i < 3; i++) {
      r = await api(`/orders/${o.orderNumber}/payment/verify`, 'POST', { token: o.token, ...proof });
      if (r.ok || definiteNo(r)) break;
      if (i < 2) await wait(1500 * (i + 1));
    }
    if (r.ok) { store.del('sessionStorage', pvKey(o.orderNumber)); flash.set('Payment received. Thank you!'); return go(o.url); }
    if (definiteNo(r)) {
      store.del('sessionStorage', pvKey(o.orderNumber));
      return overlay.show({ title: 'We could not confirm this payment', text: errMsg(r), actions: [pbtn('View my order', () => go(o.url), true)] });
    }
    // Unreachable or busy: the money may well have moved, so this is "pending", never "failed".
    overlay.show({ title: 'Still confirming your payment', text: 'We could not reach the server just now. If money was deducted, your order will be marked as paid as soon as we can confirm it. Please do not pay again.',
      actions: [pbtn('Check again', () => confirmPayment(o, proof), true), pbtn('View my order', () => go(o.url))] });
  }

  // o = { orderNumber, token, url }. Creates the Razorpay order on the server (amount comes from the database), opens Checkout, then verifies.
  async function payOnline(o) {
    overlay.show({ title: 'Opening secure payment…', text: 'Please wait a moment.', busy: true });
    const r = await api(`/orders/${o.orderNumber}/payment`, 'POST', { token: o.token });
    if (!r.ok) {
      const code = r.data.error && r.data.error.code;
      if (code === 'already_paid') { flash.set('This order is already paid.'); return go(o.url); }
      const retry = code !== 'payments_unavailable' && (!definiteNo(r) || r.status === 429); // a switched-off gateway will not fix itself in a second
      return overlay.show({ title: code === 'payments_unavailable' ? 'Online payment is unavailable' : 'We could not start the payment', text: errMsg(r),
        actions: [retry ? pbtn('Try again', () => payOnline(o), true) : null, pbtn('View my order', () => go(o.url), !retry)].filter(Boolean) });
    }
    try { await loadRazorpay(); } catch {
      return overlay.show({ title: 'Secure payment window could not load', text: 'Check your internet connection, and turn off any ad blocker for this page, then try again.', actions: [pbtn('Try again', () => payOnline(o), true), pbtn('View my order', () => go(o.url))] });
    }
    const p = r.data.payment;
    let settled = false, failure = '';
    try {
      const rzp = new window.Razorpay({
        key: p.keyId, order_id: p.razorpayOrderId, amount: p.amount, currency: p.currency, name: p.name, description: p.description, prefill: p.prefill,
        theme: { color: '#6C4CF5' }, retry: { enabled: true },
        handler: (resp) => { settled = true; confirmPayment(o, { razorpay_order_id: resp.razorpay_order_id, razorpay_payment_id: resp.razorpay_payment_id, razorpay_signature: resp.razorpay_signature }); },
        modal: { confirm_close: true, ondismiss: () => {
          if (settled) return; settled = true;
          flash.set(failure ? `The payment failed (${failure}). Your order is saved, you can try again below.` : 'The payment was not completed. Your order is saved, you can pay again below.');
          go(o.url);
        } },
      });
      rzp.on('payment.failed', (resp) => { failure = String((resp && resp.error && resp.error.description) || 'the payment could not be completed').slice(0, 160); });
      store.set('sessionStorage', attemptKey(o.orderNumber), '1');
      overlay.hide(); rzp.open();
    } catch {
      overlay.show({ title: 'We could not open the payment window', text: 'Please try again.', actions: [pbtn('Try again', () => payOnline(o), true), pbtn('View my order', () => go(o.url))] });
    }
  }

  // ================= order page: pending / failed / paid states for online orders =================
  function orderPage() {
    try { localStorage.removeItem(CART_KEY); } catch (e) { /* storage blocked: nothing to clear */ } // the order is placed; moved here from an inline <script> so the storefront CSP needs no inline script
    const box = $('#pay-box'); if (!box) return; // cash-on-delivery orders have nothing to do here
    const n = Number(box.dataset.order), token = new URLSearchParams(location.search).get('t') || '';
    const o = { orderNumber: n, token, url: location.pathname + location.search };
    const state = box.dataset.state, msg = $('#pay-msg');
    const say = (m) => { if (msg) msg.textContent = m; };
    const f = flash.take(); if (f) say(f);

    if (state === 'paid' || state === 'refunded') { store.del('sessionStorage', pvKey(n)); store.del('sessionStorage', attemptKey(n)); return; }
    const payBtn = $('#pay-now'); if (payBtn) payBtn.addEventListener('click', () => payOnline(o));

    async function check(manual) {
      const r = await api(`/orders/${n}?t=${encodeURIComponent(token)}`, 'GET');
      if (r.ok && r.data.order && r.data.order.paymentStatus !== state) { location.reload(); return true; }
      if (manual) say(r.ok ? 'Still waiting for the bank to confirm. This can take a minute. If money was deducted, please do not pay again.' : errMsg(r));
      return false;
    }
    const refresh = $('#pay-refresh');
    if (refresh) refresh.addEventListener('click', async () => { refresh.disabled = true; say('Checking…'); await check(true); refresh.disabled = false; });

    const pv = store.get('sessionStorage', pvKey(n));
    let proof = null; try { proof = pv ? JSON.parse(pv) : null; } catch { proof = null; }
    if (proof && proof.razorpay_order_id) { confirmPayment(o, proof); return; } // a payment finished but the confirmation was interrupted: finish it now
    if (state === 'pending' && store.get('sessionStorage', attemptKey(n))) { // the shopper just tried to pay: watch briefly for the result
      let tries = 0; const t = setInterval(async () => { if ((await check(false)) || ++tries >= 12) clearInterval(t); }, 5000);
    }
  }

  // ================= checkout page =================
  async function checkoutPage() {
    const root = $('#checkout-root');
    const items = cart.load();
    if (!items.length) { root.replaceChildren(el('div', { class: 'sf-empty', style: 'grid-column:1/-1' }, el('h2', { text: 'Your cart is empty' }), el('a', { class: 'sf-btn sf-btn-p', href: '/store/' + slug, text: 'Start shopping' }))); return; }
    const code = store.get('sessionStorage', COUPON_KEY) || '';
    const r = await quote(items, code);
    if (!r.ok) { root.replaceChildren(el('p', { class: 'err', text: errMsg(r) })); return; }
    let q = r.data;
    if (q.lines.some((l) => !l.ok) || !q.lines.length) { location.replace(`/store/${slug}/cart`); return; }

    // Payment method: online (Razorpay: UPI, cards, net banking) is offered only when the server has Razorpay configured.
    const onlineOk = root.dataset.online === '1' && q.total >= 1;
    let method = onlineOk ? 'razorpay' : 'cod';
    const NOTES = { razorpay: 'You will pay in Razorpay\u2019s secure window. Your card, UPI or bank details never reach this store.', cod: 'Payment: cash on delivery. You pay when your order arrives.' };
    const opt = (value, title, sub) => {
      const input = el('input', { type: 'radio', name: 'paymentMethod', value, id: 'pm-' + value }); input.checked = value === method;
      return el('label', { class: 'sf-pay-opt', for: 'pm-' + value }, input, el('span', { class: 'grow' }, el('b', { text: title }), el('span', { class: 'muted small', text: sub })));
    };
    const methodBox = onlineOk ? el('fieldset', { class: 'sf-pay-methods' }, el('legend', { text: 'Payment method' }),
      opt('razorpay', 'Pay online', 'UPI, debit card, credit card or net banking'), opt('cod', 'Cash on delivery', 'Pay in cash when your order arrives'),
      el('div', { class: 'err', id: 'paymentMethod-err', role: 'alert' })) : null;

    const field = (id, label, o = {}) => el('div', {}, el('label', { for: id, text: label }),
      o.area ? el('textarea', { id, name: id, maxlength: o.max, autocomplete: o.ac }) : el('input', { id, name: id, type: o.type || 'text', maxlength: o.max, autocomplete: o.ac, inputmode: o.mode, placeholder: o.ph || '' }),
      el('div', { class: 'err', id: id + '-err', role: 'alert' }));
    const stateField = () => { const sel = el('select', { id: 'state', name: 'state', autocomplete: 'address-level1' }, el('option', { value: '', text: 'Choose your state' }), ...STATES.map((x) => el('option', { value: x, text: x }))); return el('div', {}, el('label', { for: 'state', text: 'State' }), sel, el('div', { class: 'err', id: 'state-err', role: 'alert' })); };
    const gstBox = q.tax > 0 ? el('details', { class: 'sf-gst' }, el('summary', { text: 'Buying for a business? Add your GSTIN' }), field('gstin', 'GSTIN (optional)', { max: '15', ph: '32ABCDE1234F1Z5' })) : null;
    const form = el('form', { class: 'sf-box sf-form', novalidate: '' },
      el('h2', { text: 'Delivery details' }),
      field('name', 'Full name', { ac: 'name', max: '80' }),
      el('div', { class: 'two' }, field('phone', 'Mobile number', { type: 'tel', ac: 'tel-national', mode: 'numeric', ph: '9876543210', max: '16' }), field('email', 'Email (optional)', { type: 'email', ac: 'email', max: '254' })),
      field('line1', 'Address', { ac: 'address-line1', max: '200' }), field('line2', 'Apartment, landmark (optional)', { ac: 'address-line2', max: '200' }),
      el('div', { class: 'two' }, field('city', 'City', { ac: 'address-level2', max: '60' }), stateField()),
      field('pincode', 'PIN code', { mode: 'numeric', ac: 'postal-code', max: '6', ph: '560001' }),
      field('note', 'Order note (optional)', { area: true, max: '300' }),
      gstBox,
      methodBox,
      el('p', { class: 'err', id: 'ship-problem', role: 'alert' }),
      el('div', { class: 'sf-note', id: 'pay-note', text: NOTES[method] }),
      el('div', { class: 'err', id: 'form-err', role: 'alert' }),
      el('button', { class: 'sf-btn sf-btn-p sf-wide', type: 'submit', id: 'place', text: 'Place order · ' + money(q.total) }));
    const sumBox = el('div', {}, ...summary(q, { withCoupon: false }));
    const side = el('aside', { class: 'sf-box sf-sticky' }, el('h2', { text: 'Order summary' }),
      ...q.lines.map((l) => el('div', { class: 'sf-line' }, el('span', { class: 'sf-thumb-s' }, l.image ? el('img', { src: l.image, alt: '' }) : null), el('span', { class: 'grow' }, el('b', { text: l.title }), l.variantLabel ? el('div', { class: 'muted small', text: l.variantLabel }) : null, el('div', { class: 'muted small', text: `${money(l.unitPrice)} × ${l.qty}` })), el('b', { text: money(l.lineTotal) }))),
      sumBox,
      q.coupon && !q.coupon.valid ? el('p', { class: 'err', text: q.coupon.message }) : null,
      el('a', { class: 'small', href: `/store/${slug}/cart`, text: '← Edit cart or coupon' }));
    root.replaceChildren(form, side);

    const placeBtn = $('#place');
    const refreshMethod = () => {
      placeBtn.textContent = method === 'razorpay' ? 'Pay ' + money(q.total) + ' securely' : 'Place order · ' + money(q.total);
      $('#pay-note').textContent = NOTES[method];
      form.querySelectorAll('.sf-pay-opt').forEach((l) => l.classList.toggle('on', l.querySelector('input').checked));
    };
    // Module 12: re-price when the state, PIN code or payment method changes (shipping region, COD fee, GST, COD availability).
    let rq = 0, rqTimer = null;
    const requote = async () => {
      const mine = ++rq, st = form.querySelector('#state').value, pin = form.querySelector('#pincode').value.trim();
      const res = await quote(cart.load(), code, { address: { state: st, pincode: /^[1-9]\d{5}$/.test(pin) ? pin : '' }, paymentMethod: method });
      if (mine !== rq || !res.ok) return;
      q = res.data; q.cod = q.cod || { available: true, reason: null, fee: 0 }; if (q.serviceable === undefined) q.serviceable = true; // tolerate an older server's quote
      sumBox.replaceChildren(...summary(q, { withCoupon: false }));
      const codInput = form.querySelector('#pm-cod');
      if (codInput) { codInput.disabled = !q.cod.available; const sub = codInput.closest('label').querySelector('.muted'); sub.textContent = q.cod.available ? (q.cod.fee > 0 ? `Pay in cash when your order arrives (+${money(q.cod.fee)} fee)` : 'Pay in cash when your order arrives') : q.cod.reason; if (!q.cod.available && method === 'cod' && onlineOk) { form.querySelector('#pm-razorpay').checked = true; method = 'razorpay'; return requote(); } }
      $('#ship-problem').textContent = q.serviceable ? (!onlineOk && !q.cod.available ? q.cod.reason : '') : q.problem;
      placeBtn.disabled = !q.serviceable || (!onlineOk && !q.cod.available);
      refreshMethod();
    };
    const scheduleQuote = () => { clearTimeout(rqTimer); rqTimer = setTimeout(requote, 250); };
    form.querySelector('#state').addEventListener('change', scheduleQuote);
    form.querySelector('#pincode').addEventListener('input', () => { if (/^[1-9]\d{5}$/.test(form.querySelector('#pincode').value.trim())) scheduleQuote(); });
    form.querySelectorAll('input[name=paymentMethod]').forEach((i) => i.addEventListener('change', () => { method = i.value; refreshMethod(); scheduleQuote(); if (method === 'razorpay') loadRazorpay().catch(() => {}); }));
    refreshMethod(); requote();
    if (method === 'razorpay') loadRazorpay().catch(() => {}); // warm up so the payment window opens instantly; a failure is reported only when the shopper pays

    const IDS = ['name', 'phone', 'email', 'line1', 'line2', 'city', 'state', 'pincode', 'note', 'gstin'];
    const clearErrors = () => { form.querySelectorAll('.err').forEach((n) => { n.textContent = ''; }); form.querySelectorAll('.bad-in').forEach((n) => n.classList.remove('bad-in')); };
    const idemKey = () => { let k = store.get('sessionStorage', IDEM_KEY); if (!k) { const a = new Uint8Array(16); crypto.getRandomValues(a); k = [...a].map((b) => b.toString(16).padStart(2, '0')).join(''); store.set('sessionStorage', IDEM_KEY, k); } return k; };

    form.addEventListener('submit', async (ev) => {
      ev.preventDefault(); clearErrors();
      const v = (id) => form.querySelector('#' + id).value.trim();
      const btn = $('#place'); btn.disabled = true; const label = btn.textContent; btn.textContent = 'Placing your order…';
      const res = await api('/orders', 'POST', {
        items: cart.load(), paymentMethod: method, couponCode: store.get('sessionStorage', COUPON_KEY) || undefined, idempotencyKey: idemKey(),
        name: v('name'), phone: v('phone'), email: v('email'), note: v('note'), gstin: form.querySelector('#gstin') ? v('gstin') : undefined,
        address: { line1: v('line1'), line2: v('line2'), city: v('city'), state: v('state'), pincode: v('pincode') },
      });
      if (res.ok) {
        const { order, token, url } = res.data; cart.clear(); // the order exists now; a payment problem is retried from the order page, never by placing a second order
        // Decide from what the SERVER saved (a replayed request returns the original order), not from the form.
        if (order.paymentMethod === 'razorpay' && order.paymentStatus !== 'paid') return payOnline({ orderNumber: order.orderNumber, token, url });
        location.href = url; return;
      }
      btn.disabled = false; btn.textContent = label;
      if (!res.network) store.del('sessionStorage', IDEM_KEY); // a definite answer from the server: the next attempt is a new order
      const e = res.data.error || {};
      if (res.status === 400 && e.fields) {
        let first = null;
        Object.entries(e.fields).forEach(([k, m]) => { const n = form.querySelector('#' + k + '-err'); const inp = form.querySelector('#' + k); if (n) { n.textContent = m; if (inp) inp.classList.add('bad-in'); first = first || inp; } else { $('#form-err').textContent = m; } });
        if (first) first.focus();
      } else if (res.status === 409) {
        $('#form-err').textContent = e.message || 'Some items changed.';
        toast('Your cart changed. Please review it.'); setTimeout(() => { location.href = `/store/${slug}/cart`; }, 1800);
      } else $('#form-err').textContent = errMsg(res);
    });
  }

  if (page === 'product') productPage();
  else if (page === 'cart') cartPage();
  else if (page === 'checkout') checkoutPage();
  else if (page === 'order') orderPage();
})();
