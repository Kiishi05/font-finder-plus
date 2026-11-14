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
/** worst: how much a few clearly different letters count (a slab r, a rounded end) next to the average. */
export const TUNE = { strict: 0.2, share: 0.35, worst: 1, corner: 1, ink: 0.5, scaled: 0.3, adv: 0.3 };

export interface FinePrint {
  px: Uint8Array;
  aspect: number;
  /** H only: how rounded the stem ends are, as a share of the stem width (0 sharp, about 0.5 fully round). */
  corner?: number | null;
}

/** Size the H is drawn at to measure its corners. */
export const CORNER_SIZE = 400;

/**
 * How rounded the four stem ends of an H are: rows from each end until the
 * stem reaches its full width, divided by the stem width. Rounded fonts (Rubik,
 * Nunito) score high; sharp ones (Helvetica, Söhne) near 0. Null when the H
 * does not have two clear stems.
 */
export function cornerOfInk(ink: Ink): number | null {
  const runsAt = (y: number) => {
    const out: [number, number][] = [];
    let start = -1;
    for (let x = 0; x <= ink.w; x++) {
      const on = x < ink.w && ink.px[y * ink.w + x];
      if (on && start < 0) start = x;
      if (!on && start >= 0) { out.push([start, x - 1]); start = -1; }
    }
    return out;
  };
  const ends: number[] = [];
  for (const [frac, dir] of [[0.22, -1], [0.78, 1]] as const) {
    const y0 = Math.round(ink.h * frac);
    const runs = runsAt(y0);
    if (runs.length !== 2) return null;
    for (const [x0, x1] of runs) {
      const w = x1 - x0 + 1;
      if (w < 6) return null;
      let k = 0;
      for (let y = dir < 0 ? 0 : ink.h - 1; dir < 0 ? y < y0 : y > y0; y -= dir) {
        let n = 0;
        for (let x = x0; x <= x1; x++) n += ink.px[y * ink.w + x];
        if (n >= w * 0.92) break;
        k++;
      }
      ends.push(k / w);
    }
  }
  return ends.reduce((a, b) => a + b, 0) / ends.length;
}


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
  let s = 0, sq = 0, n = 0;
  for (const ch of FINE_CHARS) {
    const a = q[ch], b = c[ch];
    if (!a || !b) continue;
    const v = fineSimilarity(a, b);
    s += v;
    sq += (1 - v) ** 2;
    n++;
  }
  if (n < 15) return null;
  // Rounded stem ends against sharp ones (Rubik for Söhne) is a difference people see at once.
  const ca = q.H?.corner, cb = c.H?.corner;
  const cornerPenalty = ca != null && cb != null ? Math.min(0.1, Math.max(0, Math.abs(ca - cb) - 0.06) * TUNE.corner) : 0;
  // People notice the one letter that is drawn differently, so big misses weigh more than an average shows.
  const mean = s / n;
  const rms = 1 - Math.sqrt(sq / n);
  return mean * (1 - TUNE.worst) + rms * TUNE.worst - cornerPenalty;
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

// ------------------------------------------------------------- letters at a shared x-height
// The prints above fit each letter to its own box, which hides how wide it is,
// how tall its ascenders are next to its x-height, and how heavy its strokes
// look. These prints draw every letter at the same x-height on a shared
// baseline, the way two fonts look when one is swapped for the other.

/** Cells across and down (each cell is 4 by 4 pixels when drawn). */
export const SC_W = 40;
export const SC_H = 44;
/** x-height in pixels when drawn, and where the baseline sits. */
export const SC_XH = 48;
export const SC_BASE = 128;

export interface ScaledPrint {
  /** Ink per cell, 0 to 16. */
  px: Uint8Array;
  /** The letter thinned to its centre line, per cell (0 to 4): its construction, whatever its weight. */
  sk?: Uint8Array;
  /** Advance width in x-heights. */
  adv: number;
}

function blur(a: Uint8Array): Float32Array {
  const o = new Float32Array(a.length);
  for (let y = 0; y < SC_H; y++) {
    for (let x = 0; x < SC_W; x++) {
      let s = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const yy = y + dy, xx = x + dx;
        if (yy < 0 || xx < 0 || yy >= SC_H || xx >= SC_W) continue;
        s += a[yy * SC_W + xx] * (dx || dy ? 1 : 2);
        n += dx || dy ? 1 : 2;
      }
      o[y * SC_W + x] = s / n;
    }
  }
  return o;
}

/** 0 to 1: how alike two letters look at the same x-height (shape, width, height and weight together). */
function jaccard(a: Float32Array, b: Float32Array): number {
  let mn = 0, mx = 0;
  for (let i = 0; i < a.length; i++) {
    mn += Math.min(a[i], b[i]);
    mx += Math.max(a[i], b[i]);
  }
  return mx ? mn / mx : 0;
}

export function scaledSimilarity(a: ScaledPrint, b: ScaledPrint): number {
  const ink = jaccard(blur(a.px), blur(b.px));
  const skel = a.sk && b.sk ? jaccard(blur(Uint8Array.from(blur(a.sk), (v) => v * 4)), blur(Uint8Array.from(blur(b.sk), (v) => v * 4))) : ink;
  // Width shows at once when one font replaces another (a line gets longer), so it counts strongly.
  const adv = a.adv > 0 && b.adv > 0 ? 1 - Math.min(1, Math.abs(Math.log(a.adv / b.adv)) / TUNE.adv) : 0.5;
  return ink * TUNE.ink + skel * (0.75 - TUNE.ink) + adv * 0.25;
}

/** Mean of the letters both fonts have, with clearly different letters weighing more (null if too few). */
export function scaledFontScore(q: Record<string, ScaledPrint | null>, c: Record<string, ScaledPrint | null>): number | null {
  let s = 0, sq = 0, n = 0;
  for (const ch of FINE_CHARS) {
    const a = q[ch], b = c[ch];
    if (!a || !b) continue;
    const v = scaledSimilarity(a, b);
    s += v;
    sq += (1 - v) ** 2;
    n++;
  }
  if (n < 15) return null;
  return (s / n) * (1 - TUNE.worst) + (1 - Math.sqrt(sq / n)) * TUNE.worst;
}

/** Thins a 1-bit picture to lines one pixel wide (Zhang-Suen). */
export function skeleton(px: Uint8Array, w: number, h: number): Uint8Array {
  const a = Uint8Array.from(px);
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : a[y * w + x]);
  let changed = true;
  const del: number[] = [];
  for (let pass = 0; changed && pass < 40; pass++) {
    changed = false;
    for (const step of [0, 1]) {
      del.length = 0;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        if (!a[y * w + x]) continue;
        const p = [at(x, y - 1), at(x + 1, y - 1), at(x + 1, y), at(x + 1, y + 1), at(x, y + 1), at(x - 1, y + 1), at(x - 1, y), at(x - 1, y - 1)];
        const n = p.reduce((s, v) => s + v, 0);
        if (n < 2 || n > 6) continue;
        let t = 0;
        for (let i = 0; i < 8; i++) if (!p[i] && p[(i + 1) % 8]) t++;
        if (t !== 1) continue;
        if (step === 0 ? p[0] * p[2] * p[4] || p[2] * p[4] * p[6] : p[0] * p[2] * p[6] || p[0] * p[4] * p[6]) continue;
        del.push(y * w + x);
      }
      for (const i of del) a[i] = 0;
      if (del.length) changed = true;
    }
  }
  return a;
}

/**
 * One value for the sharper look, on the fineFontScore scale: the letters fitted
 * to their own box (shape details) and drawn at a shared x-height (width,
 * height and construction), weighted by TUNE.scaled.
 */
export function fineAndScaled(fine: number | null, scaled: number | null): number | null {
  if (scaled == null) return fine;
  const onFine = 0.85 + ((scaled - 0.62) / 0.33) * 0.14;
  if (fine == null) return onFine;
  return fine * (1 - TUNE.scaled) + onFine * TUNE.scaled;
}
