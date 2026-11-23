// "Use with my fonts": the site's styles redone in your fonts, and the exports.
import { FIGMA_MARK, serializePayload, type FigmaFont, type FigmaPayload, type FigmaStyle } from '../../shared/figma-payload';
import { googleFontsUrl } from '../../shared/catalog';
import { summaryFor } from '../../shared/licences';
import type { ApplyTypeFace, ApplyTypeStyle } from '../../shared/messages';
import { adaptStyle, type AdaptKey, type Adapted, type TypeMetrics } from '../../shared/typeadapt';
import type { PageFontUsage } from '../../shared/types';
import { GENERIC, type PickedFont } from './myfonts';
import { prettyStyleName, type NamedStyle } from './system';

export type Slot = 'heading' | 'body' | 'mono';
export type Fonts = Record<Slot, PickedFont | null>;
export type Edit = Partial<Record<AdaptKey, number>>;

export interface MyRow {
  s: NamedStyle;
  name: string;
  slot: Slot;
  /** The slot's font, or the body font for Mono when none is picked. */
  font: PickedFont;
  /** Their values, in the same units. */
  from: { size: number; lh: number; ls: number; weight: number };
  auto: Adapted;
  /** After your edits. */
  size: number;
  lh: number;
  ls: number;
  weight: number;
  edited: Edit;
  caps: boolean;
}

/** Which of your fonts a style uses by default. */
export function defaultSlot(s: NamedStyle, base: number, site: PageFontUsage | undefined): Slot {
  if (s.name.startsWith('code') || site?.classification === 'mono') return 'mono';
  if (/^(h[1-6]|display)/.test(s.name) || s.size >= base * 1.45) return 'heading';
  return 'body';
}

export const metricsKey = (s: { family: string; weight: string; style: string }) => `${s.family}|${s.weight}|${s.style}`;

export function buildRows(
  styles: NamedStyle[],
  fonts: Fonts,
  siteFonts: Map<string, PageFontUsage>,
  theirs: Map<string, TypeMetrics | null>,
  yours: Map<string, TypeMetrics | null>,
  slots: Record<string, Slot>,
  edits: Record<string, Edit>,
): MyRow[] {
  const base = styles.find((s) => s.name === 'body')?.size ?? 16;
  const out: MyRow[] = [];
  for (const s of [...styles].sort((a, b) => b.size - a.size || b.count - a.count)) {
    const slot = slots[s.id] ?? defaultSlot(s, base, siteFonts.get(s.fontKey));
    const font = (slot === 'mono' ? fonts.mono ?? fonts.body : fonts[slot]) ?? fonts.body ?? fonts.heading;
    if (!font) continue;
    const caps = s.transform === 'uppercase';
    const from = { size: s.size, lh: s.lh ?? theirs.get(metricsKey(s))?.normal ?? 1.2, ls: s.em, weight: Number(s.weight) || 400 };
    const auto = adaptStyle(
      { size: s.size, lh: s.lh, ls: s.em, weight: from.weight, caps },
      { name: s.displayName || s.family, metrics: theirs.get(metricsKey(s)) ?? null, weights: 'any' },
      { name: font.name, metrics: yours.get(font.id) ?? null, weights: font.weights },
    );
    const e = edits[s.id] ?? {};
    out.push({ s, name: prettyStyleName(s.name), slot, font, from, auto, size: e.size ?? auto.size, lh: e.lh ?? auto.lh, ls: e.ls ?? auto.ls, weight: e.weight ?? auto.weight, edited: e, caps });
  }
  return out;
}

// ------------------------------------------------------------- formatting

export const fPx = (n: number) => `${+n.toFixed(1)}px`;
export const fLh = (n: number) => String(+n.toFixed(2));
export const fEm = (n: number) => (n === 0 ? '0' : `${n < 0 ? '−' : ''}${+Math.abs(n).toFixed(3)}em`);

// ------------------------------------------------------------- page

/** The styles as page changes. Font files go with the first style of each font only. */
export function rowsToApply(rows: MyRow[], pageFonts: Map<string, { faces?: ApplyTypeFace[]; fontUrlCss?: string }>): ApplyTypeStyle[] {
  const sent = new Set<string>();
  return rows.map((r) => {
    const pf = sent.has(r.font.id) ? {} : pageFonts.get(r.font.id) ?? {};
    sent.add(r.font.id);
    return {
      selectorRole: r.s.name.replace(/-\d+$/, ''),
      styleId: r.s.id,
      name: r.name,
      family: r.font.catalogFamily ?? r.font.name,
      weight: r.weight,
      size: r.size,
      lineHeight: Math.round(r.lh * r.size * 10) / 10,
      letterSpacing: r.ls,
      generic: GENERIC[r.font.classification],
      ...pf,
    };
  });
}

// ------------------------------------------------------------- exports

export type NameStyle = 'simple' | 'site';
export type MyFormat = 'css' | 'tailwind' | 'figma';

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const quote = (f: string) => `"${f.replace(/"/g, '')}"`;

function styleNames(rows: MyRow[], names: NameStyle): string[] {
  const used = new Map<string, number>();
  return rows.map((r) => {
    const base = names === 'simple' ? slug(r.name) : slug(r.s.name);
    const n = (used.get(base) ?? 0) + 1;
    used.set(base, n);
    return n > 1 ? `${base}-${n}` : base;
  });
}

function fontVars(rows: MyRow[]): { slot: Slot; font: PickedFont }[] {
  const out: { slot: Slot; font: PickedFont }[] = [];
  for (const slot of ['heading', 'body', 'mono'] as Slot[]) {
    const r = rows.find((x) => x.slot === slot);
    if (r) out.push({ slot, font: r.font });
  }
  return out;
}

const varFor = (r: MyRow) => `--font-${r.slot}`;

function googleImport(rows: MyRow[]): string | null {
  const byFamily = new Map<string, Set<number>>();
  for (const r of rows) {
    if (!r.font.catalogFamily) continue;
    const set = byFamily.get(r.font.catalogFamily) ?? new Set<number>();
    set.add(r.weight);
    byFamily.set(r.font.catalogFamily, set);
  }
  if (!byFamily.size) return null;
  const parts = [...byFamily].map(([fam, ws]) => `family=${fam.replace(/ /g, '+')}:wght@${[...ws].sort((a, b) => a - b).join(';')}`);
  return `https://fonts.googleapis.com/css2?${parts.join('&')}&display=swap`;
}

export function exportMine(format: 'css' | 'tailwind', rows: MyRow[], names: NameStyle, host: string): string {
  const vars = fontVars(rows);
  const keys = styleNames(rows, names);
  const fams = vars.map((v) => `  --font-${v.slot}: ${quote(v.font.catalogFamily ?? v.font.name)}, ${GENERIC[v.font.classification]};`);
  const head = `/* ${host}'s type in ${[...new Set(vars.map((v) => v.font.name))].join(' and ')}, made with Font Finder Plus */`;
  const gi = googleImport(rows);
  const lines = [head];
  if (gi) lines.push(`@import url('${gi}');`);
  lines.push('');
  if (format === 'css') {
    lines.push(':root {', ...fams, '}', '');
    rows.forEach((r, i) => {
      lines.push(`.${keys[i]} {`, `  font-family: var(${varFor(r)});`, `  font-size: ${+r.size.toFixed(2)}px;`, `  line-height: ${fLh(r.lh)};`, `  font-weight: ${r.weight};`, `  letter-spacing: ${r.ls ? `${r.ls}em` : '0'};`);
      if (r.caps) lines.push('  text-transform: uppercase;');
      lines.push('}', '');
    });
    return lines.join('\n');
  }
  lines.push('@theme {', ...fams);
  rows.forEach((r, i) => {
    lines.push(`  --text-${keys[i]}: ${+r.size.toFixed(2)}px;`, `  --text-${keys[i]}--line-height: ${fLh(r.lh)};`, `  --text-${keys[i]}--font-weight: ${r.weight};`, `  --text-${keys[i]}--letter-spacing: ${r.ls ? `${r.ls}em` : '0'};`);
  });
  lines.push('}', '');
  return lines.join('\n');
}

/** The same paste format as the System tab's Copy for Figma, with your fonts and styles. */
export function figmaMine(rows: MyRow[], names: NameStyle, site: { host: string; url: string; title: string }): { text: string; payload: FigmaPayload } {
  const fonts = new Map<string, FigmaFont>();
  for (const r of rows) {
    const f = r.font;
    if (fonts.has(f.id)) {
      const ff = fonts.get(f.id)!;
      ff.weights = [...new Set([...ff.weights, String(r.weight)])].sort();
      ff.roles = [...new Set([...ff.roles, r.slot])];
      continue;
    }
    const sum = summaryFor(f.licence, null, f.from === 'google' ? 'google' : f.from === 'local' ? 'system' : 'self-hosted');
    fonts.set(f.id, {
      key: f.id,
      name: f.name,
      cssFamily: f.catalogFamily ?? f.name,
      catalogFamily: f.catalogFamily,
      classification: f.classification,
      kind: f.from === 'local' ? 'local' : 'web',
      licence: { type: f.licence, name: sum.name, short: sum.short, url: sum.url },
      source: f.catalogFamily ? 'Google Fonts' : f.from === 'local' ? 'your computer' : 'your Library',
      host: null,
      foundry: null,
      designers: [],
      getIt: f.catalogFamily ? { label: 'Google Fonts (free)', url: googleFontsUrl(f.catalogFamily) } : null,
      weights: [String(r.weight)],
      italic: false,
      roles: [r.slot],
      elements: 0,
      standIn: null,
      alternatives: [],
      preview: null,
      previewText: f.name,
    });
  }
  const keys = names === 'simple' ? rows.map((r) => r.name) : styleNames(rows, 'site');
  const styles: FigmaStyle[] = rows.map((r, i) => ({
    name: keys[i],
    label: keys[i],
    fontKey: r.font.id,
    fontName: r.font.name,
    cssFamily: r.font.catalogFamily ?? r.font.name,
    weight: String(r.weight),
    style: 'normal',
    size: r.size,
    lineHeight: Math.round(r.lh * r.size * 10) / 10,
    letterSpacing: Math.round(r.ls * r.size * 100) / 100,
    paragraphSpacing: r.s.paragraphSpacing ?? 0,
    transform: r.caps ? 'uppercase' : 'none',
    sample: r.s.sample,
    count: r.s.count,
    group: r.slot === 'heading' ? 'Headings' : r.slot === 'mono' ? 'Code' : 'Body',
  }));
  const payload: FigmaPayload = { mark: FIGMA_MARK, version: 1, site, scannedAt: new Date().toISOString(), fonts: [...fonts.values()], styles, scale: null };
  return { text: serializePayload(payload), payload };
}
