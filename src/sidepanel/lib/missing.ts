import { useEffect, useState } from 'react';

let fallbacksReady: Promise<unknown> | null = null;
function loadFallbacks() {
  fallbacksReady ??= Promise.all([document.fonts.load('40px "FFP NotDef"', 'A'), document.fonts.load('40px "FFP NotDef Wide"', 'A')]);
  return fallbacksReady;
}

/**
 * Characters of `text` that a font does not have. Each character is drawn with
 * the font, backed by two box fonts of different widths. If the width changes
 * with the backup, the font itself has no glyph for it. Works for any script.
 */
export function missingChars(family: string, text: string): string[] {
  const c = document.createElement('canvas').getContext('2d');
  if (!c || !family) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  const fam = `"${family.replace(/"/g, '')}"`;
  for (const ch of text) {
    if (seen.has(ch) || /\s/.test(ch) || ch === '·') continue;
    seen.add(ch);
    c.font = `40px ${fam}, "FFP NotDef"`;
    const a = c.measureText(ch).width;
    c.font = `40px ${fam}, "FFP NotDef Wide"`;
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
  const [missing, setMissing] = useState<string[]>([]);
  useEffect(() => {
    let off = false;
    if (!ready) {
      setMissing([]);
      return;
    }
    const fam = firstFamily(css);
    // The font's own files for other alphabets may still be loading.
    Promise.all([loadFallbacks(), document.fonts.load(`40px "${fam}"`, text).catch(() => undefined)]).then(() => {
      if (!off) setMissing(missingChars(fam, text));
    });
    return () => { off = true; };
  }, [css, text, ready]);
  return missing;
}
