'use strict';
// Store slug rules. A slug becomes the public address (storva.app/s/<slug> and later <slug>.domain),
// so it must be URL-safe, predictable, and must never collide with a platform route.
const RESERVED = new Set([
  'www', 'api', 'app', 'admin', 'administrator', 'dashboard', 'login', 'logout', 'signup', 'register', 'auth',
  'static', 'assets', 'public', 'images', 'css', 'js', 'uploads', 'cdn', 'mail', 'email', 'smtp', 'ftp',
  'support', 'help', 'about', 'contact', 'terms', 'privacy', 'pricing', 'blog', 'docs', 'status', 'health',
  'store', 'stores', 'shop', 'shops', 'checkout', 'cart', 'orders', 'order', 'account', 'settings', 'billing',
  'webhook', 'webhooks', 'showcase', 'gallery', 'demo', 'test', 'root', 'system', 'storva', 'brandly', 'null', 'undefined',
  's', 'u', 'p', 'c',
]);

const SLUG_RE = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){1,28}[a-z0-9]$/; // 3-30 chars, no leading/trailing/double hyphen
const MIN = 3, MAX = 30;

function slugify(input) {
  return String(input == null ? '' : input)
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')   // strip accents
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX).replace(/-+$/g, '');
}

// Returns null when valid, otherwise a human-readable reason.
function slugProblem(slug) {
  if (typeof slug !== 'string') return 'Enter a store address.';
  if (slug.length < MIN) return `Store address must be at least ${MIN} characters.`;
  if (slug.length > MAX) return `Store address must be at most ${MAX} characters.`;
  if (!SLUG_RE.test(slug)) return 'Use only lowercase letters, numbers and single hyphens (no hyphen at the start or end).';
  if (RESERVED.has(slug)) return 'This address is reserved. Please choose another.';
  return null;
}

module.exports = { RESERVED, SLUG_RE, MIN, MAX, slugify, slugProblem };
