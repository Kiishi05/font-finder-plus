import { shapeOf } from '../../shared/similar';
import { shapeFromCanvas, type Shape } from '../../shared/shape';
import { sendToTab } from '../../shared/messages';
import type { FaceFile } from '../../shared/types';
import { facesForCoverage } from './coverage';
import { getFontBytes, parseFontBytes } from './fonts';

export interface ShapeResult {
  shape: Shape;
  /** google: the Google Fonts family. file: this site's regular font file. page: how the page draws it. rendered: how the installed font draws in the panel. */
  from: 'google' | 'file' | 'page' | 'rendered';
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
  if (opts.kind === 'web' && tabId != null) {
    // The file could not be read: measure the font as the page draws it.
    const s = await measureOnPage(tabId, opts.family);
    if (s) return { shape: s, from: 'page', notRegular: false };
  }
  if (opts.kind !== 'web') {
    const s = shapeFromCanvas(`"${opts.family.replace(/"/g, '')}", "FFP NotDef"`);
    if (s) return { shape: s, from: 'rendered', notRegular: false };
  }
  return null;
}

export async function measureOnPage(tabId: number, family: string, weight = '400', style = 'normal'): Promise<Shape | null> {
  const r = await sendToTab<{ ok: boolean; shape?: Shape | null }>(tabId, { type: 'ffp:measure', family, weight, style }, 8000);
  return r?.ok && r.shape ? r.shape : null;
}

