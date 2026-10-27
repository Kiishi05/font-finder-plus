/// <reference lib="webworker" />
// Compares letters cut from an image with the glyph index (Regular and Bold of
// each Latin Google Fonts family). Runs in a Web Worker.
import { rankFonts, type Query } from '../shared/matchcore';

interface Req { id: number; type: 'match'; indexUrl: string; families: string[]; weights: number[]; glyphs: Query[]; limit: number }

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
  const { id, indexUrl, families, weights, glyphs, limit } = e.data;
  try {
    const ix = await loadIndex(indexUrl);
    (self as unknown as Worker).postMessage({ id, ok: true, results: rankFonts(ix, families, weights, glyphs, limit) });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, ok: false, error: String((err as Error)?.message ?? err) });
  }
};
