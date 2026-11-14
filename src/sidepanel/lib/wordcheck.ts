// Checks a word in a picture against a font by drawing that word in the font
// and comparing the two pictures. Used when text recognition misreads a name
// set in a showy font ("Lobster" read as "Tobater"): close spellings of known
// fonts are drawn, and one is taken only if its drawing matches the picture.
import { googleFamily } from '../../shared/catalog';
import { fontshareFamily } from '../../shared/freecatalog';
import { linkGoogleFamily } from './google';

const H = 40;

type Box = { x0: number; y0: number; x1: number; y1: number };

/** The ink of a canvas region, cropped and scaled to H pixels tall (1 = ink). */
function inkOf(src: CanvasImageSource, sw: number, sh: number, sx = 0, sy = 0, darkInk?: boolean): { px: Uint8Array; w: number } | null {
  const c = document.createElement('canvas');
  c.width = Math.max(1, sw);
  c.height = Math.max(1, sh);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(src, sx, sy, sw, sh, 0, 0, sw, sh);
  const d = ctx.getImageData(0, 0, sw, sh).data;
  const g = new Uint8Array(sw * sh);
  for (let i = 0; i < g.length; i++) g[i] = d[i * 4 + 3] < 128 ? 255 : (d[i * 4] * 299 + d[i * 4 + 1] * 587 + d[i * 4 + 2] * 114) / 1000;
  // Ink is the side that differs from the border.
  let border = 0, n = 0;
  for (let x = 0; x < sw; x++) { border += g[x] + g[(sh - 1) * sw + x]; n += 2; }
  const bg = border / n;
  let sum = 0;
  for (const v of g) sum += v;
  const t = (bg + sum / g.length) / 2;
  const dark = darkInk ?? bg > t;
  let top = sh, bottom = -1, left = sw, right = -1;
  const on = new Uint8Array(sw * sh);
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
    const v = g[y * sw + x];
    if (dark ? v < t - 20 : v > t + 20) {
      on[y * sw + x] = 1;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
      if (x < left) left = x;
      if (x > right) right = x;
    }
  }
  if (bottom < 0) return null;
  const ih = bottom - top + 1, iw = right - left + 1;
  const w = Math.max(1, Math.round((iw / ih) * H));
  const px = new Uint8Array(w * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < w; x++) px[y * w + x] = on[(top + Math.floor((y * ih) / H)) * sw + left + Math.floor((x * iw) / w)];
  return { px, w };
}

function blurred(a: Uint8Array, w: number): Float32Array {
  const o = new Float32Array(a.length);
  for (let y = 0; y < H; y++) for (let x = 0; x < w; x++) {
    let s = 0, n = 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const yy = y + dy, xx = x + dx;
      if (yy < 0 || xx < 0 || yy >= H || xx >= w) continue;
      s += a[yy * w + xx];
      n++;
    }
    o[y * w + x] = s / n;
  }
  return o;
}

/** 0 to 1: how much the word drawn in `family` looks like the picture of it. */
export async function wordLooksLike(image: HTMLCanvasElement, box: Box, word: string, family: string, bold = false): Promise<number> {
  if (!googleFamily(family) && !fontshareFamily(family)) return 0;
  await linkGoogleFamily(family);
  const wt = bold ? 700 : 400;
  await document.fonts.load(`${wt} 40px "${family}"`, word).catch(() => undefined);
  if (!document.fonts.check(`${wt} 40px "${family}"`, word)) return 0;
  const pad = 4;
  const pic = inkOf(image, box.x1 - box.x0 + pad * 2, box.y1 - box.y0 + pad * 2, box.x0 - pad, box.y0 - pad);
  const c = document.createElement('canvas');
  c.width = 1400;
  c.height = 200;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = '#000';
  ctx.font = `${wt} 100px "${family}"`;
  ctx.fillText(word, 20, 140);
  const drawn = inkOf(c, c.width, c.height, 0, 0, true);
  if (!pic || !drawn) return 0;
  // Different widths at the same height: a different font (or a different word).
  const ratio = Math.abs(Math.log(pic.w / drawn.w));
  if (ratio > 0.3) return 0;
  // Same width, then compare.
  const w = pic.w;
  const rs = new Uint8Array(w * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < w; x++) rs[y * w + x] = drawn.px[y * drawn.w + Math.min(drawn.w - 1, Math.floor((x * drawn.w) / w))];
  const a = blurred(pic.px, w), b = blurred(rs, w);
  let mn = 0, mx = 0;
  for (let i = 0; i < a.length; i++) { mn += Math.min(a[i], b[i]); mx += Math.max(a[i], b[i]); }
  return (mx ? mn / mx : 0) * (1 - ratio);
}

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

function distance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

/** Free fonts whose names are spelled close to what was read (at most a third of the letters differ). */
export function closeSpellings(read: string, names: string[], max = 6): string[] {
  const r = squash(read);
  if (r.length < 4) return [];
  const limit = Math.max(1, Math.floor(r.length / 3));
  return names
    .map((n) => [n, squash(n)] as const)
    .filter(([, k]) => Math.abs(k.length - r.length) <= limit)
    .map(([n, k]) => [n, distance(r, k)] as const)
    .filter(([, d]) => d > 0 && d <= limit)
    .sort((a, b) => a[1] - b[1])
    .slice(0, max)
    .map(([n]) => n);
}
