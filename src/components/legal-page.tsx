import type { ReactNode } from 'react';
import { PublicShell } from './public-shell';
import { Reveal } from './scroll-reveal';

export function LegalPage({ eyebrow, title, intro, sections, children }: { eyebrow: string; title: string; intro: string; sections: [string, string][]; children?: ReactNode }) {
  return <PublicShell><main>
    <section className="page-intro site-width"><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{intro}</p></section>
    <section className="site-width lg-body">
      {sections.map(([h, p], i) => <Reveal as="article" key={h} delay={Math.min(i, 3)} className="lg-block"><h2>{h}</h2><p>{p}</p></Reveal>)}
      {children}
    </section>
  </main></PublicShell>;
}
