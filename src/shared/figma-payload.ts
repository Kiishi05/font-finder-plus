// What Font Finder Plus copies for its Figma plugin. The extension writes it to
// the clipboard; the plugin reads it from a paste. Shared by both sides.
import type { LicenseType } from './types';

/** First line of the copied text, so the plugin can tell it apart from other pastes. */
export const FIGMA_MARK = 'FONT-FINDER-PLUS/FIGMA/1';

export type FigmaPreview =
  | { kind: 'svg'; svg: string; width: number; height: number }
  | { kind: 'png'; data: string; width: number; height: number };

export interface FigmaFont {
  key: string;
  /** Readable name, e.g. "Helvetica Neue LT Pro". */
  name: string;
  /** The name the site uses in CSS. */
  cssFamily: string;
  /** Google Fonts family, when the font is one. */
  catalogFamily: string | null;
  classification: string;
  kind: 'web' | 'local';
  licence: { type: LicenseType; name: string; short: string; url: string | null };
  /** google, adobe, self-hosted, system... */
  source: string;
  host: string | null;
  foundry: string | null;
  designers: string[];
  /** Where to get the font, when known. */
  getIt: { label: string; url: string } | null;
  weights: string[];
  italic: boolean;
  roles: string[];
  elements: number;
  /** Closest free Google Fonts family (another family for Google fonts, used when Figma does not have it yet). */
  standIn: { family: string; score: number; reason: string } | null;
  alternatives: { family: string; score: number }[];
  /** The font's name drawn in the font itself. */
  preview: FigmaPreview | null;
  previewText: string;
}

export interface FigmaStyle {
  /** h1, body, button... */
  name: string;
  fontKey: string;
  fontName: string;
  cssFamily: string;
  weight: string;
  style: string;
  size: number;
  /** Line height in px, or null for normal. */
  lineHeight: number | null;
  /** Letter spacing in px. */
  letterSpacing: number;
  /** Space after a paragraph in px (older pastes lack it). */
  paragraphSpacing?: number;
  transform: string;
  sample: string;
  count: number;
  /** Style guide grouping and names (set by the extension; older pastes may lack them). */
  group?: 'Headings' | 'Body' | 'Buttons & labels' | 'Code';
  label?: string;
  token?: string;
}

export interface FigmaPayload {
  mark: typeof FIGMA_MARK;
  version: 1;
  site: { host: string; url: string; title: string };
  scannedAt: string;
  fonts: FigmaFont[];
  styles: FigmaStyle[];
  scale: { ratio: number; name: string } | null;
}

/** Read a paste. Returns null when it is not from Font Finder Plus. */
export function parsePayload(text: string): FigmaPayload | null {
  const t = text.trim();
  if (!t.startsWith(FIGMA_MARK)) return null;
  try {
    const p = JSON.parse(t.slice(FIGMA_MARK.length).trim()) as FigmaPayload;
    return p && p.version === 1 && Array.isArray(p.fonts) && Array.isArray(p.styles) ? p : null;
  } catch {
    return null;
  }
}

export const serializePayload = (p: FigmaPayload) => `${FIGMA_MARK}\n${JSON.stringify(p)}`;
