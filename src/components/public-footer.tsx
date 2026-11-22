import { Link } from '@tanstack/react-router';
import { ArrowRight, ArrowUp, LifeBuoy, Mail } from 'lucide-react';
import { Brand } from './storva-brand';
import { Reveal } from './scroll-reveal';

/** Optional: set VITE_SUPPORT_EMAIL to show a real support address. Without it, the support link opens the FAQ. */
const SUPPORT_EMAIL = (import.meta.env['VITE_SUPPORT_EMAIL'] as string | undefined)?.trim();

export function PublicFooter() {
  return <footer className="pf" aria-label="Site footer">
    <div className="pf-glow" aria-hidden="true" />
    <div className="site-width">
      <div className="pf-grid">
        <Reveal className="pf-brand">
          <Link to="/" aria-label="STORVA home"><Brand /></Link>
          <p>STORVA helps small businesses launch a clean, modern online store, manage products and orders, and grow with confidence, all from a phone or computer.</p>
          <div className="pf-actions">
            <Link to="/login" className="pf-btn pf-btn-primary">Start for Free <ArrowRight /></Link>
            <Link to="/login" className="pf-btn">Log in</Link>
          </div>
        </Reveal>
        <Reveal delay={1} className="pf-col">
          <h4>Product</h4>
          <Link to="/" hash="features">Features</Link>
          <Link to="/" hash="how-it-works">How It Works</Link>
          <Link to="/" hash="pricing">Pricing</Link>
          <Link to="/" hash="faq">FAQ</Link>
        </Reveal>
        <Reveal delay={2} className="pf-col">
          <h4>Company</h4>
          <Link to="/about">About</Link>
          <Link to="/services">Services</Link>
        </Reveal>
        <Reveal delay={3} className="pf-col">
          <h4>Support &amp; legal</h4>
          {SUPPORT_EMAIL
            ? <a href={`mailto:${SUPPORT_EMAIL}`} className="pf-with-icon"><Mail />Contact &amp; support</a>
            : <Link to="/faq" className="pf-with-icon"><LifeBuoy />Contact &amp; support</Link>}
          {SUPPORT_EMAIL && <span className="pf-email">{SUPPORT_EMAIL}</span>}
          <Link to="/privacy">Privacy Policy</Link>
          <Link to="/terms">Terms &amp; Conditions</Link>
        </Reveal>
      </div>
      <div className="pf-bottom">
        <span>© 2026 STORVA. All rights reserved.</span>
        <span className="pf-tagline">Your business deserves a better online store.</span>
        <button type="button" className="pf-top" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} aria-label="Back to top"><ArrowUp /></button>
      </div>
    </div>
    <div className="pf-mark" aria-hidden="true">STORVA</div>
  </footer>;
}
