// Library records for fonts found in images: Google families, and fonts only
// named in a picture (no file), with who makes them when known.
import { googleFamily } from '../../shared/catalog';
import { COLLECTION_COLORS, db, saveFont, upsertFont } from '../../shared/db';
import { knownFont, licenceTypeFor } from '../../shared/licences';
import type { FontRecord } from '../../shared/types';
import type { PageFontUsage } from '../../shared/types';
import { canvasBlob } from './cards';
import { getFontBytes } from './fonts';
import type { PageFontFile } from './matcher';

/** A record for a font found in an image, by name. */
export function recordForName(name: string): Omit<FontRecord, 'updatedAt'> {
  const gf = googleFamily(name);
  if (gf) {
    return { id: `${gf.family}::google`, family: gf.family, displayName: gf.family, catalogFamily: gf.family, source: 'google', kind: 'web', classification: gf.c, licenseType: gf.l ?? 'unknown', designers: gf.d ?? [], files: [] };
  }
  const known = knownFont(name);
  return {
    id: `${name}::image`,
    family: name,
    displayName: name,
    catalogFamily: null,
    source: 'image',
    kind: 'web',
    classification: 'unknown',
    licenseType: known ? licenceTypeFor(known) : 'unknown',
    designers: [],
    foundry: known?.by ?? null,
    files: [],
  };
}

/** Make sure the record exists (for opening its details). Returns its id. */
export async function ensureRecord(name: string): Promise<string> {
  const rec = recordForName(name);
  const existing = await db.fonts.get(rec.id);
  if (!existing) await upsertFont(rec);
  return rec.id;
}

/** Save a font to the library with the image it was found in. */
export async function saveWithImage(rec: Omit<FontRecord, 'updatedAt'>, image: HTMLCanvasElement | Blob, collectionId?: number): Promise<void> {
  await saveFont(rec, null, null, collectionId);
  const blob = image instanceof Blob ? image : await canvasBlob(image);
  const shot = await db.screenshots.add({ blob, pageUrl: 'Identified from an image', createdAt: Date.now() });
  const sp = await db.specimens.where('fontId').equals(rec.id).first();
  if (sp?.id) await db.specimens.update(sp.id, { screenshotIds: [...sp.screenshotIds, shot] });
  else await db.specimens.add({ fontId: rec.id, screenshotIds: [shot], pairing: null, notes: '', createdAt: Date.now() });
}

/** A new collection for everything found in one image. */
export async function newImageCollection(): Promise<number> {
  const n = await db.collections.count();
  const date = new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  return db.collections.add({ name: `From an image · ${date}`, color: COLLECTION_COLORS[n % COLLECTION_COLORS.length], createdAt: Date.now() });
}

/** Files of the fonts this page uses (not Google Fonts), to compare pictures from this page against. */
export async function pageFontFiles(fonts: PageFontUsage[], tabId: number | null): Promise<PageFontFile[]> {
  // Files covering basic Latin letters (a to z); sites split fonts by alphabet.
  const latin = (r: string | null) =>
    !r ||
    r.split(',').some((part) => {
      const [a, b] = part.trim().replace(/^u\+/i, '').split('-');
      const start = parseInt(a.replace(/\?/g, '0'), 16);
      const end = b ? parseInt(b, 16) : parseInt(a.replace(/\?/g, 'F'), 16);
      return start <= 0x61 && end >= 0x7a;
    });
  const out: PageFontFile[] = [];
  for (const f of fonts.filter((x) => x.kind === 'web' && !x.catalogFamily).slice(0, 8)) {
    const files = f.files.filter((x) => x.url && latin(x.unicodeRange) && x.style !== 'italic');
    if (!files.length) continue;
    const named = (re: RegExp) => files.find((x) => re.test(x.url ?? ''));
    const reg = named(/regular|book|roman|normal/i) ?? files.find((x) => /^(400|normal)$/.test(x.weight)) ?? files[0];
    const bold = named(/[^a-z](bold)(?!.*(semi|extra|ultra|demi))/i) ?? files.find((x) => /^(700|bold)$/.test(x.weight) && x !== reg) ?? null;
    const get = async (u: string | null | undefined) => (u ? getFontBytes(u, tabId).catch(() => null) : null);
    const [r, b] = await Promise.all([get(reg?.url), get(bold?.url)]);
    if (r || b) out.push({ family: f.displayName || f.family, regular: r, bold: b });
  }
  return out;
}

