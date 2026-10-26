import catalogJson from './data/gf-catalog.json';
import { knownFont, licenceTypeFor } from './licences';
import type { Classification, LicenseType, SourceKind } from './types';

interface CatalogEntry {
  c: Classification;
  d: string[];
  l: 'OFL' | 'APACHE' | 'UFL' | null;
  s: string[];
  a: [string, number, number, number][];
  w: string[];
  p: number | null;
}

const families = (catalogJson as unknown as { families: Record<string, CatalogEntry> }).families;
const byLower = new Map<string, string>();
for (const name of Object.keys(families)) byLower.set(name.toLowerCase(), name);

export const CATALOG_DATE = (catalogJson as { generated: string }).generated;
export const CATALOG_COUNT = (catalogJson as { count: number }).count;

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const bySquash = new Map<string, string>();
for (const name of Object.keys(families)) bySquash.set(squash(name), name);

/**
 * Turn the name a site uses in CSS into a readable family name.
 * Build tools often rename fonts they copy onto the site, for example
 * Next.js: "__Geist_Mono_9a8b7c" and "__Inter_Fallback_a64ecd".
 */
export function cleanFamilyName(raw: string): string {
  let s = raw.trim();
  if (/^_+/.test(s) || /_[0-9a-f]{5,10}$/i.test(s)) {
    s = s.replace(/^_+/, '').replace(/_[0-9a-f]{5,10}$/i, '').replace(/_+/g, ' ');
  }
  s = s.replace(/\s+Fallback$/i, '');
  return s.trim() || raw.trim();
}

/** The Google Fonts family for a name, matching exact names and cleaned build-tool names. */
export function googleFamily(name: string): (CatalogEntry & { family: string }) | null {
  const exact = byLower.get(name.trim().toLowerCase());
  if (exact) return { ...families[exact], family: exact };
  const clean = cleanFamilyName(name);
  const variants = [clean, clean.replace(/\s+(Variable|VF|Var)$/i, '')];
  for (const v of variants) {
    const hit = bySquash.get(squash(v));
    if (hit) return { ...families[hit], family: hit };
  }
  return null;
}

export function googleFontsUrl(family: string): string {
  return `https://fonts.google.com/specimen/${family.trim().replace(/\s+/g, '+')}`;
}

// Classification of common operating-system fonts. Facts only: these are the
// well-known type styles of fonts that ship with macOS, Windows, Linux and ChromeOS.
const SYSTEM_CLASS: Record<string, Classification> = {};
const add = (c: Classification, names: string[]) => names.forEach((n) => (SYSTEM_CLASS[n.toLowerCase()] = c));
add('serif', [
  'Times New Roman', 'Times', 'Georgia', 'Garamond', 'Palatino', 'Palatino Linotype', 'Book Antiqua',
  'Baskerville', 'Cambria', 'Constantia', 'Hoefler Text', 'Didot', 'Charter', 'Iowan Old Style',
  'New York', 'Liberation Serif', 'DejaVu Serif', 'Noto Serif', 'Sitka Text', 'Big Caslon',
]);
add('sans', [
  'Arial', 'Helvetica', 'Helvetica Neue', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Segoe UI', 'Segoe UI Variable',
  'Calibri', 'Candara', 'Corbel', 'Gill Sans', 'Futura', 'Avenir', 'Avenir Next', 'Optima', 'Lucida Grande',
  'Lucida Sans Unicode', 'Geneva', 'SF Pro', 'SF Pro Text', 'SF Pro Display', 'Ubuntu', 'Cantarell',
  'Liberation Sans', 'DejaVu Sans', 'Noto Sans', 'Arial Black', 'Aptos', 'Franklin Gothic Medium',
]);
add('mono', [
  'Courier New', 'Courier', 'Menlo', 'Monaco', 'Consolas', 'Lucida Console', 'SF Mono', 'Liberation Mono',
  'DejaVu Sans Mono', 'Cascadia Code', 'Cascadia Mono', 'Andale Mono', 'Ubuntu Mono',
]);
add('script', ['Brush Script MT', 'Snell Roundhand', 'Apple Chancery', 'Segoe Script', 'Lucida Handwriting']);
add('display', ['Impact', 'Papyrus', 'Copperplate', 'Chalkduster', 'Herculanum']);

export function systemClassification(name: string): Classification | null {
  return SYSTEM_CLASS[name.trim().toLowerCase()] ?? null;
}

export const GENERIC_FAMILIES = new Set([
  'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif',
  'ui-monospace', 'ui-rounded', 'emoji', 'math', 'fangsong', '-apple-system', 'blinkmacsystemfont',
]);

export function genericClassification(generic: string): Classification {
  const g = generic.toLowerCase();
  if (g.includes('mono')) return 'mono';
  if (g === 'serif' || g === 'ui-serif') return 'serif';
  if (g === 'cursive') return 'script';
  if (g === 'fantasy') return 'display';
  return 'sans';
}

export function licenseFromCatalog(family: string, source: SourceKind): LicenseType {
  const gf = googleFamily(family);
  if (gf?.l) return gf.l;
  const known = knownFont(cleanFamilyName(family));
  if (known) return licenceTypeFor(known);
  if (source === 'system') return 'system';
  return 'unknown';
}

export function classify(family: string, source: SourceKind, fromFile?: Classification | null): Classification {
  const gf = googleFamily(family);
  if (gf && gf.c !== 'unknown') return gf.c;
  if (fromFile && fromFile !== 'unknown') return fromFile;
  if (source === 'system' || source === 'unknown') return systemClassification(family) ?? 'unknown';
  return systemClassification(family) ?? 'unknown';
}

export const CLASS_LABEL: Record<Classification, string> = {
  serif: 'Serif',
  sans: 'Sans',
  mono: 'Mono',
  display: 'Display',
  script: 'Script',
  unknown: 'Unclassified',
};

export const SOURCE_LABEL: Record<SourceKind, string> = {
  google: 'Google Fonts',
  adobe: 'Adobe Fonts',
  bunny: 'Bunny Fonts',
  'self-hosted': 'Self-hosted',
  cdn: 'CDN',
  embedded: 'Embedded in CSS',
  script: 'Added by script',
  system: 'System font',
  unknown: 'Unknown source',
};

export const LICENSE_LABEL: Record<LicenseType, string> = {
  OFL: 'SIL Open Font License',
  APACHE: 'Apache License 2.0',
  UFL: 'Ubuntu Font Licence',
  'free-other': 'Free, own licence',
  system: 'System font',
  commercial: 'Commercial',
  unknown: 'License unknown',
};

/** Short badge shown next to a font. */
export function licenseBadge(l: LicenseType): { text: string; tone: 'free' | 'warn' | 'neutral' } {
  if (l === 'OFL' || l === 'APACHE' || l === 'UFL' || l === 'free-other') return { text: 'Free', tone: 'free' };
  if (l === 'system') return { text: 'System', tone: 'warn' };
  if (l === 'commercial') return { text: 'Paid', tone: 'warn' };
  return { text: 'Unknown', tone: 'neutral' };
}
