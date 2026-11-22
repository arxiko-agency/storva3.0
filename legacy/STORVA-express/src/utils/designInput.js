'use strict';

const crypto = require('crypto');
const {
  APPROVED_FONTS,
  RADIUS_MAP,
  SECTION_CATALOG,
  THEME_PRESETS,
  createDefaultDesign,
  cloneJson,
  hasOwn,
} = require('./themes');

const COLOR_KEYS = ['primary', 'accent', 'background', 'surface', 'text', 'muted', 'heroBg', 'heroText'];
const HEADER_STYLES = ['sticky', 'minimal', 'centered'];
const HERO_STYLES = ['split', 'banner', 'compact'];
const CARD_STYLES = ['elevated', 'bordered', 'flat'];
const HEADING_WEIGHTS = ['700', '800'];
const MAX_SECTIONS = 12;

function isPlainObject(v) {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

// Boolean("false") is true in JS, so read string flags explicitly.
function toBool(v) {
  if (typeof v === 'string') return ['true', '1', 'yes', 'on'].includes(v.trim().toLowerCase());
  return Boolean(v);
}

function cleanText(val, maxLen) {
  if (val === undefined || val === null) return '';
  return String(val)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim()
    .slice(0, maxLen);
}

function isSafeHex(val) {
  return typeof val === 'string' && /^#[0-9a-fA-F]{6}$/.test(val.trim());
}

function isSafeAssetUrl(val) {
  if (!val) return true;
  if (typeof val !== 'string') return false;
  const s = val.trim();
  if (s === '') return true;
  if (s.length > 300) return false;
  if (s.includes('..') || s.includes('\\') || /[\s"'<>`]/.test(s)) return false;
  return /^\/uploads\/[a-zA-Z0-9._/-]+$/.test(s);
}

function isSafeHref(val) {
  if (!val) return true;
  if (typeof val !== 'string') return false;
  const s = val.trim();
  if (s === '') return true;
  if (s.length > 200 || /[\s"'<>`]/.test(s)) return false;
  if (s.startsWith('#')) return /^#[a-zA-Z0-9_-]{1,64}$/.test(s);
  if (s.startsWith('/')) return !s.startsWith('//') && /^\/[a-zA-Z0-9/_?&=%.-]*$/.test(s);
  return false;
}

function sanitizeSectionSettings(type, rawSettings, errors, index) {
  const spec = SECTION_CATALOG[type];
  const base = cloneJson(spec.defaultSettings);
  const src = isPlainObject(rawSettings) ? rawSettings : {};
  const out = { ...base };

  const textLimits = {
    heading: 120,
    subheading: 200,
    subtext: 240,
    badge: 32,
    title: 80,
    subtitle: 160,
    ctaText: 40,
    buttonText: 40,
    body: 1000,
    item1Title: 50,
    item1Text: 140,
    item2Title: 50,
    item2Text: 140,
    item3Title: 50,
    item3Text: 140,
  };

  for (const key of Object.keys(base)) {
    if (src[key] === undefined) continue;
    const defaultVal = base[key];

    if (typeof defaultVal === 'boolean') {
      out[key] = toBool(src[key]);
    } else if (typeof defaultVal === 'number') {
      const n = Number(src[key]);
      if (!Number.isInteger(n) || n < 2 || n > 16) {
        errors[`sections.${index}.settings.${key}`] = 'Must be an integer between 2 and 16';
      } else {
        out[key] = n;
      }
    } else if (key === 'imageUrl' || key === 'bannerImageUrl') {
      const url = typeof src[key] === 'string' ? src[key].trim() : '';
      if (!isSafeAssetUrl(url)) {
        errors[`sections.${index}.settings.${key}`] = 'Only uploaded store image paths (/uploads/...) are allowed';
      } else {
        out[key] = url;
      }
    } else if (key === 'ctaHref') {
      const href = typeof src[key] === 'string' ? src[key].trim() : '';
      if (!isSafeHref(href)) {
        errors[`sections.${index}.settings.${key}`] = 'Use a section anchor (#catalog) or internal store path';
      } else {
        out[key] = href || '#catalog';
      }
    } else {
      const limit = textLimits[key] || 120;
      const rawText = src[key];
      if (rawText === null) {
        out[key] = '';
      } else if (typeof rawText !== 'string' && typeof rawText !== 'number') {
        errors[`sections.${index}.settings.${key}`] = 'Must be text';
      } else {
        out[key] = cleanText(rawText, limit);
      }
    }
  }

  return out;
}

function validateDesignInput(payload, fallbackDesign) {
  if (!isPlainObject(payload)) {
    return { ok: false, errors: { design: 'Design payload must be an object' } };
  }

  const base = fallbackDesign ? cloneJson(fallbackDesign) : createDefaultDesign();
  const errors = {};

  let themePreset = base.themePreset || 'storva_classic';
  if (payload.themePreset !== undefined) {
    const p = String(payload.themePreset || '').trim();
    if (p !== 'custom' && !hasOwn(THEME_PRESETS, p)) {
      errors.themePreset = 'Unknown theme preset';
    } else {
      themePreset = p;
    }
  }

  const colors = { ...base.colors };
  if (payload.colors !== undefined) {
    if (!isPlainObject(payload.colors)) {
      errors.colors = 'Colors must be an object';
    } else {
      for (const k of COLOR_KEYS) {
        if (payload.colors[k] === undefined) continue;
        if (!isSafeHex(payload.colors[k])) {
          errors[`colors.${k}`] = 'Enter a valid 6-digit hex colour such as #6C4CF5';
        } else {
          colors[k] = payload.colors[k].trim().toLowerCase();
        }
      }
    }
  }

  const typography = { ...base.typography };
  if (payload.typography !== undefined) {
    if (!isPlainObject(payload.typography)) {
      errors.typography = 'Typography must be an object';
    } else {
      if (payload.typography.fontId !== undefined) {
        const f = String(payload.typography.fontId || '').trim();
        if (!hasOwn(APPROVED_FONTS, f)) {
          errors['typography.fontId'] = 'Selected font is not in the approved list';
        } else {
          typography.fontId = f;
        }
      }
      if (payload.typography.headingWeight !== undefined) {
        const w = String(payload.typography.headingWeight);
        if (!HEADING_WEIGHTS.includes(w)) {
          errors['typography.headingWeight'] = 'Heading weight must be 700 or 800';
        } else {
          typography.headingWeight = w;
        }
      }
      if (payload.typography.baseSizePx !== undefined) {
        const sz = Number(payload.typography.baseSizePx);
        if (!Number.isInteger(sz) || sz < 14 || sz > 18) {
          errors['typography.baseSizePx'] = 'Base font size must be between 14 and 18 px';
        } else {
          typography.baseSizePx = sz;
        }
      }
    }
  }

  const layout = { ...base.layout };
  if (payload.layout !== undefined) {
    if (!isPlainObject(payload.layout)) {
      errors.layout = 'Layout must be an object';
    } else {
      const raw = payload.layout;
      if (raw.headerStyle !== undefined) {
        if (!HEADER_STYLES.includes(raw.headerStyle)) errors['layout.headerStyle'] = 'Invalid header style';
        else layout.headerStyle = raw.headerStyle;
      }
      if (raw.heroStyle !== undefined) {
        if (!HERO_STYLES.includes(raw.heroStyle)) errors['layout.heroStyle'] = 'Invalid hero style';
        else layout.heroStyle = raw.heroStyle;
      }
      if (raw.cardStyle !== undefined) {
        if (!CARD_STYLES.includes(raw.cardStyle)) errors['layout.cardStyle'] = 'Invalid card style';
        else layout.cardStyle = raw.cardStyle;
      }
      if (raw.radius !== undefined) {
        if (typeof raw.radius !== 'string' || !hasOwn(RADIUS_MAP, raw.radius)) errors['layout.radius'] = 'Invalid corner radius';
        else layout.radius = raw.radius;
      }
      if (raw.gridColsDesktop !== undefined) {
        const cols = Number(raw.gridColsDesktop);
        if (![2, 3, 4].includes(cols)) errors['layout.gridColsDesktop'] = 'Desktop columns must be 2, 3 or 4';
        else layout.gridColsDesktop = cols;
      }
      if (raw.gridColsMobile !== undefined) {
        const cols = Number(raw.gridColsMobile);
        if (![1, 2].includes(cols)) errors['layout.gridColsMobile'] = 'Mobile columns must be 1 or 2';
        else layout.gridColsMobile = cols;
      }
      if (raw.showSearch !== undefined) layout.showSearch = toBool(raw.showSearch);
      if (raw.showWhatsapp !== undefined) layout.showWhatsapp = toBool(raw.showWhatsapp);
    }
  }

  let sections = base.sections;
  if (payload.sections !== undefined) {
    if (!Array.isArray(payload.sections)) {
      errors.sections = 'Sections must be a list';
    } else if (payload.sections.length === 0 || payload.sections.length > MAX_SECTIONS) {
      errors.sections = `Storefront must have between 1 and ${MAX_SECTIONS} sections`;
    } else {
      const seenIds = new Set();
      const cleaned = [];
      let hasCatalog = false;

      payload.sections.forEach((sec, idx) => {
        if (!isPlainObject(sec)) {
          errors[`sections.${idx}`] = 'Invalid section entry';
          return;
        }
        const type = String(sec.type || '').trim();
        if (!hasOwn(SECTION_CATALOG, type)) {
          errors[`sections.${idx}.type`] = `Unsupported section type: ${type || 'empty'}`;
          return;
        }
        const enabled = sec.enabled === undefined ? true : toBool(sec.enabled);
        if (type === 'catalog_grid' && enabled) {
          hasCatalog = true;
        }

        let id = typeof sec.id === 'string' ? sec.id.trim() : '';
        if (!/^[a-zA-Z0-9_-]{3,40}$/.test(id) || seenIds.has(id)) {
          id = `sec_${crypto.randomBytes(4).toString('hex')}`;
        }
        seenIds.add(id);

        const settings = sanitizeSectionSettings(type, sec.settings, errors, idx);
        cleaned.push({
          id,
          type,
          enabled,
          settings,
        });
      });

      if (!hasCatalog && !errors.sections) {
        errors.sections = 'Keep at least one enabled "All products" (catalog_grid) section';
      }
      sections = cleaned;
    }
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      themePreset,
      colors,
      typography,
      layout,
      sections,
    },
  };
}

module.exports = {
  COLOR_KEYS,
  HEADER_STYLES,
  HERO_STYLES,
  CARD_STYLES,
  MAX_SECTIONS,
  cleanText,
  isSafeHex,
  isSafeAssetUrl,
  isSafeHref,
  validateDesignInput,
};
