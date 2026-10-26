import type { NotLoadedFont, PageFontUsage, PageScan, Role, TypeSample } from '../shared/types';
import { clearRenderCache, facesFor, fontFacts, isGeneric, loadFaceMap, parseFamilyList, resolveRendered, roleOf, type Rendered } from './detect';

const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'MATH', 'IFRAME', 'CANVAS', 'VIDEO', 'AUDIO']);
export const MAX_ELEMENTS = 6000;

export function isOurNode(node: Node | null): boolean {
  let n: Node | null = node;
  while (n) {
    if (n instanceof Element && n.id === 'ffp-root') return true;
    n = n.parentNode;
  }
  return false;
}

/** All rendered elements that directly contain text. `hidden` holds those not visible right now. */
function textElements(): { els: Element[]; hidden: Set<Element>; truncated: boolean } {
  const set = new Set<Element>();
  const hidden = new Set<Element>();
  const walker = document.createTreeWalker(document.body ?? document.documentElement, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
      const p = node.parentElement;
      if (!p || SKIP.has(p.tagName.toUpperCase()) || p.closest('svg,#ffp-root')) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let truncated = false;
  while (walker.nextNode()) {
    const el = walker.currentNode.parentElement!;
    if (set.has(el)) continue;
    if (set.size >= MAX_ELEMENTS) {
      truncated = true;
      break;
    }
    if (!el.getClientRects().length) continue;
    // Text that is transparent or hidden right now (often waiting to animate in on scroll).
    const ev = el as Element & { checkVisibility?: (o: object) => boolean };
    if (ev.checkVisibility && !ev.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) hidden.add(el);
    set.add(el);
  }
  return { els: [...set], hidden, truncated };
}

function ownText(el: Element): string {
  let t = '';
  el.childNodes.forEach((n) => {
    if (n.nodeType === Node.TEXT_NODE) t += n.nodeValue;
  });
  return t.trim();
}

interface Combo {
  fontFamily: string;
  weight: string;
  style: string;
  text: string;
  els: { el: Element; cs: CSSStyleDeclaration }[];
  allHidden: boolean;
}

export async function scanPage(): Promise<PageScan> {
  await document.fonts.ready.catch(() => undefined);
  await loadFaceMap(true);
  const { els, hidden, truncated } = textElements();

  const combos = new Map<string, Combo>();
  for (const el of els) {
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden') continue;
    const key = `${cs.fontFamily}|${cs.fontWeight}|${cs.fontStyle}`;
    let c = combos.get(key);
    if (!c) {
      c = { fontFamily: cs.fontFamily, weight: cs.fontWeight, style: cs.fontStyle, text: '', els: [], allHidden: true };
      combos.set(key, c);
    }
    if (c.text.length < 300) c.text += ownText(el).slice(0, 120) + ' ';
    c.els.push({ el, cs });
    if (!hidden.has(el)) c.allHidden = false;
  }

  await settleLazyFonts([...combos.values()]);
  clearRenderCache();

  const fonts = new Map<string, PageFontUsage & { _sampleCounts: Map<string, number> }>();
  const notLoaded = new Map<string, NotLoadedFont>();
  let elementCount = 0;

  for (const combo of combos.values()) {
    const r: Rendered = resolveRendered(combo.fontFamily, combo.weight, combo.style, combo.text);
    // Invisible text whose font has not been added yet (sites often add it on scroll): not evidence of a failure.
    if (combo.allHidden && r.fellBackFrom.length) continue;
    const key = `${r.family}::${r.kind}`;
    let f = fonts.get(key);
    if (!f) {
      const facts = fontFacts(r);
      f = {
        key,
        family: r.family,
        kind: r.kind,
        genericName: r.genericName,
        source: facts.source,
        sourceHost: facts.host,
        files: r.kind === 'web' ? facesFor(r.family) : [],
        declaredStacks: [],
        roles: {},
        elementCount: 0,
        weights: [],
        styles: [],
        sizes: [],
        sample: { fontSize: 16, fontWeight: '400', fontStyle: 'normal', lineHeight: 'normal', letterSpacing: 'normal', color: '' },
        fellBackFrom: [],
        classification: facts.classification,
        licenseType: facts.licenseType,
        designers: facts.designers,
        _sampleCounts: new Map(),
      };
      fonts.set(key, f);
    }
    if (!f.declaredStacks.includes(combo.fontFamily)) f.declaredStacks.push(combo.fontFamily);
    for (const s of r.fellBackFrom) {
      if (!f.fellBackFrom.includes(s)) f.fellBackFrom.push(s);
      const nl = notLoaded.get(s) ?? { family: s, reason: r.failedWeb.includes(s) ? 'failed' : 'missing', fellBackTo: r.family, count: 0 };
      nl.count += combo.els.length;
      notLoaded.set(s, nl);
    }
    if (!f.weights.includes(combo.weight)) f.weights.push(combo.weight);
    if (!f.styles.includes(combo.style)) f.styles.push(combo.style);
    for (const { el, cs } of combo.els) {
      elementCount++;
      f.elementCount++;
      const role: Role = roleOf(el);
      f.roles[role] = (f.roles[role] ?? 0) + 1;
      const size = parseFloat(cs.fontSize);
      if (!f.sizes.includes(size)) f.sizes.push(size);
      const sample: TypeSample = {
        fontSize: size,
        fontWeight: cs.fontWeight,
        fontStyle: cs.fontStyle,
        lineHeight: cs.lineHeight,
        letterSpacing: cs.letterSpacing,
        color: cs.color,
      };
      const sk = JSON.stringify(sample);
      f._sampleCounts.set(sk, (f._sampleCounts.get(sk) ?? 0) + 1);
    }
  }

  const out: PageFontUsage[] = [...fonts.values()]
    .map(({ _sampleCounts, ...f }) => {
      const top = [..._sampleCounts.entries()].sort((a, b) => b[1] - a[1])[0];
      if (top) f.sample = JSON.parse(top[0]);
      f.weights.sort((a, b) => Number(a) - Number(b));
      f.sizes.sort((a, b) => b - a);
      return f;
    })
    .sort((a, b) => b.elementCount - a.elementCount);

  return {
    url: location.href,
    host: location.hostname,
    title: document.title,
    scannedAt: Date.now(),
    elementCount,
    truncated,
    fonts: out,
    notLoaded: [...notLoaded.values()].sort((a, b) => b.count - a.count),
  };
}

/**
 * Browsers fetch web fonts lazily. A face can be "unloaded" simply because it
 * has not been needed yet, which is not the same as failing. Ask the browser to
 * load the faces this page's text asks for (only faces the page itself
 * declares), wait up to 3 seconds, then decide.
 */
async function settleLazyFonts(combos: Combo[]): Promise<void> {
  const pending: Promise<unknown>[] = [];
  const seen = new Set<string>();
  for (const c of combos) {
    for (const fam of parseFamilyList(c.fontFamily)) {
      if (isGeneric(fam)) break;
      const lower = fam.toLowerCase();
      let declared = false;
      let anyUsable = false;
      document.fonts.forEach((f) => {
        if (f.family.replace(/['"]/g, '').toLowerCase() !== lower) return;
        declared = true;
        if (f.status === 'loaded') anyUsable = true;
      });
      if (!declared) continue;
      if (!anyUsable) {
        const key = `${c.style} ${c.weight} ${fam}`;
        if (!seen.has(key)) {
          seen.add(key);
          pending.push(document.fonts.load(`${c.style} ${c.weight} 16px ${JSON.stringify(fam)}`, c.text.slice(0, 100) || 'A').catch(() => undefined));
        }
      }
      break; // only the first web family in each stack matters here
    }
  }
  if (!pending.length) return;
  await Promise.race([Promise.all(pending), new Promise((r) => setTimeout(r, 3000))]);
}

/** Elements on the page that render with the given font key, for highlighting. */
export function elementsForKey(key: string, limit = 300): Element[] {
  const { els } = textElements();
  const out: Element[] = [];
  for (const el of els) {
    const cs = getComputedStyle(el);
    const r = resolveRendered(cs.fontFamily, cs.fontWeight, cs.fontStyle, ownText(el));
    if (`${r.family}::${r.kind}` === key) out.push(el);
    if (out.length >= limit) break;
  }
  return out;
}
