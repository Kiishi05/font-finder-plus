/// <reference lib="webworker" />
// Compares letters cut from an image with the glyph index (Regular and Bold of
// each Latin Google Fonts family). Runs in a Web Worker.
import * as fontkit from 'fontkit';
import { GLYPH_CHARS, RECORD, cropInk, makeRecord } from '../shared/glyphprint';
import { rankFonts, type Query } from '../shared/matchcore';
import { raster } from '../shared/shape';

/** A font the page itself uses, given as its file(s). */
interface Extra { family: string; regular: ArrayBuffer | null; bold: ArrayBuffer | null }

/** Fingerprints of one font file, in the same layout as the index. */
function fingerprintFile(buf: ArrayBuffer): Uint8Array | null {
  try {
    const f0: any = fontkit.create(new Uint8Array(buf) as any); // eslint-disable-line @typescript-eslint/no-explicit-any
    const font = f0.fonts ? f0.fonts[0] : f0;
    const upm = font.unitsPerEm;
    const out = new Uint8Array(GLYPH_CHARS.length * RECORD);
    let any = 0;
    for (let i = 0; i < GLYPH_CHARS.length; i++) {
      const cp = GLYPH_CHARS.codePointAt(i)!;
      if (!font.hasGlyphForCodePoint(cp)) continue;
      const g = font.glyphForCodePoint(cp);
      const bmp = raster(g, upm, 96);
      const ink = bmp && cropInk(bmp);
      if (!ink) continue;
      out.set(makeRecord(ink, (g.bbox.maxY - g.bbox.minY) / upm, g.bbox.minY / upm), i * RECORD);
      any++;
    }
    return any >= 10 ? out : null;
  } catch {
    return null;
  }
}

interface Req { id: number; type: 'match'; indexUrl: string; families: string[]; weights: number[]; glyphs: Query[]; limit: number; extra?: Extra[] }

let index: Uint8Array | null = null;
let loading: Promise<Uint8Array> | null = null;

async function loadIndex(url: string): Promise<Uint8Array> {
  if (index) return index;
  loading ??= (async () => {
    const res = await fetch(url);
    const stream = res.body!.pipeThrough(new DecompressionStream('gzip'));
    const buf = await new Response(stream).arrayBuffer();
    index = new Uint8Array(buf);
    return index;
  })();
  return loading;
}

self.onmessage = async (e: MessageEvent<Req>) => {
  const { id, indexUrl, families, weights, glyphs, limit, extra } = e.data;
  try {
    let ix = await loadIndex(indexUrl);
    let fams = families;
    let wts = weights;
    const onPage = new Set<string>();
    // Fonts this page uses (often paid ones) are compared too.
    if (extra?.length) {
      const per = GLYPH_CHARS.length * RECORD;
      const blocks: Uint8Array[] = [];
      const names: string[] = [];
      const ws: number[] = [];
      for (const x of extra) {
        const reg = x.regular ? fingerprintFile(x.regular) : null;
        const bold = x.bold ? fingerprintFile(x.bold) : null;
        if (!reg && !bold) continue;
        const block = new Uint8Array(per * 2);
        if (reg) block.set(reg, 0);
        if (bold) block.set(bold, per);
        blocks.push(block);
        names.push(x.family);
        ws.push((reg ? 1 : 0) | (bold ? 2 : 0));
        onPage.add(x.family);
      }
      if (blocks.length) {
        const all = new Uint8Array(ix.length + blocks.length * per * 2);
        all.set(ix, 0);
        blocks.forEach((b, i) => all.set(b, ix.length + i * per * 2));
        ix = all;
        fams = [...families, ...names];
        wts = [...weights, ...ws];
      }
    }
    const results = rankFonts(ix, fams, wts, glyphs, limit).map((r) => ({ ...r, onPage: onPage.has(r.family) }));
    (self as unknown as Worker).postMessage({ id, ok: true, results });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, ok: false, error: String((err as Error)?.message ?? err) });
  }
};
