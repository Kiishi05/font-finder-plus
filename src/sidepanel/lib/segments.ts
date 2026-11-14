// Splits lines read from an image into separate samples. Text recognition
// often joins things that are not one piece of text: two columns on the same
// row ("Helvetica Neue      Inter"), or two names in a list set side by side
// ("Instrument Serif Tusker Grotesk"). Each sample is matched on its own.
import { splitNames } from './fontnames';
import type { OcrLine, OcrSymbol } from './ocr';

const LETTER = /[\p{L}0-9]/u;

/** Words of a line, as runs of its letters. */
function wordsOf(l: OcrLine): OcrSymbol[][] {
  const out: OcrSymbol[][] = [];
  for (const s of l.symbols) {
    if (s.wordStart || !out.length) out.push([]);
    out[out.length - 1].push(s);
  }
  return out.filter((w) => w.some((s) => LETTER.test(s.text)));
}

function lineFrom(base: OcrLine, words: OcrSymbol[][]): OcrLine {
  const symbols = words.flat();
  const box = {
    x0: Math.min(...symbols.map((s) => s.bbox.x0)),
    y0: Math.min(...symbols.map((s) => s.bbox.y0)),
    x1: Math.max(...symbols.map((s) => s.bbox.x1)),
    y1: Math.max(...symbols.map((s) => s.bbox.y1)),
  };
  return {
    text: words.map((w) => w.map((s) => s.text).join('')).join(' '),
    confidence: symbols.reduce((a, s) => a + s.confidence, 0) / symbols.length,
    bbox: box,
    baseline: base.baseline,
    symbols,
  };
}

/** Typical letter height of a line, for judging gaps. */
function letterHeight(l: OcrLine): number {
  const hs = l.symbols.filter((s) => LETTER.test(s.text)).map((s) => s.bbox.y1 - s.bbox.y0).sort((a, b) => a - b);
  return hs.length ? hs[Math.floor(hs.length / 2)] : l.bbox.y1 - l.bbox.y0;
}

/** Cuts a line where words are much further apart than word spaces (separate columns). */
function byGaps(l: OcrLine): OcrSymbol[][][] {
  const words = wordsOf(l);
  if (words.length < 2) return [words];
  const h = letterHeight(l);
  const gaps = words.slice(1).map((w, i) => w[0].bbox.x0 - words[i][words[i].length - 1].bbox.x1);
  const typical = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)];
  const out: OcrSymbol[][][] = [[words[0]]];
  gaps.forEach((g, i) => {
    // A column gap: wider than a letter is tall, and well beyond this line's word spaces.
    if (g > Math.max(h * 1.1, typical * 2.2)) out.push([]);
    out[out.length - 1].push(words[i + 1]);
  });
  return out;
}

/** The lines as separate samples (columns split apart, runs of names split into names). */
export function splitSamples(lines: OcrLine[]): OcrLine[] {
  const out: OcrLine[] = [];
  for (const l of lines) {
    for (const part of byGaps(l)) {
      if (!part.length) continue;
      const texts = part.map((w) => w.map((s) => s.text).join('').replace(/[^\p{L}0-9'’&.-]+$/u, ''));
      const names = part.length >= 2 ? splitNames(texts) : null;
      if (names) for (const [a, b] of names) out.push(lineFrom(l, part.slice(a, b)));
      else out.push(lineFrom(l, part));
    }
  }
  return out;
}
