import { useCallback, useEffect, useRef, useState } from 'react';
import useEmblaCarousel from 'embla-carousel-react';
import skincare from '@/assets/showcase/skincare-store.webp.asset.json';
import coffee from '@/assets/showcase/coffee-store.webp.asset.json';
import toys from '@/assets/showcase/toy-store.webp.asset.json';
import bakery from '@/assets/showcase/bakery-store.webp.asset.json';
import fashion from '@/assets/showcase/fashion-store.webp.asset.json';

const slides = [
  { src: skincare.url, alt: 'A skincare online store shown on a computer and a phone' },
  { src: coffee.url, alt: 'A coffee shop online store shown on a computer and a phone' },
  { src: toys.url, alt: 'A toy shop online store shown on a computer and a phone' },
  { src: bakery.url, alt: 'A bakery online store shown on a computer and a phone' },
  { src: fashion.url, alt: 'A fashion online store shown on a computer and a phone' },
];

const AUTO_MS = 4000;

export function ShowcaseSlider() {
  const [viewportRef, api] = useEmblaCarousel({ loop: true, align: 'center' });
  const [selected, setSelected] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const restart = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = setInterval(() => api?.scrollNext(), AUTO_MS);
  }, [api]);

  useEffect(() => {
    if (!api) return;
    const onSelect = () => setSelected(api.selectedScrollSnap());
    onSelect();
    api.on('select', onSelect);
    api.on('pointerDown', restart);
    restart();
    return () => {
      api.off('select', onSelect);
      api.off('pointerDown', restart);
      if (timer.current) clearInterval(timer.current);
    };
  }, [api, restart]);

  return <section className="showcase" aria-roledescription="carousel" aria-label="Example STORVA stores">
    <div className="showcase-viewport" ref={viewportRef}>
      <div className="showcase-track">
        {slides.map((s, i) => <div className="showcase-slide" key={s.src} role="group" aria-roledescription="slide" aria-label={`${i + 1} of ${slides.length}`}>
          <img src={s.src} alt={s.alt} loading={i === 0 ? 'eager' : 'lazy'} draggable={false} />
        </div>)}
      </div>
    </div>
    <div className="showcase-dots">
      {slides.map((s, i) => <button key={s.src} type="button" className={i === selected ? 'active' : ''} aria-label={`Show slide ${i + 1}`} aria-current={i === selected} onClick={() => { api?.scrollTo(i); restart(); }} />)}
    </div>
  </section>;
}
