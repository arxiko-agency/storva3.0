'use strict';

// Safe own-property check: plain `obj[key]` is truthy for keys like 'constructor' or '__proto__'.
function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

const APPROVED_FONTS = Object.freeze({
  bricolage: {
    id: 'bricolage',
    label: 'Bricolage Grotesque (Default)',
    cssFamily: "'Bricolage Grotesque', system-ui, -apple-system, sans-serif",
    googleFamily: 'Bricolage+Grotesque:opsz,wght@12..96,400;12..96,600;12..96,800',
  },
  plus_jakarta: {
    id: 'plus_jakarta',
    label: 'Plus Jakarta Sans',
    cssFamily: "'Plus Jakarta Sans', system-ui, -apple-system, sans-serif",
    googleFamily: 'Plus+Jakarta+Sans:wght@400;600;700;800',
  },
  inter: {
    id: 'inter',
    label: 'Inter',
    cssFamily: "'Inter', system-ui, -apple-system, sans-serif",
    googleFamily: 'Inter:wght@400;600;700;800',
  },
  dm_sans: {
    id: 'dm_sans',
    label: 'DM Sans',
    cssFamily: "'DM Sans', system-ui, -apple-system, sans-serif",
    googleFamily: 'DM+Sans:wght@400;500;700',
  },
  poppins: {
    id: 'poppins',
    label: 'Poppins',
    cssFamily: "'Poppins', system-ui, -apple-system, sans-serif",
    googleFamily: 'Poppins:wght@400;600;700',
  },
  playfair: {
    id: 'playfair',
    label: 'Playfair Display (Editorial)',
    cssFamily: "'Playfair Display', Georgia, serif",
    googleFamily: 'Playfair+Display:wght@500;700;800',
  },
  lora: {
    id: 'lora',
    label: 'Lora (Classic Serif)',
    cssFamily: "'Lora', Georgia, serif",
    googleFamily: 'Lora:wght@400;600;700',
  },
  system: {
    id: 'system',
    label: 'System Sans (Fastest)',
    cssFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    googleFamily: null,
  },
});

const RADIUS_MAP = Object.freeze({
  sharp: { card: '4px', button: '6px', input: '4px', badge: '4px' },
  rounded: { card: '18px', button: '999px', input: '12px', badge: '99px' },
  pill: { card: '26px', button: '999px', input: '999px', badge: '999px' },
});

const SECTION_CATALOG = Object.freeze({
  hero: {
    type: 'hero',
    label: 'Store Hero',
    description: 'Main store banner with logo, tagline and primary call to action.',
    defaultSettings: {
      heading: '',
      subheading: '',
      ctaText: 'Shop collection',
      ctaHref: '#catalog',
      showWhatsapp: true,
      bannerImageUrl: '',
    },
  },
  promo_banner: {
    type: 'promo_banner',
    label: 'Announcement / Promo Banner',
    description: 'Highlight offers, free shipping thresholds or seasonal drops.',
    defaultSettings: {
      badge: 'LIMITED OFFER',
      heading: 'Fresh arrivals now in stock',
      subtext: 'Order online or message us directly on WhatsApp.',
      ctaText: 'Browse items',
      ctaHref: '#catalog',
      imageUrl: '',
    },
  },
  collections_bar: {
    type: 'collections_bar',
    label: 'Collections Filter Bar',
    description: 'Interactive category & collection chips for quick browsing.',
    defaultSettings: {
      title: 'Shop by collection',
      showCounts: true,
    },
  },
  featured_products: {
    type: 'featured_products',
    label: 'Featured Products',
    description: 'Curated showcase of your newest or spotlighted items.',
    defaultSettings: {
      title: 'Featured picks',
      subtitle: 'Popular items from our catalogue',
      limit: 4,
    },
  },
  catalog_grid: {
    type: 'catalog_grid',
    label: 'Full Product Catalog',
    description: 'Searchable, sortable and paginated product grid.',
    defaultSettings: {
      title: 'All products',
      showSort: true,
    },
  },
  about_story: {
    type: 'about_story',
    label: 'Brand Story',
    description: 'Share what makes your business and products special.',
    defaultSettings: {
      title: 'Our story',
      body: '',
      imageUrl: '',
    },
  },
  trust_badges: {
    type: 'trust_badges',
    label: 'Trust & Service Highlights',
    description: 'Three key assurances for shoppers (delivery, payments, support).',
    defaultSettings: {
      title: 'Why shop with us',
      item1Title: 'Fast dispatch',
      item1Text: 'Carefully packed and shipped promptly.',
      item2Title: 'Safe checkout',
      item2Text: 'Easy online payments and cash on delivery.',
      item3Title: 'WhatsApp support',
      item3Text: 'Direct help from our team anytime.',
    },
  },
  contact_cta: {
    type: 'contact_cta',
    label: 'WhatsApp & Contact Strip',
    description: 'Bottom callout inviting shoppers to reach out with questions.',
    defaultSettings: {
      heading: 'Have a question before ordering?',
      subtext: 'Message us on WhatsApp and we will help you pick the right item.',
      buttonText: 'Chat on WhatsApp',
    },
  },
});

const DEFAULT_SECTIONS = Object.freeze([
  { id: 'sec_hero', type: 'hero', enabled: true, settings: { ...SECTION_CATALOG.hero.defaultSettings } },
  { id: 'sec_collections', type: 'collections_bar', enabled: true, settings: { ...SECTION_CATALOG.collections_bar.defaultSettings } },
  { id: 'sec_catalog', type: 'catalog_grid', enabled: true, settings: { ...SECTION_CATALOG.catalog_grid.defaultSettings } },
  { id: 'sec_trust', type: 'trust_badges', enabled: false, settings: { ...SECTION_CATALOG.trust_badges.defaultSettings } },
  { id: 'sec_contact', type: 'contact_cta', enabled: true, settings: { ...SECTION_CATALOG.contact_cta.defaultSettings } },
]);

const THEME_PRESETS = Object.freeze({
  storva_classic: {
    id: 'storva_classic',
    name: 'STORVA Classic',
    description: 'Crisp off-white surface, deep indigo hero and vibrant iris accents.',
    colors: {
      primary: '#6C4CF5',
      accent: '#FFB22E',
      background: '#F7F8FC',
      surface: '#FFFFFF',
      text: '#14122B',
      muted: '#6B6A85',
      heroBg: '#14122B',
      heroText: '#FFFFFF',
    },
    typography: { fontId: 'bricolage', headingWeight: '800', baseSizePx: 16 },
    layout: {
      headerStyle: 'sticky',
      heroStyle: 'split',
      cardStyle: 'elevated',
      radius: 'rounded',
      gridColsDesktop: 4,
      gridColsMobile: 2,
      showSearch: true,
      showWhatsapp: true,
    },
  },
  emerald_craft: {
    id: 'emerald_craft',
    name: 'Emerald Craft',
    description: 'Warm ivory canvas with rich forest green headers for handmade brands.',
    colors: {
      primary: '#0F766E',
      accent: '#D97706',
      background: '#FAF8F5',
      surface: '#FFFFFF',
      text: '#1C2420',
      muted: '#5C6B63',
      heroBg: '#0D3B36',
      heroText: '#FFFFFF',
    },
    typography: { fontId: 'plus_jakarta', headingWeight: '800', baseSizePx: 16 },
    layout: {
      headerStyle: 'sticky',
      heroStyle: 'split',
      cardStyle: 'bordered',
      radius: 'rounded',
      gridColsDesktop: 3,
      gridColsMobile: 2,
      showSearch: true,
      showWhatsapp: true,
    },
  },
  warm_terracotta: {
    id: 'warm_terracotta',
    name: 'Warm Terracotta',
    description: 'Earthy clay tones and editorial serif typography for boutiques & food.',
    colors: {
      primary: '#C2410C',
      accent: '#F59E0B',
      background: '#FFFBF7',
      surface: '#FFFFFF',
      text: '#291D18',
      muted: '#7A6258',
      heroBg: '#431407',
      heroText: '#FFF7ED',
    },
    typography: { fontId: 'lora', headingWeight: '700', baseSizePx: 16 },
    layout: {
      headerStyle: 'centered',
      heroStyle: 'banner',
      cardStyle: 'elevated',
      radius: 'rounded',
      gridColsDesktop: 3,
      gridColsMobile: 2,
      showSearch: true,
      showWhatsapp: true,
    },
  },
  midnight_luxe: {
    id: 'midnight_luxe',
    name: 'Midnight Luxe',
    description: 'High-contrast obsidian theme with warm gold highlights.',
    colors: {
      primary: '#D4AF37',
      accent: '#FDE68A',
      background: '#0F1117',
      surface: '#181B24',
      text: '#F8FAFC',
      muted: '#94A3B8',
      heroBg: '#090A0F',
      heroText: '#F8FAFC',
    },
    typography: { fontId: 'playfair', headingWeight: '700', baseSizePx: 16 },
    layout: {
      headerStyle: 'sticky',
      heroStyle: 'banner',
      cardStyle: 'bordered',
      radius: 'sharp',
      gridColsDesktop: 4,
      gridColsMobile: 2,
      showSearch: true,
      showWhatsapp: true,
    },
  },
  minimal_studio: {
    id: 'minimal_studio',
    name: 'Minimal Studio',
    description: 'Clean monochrome gallery layout that keeps focus on product photography.',
    colors: {
      primary: '#18181B',
      accent: '#2563EB',
      background: '#FFFFFF',
      surface: '#FAFAFA',
      text: '#18181B',
      muted: '#71717A',
      heroBg: '#F4F4F5',
      heroText: '#18181B',
    },
    typography: { fontId: 'inter', headingWeight: '700', baseSizePx: 15 },
    layout: {
      headerStyle: 'minimal',
      heroStyle: 'compact',
      cardStyle: 'flat',
      radius: 'sharp',
      gridColsDesktop: 4,
      gridColsMobile: 2,
      showSearch: true,
      showWhatsapp: true,
    },
  },
});

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function createDefaultDesign() {
  const base = THEME_PRESETS.storva_classic;
  return {
    themePreset: base.id,
    colors: cloneJson(base.colors),
    typography: cloneJson(base.typography),
    layout: cloneJson(base.layout),
    sections: cloneJson(DEFAULT_SECTIONS),
  };
}

function getFontMeta(fontId) {
  return typeof fontId === 'string' && hasOwn(APPROVED_FONTS, fontId) ? APPROVED_FONTS[fontId] : APPROVED_FONTS.bricolage;
}

function getGoogleFontHref(fontId) {
  const meta = getFontMeta(fontId);
  if (!meta.googleFamily) return null;
  return `https://fonts.googleapis.com/css2?family=${meta.googleFamily}&display=swap`;
}

function darkenHex(hex, ratio = 0.14) {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return '#5638d8';
  const r = Math.max(0, Math.round(parseInt(hex.slice(1, 3), 16) * (1 - ratio)));
  const g = Math.max(0, Math.round(parseInt(hex.slice(3, 5), 16) * (1 - ratio)));
  const b = Math.max(0, Math.round(parseInt(hex.slice(5, 7), 16) * (1 - ratio)));
  return `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`;
}

function hexContrastText(hex) {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return '#ffffff';
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.62 ? '#14122B' : '#FFFFFF';
}

function isSafeHex(val) {
  return typeof val === 'string' && /^#[0-9a-fA-F]{6}$/.test(val);
}

function designToCss(design) {
  const def = createDefaultDesign();
  const c = (design && design.colors) || {};
  const t = (design && design.typography) || {};
  const l = (design && design.layout) || {};

  const primary = isSafeHex(c.primary) ? c.primary : def.colors.primary;
  const accent = isSafeHex(c.accent) ? c.accent : def.colors.accent;
  const background = isSafeHex(c.background) ? c.background : def.colors.background;
  const surface = isSafeHex(c.surface) ? c.surface : def.colors.surface;
  const text = isSafeHex(c.text) ? c.text : def.colors.text;
  const muted = isSafeHex(c.muted) ? c.muted : def.colors.muted;
  const heroBg = isSafeHex(c.heroBg) ? c.heroBg : def.colors.heroBg;
  const heroText = isSafeHex(c.heroText) ? c.heroText : def.colors.heroText;

  const font = getFontMeta(t.fontId);
  const headingWeight = t.headingWeight === '700' ? '700' : '800';
  const baseSizePx = Number.isInteger(t.baseSizePx) && t.baseSizePx >= 14 && t.baseSizePx <= 18 ? t.baseSizePx : 16;

  const radii = typeof l.radius === 'string' && hasOwn(RADIUS_MAP, l.radius) ? RADIUS_MAP[l.radius] : RADIUS_MAP.rounded;
  const colsDesktop = [2, 3, 4].includes(Number(l.gridColsDesktop)) ? Number(l.gridColsDesktop) : 4;
  const colsMobile = [1, 2].includes(Number(l.gridColsMobile)) ? Number(l.gridColsMobile) : 2;
  const primaryHover = darkenHex(primary, 0.14);
  const primaryText = hexContrastText(primary);

  return [
    ':root {',
    `  --ink: ${text};`,
    `  --iris: ${primary};`,
    `  --iris-d: ${primaryHover};`,
    `  --iris-fg: ${primaryText};`,
    `  --sun: ${accent};`,
    `  --bg: ${background};`,
    `  --surface: ${surface};`,
    `  --muted: ${muted};`,
    `  --hero-bg: ${heroBg};`,
    `  --hero-fg: ${heroText};`,
    `  --font-body: ${font.cssFamily};`,
    `  --heading-weight: ${headingWeight};`,
    `  --base-size: ${baseSizePx}px;`,
    `  --radius-card: ${radii.card};`,
    `  --radius-btn: ${radii.button};`,
    `  --radius-input: ${radii.input};`,
    `  --radius-badge: ${radii.badge};`,
    `  --grid-cols-desktop: ${colsDesktop};`,
    `  --grid-cols-mobile: ${colsMobile};`,
    '}',
  ].join('\n');
}

function listPresetsPublic() {
  return Object.values(THEME_PRESETS).map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    colors: cloneJson(p.colors),
    typography: cloneJson(p.typography),
    layout: cloneJson(p.layout),
  }));
}

function listFontsPublic() {
  return Object.values(APPROVED_FONTS).map((f) => ({
    id: f.id,
    label: f.label,
  }));
}

function listSectionTypesPublic() {
  return Object.values(SECTION_CATALOG).map((s) => ({
    type: s.type,
    label: s.label,
    description: s.description,
    defaultSettings: cloneJson(s.defaultSettings),
  }));
}

module.exports = {
  APPROVED_FONTS,
  RADIUS_MAP,
  SECTION_CATALOG,
  DEFAULT_SECTIONS,
  THEME_PRESETS,
  createDefaultDesign,
  getFontMeta,
  getGoogleFontHref,
  designToCss,
  listPresetsPublic,
  listFontsPublic,
  listSectionTypesPublic,
  cloneJson,
  hasOwn,
};
