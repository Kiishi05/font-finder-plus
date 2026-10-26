import { classify, googleFamily } from '../../shared/catalog';
import { db, upsertFont } from '../../shared/db';
import { knownFont, licenceTypeFor } from '../../shared/licences';
import type { FontRecord } from '../../shared/types';
import { getFontBytes, parseFontBytes } from './fonts';

const running = new Map<string, Promise<void>>();

/**
 * Read a font's file and store what its own tables say (format, foundry,
 * designer, metrics, axes, classification). Runs once per font; the parsing
 * itself happens in a Web Worker.
 */
export function analyzeFont(base: Omit<FontRecord, 'updatedAt'>, tabId: number | null): Promise<void> {
  const fileUrl = base.fileUrl;
  if (!fileUrl) return Promise.resolve();
  const existing = running.get(base.id);
  if (existing) return existing;
  const job = (async () => {
    const cached = await db.fonts.get(base.id);
    // Files read by an older version lack the character list; read them again.
    if (cached?.parsed?.codepoints && cached.parsed.shape !== undefined) {
      // Records saved by an older version may lack the Google Fonts match.
      if (cached.catalogFamily === undefined) {
        const gf = cached.parsed.familyName ? googleFamily(cached.parsed.familyName) : googleFamily(cached.family);
        await db.fonts.update(base.id, {
          catalogFamily: gf?.family ?? null,
          ...(gf ? { displayName: gf.family, licenseType: gf.l ?? cached.licenseType, designers: gf.d, classification: gf.c } : {}),
        });
      }
      return;
    }
    try {
      const bytes = await getFontBytes(fileUrl, tabId);
      const parsed = await parseFontBytes(bytes);
      // The name stored inside the file confirms Google Fonts families that a
      // site has renamed (for example "GeistSans" is the file "Geist").
      const gf = base.catalogFamily ? googleFamily(base.catalogFamily) : parsed.familyName ? googleFamily(parsed.familyName) : null;
      const known = !gf && parsed.familyName ? knownFont(parsed.familyName) : null;
      await upsertFont({
        ...base,
        parsed,
        format: parsed.format,
        foundry: parsed.manufacturer,
        catalogFamily: gf?.family ?? null,
        displayName: gf?.family ?? base.displayName,
        licenseType: gf?.l ?? (base.licenseType === 'unknown' && known ? licenceTypeFor(known) : base.licenseType),
        designers: gf?.d ?? base.designers,
        classification: gf && gf.c !== 'unknown' ? gf.c : classify(base.family, base.source, parsed.classification),
        fileError: null,
      });
    } catch (err) {
      await upsertFont({ ...base, fileError: err instanceof Error ? err.message : 'The font file could not be read.' });
    }
  })();
  running.set(base.id, job);
  return job;
}

/** Analyse several fonts, two at a time, so a busy page stays responsive. */
export async function analyzeAll(bases: Omit<FontRecord, 'updatedAt'>[], tabId: number | null): Promise<void> {
  const queue = [...bases];
  const worker = async () => {
    while (queue.length) await analyzeFont(queue.shift()!, tabId);
  };
  await Promise.all([worker(), worker()]);
}
