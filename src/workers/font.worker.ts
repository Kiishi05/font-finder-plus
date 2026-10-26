/// <reference lib="webworker" />
// Parses font files off the main thread. Input: raw bytes. Output: facts read
// from the file's own tables (name, OS/2, post, fvar). Nothing is guessed.
import * as fontkit from 'fontkit';
import { sniffFormat } from '../shared/sources';
import type { Classification, ParsedFontFile } from '../shared/types';

interface Req {
  id: number;
  bytes: ArrayBuffer;
}

function name(font: any, key: string): string | null {
  try {
    const v = font.getName?.(key) ?? null;
    return typeof v === 'string' && v.trim() ? v.trim() : null;
  } catch {
    return null;
  }
}

function classifyFromTables(isFixedPitch: boolean, panose: number[] | null, familyClass: number | null): Classification {
  if (isFixedPitch) return 'mono';
  if (panose && panose.some((n) => n !== 0)) {
    const [kind, serif, , , proportion] = panose;
    if (kind === 2 && proportion === 9) return 'mono';
    if (kind === 3) return 'script';
    if (kind === 4) return 'display';
    if (kind === 2) {
      if (serif >= 11 && serif <= 15) return 'sans';
      if (serif >= 2 && serif <= 10) return 'serif';
    }
  }
  if (familyClass != null) {
    const cls = familyClass >> 8;
    if ([1, 2, 3, 4, 5, 7].includes(cls)) return 'serif';
    if (cls === 8) return 'sans';
    if (cls === 9) return 'display';
    if (cls === 10) return 'script';
  }
  return 'unknown';
}

function parse(bytes: ArrayBuffer): ParsedFontFile {
  const format = sniffFormat(bytes);
  const font: any = fontkit.create(new Uint8Array(bytes) as any);
  const f = font.fonts ? font.fonts[0] : font; // collections: first face
  const os2 = f['OS/2'] ?? null;
  const post = f.post ?? null;
  const panose: number[] | null = os2?.panose ? Array.from(os2.panose as ArrayLike<number>) : null;
  const familyClass: number | null = typeof os2?.sFamilyClass === 'number' ? os2.sFamilyClass : null;
  const isFixedPitch = !!post?.isFixedPitch;
  const axesObj = f.variationAxes ?? {};
  const axes = Object.entries(axesObj).map(([tag, a]: [string, any]) => ({
    tag,
    name: String(a.name ?? tag),
    min: Number(a.min),
    max: Number(a.max),
    default: Number(a.default),
  }));
  let characterCount = 0;
  try {
    characterCount = f.characterSet?.length ?? 0;
  } catch {
    characterCount = 0;
  }
  return {
    format,
    familyName: name(f, 'preferredFamily') ?? name(f, 'fontFamily') ?? f.familyName ?? null,
    subfamilyName: name(f, 'preferredSubfamily') ?? name(f, 'fontSubfamily') ?? f.subfamilyName ?? null,
    fullName: name(f, 'fullName') ?? f.fullName ?? null,
    version: name(f, 'version'),
    manufacturer: name(f, 'manufacturer'),
    designer: name(f, 'designer'),
    vendorUrl: name(f, 'vendorURL'),
    designerUrl: name(f, 'designerURL'),
    licenseDescription: name(f, 'license'),
    licenseUrl: name(f, 'licenseURL'),
    copyright: name(f, 'copyright'),
    unitsPerEm: f.unitsPerEm,
    ascent: f.ascent,
    descent: f.descent,
    capHeight: Number.isFinite(f.capHeight) && f.capHeight > 0 ? f.capHeight : null,
    xHeight: Number.isFinite(f.xHeight) && f.xHeight > 0 ? f.xHeight : null,
    glyphCount: f.numGlyphs,
    characterCount,
    isFixedPitch,
    panose,
    familyClass,
    weightClass: typeof os2?.usWeightClass === 'number' ? os2.usWeightClass : null,
    axes,
    classification: classifyFromTables(isFixedPitch, panose, familyClass),
    byteLength: bytes.byteLength,
  };
}

self.onmessage = (e: MessageEvent<Req>) => {
  const { id, bytes } = e.data;
  try {
    const parsed = parse(bytes);
    (self as unknown as Worker).postMessage({ id, ok: true, parsed });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, ok: false, error: 'This font file could not be read. It may be protected or damaged.' });
    void err;
  }
};
