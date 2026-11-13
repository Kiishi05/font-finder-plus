// Matching a website's fonts to the fonts Figma can use. No Figma API here, so
// this can be tested on its own.

export interface AvailableFont { family: string; style: string }

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Every family Figma lists, with its style names. */
export function familyIndex(fonts: AvailableFont[]): Map<string, { family: string; styles: string[] }> {
  const map = new Map<string, { family: string; styles: string[] }>();
  for (const f of fonts) {
    const k = squash(f.family);
    const e = map.get(k) ?? { family: f.family, styles: [] };
    e.styles.push(f.style);
    map.set(k, e);
  }
  return map;
}

/** The first of these names that Figma has, as Figma spells it. */
export function findFamily(index: Map<string, { family: string; styles: string[] }>, names: (string | null | undefined)[]): { family: string; styles: string[] } | null {
  for (const n of names) {
    if (!n) continue;
    const hit = index.get(squash(n));
    if (hit) return hit;
  }
  return null;
}

const WEIGHT_WORDS: [number, string[]][] = [
  [100, ['thin', 'hairline']],
  [200, ['extralight', 'ultralight']],
  [300, ['light']],
  [400, ['regular', 'normal', 'book', 'roman', '']],
  [500, ['medium']],
  [600, ['semibold', 'demibold']],
  [700, ['bold']],
  [800, ['extrabold', 'ultrabold', 'heavy']],
  [900, ['black']],
];

/** Numeric weight of a style name such as "Semi Bold Italic". */
export function weightOfStyle(style: string): number {
  const s = squash(style).replace(/italic|oblique/g, '');
  let best = 400;
  let len = -1;
  for (const [w, words] of WEIGHT_WORDS) for (const word of words) if (s.includes(word) && word.length > len) [best, len] = [w, word.length];
  return best;
}

export const isItalicStyle = (style: string) => /italic|oblique/i.test(style);

/** The style that best matches a CSS weight and italic, from the styles a family has. */
export function pickStyle(styles: string[], weight: string | number, italic: boolean): string | null {
  if (!styles.length) return null;
  const w = Number(weight) || 400;
  let best: string | null = null;
  let cost = Infinity;
  for (const st of styles) {
    const c = Math.abs(weightOfStyle(st) - w) + (isItalicStyle(st) === italic ? 0 : 1000) + (/condensed|narrow|expanded|wide|display|caption/i.test(st) ? 50 : 0);
    if (c < cost) [best, cost] = [st, c];
  }
  return best;
}

/** CSS text-transform to Figma text case. */
export function textCase(transform: string): 'UPPER' | 'LOWER' | 'TITLE' | 'ORIGINAL' {
  if (transform === 'uppercase') return 'UPPER';
  if (transform === 'lowercase') return 'LOWER';
  if (transform === 'capitalize') return 'TITLE';
  return 'ORIGINAL';
}

/** A name safe for a style or variable path segment. */
export const slug = (s: string) => s.trim().replace(/[/\\]+/g, '-').replace(/\s+/g, ' ');
