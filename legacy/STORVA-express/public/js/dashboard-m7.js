'use strict';
// Module 7: Designer tab. Loaded before dashboard.js and uses its helpers (el, API, base, toast, select, render) at call time.
// Edits are saved to the DRAFT automatically; the live store changes only on "Publish". The preview iframe shows the draft
// (/store/<slug>?preview=draft is only honoured for the logged-in owner). All text goes through textContent.
const SETTING_LABELS = {
  heading: 'Heading', subheading: 'Sub-heading', subtext: 'Text', badge: 'Badge', title: 'Title', subtitle: 'Subtitle', ctaText: 'Button text', ctaHref: 'Button link',
  buttonText: 'Button text', body: 'Story text', item1Title: 'Point 1 title', item1Text: 'Point 1 text', item2Title: 'Point 2 title', item2Text: 'Point 2 text', item3Title: 'Point 3 title', item3Text: 'Point 3 text',
  showWhatsapp: 'Show WhatsApp button', showCounts: 'Show product counts', showSort: 'Show sort menu', limit: 'How many products', imageUrl: 'Image', bannerImageUrl: 'Background image',
};
const SETTING_HINTS = { ctaHref: 'Use #catalog, or a store path such as /store/your-shop/product/item', heading: 'Leave empty to use your store name', subheading: 'Leave empty to use your tagline', body: 'Leave empty to use your store description' };
const COLOR_LABELS = { primary: 'Brand colour', accent: 'Accent', background: 'Page background', surface: 'Cards & panels', text: 'Text', muted: 'Secondary text', heroBg: 'Hero background', heroText: 'Hero text' };
const LAYOUT_OPTS = {
  headerStyle: [['sticky', 'Sticky'], ['minimal', 'Minimal'], ['centered', 'Centered']], heroStyle: [['split', 'Split (logo + text)'], ['banner', 'Big banner'], ['compact', 'Compact']],
  cardStyle: [['elevated', 'Soft shadow'], ['bordered', 'Outlined'], ['flat', 'Flat']], radius: [['sharp', 'Sharp corners'], ['rounded', 'Rounded'], ['pill', 'Extra round']],
  gridColsDesktop: [['2', '2 per row'], ['3', '3 per row'], ['4', '4 per row']], gridColsMobile: [['1', '1 per row'], ['2', '2 per row']],
};
const LAYOUT_LABELS = { headerStyle: 'Header', heroStyle: 'Hero', cardStyle: 'Product cards', radius: 'Corners', gridColsDesktop: 'Products on desktop', gridColsMobile: 'Products on mobile' };

async function designerView() {
  let P = await API(base() + '/design');
  let D = JSON.parse(JSON.stringify(P.design.draft));
  const canCustom = P.plan.customDesign;
  const frame = el('iframe', { class: 'dz-frame', title: 'Draft preview', src: P.previewUrl, loading: 'lazy' });
  const stage = el('div', { class: 'dz-stage desktop' }, frame);
  const status = el('div', { class: 'dz-status' });
  let saving = null, pending = false, timer = null;

  function drawStatus() {
    const d = P.design;
    status.replaceChildren(...[
      el('span', { class: 'badge ' + (d.hasUnpublishedChanges ? 'draft' : 'active'), text: d.hasUnpublishedChanges ? 'Unpublished changes' : 'Live = draft' }),
      el('span', { class: 'muted small', text: `Live version ${d.publishedVersion}${d.publishedAt ? ' · published ' + new Date(d.publishedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : ''}` }),
      saving ? el('span', { class: 'muted small', text: 'Saving…' }) : null].filter(Boolean));
  }
  const reloadPreview = () => { frame.src = P.previewUrl + '&t=' + Date.now(); };
  async function save() {
    if (saving) { pending = true; return; }
    saving = true; drawStatus();
    try {
      const r = await API(base() + '/design/draft', { method: 'PUT', body: { themePreset: D.themePreset, colors: D.colors, typography: D.typography, layout: D.layout, sections: D.sections } });
      P.design = r.design; D = JSON.parse(JSON.stringify(r.design.draft)); reloadPreview();
    } catch (e) { handleDesignError(e); }
    finally { saving = false; drawStatus(); if (pending) { pending = false; save(); } }
  }
  const queue = () => { clearTimeout(timer); timer = setTimeout(save, 700); };
  function handleDesignError(e) {
    if (e.code === 'upgrade_required') { toast(e.message); return; }
    if (e.fields) { const first = Object.entries(e.fields)[0]; toast(first ? first[1] : e.message); } else toast(e.message);
  }
  async function action(path, payload, okMsg) {
    try { const r = await API(base() + '/design/' + path, { method: 'POST', body: payload || {} }); P.design = r.design; D = JSON.parse(JSON.stringify(r.design.draft)); toast(okMsg); drawAll(); reloadPreview(); }
    catch (e) { handleDesignError(e); }
  }

  // ---- presets
  const presetBox = el('div', { class: 'card' });
  function drawPresets() {
    presetBox.replaceChildren(el('h2', { text: 'Theme' }), el('p', { class: 'muted small', text: 'Start from a ready-made look. Your sections and text are kept.' }),
      el('div', { class: 'dz-presets' }, P.presets.map((p) => el('button', { type: 'button', class: 'dz-preset' + (D.themePreset === p.id ? ' on' : ''), 'aria-pressed': D.themePreset === p.id ? 'true' : 'false', onclick: () => action('preset', { presetId: p.id }, p.name + ' applied to your draft') },
        el('span', { class: 'dz-sw' }, ['heroBg', 'primary', 'accent', 'background'].map((k) => el('i', { style: 'background:' + p.colors[k] }))),
        el('b', { text: p.name }), el('span', { class: 'muted small', text: p.description })))));
  }

  // ---- colours + typography
  const lookBox = el('div', { class: 'card' });
  function drawLook() {
    const kids = [el('h2', { text: 'Colours & fonts' })];
    if (!canCustom) kids.push(upgradeNote('Custom colours and fonts are part of the Pro plan. On Free you can use any theme above and edit every section.', 'customDesign'));
    const grid = el('div', { class: 'dz-colors' });
    Object.keys(COLOR_LABELS).forEach((k) => {
      const inp = el('input', { type: 'color', value: D.colors[k], 'aria-label': COLOR_LABELS[k], disabled: canCustom ? null : '' });
      inp.addEventListener('input', () => { D.colors[k] = inp.value; D.themePreset = 'custom'; queue(); });
      grid.append(el('label', { class: 'dz-color' }, inp, el('span', { text: COLOR_LABELS[k] })));
    });
    const font = select('dzFont', 'Font', P.fonts.map((f) => [f.id, f.label]), D.typography.fontId);
    const weight = select('dzWeight', 'Heading weight', [['800', 'Extra bold'], ['700', 'Bold']], D.typography.headingWeight);
    const size = select('dzSize', 'Text size', [['14', 'Small'], ['15', 'Compact'], ['16', 'Normal'], ['17', 'Large'], ['18', 'Extra large']], String(D.typography.baseSizePx));
    [[font, 'fontId', String], [weight, 'headingWeight', String], [size, 'baseSizePx', Number]].forEach(([w, k, cast]) => {
      const s = w.querySelector('select'); if (!canCustom) s.disabled = true;
      s.addEventListener('change', () => { D.typography[k] = cast(s.value); D.themePreset = 'custom'; queue(); });
    });
    kids.push(grid, el('div', { class: 'two' }, font, weight), size);
    lookBox.replaceChildren(...kids);
  }

  // ---- layout
  const layoutBox = el('div', { class: 'card' });
  function drawLayout() {
    const rows = Object.keys(LAYOUT_OPTS).map((k) => {
      const w = select('dzL' + k, LAYOUT_LABELS[k], LAYOUT_OPTS[k], String(D.layout[k]));
      w.querySelector('select').addEventListener('change', (e) => { D.layout[k] = k.startsWith('gridCols') ? Number(e.target.value) : e.target.value; queue(); });
      return w;
    });
    const chk = (k, label) => { const i = el('input', { type: 'checkbox' }); i.checked = D.layout[k] !== false; i.addEventListener('change', () => { D.layout[k] = i.checked; queue(); }); return el('label', { class: 'chk' }, i, label); };
    layoutBox.replaceChildren(el('h2', { text: 'Layout' }), el('div', { class: 'dz-layout' }, rows), chk('showSearch', 'Show the search box'), chk('showWhatsapp', 'Show WhatsApp buttons'));
  }

  // ---- sections
  const secBox = el('div', { class: 'card' });
  const typeInfo = (t) => P.sectionTypes.find((x) => x.type === t) || { label: t, description: '' };
  function settingInput(sec, key) {
    const v = sec.settings[key];
    const id = `dz_${sec.id}_${key}`;
    const onChange = (val) => { sec.settings[key] = val; queue(); };
    if (typeof v === 'boolean') { const i = el('input', { type: 'checkbox', id }); i.checked = v; i.addEventListener('change', () => onChange(i.checked)); return el('label', { class: 'chk' }, i, SETTING_LABELS[key] || key); }
    if (typeof v === 'number') { const w = select(id, SETTING_LABELS[key] || key, [2, 3, 4, 6, 8, 12, 16].map((n) => [String(n), String(n)]), String(v)); w.querySelector('select').addEventListener('change', (e) => onChange(Number(e.target.value))); return w; }
    if (key === 'imageUrl' || key === 'bannerImageUrl') {
      const prev = el('div', { class: 'dz-img' }, v ? el('img', { src: v, alt: '' }) : el('span', { class: 'muted small', text: 'No image' }));
      const file = el('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', 'aria-label': SETTING_LABELS[key] });
      file.addEventListener('change', async () => {
        const f = file.files[0]; if (!f) return;
        if (f.size > 5 * 1024 * 1024) { toast('Images can be up to 5 MB'); return; }
        try { const r = await fetch(`/api${base()}/design/images`, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': f.type }, body: f }); const j = await r.json(); if (!r.ok) throw new Error(j.error.message); onChange(j.url); drawSections(); } catch (e) { toast(e.message); }
      });
      return el('div', {}, el('label', { text: SETTING_LABELS[key] }), prev, el('div', { class: 'row' }, file, v ? el('button', { type: 'button', class: 'link danger-t', text: 'Remove', onclick: () => { onChange(''); drawSections(); } }) : null));
    }
    const area = key === 'body' || key === 'subtext';
    const input = el(area ? 'textarea' : 'input', { id, ...(area ? {} : { type: 'text' }), maxlength: key === 'body' ? '1000' : '240' }); input.value = v == null ? '' : v;
    input.addEventListener('input', () => onChange(input.value));
    return el('div', {}, el('label', { for: id, text: SETTING_LABELS[key] || key }), input, SETTING_HINTS[key] ? el('div', { class: 'hint', text: SETTING_HINTS[key] }) : null);
  }
  function drawSections() {
    const list = el('ol', { class: 'dz-secs' });
    D.sections.forEach((sec, i) => {
      const info = typeInfo(sec.type);
      const body = el('div', { class: 'dz-sec-body hidden' }, el('p', { class: 'muted small', text: info.description }), Object.keys(sec.settings).map((k) => settingInput(sec, k)));
      const en = el('input', { type: 'checkbox', 'aria-label': 'Show ' + info.label }); en.checked = sec.enabled !== false;
      en.addEventListener('change', () => { sec.enabled = en.checked; queue(); });
      const move = (d) => { const j = i + d; if (j < 0 || j >= D.sections.length) return; [D.sections[i], D.sections[j]] = [D.sections[j], D.sections[i]]; drawSections(); queue(); };
      list.append(el('li', { class: 'dz-sec' + (sec.enabled === false ? ' off' : '') },
        el('div', { class: 'dz-sec-head' }, en, el('b', { class: 'grow', text: info.label }),
          el('button', { type: 'button', class: 'link', 'aria-label': 'Move up', text: '↑', disabled: i === 0 ? '' : null, onclick: () => move(-1) }),
          el('button', { type: 'button', class: 'link', 'aria-label': 'Move down', text: '↓', disabled: i === D.sections.length - 1 ? '' : null, onclick: () => move(1) }),
          el('button', { type: 'button', class: 'link', text: 'Edit', onclick: () => body.classList.toggle('hidden') }),
          sec.type === 'catalog_grid' && D.sections.filter((x) => x.type === 'catalog_grid').length === 1 ? null : el('button', { type: 'button', class: 'link danger-t', text: 'Remove', onclick: () => { D.sections.splice(i, 1); drawSections(); queue(); } })),
        body));
    });
    const add = select('dzAdd', null, [['', '+ Add a section…'], ...P.sectionTypes.map((t) => [t.type, t.label])], '');
    add.querySelector('select').addEventListener('change', (e) => {
      const t = typeInfo(e.target.value); if (!e.target.value) return;
      if (D.sections.length >= 12) { toast('A storefront can have up to 12 sections'); e.target.value = ''; return; }
      D.sections.push({ id: 'sec_' + Math.random().toString(36).slice(2, 10), type: t.type, enabled: true, settings: JSON.parse(JSON.stringify(t.defaultSettings)) });
      e.target.value = ''; drawSections(); queue();
    });
    secBox.replaceChildren(el('h2', { text: 'Homepage sections' }), el('p', { class: 'muted small', text: 'Turn sections on or off, reorder them and edit their text. The product catalogue is always kept.' }), list, add);
  }

  // ---- history
  const histBox = el('div', { class: 'card' });
  function drawHistory() {
    const h = P.design.history;
    histBox.replaceChildren(el('h2', { text: 'Version history' }), el('p', { class: 'muted small', text: `Your last ${P.plan.versions} published versions are kept. Restoring puts a version back into your draft.` }),
      ...(h.length ? h.map((v) => el('div', { class: 'row-item' }, el('div', { class: 'grow' }, el('b', { text: v.label }), el('div', { class: 'muted small', text: `Version ${v.versionNumber} · ${new Date(v.publishedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}` })),
        el('button', { type: 'button', class: 'link', text: 'Restore to draft', onclick: () => action('restore', { versionId: v.versionId }, 'Version restored to your draft') }))) : [el('p', { class: 'muted', text: 'No earlier versions yet. Each publish keeps the previous live design here.' })]));
  }

  function drawAll() { drawStatus(); drawPresets(); drawLook(); drawLayout(); drawSections(); drawHistory(); }
  drawAll();

  const devices = el('div', { class: 'dz-devices', role: 'group', 'aria-label': 'Preview size' }, [['desktop', 'Desktop'], ['tablet', 'Tablet'], ['mobile', 'Mobile']].map(([k, t]) =>
    el('button', { type: 'button', class: 'link' + (k === 'desktop' ? ' on' : ''), text: t, onclick: (ev) => { stage.className = 'dz-stage ' + k; devices.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === ev.target)); } })));
  const bar = el('div', { class: 'dz-bar' }, status, el('div', { class: 'dz-actions' },
    el('a', { class: 'link', href: P.previewUrl, target: '_blank', rel: 'noopener', text: 'Open preview' }),
    el('button', { type: 'button', class: 'link', text: 'Discard draft', onclick: () => { if (confirm('Throw away all unpublished changes and go back to the live design?')) action('discard', {}, 'Draft discarded'); } }),
    el('button', { type: 'button', class: 'link', text: 'Reset to default', onclick: () => { if (confirm('Reset the draft to the default STORVA design? Your live store is not changed until you publish.')) action('reset', {}, 'Draft reset'); } }),
    el('button', { type: 'button', class: 'btn-link', text: 'Publish', onclick: async () => { clearTimeout(timer); if (saving || pending) await new Promise((r) => setTimeout(r, 900)); else await save(); action('publish', {}, 'Published! Your store now shows this design.'); } })));
  root.classList.add('wide');
  return [el('div', { class: 'head' }, el('h1', { text: 'Designer' })), bar,
    el('div', { class: 'dz' }, el('div', { class: 'dz-controls' }, presetBox, lookBox, layoutBox, secBox, histBox), el('div', { class: 'dz-preview' }, devices, stage))];
}
