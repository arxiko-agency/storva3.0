'use strict';
// Module 7 designer against a REAL MongoDB + the real Express app.
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers/harness');
if (!H.enabled) { H.skip(test, 'module 7'); return; }
test.before(H.start); test.after(H.stop);

let A, B, FREE;
const D = (u) => `/stores/${u.sid}/design`;

test('setup', async () => { A = await H.owner({ plan: 'pro', name: 'Designer Pro' }); B = await H.owner({ plan: 'pro' }); FREE = await H.owner({ plan: 'free' }); });

test('owner gets a default design; another owner gets 404 for every designer route', async () => {
  const r = await H.api(A, D(A));
  assert.equal(r.status, 200); assert.equal(r.json.design.publishedVersion, 1); assert.ok(r.json.presets.length >= 5); assert.equal(r.json.plan.customDesign, true);
  for (const [method, path, body] of [['GET', ''], ['PUT', '/draft', { colors: { primary: '#000000' } }], ['POST', '/publish', {}], ['POST', '/preset', { presetId: 'midnight_luxe' }], ['POST', '/reset', {}]]) {
    const x = await H.api(B, D(A) + path, { method, body });
    assert.equal(x.status, 404, `${method} ${path}`);
  }
  assert.equal((await H.api(null, D(A))).status, 401);
});

test('draft edits do not touch the live store until publish; publish keeps the previous version in history', async () => {
  const save = await H.api(A, D(A) + '/draft', { method: 'PUT', body: { colors: { primary: '#0f766e' }, sections: [{ type: 'hero', settings: { heading: 'Monsoon Sale <img src=x onerror=alert(1)>' } }, { type: 'catalog_grid' }, { type: 'trust_badges' }] } });
  assert.equal(save.status, 200); assert.equal(save.json.design.hasUnpublishedChanges, true);
  let live = await H.page(`/store/${A.slug}`);
  assert.ok(!live.text.includes('Monsoon Sale'), 'draft must not be live'); assert.ok(!live.text.includes('#0f766e'));
  const pub = await H.api(A, D(A) + '/publish', { method: 'POST', body: { label: 'Monsoon' } });
  assert.equal(pub.status, 200); assert.equal(pub.json.design.publishedVersion, 2); assert.equal(pub.json.design.history.length, 1);
  live = await H.page(`/store/${A.slug}`);
  assert.equal(live.status, 200);
  assert.ok(live.text.includes('Monsoon Sale &lt;img src=x onerror=alert(1)&gt;'), 'section text is escaped');
  assert.ok(!live.text.includes('<img src=x'));
  assert.match(live.text, /--iris: #0f766e;/); assert.ok(live.text.includes('sf-trust'));
});

test('?preview=draft shows the draft ONLY to the owner; strangers and other owners see the live design', async () => {
  await H.api(A, D(A) + '/draft', { method: 'PATCH', body: { sections: [{ type: 'hero', settings: { heading: 'Secret Diwali Draft' } }, { type: 'catalog_grid' }] } });
  const anon = await H.page(`/store/${A.slug}?preview=draft`);
  assert.ok(!anon.text.includes('Secret Diwali Draft')); assert.ok(!anon.text.includes('Draft preview'));
  const other = await H.page(`/store/${A.slug}?preview=draft`, { headers: { cookie: B.jar } });
  assert.ok(!other.text.includes('Secret Diwali Draft'));
  const owner = await H.page(`/store/${A.slug}?preview=draft`, { headers: { cookie: A.jar } });
  assert.ok(owner.text.includes('Secret Diwali Draft')); assert.ok(owner.text.includes('Draft preview')); assert.ok(owner.text.includes('noindex'));
  assert.equal(owner.headers.get('cache-control'), 'no-store');
});

test('discard returns the draft to the live design; restore brings an old version back into the draft', async () => {
  const d = await H.api(A, D(A) + '/discard', { method: 'POST', body: {} });
  assert.equal(d.json.design.hasUnpublishedChanges, false);
  assert.equal(d.json.design.draft.sections[0].settings.heading, 'Monsoon Sale <img src=x onerror=alert(1)>');
  const v = d.json.design.history[0];
  const r = await H.api(A, D(A) + '/restore', { method: 'POST', body: { versionId: v.versionId } });
  assert.equal(r.status, 200); assert.equal(r.json.design.draft.colors.primary.toLowerCase(), '#6c4cf5');
  assert.equal((await H.api(A, D(A) + '/restore', { method: 'POST', body: { versionId: 'ver_nope' } })).status, 404);
});

test('invalid designs are refused with field errors and the stored draft is unchanged', async () => {
  const before = (await H.api(A, D(A))).json.design.draft;
  const r = await H.api(A, D(A) + '/draft', { method: 'PUT', body: { colors: { primary: 'red' }, sections: [{ type: 'hero', settings: { bannerImageUrl: 'https://evil.example/x.png' } }] } });
  assert.equal(r.status, 400); assert.equal(r.json.error.code, 'validation_error'); assert.ok(r.json.error.fields['colors.primary']);
  assert.deepEqual((await H.api(A, D(A))).json.design.draft, before);
});

test('free plan: presets + sections allowed, custom colours refused with 402, custom draft cannot be published', async () => {
  assert.equal((await H.api(FREE, D(FREE) + '/preset', { method: 'POST', body: { presetId: 'emerald_craft' } })).status, 200);
  assert.equal((await H.api(FREE, D(FREE) + '/draft', { method: 'PUT', body: { sections: [{ type: 'promo_banner' }, { type: 'catalog_grid' }] } })).status, 200);
  const c = await H.api(FREE, D(FREE) + '/draft', { method: 'PUT', body: { colors: { primary: '#123456' } } });
  assert.equal(c.status, 402); assert.equal(c.json.error.code, 'upgrade_required'); assert.equal(c.json.error.details.requiredPlan, 'pro');
  assert.equal((await H.api(FREE, D(FREE) + '/publish', { method: 'POST', body: {} })).status, 200, 'preset look publishes on Free');
  const live = await H.page(`/store/${FREE.slug}`);
  assert.match(live.text, /--iris: #0F766E;/i);
});

test('design images: only real images are accepted and stored under the store folder', async () => {
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex');
  const ok = await H.api(A, D(A) + '/images', { method: 'POST', headers: { 'content-type': 'image/png' }, raw: png });
  assert.equal(ok.status, 201); assert.match(ok.json.url, new RegExp(`^/uploads/${A.sid}/design-[a-f0-9]{32}\\.png$`));
  const bad = await H.api(A, D(A) + '/images', { method: 'POST', headers: { 'content-type': 'image/png' }, raw: Buffer.from('<?php echo 1; ?>xxxxxxxxxxxx') });
  assert.equal(bad.status, 415);
  const save = await H.api(A, D(A) + '/draft', { method: 'PUT', body: { sections: [{ type: 'hero', settings: { bannerImageUrl: ok.json.url } }, { type: 'catalog_grid' }] } });
  assert.equal(save.status, 200);
});

test('deleting a store removes its design', async () => {
  const StoreDesign = require('../src/models/StoreDesign');
  const tmp = await H.owner({ plan: 'pro' });
  await H.api(tmp, D(tmp));
  assert.equal(await StoreDesign.countDocuments({ store: tmp.sid }), 1);
  const del = await H.api(tmp, `/stores/${tmp.sid}`, { method: 'DELETE', body: { confirmSlug: tmp.slug } });
  assert.equal(del.status, 200);
  assert.equal(await StoreDesign.countDocuments({ store: tmp.sid }), 0);
});
