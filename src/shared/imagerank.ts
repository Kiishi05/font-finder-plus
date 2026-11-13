// Final order of image matches, shared by the panel and the accuracy test:
// leave out families made first for another alphabet (they borrow their Latin
// letters from other fonts), and on a tie put the better known family first.
import { googleFamily } from './catalog';

export interface Ranked { family: string; total: number; onPage?: boolean }

const skip = (family: string) => {
  const gf = googleFamily(family);
  // Little-used families made first for another alphabet often borrow their Latin letters.
  return (!!gf?.ps && (gf.p ?? 9999) > 300) || /\b(Symbols|Math|Emoji|Music)\b/.test(family);
};

/** Shown score, 0 to 100. Raw similarity runs from about 0.75 (unrelated) to 1 (same font). */
export const shownScore = (total: number) => Math.round(Math.max(0, Math.min(1, (total - 0.75) / 0.23)) * 100);

const TIE = 0.0025;

export function orderImageMatches<T extends Ranked>(list: T[], limit: number): T[] {
  const sorted = list.filter((r) => r.onPage || !skip(r.family)).sort((a, b) => b.total - a.total);
  // Near ties (the same drawings, e.g. Inter and Inter Tight): the better known family first.
  const out: T[] = [];
  for (let i = 0; i < sorted.length; ) {
    let j = i + 1;
    while (j < sorted.length && sorted[i].total - sorted[j].total < TIE) j++;
    out.push(...sorted.slice(i, j).sort((a, b) => (googleFamily(a.family)?.p ?? 9999) - (googleFamily(b.family)?.p ?? 9999)));
    i = j;
  }
  return out.slice(0, limit);
}

export type Verdict = 'exact' | 'close' | 'unlikely';

/**
 * How sure an image match is. Set from tests/image-bench.mjs: matches labelled
 * "exact" this way were right every time in that test (50 fonts, 3 qualities).
 */
export function imageVerdict(scores: number[], letters: number): Verdict {
  const [a = 0, b = 0] = scores;
  if (letters < 4 || a < 45) return 'unlikely';
  if (a >= 80 || (a >= 60 && a - b >= 5)) return 'exact';
  return 'close';
}
