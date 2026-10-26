// Turns the raw text styles of a page into a named type system, finds the
// size scale, writes exports, and reads font-loading details.
import { googleFamily } from '../../shared/catalog';
import { quoteFamily, tidyStack } from '../../shared/css';
import type { DevInfo, PageScan, Role, TextStyle } from '../../shared/types';

export interface NamedStyle extends TextStyle {
  name: string;
  /** Unitless line height, or null for normal. */
  lh: number | null;
  /** Letter spacing in em. */
  em: number;
}

const r = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
const top = <K extends string>(m: Partial<Record<K, number>>): K | null => {
  let best: K | null = null;
  let n = -1;
  for (const [k, v] of Object.entries(m) as [K, number][]) if (v > n) [best, n] = [k, v];
  return best;
};

/** Name each style the way a designer would: h1 to h6, body, lead, small, button, link... */
export function nameStyles(styles: TextStyle[]): NamedStyle[] {
  const meaningful = styles.filter((s) => s.count >= 2 || /^h[1-6]$/.test(top(s.tags) ?? ''));
  const list = meaningful.length >= 3 ? meaningful : styles;
  const bodyCandidates = list.filter((s) => (s.roles.body ?? 0) >= s.count / 2);
  const body = [...(bodyCandidates.length ? bodyCandidates : list)].sort((a, b) => b.count - a.count)[0];
  const used = new Map<string, number>();
  const out = list.map((s) => {
    const tag = top(s.tags) ?? '';
    const role = top(s.roles) as Role | null;
    let name: string;
    if (/^h[1-6]$/.test(tag)) name = tag;
    else if (s === body) name = 'body';
    else if (role === 'button') name = 'button';
    else if (role === 'code') name = 'code';
    else if (role === 'nav') name = 'nav';
    else if (role === 'link') name = 'link';
    else if (role === 'caption') name = 'caption';
    else if (body && s.size > body.size * 1.3) name = 'display';
    else if (body && s.size > body.size) name = 'lead';
    else if (body && s.size < body.size) name = 'small';
    else name = 'text';
    const n = (used.get(name) ?? 0) + 1;
    used.set(name, n);
    return {
      ...s,
      name: n > 1 ? `${name}-${n}` : name,
      lh: s.lineHeight == null ? null : r(s.lineHeight / s.size),
      em: s.letterSpacing ? r(s.letterSpacing / s.size, 3) : 0,
    };
  });
  return out;
}

export const SCALES: [number, string][] = [
  [1.067, 'Minor second'],
  [1.125, 'Major second'],
  [1.2, 'Minor third'],
  [1.25, 'Major third'],
  [1.333, 'Perfect fourth'],
  [1.414, 'Augmented fourth'],
  [1.5, 'Perfect fifth'],
  [1.618, 'Golden ratio'],
];

export interface ScaleResult {
  base: number;
  ratio: number | null;
  label: string | null;
  fits: number;
  total: number;
  sizes: number[];
}

/** Do the sizes follow a modular scale (base times ratio to a whole power)? */
export function detectScale(styles: NamedStyle[]): ScaleResult {
  const body = styles.find((s) => s.name === 'body');
  const base = body?.size ?? 16;
  const sizes = [...new Set(styles.map((s) => r(s.size, 1)))].sort((a, b) => b - a);
  const others = sizes.filter((s) => Math.abs(s - base) > 0.5);
  let best: ScaleResult = { base, ratio: null, label: null, fits: 0, total: others.length, sizes };
  for (const [ratio, label] of SCALES) {
    let fits = 0;
    for (const s of others) {
      const n = Math.round(Math.log(s / base) / Math.log(ratio));
      if (n === 0) continue;
      const predicted = base * ratio ** n;
      // Small ratios fit almost anything, so they must fit more closely.
      if (Math.abs(predicted - s) / s <= Math.min(0.05, (ratio - 1) * 0.25)) fits++;
    }
    // Ties go to the larger ratio (the clearer scale).
    if (fits >= best.fits && fits > 0) best = { base, ratio, label, fits, total: others.length, sizes };
  }
  if (!best.total || best.fits < 2 || best.fits / best.total < 0.6) best = { ...best, ratio: null, label: null };
  return best;
}

// ------------------------------------------------------------- export

interface Family { token: string; stack: string[]; name: string; google: boolean }

function families(styles: NamedStyle[]): Map<string, Family> {
  const map = new Map<string, Family>();
  const roleOf = (s: NamedStyle) => (/^h[1-6]|display/.test(s.name) ? 'heading' : s.name.startsWith('body') ? 'body' : s.name.startsWith('code') ? 'mono' : null);
  const taken = new Set<string>();
  const ordered = [...styles].sort((a, b) => (roleOf(a) ? 0 : 1) - (roleOf(b) ? 0 : 1));
  for (const s of ordered) {
    if (map.has(s.fontKey)) continue;
    const name = s.displayName || s.family;
    let token = roleOf(s) ?? name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (taken.has(token)) token = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    taken.add(token);
    const stack = tidyStack(s.declared, s.family).map((f) => (f.toLowerCase() === s.family.toLowerCase() ? name : f));
    map.set(s.fontKey, { token, stack, name, google: !!googleFamily(name) });
  }
  return map;
}

const stackCss = (stack: string[]) => stack.map((f) => (/^(serif|sans-serif|monospace|cursive|fantasy|system-ui)$/.test(f) ? f : quoteFamily(f))).join(', ');
const lhText = (s: NamedStyle) => (s.lh == null ? 'normal' : String(s.lh));
const lsText = (s: NamedStyle) => (s.em ? `${s.em}em` : '0');

function googleImport(styles: NamedStyle[], fams: Map<string, Family>): string | null {
  const byFamily = new Map<string, Set<string>>();
  for (const s of styles) {
    const f = fams.get(s.fontKey)!;
    if (!f.google) continue;
    const gf = googleFamily(f.name)!;
    const set = byFamily.get(gf.family) ?? new Set<string>();
    set.add(`${s.style === 'italic' ? 1 : 0},${s.weight}`);
    byFamily.set(gf.family, set);
  }
  if (!byFamily.size) return null;
  const parts = [...byFamily].map(([fam, set]) => {
    const tuples = [...set].sort();
    const ital = tuples.some((t) => t.startsWith('1'));
    const spec = ital ? `ital,wght@${tuples.join(';')}` : `wght@${tuples.map((t) => t.split(',')[1]).join(';')}`;
    return `family=${fam.replace(/ /g, '+')}:${spec}`;
  });
  return `https://fonts.googleapis.com/css2?${parts.join('&')}&display=swap`;
}

export type ExportFormat = 'css' | 'tailwind3' | 'tailwind4' | 'tokens' | 'framer';

export const EXPORTS: { id: ExportFormat; label: string; file: string; note: string }[] = [
  { id: 'css', label: 'CSS variables', file: 'type-system.css', note: 'Paste into your stylesheet. Fonts not on Google Fonts need their own @font-face and a licence.' },
  { id: 'tailwind4', label: 'Tailwind v4 (@theme)', file: 'theme.css', note: 'Paste into the CSS file where you import Tailwind. Classes like text-h1 and font-heading become available.' },
  { id: 'tailwind3', label: 'Tailwind v3 (config)', file: 'tailwind.config.js', note: 'Merge into theme.extend in tailwind.config.js.' },
  { id: 'tokens', label: 'Design tokens (Figma)', file: 'type-tokens.json', note: 'W3C design tokens format. Import into Figma with the Tokens Studio plugin, or any tool that reads design tokens.' },
  { id: 'framer', label: 'Framer text styles', file: 'framer-text-styles.txt', note: 'Framer does not import style files, so this lists each style to create under Assets, Text Styles, with values in the units Framer uses.' },
];

export function exportSystem(format: ExportFormat, styles: NamedStyle[], host: string): string {
  const fams = families(styles);
  const fam = (s: NamedStyle) => fams.get(s.fontKey)!;
  const head = `Type system from ${host}, made with Font Finder Plus`;
  if (format === 'css') {
    const gi = googleImport(styles, fams);
    const lines = [`/* ${head} */`];
    if (gi) lines.push(`@import url('${gi}');`);
    lines.push('', ':root {');
    for (const f of fams.values()) lines.push(`  --font-${f.token}: ${stackCss(f.stack)};`);
    for (const s of styles) {
      lines.push(`  --text-${s.name}-size: ${r(s.size)}px;`, `  --text-${s.name}-line-height: ${lhText(s)};`, `  --text-${s.name}-weight: ${s.weight};`, `  --text-${s.name}-tracking: ${lsText(s)};`);
    }
    lines.push('}', '');
    for (const s of styles) {
      lines.push(`.text-${s.name} {`, `  font-family: var(--font-${fam(s).token});`, `  font-size: var(--text-${s.name}-size);`, `  line-height: var(--text-${s.name}-line-height);`, `  font-weight: var(--text-${s.name}-weight);`, `  letter-spacing: var(--text-${s.name}-tracking);`);
      if (s.style !== 'normal') lines.push(`  font-style: ${s.style};`);
      if (s.transform !== 'none') lines.push(`  text-transform: ${s.transform};`);
      lines.push('}', '');
    }
    return lines.join('\n');
  }
  if (format === 'tailwind4') {
    const gi = googleImport(styles, fams);
    const lines = [`/* ${head} */`];
    if (gi) lines.push(`@import url('${gi}');`);
    lines.push('', '@theme {');
    for (const f of fams.values()) lines.push(`  --font-${f.token}: ${stackCss(f.stack)};`);
    for (const s of styles) {
      lines.push(`  --text-${s.name}: ${r(s.size)}px;`, `  --text-${s.name}--line-height: ${lhText(s)};`, `  --text-${s.name}--font-weight: ${s.weight};`, `  --text-${s.name}--letter-spacing: ${lsText(s)};`);
    }
    lines.push('}');
    return lines.join('\n');
  }
  if (format === 'tailwind3') {
    const ff = [...fams.values()].map((f) => `        '${f.token}': [${f.stack.map((x) => `'${x.replace(/'/g, "\\'")}'`).join(', ')}],`);
    const fs = styles.map((s) => `        '${s.name}': ['${r(s.size)}px', { lineHeight: '${lhText(s)}', letterSpacing: '${lsText(s)}', fontWeight: '${s.weight}' }],`);
    return [`// ${head}`, 'module.exports = {', '  theme: {', '    extend: {', '      fontFamily: {', ...ff, '      },', '      fontSize: {', ...fs, '      },', '    },', '  },', '};', ''].join('\n');
  }
  if (format === 'tokens') {
    const family: Record<string, unknown> = {};
    for (const f of fams.values()) family[f.token] = { $type: 'fontFamily', $value: f.stack };
    const typography: Record<string, unknown> = {};
    for (const s of styles) {
      typography[s.name] = {
        $type: 'typography',
        $value: {
          fontFamily: `{font.family.${fam(s).token}}`,
          fontSize: `${r(s.size)}px`,
          fontWeight: Number(s.weight) || s.weight,
          lineHeight: s.lh ?? 'normal',
          letterSpacing: s.em ? `${s.em}em` : '0em',
          ...(s.style !== 'normal' ? { fontStyle: s.style } : {}),
          ...(s.transform !== 'none' ? { textCase: s.transform } : {}),
        },
        $description: `${s.count} ${s.count === 1 ? 'element' : 'elements'} on ${host}`,
      };
    }
    return JSON.stringify({ $description: head, font: { family }, typography }, null, 2);
  }
  // Framer
  const lines = [head, '', 'Create each one in Framer under Assets, Text Styles.', ''];
  for (const s of styles) {
    const f = fam(s);
    lines.push(
      `${s.name}`,
      `  Font: ${f.name} ${s.weight}${s.style !== 'normal' ? ' italic' : ''}`,
      `  Size: ${r(s.size)}px`,
      `  Line height: ${s.lh == null ? 'normal' : `${r(s.lh, 2)}em (${Math.round(s.lh * 100)}%)`}`,
      `  Letter spacing: ${s.em ? `${s.em}em` : '0em'}`,
      ...(s.transform !== 'none' ? [`  Transform: ${s.transform}`] : []),
      '',
    );
  }
  lines.push('Fonts:');
  for (const f of fams.values()) lines.push(`  ${f.name}: ${f.google ? 'on Google Fonts, available in Framer\'s font picker' : 'not on Google Fonts; upload the font files in Framer (needs a licence that allows it)'}`);
  return lines.join('\n');
}

// ------------------------------------------------------------- developer

export interface DevTip { level: 'warn' | 'tip' | 'ok'; text: string }

export interface DevSummary {
  files: number;
  knownBytes: number;
  unknownSizes: number;
  formats: Record<string, number>;
  families: { family: string; faces: number; loaded: number; weightsLoaded: string[]; weightsUsed: string[]; display: string[]; used: boolean }[];
  tips: DevTip[];
}

export function devSummary(dev: DevInfo, scan: PageScan | null): DevSummary {
  const urls = new Set<string>();
  let knownBytes = 0;
  let unknownSizes = 0;
  for (const res of dev.resources) {
    if (urls.has(res.url)) continue;
    urls.add(res.url);
    if (res.bytes) knownBytes += res.bytes;
    else unknownSizes++;
  }
  const formats: Record<string, number> = {};
  for (const res of dev.resources) {
    const ext = /\.(woff2|woff|ttf|otf|eot)(\?|#|$)/i.exec(res.url)?.[1]?.toLowerCase() ?? (/fonts\.gstatic\.com/.test(res.url) ? 'woff2' : 'other');
    formats[ext] = (formats[ext] ?? 0) + 1;
  }
  const usedFamilies = new Map<string, string[]>();
  for (const f of scan?.fonts ?? []) if (f.kind === 'web') usedFamilies.set(f.family.toLowerCase(), f.weights);
  const byFamily = new Map<string, DevSummary['families'][number]>();
  for (const face of dev.faces) {
    const k = face.family.toLowerCase();
    let e = byFamily.get(k);
    if (!e) {
      e = { family: face.family, faces: 0, loaded: 0, weightsLoaded: [], weightsUsed: usedFamilies.get(k) ?? [], display: [], used: usedFamilies.has(k) };
      byFamily.set(k, e);
    }
    e.faces++;
    if (face.status === 'loaded') {
      e.loaded++;
      if (!e.weightsLoaded.includes(face.weight)) e.weightsLoaded.push(face.weight);
    }
    if (!e.display.includes(face.display)) e.display.push(face.display);
  }
  const families = [...byFamily.values()].sort((a, b) => b.loaded - a.loaded);
  const tips: DevTip[] = [];
  const legacy = (formats.ttf ?? 0) + (formats.otf ?? 0) + (formats.eot ?? 0);
  if (legacy) tips.push({ level: 'warn', text: `${legacy} font ${legacy === 1 ? 'file is' : 'files are'} TTF, OTF or EOT. WOFF2 is compressed and usually much smaller.` });
  const blocking = families.filter((f) => f.display.some((d) => d === 'auto' || d === 'block'));
  if (blocking.length) tips.push({ level: 'tip', text: `${blocking.map((f) => f.family).join(', ')} ${blocking.length === 1 ? 'uses' : 'use'} font-display auto or block, so text can stay invisible while the font loads. font-display: swap shows fallback text right away.` });
  const unused = families.filter((f) => f.loaded > 0 && !f.used);
  if (unused.length) tips.push({ level: 'warn', text: `Loaded but not used on this page: ${unused.map((f) => f.family).join(', ')}.` });
  for (const f of families) {
    const variable = f.weightsLoaded.some((w) => /\s/.test(w));
    if (!variable && f.used && f.weightsLoaded.length > f.weightsUsed.length + 1) tips.push({ level: 'tip', text: `${f.family}: ${f.weightsLoaded.length} weights loaded, ${f.weightsUsed.length} used on this page (${f.weightsUsed.join(', ')}).` });
  }
  if (!dev.preloads.length && families.some((f) => f.used)) tips.push({ level: 'tip', text: 'No font is preloaded. Preloading the main text font (link rel="preload" as="font") can make it appear sooner.' });
  for (const href of dev.googleCss) if (!/display=/.test(href)) tips.push({ level: 'tip', text: 'A Google Fonts link has no display parameter. Adding &display=swap shows text while fonts load.' });
  if (!tips.length) tips.push({ level: 'ok', text: 'Nothing to flag in how fonts load on this page.' });
  return { files: urls.size, knownBytes, unknownSizes, formats, families, tips };
}
