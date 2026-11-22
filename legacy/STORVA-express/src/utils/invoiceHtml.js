'use strict';
// Module 12: printable invoice for a store order (owner dashboard and the buyer's order page). With a GSTIN it is a GST
// "Tax invoice" with the fields of CGST Rule 46 (supplier/recipient GSTIN, place of supply, HSN, taxable value, rate, CGST/SGST
// or IGST, amount in words); without one it is a plain invoice. All dynamic text is escaped.
const I = require('./india');
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (p) => '₹' + ((p || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const two = (n) => (n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : ''));
const three = (n) => (n >= 100 ? ONES[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + two(n % 100) : '') : two(n));
// Indian numbering: 12,34,567 -> "Twelve Lakh Thirty Four Thousand Five Hundred Sixty Seven"
function inWords(n) {
  n = Math.floor(n); if (!n) return 'Zero';
  const parts = []; const crore = Math.floor(n / 1e7); n %= 1e7; const lakh = Math.floor(n / 1e5); n %= 1e5; const th = Math.floor(n / 1000); n %= 1000;
  if (crore) parts.push(inWords(crore) + ' Crore'); if (lakh) parts.push(two(lakh) + ' Lakh'); if (th) parts.push(two(th) + ' Thousand'); if (n) parts.push(three(n));
  return parts.join(' ');
}
const rupeesInWords = (paise) => { const r = Math.floor(paise / 100), p = paise % 100; return `Rupees ${inWords(r)}${p ? ' and ' + two(p) + ' Paise' : ''} Only`; };

function renderInvoice({ store, order: o }) {
  const seller = o.seller && o.seller.gstin ? o.seller : null;
  const gst = Boolean(seller) && o.taxPaise >= 0;
  const posState = I.stateByName(o.shipping.state), sellerState = seller ? I.stateByName(seller.state) : null;
  const intra = !o.tax.igst;
  const date = new Date(o.invoiceDate || o.createdAt).toLocaleDateString('en-IN', { dateStyle: 'long', timeZone: 'Asia/Kolkata' });
  const extras = (o.shippingPaise || 0) + (o.codFeePaise || 0);
  let rows, foot;
  if (gst) {
    const ct0 = o.tax.chargesTaxPaise || 0, rowTaxes = [...o.items.map((i) => i.taxPaise || 0), ...(extras ? [ct0] : [])];
    const splits = require('./charges').splitIntra(o.tax.cgst || 0, rowTaxes); let row = 0;
    const line = (desc, hsn, qty, unit, taxable, rate, tax) => { const sp = splits[row++] || { cgst: 0, sgst: tax }; return `<tr><td>${desc}</td><td>${esc(hsn || '')}</td><td class="r">${qty}</td><td class="r">${unit}</td><td class="r">${money(taxable)}</td><td class="r">${rate}%</td>${intra ? `<td class="r">${money(sp.cgst)}</td><td class="r">${money(sp.sgst)}</td>` : `<td class="r">${money(tax)}</td>`}<td class="r">${money(taxable + tax)}</td></tr>`; };
    rows = o.items.map((i) => line(`${esc(i.title)}${i.variantLabel ? `<br><small>${esc(i.variantLabel)}</small>` : ''}${i.sku ? `<br><small>SKU ${esc(i.sku)}</small>` : ''}`, i.hsn, i.qty, money(i.unitPricePaise), i.taxablePaise || (i.lineTotalPaise - (i.taxPaise || 0)), i.taxRate || 0, i.taxPaise || 0)).join('');
    if (extras) { const ct = o.tax.chargesTaxPaise || 0, taxable = o.taxInclusive ? extras - ct : extras; rows += line(`Shipping${o.codFeePaise ? ' & cash on delivery fee' : ''}`, '996812', 1, money(extras), taxable, o.tax.chargesTaxRate || 0, ct); }
    const head = `<tr><th>Item</th><th>HSN/SAC</th><th class="r">Qty</th><th class="r">Price</th><th class="r">Taxable value</th><th class="r">GST</th>${intra ? '<th class="r">CGST</th><th class="r">SGST</th>' : '<th class="r">IGST</th>'}<th class="r">Amount</th></tr>`;
    const cols = intra ? 7 : 6;
    foot = `${o.discountPaise ? `<tr><td colspan="${cols}" class="r muted-cell">Includes discount${o.couponCode ? ' (' + esc(o.couponCode) + ')' : ''} of ${money(o.discountPaise)}, already applied to item values</td><td></td></tr>` : ''}
<tr><td colspan="${cols}" class="r">Total GST ${intra ? `(CGST ${money(o.tax.cgst)} + SGST ${money(o.tax.sgst)})` : `(IGST ${money(o.tax.igst)})`}</td><td class="r">${money(o.taxPaise)}</td></tr>
<tr class="tot"><td colspan="${cols}" class="r"><b>Invoice total</b></td><td class="r"><b>${money(o.totalPaise)}</b></td></tr>`;
    rows = `<thead>${head}</thead><tbody>${rows}</tbody><tfoot>${foot}</tfoot>`;
  } else {
    rows = `<thead><tr><th>Item</th><th class="r">Qty</th><th class="r">Price</th><th class="r">Amount</th></tr></thead><tbody>${o.items.map((i) => `<tr><td>${esc(i.title)}${i.variantLabel ? `<br><small>${esc(i.variantLabel)}</small>` : ''}</td><td class="r">${i.qty}</td><td class="r">${money(i.unitPricePaise)}</td><td class="r">${money(i.lineTotalPaise)}</td></tr>`).join('')}</tbody>
<tfoot><tr><td colspan="3" class="r">Subtotal</td><td class="r">${money(o.subtotalPaise)}</td></tr>${o.discountPaise ? `<tr><td colspan="3" class="r">Discount${o.couponCode ? ' (' + esc(o.couponCode) + ')' : ''}</td><td class="r">−${money(o.discountPaise)}</td></tr>` : ''}${o.shippingPaise ? `<tr><td colspan="3" class="r">Shipping</td><td class="r">${money(o.shippingPaise)}</td></tr>` : ''}${o.codFeePaise ? `<tr><td colspan="3" class="r">Cash on delivery fee</td><td class="r">${money(o.codFeePaise)}</td></tr>` : ''}
<tr class="tot"><td colspan="3" class="r"><b>Total</b></td><td class="r"><b>${money(o.totalPaise)}</b></td></tr></tfoot>`;
  }
  const addr = [o.shipping.line1, o.shipping.line2, o.shipping.city, o.shipping.state, o.shipping.pincode].filter(Boolean).map(esc).join(', ');
  const cancelled = o.status === 'cancelled';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Invoice ${esc(o.invoiceNumber || '#' + o.orderNumber)} · ${esc(store.name)}</title><meta name="robots" content="noindex"><link rel="stylesheet" href="/css/invoice.css"></head><body><main class="inv${cancelled ? ' void' : ''}">
${cancelled ? '<div class="stamp">CANCELLED</div>' : ''}
<header><div><h1>${esc(seller ? seller.legalName || store.name : store.name)}</h1>${seller && seller.legalName && seller.legalName !== store.name ? `<p>Trading as ${esc(store.name)}</p>` : ''}<p>${esc((seller && seller.address) || store.address || '')}</p>${seller ? `<p>GSTIN: <b>${esc(seller.gstin)}</b>${sellerState ? ` · State: ${esc(sellerState.name)} (${sellerState.code})` : ''}</p>` : ''}${store.contactEmail ? `<p>${esc(store.contactEmail)}</p>` : ''}</div>
<div class="r"><h2>${gst ? 'Tax invoice' : 'Invoice'}</h2><p><b>${esc(o.invoiceNumber || 'Order #' + o.orderNumber)}</b></p><p>${esc(date)}</p><p>Order #${o.orderNumber}</p></div></header>
<div class="cols"><section><h3>Bill to / Ship to</h3><p><b>${esc(o.customer.name)}</b></p><p>${addr}</p><p>+${esc(o.customer.phone)}${o.customer.email ? ' · ' + esc(o.customer.email) : ''}</p>${o.buyerGstin ? `<p>GSTIN: <b>${esc(o.buyerGstin)}</b></p>` : ''}</section>
<section>${gst ? `<h3>Place of supply</h3><p>${esc(posState ? `${posState.name} (${posState.code})` : o.shipping.state)}</p><p class="small">Tax is payable on reverse charge: No</p>` : ''}<h3 style="margin-top:8px">Payment</h3><p>${o.paymentMethod === 'cod' ? 'Cash on delivery' : 'Paid online (Razorpay)'} · ${esc(o.paymentStatus)}</p></section></div>
<table>${rows}</table>
<p class="words"><b>Amount in words:</b> ${rupeesInWords(o.totalPaise)}</p>
${o.refundedPaise ? `<p class="small">Refunded: ${money(o.refundedPaise)}</p>` : ''}
<footer class="sign"><p class="muted">This is a computer-generated invoice${gst ? ' and does not require a signature' : ''}.</p>${gst ? `<p class="r">For ${esc(seller.legalName || store.name)}<br><br>Authorised signatory</p>` : ''}</footer>
<p class="no-print"><button type="button" data-print>Print / Save as PDF</button></p></main><script src="/js/print.js"></script></body></html>`;
}
module.exports = { renderInvoice, rupeesInWords, inWords };
