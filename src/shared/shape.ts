// A font's shape, measured from its glyph outlines. Used to find similar
// fonts and to suggest pairs. The same code measures Google Fonts at build
// time (scripts/build-gf-shapes.mjs) and a site's font file in the browser.

export interface Shape {
  /** x-height, cap height, ascender and descender as a share of the em. */
  x: number;
  cap: number;
  asc: number;
  desc: number;
  /** Average width of a to z, as a share of the em. */
  w: number;
  /** Thickness of the sides of "o" (how bold), as a share of the em. Null if unknown. */
  stem: number | null;
  /** Thick sides of "o" divided by thin top and bottom (how much contrast). */
  contrast: number | null;
  /** Width of "o" divided by its height (how round). */
  round: number | null;
  /** 1 when "g" has two bowls (double-storey), 0 when one, null if unknown. */
  g2?: number | null;
  /** 1 when "a" is double-storey (small bowl at the bottom), 0 when single-storey. */
  a2?: number | null;
  /** How square "o" is: outline area divided by its box (circle about 0.79, square 1). */
  sq?: number | null;
  /** Widths of n s a e r t (relative to o) and M R S (relative to H): the font's rhythm. */
  prof?: (number | null)[];
  /** Top end of "l" against its stem: about 0.5 rounded, 1 square, above 1 serifed. */
  tl?: number | null;
  /** Dot of "i": filled share of its box, about 0.78 round, 1 square. */
  dot?: number | null;
}

/** The letters a shape needs. Ask Google Fonts for only these. */
export const SHAPE_TEXT = 'abcdefghijklmnopqrstuvwxyzHOMRS';
const PROF_LOWER = 'nsaert';
const PROF_UPPER = 'MRS';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FontLike = any;

const r3 = (n: number) => Math.round(n * 1000) / 1000;

// ---------------------------------------------------------------- raster
// Glyphs are drawn into a small bitmap (non-zero fill, so overlapping
// outlines in variable fonts are handled) and measured from the pixels.

export interface Bitmap { w: number; h: number; px: Uint8Array; x0: number; y0: number; scale: number }

function flatten(glyph: FontLike): number[][] {
  const polys: number[][] = [];
  let cur: number[] = [];
  let x = 0;
  let y = 0;
  const STEPS = 8;
  for (const c of glyph.path?.commands ?? []) {
    const a: number[] = c.args;
    switch (c.command) {
      case 'moveTo':
        if (cur.length > 4) polys.push(cur);
        cur = [a[0], a[1]];
        [x, y] = a;
        break;
      case 'lineTo':
        cur.push(a[0], a[1]);
        [x, y] = a;
        break;
      case 'quadraticCurveTo':
        for (let i = 1; i <= STEPS; i++) {
          const t = i / STEPS;
          const mt = 1 - t;
          cur.push(mt * mt * x + 2 * mt * t * a[0] + t * t * a[2], mt * mt * y + 2 * mt * t * a[1] + t * t * a[3]);
        }
        [x, y] = [a[2], a[3]];
        break;
      case 'bezierCurveTo':
        for (let i = 1; i <= STEPS; i++) {
          const t = i / STEPS;
          const mt = 1 - t;
          cur.push(
            mt ** 3 * x + 3 * mt * mt * t * a[0] + 3 * mt * t * t * a[2] + t ** 3 * a[4],
            mt ** 3 * y + 3 * mt * mt * t * a[1] + 3 * mt * t * t * a[3] + t ** 3 * a[5],
          );
        }
        [x, y] = [a[4], a[5]];
        break;
      default:
        break;
    }
  }
  if (cur.length > 4) polys.push(cur);
  return polys;
}

export function raster(glyph: FontLike, upm: number, em = 160): Bitmap | null {
  const polys = flatten(glyph);
  if (!polys.length) return null;
  const scale = em / upm;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of polys) for (let i = 0; i < p.length; i += 2) {
    minX = Math.min(minX, p[i]); maxX = Math.max(maxX, p[i]);
    minY = Math.min(minY, p[i + 1]); maxY = Math.max(maxY, p[i + 1]);
  }
  const w = Math.ceil((maxX - minX) * scale) + 2;
  const h = Math.ceil((maxY - minY) * scale) + 2;
  if (w < 3 || h < 3 || w * h > 400000) return null;
  const px = new Uint8Array(w * h);
  for (let row = 0; row < h; row++) {
    // Font y goes up; row 0 is the top.
    const fy = maxY - (row + 0.5 - 1) / scale;
    const xs: [number, number][] = [];
    for (const p of polys) {
      const n = p.length / 2;
      for (let i = 0; i < n; i++) {
        const ax = p[i * 2], ay = p[i * 2 + 1];
        const bx = p[((i + 1) % n) * 2], by = p[((i + 1) % n) * 2 + 1];
        if (ay === by) continue;
        if ((fy >= ay && fy < by) || (fy >= by && fy < ay)) {
          const t = (fy - ay) / (by - ay);
          xs.push([ax + t * (bx - ax), by > ay ? 1 : -1]);
        }
      }
    }
    xs.sort((a, b) => a[0] - b[0]);
    let wind = 0;
    for (let k = 0; k < xs.length - 1; k++) {
      wind += xs[k][1];
      if (wind === 0) continue;
      const from = Math.max(0, Math.round((xs[k][0] - minX) * scale) + 1);
      const to = Math.min(w, Math.round((xs[k + 1][0] - minX) * scale) + 1);
      for (let c = from; c < to; c++) px[row * w + c] = 1;
    }
  }
  return { w, h, px, x0: minX, y0: maxY, scale };
}

/** Background areas enclosed by ink (the counters of o, a, g...), largest first, as [size, topRow]. */
function holes(b: Bitmap): [number, number][] {
  const seen = new Uint8Array(b.w * b.h);
  const fill = (start: number) => {
    const stack = [start];
    seen[start] = 1;
    let size = 0;
    let top = b.h;
    let edge = false;
    while (stack.length) {
      const i = stack.pop()!;
      size++;
      const r = Math.floor(i / b.w);
      const c = i % b.w;
      top = Math.min(top, r);
      if (r === 0 || c === 0 || r === b.h - 1 || c === b.w - 1) edge = true;
      for (const j of [i - 1, i + 1, i - b.w, i + b.w]) {
        if (j < 0 || j >= b.px.length || seen[j] || b.px[j]) continue;
        if ((j === i - 1 && c === 0) || (j === i + 1 && c === b.w - 1)) continue;
        seen[j] = 1;
        stack.push(j);
      }
    }
    return { size, top, edge };
  };
  const out: [number, number][] = [];
  for (let i = 0; i < b.px.length; i++) {
    if (seen[i] || b.px[i]) continue;
    const r = fill(i);
    if (!r.edge && r.size >= 6) out.push([r.size, r.top]);
  }
  return out.sort((a, b2) => b2[0] - a[0]);
}

/** Thickness of the ink run starting at (row, col) going in a direction. */
function run(b: Bitmap, row: number, col: number, dr: number, dc: number): number {
  let r = row, c = col;
  while (r >= 0 && c >= 0 && r < b.h && c < b.w && !b.px[r * b.w + c]) { r += dr; c += dc; }
  let n = 0;
  while (r >= 0 && c >= 0 && r < b.h && c < b.w && b.px[r * b.w + c]) { n++; r += dr; c += dc; }
  return n;
}

/** Features read from glyph pictures: weight, contrast, roundness, squareness, a and g. */
function pixelFeatures(get: (ch: string) => Bitmap | null, emPx: number) {
  let stem: number | null = null;
  let contrast: number | null = null;
  let round: number | null = null;
  let sq: number | null = null;
  const ob = get('o');
  if (ob) {
    const midRow = Math.floor(ob.h / 2);
    const midCol = Math.floor(ob.w / 2);
    const side = (run(ob, midRow, 0, 0, 1) + run(ob, midRow, ob.w - 1, 0, -1)) / 2;
    const capT = (run(ob, 0, midCol, 1, 0) + run(ob, ob.h - 1, midCol, -1, 0)) / 2;
    if (side > 0 && capT > 0) {
      stem = r3(side / emPx);
      contrast = r3(side / capT);
    }
    round = r3((ob.w - 2) / Math.max(1, ob.h - 2));
    // Squareness: ink plus counters, over the box.
    const hole = holes(ob).reduce((t, [n]) => t + n, 0);
    const ink = ob.px.reduce((t, v) => t + v, 0);
    sq = r3((ink + hole) / Math.max(1, (ob.w - 2) * (ob.h - 2)));
  }
  let g2: number | null = null;
  const gb = get('g');
  if (gb) g2 = holes(gb).length >= 2 ? 1 : 0;
  let a2: number | null = null;
  const ab = get('a');
  const hs = ab ? holes(ab) : [];
  // Double-storey "a": its counter sits in the lower part of the letter.
  if (ab && hs.length) a2 = hs[0][1] / Math.max(1, ab.h) > 0.38 ? 1 : 0;

  // Stroke ends: the top of "l" (rounded, square or serifed) and the dot of "i".
  let tl: number | null = null;
  const lb = get('l');
  if (lb) {
    const rowInk = (y: number) => { let n = 0; for (let x = 0; x < lb.w; x++) n += lb.px[y * lb.w + x]; return n; };
    let top = 0;
    while (top < lb.h && !rowInk(top)) top++;
    const mid = rowInk(Math.floor((top + lb.h) / 2));
    if (mid > 0 && top < lb.h - 2) tl = r3(((rowInk(top) + rowInk(top + 1)) / 2) / mid);
  }
  let dot: number | null = null;
  const ib = get('i');
  if (ib) {
    const rowInk = (y: number) => { let n = 0, l = ib.w, r = -1; for (let x = 0; x < ib.w; x++) if (ib.px[y * ib.w + x]) { n++; if (x < l) l = x; if (x > r) r = x; } return { n, l, r }; };
    let y = 0;
    while (y < ib.h && !rowInk(y).n) y++;
    let area = 0, rows = 0, left = ib.w, right = -1;
    for (; y < ib.h; y++) {
      const ri = rowInk(y);
      if (!ri.n) break;
      area += ri.n;
      rows++;
      left = Math.min(left, ri.l);
      right = Math.max(right, ri.r);
    }
    // Only a separate dot counts (some fonts have no gap, e.g. dotless designs).
    if (rows > 1 && y < ib.h - 2 && right >= left) dot = r3(area / (rows * (right - left + 1)));
  }
  return { stem, contrast, round, sq, g2, a2, tl, dot };
}

/**
 * Shape of a font measured from how the browser draws it. Used when the font
 * file cannot be read (the page or the panel already has the font loaded).
 * `familyCss` is a CSS font-family value, e.g. '"Söhne", sans-serif'.
 */
export function shapeFromCanvas(familyCss: string, weight = '400', style = 'normal'): Shape | null {
  // Draw at a normal text size (16px) and scale the canvas up 10 times. Variable
  // fonts with optical sizes pick their design from the font size, so this keeps
  // the text design instead of the large display design.
  const F = 16;
  const K = 10;
  const S = F * K;
  const canvas = document.createElement('canvas');
  const c = canvas.getContext('2d', { willReadFrequently: true });
  if (!c) return null;
  c.font = `${style} ${weight} ${F}px ${familyCss}`;
  const fontCss = c.font;
  const m = (t: string) => {
    c.font = fontCss;
    return c.measureText(t);
  };
  // Text measurements are rounded at small sizes, so heights come from the
  // enlarged drawing: rows of ink above (or below) the baseline.
  const PAD = K * 2;
  const baselines = new Map<string, number>();
  const bitmap = (ch: string): Bitmap | null => {
    const mt = m(ch);
    const left = Math.ceil(mt.actualBoundingBoxLeft * K) + PAD;
    const asc = Math.ceil(mt.actualBoundingBoxAscent * K) + PAD;
    const w = left + Math.ceil(mt.actualBoundingBoxRight * K) + PAD;
    const h = asc + Math.ceil(mt.actualBoundingBoxDescent * K) + PAD;
    if (w < 3 || h < 3) return null;
    canvas.width = w;
    canvas.height = h;
    c.setTransform(K, 0, 0, K, 0, 0);
    c.font = fontCss;
    c.clearRect(0, 0, w, h);
    c.fillStyle = '#000';
    c.fillText(ch, left / K, asc / K);
    c.setTransform(1, 0, 0, 1, 0, 0);
    const data = c.getImageData(0, 0, w, h).data;
    const px = new Uint8Array(w * h);
    for (let i = 0; i < px.length; i++) px[i] = data[i * 4 + 3] > 127 ? 1 : 0;
    // Crop to the ink so the measurements match those taken from outlines.
    let top = h, bottom = -1, l = w, r = -1;
    for (let y = 0; y < h; y++) for (let xx = 0; xx < w; xx++) if (px[y * w + xx]) {
      if (y < top) top = y;
      if (y > bottom) bottom = y;
      if (xx < l) l = xx;
      if (xx > r) r = xx;
    }
    if (bottom < 0) return null;
    const cw = r - l + 3;
    const chh = bottom - top + 3;
    const out = new Uint8Array(cw * chh);
    for (let y = top; y <= bottom; y++) for (let xx = l; xx <= r; xx++) out[(y - top + 1) * cw + (xx - l + 1)] = px[y * w + xx];
    baselines.set(ch, asc - top);
    return { w: cw, h: chh, px: out, x0: 0, y0: 0, scale: 1 };
  };
  const above = (ch: string) => (bitmap(ch) ? (baselines.get(ch) ?? NaN) / S : NaN);
  const below = (ch: string) => {
    const b = bitmap(ch);
    return b ? (b.h - 2 - (baselines.get(ch) ?? 0)) / S : NaN;
  };
  const x = above('x');
  const cap = above('H');
  if (!(x > 0) || !(cap > 0)) return null;
  const adv = (ch: string) => m(ch).width;
  const letters = 'abcdefghijklmnopqrstuvwxyz'.split('');
  const w = letters.reduce((t, ch) => t + adv(ch), 0) / letters.length / F;
  const f = pixelFeatures(bitmap, S);
  const oW = adv('o');
  const hW = adv('H');
  return {
    x: r3(x),
    cap: r3(cap),
    asc: r3(above('d')),
    desc: r3(below('p')),
    w: r3(w),
    ...f,
    prof: [...PROF_LOWER.split('').map((ch) => adv(ch) / oW), ...PROF_UPPER.split('').map((ch) => adv(ch) / hW)].map((v) => (Number.isFinite(v) ? r3(v) : null)),
  };
}

export function shapeFromFont(font: FontLike): Shape | null {
  const upm: number = font.unitsPerEm;
  if (!upm) return null;
  const has = (ch: string) => font.hasGlyphForCodePoint?.(ch.codePointAt(0));
  const g = (ch: string) => font.glyphForCodePoint(ch.codePointAt(0));
  if (!has('x') || !has('o') || !has('H')) return null;
  const top = (ch: string) => (has(ch) ? g(ch).bbox.maxY : NaN);
  const bottom = (ch: string) => (has(ch) ? g(ch).bbox.minY : NaN);
  const letters = 'abcdefghijklmnopqrstuvwxyz'.split('').filter(has);
  const w = letters.reduce((s, ch) => s + g(ch).advanceWidth, 0) / Math.max(1, letters.length) / upm;

  const { stem, contrast, round, sq, g2, a2, tl, dot } = pixelFeatures((ch) => (has(ch) ? raster(g(ch), upm) : null), 160);
  const adv = (ch: string) => (has(ch) ? g(ch).advanceWidth : NaN);
  const oW = adv('o');
  const hW = adv('H');
  const prof = [...PROF_LOWER.split('').map((ch) => adv(ch) / oW), ...PROF_UPPER.split('').map((ch) => adv(ch) / hW)].map((v) => (Number.isFinite(v) ? r3(v) : null));
  const asc = has('d') ? top('d') : top('l');
  const desc = has('p') ? -bottom('p') : -bottom('g');
  return {
    x: r3(top('x') / upm),
    cap: r3(top('H') / upm),
    asc: r3(asc / upm),
    desc: r3(desc / upm),
    w: r3(w),
    stem,
    contrast,
    round,
    g2,
    a2,
    sq,
    prof,
    tl,
    dot,
  };
}

/** Shape as a compact array for the built data file. */
export function packShape(s: Shape): (number | null)[] {
  const prof = s.prof ?? [];
  return [s.x, s.cap, s.asc, s.desc, s.w, s.stem, s.contrast, s.round, s.g2 ?? null, s.a2 ?? null, s.sq ?? null, ...Array.from({ length: 9 }, (_, i) => prof[i] ?? null), s.tl ?? null, s.dot ?? null];
}

export function unpackShape(a: (number | null)[]): Shape {
  return { x: a[0]!, cap: a[1]!, asc: a[2]!, desc: a[3]!, w: a[4]!, stem: a[5], contrast: a[6], round: a[7], g2: a[8] ?? null, a2: a[9] ?? null, sq: a[10] ?? null, prof: a.slice(11, 20), tl: a[20] ?? null, dot: a[21] ?? null };
}
