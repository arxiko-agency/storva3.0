'use strict';
// Content-Security-Policy for the PUBLIC STOREFRONT (/store/*). The storefront is server-rendered with hand-written CSS and one external script
// (/js/storefront.js), so it needs no inline or eval'd script: script-src is 'self' + Razorpay Checkout only, inline event handlers are blocked,
// and plugins / base-tag tricks / foreign framing are blocked. (The merchant dashboard and landing page still use Tailwind's CDN build and inline
// handlers and keep the older relaxed policy until they are rebuilt; see docs/IMPLEMENTATION_STATUS.md.)
// style-src keeps 'unsafe-inline' because Razorpay Checkout and the browser inject <style>; styles cannot run script.
const RAZORPAY = { script: 'https://checkout.razorpay.com', connect: ['https://lumberjack.razorpay.com', 'https://api.razorpay.com', 'https://checkout.razorpay.com'], frame: ['https://api.razorpay.com', 'https://checkout.razorpay.com'] };

function storefrontDirectives() {
  return {
    'default-src': ["'self'"],
    'script-src': ["'self'", RAZORPAY.script],
    'script-src-attr': ["'none'"],
    'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
    'font-src': ["'self'", 'https://fonts.gstatic.com'],
    'img-src': ["'self'", 'data:', 'https:'],
    'connect-src': ["'self'", ...RAZORPAY.connect],
    'frame-src': ["'self'", ...RAZORPAY.frame],
    'form-action': ["'self'", 'https://api.razorpay.com'],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'frame-ancestors': ["'self'"],
  };
}
const storefrontCsp = () => Object.entries(storefrontDirectives()).map(([k, v]) => `${k} ${v.join(' ')}`).join('; ');

// Express middleware: overrides the global (relaxed) header for storefront pages. STOREFRONT_CSP=relaxed keeps the old policy (emergency escape hatch).
function storefrontCspMiddleware(env = process.env) {
  const header = storefrontCsp();
  return (req, res, next) => { if (env.STOREFRONT_CSP !== 'relaxed') res.setHeader('Content-Security-Policy', header); next(); };
}
module.exports = { storefrontCsp, storefrontDirectives, storefrontCspMiddleware };
