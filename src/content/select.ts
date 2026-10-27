// Drag to select an area of the page (Identify, from the side panel). Returns
// the rectangle in page pixels; the side panel then takes the screenshot.

export function selectArea(): Promise<{ x: number; y: number; w: number; h: number; dpr: number } | null> {
  // While selecting, the page's own clicks are not followed.
  return new Promise((resolve) => {
    const layer = document.createElement('div');
    layer.id = 'ffp-select';
    layer.style.cssText = 'all: initial; position: fixed; inset: 0; z-index: 2147483647; cursor: crosshair; background: rgba(0,0,0,0.25);';
    const box = document.createElement('div');
    box.style.cssText = 'all: initial; position: fixed; border: 2px solid #19C05A; background: rgba(25,192,90,0.12); box-shadow: 0 0 0 9999px rgba(0,0,0,0.25); display: none;';
    const tip = document.createElement('div');
    tip.textContent = 'Drag over the text whose font you want to find. Esc or right-click to cancel.';
    tip.style.cssText = 'all: initial; position: fixed; left: 50%; top: 16px; transform: translateX(-50%); padding: 8px 12px; border-radius: 10px; background: #111; color: #fff; font: 13px system-ui, sans-serif;';
    layer.append(box, tip);
    document.documentElement.appendChild(layer);
    let start: { x: number; y: number } | null = null;
    const done = (r: { x: number; y: number; w: number; h: number } | null) => {
      layer.remove();
      removeEventListener('keydown', onKey, true);
      // Let the page repaint without the overlay before the screenshot (at most 120ms;
      // repaints pause in tabs you cannot see).
      afterPaint(() => resolve(r ? { ...r, dpr: devicePixelRatio } : null));
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        done(null);
      }
    };
    addEventListener('keydown', onKey, true);
    layer.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      done(null);
    });
    layer.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      start = { x: e.clientX, y: e.clientY };
      box.style.display = 'block';
      layer.style.background = 'transparent';
      tip.style.display = 'none';
    });
    layer.addEventListener('mousemove', (e) => {
      if (!start) return;
      const x = Math.min(start.x, e.clientX);
      const y = Math.min(start.y, e.clientY);
      Object.assign(box.style, { left: `${x}px`, top: `${y}px`, width: `${Math.abs(e.clientX - start.x)}px`, height: `${Math.abs(e.clientY - start.y)}px` });
    });
    layer.addEventListener('mouseup', (e) => {
      if (!start) return;
      const r = { x: Math.min(start.x, e.clientX), y: Math.min(start.y, e.clientY), w: Math.abs(e.clientX - start.x), h: Math.abs(e.clientY - start.y) };
      done(r.w > 8 && r.h > 8 ? r : null);
    });
  });
}

/** Where an image is on the page (for "Identify the font in this image" when the file cannot be downloaded). */
export function imageRect(src: string): { x: number; y: number; w: number; h: number; dpr: number } | null {
  const img = [...document.images].find((i) => i.currentSrc === src || i.src === src);
  if (!img) return null;
  img.scrollIntoView({ block: 'center', inline: 'center' });
  const r = img.getBoundingClientRect();
  const x = Math.max(0, r.left);
  const y = Math.max(0, r.top);
  return { x, y, w: Math.min(innerWidth, r.right) - x, h: Math.min(innerHeight, r.bottom) - y, dpr: devicePixelRatio };
}

export function afterPaint(fn: () => void) {
  let done = false;
  const go = () => {
    if (done) return;
    done = true;
    fn();
  };
  requestAnimationFrame(() => requestAnimationFrame(go));
  setTimeout(go, 120);
}
