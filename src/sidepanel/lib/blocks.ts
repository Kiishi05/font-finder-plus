// Splits the lines read from an image into blocks of the same text style: a
// heading, a paragraph, a caption. Each block is matched on its own.
import type { OcrLine } from './ocr';

export interface TextBlock {
  lines: { line: OcrLine; index: number }[];
  box: { x0: number; y0: number; x1: number; y1: number };
  text: string;
  /** Typical letter height in pixels. */
  size: number;
}

/** Height of the line's small letters (x-height-ish), steadier than the box. */
function letterSize(l: OcrLine): number {
  const hs = l.symbols.filter((s) => /^[acemnorsuvwxz]$/.test(s.text)).map((s) => s.bbox.y1 - s.bbox.y0).sort((a, b) => a - b);
  if (hs.length >= 2) return hs[Math.floor(hs.length / 2)];
  return (l.bbox.y1 - l.bbox.y0) * 0.55;
}

export function groupBlocks(lines: OcrLine[]): TextBlock[] {
  const items = lines
    .map((line, index) => ({ line, index, size: letterSize(line) }))
    .filter((x) => x.line.symbols.some((s) => /[A-Za-z0-9]/.test(s.text)))
    .sort((a, b) => a.line.bbox.y0 - b.line.bbox.y0);
  const blocks: (TextBlock & { sizes: number[] })[] = [];
  for (const it of items) {
    const b = blocks[blocks.length - 1];
    const lineH = it.line.bbox.y1 - it.line.bbox.y0;
    const sameSize = b && Math.abs(it.size / b.size - 1) <= 0.2;
    const near = b && it.line.bbox.y0 - b.box.y1 <= Math.max(lineH, b.size * 2) * 1.1;
    const overlap = b && Math.min(it.line.bbox.x1, b.box.x1) - Math.max(it.line.bbox.x0, b.box.x0) > 0;
    if (b && sameSize && near && overlap) {
      b.lines.push({ line: it.line, index: it.index });
      b.box = { x0: Math.min(b.box.x0, it.line.bbox.x0), y0: b.box.y0, x1: Math.max(b.box.x1, it.line.bbox.x1), y1: Math.max(b.box.y1, it.line.bbox.y1) };
      b.text += ' ' + it.line.text;
      b.sizes.push(it.size);
      b.size = b.sizes.reduce((x, y) => x + y, 0) / b.sizes.length;
    } else {
      blocks.push({ lines: [{ line: it.line, index: it.index }], box: { ...it.line.bbox }, text: it.line.text, size: it.size, sizes: [it.size] });
    }
  }
  return blocks.map(({ sizes, ...b }) => (void sizes, b));
}
