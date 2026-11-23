// "Use with my fonts": where the fonts come from (your Library, Google Fonts,
// fonts on this computer), loading them into the panel, measuring them, and
// the files to send to the page.
import { allGoogleFamilies, googleFamily } from '../../shared/catalog';
import { db } from '../../shared/db';
import { arrayBufferToBase64, type ApplyTypeFace } from '../../shared/messages';
import { weightsFromCatalog, weightsFromStyleNames, type TypeMetrics } from '../../shared/typeadapt';
import { measureTypeMetrics } from '../../shared/typemeasure';
import type { Classification, FaceFile, FontRecord, LicenseType } from '../../shared/types';
import { aliasFor, getFontBytes, loadPreviewFamily, previewFaces } from './fonts';
import { freeCssUrl, linkGoogleFamily, swapFaces } from './google';
import { localFontAccessAvailable } from './installed';

export type FontFrom = 'library' | 'google' | 'local';

export interface PickedFont {
  /** google:Fraunces, lib:<font id>, local:Georgia */
  id: string;
  name: string;
  from: FontFrom;
  classification: Classification;
  weights: number[] | 'any';
  /** The Google Fonts family, when it is one (also for Library fonts that are on Google Fonts). */
  catalogFamily: string | null;
  licence: LicenseType;
  /** Font files (Library fonts saved from a website). */
  files?: FaceFile[];
}

export const GENERIC: Record<Classification, string> = { serif: 'serif', sans: 'sans-serif', mono: 'monospace', display: 'sans-serif', script: 'cursive', unknown: 'sans-serif' };

export function googlePick(family: string): PickedFont | null {
  const gf = googleFamily(family);
  if (!gf) return null;
  return { id: `google:${gf.family}`, name: gf.family, from: 'google', classification: gf.c, weights: weightsFromCatalog(gf.w, gf.a), catalogFamily: gf.family, licence: gf.l === 'APACHE' ? 'APACHE' : gf.l === 'UFL' ? 'UFL' : 'OFL' };
}

export function libraryPick(rec: FontRecord): PickedFont {
  const gf = googleFamily(rec.catalogFamily ?? rec.displayName ?? rec.family);
  const name = rec.displayName ?? gf?.family ?? rec.family;
  const fileWeights = [...new Set((rec.files ?? []).map((f) => Number(f.weight)).filter((n) => n > 0))].sort((a, b) => a - b);
  return {
    id: `lib:${rec.id}`,
    name,
    from: 'library',
    classification: rec.classification,
    weights: gf ? weightsFromCatalog(gf.w, gf.a) : fileWeights.length ? fileWeights : [400],
    catalogFamily: gf?.family ?? null,
    licence: rec.licenseType,
    files: gf ? undefined : rec.files?.length ? rec.files : rec.fileUrl ? [{ url: rec.fileUrl, format: rec.format ?? null, weight: '400', style: 'normal', unicodeRange: null }] : undefined,
  };
}

export function localPick(family: string, styles: string[]): PickedFont {
  const mono = /mono|code|courier|consol|menlo/i.test(family);
  const serif = !mono && /serif|georgia|times|garamond|baskerville|palatino|cambria|book/i.test(family) && !/sans/i.test(family);
  return { id: `local:${family}`, name: family, from: 'local', classification: mono ? 'mono' : serif ? 'serif' : 'sans', weights: weightsFromStyleNames(styles), catalogFamily: null, licence: 'system' };
}

// ------------------------------------------------------------- sources

/** Saved fonts in the Library, newest first. */
export async function libraryFonts(): Promise<PickedFont[]> {
  const saved = await db.savedFonts.orderBy('createdAt').reverse().toArray();
  const recs = await db.fonts.bulkGet(saved.map((s) => s.fontId));
  return recs.filter((r): r is FontRecord => !!r && r.kind !== 'generic').map(libraryPick);
}

let localList: Promise<PickedFont[]> | null = null;

/** Fonts on this computer (Chrome asks for permission the first time; call from a click). */
export function localFonts(): Promise<PickedFont[]> {
  if (localList) return localList;
  if (!localFontAccessAvailable()) return Promise.resolve([]);
  localList = (async () => {
    const q = (window as unknown as { queryLocalFonts: () => Promise<{ family: string; style: string }[]> }).queryLocalFonts;
    const all = await q();
    const byFamily = new Map<string, string[]>();
    for (const f of all) byFamily.set(f.family, [...(byFamily.get(f.family) ?? []), f.style]);
    return [...byFamily].filter(([fam]) => !/^\./.test(fam)).map(([fam, styles]) => localPick(fam, styles)).sort((a, b) => a.name.localeCompare(b.name));
  })();
  localList.catch(() => {
    localList = null;
  });
  return localList;
}

export const localFontsReady = () => !!localList;

const popular = (() => {
  let cache: string[] | null = null;
  return () => {
    if (!cache) cache = allGoogleFamilies().sort((a, b) => (googleFamily(a)?.p ?? 1e9) - (googleFamily(b)?.p ?? 1e9));
    return cache;
  };
})();

const SUGGEST: Record<'heading' | 'body' | 'mono', Classification[]> = { heading: ['serif', 'sans', 'display'], body: ['sans', 'serif'], mono: ['mono'] };
const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

export interface SearchResult { font: PickedFont; from: FontFrom }

/** Search every source at once. With no query: your Library first, then popular Google fonts for this slot. */
export function searchFonts(q: string, slot: 'heading' | 'body' | 'mono', library: PickedFont[], local: PickedFont[], limit = 40): SearchResult[] {
  const n = squash(q);
  const out: SearchResult[] = [];
  const seen = new Set<string>();
  const add = (f: PickedFont | null) => {
    if (!f) return;
    const k = squash(f.catalogFamily ?? f.name);
    if (seen.has(k) || out.length >= limit) return;
    seen.add(k);
    out.push({ font: f, from: f.from });
  };
  const match = (name: string) => !n || squash(name).includes(n);
  const fit = (f: PickedFont) => n || slot !== 'mono' || f.classification === 'mono';
  for (const f of library) if (match(f.name) && fit(f)) add(f);
  if (n) {
    // Names that start with the query first.
    const g = popular().filter((x) => squash(x).includes(n)).sort((a, b) => Number(!squash(a).startsWith(n)) - Number(!squash(b).startsWith(n)));
    for (const x of g.slice(0, limit)) add(googlePick(x));
    for (const f of local) if (match(f.name)) add(f);
  } else {
    const want = SUGGEST[slot];
    for (const x of popular()) {
      if (out.length >= Math.min(limit, library.length + 16)) break;
      const gf = googleFamily(x);
      if (gf && want.includes(gf.c) && (!gf.ps || gf.ps === 'Latn')) add(googlePick(x));
    }
  }
  return out;
}

// ------------------------------------------------------------- loading and measuring

/** Load the font into the panel. Returns the CSS font-family to draw with. */
export async function loadInPanel(f: PickedFont, tabId: number | null): Promise<string> {
  const tail = `"FFP NotDef"`;
  if (f.catalogFamily) {
    await linkGoogleFamily(f.catalogFamily);
    await document.fonts.load(`400 40px "${f.catalogFamily}"`, 'xHdpamAa').catch(() => undefined);
    return `"${f.catalogFamily}", ${GENERIC[f.classification]}`;
  }
  if (f.files?.length) {
    const faces = previewFaces(f.files);
    const alias = aliasFor(faces.map((x) => x.url).join('|'));
    const ok = await loadPreviewFamily(alias, faces, tabId);
    if (ok) return `"${alias}", ${tail}`;
  }
  return `"${f.name.replace(/"/g, '')}", ${GENERIC[f.classification]}`;
}

/** The font's proportions, measured in the panel after it loads. */
export async function measurePicked(f: PickedFont, tabId: number | null): Promise<{ css: string; metrics: TypeMetrics | null }> {
  const css = await loadInPanel(f, tabId);
  const w = f.weights === 'any' || f.weights.includes(400) ? 400 : f.weights[0];
  await document.fonts.load(`${w} 100px ${css}`, 'xHdpamiAa').catch(() => undefined);
  return { css, metrics: measureTypeMetrics(css, w) };
}

/** What the page needs to draw the font: its files, or a stylesheet address. Installed fonts need nothing. */
export async function pageFontFor(f: PickedFont, tabId: number | null): Promise<{ faces?: ApplyTypeFace[]; fontUrlCss?: string }> {
  if (f.catalogFamily) {
    try {
      return { faces: await swapFaces(f.catalogFamily), fontUrlCss: freeCssUrl(f.catalogFamily) };
    } catch {
      return { fontUrlCss: freeCssUrl(f.catalogFamily) };
    }
  }
  if (f.files?.length) {
    const faces = await Promise.all(
      previewFaces(f.files).slice(0, 16).map(async (x) => {
        try {
          return { base64: arrayBufferToBase64(await getFontBytes(x.url ?? '', tabId)), weight: x.weight || '400', style: x.style || 'normal', unicodeRange: x.unicodeRange };
        } catch {
          return null;
        }
      }),
    );
    const ok = faces.filter((x): x is ApplyTypeFace => !!x);
    return ok.length ? { faces: ok } : {};
  }
  return {};
}

// ------------------------------------------------------------- names in their own font

const names = new Map<string, Promise<string | null>>();

/** Load just the letters of a Google family's name, so a result can be shown in its own font. */
export function nameFont(family: string): Promise<string | null> {
  const hit = names.get(family);
  if (hit) return hit;
  const p = (async () => {
    const gf = googleFamily(family);
    if (!gf) return null;
    const up = gf.w.filter((w) => !w.endsWith('i'));
    const w = up.includes('400') ? '400' : up[0] ?? '400';
    const url = `https://fonts.googleapis.com/css2?family=${gf.family.replace(/ /g, '+')}${w !== '400' ? `:wght@${w}` : ''}&text=${encodeURIComponent(gf.family)}`;
    const res = await fetch(url, { credentials: 'omit' });
    if (!res.ok) return null;
    const src = /url\(([^)]+)\)/.exec(await res.text())?.[1];
    if (!src) return null;
    const alias = `ffp-name-${aliasFor(gf.family)}`;
    const face = new FontFace(alias, `url(${src})`, { weight: w });
    await face.load();
    document.fonts.add(face);
    return `"${alias}", ${GENERIC[gf.c]}`;
  })().catch(() => null);
  names.set(family, p);
  return p;
}
