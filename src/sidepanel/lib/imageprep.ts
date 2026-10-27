// Image preparation for identifying fonts: straighten, crop, adjust tone, and
// cut out letters as 1-bit pictures for matching.
import { GLYPH_CHARS, cellBits, cropInk, type Ink } from '../../shared/glyphprint';
import type { OcrLine } from './ocr';

export interface Edit {
  /** Quarter turns, clockwise. */
  turn: 0 | 1 | 2 | 3;
  /** Fine rotation in degrees (straighten). */
  rotate: number;
  /** Four corners (top-left, top-right, bottom-right, bottom-left) to flatten, in source pixels. */
  perspective: [number, number][] | null;
  /** Crop in the rotated image, in pixels. */
  crop: { x: number; y: number; w: number; h: number } | null;
  brightness: number;
  contrast: number;
  invert: boolean;
}

export const NO_EDIT: Edit = { turn: 0, rotate: 0, perspective: null, crop: null, brightness: 0, contrast: 0, invert: false };

export function canvasFrom(src: CanvasImageSource, w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.getContext('2d')!.drawImage(src, 0, 0, w, h);
  return c;
}

// ---- perspective: map the chosen quad onto a rectangle

function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(M[r][i]) > Math.abs(M[p][i])) p = r;
    [M[i], M[p]] = [M[p], M[i]];
    for (let r = 0; r < n; r++) {
      if (r === i) continue;
      const f = M[r][i] / M[i][i];
      for (let c = i; c <= n; c++) M[r][c] -= f * M[i][c];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

/** Homography from rectangle (0,0)-(w,h) to the quad. */
function homography(w: number, h: number, q: [number, number][]): number[] {
  const src: [number, number][] = [[0, 0], [w, 0], [w, h], [0, h]];
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i];
    const [u, v] = q[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  return [...solve(A, b), 1];
}

function flatten(src: HTMLCanvasElement, q: [number, number][]): HTMLCanvasElement {
  const d = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const w = Math.round((d(q[0], q[1]) + d(q[3], q[2])) / 2);
  const h = Math.round((d(q[0], q[3]) + d(q[1], q[2])) / 2);
  if (w < 4 || h < 4) return src;
  const H = homography(w, h, q);
  const sctx = src.getContext('2d')!;
  const s = sctx.getImageData(0, 0, src.width, src.height).data;
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const octx = out.getContext('2d')!;
  const o = octx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const den = H[6] * x + H[7] * y + H[8];
      const u = Math.round((H[0] * x + H[1] * y + H[2]) / den);
      const v = Math.round((H[3] * x + H[4] * y + H[5]) / den);
      const oi = (y * w + x) * 4;
      if (u < 0 || v < 0 || u >= src.width || v >= src.height) {
        o.data[oi] = o.data[oi + 1] = o.data[oi + 2] = 255;
        o.data[oi + 3] = 255;
        continue;
      }
      const si = (v * src.width + u) * 4;
      o.data[oi] = s[si];
      o.data[oi + 1] = s[si + 1];
      o.data[oi + 2] = s[si + 2];
      o.data[oi + 3] = 255;
    }
  }
  octx.putImageData(o, 0, 0);
  return out;
}

/** Perspective, turn and straighten: the image the crop is drawn on. */
export function geometry(src: HTMLCanvasElement, e: Edit): HTMLCanvasElement {
  let img = e.perspective ? flatten(src, e.perspective) : src;
  const rad = ((e.turn * 90 + e.rotate) * Math.PI) / 180;
  if (!rad) return img;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const w = Math.round(img.width * cos + img.height * sin);
  const h = Math.round(img.width * sin + img.height * cos);
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const c = out.getContext('2d')!;
  c.fillStyle = '#fff';
  c.fillRect(0, 0, w, h);
  c.translate(w / 2, h / 2);
  c.rotate(rad);
  c.drawImage(img, -img.width / 2, -img.height / 2);
  img = out;
  return img;
}

/**
 * The image text recognition reads: cropped, in greys, with brightness,
 * contrast and invert applied, and enlarged when small.
 */
export function finish(geo: HTMLCanvasElement, e: Edit): HTMLCanvasElement {
  const cr = e.crop ?? { x: 0, y: 0, w: geo.width, h: geo.height };
  const cw = Math.max(1, Math.round(cr.w));
  const ch = Math.max(1, Math.round(cr.h));
  const scale = Math.min(4, Math.max(1, 300 / Math.min(cw, ch)));
  const out = document.createElement('canvas');
  out.width = Math.round(cw * scale);
  out.height = Math.round(ch * scale);
  const c = out.getContext('2d', { willReadFrequently: true })!;
  c.imageSmoothingQuality = 'high';
  c.fillStyle = '#fff';
  c.fillRect(0, 0, out.width, out.height);
  c.drawImage(geo, cr.x, cr.y, cr.w, cr.h, 0, 0, out.width, out.height);
  const img = c.getImageData(0, 0, out.width, out.height);
  const d = img.data;
  const k = (259 * (e.contrast * 2.55 + 255)) / (255 * (259 - e.contrast * 2.55));
  for (let i = 0; i < d.length; i += 4) {
    let g = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
    g = k * (g - 128) + 128 + e.brightness * 1.5;
    if (e.invert) g = 255 - g;
    g = Math.max(0, Math.min(255, g));
    d[i] = d[i + 1] = d[i + 2] = g;
    d[i + 3] = 255;
  }
  c.putImageData(img, 0, 0);
  return out;
}

/** True when the image looks like light text on a dark background (judged by its edges). */
export function looksInverted(c: HTMLCanvasElement): boolean {
  const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
  let sum = 0;
  let n = 0;
  const add = (x: number, y: number) => {
    const i = (y * c.width + x) * 4;
    sum += d[i];
    n++;
  };
  for (let x = 0; x < c.width; x += 2) {
    add(x, 0);
    add(x, c.height - 1);
  }
  for (let y = 0; y < c.height; y += 2) {
    add(0, y);
    add(c.width - 1, y);
  }
  return n > 0 && sum / n < 110;
}

/** Threshold that best splits dark from light (Otsu). */
function otsu(gray: Uint8Array): number {
  const hist = new Array(256).fill(0);
  for (const g of gray) hist[g]++;
  const total = gray.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, t = 128;
  for (let i = 0; i < 256; i++) {
    wB += hist[i];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += i * hist[i];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) {
      best = between;
      t = i;
    }
  }
  return t;
}

export interface QueryGlyph {
  char: string;
  ci: number;
  bits: Uint8Array;
  aspect: number;
  /** Ink height and bottom (distance below the baseline is negative), in pixels. */
  h: number;
  bottom: number;
  /** Small picture of the cut-out letter, for checking and correcting. */
  thumb: string;
  box: { x0: number; y0: number; x1: number; y1: number };
}

/** Cut each recognised letter of the chosen lines out of the image. */
export function cutGlyphs(img: HTMLCanvasElement, chosen: { line: OcrLine; index: number }[], corrections: Record<string, string>): QueryGlyph[] {
  const ctx = img.getContext('2d')!;
  const d = ctx.getImageData(0, 0, img.width, img.height).data;
  const gray = new Uint8Array(img.width * img.height);
  for (let i = 0; i < gray.length; i++) gray[i] = d[i * 4];
  const t = otsu(gray);
  const out: QueryGlyph[] = [];
  chosen.forEach(({ line, index: li }) => {
    // Baseline: given by recognition, or the usual bottom of letters without descenders.
    const bottoms = line.symbols.filter((s) => /[a-zA-Z0-9]/.test(s.text) && !/[gjpqy]/.test(s.text)).map((s) => s.bbox.y1).sort((a, b) => a - b);
    const baseline = line.baseline ?? (bottoms.length ? bottoms[Math.floor(bottoms.length / 2)] : line.bbox.y1);
    line.symbols.forEach((s, si) => {
      const char = corrections[`${li}:${si}`] ?? s.text;
      const ci = GLYPH_CHARS.indexOf(char);
      if (char.length !== 1 || ci < 0) return;
      const { x0, y0, x1, y1 } = s.bbox;
      const w = x1 - x0;
      const h = y1 - y0;
      if (w < 2 || h < 4) return;
      const px = new Uint8Array(w * h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px[y * w + x] = gray[(y0 + y) * img.width + x0 + x] < t ? 1 : 0;
      const ink: Ink | null = cropInk({ w, h, px });
      if (!ink || ink.h < 4) return;
      // Where the ink sits within the box, to measure from the baseline.
      let top = 0;
      outer: for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (px[y * w + x]) { top = y; break outer; }
      const inkBottom = y0 + top + ink.h;
      const tc = document.createElement('canvas');
      tc.width = w;
      tc.height = h;
      tc.getContext('2d')!.drawImage(img, x0, y0, w, h, 0, 0, w, h);
      out.push({ char, ci, bits: cellBits(ink), aspect: ink.w / ink.h, h: ink.h, bottom: baseline - inkBottom, thumb: tc.toDataURL(), box: { x0, y0, x1, y1 } });
    });
  });
  return out;
}

/** Small picture of each recognised character, for checking and correcting. */
export function letterTiles(img: HTMLCanvasElement, chosen: { line: OcrLine; index: number }[]): { key: string; text: string; thumb: string; confidence: number; space: boolean }[] {
  const out: { key: string; text: string; thumb: string; confidence: number; space: boolean }[] = [];
  for (const [ci, { line, index }] of chosen.entries()) {
    line.symbols.forEach((s, si) => {
      const { x0, y0, x1, y1 } = s.bbox;
      const w = Math.max(1, x1 - x0);
      const h = Math.max(1, y1 - y0);
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      c.getContext('2d')!.drawImage(img, x0, y0, w, h, 0, 0, w, h);
      out.push({ key: `${index}:${si}`, text: s.text, thumb: c.toDataURL(), confidence: s.confidence, space: s.wordStart && (si > 0 || ci > 0) });
    });
  }
  return out;
}
