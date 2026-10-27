import indexJson from '../../shared/data/glyph-index.json';
import type { QueryGlyph } from './imageprep';

const meta = indexJson as unknown as { generated: string; families: string[]; weights: number[] };
export const INDEX_COUNT = meta.families.length;

export interface ImageMatch {
  family: string;
  bold: boolean;
  /** 0 to 100. */
  score: number;
  reason: string;
  /** Letters that matched best and worst. */
  best: string[];
  missing: number;
}

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, (r: { ok: boolean; results?: RawResult[]; error?: string }) => void>();
interface RawResult { family: string; bold: boolean; total: number; perChar: number[]; heights: number; missing: number }

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('../../workers/match.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e) => {
    const cb = pending.get(e.data.id);
    if (cb) {
      pending.delete(e.data.id);
      cb(e.data);
    }
  };
  return worker;
}

/** The closest Google Fonts families for letters cut from an image. */
export function matchGlyphs(glyphs: QueryGlyph[], limit = 10): Promise<ImageMatch[]> {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, (r) => {
      if (!r.ok || !r.results) return reject(new Error(r.error ?? 'Matching failed.'));
      resolve(
        r.results.map((x) => {
          const ranked = glyphs.map((g, i) => [g.char, x.perChar[i]] as const).sort((a, b) => b[1] - a[1]);
          const best = [...new Set(ranked.slice(0, 3).map(([c]) => c))];
          const parts = [`Closest letters: ${best.join(', ')}.`];
          if (x.heights > 0.8) parts.push('Letter heights match.');
          if (x.bold) parts.push('Matched its Bold.');
          if (x.missing) parts.push(`${x.missing} of your letters are not in this font.`);
          // Raw similarity runs from about 0.75 (unrelated) to 1 (same font); shown on a 0 to 100 scale.
          const score = Math.round(Math.max(0, Math.min(1, (x.total - 0.75) / 0.23)) * 100);
          return { family: x.family, bold: x.bold, score, reason: parts.join(' '), best, missing: x.missing };
        }),
      );
    });
    getWorker().postMessage({
      id,
      type: 'match',
      indexUrl: chrome.runtime.getURL('data/glyph-index.bin.gz'),
      families: meta.families,
      weights: meta.weights,
      glyphs: glyphs.map((g) => ({ ci: g.ci, bits: g.bits, aspect: g.aspect, h: g.h, bottom: g.bottom })),
      limit,
    });
  });
}
