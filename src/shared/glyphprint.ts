// Glyph fingerprints for identifying fonts from images. Each letter becomes a
// 16 by 16 picture of its shape (kept in proportion, centred) plus its
// proportions. The same code makes the index of Google Fonts (build time) and
// the prints of letters cut from an image (in the browser).

import { CORNER_SIZE, FINE_CHARS, cornerOfInk, fineFromInk, type FinePrint } from './finematch';

export const GLYPH_CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
export const CELL = 16;
const BITS = (CELL * CELL) / 8;
/** Bytes per glyph: 32 bytes of picture, aspect, height, bottom. */
export const RECORD = BITS + 3;

export interface Ink {
  w: number;
  h: number;
  px: Uint8Array;
}

/** Crop a 1-bit picture to its ink. */
export function cropInk(b: Ink): Ink | null {
  let top = b.h, bottom = -1, left = b.w, right = -1;
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) if (b.px[y * b.w + x]) {
    if (y < top) top = y;
    if (y > bottom) bottom = y;
    if (x < left) left = x;
    if (x > right) right = x;
  }
  if (bottom < 0) return null;
  const w = right - left + 1;
  const h = bottom - top + 1;
  const px = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px[y * w + x] = b.px[(y + top) * b.w + x + left];
  return { w, h, px };
}

/** 16x16 picture of the ink, scaled to fit (keeping proportions) and centred. */
export function cellBits(ink: Ink): Uint8Array {
  const out = new Uint8Array(BITS);
  const scale = CELL / Math.max(ink.w, ink.h);
  const dw = ink.w * scale;
  const dh = ink.h * scale;
  const ox = (CELL - dw) / 2;
  const oy = (CELL - dh) / 2;
  for (let cy = 0; cy < CELL; cy++) {
    for (let cx = 0; cx < CELL; cx++) {
      // Share of ink in the source area under this cell.
      const sx0 = (cx - ox) / scale, sx1 = (cx + 1 - ox) / scale;
      const sy0 = (cy - oy) / scale, sy1 = (cy + 1 - oy) / scale;
      if (sx1 <= 0 || sy1 <= 0 || sx0 >= ink.w || sy0 >= ink.h) continue;
      let on = 0, all = 0;
      for (let y = Math.max(0, Math.floor(sy0)); y < Math.min(ink.h, Math.ceil(sy1)); y++) {
        for (let x = Math.max(0, Math.floor(sx0)); x < Math.min(ink.w, Math.ceil(sx1)); x++) {
          all++;
          on += ink.px[y * ink.w + x];
        }
      }
      if (all && on / all >= 0.4) out[(cy * CELL + cx) >> 3] |= 1 << ((cy * CELL + cx) & 7);
    }
  }
  return out;
}

const clampByte = (n: number) => Math.max(0, Math.min(255, Math.round(n)));

/** Full record for one glyph. `height` and `bottom` are in em (bottom is below the baseline when negative). */
export function makeRecord(ink: Ink, heightEm: number, bottomEm: number): Uint8Array {
  const r = new Uint8Array(RECORD);
  r.set(cellBits(ink), 0);
  r[BITS] = clampByte((ink.w / ink.h) * 64);
  r[BITS + 1] = clampByte(heightEm * 200);
  r[BITS + 2] = clampByte(bottomEm * 200 + 128);
  return r;
}

export const aspectOf = (r: Uint8Array, o = 0) => r[o + BITS] / 64;
export const heightOf = (r: Uint8Array, o = 0) => r[o + BITS + 1] / 200;
export const bottomOf = (r: Uint8Array, o = 0) => (r[o + BITS + 2] - 128) / 200;
export const isMissing = (r: Uint8Array, o = 0) => r[o + BITS] === 0;

const POP = new Uint8Array(256).map((_, i) => {
  let n = 0;
  for (let v = i; v; v >>= 1) n += v & 1;
  return n;
});

function dilate(bits: Uint8Array, o: number): Uint8Array {
  const out = new Uint8Array(BITS);
  const get = (x: number, y: number) => x >= 0 && y >= 0 && x < CELL && y < CELL && (bits[o + ((y * CELL + x) >> 3)] >> ((y * CELL + x) & 7)) & 1;
  for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) {
    if (get(x, y) || get(x - 1, y) || get(x + 1, y) || get(x, y - 1) || get(x, y + 1)) out[(y * CELL + x) >> 3] |= 1 << ((y * CELL + x) & 7);
  }
  return out;
}

/**
 * How alike two glyph pictures are (0 to 1). Ink that lands within one cell of
 * the other's ink counts, so small shifts from scanning or cropping are forgiven.
 */
export function shapeSimilarity(a: Uint8Array, ao: number, b: Uint8Array, bo: number): number {
  const da = dilate(a, ao);
  const db = dilate(b, bo);
  let na = 0, nb = 0, aInB = 0, bInA = 0;
  for (let i = 0; i < BITS; i++) {
    na += POP[a[ao + i]];
    nb += POP[b[bo + i]];
    aInB += POP[a[ao + i] & db[i]];
    bInA += POP[b[bo + i] & da[i]];
  }
  if (!na || !nb) return 0;
  // Strict overlap as well, so a bold and a light letter are not the same.
  let both = 0;
  for (let i = 0; i < BITS; i++) both += POP[a[ao + i] & b[bo + i]];
  const loose = (aInB / na + bInA / nb) / 2;
  const strict = (2 * both) / (na + nb);
  return loose * 0.6 + strict * 0.4;
}

/** Letters compared when looking for fonts that look like a given font. */
export const LOOKALIKE_CHARS = 'abcdefghijklmnopqrstuvwxyzAEGHMORS';

/** A letter as the matcher takes it (same layout as a record, unpacked). */
export interface PrintQuery { ci: number; bits: number[]; aspect: number; h: number; bottom: number }

/** Unpack a record into a query for the matcher. */
export function recordToQuery(r: Uint8Array, ci: number): PrintQuery {
  return { ci, bits: Array.from(r.subarray(0, BITS)), aspect: aspectOf(r), h: heightOf(r), bottom: bottomOf(r) };
}

/**
 * Prints of each letter of a font as the browser draws it. Used when the font
 * file cannot be read but the font is loaded (on the page or in the panel).
 */
export function printsFromCanvas(familyCss: string, weight = '400', style = 'normal'): PrintQuery[] {
  const E = 96;
  const W = 220;
  const H = 200;
  const base = 150;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) return [];
  // Draw at a text size (16px) scaled up, so fonts with optical sizes use their text design.
  ctx.font = `${style} ${weight} 16px ${familyCss}`;
  ctx.textBaseline = 'alphabetic';
  const k = E / 16;
  const out: PrintQuery[] = [];
  for (const ch of LOOKALIKE_CHARS) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#000';
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.fillText(ch, 30 / k, base / k);
    const d = ctx.getImageData(0, 0, W, H).data;
    const px = new Uint8Array(W * H);
    for (let i = 0; i < px.length; i++) px[i] = d[i * 4 + 3] > 127 ? 1 : 0;
    const ink = cropInk({ w: W, h: H, px });
    if (!ink || ink.h < 4) continue;
    let last = -1;
    for (let y = H - 1; y >= 0 && last < 0; y--) for (let x = 0; x < W; x++) if (px[y * W + x]) { last = y; break; }
    const rec = makeRecord(ink, ink.h / E, (base - (last + 1)) / E);
    out.push(recordToQuery(rec, GLYPH_CHARS.indexOf(ch)));
  }
  return out;
}

/** Sharper prints (48 by 48) of a font as the browser draws it, for the second look at look-alikes. */
export function finePrintsFromCanvas(familyCss: string, weight = '400', style = 'normal'): Record<string, FinePrint | null> {
  const E = 120;
  const W = 260;
  const H = 240;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const out: Record<string, FinePrint | null> = {};
  if (!ctx) return out;
  // Text size (16px) scaled up, so fonts with optical sizes use their text design.
  ctx.font = `${style} ${weight} 16px ${familyCss}`;
  const k = E / 16;
  for (const ch of FINE_CHARS) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#000';
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.fillText(ch, 30 / k, 180 / k);
    const d = ctx.getImageData(0, 0, W, H).data;
    const px = new Uint8Array(W * H);
    for (let i = 0; i < px.length; i++) px[i] = d[i * 4 + 3] > 127 ? 1 : 0;
    const ink = cropInk({ w: W, h: H, px });
    out[ch] = ink && ink.h >= 4 ? fineFromInk(ink) : null;
  }
  if (out.H) out.H.corner = canvasCorner(familyCss, weight, style);
  return out;
}

/** Corner roundness of the H, drawn large (see cornerOfInk). */
function canvasCorner(familyCss: string, weight: string, style: string): number | null {
  const S = CORNER_SIZE;
  const c = document.createElement('canvas');
  c.width = Math.round(S * 1.4);
  c.height = Math.round(S * 1.3);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.font = `${style} ${weight} 16px ${familyCss}`;
  const k = S / 16;
  ctx.setTransform(k, 0, 0, k, 0, 0);
  ctx.fillStyle = '#000';
  ctx.fillText('H', (S * 0.1) / k, S / k);
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  const px = new Uint8Array(c.width * c.height);
  for (let i = 0; i < px.length; i++) px[i] = d[i * 4 + 3] > 127 ? 1 : 0;
  const ink = cropInk({ w: c.width, h: c.height, px });
  return ink ? cornerOfInk(ink) : null;
}
