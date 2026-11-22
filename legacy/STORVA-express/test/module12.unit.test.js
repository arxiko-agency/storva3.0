'use strict';
// Module 12 pure logic: states, GSTIN check digit, HSN, financial year, the charges calculator (shipping zones, COD, GST), invoice words.
const test = require('node:test');
const assert = require('node:assert/strict');
const I = require('../src/utils/india');
const { computeCharges, allocate, splitIntra } = require('../src/utils/charges');
const { rupeesInWords, renderInvoice } = require('../src/utils/invoiceHtml');

test('states and GSTIN', () => {
  assert.equal(I.canonicalState('kerala'), 'Kerala'); assert.equal(I.canonicalState('Pondicherry'), 'Puducherry'); assert.equal(I.canonicalState('J&K'), 'Jammu and Kashmir');
  assert.equal(I.stateByCode('32').name, 'Kerala');
  assert.equal(I.gstinProblem('27AAPFU0939F1ZV'), null);
  assert.match(I.gstinProblem('27AAPFU0939F1ZX'), /mistyped/); assert.match(I.gstinProblem('27AAPFU0939F1Z'), /15 characters/); assert.match(I.gstinProblem('00AAPFU0939F1ZV'), /state code/);
  assert.ok(I.validHsn('6109') && I.validHsn('610910') && I.validHsn('61091000')); assert.ok(!I.validHsn('61') && !I.validHsn('61091'));
  assert.equal(I.financialYear(new Date('2026-03-31T12:00:00Z')), '25-26'); assert.equal(I.financialYear(new Date('2026-04-01T00:00:00+05:30')), '26-27');
});

test('allocate splits exactly', () => {
  assert.deepEqual(allocate(100, [1, 1, 1]), [34, 33, 33]); assert.equal(allocate(9999, [3, 7, 11]).reduce((a, b) => a + b), 9999); assert.deepEqual(allocate(0, [5, 5]), [0, 0]);
});

const zones = { mode: 'zones', zones: [{ id: 'k', name: 'Kerala', states: ['Kerala'], ratePaise: 4000, freeAbovePaise: 99900, etaDays: '1-2' }, { id: 's', name: 'South', states: ['Tamil Nadu', 'Karnataka'], ratePaise: 6000 }, { id: 'r', name: 'Rest of India', states: [], ratePaise: 9000, codAvailable: false }], blockedPincodes: ['744'], cod: { enabled: true, feePaise: 3000, maxOrderPaise: 500000 } };
const items = [{ lineTotalPaise: 50000, gstRate: 5 }, { lineTotalPaise: 30000, gstRate: 18 }];

test('shipping: zones by state, free above, rest of India, blocked PIN codes, needs address', () => {
  let c = computeCharges({ items, address: { state: 'kerala', pincode: '682001' }, shipping: zones });
  assert.equal(c.shippingPaise, 4000); assert.equal(c.zone.name, 'Kerala'); assert.equal(c.etaDays, '1-2'); assert.equal(c.freeShippingAbovePaise, 99900);
  c = computeCharges({ items: [{ lineTotalPaise: 100000 }], address: { state: 'Kerala' }, shipping: zones }); assert.equal(c.shippingPaise, 0);
  c = computeCharges({ items, address: { state: 'Punjab' }, shipping: zones }); assert.equal(c.zone.name, 'Rest of India'); assert.equal(c.shippingPaise, 9000); assert.equal(c.cod.available, false);
  c = computeCharges({ items, address: { state: 'Andaman and Nicobar Islands', pincode: '744101' }, shipping: zones }); assert.equal(c.serviceable, false); assert.match(c.problem, /744101/);
  c = computeCharges({ items, shipping: zones }); assert.equal(c.needsAddress, true); assert.equal(c.shippingFromPaise, 4000); assert.equal(c.totalPaise, 80000);
  c = computeCharges({ items, address: { state: 'Goa' }, shipping: { mode: 'zones', zones: [zones.zones[0]] } }); assert.equal(c.serviceable, false); assert.match(c.problem, /Goa/);
  c = computeCharges({ items, discountPaise: 10000, shipping: { mode: 'flat', flatRatePaise: 5000, freeAbovePaise: 70000 } }); assert.equal(c.shippingPaise, 0, 'free threshold uses the amount after discount: 70000 >= 70000');
});

test('cash on delivery: fee only when chosen, order limit, disabled', () => {
  let c = computeCharges({ items, address: { state: 'Kerala' }, paymentMethod: 'cod', shipping: zones });
  assert.equal(c.codFeePaise, 3000); assert.equal(c.totalPaise, 80000 + 4000 + 3000);
  assert.equal(computeCharges({ items, address: { state: 'Kerala' }, paymentMethod: 'razorpay', shipping: zones }).codFeePaise, 0);
  c = computeCharges({ items: [{ lineTotalPaise: 600000 }], address: { state: 'Kerala' }, shipping: zones }); assert.equal(c.cod.available, false); assert.match(c.cod.reason, /up to ₹5000/);
  assert.equal(computeCharges({ items, shipping: { cod: { enabled: false } } }).cod.available, false);
  c = computeCharges({ items, address: { state: 'Punjab' }, paymentMethod: 'cod', shipping: zones }); assert.equal(c.cod.available, false); assert.equal(c.codFeePaise, 0, 'no COD fee in the total when COD is not possible');
});

test('GST: inclusive and exclusive, discount allocation, CGST/SGST vs IGST, shipping at the main rate', () => {
  const tax = { enabled: true, state: 'Kerala', pricesIncludeTax: true, defaultRate: 5 };
  let c = computeCharges({ items, address: { state: 'Kerala' }, shipping: { mode: 'flat', flatRatePaise: 5900 }, tax });
  assert.equal(c.lines[0].taxPaise, Math.round(50000 * 5 / 105)); assert.equal(c.lines[1].taxPaise, Math.round(30000 * 18 / 118)); assert.equal(c.chargesTaxPaise, 900);
  assert.equal(c.taxPaise, c.lines[0].taxPaise + c.lines[1].taxPaise + 900); assert.equal(c.tax.cgst + c.tax.sgst, c.taxPaise); assert.equal(c.tax.igst, 0);
  assert.equal(c.totalPaise, 80000 + 5900, 'inclusive: GST does not change the total');
  c = computeCharges({ items, address: { state: 'Tamil Nadu' }, tax }); assert.equal(c.tax.igst, c.taxPaise); assert.equal(c.intraState, false);
  c = computeCharges({ items: [{ lineTotalPaise: 10000, gstRate: null }], tax: { ...tax, pricesIncludeTax: false, defaultRate: 18 } }); assert.equal(c.taxPaise, 1800); assert.equal(c.totalPaise, 11800);
  c = computeCharges({ items, discountPaise: 8000, tax: { ...tax, pricesIncludeTax: false } });
  assert.equal(c.lines[0].taxablePaise + c.lines[1].taxablePaise, 72000); assert.equal(c.lines[0].taxablePaise, 45000);
  assert.equal(computeCharges({ items, tax: { ...tax, enabled: false } }).taxPaise, 0);
  c = computeCharges({ items, shipping: { mode: 'flat', flatRatePaise: 5000 }, tax: { ...tax, shippingTaxable: false } }); assert.equal(c.chargesTaxPaise, 0);
});

test('invoice: amount in words, escaping, IGST columns, cancelled stamp', () => {
  assert.equal(rupeesInWords(1234500), 'Rupees Twelve Thousand Three Hundred Forty Five Only');
  assert.equal(rupeesInWords(10000000050), 'Rupees Ten Crore and Fifty Paise Only');
  const order = { orderNumber: 1001, invoiceNumber: 'INV/26-27/00001', invoiceDate: new Date(), createdAt: new Date(), status: 'cancelled', paymentMethod: 'cod', paymentStatus: 'unpaid', customer: { name: '<b>Asha</b>', phone: '919876543210', email: '' },
    shipping: { line1: '1 Rd', city: 'Chennai', state: 'Tamil Nadu', pincode: '600001' }, items: [{ title: 'Kurta <script>', qty: 1, unitPricePaise: 105000, lineTotalPaise: 105000, taxRate: 5, taxPaise: 5000, taxablePaise: 100000, hsn: '6109' }],
    subtotalPaise: 105000, discountPaise: 0, shippingPaise: 0, codFeePaise: 0, taxPaise: 5000, taxInclusive: true, tax: { cgst: 0, sgst: 0, igst: 5000 }, totalPaise: 105000, seller: { legalName: 'Asha Crafts LLP', gstin: '32AAPFU0939F1Z1', state: 'Kerala', address: 'Kochi' }, buyerGstin: '' };
  const html = renderInvoice({ store: { name: 'Asha', address: '', contactEmail: '' }, order });
  assert.ok(html.includes('Tax invoice') && html.includes('IGST') && !html.includes('CGST</th>') && html.includes('Tamil Nadu (33)') && html.includes('CANCELLED'));
  assert.ok(html.includes('&lt;b&gt;Asha&lt;/b&gt;') && !html.includes('<script>') && html.includes('Rupees One Thousand Fifty Only'));
});

test('CGST/SGST rows always add up to the invoice totals', () => {
  for (const [cg, taxes] of [[6000, [11667, 333]], [1, [1, 1]], [5000, [3333, 3333, 3334]]]) {
    const sp = splitIntra(cg, taxes); assert.equal(sp.reduce((a, x) => a + x.cgst, 0), cg); sp.forEach((x, i) => assert.equal(x.cgst + x.sgst, taxes[i]));
  }
});
