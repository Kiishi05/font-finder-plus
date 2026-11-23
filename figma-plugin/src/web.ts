// "See it on the web": the file's text styles, turned into what the Chrome
// extension reads with System > Paste type from Figma. Pure functions, shared by
// code.ts (reads the styles) and ui.ts (builds the copied text), and tested.
import { weightOfStyle } from './match';

/** The roles the extension knows. The window offers all but h3. */
export type Role = 'h1' | 'h2' | 'h3' | 'body' | 'label' | 'none';
export const ROLES: [Role, string][] = [
  ['h1', 'Main heading'],
  ['h2', 'Other headings'],
  ['body', 'Paragraphs'],
  ['label', 'Buttons and menu'],
  ['none', 'Not used'],
];

export type FigmaLineHeight = { unit: 'AUTO' } | { unit: 'PIXELS' | 'PERCENT'; value: number };
export type FigmaLetterSpacing = { unit: 'PIXELS' | 'PERCENT'; value: number };

/** One text style as the window shows it, with values already in web units. */
export interface WebStyle {
  id: string;
  /** The full Figma style name, e.g. "Headings/Display". */
  name: string;
  family: string;
  /** The font style, e.g. "Semi Bold Italic". */
  style: string;
  weight: number;
  size: number;
  /** px */
  lineHeight: number;
  /** em */
  letterSpacing: number;
  role: Role;
  /** Paid, when Font Finder Plus made the style and knew the licence. */
  paid: boolean;
  /** The real font, when this style uses a stand-in for it. */
  standInFor: string | null;
}

/** The JSON the extension reads ("Paste type from Figma"). Keys in this order. */
export interface WebPayload {
  ffp: 'figma-type';
  v: 1;
  name: string;
  site: string;
  styles: { name: string; role: Role; family: string; weight: number; size: number; lineHeight: number; letterSpacing: number }[];
}

const round = (n: number, places: number) => {
  const k = 10 ** places;
  const r = Math.round(n * k) / k;
  return Object.is(r, -0) ? 0 : r;
};

/** Figma line height to px. AUTO is 1.2 times the size, like a browser's "normal". */
export function lineHeightPx(lh: FigmaLineHeight | null | undefined, size: number): number {
  if (!lh || lh.unit === 'AUTO') return round(size * 1.2, 2);
  if (lh.unit === 'PERCENT') return round((size * lh.value) / 100, 2);
  return round(lh.value, 2);
}

/** Figma letter spacing to em. */
export function letterSpacingEm(ls: FigmaLetterSpacing | null | undefined, size: number): number {
  if (!ls || !ls.value) return 0;
  if (ls.unit === 'PERCENT') return round(ls.value / 100, 4);
  return round(ls.value / Math.max(1, size), 4);
}

/** CSS weight from a font style name: Regular 400, Medium 500, Semi Bold 600, Bold 700... */
export const weightFromStyle = (style: string) => weightOfStyle(style);

const last = (name: string) => name.split('/').pop()!.trim();

/** A role from the style's name alone, or null when the name says nothing. */
export function roleFromName(name: string): Role | null {
  // Look at the last part first ("Headings/Caption" is a caption), then the whole path.
  for (const part of [last(name), name]) {
    const n = part.toLowerCase().replace(/[_\-.]+/g, ' ');
    if (/\b(caption|footnote|overline|eyebrow|kicker|legal|fine ?print|quote|blockquote|code|mono|pre|kbd)\b/.test(n)) return 'none';
    if (/\b(button|btn|cta|label|menu|nav|navigation|tab|tag|chip|badge|link)s?\b/.test(n)) return 'label';
    if (/\b(h1|display|hero|headline|jumbo|title)\b|heading ?(1|xl|xxl|large)\b|main heading/.test(n)) return 'h1';
    if (/\b(h[2-6]|subtitle|subheading|subhead|section)\b|heading|header/.test(n)) return 'h2';
    if (/\b(body|paragraph|text|copy|lede|lead|intro|p|regular|base|default|article|content)\b/.test(n)) return 'body';
  }
  return null;
}

/** A role from the size alone, compared with the other styles. */
function roleFromSize(size: number, largest: number): Role {
  if (size >= 28 && size >= largest) return 'h1';
  if (size >= 20) return 'h2';
  if (size >= 14) return 'body';
  return 'label';
}

/**
 * Guess a role for each style: from its name when the name says, else from its size.
 * Only the largest unnamed style becomes the main heading, and only when no style is
 * named like one.
 */
export function guessRoles(styles: { name: string; size: number }[]): Role[] {
  const named = styles.map((s) => roleFromName(s.name));
  const hasH1 = named.includes('h1');
  const unnamed = styles.filter((_, i) => named[i] === null).map((s) => s.size);
  const largest = Math.max(0, ...unnamed);
  let h1Given = hasH1;
  return styles.map((s, i) => {
    if (named[i]) return named[i]!;
    let r = roleFromSize(s.size, largest);
    if (r === 'h1') {
      if (h1Given) r = 'h2';
      h1Given = true;
    }
    return r;
  });
}

/** A role for a style the user just ticked: never "none". */
export function roleWhenTicked(s: { name: string; size: number }): Role {
  const r = roleFromName(s.name);
  if (r && r !== 'none') return r;
  return s.size >= 20 ? 'h2' : s.size >= 14 ? 'body' : 'label';
}

/** The name the payload carries: the styles' shared top folder, else the file's name. */
export function payloadName(fileName: string, styleNames: string[]): string {
  const tops = new Set(styleNames.map((n) => (n.includes('/') ? n.split('/')[0].trim() : '')));
  if (tops.size === 1) {
    const [t] = [...tops];
    if (t) return t;
  }
  return fileName;
}

/** A site the user typed, as a URL and a short label. Null when it is not a web address. */
export function normalizeSite(input: string): { url: string; label: string } | null {
  const t = input.trim();
  if (!t || /\s/.test(t)) return null;
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : `https://${t}`);
    if (!/^https?:$/.test(u.protocol) || !u.hostname.includes('.') && u.hostname !== 'localhost') return null;
    const path = u.pathname === '/' ? '' : u.pathname.replace(/\/$/, '');
    return { url: `${u.protocol}//${u.host}${path}${u.search}`, label: `${u.host}${path}` };
  } catch {
    return null;
  }
}

/** The copied payload, from the ticked styles and their roles. */
export function buildWebPayload(
  name: string,
  site: string,
  styles: WebStyle[],
  chosen: { id: string; role: Role }[],
): WebPayload {
  const byId = new Map(styles.map((s) => [s.id, s]));
  const group = payloadName('', chosen.map((c) => byId.get(c.id)?.name ?? ''));
  const strip = (n: string) => (group && n.startsWith(`${group}/`) ? n.slice(group.length + 1) : n);
  return {
    ffp: 'figma-type',
    v: 1,
    name,
    site,
    styles: chosen
      .filter((c) => c.role !== 'none' && byId.has(c.id))
      .map((c) => {
        const s = byId.get(c.id)!;
        return { name: strip(s.name), role: c.role, family: s.family, weight: s.weight, size: round(s.size, 2), lineHeight: s.lineHeight, letterSpacing: s.letterSpacing };
      }),
  };
}
