'use strict';
// Module 7 (designer) unit tests: validation allow-lists, CSS generation and the free-plan "preset look" rule. No database.
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateDesignInput, isSafeAssetUrl, isSafeHref } = require('../src/utils/designInput');
const { designToCss, createDefaultDesign, THEME_PRESETS, getGoogleFontHref } = require('../src/utils/themes');
const { isPresetLook } = require('../src/routes/design');

test('colours must be 6-digit hex; anything else is rejected with a field error', () => {
  for (const bad of ['red', '#fff', 'url(x)', '#12345g', '#123456;}body{', { $ne: 1 }]) {
    const r = validateDesignInput({ colors: { primary: bad } }, createDefaultDesign());
    assert.equal(r.ok, false, String(bad)); assert.ok(r.errors['colors.primary']);
  }
  const ok = validateDesignInput({ colors: { primary: '#0F766E' } }, createDefaultDesign());
  assert.equal(ok.ok, true); assert.equal(ok.value.colors.primary, '#0f766e');
});

test('fonts, presets and section types come from allow-lists only (prototype keys are not "allowed")', () => {
  assert.equal(validateDesignInput({ typography: { fontId: 'Comic Sans' } }).ok, false);
  assert.equal(validateDesignInput({ typography: { fontId: 'constructor' } }).ok, false);
  assert.equal(validateDesignInput({ themePreset: '__proto__' }).ok, false);
  assert.equal(validateDesignInput({ sections: [{ type: 'raw_html' }, { type: 'catalog_grid' }] }).ok, false);
});

test('a storefront must keep an enabled catalogue section and at most 12 sections', () => {
  assert.equal(validateDesignInput({ sections: [{ type: 'hero' }] }).ok, false);
  assert.equal(validateDesignInput({ sections: [{ type: 'catalog_grid', enabled: false }, { type: 'hero' }] }).ok, false);
  assert.equal(validateDesignInput({ sections: Array.from({ length: 13 }, () => ({ type: 'catalog_grid' })) }).ok, false);
  assert.equal(validateDesignInput({ sections: [{ type: 'catalog_grid' }] }).ok, true);
});

test('section images must be this app\'s /uploads/ paths; links must be anchors or internal paths', () => {
  assert.equal(isSafeAssetUrl('/uploads/abc/def.png'), true);
  for (const bad of ['https://evil.example/x.png', 'javascript:alert(1)', '/uploads/../server.js', '/uploads/a b.png', '//evil.example/x']) assert.equal(isSafeAssetUrl(bad), false, bad);
  assert.equal(isSafeHref('#catalog'), true); assert.equal(isSafeHref('/store/x/product/y'), true);
  for (const bad of ['javascript:alert(1)', 'https://evil.example', '//evil.example', '#a b']) assert.equal(isSafeHref(bad), false, bad);
});

test('text settings are trimmed, stripped of control characters and length-limited (HTML is kept as text; EJS escapes it)', () => {
  const r = validateDesignInput({ sections: [{ type: 'hero', settings: { heading: '  <b>Hi</b>\u0000 ' + 'x'.repeat(300) } }, { type: 'catalog_grid' }] });
  assert.equal(r.ok, true);
  const h = r.value.sections[0].settings.heading;
  assert.ok(h.startsWith('<b>Hi</b>')); assert.ok(!h.includes('\u0000')); assert.ok(h.length <= 120);
});

test('designToCss only ever emits validated values (bad input falls back to defaults)', () => {
  const css = designToCss({ colors: { primary: 'red;}</style><script>', text: '#000000' }, typography: { fontId: 'nope', baseSizePx: 99 }, layout: { radius: 'x', gridColsDesktop: 9 } });
  assert.ok(!css.includes('<') && !css.includes('script'));
  assert.match(css, /--iris: #6C4CF5;/); assert.match(css, /--ink: #000000;/); assert.match(css, /--base-size: 16px;/); assert.match(css, /--grid-cols-desktop: 4;/);
  assert.equal(getGoogleFontHref('system'), null);
  assert.match(getGoogleFontHref('lora'), /^https:\/\/fonts\.googleapis\.com\/css2\?family=Lora/);
});

test('free-plan rule: a draft is a "preset look" only if colours and fonts equal its preset exactly', () => {
  const d = createDefaultDesign();
  assert.equal(isPresetLook(d), true);
  assert.equal(isPresetLook({ ...d, colors: { ...d.colors, primary: '#000000' } }), false);
  const p = THEME_PRESETS.midnight_luxe;
  assert.equal(isPresetLook({ ...d, themePreset: 'midnight_luxe', colors: { ...p.colors }, typography: { ...p.typography } }), true);
  assert.equal(isPresetLook({ ...d, themePreset: 'custom' }), false);
});
