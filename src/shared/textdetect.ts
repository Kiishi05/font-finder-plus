// Does a picture contain text? A quick check (no text recognition): letters are
// small, separate shapes of similar height sitting side by side on a line.
// Photos, gradients, icons and halftone dots rarely form such rows.

export interface Pixels { width: number; height: number; data: Uint8ClampedArray }

interface Comp { x0: number; y0: number; x1: number; y1: number; n: number }

const MAX_SIDE = 640;

function gray(p: Pixels): { g: Uint8Array; w: number; h: number } {
  const k = Math.min(1, MAX_SIDE / Math.max(p.width, p.height));
  const w = Math.max(1, Math.round(p.width * k));
  const h = Math.max(1, Math.round(p.height * k));
  const g = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(p.height - 1, Math.floor(y / k));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(p.width - 1, Math.floor(x / k));
      const i = (sy * p.width + sx) * 4;
      g[y * w + x] = (p.data[i] * 299 + p.data[i + 1] * 587 + p.data[i + 2] * 114) / 1000;
    }
  }
  return { g, w, h };
}

function otsu(g: Uint8Array): number {
  const hist = new Array(256).fill(0);
  for (const v of g) hist[v]++;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, t = 127;
  for (let i = 0; i < 256; i++) {
    wB += hist[i];
    if (!wB) continue;
    const wF = g.length - wB;
    if (!wF) break;
    sumB += i * hist[i];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const v = wB * wF * (mB - mF) ** 2;
    if (v > best) [best, t] = [v, i];
  }
  return t;
}

function components(mask: Uint8Array, w: number, h: number): Comp[] {
  const seen = new Uint8Array(w * h);
  const out: Comp[] = [];
  const stack: number[] = [];
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || seen[i]) continue;
    const c: Comp = { x0: w, y0: h, x1: 0, y1: 0, n: 0 };
    stack.push(i);
    seen[i] = 1;
    while (stack.length) {
      const j = stack.pop()!;
      const x = j % w, y = (j / w) | 0;
      c.n++;
      if (x < c.x0) c.x0 = x;
      if (x > c.x1) c.x1 = x;
      if (y < c.y0) c.y0 = y;
      if (y > c.y1) c.y1 = y;
      if (c.n > 6000) continue; // a big region: not a letter, stop growing it
      for (const k of [j - 1, j + 1, j - w, j + w]) {
        if (k < 0 || k >= mask.length || seen[k] || !mask[k]) continue;
        if ((k === j - 1 && x === 0) || (k === j + 1 && x === w - 1)) continue;
        seen[k] = 1;
        stack.push(k);
      }
    }
    out.push(c);
  }
  return out;
}

/** Letters in a row: the longest run of letter-like shapes on one line. */
function longestRow(cs: Comp[], w: number, h: number): number {
  const letters = cs.filter((c) => {
    const cw = c.x1 - c.x0 + 1, ch = c.y1 - c.y0 + 1;
    if (ch < 7 || ch > h * 0.6 || cw > ch * 2.2 || cw < 1) return false;
    if (c.x0 === 0 || c.y0 === 0 || c.x1 === w - 1 || c.y1 === h - 1) return false;
    const fill = c.n / (cw * ch);
    return fill > 0.12 && fill < 0.9;
  });
  if (letters.length < 4) return 0;
  // Link shapes of similar height that sit next to each other on the same line.
  const parent = letters.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const sorted = letters.map((c, i) => ({ c, i, cx: (c.x0 + c.x1) / 2 })).sort((a, b) => a.cx - b.cx);
  for (let a = 0; a < sorted.length; a++) {
    const A = sorted[a].c, ha = A.y1 - A.y0 + 1;
    for (let b = a + 1; b < sorted.length; b++) {
      const B = sorted[b].c, hb = B.y1 - B.y0 + 1;
      const gap = B.x0 - A.x1;
      if (gap > Math.max(ha, hb) * 1.3) break;
      if (gap < -Math.min(ha, hb) * 0.3) continue;
      if (hb / ha > 1.9 || ha / hb > 1.9) continue;
      // Same line: bottoms close (letters share a baseline) or centres close.
      const bottomClose = Math.abs(A.y1 - B.y1) < Math.max(ha, hb) * 0.3;
      const midClose = Math.abs((A.y0 + A.y1) / 2 - (B.y0 + B.y1) / 2) < Math.max(ha, hb) * 0.35;
      if (bottomClose || midClose) parent[find(sorted[a].i)] = find(sorted[b].i);
    }
  }
  const groups = new Map<number, Comp[]>();
  letters.forEach((c, i) => {
    const r = find(i);
    groups.set(r, [...(groups.get(r) ?? []), c]);
  });
  let best = 0;
  for (const g of groups.values()) {
    if (g.length < 4) continue;
    const hs = g.map((c) => c.y1 - c.y0 + 1);
    const mean = hs.reduce((a, b) => a + b, 0) / hs.length;
    const sd = Math.sqrt(hs.reduce((a, b) => a + (b - mean) ** 2, 0) / hs.length);
    const span = Math.max(...g.map((c) => c.x1)) - Math.min(...g.map((c) => c.x0));
    // Letters vary a little in height (x-height, capitals, ascenders), not wildly; a word spans several letters.
    if (sd / mean > 0.45 || span < mean * 2.5) continue;
    // Letters are strokes, so they fill less of their box than solid shapes (dots, circles) do.
    const fill = g.reduce((a, c) => a + c.n / ((c.x1 - c.x0 + 1) * (c.y1 - c.y0 + 1)), 0) / g.length;
    if (fill > 0.66) continue;
    best = Math.max(best, g.length);
  }
  return best;
}

/** True when the picture very likely contains a line of text (4 or more letters in a row). */
export function hasText(p: Pixels): boolean {
  if (p.width < 24 || p.height < 12) return false;
  const { g, w, h } = gray(p);
  const t = otsu(g);
  // Dark letters on a light background, then light letters on a dark one.
  for (const dark of [true, false]) {
    const mask = new Uint8Array(w * h);
    for (let i = 0; i < g.length; i++) mask[i] = dark ? (g[i] < t ? 1 : 0) : g[i] > t ? 1 : 0;
    if (longestRow(components(mask, w, h), w, h) >= 4) return true;
  }
  return false;
}
