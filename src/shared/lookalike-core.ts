// Blends the two ways of judging look-alikes. Shared by the panel and the
// accuracy test (tests/lookalike-bench.mjs) so both use the same scoring.
import { googleFamily } from './catalog';
import type { Match } from './similar';

/** Share of the final score that comes from letter shapes (the rest is proportions). */
export const LETTER_SHARE = 0.7;

/**
 * Re-rank proportion matches with letter-shape scores (0 to 100). Families the
 * letter index does not cover (non-Latin) count for less.
 */
export function blend(metric: Match[], letters: Map<string, number> | null, limit: number, share = LETTER_SHARE): Match[] {
  if (!letters) return metric.slice(0, limit);
  return metric
    .map((m) => {
      const g = letters.get(m.family);
      if (g == null) return { ...m, score: Math.round(m.score * 0.8) };
      // Fonts made first for another alphabet are weaker suggestions for a Latin site,
      // unless they are among the most used (Poppins, Heebo).
      const gf = googleFamily(m.family);
      const other = gf?.ps && (gf.p ?? 9999) > 60 ? 5 : 0;
      const score = Math.min(100, Math.round(m.score * (1 - share) + g * share)) - other;
      return { ...m, score, reason: g >= 80 ? `Letters look alike. ${m.reason}` : m.reason };
    })
    // Same score: the better known family first (Roboto before the fonts that copy its Latin letters).
    .sort((a, b) => b.score - a.score || (a.p ?? 9999) - (b.p ?? 9999))
    .slice(0, limit);
}
