import { useMemo } from 'react';

/**
 * Characters of `text` that a font does not have. Each character is drawn
 * with the font and two different fallbacks; if the width changes with the
 * fallback, the font itself has no glyph for it.
 */
export function missingChars(family: string, text: string): string[] {
  const c = document.createElement('canvas').getContext('2d');
  if (!c || !family) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const ch of text) {
    if (seen.has(ch) || /\s/.test(ch) || ch === '·') continue;
    seen.add(ch);
    c.font = `40px "${family}", serif`;
    const a = c.measureText(ch).width;
    c.font = `40px "${family}", monospace`;
    const b = c.measureText(ch).width;
    if (Math.abs(a - b) > 0.01) out.push(ch);
  }
  return out;
}

/** First family name in a CSS font-family value. */
export function firstFamily(css: string): string {
  const m = /^\s*"([^"]+)"|^\s*([^,]+)/.exec(css);
  return (m?.[1] ?? m?.[2] ?? '').trim();
}

export function useMissing(css: string, text: string, ready: boolean): string[] {
  return useMemo(() => (ready ? missingChars(firstFamily(css), text) : []), [css, text, ready]);
}
