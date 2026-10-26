import { classify } from '../../shared/catalog';
import { db, upsertFont } from '../../shared/db';
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
    if (cached?.parsed) return;
    try {
      const bytes = await getFontBytes(fileUrl, tabId);
      const parsed = await parseFontBytes(bytes);
      await upsertFont({
        ...base,
        parsed,
        format: parsed.format,
        foundry: parsed.manufacturer,
        classification: classify(base.family, base.source, parsed.classification),
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
