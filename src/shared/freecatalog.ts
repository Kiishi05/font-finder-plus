// Free fonts outside Google Fonts (built by scripts/build-free-catalogs.mjs):
// Fontshare (measured, so it can be suggested and swapped), plus Font Squirrel,
// Bye Bye Binary, Collletttivo and Open Foundry (names and links, to confirm a
// font's name and say where to get it).
import catalogJson from './data/free-catalog.json';
import type { Classification } from './types';

export type FreeSource = 'fontshare' | 'fontsquirrel' | 'byebyebinary' | 'collletttivo' | 'openfoundry';

export interface FreeFont {
  name: string;
  /** Where it is listed. */
  s: FreeSource;
  /** Its page on that site. */
  u: string;
  /** Licence key: OFL, fontshare, fontsquirrel, byebyebinary, freefoundry. */
  l: string;
  c: Classification;
  d: string[];
  /** Foundry or publisher, when the site says. */
  f: string | null;
  /** Fontshare only: the name in its web font links, weights, italics. */
  slug?: string;
  w?: number[];
  i?: boolean;
}

export const SOURCE_NAME: Record<FreeSource, string> = {
  fontshare: 'Fontshare',
  fontsquirrel: 'Font Squirrel',
  byebyebinary: 'Bye Bye Binary',
  collletttivo: 'Collletttivo',
  openfoundry: 'Open Foundry',
};

/** The sites checked, for messages such as "not found in ...". */
export const CATALOGUES_CHECKED = ['Google Fonts', ...Object.values(SOURCE_NAME)];

const data = catalogJson as unknown as { generated: string; count: number; fonts: Record<string, Omit<FreeFont, 'name'>> };
export const FREE_CATALOG_DATE = data.generated;
export const FREE_CATALOG_COUNT = data.count;

const squash = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
const bySquash = new Map<string, FreeFont>();
for (const [name, e] of Object.entries(data.fonts)) bySquash.set(squash(name), { name, ...e });

/** A free font listed on one of the sites above (exact name match, ignoring case and spaces). */
export function freeFont(name: string | null | undefined): FreeFont | null {
  if (!name) return null;
  return bySquash.get(squash(name)) ?? null;
}

export const allFreeFonts = (): FreeFont[] => [...bySquash.values()];

/** A Fontshare family (these can be suggested as look-alikes and tried on the page). */
export const fontshareFamily = (name: string | null | undefined): FreeFont | null => {
  const f = freeFont(name);
  return f?.s === 'fontshare' ? f : null;
};

/** Short licence label for a free font, as each site states it. */
export function freeLicenceLabel(f: FreeFont): string {
  switch (f.l) {
    case 'OFL':
      return 'SIL Open Font License';
    case 'fontshare':
      return 'ITF Free Font License';
    case 'fontsquirrel':
      return 'listed as free for commercial use';
    case 'byebyebinary':
      return 'free, with Bye Bye Binary conditions';
    default:
      return 'free from an open-source foundry';
  }
}
