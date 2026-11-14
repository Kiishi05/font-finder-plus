// Fonts I've seen: an optional history of the fonts on pages you read with
// Font Finder Plus. Off unless turned on in Settings; kept only in this
// browser's local database; paused or deleted per site, or all at once.
import { db } from './db';
import { getSettings, setSettings } from './settings';
import type { PageScan, SeenFont } from './types';

const MAX_PAGES = 5;

/** Adds the fonts of a page that was just read, if the history is on and not paused for this site. */
export async function recordSeen(scan: PageScan): Promise<number> {
  const s = await getSettings();
  if (!s.seenEnabled || !scan.host || s.seenPaused.includes(scan.host)) return 0;
  const now = Date.now();
  const fonts = scan.fonts.filter((f) => f.kind !== 'generic');
  await db.transaction('rw', db.seen, async () => {
    for (const f of fonts) {
      const id = `${scan.host}|${f.key}`;
      const old = await db.seen.get(id);
      const page = { url: scan.url, title: scan.title };
      const pages = [page, ...(old?.pages ?? []).filter((p) => p.url !== scan.url)].slice(0, MAX_PAGES);
      // The same page read again within an hour is one visit.
      const again = old && old.pages[0]?.url === scan.url && now - old.lastSeen < 3600_000;
      await db.seen.put({
        id,
        host: scan.host,
        key: f.key,
        family: f.family,
        displayName: f.displayName,
        catalogFamily: f.catalogFamily,
        kind: f.kind,
        classification: f.classification,
        licenseType: f.licenseType,
        roles: Object.keys(f.roles),
        firstSeen: old?.firstSeen ?? now,
        lastSeen: now,
        visits: (old?.visits ?? 0) + (again ? 0 : 1),
        pages,
      });
    }
  });
  return fonts.length;
}

/** A font across every site it was seen on. */
export interface SeenGroup {
  name: string;
  catalogFamily: string | null;
  classification: SeenFont['classification'];
  licenseType: SeenFont['licenseType'];
  roles: string[];
  sites: { host: string; lastSeen: number; visits: number; pages: SeenFont['pages'] }[];
  lastSeen: number;
}

const CLASS_WORDS: Record<string, string[]> = {
  serif: ['serif', 'roman', 'book'],
  sans: ['sans', 'grotesk', 'grotesque', 'gothic', 'sans-serif'],
  mono: ['mono', 'monospace', 'code', 'coding'],
  display: ['display', 'headline', 'heading'],
  script: ['script', 'handwriting', 'cursive', 'handwritten'],
};
const FREE = new Set(['OFL', 'APACHE', 'UFL', 'free-other']);

/**
 * Search the history. Words match a font's name, a site, a kind of font
 * ("serif", "mono", "script"), a role ("heading", "body") or a licence ("free",
 * "paid"). Every word must match. Newest first.
 */
export async function searchSeen(query: string): Promise<SeenGroup[]> {
  const all = await db.seen.orderBy('lastSeen').reverse().toArray();
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = (f: SeenFont) =>
    words.every((w) => {
      if (f.displayName.toLowerCase().includes(w) || f.family.toLowerCase().includes(w) || f.host.toLowerCase().includes(w)) return true;
      if (CLASS_WORDS[f.classification]?.some((c) => c.startsWith(w) || w.startsWith(c))) return true;
      if (f.roles.some((r) => r.startsWith(w) || (w.startsWith('head') && r === 'heading'))) return true;
      if ((w === 'free' || w === 'open') && FREE.has(f.licenseType)) return true;
      if ((w === 'paid' || w === 'commercial') && f.licenseType === 'commercial') return true;
      if (w === 'system' && f.licenseType === 'system') return true;
      return f.pages.some((p) => p.title.toLowerCase().includes(w));
    });
  const groups = new Map<string, SeenGroup>();
  for (const f of all) {
    if (!matches(f)) continue;
    const k = (f.catalogFamily ?? f.displayName).toLowerCase();
    let g = groups.get(k);
    if (!g) {
      g = { name: f.catalogFamily ?? f.displayName, catalogFamily: f.catalogFamily, classification: f.classification, licenseType: f.licenseType, roles: [], sites: [], lastSeen: f.lastSeen };
      groups.set(k, g);
    }
    g.sites.push({ host: f.host, lastSeen: f.lastSeen, visits: f.visits, pages: f.pages });
    g.roles = [...new Set([...g.roles, ...f.roles])];
    g.lastSeen = Math.max(g.lastSeen, f.lastSeen);
  }
  return [...groups.values()].sort((a, b) => b.lastSeen - a.lastSeen);
}

/** Every site in the history, with how many fonts each has. */
export async function seenSites(): Promise<{ host: string; fonts: number; lastSeen: number }[]> {
  const out = new Map<string, { host: string; fonts: number; lastSeen: number }>();
  await db.seen.each((f) => {
    const e = out.get(f.host) ?? { host: f.host, fonts: 0, lastSeen: 0 };
    e.fonts++;
    e.lastSeen = Math.max(e.lastSeen, f.lastSeen);
    out.set(f.host, e);
  });
  return [...out.values()].sort((a, b) => b.lastSeen - a.lastSeen);
}

export const deleteSeenSite = (host: string) => db.seen.where('host').equals(host).delete();
export const clearSeen = () => db.seen.clear();

export async function setPaused(host: string, paused: boolean): Promise<string[]> {
  const s = await getSettings();
  const list = paused ? [...new Set([...s.seenPaused, host])] : s.seenPaused.filter((h) => h !== host);
  await setSettings({ seenPaused: list });
  return list;
}
