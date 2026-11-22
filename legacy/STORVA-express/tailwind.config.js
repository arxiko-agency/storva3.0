'use strict';
// Module 15: Tailwind is compiled at build time (npm run build:css -> public/css/tailwind.css) instead of the in-browser CDN build,
// so the landing / legal pages can run under a strict Content-Security-Policy (no third-party or eval'd script).
module.exports = {
  content: ['./public/index.html', './public/privacy.html', './public/terms.html', './public/js/app.js', './public/js/auth.js', './public/js/landing-extras.js'],
  theme: { extend: { colors: { ink: '#14122B', iris: '#6C4CF5', sun: '#FFB22E', mint: '#19B58A', mist: '#F3F4FA' }, fontFamily: { sans: ['"Bricolage Grotesque"', 'system-ui', 'sans-serif'] } } },
  plugins: [],
};
