// Scoring used to identify fonts from images (shared by the worker and tests).
import { GLYPH_CHARS, RECORD, aspectOf, bottomOf, heightOf, isMissing, shapeSimilarity } from './glyphprint';

export interface Query { ci: number; bits: Uint8Array; aspect: number; h: number; bottom: number }
export interface RankedFont { family: string; bold: boolean; total: number; perChar: number[]; heights: number; missing: number }

const per = GLYPH_CHARS.length * RECORD;

function scoreFace(ix: Uint8Array, base: number, q: Query[]) {
  const perChar: number[] = [];
  const ch: number[] = [];
  const cb: number[] = [];
  let missing = 0;
  for (const g of q) {
    const o = base + g.ci * RECORD;
    if (isMissing(ix, o)) {
      missing++;
      perChar.push(0);
      ch.push(NaN);
      cb.push(NaN);
      continue;
    }
    const shape = shapeSimilarity(g.bits, 0, ix, o);
    const aspect = 1 - Math.min(1, Math.abs(Math.log(g.aspect / Math.max(0.05, aspectOf(ix, o)))) / 0.45);
    perChar.push(shape * 0.75 + aspect * 0.25);
    ch.push(heightOf(ix, o));
    cb.push(bottomOf(ix, o));
  }
  // Letter heights and positions relative to each other (how tall b is against a, how far p drops).
  const ok = q.map((_, i) => Number.isFinite(ch[i]));
  const qMean = q.reduce((t, g, i) => t + (ok[i] ? g.h : 0), 0) / Math.max(1, ok.filter(Boolean).length);
  const cMean = ch.reduce((t, v) => t + (Number.isFinite(v) ? v : 0), 0) / Math.max(1, ok.filter(Boolean).length);
  let hd = 0;
  let bd = 0;
  let n = 0;
  q.forEach((g, i) => {
    if (!ok[i] || !qMean || !cMean) return;
    hd += Math.abs(g.h / qMean - ch[i] / cMean);
    bd += Math.abs(g.bottom / qMean - cb[i] / cMean);
    n++;
  });
  const heights = n ? 1 - Math.min(1, hd / n / 0.18) : 0;
  const bottoms = n ? 1 - Math.min(1, bd / n / 0.12) : 0;
  const letters = perChar.reduce((a, b) => a + b, 0) / Math.max(1, perChar.length);
  return { total: letters * 0.75 + heights * 0.15 + bottoms * 0.1, perChar, heights, missing };
}


export function rankFonts(ix: Uint8Array, families: string[], weights: number[], glyphs: Query[], limit: number): RankedFont[] {
  const results: RankedFont[] = [];
  families.forEach((family, fi) => {
    let best: RankedFont | null = null;
    for (const wi of [0, 1]) {
      if (!(weights[fi] & (1 << wi))) continue;
      const r = scoreFace(ix, (fi * 2 + wi) * per, glyphs);
      if (!best || r.total > best.total) best = { family, bold: wi === 1, ...r };
    }
    if (best) results.push(best);
  });
  results.sort((a, b) => b.total - a.total);
  return results.slice(0, limit);
}
