// Loading Google Fonts families into the side panel (previews) and fetching
// their files to try them on a page. These are the Google Fonts API calls the
// suggestions need; nothing about the page is sent.
import { useEffect, useState } from 'react';
import { googleFamily } from '../../shared/catalog';
import { arrayBufferToBase64, sendToTab } from '../../shared/messages';
import { getFontBytes } from './fonts';

/** css2 family parameter covering a family's styles (variable ranges where it has them). */
export function familyParam(family: string, opts: { axes?: boolean } = {}): string {
  const gf = googleFamily(family);
  const name = (gf?.family ?? family).replace(/ /g, '+');
  if (!gf) return name;
  const hasItal = gf.w.some((w) => w.endsWith('i'));
  const axes = (gf.a ?? []).filter(([t]) => opts.axes || t === 'wght');
  if (axes.length) {
    // Google wants lowercase axes first, each group in alphabetical order.
    const sorted = [...axes].sort(([a], [b]) => {
      const la = a === a.toLowerCase();
      const lb = b === b.toLowerCase();
      if (la !== lb) return la ? -1 : 1;
      return a < b ? -1 : 1;
    });
    const tags = sorted.map(([t]) => t);
    const ranges = sorted.map(([, mi, ma]) => `${mi}..${ma}`);
    if (hasItal && !tags.includes('ital')) return `${name}:ital,${tags.join(',')}@0,${ranges.join(',')};1,${ranges.join(',')}`;
    return `${name}:${tags.join(',')}@${ranges.join(',')}`;
  }
  const up = gf.w.filter((w) => !w.endsWith('i'));
  const it = gf.w.filter((w) => w.endsWith('i')).map((w) => w.slice(0, -1));
  if (!it.length) return up.length > 1 || (up[0] && up[0] !== '400') ? `${name}:wght@${up.join(';')}` : name;
  const tuples = [...up.map((w) => `0,${w}`), ...it.map((w) => `1,${w}`)];
  return `${name}:ital,wght@${tuples.join(';')}`;
}

const linked = new Set<string>();

/** Add a Google Fonts stylesheet to the panel (once per family). */
export function linkGoogleFamily(family: string, opts: { axes?: boolean } = {}) {
  const param = familyParam(family, opts);
  if (linked.has(param)) return;
  linked.add(param);
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${param}&display=swap`;
  document.head.appendChild(link);
}

/** Add a Google Fonts stylesheet to the panel so text can be drawn in the family. */
export function useGoogleFont(family: string | null, opts: { axes?: boolean } = {}): string {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!family) return;
    linkGoogleFamily(family, opts);
    document.fonts.load(`16px "${googleFamily(family)?.family ?? family}"`).finally(() => setReady(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [family, opts.axes]);
  void ready;
  const name = googleFamily(family ?? '')?.family ?? family;
  return name ? `"${name}", "FFP NotDef"` : 'inherit';
}

const SWAP_SUBSETS = /^(latin|latin-ext|vietnamese)$/;

interface CssFace { subset: string; style: string; weight: string; url: string; unicodeRange: string | null }

function parseCss(css: string): CssFace[] {
  const out: CssFace[] = [];
  const re = /(?:\/\*\s*([\w-]+)\s*\*\/\s*)?@font-face\s*{([^}]*)}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) {
    const body = m[2];
    const url = /url\((https:[^)]+)\)/.exec(body)?.[1];
    if (!url) continue;
    out.push({
      subset: m[1] ?? 'latin',
      style: /font-style:\s*([^;]+);/.exec(body)?.[1].trim() ?? 'normal',
      weight: /font-weight:\s*([^;]+);/.exec(body)?.[1].trim() ?? '400',
      url,
      unicodeRange: /unicode-range:\s*([^;]+);/.exec(body)?.[1].trim() ?? null,
    });
  }
  return out;
}

/** The files for a Google family (Latin subsets), ready to send to the page. */
export async function swapFaces(family: string) {
  const res = await fetch(`https://fonts.googleapis.com/css2?family=${familyParam(family)}&display=swap`, { credentials: 'omit' });
  if (!res.ok) throw new Error('Google Fonts did not answer.');
  const faces = parseCss(await res.text()).filter((f) => SWAP_SUBSETS.test(f.subset));
  return Promise.all(
    faces.map(async (f) => ({ base64: arrayBufferToBase64(await getFontBytes(f.url, null)), weight: f.weight, style: f.style, unicodeRange: f.unicodeRange })),
  );
}

const GENERIC: Record<string, string> = { serif: 'serif', sans: 'sans-serif', mono: 'monospace', display: 'sans-serif', script: 'cursive', unknown: 'sans-serif' };

/** Try a Google family on the page in place of the font with `key`. */
export async function trySwap(tabId: number, key: string, family: string, aspect: number | null): Promise<number> {
  const gf = googleFamily(family);
  const faces = await swapFaces(family);
  const r = await sendToTab<{ ok: boolean; count?: number; error?: string }>(
    tabId,
    { type: 'ffp:swap', key, family: gf?.family ?? family, faces, generic: GENERIC[gf?.c ?? 'unknown'], aspect },
    30000,
  );
  if (!r?.ok) throw new Error(r?.error ?? 'The page did not answer.');
  window.dispatchEvent(new Event('ffp-swaps'));
  return r.count ?? 0;
}

export async function undoSwap(tabId: number, key: string | null) {
  await sendToTab(tabId, { type: 'ffp:unswap', key });
  window.dispatchEvent(new Event('ffp-swaps'));
}

/** Which fonts on the page are showing a trial font right now (key to family). */
export function useSwaps(tabId: number | null): Record<string, string> {
  const [swaps, setSwaps] = useState<Record<string, string>>({});
  useEffect(() => {
    if (tabId == null) return;
    const load = () => sendToTab<{ swaps: Record<string, string> }>(tabId, { type: 'ffp:swaps' }).then((r) => setSwaps(r?.swaps ?? {}));
    load();
    window.addEventListener('ffp-swaps', load);
    return () => window.removeEventListener('ffp-swaps', load);
  }, [tabId]);
  return swaps;
}
