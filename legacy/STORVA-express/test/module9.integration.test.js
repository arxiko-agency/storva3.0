'use strict';
// Module 9 AI tools against a REAL MongoDB with a fake Gemini transport (no network): gating, credits, refunds, photo -> draft.
const test = require('node:test');
const assert = require('node:assert/strict');
process.env.GEMINI_API_KEY = 'test-key';
const H = require('./helpers/harness');
if (!H.enabled) { H.skip(test, 'module 9'); return; }
const ai = require('../src/services/ai');
let calls = [], next = null;
ai.setTransport(async ({ url, body }) => { calls.push({ url, body }); const r = next ? next(body) : null; if (r) return r; return { status: 200, json: { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ description: 'A sturdy handwoven basket.', bullets: ['Handmade'], seoTitle: 'Jute basket', seoDescription: 'Buy', titles: ['Handwoven Jute Basket'], category: 'Home decor', tags: ['jute'], caption: 'New in!', title: 'Jute Basket', attributes: ['Colour: natural'], priceLow: 400, priceHigh: 600, changes: [] }) }] } }] } }; });
test.before(H.start); test.after(H.stop);
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex');
let FREE, PRO;

test('setup', async () => { FREE = await H.owner(); PRO = await H.owner({ plan: 'pro' }); });

test('Free plan: AI tools answer 402 upgrade_required and never call Gemini', async () => {
  calls = [];
  const r = await H.api(FREE, `/stores/${FREE.sid}/ai/describe`, { method: 'POST', body: { title: 'Jute basket' } });
  assert.equal(r.status, 402); assert.equal(r.json.error.details.feature, 'ai'); assert.equal(calls.length, 0);
  const meta = await H.api(FREE, `/stores/${FREE.sid}/ai`);
  assert.equal(meta.json.enabled, false); assert.equal(meta.json.credits.limit, 0);
});

test('Pro: describe returns cleaned suggestions, uses 1 credit and sends the key only in a header', async () => {
  calls = [];
  const r = await H.api(PRO, `/stores/${PRO.sid}/ai/describe`, { method: 'POST', body: { title: 'Jute basket', language: 'ml', tone: 'premium' } });
  assert.equal(r.status, 200, JSON.stringify(r.json)); assert.equal(r.json.result.description, 'A sturdy handwoven basket.'); assert.equal(r.json.creditsUsed, 1); assert.equal(r.json.creditsLeft, 199);
  assert.equal(calls.length, 1); assert.ok(!calls[0].url.includes('test-key'), 'key never in the URL'); assert.match(calls[0].body.contents[0].parts[0].text, /Malayalam/);
  assert.equal(calls[0].body.generationConfig.responseMimeType, 'application/json');
});

test('missing input is a 400 before any credit is used; another owner gets 404', async () => {
  const before = (await H.api(PRO, `/stores/${PRO.sid}/ai`)).json.credits.used;
  assert.equal((await H.api(PRO, `/stores/${PRO.sid}/ai/titles`, { method: 'POST', body: {} })).status, 400);
  assert.equal((await H.api(PRO, `/stores/${PRO.sid}/ai`)).json.credits.used, before);
  assert.equal((await H.api(FREE, `/stores/${PRO.sid}/ai/titles`, { method: 'POST', body: { title: 'x' } })).status, 404);
});

test('a failed or blocked AI call gives the credit back', async () => {
  const before = (await H.api(PRO, `/stores/${PRO.sid}/ai`)).json.credits.used;
  next = () => ({ status: 503, json: { error: {} } });
  assert.equal((await H.api(PRO, `/stores/${PRO.sid}/ai/titles`, { method: 'POST', body: { title: 'Mug' } })).status, 503);
  next = () => ({ status: 200, json: { candidates: [{ finishReason: 'SAFETY' }] } });
  const b = await H.api(PRO, `/stores/${PRO.sid}/ai/titles`, { method: 'POST', body: { title: 'Mug' } });
  assert.equal(b.status, 422); assert.equal(b.json.error.code, 'ai_blocked');
  next = null;
  assert.equal((await H.api(PRO, `/stores/${PRO.sid}/ai`)).json.credits.used, before);
});

test('monthly credits are enforced atomically: parallel calls never go over the limit', async () => {
  const AiUsage = require('../src/models/AiUsage');
  await AiUsage.updateOne({ store: PRO.sid, month: ai.monthKey() }, { $set: { credits: 197 } });
  const rs = await Promise.all(Array.from({ length: 6 }, () => H.api(PRO, `/stores/${PRO.sid}/ai/tags`, { method: 'POST', body: { title: 'Mug' } })));
  assert.equal(rs.filter((r) => r.status === 200).length, 3); assert.equal(rs.filter((r) => r.status === 402).length, 3);
  assert.equal(rs.find((r) => r.status === 402).json.error.code, 'ai_credits_exhausted');
  assert.equal((await AiUsage.findOne({ store: PRO.sid, month: ai.monthKey() })).credits, 200);
  await AiUsage.updateOne({ store: PRO.sid, month: ai.monthKey() }, { $set: { credits: 0 } });
});

test('create from photo: saves the image and creates a DRAFT product with the AI title, category and tags (2 credits)', async () => {
  const r = await H.api(PRO, `/stores/${PRO.sid}/ai/product-from-photo?language=en`, { method: 'POST', headers: { 'content-type': 'image/png' }, raw: PNG });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const p = r.json.product;
  assert.equal(p.status, 'draft'); assert.equal(p.title, 'Jute Basket'); assert.equal(p.category, 'Home decor'); assert.deepEqual(p.tags, ['jute']); assert.equal(p.price, 500);
  assert.match(p.images[0].url, new RegExp(`^/uploads/${PRO.sid}/ai-`));
  assert.equal(calls.at(-1).body.contents[0].parts[1].inline_data.mime_type, 'image/png');
  const bad = await H.api(PRO, `/stores/${PRO.sid}/ai/product-from-photo`, { method: 'POST', headers: { 'content-type': 'image/png' }, raw: Buffer.from('not an image at all....') });
  assert.equal(bad.status, 415);
  // analyse an existing product photo
  const ph = await H.api(PRO, `/stores/${PRO.sid}/ai/photo`, { method: 'POST', body: { productId: p.id } });
  assert.equal(ph.status, 200); assert.deepEqual(ph.json.result.priceHint, { low: 400, high: 600 });
});

test('without GEMINI_API_KEY the tools answer 503 ai_not_configured', async () => {
  const k = process.env.GEMINI_API_KEY; delete process.env.GEMINI_API_KEY;
  const r = await H.api(PRO, `/stores/${PRO.sid}/ai/describe`, { method: 'POST', body: { title: 'Mug' } });
  process.env.GEMINI_API_KEY = k;
  assert.equal(r.status, 503); assert.equal(r.json.error.code, 'ai_not_configured');
});
