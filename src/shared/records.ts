import type { ElementFontInfo, FaceFile, FontRecord, PageFontUsage, SourceKind, TypeSample } from './types';

export function fontId(family: string, source: SourceKind): string {
  return `${family}::${source}`;
}

export function recordFromInfo(info: ElementFontInfo, fileUrl: string | null, files: FaceFile[] = []): Omit<FontRecord, 'updatedAt'> {
  return {
    id: fontId(info.family, info.source),
    family: info.family,
    displayName: info.displayName,
    catalogFamily: info.catalogFamily,
    source: info.source,
    sourceHost: info.sourceHost ?? null,
    classification: info.classification,
    licenseType: info.licenseType,
    designers: [],
    fileUrl,
    declaredStack: info.declared.join(', '),
    kind: info.kind,
    genericName: info.genericName,
    files: files.filter((f) => f.url).slice(0, 24),
  };
}

export function sampleFromInfo(info: ElementFontInfo): TypeSample {
  return {
    fontSize: info.fontSize,
    fontWeight: info.weight,
    fontStyle: info.style,
    lineHeight: info.lineHeight,
    letterSpacing: info.letterSpacing,
    color: info.color,
  };
}

export function recordFromUsage(f: PageFontUsage, fileUrl: string | null): Omit<FontRecord, 'updatedAt'> {
  const file = f.files.find((x) => x.url === fileUrl);
  return {
    format: file?.format ?? null,
    id: fontId(f.family, f.source),
    family: f.family,
    displayName: f.displayName,
    catalogFamily: f.catalogFamily,
    source: f.source,
    sourceHost: f.sourceHost ?? null,
    classification: f.classification,
    licenseType: f.licenseType,
    designers: f.designers,
    fileUrl,
    declaredStack: f.declaredStacks[0] ?? null,
    kind: f.kind,
    genericName: f.genericName,
    files: f.files.filter((x) => x.url).slice(0, 24),
  };
}

/** Pick the most useful file to read for a font: loaded, covers basic Latin, prefers WOFF2. */
export function bestFileUrl(f: PageFontUsage, weight?: string): string | null {
  const files = f.files.filter((x) => x.url);
  if (!files.length) return null;
  const latin = (r: string | null) => !r || /U\+0{0,4}(0|20)-/i.test(r) || /U\+0+-0*FF/i.test(r) || /U\+0-/i.test(r);
  const score = (x: (typeof files)[number]) =>
    (x.status === 'loaded' ? 4 : 0) + (latin(x.unicodeRange) ? 2 : 0) + (x.format === 'woff2' ? 1 : 0) + (weight && x.weight.split(' ')[0] === weight ? 3 : 0);
  return [...files].sort((a, b) => score(b) - score(a))[0].url;
}
