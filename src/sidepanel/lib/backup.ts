// Library export and import as one JSON file. Font files, cached downloads and
// screenshots are not included (they can be large); everything else is.
import { db } from '../../shared/db';
import type { Board, Collection, FontRecord, SavedFont } from '../../shared/types';

export const BACKUP_FORMAT = 'font-finder-plus-library';

export interface Backup {
  format: typeof BACKUP_FORMAT;
  version: 1;
  exportedAt: string;
  fonts: FontRecord[];
  savedFonts: SavedFont[];
  collections: Collection[];
  boards: Board[];
}

export async function exportLibrary(): Promise<Backup> {
  const savedFonts = await db.savedFonts.toArray();
  const ids = new Set(savedFonts.map((s) => s.fontId));
  const boards = await db.boards.toArray();
  boards.forEach((b) => b.fontIds.forEach((f) => ids.add(f)));
  const fonts = (await db.fonts.bulkGet([...ids])).filter((f): f is FontRecord => !!f).map((f) => {
    // The character list is large and is read again from the font file when needed.
    if (!f.parsed) return f;
    const { codepoints: _c, ...parsed } = f.parsed;
    void _c;
    return { ...f, parsed: parsed as FontRecord['parsed'] };
  });
  return { format: BACKUP_FORMAT, version: 1, exportedAt: new Date().toISOString(), fonts, savedFonts, collections: await db.collections.toArray(), boards };
}

export interface ImportResult { fonts: number; collections: number; boards: number; merged: number }

/** Add a backup to the library. Nothing already here is deleted; matching fonts and collections are merged. */
export async function importLibrary(data: unknown): Promise<ImportResult> {
  const b = data as Partial<Backup>;
  if (!b || b.format !== BACKUP_FORMAT || !Array.isArray(b.savedFonts) || !Array.isArray(b.fonts)) {
    throw new Error('This file is not a Font Finder Plus library export.');
  }
  const result: ImportResult = { fonts: 0, collections: 0, boards: 0, merged: 0 };
  await db.transaction('rw', [db.fonts, db.savedFonts, db.collections, db.boards], async () => {
    // Collections: match by name, otherwise create. Map old ids to new ones.
    const idMap = new Map<number, number>();
    const existing = await db.collections.toArray();
    for (const c of b.collections ?? []) {
      const same = existing.find((e) => e.name.trim().toLowerCase() === c.name.trim().toLowerCase());
      if (same) idMap.set(c.id!, same.id!);
      else {
        const nid = await db.collections.add({ name: c.name, color: c.color, createdAt: c.createdAt ?? Date.now() });
        idMap.set(c.id!, nid);
        result.collections++;
      }
    }
    // Font records: keep whichever is newer.
    for (const f of b.fonts ?? []) {
      if (!f?.id) continue;
      const cur = await db.fonts.get(f.id);
      if (!cur || (f.updatedAt ?? 0) > (cur.updatedAt ?? 0)) await db.fonts.put(cur?.parsed?.codepoints && f.parsed ? { ...f, parsed: { ...f.parsed, codepoints: cur.parsed.codepoints } } : f);
    }
    // Saved fonts: merge by font.
    for (const s of b.savedFonts ?? []) {
      if (!s?.fontId) continue;
      const cols = (s.collectionIds ?? []).map((c) => idMap.get(c)).filter((c): c is number => c != null);
      const cur = await db.savedFonts.where('fontId').equals(s.fontId).first();
      if (cur) {
        await db.savedFonts.update(cur.id!, {
          collectionIds: [...new Set([...cur.collectionIds, ...cols])],
          sitesSeen: [...new Set([...cur.sitesSeen, ...(s.sitesSeen ?? [])])],
          notes: cur.notes && s.notes && cur.notes !== s.notes ? `${cur.notes}\n${s.notes}` : cur.notes || s.notes || '',
          updatedAt: Date.now(),
        });
        result.merged++;
      } else {
        await db.savedFonts.add({ fontId: s.fontId, collectionIds: cols, notes: s.notes ?? '', sitesSeen: s.sitesSeen ?? [], sample: s.sample ?? null, createdAt: s.createdAt ?? Date.now(), updatedAt: Date.now() });
        result.fonts++;
      }
    }
    // Boards: always added (named "(imported)" when the name is taken).
    const names = new Set((await db.boards.toArray()).map((x) => x.name));
    for (const bd of b.boards ?? []) {
      const { id: _id, ...rest } = bd;
      void _id;
      await db.boards.add({ ...rest, name: names.has(bd.name) ? `${bd.name} (imported)` : bd.name, updatedAt: Date.now() });
      result.boards++;
    }
  });
  return result;
}
