import { cleanFamilyName } from '../shared/catalog';
import type { NotLoadedFont, PageFontUsage, PageScan, Role, TypeSample } from '../shared/types';
import { clearRenderCache, facesFor, fontFacts, isGeneric, loadFaceMap, parseFamilyList, resolveRendered, roleOf, type Rendered } from './detect';

const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'MATH', 'IFRAME', 'CANVAS', 'VIDEO', 'AUDIO']);
export const MAX_ELEMENTS = 6000;

// Names that icon fonts use. These draw symbols, not text, so they are left
// out of the font list and out of "Show on page".
const ICON_NAME = /(^|[\s_-])(icons?|iconfont|glyphs?|symbols?)([\s_-]|$)|font ?awesome|material ?(icons|symbols)|ionicons|feather|dashicons|glyphicons|lucide|phosphor|remixicon|codicon|tabler|bootstrap-icons|icomoon/i;
// Text made only of Private Use Area characters is how most icon fonts draw icons.
const ONLY_PUA = /^[\s\uE000-\uF8FF\u{F0000}-\u{FFFFD}\u{100000}-\u{10FFFD}]+$/u;

export function isIconFamily(family: string): boolean {
  return ICON_NAME.test(family);
}

export function isIconText(text: string): boolean {
  return !!text.trim() && ONLY_PUA.test(text);
}

/** The page's own font stack, even while the extension is showing a trial font on this element. */
export function familyOf(el: Element, cs: CSSStyleDeclaration): string {
  return el.getAttribute('data-ffp-orig') ?? cs.fontFamily;
}

export function isOurNode(node: Node | null): boolean {
  let n: Node | null = node;
  while (n) {
    if (n instanceof Element && n.id === 'ffp-root') return true;
    n = n instanceof ShadowRoot ? n.host : n.parentNode;
  }
  return false;
}

/** All rendered elements that directly contain text. `hidden` holds those not visible right now. */
export function textElements(): { els: Element[]; hidden: Set<Element>; truncated: boolean } {
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
    else if (isTucked(el.getBoundingClientRect())) hidden.add(el);
    set.add(el);
  }
  return { els: [...set], hidden, truncated };
}

/** Text for screen readers only (a 1px box) or moved off the side of the page. */
function isTucked(r: DOMRect): boolean {
  if (r.width <= 2 || r.height <= 2) return true;
  const docW = Math.max(document.documentElement.scrollWidth, innerWidth);
  return r.right + scrollX <= 0 || r.left + scrollX >= docW;
}

/** Hidden by a parent that clips it (closed dropdowns, carousels, collapsed panels). */
export function isClipped(el: Element): boolean {
  const r = el.getBoundingClientRect();
  let p = el.parentElement;
  for (let i = 0; p && p !== document.body && i < 20; i++, p = p.parentElement) {
    const cs = getComputedStyle(p);
    if (cs.overflowX === 'visible' && cs.overflowY === 'visible' && cs.clipPath === 'none') continue;
    const pr = p.getBoundingClientRect();
    if (r.right <= pr.left + 1 || r.left >= pr.right - 1 || r.bottom <= pr.top + 1 || r.top >= pr.bottom - 1) return true;
  }
  return false;
}

export function ownText(el: Element): string {
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
  els: { el: Element; cs: CSSStyleDeclaration; hidden: boolean }[];
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
    const ff = familyOf(el, cs);
    const key = `${ff}|${cs.fontWeight}|${cs.fontStyle}`;
    let c = combos.get(key);
    if (!c) {
      c = { fontFamily: ff, weight: cs.fontWeight, style: cs.fontStyle, text: '', els: [], allHidden: true };
      combos.set(key, c);
    }
    if (c.text.length < 300) c.text += ownText(el).slice(0, 120) + ' ';
    c.els.push({ el, cs, hidden: hidden.has(el) });
    if (!hidden.has(el)) c.allHidden = false;
  }

  await settleLazyFonts([...combos.values()]);
  clearRenderCache();

  const fonts = new Map<string, PageFontUsage & { _sampleCounts: Map<string, number> }>();
  const notLoaded = new Map<string, NotLoadedFont>();
  const iconFonts = new Set<string>();
  let elementCount = 0;

  for (const combo of combos.values()) {
    const r: Rendered = resolveRendered(combo.fontFamily, combo.weight, combo.style, combo.text);
    if (isIconFamily(r.family) || isIconFamily(parseFamilyList(combo.fontFamily)[0] ?? '') || isIconText(combo.text)) {
      iconFonts.add(cleanFamilyName(parseFamilyList(combo.fontFamily)[0] ?? r.family));
      continue;
    }
    // Invisible text whose font has not been added yet (sites often add it on scroll): not evidence of a failure.
    if (combo.allHidden && r.fellBackFrom.length) continue;
    const key = `${r.family}::${r.kind}`;
    let f = fonts.get(key);
    if (!f) {
      const facts = fontFacts(r);
      f = {
        key,
        family: r.family,
        displayName: facts.displayName,
        catalogFamily: facts.catalogFamily,
        kind: r.kind,
        genericName: r.genericName,
        source: facts.source,
        sourceHost: facts.host,
        files: r.kind === 'web' ? facesFor(r.family) : [],
        declaredStacks: [],
        roles: {},
        elementCount: 0,
        hiddenCount: 0,
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
    for (const { el, cs, hidden: isHidden } of combo.els) {
      elementCount++;
      f.elementCount++;
      if (isHidden || isClipped(el)) f.hiddenCount++;
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
    iconFonts: [...iconFonts],
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

/** Elements on the page that render with the given font key, split into ones you can see and ones you cannot. */
export function elementsForKey(key: string, limit = 400): { shown: Element[]; hidden: number; hiddenEls: Element[]; all: Element[] } {
  const { els, hidden } = textElements();
  const shown: Element[] = [];
  const hiddenEls: Element[] = [];
  let hiddenCount = 0;
  for (const el of els) {
    const text = ownText(el);
    if (isIconText(text)) continue;
    const cs = getComputedStyle(el);
    const r = resolveRendered(familyOf(el, cs), cs.fontWeight, cs.fontStyle, text);
    if (`${r.family}::${r.kind}` !== key) continue;
    if (hidden.has(el) || isClipped(el)) {
      hiddenCount++;
      hiddenEls.push(el);
    } else if (shown.length < limit) shown.push(el);
  }
  return { shown, hidden: hiddenCount, hiddenEls, all: els };
}
