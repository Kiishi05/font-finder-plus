// Type system health check: one score for a page's typography, from five
// parts (families, sizes, weights, loading, readability), each with the
// findings behind it and how to fix them. Only things measured on the page
// count; nothing is guessed.
import type { PageScan, ReadabilityIssue } from '../../shared/types';
import type { DevSummary, NamedStyle, ScaleResult } from './system';

export interface Finding {
  level: 'bad' | 'warn' | 'tip' | 'ok';
  text: string;
  /** What to change. */
  fix?: string;
}

export interface HealthPart {
  id: 'families' | 'sizes' | 'weights' | 'loading' | 'readability';
  label: string;
  score: number;
  /** Share of the total score. */
  weight: number;
  findings: Finding[];
}

export interface Health {
  score: number;
  grade: 'Excellent' | 'Good' | 'Fair' | 'Needs work';
  parts: HealthPart[];
}

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
const round1 = (n: number) => Math.round(n * 10) / 10;

export function healthCheck(input: { scan: PageScan; styles: NamedStyle[]; issues: ReadabilityIssue[]; dev: DevSummary; scale: ScaleResult }): Health {
  const { scan, styles, issues, dev, scale } = input;
  const parts: HealthPart[] = [];

  // ---- Families: two or three is plenty; fonts that never load are a problem.
  {
    const fonts = scan.fonts.filter((f) => f.kind !== 'generic' && f.elementCount > 0);
    const n = fonts.length;
    const findings: Finding[] = [];
    let score = n <= 2 ? 100 : n === 3 ? 85 : n === 4 ? 65 : n === 5 ? 50 : 35;
    if (n <= 3) findings.push({ level: 'ok', text: `${n} ${n === 1 ? 'font family' : 'font families'}: a focused set.` });
    else {
      const rare = [...fonts].sort((a, b) => a.elementCount - b.elementCount).slice(0, n - 3);
      findings.push({ level: n >= 5 ? 'bad' : 'warn', text: `${n} font families. Most type systems need two or three.`, fix: `Consider dropping the least used: ${rare.map((f) => `${f.displayName} (${f.elementCount} ${f.elementCount === 1 ? 'element' : 'elements'})`).join(', ')}.` });
    }
    for (const nl of scan.notLoaded) {
      score -= 15;
      findings.push({ level: 'bad', text: `${nl.family} is in the CSS but never loads; ${nl.fellBackTo} shows instead on ${nl.count} ${nl.count === 1 ? 'element' : 'elements'}.`, fix: `Fix the @font-face for ${nl.family}, or remove it from the font stack.` });
    }
    parts.push({ id: 'families', label: 'Font families', score: clamp(score), weight: 0.2, findings });
  }

  // ---- Sizes: a small set of sizes, on a scale, without near-duplicates.
  {
    const sizes = [...new Set(styles.map((s) => round1(s.size)))].sort((a, b) => b - a);
    const findings: Finding[] = [];
    let score = sizes.length <= 8 ? 100 : sizes.length <= 12 ? 80 : sizes.length <= 16 ? 60 : 40;
    findings.push({ level: sizes.length <= 8 ? 'ok' : sizes.length <= 12 ? 'warn' : 'bad', text: `${sizes.length} text sizes: ${sizes.slice(0, 12).map((s) => `${s}px`).join(', ')}${sizes.length > 12 ? '…' : ''}.`, fix: sizes.length > 8 ? 'Most sites need about 6 to 8 sizes. Merge sizes that are close together.' : undefined });
    const close: string[] = [];
    for (let i = 1; i < sizes.length; i++) if (sizes[i - 1] - sizes[i] <= 1 && sizes[i] < 40) close.push(`${sizes[i - 1]}px and ${sizes[i]}px`);
    if (close.length) {
      score -= Math.min(20, close.length * 6);
      findings.push({ level: 'warn', text: `Sizes almost the same: ${close.slice(0, 4).join('; ')}.`, fix: 'Pick one of each pair; a 1px difference is hard to see but adds a style to maintain.' });
    }
    if (scale.ratio && scale.total >= 3) {
      const fit = scale.fits / scale.total;
      if (fit >= 0.7) findings.push({ level: 'ok', text: `Sizes follow a ${scale.label} scale (ratio ${scale.ratio}) from a ${scale.base}px base: ${scale.fits} of ${scale.total} fit.` });
      else {
        score -= 10;
        findings.push({ level: 'warn', text: `Only ${scale.fits} of ${scale.total} sizes fit a scale.`, fix: `Sizes on a scale look related. The closest here is ${scale.label} (ratio ${scale.ratio}) from ${scale.base}px.` });
      }
    } else if (sizes.length >= 4) {
      score -= 10;
      findings.push({ level: 'warn', text: 'The sizes do not follow a type scale.', fix: 'Choose a ratio (for example 1.25, a major third) and set each size as the body size times that ratio.' });
    }
    parts.push({ id: 'sizes', label: 'Sizes', score: clamp(score), weight: 0.2, findings });
  }

  // ---- Weights: few weights per family, and only the ones that are used get loaded.
  {
    const findings: Finding[] = [];
    let score = 100;
    const byFont = new Map<string, Set<string>>();
    for (const s of styles) {
      const set = byFont.get(s.fontKey) ?? new Set<string>();
      set.add(s.weight);
      byFont.set(s.fontKey, set);
    }
    const names = new Map(scan.fonts.map((f) => [f.key, f.displayName]));
    for (const [key, ws] of byFont) {
      if (ws.size > 4) {
        score -= 15;
        findings.push({ level: 'warn', text: `${names.get(key) ?? key} uses ${ws.size} weights (${[...ws].sort().join(', ')}).`, fix: 'Three or four weights (for example 400, 500, 700) usually cover a whole site.' });
      }
    }
    for (const f of dev.families) {
      const extra = f.weightsLoaded.filter((w) => !f.weightsUsed.includes(w));
      if (f.used && extra.length >= 2) {
        score -= 8;
        findings.push({ level: 'warn', text: `${f.family} loads weights ${extra.join(', ')} that this page does not use.`, fix: 'Stop loading them, or use one variable font file instead of several.' });
      }
    }
    if (!findings.length) findings.push({ level: 'ok', text: 'Each family uses a small set of weights.' });
    parts.push({ id: 'weights', label: 'Weights', score: clamp(score), weight: 0.15, findings });
  }

  // ---- Loading: the developer checks, plus total size.
  {
    const findings: Finding[] = [];
    let score = 100;
    for (const t of dev.tips) {
      if (t.level === 'ok') continue;
      score -= t.level === 'warn' ? 12 : 5;
      findings.push({ level: t.level === 'warn' ? 'warn' : 'tip', text: t.text });
    }
    const kb = Math.round(dev.knownBytes / 1024);
    if (kb > 500) {
      score -= 20;
      findings.push({ level: 'bad', text: `${kb} KB of font files.`, fix: 'Subset the fonts to the characters you need, use WOFF2, and load fewer weights.' });
    } else if (kb > 250) {
      score -= 10;
      findings.push({ level: 'warn', text: `${kb} KB of font files.`, fix: 'Around 100 to 200 KB is typical. Subsetting and fewer weights help.' });
    } else if (dev.files) findings.push({ level: 'ok', text: `${kb ? `${kb} KB` : 'Small'} of font files in ${dev.files} ${dev.files === 1 ? 'file' : 'files'}.` });
    if (!findings.length) findings.push({ level: 'ok', text: 'Nothing to flag in how fonts load.' });
    parts.push({ id: 'loading', label: 'Loading', score: clamp(score), weight: 0.2, findings });
  }

  // ---- Readability: contrast, small or thin text, body size and line height.
  {
    const findings: Finding[] = [];
    let score = 100;
    for (const i of issues) {
      score -= i.level === 'fail' ? 20 : i.level === 'warn' ? 10 : 3;
      findings.push({ level: i.level === 'fail' ? 'bad' : i.level === 'warn' ? 'warn' : 'tip', text: `${i.title}: ${i.count} ${i.count === 1 ? 'place' : 'places'}.`, fix: i.detail });
    }
    const body = styles.find((s) => s.name === 'body');
    if (body) {
      if (body.size < 14) {
        score -= 15;
        findings.push({ level: 'bad', text: `Body text is ${round1(body.size)}px.`, fix: 'Body text reads best at 16px or more (at least 14px).' });
      } else if (body.size < 16) {
        score -= 5;
        findings.push({ level: 'warn', text: `Body text is ${round1(body.size)}px.`, fix: '16px or more is easier to read on most screens.' });
      }
      if (body.lh != null && body.lh < 1.3) {
        score -= 10;
        findings.push({ level: 'warn', text: `Body line height is ${round1(body.lh)}.`, fix: 'Around 1.4 to 1.6 is comfortable for paragraphs.' });
      }
    }
    if (!findings.length) findings.push({ level: 'ok', text: 'No readability problems found.' });
    parts.push({ id: 'readability', label: 'Readability', score: clamp(score), weight: 0.25, findings });
  }

  const score = clamp(parts.reduce((a, p) => a + p.score * p.weight, 0));
  const grade = score >= 90 ? 'Excellent' : score >= 75 ? 'Good' : score >= 60 ? 'Fair' : 'Needs work';
  return { score, grade, parts };
}
