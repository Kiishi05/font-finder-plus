import { allPackChars } from '../../shared/languages';
import { googleFamily } from '../../shared/catalog';
import type { FaceFile } from '../../shared/types';
import { getFontBytes, parseFontBytes } from './fonts';

export interface Coverage {
  codepoints: Set<number>;
  /** files: the font files this site loads. google: the full Google Fonts family. installed: the copy on this computer. */
  from: 'files' | 'google' | 'installed';
  fileCount: number;
}

const cpCache = new Map<string, Promise<number[]>>();

/** The code points a font file has glyphs for (parsed in the worker, cached). */
export function codepointsOf(url: string, tabId: number | null): Promise<number[]> {
  const hit = cpCache.get(url);
  if (hit) return hit;
  const p = getFontBytes(url, tabId)
    .then(parseFontBytes)
    .then((parsed) => parsed.codepoints ?? []);
  cpCache.set(url, p);
  p.catch(() => cpCache.delete(url));
  return p;
}

const weightNum = (w: string) => {
  const parts = w.split(/\s+/).map(Number).filter(Number.isFinite);
  return parts.length ? parts : [400];
};

/**
 * The files for one weight and style: a font is often split into several files
 * by alphabet (unicode-range), so all of them together make up its characters.
 */
export function facesForCoverage(files: FaceFile[], weight = '400', style = 'normal'): FaceFile[] {
  const usable = files.filter((f) => f.url);
  if (!usable.length) return [];
  const want = Number(weight) || 400;
  const groups = new Map<string, FaceFile[]>();
  for (const f of usable) {
    const k = `${f.weight}|${f.style}`;
    groups.set(k, [...(groups.get(k) ?? []), f]);
  }
  const score = (k: string) => {
    const [w, s] = k.split('|');
    const ws = weightNum(w);
    const inRange = ws.length === 2 ? want >= ws[0] && want <= ws[1] : false;
    const dist = inRange ? 0 : Math.min(...ws.map((x) => Math.abs(x - want)));
    return dist + (s === (style || 'normal') ? 0 : 1000);
  };
  const best = [...groups.keys()].sort((a, b) => score(a) - score(b))[0];
  return groups.get(best) ?? [];
}

export async function coverageFromFiles(files: FaceFile[], tabId: number | null, weight?: string, style?: string): Promise<Coverage | null> {
  const faces = facesForCoverage(files, weight, style);
  if (!faces.length) return null;
  const sets = await Promise.allSettled(faces.map((f) => codepointsOf(f.url!, tabId)));
  const codepoints = new Set<number>();
  let ok = 0;
  for (const r of sets) {
    if (r.status !== 'fulfilled') continue;
    ok++;
    r.value.forEach((c) => codepoints.add(c));
  }
  return ok ? { codepoints, from: 'files', fileCount: ok } : null;
}

/**
 * Ask Google Fonts which of the language characters a family has. Google
 * returns a file holding only the requested characters that exist, so this
 * checks the whole family, not just the parts a site happened to load. The
 * only things sent are the family name and the list of test characters.
 */
export async function coverageFromGoogle(family: string): Promise<Coverage | null> {
  const gf = googleFamily(family);
  if (!gf) return null;
  const name = gf.family.replace(/ /g, '+');
  const text = encodeURIComponent(allPackChars() + '0123456789');
  const tries = [`family=${name}`];
  const upright = gf.w.find((w) => !w.endsWith('i'));
  if (upright) tries.push(`family=${name}:wght@${upright}`);
  else if (gf.w[0]) tries.push(`family=${name}:ital,wght@1,${gf.w[0].replace('i', '')}`);
  for (const q of tries) {
    try {
      const res = await fetch(`https://fonts.googleapis.com/css2?${q}&text=${text}`, { credentials: 'omit' });
      if (!res.ok) continue;
      const css = await res.text();
      const urls = [...css.matchAll(/url\((https:[^)]+)\)/g)].map((m) => m[1]);
      if (!urls.length) continue;
      const lists = await Promise.all(urls.map((u) => codepointsOf(u, null)));
      return { codepoints: new Set(lists.flat()), from: 'google', fileCount: urls.length };
    } catch {
      /* try the next form */
    }
  }
  return null;
}
