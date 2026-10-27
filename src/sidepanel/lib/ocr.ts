// Text recognition with Tesseract, running entirely in the extension from the
// bundled files (no downloads, nothing sent anywhere).
import { createWorker, type Worker } from 'tesseract.js';

export interface OcrBox { x0: number; y0: number; x1: number; y1: number }
export interface OcrSymbol { text: string; confidence: number; bbox: OcrBox; /** First letter of a word (a space goes before it). */ wordStart: boolean }
export interface OcrLine { text: string; confidence: number; bbox: OcrBox; baseline: number | null; symbols: OcrSymbol[] }

let worker: Promise<Worker> | null = null;

function getWorker(onProgress?: (p: number) => void): Promise<Worker> {
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
      if (m.status === 'recognizing text' && onProgress) onProgress(m.progress);
    },
  });
  worker.catch(() => (worker = null));
  return worker;
}

/** Read the text in an image. Returns lines with their letters and boxes. */
export async function recognize(canvas: HTMLCanvasElement, onProgress?: (p: number) => void): Promise<OcrLine[]> {
  const w = await getWorker(onProgress);
  const { data } = await w.recognize(canvas, {}, { blocks: true, text: true });
  const lines: OcrLine[] = [];
  for (const block of data.blocks ?? []) {
    for (const para of block.paragraphs) {
      for (const line of para.lines) {
        const symbols: OcrSymbol[] = [];
        for (const word of line.words) word.symbols.forEach((s, i) => symbols.push({ text: s.text, confidence: s.confidence, bbox: s.bbox, wordStart: i === 0 }));
        const b = line.baseline;
        const baseline = b && Number.isFinite(b.y0) && Number.isFinite(b.y1) && (b.y0 || b.y1) ? (b.y0 + b.y1) / 2 : null;
        if (line.text.trim()) lines.push({ text: line.text.trim(), confidence: line.confidence, bbox: line.bbox, baseline, symbols });
      }
    }
  }
  return lines;
}
