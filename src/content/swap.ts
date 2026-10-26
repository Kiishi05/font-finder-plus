// Try another font on the page without changing the site: the chosen font is
// added with the FontFace API (so the page's security rules do not block it)
// and set on the elements that use the original font, as inline styles that
// are removed again on undo.
import { base64ToArrayBuffer } from '../shared/messages';
import { elementsForKey } from './scan';

export interface SwapFace {
  base64: string;
  weight: string;
  style: string;
  unicodeRange: string | null;
}

interface Saved {
  el: HTMLElement;
  props: Record<string, [string, string]>;
}

const PROPS = ['font-family', 'font-size-adjust', 'font-variation-settings', 'font-weight'] as const;
const swaps = new Map<string, { label: string; els: Saved[] }>();
let aliasSeq = 0;
const aliases = new Map<string, string>();

async function aliasFor(family: string, faces: SwapFace[]): Promise<string> {
  const known = aliases.get(family);
  if (known) return known;
  const alias = `FFP Swap ${++aliasSeq}`;
  await Promise.all(
    faces.map(async (f) => {
      const desc: FontFaceDescriptors = { weight: f.weight, style: f.style };
      if (f.unicodeRange) desc.unicodeRange = f.unicodeRange;
      const face = new FontFace(alias, base64ToArrayBuffer(f.base64), desc);
      await face.load();
      document.fonts.add(face);
    }),
  );
  aliases.set(family, alias);
  return alias;
}

function remember(key: string, label: string, el: HTMLElement) {
  let entry = swaps.get(key);
  if (!entry) {
    entry = { label, els: [] };
    swaps.set(key, entry);
  }
  let saved = entry.els.find((s) => s.el === el);
  if (!saved) {
    const props: Saved['props'] = {};
    for (const p of PROPS) props[p] = [el.style.getPropertyValue(p), el.style.getPropertyPriority(p)];
    saved = { el, props };
    entry.els.push(saved);
    if (!el.hasAttribute('data-ffp-orig')) el.setAttribute('data-ffp-orig', getComputedStyle(el).fontFamily);
  }
  return entry;
}

function targets(key: string): HTMLElement[] {
  const swapped = swaps.get(key)?.els.map((s) => s.el) ?? [];
  if (swapped.length) return swapped;
  const { shown, hiddenEls } = elementsForKey(key, 100000);
  return [...shown, ...hiddenEls].filter((e): e is HTMLElement => e instanceof HTMLElement);
}

/** Show `family` instead of the font with this key. `aspect` keeps the original x-height. */
export async function swapFont(key: string, family: string, faces: SwapFace[], generic: string, aspect: number | null): Promise<number> {
  const alias = await aliasFor(family, faces);
  const els = targets(key);
  for (const el of els) {
    remember(key, family, el);
    el.style.setProperty('font-family', `"${alias}", ${generic}`, 'important');
    if (aspect) el.style.setProperty('font-size-adjust', String(aspect), 'important');
    else el.style.removeProperty('font-size-adjust');
    el.setAttribute('data-ffp-swap', family);
  }
  const entry = swaps.get(key);
  if (entry) entry.label = family;
  return els.length;
}

/** Set variable font axes on the elements that use this font (variable playground). */
export function varyFont(key: string, settings: string | null, weight: string | null): number {
  const els = targets(key);
  for (const el of els) {
    remember(key, swaps.get(key)?.label ?? '', el);
    if (settings) el.style.setProperty('font-variation-settings', settings, 'important');
    else el.style.removeProperty('font-variation-settings');
    if (weight) el.style.setProperty('font-weight', weight, 'important');
  }
  return els.length;
}

/** Put the page back as it was, for one font or all. */
export function unswap(key: string | null): void {
  for (const [k, entry] of [...swaps]) {
    if (key && k !== key) continue;
    for (const { el, props } of entry.els) {
      for (const p of PROPS) {
        const [v, pr] = props[p];
        if (v) el.style.setProperty(p, v, pr);
        else el.style.removeProperty(p);
      }
      el.removeAttribute('data-ffp-swap');
      el.removeAttribute('data-ffp-orig');
    }
    swaps.delete(k);
  }
}

export function activeSwaps(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of swaps) if (v.label) out[k] = v.label;
  return out;
}
