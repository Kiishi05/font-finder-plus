import Dexie, { type Table } from 'dexie';
import type { Board, Collection, FontFile, FontRecord, ImageJob, SavedFont, Screenshot, Specimen, TypeSample } from './types';

// One local IndexedDB for every phase. Lives in the extension's own origin,
// so the side panel and the background worker share it. Nothing is synced.
export class FFPDatabase extends Dexie {
  fonts!: Table<FontRecord, string>;
  savedFonts!: Table<SavedFont, number>;
  collections!: Table<Collection, number>;
  specimens!: Table<Specimen, number>;
  screenshots!: Table<Screenshot, number>;
  fontFiles!: Table<FontFile, string>;
  imageJobs!: Table<ImageJob, number>;
  boards!: Table<Board, number>;

  constructor() {
    super('font-finder-plus');
    this.version(1).stores({
      fonts: 'id, family, source, classification, licenseType, updatedAt',
      savedFonts: '++id, &fontId, *collectionIds, createdAt',
      collections: '++id, name, createdAt',
      specimens: '++id, fontId, createdAt',
      screenshots: '++id, createdAt',
      fontFiles: 'url, fetchedAt',
      imageJobs: '++id, createdAt',
    });
    // Version 2 adds specimen boards. Existing data is kept as it is.
    this.version(2).stores({
      boards: '++id, name, updatedAt',
    });
  }
}

export const db = new FFPDatabase();

export const COLLECTION_COLORS = ['#3346FF', '#E2553D', '#19C05A', '#E39B12', '#9B5DE5', '#111111'];

export async function upsertFont(rec: Omit<FontRecord, 'updatedAt'>): Promise<FontRecord> {
  const existing = await db.fonts.get(rec.id);
  const merged: FontRecord = {
    ...existing,
    ...rec,
    // never overwrite file facts we already read with empty ones
    parsed: rec.parsed ?? existing?.parsed ?? null,
    foundry: rec.foundry ?? existing?.foundry ?? null,
    format: rec.format ?? existing?.format ?? null,
    fileUrl: rec.fileUrl ?? existing?.fileUrl ?? null,
    designers: rec.designers.length ? rec.designers : existing?.designers ?? [],
    files: rec.files?.length ? rec.files : existing?.files ?? [],
    updatedAt: Date.now(),
  };
  await db.fonts.put(merged);
  return merged;
}

/** Save (or update) a font in the library and remember the site it was seen on. */
export async function saveFont(
  rec: Omit<FontRecord, 'updatedAt'>,
  site: string | null,
  sample: TypeSample | null,
  collectionId?: number,
): Promise<SavedFont> {
  await upsertFont(rec);
  return db.transaction('rw', db.savedFonts, async () => {
    const now = Date.now();
    const existing = await db.savedFonts.where('fontId').equals(rec.id).first();
    if (existing) {
      const sites = new Set(existing.sitesSeen);
      if (site) sites.add(site);
      const cols = new Set(existing.collectionIds);
      if (collectionId != null) cols.add(collectionId);
      const updated: SavedFont = {
        ...existing,
        sitesSeen: [...sites],
        collectionIds: [...cols],
        sample: existing.sample ?? sample,
        updatedAt: now,
      };
      await db.savedFonts.put(updated);
      return updated;
    }
    const created: SavedFont = {
      fontId: rec.id,
      collectionIds: collectionId != null ? [collectionId] : [],
      notes: '',
      sitesSeen: site ? [site] : [],
      sample,
      createdAt: now,
      updatedAt: now,
    };
    created.id = await db.savedFonts.add(created);
    return created;
  });
}

export async function deleteCollection(id: number): Promise<void> {
  await db.transaction('rw', db.collections, db.savedFonts, async () => {
    await db.collections.delete(id);
    const affected = await db.savedFonts.where('collectionIds').equals(id).toArray();
    for (const s of affected) {
      await db.savedFonts.update(s.id!, { collectionIds: s.collectionIds.filter((c) => c !== id) });
    }
  });
}

export const MAX_CACHED_FONT_BYTES = 4 * 1024 * 1024;
