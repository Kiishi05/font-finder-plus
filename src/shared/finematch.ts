// Second, sharper look at the best look-alike candidates: their letters drawn
// at 48 by 48 instead of 16 by 16, so details such as the leg of R, the tail of
// Q and the ends of strokes count. Shared by the panel and the accuracy test.
import type { Ink } from './glyphprint';
import type { Match } from './similar';

export const FINE_CELL = 48;
export const FINE_CHARS = 'abcdefghijklmnopqrstuvwxyzAEGHMOQRS';
/** How many of the best first-pass candidates get the sharper look. */
export const FINE_SHORTLIST = 25;

/** Tuning, set from tests/lookalike-bench.mjs. */
export const TUNE = { strict: 0.2, share: 0.3 };

export interface FinePrint { px: Uint8Array; aspect: number }

/** The letter scaled to fit 48 by 48, keeping its proportions, centred. */
export function fineFromInk(ink: Ink): FinePrint {
  const out = new Uint8Array(FINE_CELL * FINE_CELL);
  const k = FINE_CELL / Math.max(ink.w, ink.h);
  const ox = (FINE_CELL - ink.w * k) / 2;
  const oy = (FINE_CELL - ink.h * k) / 2;
  for (let y = 0; y < FINE_CELL; y++) {
    for (let x = 0; x < FINE_CELL; x++) {
      const sx = Math.floor((x - ox) / k);
      const sy = Math.floor((y - oy) / k);
      if (sx >= 0 && sy >= 0 && sx < ink.w && sy < ink.h && ink.px[sy * ink.w + sx]) out[y * FINE_CELL + x] = 1;
    }
  }
  return { px: out, aspect: ink.w / ink.h };
}

function dilate(a: Uint8Array): Uint8Array {
  const o = new Uint8Array(a.length);
  for (let y = 0; y < FINE_CELL; y++) {
    for (let x = 0; x < FINE_CELL; x++) {
      if (!a[y * FINE_CELL + x]) continue;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const yy = y + dy, xx = x + dx;
          if (yy >= 0 && xx >= 0 && yy < FINE_CELL && xx < FINE_CELL) o[yy * FINE_CELL + xx] = 1;
        }
      }
    }
  }
  return o;
}

/** 0 to 1: how alike two letters are (shape overlap, strict and loose, and proportions). */
export function fineSimilarity(a: FinePrint, b: FinePrint): number {
  const da = dilate(a.px);
  const db = dilate(b.px);
  let na = 0, nb = 0, ab = 0, ba = 0, both = 0;
  for (let i = 0; i < a.px.length; i++) {
    na += a.px[i];
    nb += b.px[i];
    ab += a.px[i] & db[i];
    ba += b.px[i] & da[i];
    both += a.px[i] & b.px[i];
  }
  if (!na || !nb) return 0;
  const loose = (ab / na + ba / nb) / 2;
  const strict = (2 * both) / (na + nb);
  const aspect = 1 - Math.min(1, Math.abs(Math.log(a.aspect / b.aspect)) / 0.45);
  const ws = TUNE.strict;
  return (loose * (1 - ws) + strict * ws) * 0.8 + aspect * 0.2;
}

/** Mean letter similarity of two fonts over the letters both have, 0 to 1 (null if too few). */
export function fineFontScore(q: Record<string, FinePrint | null>, c: Record<string, FinePrint | null>): number | null {
  let s = 0, n = 0;
  for (const ch of FINE_CHARS) {
    const a = q[ch], b = c[ch];
    if (!a || !b) continue;
    s += fineSimilarity(a, b);
    n++;
  }
  return n >= 15 ? s / n : null;
}

/** Shown score from the sharper look: about 0.85 (unrelated) to 1 (the same drawings). */
const fineShown = (v: number) => Math.round(Math.max(0, Math.min(1, (v - 0.85) / 0.14)) * 100);

/**
 * Re-rank the shortlist with the sharper look. Final score: half the first pass,
 * half the sharper look. Candidates without a sharper look keep their first-pass place below.
 */
export function rerankFine(coarse: Match[], fine: Map<string, number>): Match[] {
  return coarse
    .map((m) => {
      const f = fine.get(m.family);
      return f == null ? { ...m, score: Math.round(m.score * 0.9) } : { ...m, score: Math.round(m.score * (1 - TUNE.share) + fineShown(f) * TUNE.share) };
    })
    .sort((a, b) => b.score - a.score || (a.p ?? 9999) - (b.p ?? 9999));
}
