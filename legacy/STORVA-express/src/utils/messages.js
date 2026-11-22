'use strict';
// Modules 10 + 13: every customer- and owner-facing message, for email (subject/text/html) and WhatsApp (approved template + text
// fallback). Pure functions, unit-tested. All dynamic text is HTML-escaped in emails. WhatsApp template names are configurable
// (WA_TPL_*), and the exact template bodies to submit to Meta are in docs/WHATSAPP_TEMPLATES.md (same parameter order as below).
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inr = (paise) => '₹' + (Number(paise || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: paise % 100 ? 2 : 0, maximumFractionDigits: 2 });
const lang = () => process.env.WA_TEMPLATE_LANG || 'en';
const TPL = {
  orderConfirmed: () => process.env.WA_TPL_ORDER_CONFIRMED || 'storva_order_confirmed',
  orderUpdate: () => process.env.WA_TPL_ORDER_UPDATE || 'storva_order_update',
  refund: () => process.env.WA_TPL_REFUND || 'storva_refund_processed',
  newOrder: () => process.env.WA_TPL_NEW_ORDER || 'storva_new_order',
  lowStock: () => process.env.WA_TPL_LOW_STOCK || 'storva_low_stock',
};
const STATUS_TEXT = {
  pending: 'received', confirmed: 'confirmed and being prepared', shipped: 'on its way', delivered: 'delivered', cancelled: 'cancelled',
};
const firstName = (n) => String(n || '').trim().split(/\s+/)[0] || 'there';
const itemsLine = (o) => o.items.slice(0, 3).map((i) => `${i.qty} × ${i.title}`).join(', ') + (o.items.length > 3 ? ` +${o.items.length - 3} more` : '');

function shell({ storeName, color = '#14122B', title, intro, bodyHtml = '', cta, footer }) {
  return `<!doctype html><html><body style="margin:0;background:#f4f4f5;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#18181b">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:14px;overflow:hidden">
<tr><td style="background:${/^#[0-9a-f]{6}$/i.test(color) ? color : '#14122B'};color:#fff;padding:18px 24px;font-weight:800;font-size:18px">${esc(storeName)}</td></tr>
<tr><td style="padding:24px"><h1 style="font-size:20px;margin:0 0 8px">${esc(title)}</h1><p style="margin:0 0 16px;line-height:1.5">${intro}</p>${bodyHtml}
${cta ? `<p style="margin:22px 0 4px"><a href="${esc(cta.url)}" style="display:inline-block;background:#18181b;color:#fff;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:10px">${esc(cta.label)}</a></p>` : ''}
</td></tr><tr><td style="padding:14px 24px;background:#fafafa;color:#71717a;font-size:12px">${footer || ''}</td></tr></table></td></tr></table></body></html>`;
}
function itemsTable(o) {
  const rows = o.items.map((i) => `<tr><td style="padding:6px 0">${esc(i.title)}${i.variantLabel ? `<br><span style="color:#71717a;font-size:12px">${esc(i.variantLabel)}</span>` : ''}</td><td style="padding:6px 8px;text-align:center">${i.qty}</td><td style="padding:6px 0;text-align:right">${inr(i.lineTotalPaise)}</td></tr>`).join('');
  const line = (label, v, bold) => `<tr><td colspan="2" style="padding:3px 0;text-align:right;${bold ? 'font-weight:800' : 'color:#52525b'}">${label}</td><td style="padding:3px 0;text-align:right;${bold ? 'font-weight:800' : ''}">${v}</td></tr>`;
  return `<table role="presentation" width="100%" style="border-collapse:collapse;font-size:14px;border-top:1px solid #e4e4e7">${rows}
${line('Subtotal', inr(o.subtotalPaise))}${o.discountPaise ? line(`Discount${o.couponCode ? ' (' + esc(o.couponCode) + ')' : ''}`, '−' + inr(o.discountPaise)) : ''}${o.shippingPaise ? line('Shipping', inr(o.shippingPaise)) : ''}${o.codFeePaise ? line('Cash on delivery fee', inr(o.codFeePaise)) : ''}${o.taxPaise && o.taxInclusive === false ? line('GST', inr(o.taxPaise)) : ''}${line('Total', inr(o.totalPaise), true)}</table>`;
}
const payText = (o) => (o.paymentMethod === 'cod' ? 'Cash on delivery' : o.paymentStatus === 'paid' ? 'Paid online' : 'Online payment pending');
const tracking = (o) => (o.shipment && (o.shipment.trackingNumber || o.shipment.trackingUrl) ? `${o.shipment.carrier ? o.shipment.carrier + ' ' : ''}${o.shipment.trackingNumber || ''}${o.shipment.trackingUrl ? ' ' + o.shipment.trackingUrl : ''}`.trim() : '');

// ---------------- buyer ----------------
function orderConfirmation({ store, order, link, color }) {
  const name = firstName(order.customer.name), total = inr(order.totalPaise);
  const text = `Hi ${name}, thank you for your order #${order.orderNumber} at ${store.name}! Total ${total} (${payText(order)}). Items: ${itemsLine(order)}. Track it here: ${link}`;
  return {
    email: { subject: `Order #${order.orderNumber} confirmed · ${store.name}`, text: `${text}\n\nDelivery to: ${[order.shipping.line1, order.shipping.city, order.shipping.state, order.shipping.pincode].filter(Boolean).join(', ')}`,
      html: shell({ storeName: store.name, color, title: `Thank you, ${name}!`, intro: `We have received your order <b>#${order.orderNumber}</b>. ${esc(payText(order))}.`, bodyHtml: itemsTable(order) + `<p style="color:#52525b;font-size:13px;margin-top:14px">Delivering to ${esc([order.shipping.line1, order.shipping.line2, order.shipping.city, order.shipping.state, order.shipping.pincode].filter(Boolean).join(', '))}</p>`, cta: { url: link, label: 'View your order' }, footer: `Questions? Reply to this email${store.whatsappNumber ? ' or message us on WhatsApp' : ''}.` }) },
    whatsapp: { type: 'template', name: TPL.orderConfirmed(), language: lang(), params: [name, store.name, String(order.orderNumber), total, link], text },
  };
}
function orderUpdate({ store, order, status, link, color }) {
  const name = firstName(order.customer.name), st = STATUS_TEXT[status] || status, tr = tracking(order);
  const detail = status === 'shipped' && tr ? `Tracking: ${tr}` : status === 'cancelled' ? (order.paymentStatus === 'paid' || order.refundedPaise ? 'Any online payment will be refunded to the original method.' : 'No payment is due.') : status === 'delivered' ? 'We hope you love it!' : 'We will update you when it ships.';
  const text = `Hi ${name}, your order #${order.orderNumber} from ${store.name} is ${st}. ${detail} Details: ${link}`;
  return {
    email: { subject: `Order #${order.orderNumber} is ${st} · ${store.name}`, text, html: shell({ storeName: store.name, color, title: `Your order is ${esc(st)}`, intro: `Order <b>#${order.orderNumber}</b>: ${esc(detail)}`, bodyHtml: status === 'cancelled' ? '' : itemsTable(order), cta: { url: link, label: 'View your order' } }) },
    whatsapp: { type: 'template', name: TPL.orderUpdate(), language: lang(), params: [name, String(order.orderNumber), store.name, st, detail, link], text },
  };
}
function paymentReceived({ store, order, link, color }) {
  const name = firstName(order.customer.name), text = `Hi ${name}, we received your payment of ${inr(order.totalPaise)} for order #${order.orderNumber} at ${store.name}. Thank you! ${link}`;
  return { email: { subject: `Payment received for order #${order.orderNumber} · ${store.name}`, text, html: shell({ storeName: store.name, color, title: 'Payment received', intro: `We received <b>${inr(order.totalPaise)}</b> for order <b>#${order.orderNumber}</b>. Thank you!`, bodyHtml: itemsTable(order), cta: { url: link, label: 'View your order' } }) } };
}
function refundProcessed({ store, order, amountPaise, link, color }) {
  const name = firstName(order.customer.name), amt = inr(amountPaise);
  const text = `Hi ${name}, a refund of ${amt} for order #${order.orderNumber} at ${store.name} has been processed. Banks usually show it within 5–7 working days. ${link}`;
  return {
    email: { subject: `Refund of ${amt} processed · order #${order.orderNumber}`, text, html: shell({ storeName: store.name, color, title: 'Your refund is on its way', intro: `We refunded <b>${amt}</b> for order <b>#${order.orderNumber}</b> to your original payment method. Banks usually show it within 5–7 working days.`, cta: { url: link, label: 'View your order' } }) },
    whatsapp: { type: 'template', name: TPL.refund(), language: lang(), params: [name, amt, String(order.orderNumber), store.name], text },
  };
}

function refundInitiated({ store, order, amountPaise, link, color }) {
  const name = firstName(order.customer.name), amt = inr(amountPaise);
  const text = `Hi ${name}, because order #${order.orderNumber} at ${store.name} was cancelled, we have started a refund of ${amt} to your original payment method. Banks usually show it within 5–7 working days. ${link}`;
  return { email: { subject: `Refund of ${amt} started · order #${order.orderNumber}`, text, html: shell({ storeName: store.name, color, title: 'Your refund has started', intro: `Your order <b>#${order.orderNumber}</b> was cancelled, so we started a refund of <b>${amt}</b> to your original payment method. Banks usually show it within 5–7 working days. We will email you again when it is complete.`, cta: { url: link, label: 'View your order' } }) } };
}
// Sent to the buyer only when every automatic attempt failed: honest, no gateway details.
function refundDelayed({ store, order, amountPaise, link, color }) {
  const name = firstName(order.customer.name), amt = inr(amountPaise);
  const text = `Hi ${name}, we could not complete the automatic refund of ${amt} for cancelled order #${order.orderNumber} at ${store.name}. The store has been alerted and will sort it out with you. ${link}`;
  return { email: { subject: `Your refund for order #${order.orderNumber} needs a little more time`, text, html: shell({ storeName: store.name, color, title: 'Your refund needs a little more time', intro: `The automatic refund of <b>${amt}</b> for cancelled order <b>#${order.orderNumber}</b> could not be completed. ${esc(store.name)} has been alerted and will arrange it with you directly.`, cta: { url: link, label: 'View your order' } }) } };
}

// ---------------- owner ----------------
function ownerNewOrder({ store, order, dashUrl }) {
  const total = inr(order.totalPaise);
  const text = `🛍️ New order #${order.orderNumber} at ${store.name}: ${total} from ${order.customer.name} (${payText(order)}). ${itemsLine(order)}. Open: ${dashUrl}`;
  return {
    email: { subject: `New order #${order.orderNumber} · ${total} · ${store.name}`, text, html: shell({ storeName: store.name, title: `New order #${order.orderNumber}`, intro: `<b>${esc(order.customer.name)}</b> (+${esc(order.customer.phone)}) ordered for <b>${total}</b>. ${esc(payText(order))}.`, bodyHtml: itemsTable(order), cta: { url: dashUrl, label: 'Open in dashboard' }, footer: 'You can change which alerts you get in Dashboard → Notifications.' }) },
    whatsapp: { type: 'template', name: TPL.newOrder(), language: lang(), params: [store.name, String(order.orderNumber), total, order.customer.name, itemsLine(order), dashUrl], text },
  };
}
function ownerLowStock({ store, title, stock, dashUrl }) {
  const text = `⚠️ Low stock at ${store.name}: "${title}" has ${stock} left. Update stock: ${dashUrl}`;
  return {
    email: { subject: `Low stock: ${title} (${stock} left)`, text, html: shell({ storeName: store.name, title: 'Running low on stock', intro: `<b>${esc(title)}</b> has <b>${stock}</b> left.`, cta: { url: dashUrl, label: 'Update stock' } }) },
    whatsapp: { type: 'template', name: TPL.lowStock(), language: lang(), params: [title, String(stock), store.name], text },
  };
}
function ownerSimple({ store, subject, title, body, dashUrl, cta = 'Open dashboard' }) {
  return { email: { subject, text: `${body}\n\n${dashUrl}`, html: shell({ storeName: store.name, title, intro: esc(body), cta: { url: dashUrl, label: cta } }) } };
}

module.exports = { orderConfirmation, orderUpdate, paymentReceived, refundProcessed, refundInitiated, refundDelayed, ownerNewOrder, ownerLowStock, ownerSimple, inr, esc, STATUS_TEXT, TPL, itemsLine };
