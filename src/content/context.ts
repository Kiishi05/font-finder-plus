// The words around a picture: its alt text and the post or article it sits in.
// A post that shows a typeface often names it in its text ("noirblancrouge.com/
// fonts/lil-grot… — Lil Grotesk"), even when the picture's lettering is hard to read.

const MAX = 2500;

/** Alt text and the text of the post, card or figure that holds the picture. */
export function pictureContext(el: Element): string[] {
  const out: string[] = [];
  const img = el instanceof HTMLImageElement ? el : el.querySelector('img');
  for (const a of [img?.getAttribute('alt'), el.getAttribute('aria-label'), el.getAttribute('title'), img?.getAttribute('title')]) {
    const t = a?.trim();
    if (t && t.length > 1 && !/^(image|photo|picture)$/i.test(t) && !out.includes(t)) out.push(t);
  }
  // The post, card or figure around it; otherwise a small block just around it (never the whole page).
  let holder: Element | null = el.closest('article, [role="article"], figure, li, [data-testid="tweet"]');
  if (!holder) {
    let up = el.parentElement;
    for (let i = 0; i < 3 && up && up !== document.body && up !== document.documentElement; i++, up = up.parentElement) {
      if (((up as HTMLElement).innerText ?? '').length > 800) break;
      holder = up;
    }
  }
  if (holder) {
    const caption = holder.querySelector('figcaption')?.textContent?.trim();
    if (caption) out.push(caption);
    const text = ((holder as HTMLElement).innerText ?? '').slice(0, MAX);
    for (const line of text.split(/\n+/)) {
      const t = line.trim();
      if (t && !out.includes(t)) out.push(t);
    }
  }
  return out.slice(0, 80);
}

/** Context for a picture found by its address (right-click "Identify the font in this image"). */
export function contextForSrc(src: string): string[] {
  const img = [...document.images].find((i) => i.currentSrc === src || i.src === src);
  return img ? pictureContext(img) : [];
}
