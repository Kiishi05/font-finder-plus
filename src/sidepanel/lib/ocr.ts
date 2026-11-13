// Text recognition with Tesseract, running entirely in the extension from the
// bundled files (no downloads, nothing sent anywhere).
import { createWorker, type Worker } from 'tesseract.js';
import { realLines, wordLetters } from './ocrclean';
export { realLines, wordLetters };

export interface OcrBox { x0: number; y0: number; x1: number; y1: number }
export interface OcrSymbol { text: string; confidence: number; bbox: OcrBox; /** First letter of a word (a space goes before it). */ wordStart: boolean }
export interface OcrLine { text: string; confidence: number; bbox: OcrBox; baseline: number | null; symbols: OcrSymbol[] }

let worker: Promise<Worker> | null = null;
let progressTo: ((p: number) => void) | undefined;

function getWorker(onProgress?: (p: number) => void): Promise<Worker> {
  progressTo = onProgress;
  worker ??= createWorker('eng', 1, {
    workerPath: chrome.runtime.getURL('ocr/worker.min.js'),
    corePath: chrome.runtime.getURL('ocr/core'),
    langPath: chrome.runtime.getURL('ocr/lang'),
    workerBlobURL: false,
    gzip: true,
    cacheMethod: 'none',
    legacyCore: false,
    legacyLang: false,
    logger: (m) => {
      if (m.status === 'recognizing text') progressTo?.(m.progress);
    },
  });
  worker.catch(() => (worker = null));
  return worker;
}

async function readLines(canvas: HTMLCanvasElement, onProgress?: (p: number) => void, scale = 1): Promise<OcrLine[]> {
  const w = await getWorker(onProgress);
  const { data } = await w.recognize(canvas, {}, { blocks: true, text: true });
  const k = 1 / scale;
  const box = (b: OcrBox): OcrBox => ({ x0: b.x0 * k, y0: b.y0 * k, x1: b.x1 * k, y1: b.y1 * k });
  const lines: OcrLine[] = [];
  for (const block of data.blocks ?? []) {
    for (const para of block.paragraphs) {
      for (const line of para.lines) {
        const symbols: OcrSymbol[] = [];
        for (const word of line.words) word.symbols.forEach((s, i) => symbols.push({ text: s.text, confidence: s.confidence, bbox: box(s.bbox), wordStart: i === 0 }));
        const b = line.baseline;
        const baseline = b && Number.isFinite(b.y0) && Number.isFinite(b.y1) && (b.y0 || b.y1) ? ((b.y0 + b.y1) / 2) * k : null;
        if (line.text.trim()) lines.push({ text: line.text.trim(), confidence: line.confidence, bbox: box(line.bbox), baseline, symbols });
      }
    }
  }
  return lines;
}

const overlap = (a: OcrBox, b: OcrBox) => {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  if (w <= 0 || h <= 0) return 0;
  return (w * h) / Math.min((a.x1 - a.x0) * (a.y1 - a.y0), (b.x1 - b.x0) * (b.y1 - b.y0));
};

/** A smaller, slightly softened copy: big letters printed over dots or texture read better this way. */
function softened(canvas: HTMLCanvasElement, scale: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(canvas.width * scale));
  c.height = Math.max(1, Math.round(canvas.height * scale));
  const ctx = c.getContext('2d')!;
  ctx.filter = 'blur(1.2px)';
  ctx.drawImage(canvas, 0, 0, c.width, c.height);
  return c;
}

/** Read the text in an image. Returns the lines that were really read, with their letters and boxes. */
export async function recognize(canvas: HTMLCanvasElement, onProgress?: (p: number) => void): Promise<OcrLine[]> {
  const first = realLines(await readLines(canvas, (p) => onProgress?.(p * (canvas.width > 500 ? 0.6 : 1))));
  if (canvas.width <= 500 && canvas.height <= 500) return first;
  // A second look at a smaller copy finds big headings that the full-size pass sees as noise.
  const scale = Math.max(0.25, Math.min(0.5, 700 / Math.max(canvas.width, canvas.height)));
  const second = realLines(await readLines(softened(canvas, scale), (p) => onProgress?.(0.6 + p * 0.4), scale).catch(() => []));
  const out = [...first];
  for (const l of second) {
    const clash = out.findIndex((o) => overlap(o.bbox, l.bbox) > 0.4);
    if (clash < 0) out.push(l);
    else if (wordLetters(l.text) > wordLetters(out[clash].text) * 1.3 && l.confidence >= out[clash].confidence - 10) out[clash] = l;
  }
  return out.sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0);
}
