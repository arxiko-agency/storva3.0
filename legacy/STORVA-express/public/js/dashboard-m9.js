'use strict';
// Module 9: AI assist panel in the product editor + "Create from photo" on the product list. Suggestions are only applied when the
// owner clicks "Use"; nothing is saved until the normal "Save product" button. Loaded before dashboard.js (uses its helpers at call time).
let AI_META = null;
const aiMeta = async () => AI_META || (AI_META = await API(base() + '/ai'));
const LANG_SHORT = { en: 'English', ml: 'Malayalam', manglish: 'Manglish', hi: 'Hindi', ta: 'Tamil', kn: 'Kannada', te: 'Telugu', bn: 'Bengali', ar: 'Arabic', ur: 'Urdu' };

function aiPhotoButton() {
  const file = el('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', class: 'hidden', 'aria-label': 'Product photo for AI' });
  const btn = el('button', { type: 'button', class: 'btn-ghost', text: '✨ Create from photo', onclick: () => file.click() });
  file.addEventListener('change', async () => {
    const f = file.files[0]; file.value = ''; if (!f) return;
    if (f.size > 5 * 1024 * 1024) { toast('Photos can be up to 5 MB'); return; }
    btn.disabled = true; btn.textContent = '✨ Reading your photo…';
    try {
      const r = await fetch(`/api${base()}/ai/product-from-photo`, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': f.type }, body: f });
      const j = await r.json();
      if (!r.ok) { const e = new Error(j.error.message); e.code = j.error.code; throw e; }
      toast('Draft created. Check the details, set the price and stock, then make it Active.');
      location.hash = '#products/' + j.product.id;
    } catch (e) { toast(e.code === 'upgrade_required' ? 'AI product creation is part of the Pro plan.' : e.message); }
    finally { btn.disabled = false; btn.textContent = '✨ Create from photo'; }
  });
  return el('span', {}, btn, file);
}

function aiAssistCard(form, p) {
  const card = el('div', { class: 'card ai' }, el('div', { class: 'row' }, el('h2', { class: 'grow', text: '✨ AI assist' }), el('span', { class: 'muted small', 'data-credits': '', text: '' })));
  const out = el('div', { class: 'ai-out' });
  const fv = (id) => { const n = form.querySelector('#' + id); return n ? n.value.trim() : ''; };
  const setField = (id, v) => { const n = form.querySelector('#' + id); if (n) { n.value = v; n.dispatchEvent(new Event('input')); n.classList.add('flash'); setTimeout(() => n.classList.remove('flash'), 900); } };
  const lang = select('aiLang', 'Language', Object.entries(LANG_SHORT), 'en');
  const tone = select('aiTone', 'Tone', [['friendly', 'Friendly'], ['premium', 'Premium'], ['playful', 'Playful'], ['simple', 'Simple'], ['persuasive', 'Persuasive']], 'friendly');
  const len = select('aiLen', 'Length', [['short', 'Short'], ['medium', 'Medium'], ['long', 'Long']], 'medium');
  const kw = el('input', { id: 'aiKw', placeholder: 'Optional details: material, size, who it is for…', maxlength: '500' });
  const use = (label, fn) => el('button', { type: 'button', class: 'link', text: label, onclick: fn });
  const box = (title, ...kids) => el('div', { class: 'ai-box' }, el('b', { class: 'small', text: title }), ...kids);
  async function go(tool, extra = {}, btn) {
    const payload = { title: fv('title'), category: fv('category'), description: fv('description'), price: fv('price'), keywords: kw.value.trim(), language: lang.querySelector('select').value, tone: tone.querySelector('select').value, length: len.querySelector('select').value, ...extra };
    if (btn) { btn.disabled = true; btn.dataset.t = btn.textContent; btn.textContent = 'Working…'; }
    try {
      const r = await API(base() + '/ai/' + tool, { method: 'POST', body: payload });
      card.querySelector('[data-credits]').textContent = `${r.creditsLeft} credits left this month`;
      show(tool, r.result);
    } catch (e) { out.replaceChildren(e.code === 'upgrade_required' || e.code === 'ai_credits_exhausted' ? upgradeNote(e.message, 'ai') : el('p', { class: 'err', text: e.message })); }
    finally { if (btn) { btn.disabled = false; btn.textContent = btn.dataset.t; } }
  }
  function show(tool, r) {
    if (tool === 'describe' || tool === 'improve') {
      out.replaceChildren(...[box('Description', el('p', { class: 'ai-text', text: r.description }), use('Use this description', () => setField('description', r.description + (r.bullets && r.bullets.length ? '\n\n' + r.bullets.map((b) => '• ' + b).join('\n') : '')))),
        r.bullets && r.bullets.length ? box('Key points', el('ul', {}, r.bullets.map((b) => el('li', { text: b })))) : null,
        r.seoTitle ? box('Search engine title', el('p', { text: r.seoTitle })) : null, r.changes && r.changes.length ? box('What changed', el('ul', {}, r.changes.map((b) => el('li', { text: b })))) : null].filter(Boolean));
    } else if (tool === 'titles') {
      out.replaceChildren(box('Title ideas', ...r.titles.map((t) => el('div', { class: 'row' }, el('span', { class: 'grow', text: t }), use('Use', () => setField('title', t))))));
    } else if (tool === 'tags') {
      out.replaceChildren(box('Category', el('div', { class: 'row' }, el('span', { class: 'grow', text: r.category }), use('Use', () => setField('category', r.category)))),
        box('Tags', el('p', { text: r.tags.join(', ') }), use('Add these tags', () => { const cur = fv('tags').split(',').map((x) => x.trim()).filter(Boolean); setField('tags', [...new Set([...cur, ...r.tags])].join(', ')); })));
    } else if (tool === 'translate') {
      out.replaceChildren(...r.translations.map((t) => box(t.label, el('p', { class: 'small', text: t.title }), el('p', { class: 'ai-text', text: t.description }), use('Copy', () => navigator.clipboard.writeText(`${t.title}\n\n${t.description}`).then(() => toast('Copied'))))));
    } else if (tool === 'caption') {
      const link = location.origin + '/store/' + S.store.slug + (p ? '/product/' + p.slug : '');
      const text = r.caption + '\n' + link;
      out.replaceChildren(box('WhatsApp message', el('p', { class: 'ai-text', text }), el('div', { class: 'row' }, use('Copy', () => navigator.clipboard.writeText(text).then(() => toast('Copied'))), el('a', { class: 'link', href: 'https://wa.me/?text=' + encodeURIComponent(text), target: '_blank', rel: 'noopener', text: 'Share on WhatsApp' }))));
    } else if (tool === 'photo') {
      out.replaceChildren(box('From your photo', el('p', { class: 'small', text: r.title }), el('p', { class: 'ai-text', text: r.description }), r.attributes.length ? el('p', { class: 'muted small', text: r.attributes.join(' · ') }) : null,
        r.priceHint ? el('p', { class: 'muted small', text: `Typical price range: ₹${r.priceHint.low} – ₹${r.priceHint.high} (a guess — set your own price)` }) : null,
        el('div', { class: 'row' }, use('Use title', () => setField('title', r.title)), use('Use description', () => setField('description', r.description)), use('Use category & tags', () => { setField('category', r.category); setField('tags', r.tags.join(', ')); }))));
    }
  }
  const langs = el('div', { class: 'ai-langs' }, ['ml', 'hi', 'ta', 'kn', 'te', 'ar'].map((l) => el('label', { class: 'chk' }, el('input', { type: 'checkbox', value: l }), LANG_SHORT[l])));
  const btn = (label, tool, extraFn) => el('button', { type: 'button', class: 'btn-ghost', text: label, onclick: (ev) => go(tool, extraFn ? extraFn() : {}, ev.currentTarget) });
  const actions = el('div', { class: 'ai-actions' }, btn('Write description', 'describe'), btn('Improve description', 'improve'), btn('Better titles', 'titles'), btn('Category & tags', 'tags'), btn('WhatsApp caption', 'caption'),
    p && p.images.length ? btn('Describe from photo', 'photo', () => ({ productId: p.id })) : null);
  const tr = el('details', { class: 'ai-tr' }, el('summary', { text: 'Translate…' }), langs, btn('Translate', 'translate', () => ({ languages: [...langs.querySelectorAll('input:checked')].map((i) => i.value) })));
  card.append(el('div', { class: 'two three' }, lang, tone, len), kw, actions, tr, out);
  aiMeta().then((m) => {
    if (!m.enabled) { card.replaceChildren(el('h2', { text: '✨ AI assist' }), upgradeNote('Let AI write descriptions, titles, tags and translations. Part of the Pro plan.', 'ai')); return; }
    if (!m.configured) { card.replaceChildren(el('h2', { text: '✨ AI assist' }), el('p', { class: 'muted', text: 'AI tools are not configured on this server yet. Add GEMINI_API_KEY to enable them.' })); return; }
    card.querySelector('[data-credits]').textContent = `${m.credits.left} of ${m.credits.limit} credits left this month`;
  }).catch(() => {});
  return card;
}
