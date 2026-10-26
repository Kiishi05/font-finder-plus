// Shared data shapes for every phase. Fields for later phases are optional so
// records created now stay valid when those phases land.

export type Classification = 'serif' | 'sans' | 'mono' | 'display' | 'script' | 'unknown';

export type SourceKind =
  | 'google' // fonts.gstatic.com / fonts.googleapis.com
  | 'adobe' // use.typekit.net / p.typekit.net
  | 'bunny' // fonts.bunny.net
  | 'self-hosted' // same site as the page
  | 'cdn' // another host
  | 'embedded' // data: URI inside CSS
  | 'script' // added with the FontFace API, no URL visible
  | 'system' // installed on this computer, not a web font
  | 'unknown';

export type LicenseType = 'OFL' | 'APACHE' | 'UFL' | 'free-other' | 'system' | 'commercial' | 'unknown';

export type Role = 'heading' | 'body' | 'button' | 'link' | 'nav' | 'code' | 'caption';

export const ROLES: Role[] = ['heading', 'body', 'button', 'link', 'nav', 'code', 'caption'];

/** One @font-face that belongs to a family. */
export interface FaceFile {
  url: string | null;
  format: string | null;
  weight: string;
  style: string;
  unicodeRange: string | null;
  status?: FontFaceLoadStatus;
}

export interface TypeSample {
  fontSize: number;
  fontWeight: string;
  fontStyle: string;
  lineHeight: string;
  letterSpacing: string;
  color: string;
}

/** A font actually rendered on the page, with how it is used. */
export interface PageFontUsage {
  key: string;
  family: string;
  /** Readable name (build-tool renames cleaned up). */
  displayName: string;
  /** The matching Google Fonts family, if this font is in the Google Fonts catalogue. */
  catalogFamily: string | null;
  kind: 'web' | 'local' | 'generic';
  genericName?: string;
  source: SourceKind;
  sourceHost?: string | null;
  files: FaceFile[];
  declaredStacks: string[];
  roles: Partial<Record<Role, number>>;
  elementCount: number;
  /** How many of those elements cannot be seen right now (closed menus, fading-in text, screen-reader text). */
  hiddenCount: number;
  weights: string[];
  styles: string[];
  sizes: number[];
  sample: TypeSample;
  /** Families named earlier in the CSS that never loaded and fell back to this one. */
  fellBackFrom: string[];
  classification: Classification;
  licenseType: LicenseType;
  designers: string[];
}

export interface NotLoadedFont {
  family: string;
  /** failed: declared as a web font but it did not load. missing: not a web font here and not installed. */
  reason: 'failed' | 'missing';
  fellBackTo: string;
  count: number;
}

export interface PageScan {
  url: string;
  host: string;
  title: string;
  scannedAt: number;
  elementCount: number;
  truncated: boolean;
  fonts: PageFontUsage[];
  notLoaded: NotLoadedFont[];
  /** Icon fonts (they draw symbols, not text). Named here, left out of the list. */
  iconFonts: string[];
}

/** What the hover tooltip shows for one element. */
export interface ElementFontInfo {
  family: string;
  displayName: string;
  catalogFamily: string | null;
  kind: 'web' | 'local' | 'generic';
  genericName?: string;
  source: SourceKind;
  sourceHost?: string | null;
  declared: string[];
  fellBackFrom: string[];
  role: Role;
  tag: string;
  weight: string;
  style: string;
  fontSize: number;
  lineHeight: string;
  letterSpacing: string;
  color: string;
  capHeight: number | null;
  xHeight: number | null;
  licenseType: LicenseType;
  classification: Classification;
}

/** Facts read from the font file itself. */
export interface ParsedFontFile {
  format: string;
  familyName: string | null;
  subfamilyName: string | null;
  fullName: string | null;
  version: string | null;
  manufacturer: string | null;
  designer: string | null;
  vendorUrl: string | null;
  designerUrl: string | null;
  licenseDescription: string | null;
  licenseUrl: string | null;
  copyright: string | null;
  unitsPerEm: number;
  ascent: number;
  descent: number;
  capHeight: number | null;
  xHeight: number | null;
  glyphCount: number;
  characterCount: number;
  /** Every Unicode code point the file has a glyph for (sorted). */
  codepoints?: number[];
  /** Measured proportions (see shape.ts). Null when the file lacks the letters needed. */
  shape?: import('./shape').Shape | null;
  isFixedPitch: boolean;
  panose: number[] | null;
  familyClass: number | null;
  weightClass: number | null;
  axes: { tag: string; name: string; min: number; max: number; default: number }[];
  classification: Classification;
  byteLength: number;
}

// ---------- Database records ----------

export interface FontRecord {
  id: string; // `${family}::${source}`
  family: string;
  displayName?: string;
  catalogFamily?: string | null;
  source: SourceKind;
  sourceHost?: string | null;
  classification: Classification;
  licenseType: LicenseType;
  designers: string[];
  foundry?: string | null;
  fileUrl?: string | null;
  format?: string | null;
  parsed?: ParsedFontFile | null;
  fileError?: string | null;
  declaredStack?: string | null;
  kind?: 'web' | 'local' | 'generic';
  genericName?: string;
  files?: FaceFile[];
  // Phase 2+
  coverage?: Record<string, { score: number; missing: string[] }> | null;
  updatedAt: number;
}

export interface SavedFont {
  id?: number;
  fontId: string;
  collectionIds: number[];
  notes: string;
  sitesSeen: string[];
  sample?: TypeSample | null;
  createdAt: number;
  updatedAt: number;
}

export interface Collection {
  id?: number;
  name: string;
  color: string;
  createdAt: number;
}

export interface Specimen {
  id?: number;
  fontId: string;
  screenshotIds: number[];
  pairing: string | null;
  notes: string;
  createdAt: number;
}

export interface Screenshot {
  id?: number;
  blob: Blob;
  pageUrl: string;
  createdAt: number;
}

export interface FontFile {
  url: string;
  bytes: ArrayBuffer;
  size: number;
  fetchedAt: number;
}

export interface ImageJob {
  id?: number;
  image: Blob;
  createdAt: number;
  ocrText?: string;
  results?: unknown;
}
