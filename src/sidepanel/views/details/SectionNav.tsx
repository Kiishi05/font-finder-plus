import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * The section pills under the font's head card. They stick below the top bar
 * while the details scroll. The white pill follows the section in view; a click
 * scrolls there and holds the pill on that section while the page scrolls.
 */
export function SectionNav({ items }: { items: [id: string, label: string][] }) {
  const [cur, setCur] = useState(items[0]?.[0] ?? '');
  const nav = useRef<HTMLElement>(null);
  const lock = useRef<{ id: string; until: number } | null>(null);
  const key = items.map((i) => i[0]).join('|');

  useEffect(() => {
    const sync = () => {
      // The section whose top has passed a line just under the sticky bars.
      const line = Math.min(window.innerHeight * 0.33, 160);
      let next = items[0]?.[0] ?? '';
      for (const [id] of items) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= line) next = id;
      }
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4 && window.scrollY > 0) next = items[items.length - 1]?.[0] ?? next;
      if (lock.current && Date.now() < lock.current.until) next = lock.current.id;
      setCur(next);
    };
    const unlock = () => { lock.current = null; };
    sync();
    window.addEventListener('scroll', sync, { passive: true });
    window.addEventListener('resize', sync);
    window.addEventListener('wheel', unlock, { passive: true });
    window.addEventListener('touchmove', unlock, { passive: true });
    window.addEventListener('keydown', unlock);
    return () => {
      window.removeEventListener('scroll', sync);
      window.removeEventListener('resize', sync);
      window.removeEventListener('wheel', unlock);
      window.removeEventListener('touchmove', unlock);
      window.removeEventListener('keydown', unlock);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // On a narrow panel the bar scrolls sideways: keep the current pill in view.
  useLayoutEffect(() => {
    const n = nav.current;
    const b = n?.querySelector<HTMLButtonElement>(`[data-jump="${cur}"]`);
    if (!n || !b || n.scrollWidth <= n.clientWidth) return;
    const left = b.offsetLeft - 12;
    const right = b.offsetLeft + b.offsetWidth + 12 - n.clientWidth;
    if (n.scrollLeft > left) n.scrollLeft = left;
    else if (n.scrollLeft < right) n.scrollLeft = right;
  }, [cur, key]);

  const jump = (id: string) => {
    lock.current = { id, until: Date.now() + 1200 };
    setCur(id);
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    document.getElementById(id)?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  };

  return (
    <nav ref={nav} className="secnav" aria-label="Sections">
      {items.map(([id, label]) => (
        <button key={id} data-jump={id} aria-current={cur === id ? 'true' : undefined} onClick={() => jump(id)}>{label}</button>
      ))}
    </nav>
  );
}
