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
}

/** The letters a shape needs. Ask Google Fonts for only these. */
export const SHAPE_TEXT = 'abcdefghijklmnopqrstuvwxyzHO';

interface Box { minX: number; minY: number; maxX: number; maxY: number }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FontLike = any;

function contourBoxes(glyph: FontLike): Box[] {
  const boxes: Box[] = [];
  let cur: Box | null = null;
  for (const c of glyph.path?.commands ?? []) {
    if (c.command === 'moveTo') {
      if (cur) boxes.push(cur);
      cur = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    }
    if (!cur) continue;
    const a: number[] = c.args;
    for (let i = 0; i + 1 < a.length; i += 2) {
      cur.minX = Math.min(cur.minX, a[i]);
      cur.maxX = Math.max(cur.maxX, a[i]);
      cur.minY = Math.min(cur.minY, a[i + 1]);
      cur.maxY = Math.max(cur.maxY, a[i + 1]);
    }
  }
  if (cur) boxes.push(cur);
  return boxes.filter((b) => Number.isFinite(b.minX));
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

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

  let stem: number | null = null;
  let contrast: number | null = null;
  let round: number | null = null;
  const boxes = contourBoxes(g('o')).sort((a, b) => (b.maxX - b.minX) * (b.maxY - b.minY) - (a.maxX - a.minX) * (a.maxY - a.minY));
  if (boxes.length >= 2) {
    const [o, i] = boxes;
    const side = ((i.minX - o.minX) + (o.maxX - i.maxX)) / 2;
    const cap = ((i.minY - o.minY) + (o.maxY - i.maxY)) / 2;
    if (side > 0 && cap > 0) {
      stem = r3(side / upm);
      contrast = r3(side / cap);
    }
    round = r3((o.maxX - o.minX) / Math.max(1, o.maxY - o.minY));
  }
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
  };
}

/** Shape as a compact array for the built data file. */
export function packShape(s: Shape): (number | null)[] {
  return [s.x, s.cap, s.asc, s.desc, s.w, s.stem, s.contrast, s.round];
}

export function unpackShape(a: (number | null)[]): Shape {
  return { x: a[0]!, cap: a[1]!, asc: a[2]!, desc: a[3]!, w: a[4]!, stem: a[5], contrast: a[6], round: a[7] };
}
