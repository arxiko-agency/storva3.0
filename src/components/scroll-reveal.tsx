import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';

/**
 * Fades/slides its children in the first time they scroll into view.
 * The hidden starting state exists only once this effect has armed the element (needs IntersectionObserver and
 * motion allowed), so without JS or with reduced motion the content is simply visible.
 */
export function Reveal({ children, className, delay = 0, as: Tag = 'div' }: { children: ReactNode; className?: string; delay?: number; as?: 'div' | 'li' | 'article' | 'header' }) {
  const ref = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    el.dataset.rv = 'armed';
    const io = new IntersectionObserver(([e]) => { if (e?.isIntersecting) { el.dataset.rv = 'in'; io.disconnect(); } }, { rootMargin: '0px 0px -8% 0px', threshold: 0.1 });
    io.observe(el);
    return () => { io.disconnect(); delete el.dataset.rv; };
  }, []);
  return <Tag ref={ref as never} className={className} style={{ '--rd': delay } as CSSProperties}>{children}</Tag>;
}
