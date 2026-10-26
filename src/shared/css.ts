import type { TypeSample } from './types';

export function quoteFamily(name: string): string {
  return /^[a-z-]+$/i.test(name) && !/\s/.test(name) ? name : `"${name.replace(/"/g, '\\"')}"`;
}

export function fontStackCss(declared: string[]): string {
  return declared.map((f) => (isGeneric(f) ? f : quoteFamily(f))).join(', ');
}

function isGeneric(f: string): boolean {
  return ['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'emoji', 'math', '-apple-system', 'BlinkMacSystemFont'].includes(f);
}

const BASIC_GENERIC = ['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy'];

/**
 * A short font stack to copy: the families up to the one that actually
 * renders, then one generic fallback. Sites often list dozens of fallbacks
 * for other languages; those are left out.
 */
export function tidyStack(declared: string[], rendered?: string | null): string[] {
  if (!declared.length) return rendered ? [rendered, 'sans-serif'] : [];
  const lower = declared.map((d) => d.toLowerCase());
  let idx = rendered ? lower.indexOf(rendered.toLowerCase()) : -1;
  if (idx < 0) idx = Math.max(0, declared.findIndex((d) => !isGeneric(d)));
  let keep = declared.slice(0, idx + 1);
  if (keep.length > 4) keep = [keep[0], ...keep.slice(-3)];
  if (!isGeneric(keep[keep.length - 1])) {
    const generic = declared.slice(idx + 1).find((d) => BASIC_GENERIC.includes(d)) ?? declared.find((d) => BASIC_GENERIC.includes(d));
    if (generic) keep.push(generic);
  }
  return keep;
}

/** The CSS a designer would paste to reproduce this text style. */
export function declarationCss(declared: string[], s: TypeSample, rendered?: string | null): string {
  const lines = [
    `font-family: ${fontStackCss(tidyStack(declared, rendered))};`,
    `font-weight: ${s.fontWeight};`,
    s.fontStyle !== 'normal' ? `font-style: ${s.fontStyle};` : null,
    `font-size: ${round(s.fontSize)}px;`,
    `line-height: ${s.lineHeight};`,
    s.letterSpacing !== 'normal' ? `letter-spacing: ${s.letterSpacing};` : null,
  ];
  return lines.filter(Boolean).join('\n');
}

export function round(n: number, d = 2): number {
  const m = 10 ** d;
  return Math.round(n * m) / m;
}

/** "52.8px · 1.1" style line height text. */
export function lineHeightLabel(lineHeight: string, fontSize: number): string {
  if (lineHeight === 'normal') return 'normal';
  const px = parseFloat(lineHeight);
  if (!Number.isFinite(px) || !fontSize) return lineHeight;
  return `${round(px, 1)}px · ${round(px / fontSize, 2)}`;
}

const WEIGHT_NAMES: Record<string, string> = {
  '100': 'Thin', '200': 'ExtraLight', '300': 'Light', '400': 'Regular', '500': 'Medium',
  '600': 'SemiBold', '700': 'Bold', '800': 'ExtraBold', '900': 'Black',
};

export function weightLabel(w: string): string {
  const name = WEIGHT_NAMES[String(Math.round(Number(w) / 100) * 100)];
  return name ? `${w} ${name}` : w;
}

export function rgbToHex(color: string): string {
  const m = color.match(/rgba?\(([^)]+)\)/);
  if (!m) return color;
  const [r, g, b, a] = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
  const hex = '#' + [r, g, b].map((n) => Math.round(n).toString(16).padStart(2, '0')).join('').toUpperCase();
  return a !== undefined && a < 1 ? `${hex} · ${Math.round(a * 100)}%` : hex;
}
