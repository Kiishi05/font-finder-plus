// "Use with my fonts": redo a site's text styles in other fonts, using each
// font's real proportions. Pure maths, no DOM, so it can be unit tested.
//
// Size:           keep the x-height the reader sees (cap height for all caps).
// Line height:    keep the line pitch in x-heights, adjusted for how tall the
//                 new font's ascenders and descenders are next to its x-height.
// Letter spacing: large text follows the new font's width; small text gets
//                 a small open-up when it ends up narrower or smaller.
// Weight:         the nearest weight the new font has.
//
// Also the "clean scale" maths for the System tab.

/** A font's proportions, each as a share of the em (font size). */
export interface TypeMetrics {
  /** x-height */
  xh: number;
  /** Cap height */
  cap: number;
  /** Ascender height (from the letter d) */
  asc: number;
  /** Descender depth (from the letter p) */
  desc: number;
  /** Average lowercase advance width, in x-heights. */
  wx: number;
  /** The font's "normal" line height (ascent + descent of its font box). */
  normal?: number;
  /** All letters the same width. */
  mono?: boolean;
}

export interface FontSide {
  name: string;
  metrics: TypeMetrics | null;
  /** Weights the font has, or 'any' for a variable font. */
  weights: number[] | 'any';
}

export interface SourceStyle {
  /** px */
  size: number;
  /** Unitless line height, or null for normal. */
  lh: number | null;
  /** Letter spacing in em. */
  ls: number;
  weight: number;
  /** Set in all caps (text-transform: uppercase). */
  caps: boolean;
}

export type AdaptKey = 'size' | 'lh' | 'ls' | 'weight';

export interface Adapted {
  size: number;
  lh: number;
  ls: number;
  weight: number;
  /** One plain sentence per value. */
  why: Record<AdaptKey, string>;
}

/** Text at or under this size is "small" for spacing (body copy, labels). */
export const TEXT_MAX = 20;

const clamp = (n: number, a: number, b: number) => Math.min(b, Math.max(a, n));
/** Sizes: whole pixels from 24px, half pixels under it. */
export const roundSize = (n: number) => (n >= 24 ? Math.round(n) : Math.round(n * 2) / 2);
/** Line height to the nearest 0.05. */
export const roundLh = (n: number) => +(Math.round(n * 20) / 20).toFixed(2);
/** Letter spacing to the nearest 0.005em (never -0). */
export const roundLs = (n: number) => {
  const v = +(Math.round(n / 0.005) * 0.005).toFixed(3);
  return Object.is(v, -0) || Math.abs(v) < 1e-9 ? 0 : v;
};

/** The weight closest to `want` that the font has. Ties go to the heavier weight. */
export function nearestWeight(want: number, weights: number[] | 'any'): number {
  if (weights === 'any' || !weights.length) return want;
  return weights.reduce((a, b) => {
    const da = Math.abs(a - want);
    const db = Math.abs(b - want);
    return db < da || (db === da && b > a) ? b : a;
  });
}

const WEIGHT_WORDS: [RegExp, number][] = [
  [/hairline|thin/i, 100],
  [/extra ?light|ultra ?light/i, 200],
  [/light/i, 300],
  [/semi ?bold|demi ?bold/i, 600],
  [/extra ?bold|ultra ?bold/i, 800],
  [/black|heavy/i, 900],
  [/bold/i, 700],
  [/medium/i, 500],
];

/** Weights from style names such as "Bold Italic" or "SemiBold" (installed fonts). */
export function weightsFromStyleNames(names: string[]): number[] {
  const out = new Set<number>();
  for (const n of names) {
    const hit = WEIGHT_WORDS.find(([re]) => re.test(n));
    out.add(hit ? hit[1] : 400);
  }
  return [...out].sort((a, b) => a - b);
}

/** Weights from a Google Fonts catalogue list ("400", "700i") and its axes. */
export function weightsFromCatalog(w: string[], axes: [string, number, number, number][] = []): number[] | 'any' {
  const wght = axes.find(([t]) => t === 'wght');
  if (wght) {
    const [, lo, hi] = wght;
    // A variable font: every weight in its range.
    if (lo <= 100 && hi >= 900) return 'any';
    const list: number[] = [];
    for (let x = Math.ceil(lo / 100) * 100; x <= hi; x += 100) list.push(x);
    return list.length ? list : 'any';
  }
  const up = [...new Set(w.filter((x) => !x.endsWith('i')).map(Number).filter((n) => n > 0))].sort((a, b) => a - b);
  return up.length ? up : [400];
}

/** Redo one style in another font. With no metrics for either font, only the weight changes. */
export function adaptStyle(s: SourceStyle, theirs: FontSide, yours: FontSide): Adapted {
  const T = theirs.metrics;
  const F = yours.metrics;
  const why = {} as Record<AdaptKey, string>;
  const lhIn = s.lh ?? T?.normal ?? 1.2;
  const text = s.size <= TEXT_MAX;

  // ---- Size: same x-height (cap height for all caps).
  let size = s.size;
  if (T && F) {
    const metric = s.caps ? 'cap height' : 'x-height';
    const ratio = s.caps ? T.cap / F.cap : T.xh / F.xh;
    size = roundSize(clamp(s.size * ratio, s.size * 0.6, s.size * 1.6));
    if (size === s.size) why.size = `Same ${metric} as ${theirs.name} already.`;
    else if (size > s.size) why.size = `Bigger: ${yours.name} has a smaller ${metric} than ${theirs.name}${s.caps ? ', and this style is all caps' : ''}.`;
    else why.size = `Smaller: ${yours.name} has a bigger ${metric} than ${theirs.name}${s.caps ? ', and this style is all caps' : ''}.`;
  } else why.size = 'Kept: the fonts could not be measured.';

  // ---- Line height: keep the pitch the reader sees, scaled by vertical extent per x-height.
  let lh = roundLh(lhIn);
  if (T && F) {
    const ext = ((F.asc + F.desc) / F.xh) / ((T.asc + T.desc) / T.xh);
    // Big text needs room for tall ascenders; body text keeps its rhythm and changes less.
    const k = text ? 0.25 : 0.5;
    const pitchPx = lhIn * s.size * Math.pow(ext, k);
    lh = roundLh(clamp(pitchPx / size, 0.9, 2.4));
    const before = roundLh(lhIn);
    if (lh === before) why.lh = 'Same spacing works.';
    else if (lh > before) why.lh = ext > 1.02 ? `More room: ${yours.name}'s ascenders and descenders are taller next to its x-height.` : 'More room: keeps the same gap between lines at the new size.';
    else why.lh = ext < 0.98 ? `Closer: ${yours.name}'s ascenders and descenders are shorter next to its x-height.` : 'Closer: keeps the same gap between lines at the new size.';
  } else why.lh = 'Kept: the fonts could not be measured.';

  // ---- Letter spacing.
  let ls = s.ls;
  if (T && F) {
    const r = F.wx / T.wx;
    if (s.caps && T.mono && !F.mono) {
      ls = roundLs(s.ls * 0.75);
      why.ls = ls === roundLs(s.ls) ? `${yours.name} needs the same space between capitals.` : `Tighter: ${yours.name} is not monospaced, so its capitals need less space.`;
    } else if (!text) {
      // Large text: follow the new font's width (narrower opens up, wider tightens).
      ls = roundLs(s.ls < 0 ? s.ls * clamp(Math.pow(r, 3), 0.3, 2) : s.ls + (1 - r) * 0.02);
      why.ls = ls === roundLs(s.ls) ? `${yours.name} is about as wide as ${theirs.name}.` : ls > s.ls ? `Looser: ${yours.name} is narrower than ${theirs.name}.` : `Tighter: ${yours.name} is wider than ${theirs.name}.`;
    } else {
      // Small text: a small open-up when the new font is narrower, and a minimum for very small sizes.
      let v = s.ls + clamp((1 - r) * 0.04, -0.01, 0.015);
      if (size < 14 && v < 0.01) v = 0.01;
      ls = roundLs(v);
      why.ls = ls === roundLs(s.ls) ? `${yours.name} is about as wide as ${theirs.name}.` : ls > s.ls ? (size < 14 && r >= 1 ? `Opened up a little: very small text reads better with some space.` : `Opened up a little: ${yours.name} is narrower than ${theirs.name}.`) : `Tighter: ${yours.name} is wider than ${theirs.name} at small sizes.`;
    }
  } else {
    ls = roundLs(s.ls);
    why.ls = 'Kept: the fonts could not be measured.';
  }

  // ---- Weight: the nearest one the font has.
  const weight = nearestWeight(s.weight, yours.weights);
  if (weight === s.weight) why.weight = `${yours.name} has ${s.weight}.`;
  else if (yours.weights !== 'any' && yours.weights.length === 1) why.weight = `${yours.name} comes in one weight.`;
  else why.weight = `The nearest weight ${yours.name} has.`;

  return { size, lh, ls, weight, why };
}

// ------------------------------------------------------------- clean scale

export const CLEAN_RATIOS = [1.2, 1.25, 1.333] as const;

export interface CleanRow<T> {
  item: T;
  size: number;
  /** The nearest size on the scale (half pixels). */
  ideal: number;
  /** Steps from the base (0 = base). */
  step: number;
  /** Difference in px (ideal minus size), to the half pixel. */
  diff: number;
  /** More than 6% away from the scale. */
  far: boolean;
}

/** Each size next to the nearest step of base × ratio^n. */
export function cleanScale<T>(items: T[], sizeOf: (t: T) => number, base: number, ratio: number): CleanRow<T>[] {
  return items.map((item) => {
    const size = sizeOf(item);
    const step = Math.round(Math.log(size / base) / Math.log(ratio));
    const ideal = Math.round(base * ratio ** step * 2) / 2;
    const diff = Math.round((ideal - size) * 2) / 2;
    return { item, size, ideal, step, diff, far: Math.abs(size / ideal - 1) > 0.06 };
  });
}

/** The ratio whose scale fits the sizes best (most sizes close, then least total distance). */
export function closestRatio(sizes: number[], base: number, ratios: readonly number[] = CLEAN_RATIOS): number {
  let best = ratios[0];
  let bestScore = -Infinity;
  for (const r of ratios) {
    const rows = cleanScale(sizes, (s) => s, base, r);
    const score = rows.filter((x) => !x.far).length - rows.reduce((a, x) => a + Math.abs(x.size / x.ideal - 1), 0);
    if (score > bestScore + 1e-9) {
      best = r;
      bestScore = score;
    }
  }
  return best;
}

/** "+2px", "−0.5px" or "same". */
export const diffText = (d: number) => (d === 0 ? 'same' : `${d > 0 ? '+' : '−'}${Math.abs(d)}px`);
