import { shapeOf } from '../../shared/similar';
import type { Shape } from '../../shared/shape';
import type { FaceFile } from '../../shared/types';
import { facesForCoverage } from './coverage';
import { getFontBytes, parseFontBytes } from './fonts';

export interface ShapeResult {
  shape: Shape;
  /** google: measured from the Google Fonts family. file: from this site's regular font file. rendered: measured from how the installed font draws (no weight or contrast). */
  from: 'google' | 'file' | 'rendered';
  /** True when the measured file is not the regular weight, so weight counts for less. */
  notRegular: boolean;
}

const covers = (range: string | null, cp: number) => {
  if (!range) return true;
  return range.split(',').some((part) => {
    const [a, b] = part.trim().replace(/^u\+/i, '').split('-');
    const start = parseInt(a.replace(/\?/g, '0'), 16);
    const end = b ? parseInt(b, 16) : parseInt(a.replace(/\?/g, 'F'), 16);
    return start <= cp && end >= cp;
  });
};

/** Shape of a font for matching: Google data if it is a Google family, else its regular file, else how it renders. */
export async function shapeFor(opts: { catalogFamily: string | null; files: FaceFile[]; kind: string; family: string }, tabId: number | null): Promise<ShapeResult | null> {
  if (opts.catalogFamily) {
    const s = shapeOf(opts.catalogFamily);
    if (s) return { shape: s, from: 'google', notRegular: false };
  }
  if (opts.kind === 'web' && opts.files.length) {
    const group = facesForCoverage(opts.files, '400', 'normal');
    const face = group.find((f) => covers(f.unicodeRange, 0x78)) ?? group[0];
    if (face?.url) {
      try {
        const parsed = await parseFontBytes(await getFontBytes(face.url, tabId));
        if (parsed.shape) {
          const wc = parsed.weightClass ?? 400;
          return { shape: parsed.shape, from: 'file', notRegular: wc < 350 || wc > 450 };
        }
      } catch {
        /* fall through */
      }
    }
  }
  if (opts.kind !== 'web') {
    const s = renderedShape(opts.family);
    if (s) return { shape: s, from: 'rendered', notRegular: false };
  }
  return null;
}

/** Proportions measured from how an installed font draws in the panel. */
export function renderedShape(family: string): Shape | null {
  const c = document.createElement('canvas').getContext('2d');
  if (!c) return null;
  const S = 200;
  c.font = `${S}px "${family.replace(/"/g, '')}", "FFP NotDef"`;
  const m = (t: string) => c.measureText(t);
  const x = m('x').actualBoundingBoxAscent / S;
  const cap = m('H').actualBoundingBoxAscent / S;
  if (!x || !cap) return null;
  const o = m('o');
  const r3 = (n: number) => Math.round(n * 1000) / 1000;
  return {
    x: r3(x),
    cap: r3(cap),
    asc: r3(m('d').actualBoundingBoxAscent / S),
    desc: r3(m('p').actualBoundingBoxDescent / S),
    w: r3(m('abcdefghijklmnopqrstuvwxyz').width / 26 / S),
    stem: null,
    contrast: null,
    round: r3((o.actualBoundingBoxLeft + o.actualBoundingBoxRight) / (o.actualBoundingBoxAscent + o.actualBoundingBoxDescent)),
  };
}
