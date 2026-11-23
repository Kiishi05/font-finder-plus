// Measure a font's proportions with a canvas (the same way detect.ts measures
// cap and x-height). Used in the page for the site's fonts, and in the side
// panel for the fonts you pick. The font must already be loaded.
import type { TypeMetrics } from './typeadapt';

const LOWER = 'abcdefghijklmnopqrstuvwxyz';
let canvas: OffscreenCanvas | HTMLCanvasElement | null = null;

function context(): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null {
  if (!canvas) canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(8, 8) : document.createElement('canvas');
  return canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
}

/** Proportions per em at 100px. Null when the canvas cannot draw. */
export function measureTypeMetrics(familyCss: string, weight: string | number = 400, style = 'normal'): TypeMetrics | null {
  const ctx = context();
  if (!ctx) return null;
  ctx.font = `${style} ${weight} 100px ${familyCss}`;
  const x = ctx.measureText('x');
  const H = ctx.measureText('H');
  const d = ctx.measureText('d');
  const p = ctx.measureText('p');
  const all = ctx.measureText(LOWER);
  const i = ctx.measureText('iiiiiiiiii');
  const m = ctx.measureText('mmmmmmmmmm');
  const xh = x.actualBoundingBoxAscent / 100;
  if (!(xh > 0.2 && xh < 0.9)) return null;
  const box = (x.fontBoundingBoxAscent ?? 0) + (x.fontBoundingBoxDescent ?? 0);
  return {
    xh: round(xh),
    cap: round(H.actualBoundingBoxAscent / 100),
    asc: round(d.actualBoundingBoxAscent / 100),
    desc: round(p.actualBoundingBoxDescent / 100),
    wx: round(all.width / 26 / 100 / xh),
    normal: box ? round(box / 100) : undefined,
    mono: Math.abs(i.width - m.width) < 0.5,
  };
}

const round = (n: number) => Math.round(n * 1000) / 1000;
