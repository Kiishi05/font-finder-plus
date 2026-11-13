// Closest free fonts: measured proportions (similar.ts) blended with how alike
// the letters look (the glyph index used for images). Proportions alone can
// pair fonts with the same heights and widths but different letter shapes.
import { printsFromCanvas, type PrintQuery } from '../../shared/glyphprint';
import { sendToTab } from '../../shared/messages';
import type { Shape } from '../../shared/shape';
import { similarTo, type Match } from '../../shared/similar';
import type { Classification } from '../../shared/types';
import { lookalikeScores } from './matcher';
import { blend } from '../../shared/lookalike-core';

const cache = new Map<string, Promise<Map<string, number> | null>>();

/** Letter prints of a font: as the page draws it, or as the panel draws an installed font. */
async function printsFor(src: { tabId: number | null; family: string; weight: string; style: string; onPage: boolean }): Promise<PrintQuery[] | null> {
  if (src.onPage && src.tabId != null) {
    const r = await sendToTab<{ ok: boolean; prints?: PrintQuery[] }>(src.tabId, { type: 'ffp:prints', family: src.family, weight: src.weight, style: src.style }, 8000);
    return r?.ok && r.prints && r.prints.length >= 10 ? r.prints : null;
  }
  const fam = `"${src.family.replace(/"/g, '')}", "FFP NotDef"`;
  await document.fonts.load(`${src.style} ${src.weight} 40px "${src.family.replace(/"/g, '')}"`).catch(() => undefined);
  const prints = printsFromCanvas(fam, src.weight, src.style);
  return prints.length >= 10 ? prints : null;
}

/** How much each Google Fonts family looks like this font (0 to 100), or null when its letters cannot be drawn. */
export function letterScores(src: { tabId: number | null; family: string; weight?: string; style?: string; onPage: boolean }): Promise<Map<string, number> | null> {
  const weight = src.weight ?? '400';
  const style = src.style ?? 'normal';
  const key = `${src.onPage ? src.tabId : 'panel'}|${src.family}|${weight}|${style}`;
  let p = cache.get(key);
  if (!p) {
    p = printsFor({ ...src, weight, style })
      .then((prints) => (prints ? lookalikeScores({ prints }) : null))
      .catch(() => null);
    cache.set(key, p);
  }
  return p;
}

/**
 * Closest Google Fonts families. With letter scores, the score is 30% shared
 * proportions and 70% alike letter shapes; without them, proportions only.
 */
export function blendMatches(shape: Shape, letters: Map<string, number> | null, opts: { exclude?: string; classification?: Classification; limit?: number; ignoreWeight?: boolean }): Match[] {
  const limit = opts.limit ?? 8;
  if (!letters) return similarTo(shape, opts);
  return blend(similarTo(shape, { ...opts, limit: 5000 }), letters, limit);
}
