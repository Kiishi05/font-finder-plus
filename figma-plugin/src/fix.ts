// "Fix a captured page": finds text layers whose fonts this Figma does not have
// (common after importing a web page), suggests replacements Figma has, swaps
// them, and keeps the original so Check again can switch back once installed.
import type { FigmaPayload } from '../../src/shared/figma-payload';
import { knownFont, licenceTypeFor } from '../../src/shared/licences';
import googleNames from './gen/google-names.json';
import { findFamily, isItalicStyle, pickStyle, weightOfStyle, type familyIndex } from './match';

type Index = ReturnType<typeof familyIndex>;
const GOOGLE = new Set((googleNames as string[]).map((n) => n.toLowerCase()));
const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

export interface MissingFamily {
  family: string;
  styles: string[];
  layers: number;
  /** Where the font comes from, when known. */
  source: 'google' | 'paid' | 'free-elsewhere' | 'unknown';
  getIt: { label: string; url: string } | null;
  /** Replacements this Figma has, best first, with the match % when the extension measured it. */
  options: { family: string; score: number | null }[];
}

interface Range { start: number; end: number; family: string; style: string }

export function textLayers(roots: readonly SceneNode[] | readonly BaseNode[]): TextNode[] {
  const out: TextNode[] = [];
  for (const r of roots) {
    if (r.type === 'TEXT') out.push(r as TextNode);
    if ('findAllWithCriteria' in r) out.push(...(r as ChildrenMixin).findAllWithCriteria({ types: ['TEXT'] }));
  }
  return out;
}

function guessKind(family: string): 'mono' | 'serif' | 'script' | 'sans' {
  if (/mono|code|courier|console|typewriter/i.test(family)) return 'mono';
  if (/script|hand|brush|marker|signature/i.test(family)) return 'script';
  if (/serif|garamond|caslon|times|georgia|baskerville|bodoni|didot|tiempos|canela|lyon|publico|mercury|sentinel|chronicle|roman|book antiqua|palatino/i.test(family) && !/sans/i.test(family)) return 'serif';
  return 'sans';
}

const BY_KIND: Record<string, string[]> = {
  sans: ['Inter', 'Arimo', 'Roboto', 'Open Sans', 'Helvetica', 'Arial'],
  serif: ['Source Serif 4', 'Tinos', 'Lora', 'Merriweather', 'Georgia', 'Times New Roman'],
  mono: ['Roboto Mono', 'Source Code Pro', 'IBM Plex Mono', 'JetBrains Mono', 'Cousine', 'Courier New'],
  script: ['Dancing Script', 'Caveat', 'Pacifico'],
};

/** Every font family used in these layers that this Figma does not have. */
export function findMissing(layers: TextNode[], ix: Index, payload: FigmaPayload | null): { missing: MissingFamily[]; checked: number } {
  const map = new Map<string, { styles: Set<string>; layers: Set<string> }>();
  for (const t of layers) {
    if (!t.hasMissingFont) continue;
    for (const seg of t.getStyledTextSegments(['fontName'])) {
      const f = seg.fontName;
      const fam = findFamily(ix, [f.family]);
      if (fam && fam.styles.includes(f.style)) continue;
      const e = map.get(f.family) ?? { styles: new Set<string>(), layers: new Set<string>() };
      e.styles.add(f.style);
      e.layers.add(t.id);
      map.set(f.family, e);
    }
  }
  const missing: MissingFamily[] = [];
  for (const [family, e] of map) {
    // The extension's scan of the site, if pasted: its measured look-alikes come first.
    const fromScan = payload?.fonts.find((f) => [f.name, f.cssFamily].some((n) => squash(n) === squash(family)));
    const options: MissingFamily['options'] = [];
    const add = (name: string | undefined | null, score: number | null) => {
      if (!name) return;
      const hit = findFamily(ix, [name]);
      if (hit && !options.some((o) => o.family === hit.family)) options.push({ family: hit.family, score });
    };
    if (fromScan) [fromScan.standIn, ...fromScan.alternatives].forEach((a) => a && add(a.family, a.score));
    BY_KIND[fromScan?.classification === 'serif' || fromScan?.classification === 'mono' || fromScan?.classification === 'script' ? fromScan.classification : guessKind(family)].forEach((n) => add(n, null));
    const known = knownFont(family);
    const google = GOOGLE.has(family.toLowerCase());
    missing.push({
      family,
      styles: [...e.styles],
      layers: e.layers.size,
      source: google ? 'google' : known ? (licenceTypeFor(known) === 'commercial' ? 'paid' : 'free-elsewhere') : 'unknown',
      getIt: google
        ? { label: 'Google Fonts (free)', url: `https://fonts.google.com/specimen/${family.replace(/ /g, '+')}` }
        : known
          ? { label: known.by, url: known.url }
          : fromScan?.getIt ?? null,
      options: options.slice(0, 6),
    });
  }
  missing.sort((a, b) => b.layers - a.layers);
  return { missing, checked: layers.length };
}

/** Replace missing families with the chosen ones. Returns how many layers changed. */
export async function replaceMissing(layers: TextNode[], ix: Index, choices: Record<string, string>, load: (f: FontName) => Promise<boolean>): Promise<{ changed: number; failed: number }> {
  let changed = 0;
  let failed = 0;
  for (const t of layers) {
    if (!t.hasMissingFont) continue;
    const segs = t.getStyledTextSegments(['fontName']).filter((s) => choices[s.fontName.family]);
    if (!segs.length) continue;
    const before: Range[] = JSON.parse(t.getPluginData('ffp-original') || '[]');
    let ok = true;
    for (const seg of segs) {
      const rep = findFamily(ix, [choices[seg.fontName.family]]);
      if (!rep) { ok = false; continue; }
      const font: FontName = { family: rep.family, style: pickStyle(rep.styles, weightOfStyle(seg.fontName.style), isItalicStyle(seg.fontName.style)) ?? 'Regular' };
      if (!(await load(font))) { ok = false; continue; }
      try {
        t.setRangeFontName(seg.start, seg.end, font);
        before.push({ start: seg.start, end: seg.end, family: seg.fontName.family, style: seg.fontName.style });
      } catch {
        ok = false;
      }
    }
    t.setPluginData('ffp-original', JSON.stringify(before));
    if (ok) changed++;
    else failed++;
  }
  return { changed, failed };
}

/** Put the original fonts back in layers where they are now installed. */
export async function restoreOriginals(layers: TextNode[], ix: Index, load: (f: FontName) => Promise<boolean>): Promise<{ restored: number; still: string[] }> {
  let restored = 0;
  const still = new Set<string>();
  for (const t of layers) {
    const raw = t.getPluginData('ffp-original');
    if (!raw) continue;
    const ranges: Range[] = JSON.parse(raw);
    const keep: Range[] = [];
    for (const r of ranges) {
      const fam = findFamily(ix, [r.family]);
      if (!fam || !fam.styles.includes(r.style) || r.end > t.characters.length) {
        still.add(r.family);
        keep.push(r);
        continue;
      }
      const font = { family: fam.family, style: r.style };
      // Every font in the layer must be loaded before it can be changed.
      const used = t.getStyledTextSegments(['fontName']).map((s) => s.fontName);
      if (!(await load(font)) || !(await Promise.all(used.map(load))).every(Boolean)) {
        keep.push(r);
        continue;
      }
      t.setRangeFontName(r.start, r.end, font);
      restored++;
    }
    t.setPluginData('ffp-original', keep.length ? JSON.stringify(keep) : '');
  }
  return { restored, still: [...still] };
}
