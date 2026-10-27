// Glyph fingerprints for identifying fonts from images. Each letter becomes a
// 16 by 16 picture of its shape (kept in proportion, centred) plus its
// proportions. The same code makes the index of Google Fonts (build time) and
// the prints of letters cut from an image (in the browser).

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
