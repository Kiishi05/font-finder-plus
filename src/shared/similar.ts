// Similar fonts and pairs, from measured shapes (see shape.ts). Only Google
// Fonts families are suggested, so every suggestion is free to use.
import shapesJson from './data/gf-shapes.json';
import { googleFamily } from './catalog';
import { unpackShape, type Shape } from './shape';
import type { Classification } from './types';

const raw = (shapesJson as unknown as { families: Record<string, (number | null)[]> }).families;
export const SHAPES_DATE = (shapesJson as { generated: string }).generated;

const SECONDARY_LATIN = new Set(['japanese', 'korean', 'chinese-simplified', 'chinese-traditional', 'chinese-hongkong', 'tibetan', 'sinhala', 'myanmar', 'khmer', 'lao']);

const SCRIPT_NAME = /\b(Devanagari|Hindi|Marathi|Tamil|Bangla|Bengali|Gujarati|Gurmukhi|Kannada|Telugu|Malayalam|Oriya|Odia|Arabic|Hebrew|Thai|Thai Looped|Armenian|Georgian|Ethiopic|Sinhala|Khmer|Lao|Myanmar|Tibetan|Mongolian|Javanese|Balinese|Cherokee|Adlam|Syriac|Kufi|Naskh|Nastaliq|Urdu|JP|KR|SC|TC|HK)\b/;

type Key = 'x' | 'cap' | 'asc' | 'desc' | 'w' | 'stem' | 'contrast' | 'round' | 'sq' | 'tl' | 'dot';
type Feat = Key | `p${number}`;
const KEYS: Key[] = ['x', 'cap', 'asc', 'desc', 'w', 'stem', 'contrast', 'round', 'sq', 'tl', 'dot'];
const PROF_N = 9;
const FEATS: Feat[] = [...KEYS, ...Array.from({ length: PROF_N }, (_, i) => `p${i}` as Feat)];
// How much each measurement counts. The letter-width profile (p0 to p8) tells
// geometric fonts from grotesques; together it counts as much as width.
const WEIGHTS: Record<string, number> = { x: 2, cap: 0.8, asc: 0.6, desc: 0.6, w: 1.6, stem: 1.6, contrast: 1.6, round: 1.2, sq: 1.6, tl: 1.4, dot: 0.8 };
for (let i = 0; i < PROF_N; i++) WEIGHTS[`p${i}`] = 0.35;

// Contrast is skewed (sans about 1.1, Didones above 5), so compare it on a log scale.
const val = (s: Shape, k: Feat): number | null => {
  const v = /^p\d$/.test(k) ? s.prof?.[Number(k.slice(1))] : s[k as Key];
  if (v == null || !Number.isFinite(v)) return null;
  return k === 'contrast' ? Math.log(Math.max(0.2, v)) : v;
};

interface Entry { family: string; shape: Shape; c: Classification; p: number }
let entries: Entry[] | null = null;
const stats = {} as Record<string, { mean: number; sd: number }>;

function load(): Entry[] {
  if (entries) return entries;
  const seen = new Map<string, Entry>();
  for (const [family, arr] of Object.entries(raw)) {
    const gf = googleFamily(family);
    if (!gf || !gf.s.includes('latin')) continue;
    // Chinese, Japanese and Korean families and some other scripts carry Latin
    // letters as a secondary set; they are not good Latin suggestions.
    if (gf.s.some((x) => SECONDARY_LATIN.has(x)) || SCRIPT_NAME.test(family)) continue;
    const e: Entry = { family, shape: unpackShape(arr), c: gf.c, p: gf.p ?? 9999 };
    // Script versions of a family ("Noto Sans Tamil") share its Latin letters. Keep the best known one.
    const sig = arr.join(',');
    const prev = seen.get(sig);
    if (!prev || e.p < prev.p) seen.set(sig, e);
  }
  entries = [...seen.values()];
  for (const k of FEATS) {
    const vs = entries.map((e) => val(e.shape, k)).filter((v): v is number => v != null);
    const mean = vs.reduce((a, b) => a + b, 0) / Math.max(1, vs.length);
    const sd = Math.sqrt(vs.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, vs.length)) || 1;
    stats[k] = { mean, sd };
  }
  return entries;
}

export function shapeOf(family: string): Shape | null {
  const a = raw[family];
  return a ? unpackShape(a) : null;
}

function diffs(a: Shape, b: Shape): Partial<Record<Feat, number>> {
  const out: Partial<Record<Feat, number>> = {};
  for (const k of FEATS) {
    const va = val(a, k);
    const vb = val(b, k);
    if (va == null || vb == null) continue;
    out[k] = (vb - va) / stats[k].sd;
  }
  return out;
}

function distance(d: Partial<Record<Feat, number>>, ignoreWeight: boolean): number {
  let sum = 0;
  let wsum = 0;
  for (const k of FEATS) {
    const z = d[k];
    if (z == null) continue;
    const w = k === 'stem' && ignoreWeight ? 0.3 : WEIGHTS[k];
    sum += w * z * z;
    wsum += w;
  }
  return wsum ? Math.sqrt(sum / wsum) : 9;
}

const LABEL: Record<Key, string> = { x: 'x-height', cap: 'cap height', asc: 'ascenders', desc: 'descenders', w: 'width', stem: 'weight', contrast: 'contrast', round: 'roundness', sq: 'squareness', tl: 'stroke ends', dot: 'i dots' };
const MORE: Partial<Record<Key, [string, string]>> = {
  x: ['taller x-height', 'shorter x-height'],
  w: ['wider', 'narrower'],
  stem: ['bolder', 'lighter'],
  contrast: ['more contrast', 'less contrast'],
  round: ['rounder', 'more oval'],
  sq: ['squarer', 'rounder curves'],
  tl: ['squarer stroke ends', 'rounder stroke ends'],
};

/** Plain-language reason, e.g. "Same x-height and width. A little bolder." */
function reason(d: Partial<Record<Feat, number>>): string {
  const same = (['x', 'w', 'stem', 'contrast', 'round'] as Feat[]).filter((k) => KEYS.includes(k as Key)).filter((k) => d[k] != null && Math.abs(d[k]!) < 0.35).map((k) => LABEL[k as Key]);
  const differ = (Object.keys(MORE) as Key[])
    .filter((k) => d[k] != null && Math.abs(d[k]!) >= 0.8)
    .sort((a, b) => Math.abs(d[b]!) - Math.abs(d[a]!))
    .slice(0, 2)
    .map((k) => `${Math.abs(d[k]!) >= 1.6 ? '' : 'a little '}${MORE[k]![d[k]! > 0 ? 0 : 1]}`);
  const parts: string[] = [];
  if (same.length) parts.push(`Similar ${joinWords(same.slice(0, 3))}.`);
  if (differ.length) parts.push(`${cap(joinWords(differ))}.`);
  return parts.join(' ') || 'Close in overall proportions.';
}

const joinWords = (w: string[]) => (w.length <= 1 ? w.join('') : `${w.slice(0, -1).join(', ')} and ${w[w.length - 1]}`);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export interface Match {
  family: string;
  score: number;
  reason: string;
  c: Classification;
}

/**
 * Google Fonts families closest in shape. `score` is a 0 to 100 similarity of
 * measured proportions, not a guarantee that the fonts look alike.
 */
export function similarTo(target: Shape, opts: { exclude?: string; classification?: Classification; limit?: number; ignoreWeight?: boolean } = {}): Match[] {
  const list = load();
  const cls = opts.classification && opts.classification !== 'unknown' ? opts.classification : null;
  const ex = opts.exclude?.toLowerCase() ?? null;
  const scored = list
    // Leave out the font itself and its own variants ("Montserrat Alternates").
    .filter((e) => !ex || (e.family.toLowerCase() !== ex && !e.family.toLowerCase().startsWith(ex + ' ')))
    .map((e) => {
      const d = diffs(target, e.shape);
      let dist = distance(d, !!opts.ignoreWeight);
      if (cls && e.c !== cls) dist += cls === 'mono' || e.c === 'mono' ? 1.2 : 0.5;
      // A one-bowl "g" against a two-bowl "g" is easy to see, so it counts.
      if (target.g2 != null && e.shape.g2 != null && target.g2 !== e.shape.g2) dist += 0.2;
      // Same for a one-storey "a" (as in Futura) against a two-storey "a".
      if (target.a2 != null && e.shape.a2 != null && target.a2 !== e.shape.a2) dist += 0.35;
      // Among equally close matches, prefer well-made, widely used families.
      return { e, d, dist, rank: dist + Math.min(e.p, 1500) / 1500 * 0.15 };
    })
    .sort((a, b) => a.rank - b.rank)
    .slice(0, opts.limit ?? 8);
  return scored
    .map(({ e, d, dist }) => ({
      family: e.family,
      score: Math.max(1, Math.round(100 * Math.exp(-(dist * dist) / 0.4))),
      reason: reason(d),
      c: e.c,
    }))
    .sort((a, b) => b.score - a.score);
}

export interface Pair {
  family: string;
  role: 'body' | 'heading';
  reason: string;
}

const PARTNERS: Record<Classification, Classification[]> = {
  serif: ['sans'],
  sans: ['serif', 'display'],
  mono: ['sans', 'serif'],
  display: ['sans', 'serif'],
  script: ['sans', 'serif'],
  unknown: ['sans', 'serif'],
};

/**
 * Suggested pairs. The usual rules: contrast in style (a serif with a sans),
 * similar x-height so the two sit well together on a line, and well-made,
 * widely used families. These are suggestions, not rules.
 */
export function pairsFor(target: Shape, cls: Classification, opts: { exclude?: string; limit?: number } = {}): Pair[] {
  const list = load();
  const partners = PARTNERS[cls] ?? PARTNERS.unknown;
  const xr = target.x / target.cap;
  const role: Pair['role'] = cls === 'display' || cls === 'script' ? 'body' : cls === 'sans' ? 'heading' : 'body';
  const out: Pair[] = [];
  const firstWords = new Set<string>();
  const candidates = list
    .filter((e) => partners.includes(e.c) && e.family !== opts.exclude && e.p <= 400)
    .map((e) => {
      const ex = e.shape.x / e.shape.cap;
      const fit = Math.abs(ex - xr) * 8 + Math.abs(e.shape.w - target.w) * 2;
      return { e, fit: fit + e.p / 400 };
    })
    .sort((a, b) => a.fit - b.fit);
  for (const { e } of candidates) {
    const fw = e.family.split(' ')[0];
    if (firstWords.has(fw)) continue;
    firstWords.add(fw);
    const kind = e.c === 'serif' ? 'serif' : e.c === 'sans' ? 'sans' : e.c;
    out.push({
      family: e.family,
      role,
      reason: `A ${kind} for ${role === 'body' ? 'body text' : 'headings'}, with a similar x-height ratio so the two sit well together.`,
    });
    if (out.length >= (opts.limit ?? 6)) break;
  }
  return out;
}
