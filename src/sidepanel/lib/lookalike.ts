// Closest free fonts: measured proportions (similar.ts) blended with how alike
// the letters look (the glyph index used for images). Proportions alone can
// pair fonts with the same heights and widths but different letter shapes.
import { printsFromCanvas, type PrintQuery } from '../../shared/glyphprint';
import { sendToTab } from '../../shared/messages';
import type { Shape } from '../../shared/shape';
import { similarTo, type Match } from '../../shared/similar';
import type { Classification } from '../../shared/types';
import { lookalikeScores } from './matcher';
import { db } from '../../shared/db';
import type { FaceFile } from '../../shared/types';
import { measureOnPage, shapeFor } from './shapes';
import { blend } from '../../shared/lookalike-core';
import { FINE_CHARS, FINE_SHORTLIST, fineFontScore, rerankFine, type FinePrint } from '../../shared/finematch';
import { finePrintsFromCanvas } from '../../shared/glyphprint';
import { shapeFromCanvas } from '../../shared/shape';
import { facesForCoverage } from './coverage';
import { getFontBytes } from './fonts';
import { googleFamily } from '../../shared/catalog';
import { fontshareFamily } from '../../shared/freecatalog';

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

// ------------------------------------------------------------- one answer everywhere

export interface LookalikeInput {
  fontId: string;
  family: string;
  catalogFamily: string | null;
  files: FaceFile[];
  kind: string;
  classification: Classification;
  /** The weight and style the page uses most for this font. */
  weight: string;
  style: string;
  onPage: boolean;
}

export interface LookalikeResult {
  matches: Match[];
  /** Letter shapes were compared (otherwise proportions only, a rougher guess). */
  letters: boolean;
  /** The font's x-height (em), to size a swapped font to match. */
  x: number | null;
}

const results = new Map<string, Promise<LookalikeResult | null>>();

/**
 * Closest free Google Fonts families for a font. Make it free, Similar fonts and
 * Send to Figma all use this, so they always agree. On a page, the font is
 * measured as the page draws it, at the weight it uses (variable fonts often
 * store a different default weight in the file).
 */
export function freeLookalikes(i: LookalikeInput, tabId: number | null): Promise<LookalikeResult | null> {
  const key = `${i.onPage ? tabId : 'saved'}|${i.fontId}|${i.weight}|${i.style}|${i.catalogFamily ?? ''}`;
  let p = results.get(key);
  if (!p) {
    p = (async () => {
      const rec = await db.fonts.get(i.fontId).catch(() => undefined);
      const classification = rec?.classification ?? i.classification;
      const pageDraws = i.onPage && i.kind === 'web' && tabId != null;
      let shape: Shape | null = null;
      let notRegular = false;
      if (pageDraws) shape = await measureOnPage(tabId!, i.family, i.weight, i.style);
      let letters = shape ? await letterScores({ tabId, family: i.family, weight: i.weight, style: i.style, onPage: true }) : null;
      // The page could not draw it (or it is saved, not on a page): draw the font's own file here instead.
      let local: string | null = null;
      if (!letters && i.kind === 'web' && i.files.length) {
        local = await panelFace(i, tabId);
        if (local) {
          shape = shapeFromCanvas(`"${local}"`, i.weight, i.style) ?? shape;
          const prints = printsFromCanvas(`"${local}", "FFP NotDef"`, i.weight, i.style);
          letters = prints.length >= 10 ? await lookalikeScores({ prints }).catch(() => null) : null;
        }
      }
      if (!shape) {
        const r = await shapeFor({ catalogFamily: i.catalogFamily, files: i.files, kind: i.kind, family: i.family }, tabId).catch(() => null);
        shape = r?.shape ?? null;
        notRegular = r?.notRegular ?? false;
      }
      if (!letters && i.kind !== 'web') letters = await letterScores({ tabId, family: i.family, weight: i.weight, style: i.style, onPage: false });
      if (!shape) return null;
      const coarse = blendMatches(shape, letters, { exclude: i.catalogFamily ?? undefined, classification, limit: FINE_SHORTLIST + 5, ignoreWeight: notRegular });
      if (!letters) {
        // Proportions alone can pair fonts with different letter shapes (rounded with sharp): never call these close.
        return { matches: coarse.slice(0, 10).map((m) => ({ ...m, score: Math.min(m.score, CLOSE_MATCH - 6) })), letters: false, x: shape.x ?? null };
      }
      // A sharper second look at the best candidates.
      const query = pageDraws && !local ? await pageFinePrints(tabId!, i) : local ? finePrintsFromCanvas(`"${local}"`, i.weight, i.style) : i.kind !== 'web' ? finePrintsFromCanvas(`"${i.family.replace(/"/g, '')}", "FFP NotDef"`, i.weight, i.style) : null;
      const fine = query ? await fineScores(query, coarse.slice(0, FINE_SHORTLIST).map((m) => m.family), i.weight) : null;
      const matches = (fine && fine.size ? rerankFine(coarse, fine) : coarse).slice(0, 10);
      return { matches, letters: true, x: shape.x ?? null };
    })().catch(() => null);
    results.set(key, p);
    p.then((r) => { if (!r) results.delete(key); });
  }
  return p;
}

/** True when a unicode-range includes basic Latin letters (or there is none). */
function coversLatin(range: string | null): boolean {
  if (!range) return true;
  return range.split(',').some((part) => {
    const [a, b] = part.trim().replace(/^u\+/i, '').split('-');
    const start = parseInt(a.replace(/\?/g, '0'), 16);
    const end = b ? parseInt(b, 16) : parseInt(a.replace(/\?/g, 'F'), 16);
    return start <= 0x78 && end >= 0x78;
  });
}

/** Loads the font's regular file into this panel, so its letters can be drawn here. Returns the name it is loaded under. */
async function panelFace(i: LookalikeInput, tabId: number | null): Promise<string | null> {
  const group = facesForCoverage(i.files, i.weight, i.style);
  const face = group.find((f) => f.url && coversLatin(f.unicodeRange)) ?? group.find((f) => f.url);
  if (!face?.url) return null;
  const name = `FFP query ${i.fontId.replace(/[^\w]/g, '').slice(0, 40)}`;
  try {
    const bytes = await getFontBytes(face.url, tabId);
    const ff = new FontFace(name, bytes.slice(0), { weight: face.weight || '1 1000', style: face.style || 'normal' });
    await ff.load();
    document.fonts.add(ff);
    await document.fonts.load(`${i.style} ${i.weight} 40px "${name}"`).catch(() => undefined);
    return name;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------- the sharper second look

const candidatePrints = new Map<string, Promise<Record<string, FinePrint | null> | null>>();

/** Sharper prints of a Google Fonts family, drawn in this panel (only the needed letters are downloaded). */
function googleFinePrints(family: string, weight: string): Promise<Record<string, FinePrint | null> | null> {
  const gf = googleFamily(family);
  const wght = gf?.a.find((a) => a[0] === 'wght');
  const w = Number(weight) || 400;
  const want = wght ? Math.max(wght[1], Math.min(wght[2], w)) : gf?.w.includes(String(w)) ? w : 400;
  const key = `${family}|${want}`;
  let p = candidatePrints.get(key);
  if (!p) {
    p = (async () => {
      const fs = fontshareFamily(family);
      let cssUrl: string;
      if (fs?.slug) {
        const w = fs.w?.length ? fs.w.reduce((a, b) => (Math.abs(b - want) < Math.abs(a - want) ? b : a), fs.w[0]) : 400;
        cssUrl = `https://api.fontshare.com/v2/css?f[]=${fs.slug}@${w}&display=swap`;
      } else {
        cssUrl = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, '+')}${want !== 400 ? `:wght@${want}` : ''}&text=${encodeURIComponent(FINE_CHARS)}`;
      }
      const css = await (await fetch(cssUrl)).text();
      let url = /url\('?((?:https:)?\/\/[^')]+)'?\)/.exec(css)?.[1];
      if (url?.startsWith('//')) url = `https:${url}`;
      if (!url) return null;
      const name = `FFP fine ${family} ${want}`;
      const face = new FontFace(name, await (await fetch(url)).arrayBuffer(), { weight: String(want) });
      await face.load();
      document.fonts.add(face);
      const prints = finePrintsFromCanvas(`"${name}"`, String(want));
      document.fonts.delete(face);
      return prints;
    })().catch(() => null);
    candidatePrints.set(key, p);
  }
  return p;
}

async function pageFinePrints(tabId: number, i: LookalikeInput): Promise<Record<string, FinePrint | null> | null> {
  const r = await sendToTab<{ ok: boolean; prints?: Record<string, { px: number[]; aspect: number; corner?: number | null } | null> }>(tabId, { type: 'ffp:fine-prints', family: i.family, weight: i.weight, style: i.style }, 10000);
  if (!r?.ok || !r.prints) return null;
  return Object.fromEntries(Object.entries(r.prints).map(([k, v]) => [k, v ? { px: Uint8Array.from(v.px), aspect: v.aspect, corner: v.corner } : null]));
}

async function fineScores(q: Record<string, FinePrint | null>, families: string[], weight: string): Promise<Map<string, number> | null> {
  if (Object.values(q).filter(Boolean).length < 15) return null;
  const out = new Map<string, number>();
  await Promise.all(
    families.map(async (f) => {
      const c = await googleFinePrints(f, weight);
      const v = c ? fineFontScore(q, c) : null;
      if (v != null) out.set(f, v);
    }),
  );
  return out;
}

/** Shown next to a match below this score: still offered, but marked as not a close match. */
export const CLOSE_MATCH = 70;
