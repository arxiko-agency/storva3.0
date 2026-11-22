'use strict';
// Module 10: WhatsApp tab – how to use the STORVA assistant, own-number connection (Pro), recent chats, QR code and catalogue share kit.
// Loaded before dashboard.js (uses its helpers at call time). All text via textContent.
const WA_COMMANDS = [
  ['HELP', 'Show this list in WhatsApp'], ['ORDERS', 'Latest open orders'], ['ORDER 1042', 'Full details of one order'],
  ['CONFIRM 1042', 'Confirm an order (customer is told)'], ['SHIP 1042 DTDC AB123', 'Mark shipped with courier + tracking'], ['DELIVER 1042', 'Mark delivered'],
  ['CANCEL 1042', 'Cancel and return the stock'], ['PAID 1042', 'Cash on delivery received'], ['STOCK <name/SKU> 12', 'Set stock'], ['PRICE <name/SKU> 499', 'Change a price'],
  ['LOW', 'Products running low'], ['SALES', 'Today and this week'], ['LINK', 'Your store link + QR'], ['📷 photo + "Saree 1299"', 'Add a draft product (every plan)'],
];

async function whatsappView() {
  const W = await API(base() + '/whatsapp');
  const out = [el('div', { class: 'head' }, el('h1', { text: 'WhatsApp' }))];

  // --- assistant ---
  const num = W.commandNumber;
  const assistant = el('div', { class: 'card' }, el('h2', { text: '🤖 Run your shop from WhatsApp' }),
    num ? el('p', {}, 'Save ', el('b', { text: '+' + num }), ' in your phone and message it from ', el('b', { text: '+' + (ME && ME.phone ? ME.phone : 'your account number') }), '. Try sending ', el('b', { text: 'HELP' }), '.')
      : el('p', { class: 'muted', text: W.platform.configured ? 'The STORVA WhatsApp number is active.' : 'The STORVA WhatsApp number is not set up on this server yet (WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID).' }),
    num ? el('a', { class: 'btn-link', href: `https://wa.me/${num}?text=HELP`, target: '_blank', rel: 'noopener', text: 'Open WhatsApp' }) : null,
    !W.features.commands ? upgradeNote('Order, stock and sales commands are part of Pro. Photo upload works on every plan.', 'whatsappCommands') : null,
    el('dl', { class: 'cmd-list', style: 'margin-top:14px' }, ...WA_COMMANDS.flatMap(([c, d]) => [el('dt', { text: c }), el('dd', { text: d })])),
    el('p', { class: 'muted small', text: 'Malayalam works too: സഹായം, ഓർഡറുകൾ, സ്റ്റോക്ക്, വില, വിൽപ്പന.' }));
  out.push(assistant);

  // --- sending number ---
  const sendFrom = W.sendingFrom === 'own' ? `Your own number ${W.own.displayPhone}` : W.sendingFrom === 'platform' ? `The STORVA number${num ? ' +' + num : ''}` : 'Not configured';
  const conn = el('div', { class: 'card' }, el('h2', { text: '📤 Customer messages are sent from' }),
    el('p', {}, el('span', { class: 'status-dot ' + (W.sendingFrom === 'none' ? 'warn' : 'on') }), el('b', { text: sendFrom })),
    el('p', { class: 'muted small', text: W.features.notifications ? 'Order confirmations, shipping updates and refunds are sent automatically. Choose which in Notifications.' : 'Automatic WhatsApp messages to customers are part of Pro. Emails are sent on every plan.' }),
    !W.features.notifications ? upgradeNote('Send order updates to customers on WhatsApp with Pro.', 'whatsappNotifications') : null);
  if (W.features.ownNumber) {
    if (W.own) {
      const hook = W.own.webhook;
      conn.append(el('div', { class: 'row-item' }, el('div', { class: 'grow' }, el('b', { text: W.own.verifiedName || 'Connected number' }), el('div', { class: 'muted small', text: `${W.own.displayPhone} · ID ${W.own.phoneNumberId}` })),
        el('button', { class: 'btn-ghost', type: 'button', text: 'Disconnect', onclick: async () => { if (!confirm('Disconnect your number? Messages will go from the STORVA number.')) return; await API(base() + '/whatsapp/connection', { method: 'DELETE' }); toast('Disconnected'); render(); } })),
      el('details', {}, el('summary', { text: 'Receive replies on your own number (webhook)' }),
        el('p', { class: 'small muted', text: 'In Meta → WhatsApp → Configuration, set the callback URL and verify token below and subscribe to "messages". Then customers who write to your number get an automatic reply with your store link.' }),
        field('hookUrl', 'Callback URL', { value: hook.url }), field('hookToken', 'Verify token', { value: hook.verifyToken }),
        el('p', { class: 'small ' + (hook.appSecretSaved ? 'ok' : 'err'), text: hook.appSecretSaved ? 'App secret saved ✓ (needed to check that messages really come from Meta)' : 'Add your App secret (reconnect below) to receive messages.' })));
    }
    const f = el('form', {}, el('h3', { text: W.own ? 'Update connection' : 'Use your own WhatsApp Business number', style: 'font-size:15px;margin:16px 0 0' }),
      el('p', { class: 'muted small', text: 'From Meta Business → WhatsApp → API setup. Use a permanent system-user token. Your token is stored encrypted.' }),
      el('div', { class: 'grid3' }, field('phoneNumberId', 'Phone number ID', { value: W.own ? W.own.phoneNumberId : '' }), field('wabaId', 'WhatsApp Business Account ID (optional)')),
      field('accessToken', 'Access token', { type: 'password' }), field('appSecret', 'App secret (optional, for replies)', { type: 'password' }),
      el('button', { class: 'btn', type: 'submit', text: W.own ? 'Save' : 'Connect number' }));
    f.addEventListener('submit', async (ev) => {
      ev.preventDefault(); const b = f.querySelector('button[type=submit]'); b.disabled = true; b.textContent = 'Checking with WhatsApp…';
      try { await API(base() + '/whatsapp/connection', { method: 'PUT', body: { phoneNumberId: val(f, 'phoneNumberId'), wabaId: val(f, 'wabaId'), accessToken: val(f, 'accessToken'), appSecret: val(f, 'appSecret') } }); toast('WhatsApp number connected'); render(); }
      catch (e) { showErrors(f, e); b.disabled = false; b.textContent = W.own ? 'Save' : 'Connect number'; }
    });
    conn.append(W.own ? el('details', {}, el('summary', { text: 'Change details' }), f) : f);
  }
  out.push(conn);

  // --- QR + share kit ---
  const qr = el('div', { class: 'card' }, el('h2', { text: '🔳 Your store QR code' }),
    el('div', { class: 'qr' }, el('img', { src: W.qrUrl, alt: 'QR code for your store link', width: '140', height: '140' }),
      el('div', {}, el('p', { class: 'small', text: 'Print it on bills, bags and your shop counter. Customers scan it to open your store.' }), el('p', { class: 'small' }, el('a', { class: 'link', href: W.storeLink, target: '_blank', rel: 'noopener', text: W.storeLink })),
        el('div', { class: 'row', style: 'flex-wrap:wrap' }, el('a', { class: 'btn-link', href: W.qrUrl + '?download=1', text: 'Download QR' }),
          el('button', { class: 'btn-ghost', type: 'button', text: 'Copy link', onclick: () => navigator.clipboard.writeText(W.storeLink).then(() => toast('Link copied')) })))));
  out.push(qr);

  const share = el('div', { class: 'card' }, el('h2', { text: '📣 Share products on WhatsApp' }), el('p', { class: 'muted small', text: 'Pick up to 10 published products. We write a ready message with prices and links for your status, groups or broadcast list.' }));
  const pick = el('div', { class: 'share-pick' }, el('p', { class: 'muted small', text: 'Loading products…' }));
  const intro = el('input', { type: 'text', placeholder: 'Intro line (optional), e.g. Onam offers are here! 🌼', maxlength: '200', 'aria-label': 'Intro line' });
  const preview = el('div');
  share.append(pick, el('div', { style: 'margin-top:10px' }, intro), el('button', { class: 'btn', type: 'button', text: 'Create message', onclick: async () => {
    const ids = [...pick.querySelectorAll('input:checked')].map((i) => i.value);
    if (!ids.length) { toast('Choose at least one product'); return; }
    if (ids.length > 10) { toast('Choose up to 10 products'); return; }
    try {
      const r = await API(base() + '/whatsapp/share', { method: 'POST', body: { productIds: ids, intro: intro.value } });
      preview.replaceChildren(el('div', { class: 'preview-text', style: 'margin-top:12px', text: r.text }), el('div', { class: 'row', style: 'margin-top:8px;flex-wrap:wrap' },
        el('a', { class: 'btn-link', href: r.shareUrl, target: '_blank', rel: 'noopener', text: 'Send on WhatsApp' }), el('button', { class: 'btn-ghost', type: 'button', text: 'Copy text', onclick: () => navigator.clipboard.writeText(r.text).then(() => toast('Copied')) })));
    } catch (e) { toast(e.message); }
  } }), preview);
  API(base() + '/products?status=active&limit=50').then((r) => {
    pick.replaceChildren(...(r.products.length ? r.products.map((p) => el('label', {}, el('input', { type: 'checkbox', value: p.id }), `${p.title} · ${inr(p.price)}`)) : [el('p', { class: 'muted small', text: 'Publish a product first (set it to Active).' })]));
  }).catch(() => pick.replaceChildren(el('p', { class: 'err', text: 'Could not load products.' })));
  out.push(share);

  // --- recent conversations ---
  const chat = el('div', { class: 'chat' }, ...(W.recent.length ? W.recent.slice().reverse().flatMap((m) => [
    el('div', { class: 'bubble in' }, m.text || `[${m.type}]`, el('span', { class: 'meta', text: `${m.from} · ${new Date(m.at).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })}` })),
    m.reply ? el('div', { class: 'bubble out' }, m.reply, el('span', { class: 'meta', text: 'STORVA' })) : null]) : [el('p', { class: 'muted small', text: 'No WhatsApp messages yet.' })]));
  out.push(el('div', { class: 'card' }, el('h2', { text: '💬 Recent WhatsApp messages' }), chat));
  return out;
}
