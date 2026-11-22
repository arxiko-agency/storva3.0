import { Link } from '@tanstack/react-router';
import { useEffect, useState, type ReactNode } from 'react';
import { Menu, X, ArrowRight, ArrowUpRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Brand } from './storva-brand';
import { PublicFooter } from './public-footer';
import { useSignedIn } from '@/hooks/use-signed-in';

const NAV_LINKS = [['features', 'Features'], ['how-it-works', 'How It Works'], ['pricing', 'Pricing']] as const;

export function PublicShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const signedIn = useSignedIn();

  // Subtle blur + border once the page scrolls under the sticky header.
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Close the mobile menu with Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // Highlight the nav link of the section currently in view (only on pages that have those sections).
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const sections = NAV_LINKS.map(([id]) => document.getElementById(id)).filter((el): el is HTMLElement => !!el);
    if (!sections.length) return;
    const io = new IntersectionObserver(entries => {
      entries.forEach(e => {
        const id = e.target.id;
        if (e.isIntersecting) setActive(id);
        else if (e.boundingClientRect.top > 0) setActive(cur => (cur === id ? null : cur));
      });
    }, { rootMargin: '-40% 0px -55% 0px' });
    sections.forEach(el => io.observe(el));
    return () => io.disconnect();
  }, []);

  return <><header className="public-header" data-scrolled={scrolled || open ? 'true' : 'false'}><div className="site-width header-inner"><Link to="/" aria-label="STORVA home" className="header-brand" onClick={() => setOpen(false)}><Brand /></Link><nav id="primary-nav" className={open ? 'public-nav open' : 'public-nav'} aria-label="Main navigation">{NAV_LINKS.map(([id, label]) => <Link key={id} to="/" hash={id} className={active === id ? 'is-active' : undefined} aria-current={active === id ? 'location' : undefined} onClick={() => setOpen(false)}>{label}</Link>)}{!signedIn && <Link to="/login" className="nav-mobile-only" onClick={() => setOpen(false)}>Log in</Link>}</nav><div className="header-actions">{signedIn ? <Button asChild className="sv-cta"><Link to="/dashboard">My dashboard <ArrowUpRight /></Link></Button> : <><Button asChild variant="ghost" className="login-link"><Link to="/login">Login</Link></Button><Button asChild className="sv-cta"><Link to="/login">Start for Free <ArrowRight /></Link></Button></>}<Button variant="ghost" size="icon" className="mobile-menu" aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open} aria-controls="primary-nav" onClick={() => setOpen(!open)}>{open ? <X /> : <Menu />}</Button></div></div></header>{children}<PublicFooter /></>;
}