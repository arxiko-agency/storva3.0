/* Landing extras: brand + WhatsApp button from server config, live storefront gallery from API. */
(function () {
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  fetch('/api/config/public')
    .then((r) => (r.ok ? r.json() : null))
    .then((c) => {
      if (!c) return;
      if (c.brand) {
        document.querySelectorAll('[data-brand]').forEach((e) => {
          e.textContent = e.textContent === e.textContent.toUpperCase() && e.textContent.length > 1 ? c.brand.toUpperCase() : c.brand;
        });
        document.title = c.brand + ' – Launch your online store';
      }
      if (c.supportWhatsapp) {
        const link = 'https://wa.me/' + c.supportWhatsapp + '?text=' + encodeURIComponent('Hi! I\u2019m interested in ' + (c.brand || 'your platform') + '. Could you tell me more?');
        ['waFab', 'heroWa'].forEach((id) => { const a = document.getElementById(id); a.href = link; a.classList.remove('hidden'); });
      }
      if (c.supportEmail) { const a = document.getElementById('ftContact'); a.href = 'mailto:' + c.supportEmail; a.classList.remove('hidden'); }
      if (c.instagramUrl) { const a = document.getElementById('ftIg'); a.href = c.instagramUrl; a.classList.remove('hidden'); }
    })
    .catch(() => {});

  // Gallery stays hidden until the API returns real, opted-in stores (added in Module 3).
  fetch('/api/public/showcase')
    .then((r) => (r.ok ? r.json() : { stores: [] }))
    .then(({ stores }) => {
      if (!Array.isArray(stores) || !stores.length) return;
      document.getElementById('showcaseGrid').innerHTML = stores
        .map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener" class="rv in block bg-white rounded-3xl overflow-hidden border border-black/5 hover:-translate-y-1 hover:shadow-xl transition">
          <div class="h-36 bg-mist" style="${s.cover ? `background:url('${esc(s.cover)}') center/cover` : ''}"></div>
          <div class="p-4"><b>${esc(s.name)}</b></div></a>`)
        .join('');
      document.getElementById('showcase').classList.remove('hidden');
    })
    .catch(() => {});
})();
