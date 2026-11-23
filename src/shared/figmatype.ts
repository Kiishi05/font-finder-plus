// "Paste type from Figma": the text styles the Font Finder Plus Figma plugin
// copies, so they can be tried on a real website. Shared format:
//   {"ffp":"figma-type","v":1,"name":"Northwind type","styles":[
//     {"name":"Display","role":"h1","family":"Fraunces","weight":600,"size":64,"lineHeight":68,"letterSpacing":-0.02}]}
// size and lineHeight in px, letterSpacing in em. role is h1, h2, h3, body, label or none.
import type { ApplyTypeStyle, TypeRole } from './messages';

export interface FigmaTypeStyle {
  name: string;
  role: TypeRole;
  family: string;
  weight: number;
  size: number;
  lineHeight: number | null;
  letterSpacing: number;
}

export interface FigmaTypeClip {
  ffp: 'figma-type';
  v: 1;
  name: string;
  styles: FigmaTypeStyle[];
}

const ROLES = new Set<string>(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'display', 'lead', 'body', 'small', 'label', 'caption', 'button', 'link', 'nav', 'code', 'none']);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null);

/** Read pasted text. Null when it is not type from the Figma plugin. */
export function parseFigmaType(text: string): FigmaTypeClip | null {
  const t = text.trim();
  if (!t.startsWith('{')) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(t);
  } catch {
    return null;
  }
  const o = raw as Record<string, unknown>;
  if (!o || o.ffp !== 'figma-type' || Number(o.v) !== 1 || !Array.isArray(o.styles)) return null;
  const styles: FigmaTypeStyle[] = [];
  for (const s of o.styles as Record<string, unknown>[]) {
    if (!s || typeof s !== 'object') continue;
    const size = num(s.size);
    const family = typeof s.family === 'string' ? s.family.trim() : '';
    if (!size || size <= 0 || size > 1000 || !family) continue;
    const role = typeof s.role === 'string' && ROLES.has(s.role.toLowerCase()) ? (s.role.toLowerCase() as TypeRole) : 'none';
    const lh = num(s.lineHeight);
    styles.push({
      name: typeof s.name === 'string' && s.name.trim() ? s.name.trim().slice(0, 60) : role,
      role,
      family: family.slice(0, 80),
      weight: Math.min(1000, Math.max(1, Math.round(num(s.weight) ?? 400))),
      size,
      lineHeight: lh && lh > 0 ? lh : null,
      letterSpacing: Math.max(-1, Math.min(1, num(s.letterSpacing) ?? 0)),
    });
  }
  if (!styles.length) return null;
  return { ffp: 'figma-type', v: 1, name: typeof o.name === 'string' && o.name.trim() ? o.name.trim().slice(0, 80) : 'Type from Figma', styles };
}

/** The styles as page changes. Styles with role "none" are left out. */
export function figmaTypeToApply(clip: FigmaTypeClip, fontCss: (family: string, weight: number) => string | undefined): ApplyTypeStyle[] {
  return clip.styles
    .filter((s) => s.role !== 'none')
    .map((s) => ({
      selectorRole: s.role,
      name: s.name,
      family: s.family,
      weight: s.weight,
      size: s.size,
      lineHeight: s.lineHeight ?? undefined,
      letterSpacing: s.letterSpacing,
      fontUrlCss: fontCss(s.family, s.weight),
    }));
}
