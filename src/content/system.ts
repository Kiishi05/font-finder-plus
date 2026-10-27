// System tab data, gathered in the page: the distinct text styles, readability
// checks, and how fonts are loaded. Nothing leaves the browser.
import type { DevFace, DevInfo, ReadabilityIssue, SystemScan, TextStyle } from '../shared/types';
import { OWN_FONT_PREFIX, fontKey as keyOf, facesFor, fontFacts, resolveRendered, roleOf } from './detect';
import { familyOf, isClipped, isIconText, ownText, textElements } from './scan';

const issueEls = new Map<string, Element[]>();

export function elementsForIssue(id: string): Element[] {
  return issueEls.get(id) ?? [];
}

// ------------------------------------------------------------- colour

function parseColor(c: string): [number, number, number, number] | null {
  const m = /rgba?\(([^)]+)\)/.exec(c);
  if (!m) return null;
  const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
  return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
}

function blend(top: [number, number, number, number], under: [number, number, number]): [number, number, number] {
  const a = top[3];
  return [top[0] * a + under[0] * (1 - a), top[1] * a + under[1] * (1 - a), top[2] * a + under[2] * (1 - a)];
}

/** Solid background behind an element, or null when an image or gradient is involved. */
function backgroundOf(el: Element): [number, number, number] | null {
  const layers: [number, number, number, number][] = [];
  let n: Element | null = el;
  while (n) {
    const cs = getComputedStyle(n);
    if (cs.backgroundImage && cs.backgroundImage !== 'none') return null;
    const c = parseColor(cs.backgroundColor);
    if (c && c[3] > 0) {
      layers.push(c);
      if (c[3] >= 0.99) break;
    }
    n = n.parentElement;
  }
  let base: [number, number, number] = [255, 255, 255];
  for (let i = layers.length - 1; i >= 0; i--) base = blend(layers[i], base);
  return base;
}

const lum = ([r, g, b]: [number, number, number]) => {
  const f = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};

function contrast(a: [number, number, number], b: [number, number, number]): number {
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

const hex = (c: [number, number, number]) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase();

// ------------------------------------------------------------- scan

export function scanSystem(): SystemScan {
  const { els, hidden } = textElements();
  const styles = new Map<string, TextStyle>();
  const found = new Map<string, { level: ReadabilityIssue['level']; title: string; detail: string; els: Element[]; sample: string; worst?: number; worstText?: string }>();
  const flag = (id: string, level: ReadabilityIssue['level'], title: string, detail: string, el: Element, sample: string) => {
    let f = found.get(id);
    if (!f) {
      f = { level, title, detail, els: [], sample };
      found.set(id, f);
    }
    if (!f.els.includes(el)) f.els.push(el);
    return f;
  };
  const blocksChecked = new Set<Element>();

  for (const el of els) {
    const text = ownText(el);
    if (!text || isIconText(text)) continue;
    const cs = getComputedStyle(el);
    const r = resolveRendered(familyOf(el, cs), cs.fontWeight, cs.fontStyle, text);
    const fontKey = keyOf(r);
    const size = Math.round(parseFloat(cs.fontSize) * 100) / 100;
    const lh = cs.lineHeight === 'normal' ? null : Math.round(parseFloat(cs.lineHeight) * 100) / 100;
    const ls = cs.letterSpacing === 'normal' ? 0 : Math.round(parseFloat(cs.letterSpacing) * 100) / 100;
    const key = [fontKey, size, cs.fontWeight, cs.fontStyle, lh, ls, cs.textTransform].join('|');
    let st = styles.get(key);
    if (!st) {
      const facts = fontFacts(r);
      st = {
        id: `s${styles.size}`,
        fontKey,
        family: r.family,
        displayName: facts.displayName,
        declared: r.declared,
        size,
        lineHeight: lh,
        weight: cs.fontWeight,
        style: cs.fontStyle,
        letterSpacing: ls,
        transform: cs.textTransform,
        tags: {},
        roles: {},
        count: 0,
        sample: '',
      };
      styles.set(key, st);
    }
    st.count++;
    const tag = (el.closest('h1,h2,h3,h4,h5,h6')?.tagName ?? el.tagName).toLowerCase();
    st.tags[tag] = (st.tags[tag] ?? 0) + 1;
    const role = roleOf(el);
    st.roles[role] = (st.roles[role] ?? 0) + 1;
    if (st.sample.length < 60) st.sample = (st.sample ? st.sample + ' ' : '') + text.slice(0, 60);

    // Readability checks only look at text you can see.
    if (hidden.has(el) || isClipped(el)) continue;
    const weight = Number(cs.fontWeight) || 400;
    const large = size >= 24 || (size >= 18.66 && weight >= 700);

    // Contrast (WCAG 2.1 AA)
    const fg = parseColor(cs.color);
    const bg = backgroundOf(el);
    if (fg && bg) {
      const opacity = Number(cs.opacity) || 1;
      const c = contrast(blend([fg[0], fg[1], fg[2], fg[3] * opacity], bg), bg);
      const need = large ? 3 : 4.5;
      if (c < need) {
        const f = flag('contrast', 'fail', 'Low contrast text', 'Below WCAG AA: at least 4.5:1 for normal text and 3:1 for large text.', el, text);
        if (f.worst == null || c < f.worst) {
          f.worst = c;
          f.worstText = `${hex(blend([fg[0], fg[1], fg[2], fg[3] * opacity], bg))} on ${hex(bg)}`;
        }
      }
    }
    if (size < 12) flag('tiny', 'warn', 'Very small text', 'Text under 12px is hard to read for many people.', el, text);
    if (weight <= 300 && size < 16 && role === 'body') flag('thin', 'warn', 'Thin text at a small size', 'Light weights (300 or lower) fade at small sizes. Use 400 or larger text.', el, text);
    if (cs.textTransform === 'uppercase' && text.length > 40) flag('caps', 'tip', 'Long text in all caps', 'All caps slows reading in sentences. Keep it for short labels.', el, text);
    if (cs.textTransform === 'uppercase' && ls <= 0 && size < 20) flag('capsspace', 'tip', 'Small uppercase text without letter spacing', 'Small uppercase text usually reads better with a little letter spacing, around 0.05em.', el, text);

    // Paragraph checks: size, line height, line length.
    const block = el.closest('p,li,dd,blockquote');
    if (block && !blocksChecked.has(block)) {
      blocksChecked.add(block);
      const full = (block.textContent ?? '').trim();
      const bcs = getComputedStyle(block);
      const bsize = parseFloat(bcs.fontSize);
      const blh = bcs.lineHeight === 'normal' ? bsize * 1.2 : parseFloat(bcs.lineHeight);
      const lines = Math.max(1, Math.round(block.getBoundingClientRect().height / blh));
      if (full.length > 80) {
        if (bsize < 16) flag('bodysize', 'tip', 'Body text under 16px', '16px or larger is easier to read on screens, especially on phones.', block, full);
        const ratio = blh / bsize;
        if (lines >= 2 && ratio < 1.3) flag('tight', 'warn', 'Tight line height in paragraphs', 'Paragraphs read best with line height around 1.4 to 1.6 times the text size.', block, full);
        if (lines >= 2 && ratio > 2) flag('loose', 'tip', 'Very loose line height', 'Line height above 2 can make lines feel disconnected.', block, full);
        const perLine = full.length / lines;
        if (lines >= 2 && perLine > 90) flag('long', 'warn', 'Lines are too long', `About ${Math.round(perLine)} characters per line. 45 to 80 is easier to read; try a narrower column.`, block, full);
        if (lines >= 3 && perLine < 30) flag('short', 'tip', 'Lines are very short', `About ${Math.round(perLine)} characters per line. Very short lines break up reading.`, block, full);
      }
    }
  }

  issueEls.clear();
  const issues: ReadabilityIssue[] = [];
  const order = { fail: 0, warn: 1, tip: 2 };
  for (const [id, f] of found) {
    issueEls.set(id, f.els);
    issues.push({
      id,
      level: f.level,
      title: f.title,
      detail: f.worst != null ? `${f.detail} Lowest found: ${Math.round(f.worst * 10) / 10}:1 (${f.worstText}).` : f.detail,
      count: f.els.length,
      sample: f.sample.slice(0, 80),
    });
  }
  issues.sort((a, b) => order[a.level] - order[b.level] || b.count - a.count);

  return {
    styles: [...styles.values()].sort((a, b) => b.size - a.size || b.count - a.count),
    issues,
    dev: devInfo(),
  };
}

function devInfo(): DevInfo {
  const faces: DevFace[] = [];
  document.fonts.forEach((f) => {
    const family = f.family.replace(/['"]/g, '');
    if (family.startsWith(OWN_FONT_PREFIX)) return;
    const file = facesFor(family).find((x) => x.weight === f.weight && x.style === f.style && (x.unicodeRange ?? 'U+0-10FFFF') === (f.unicodeRange || 'U+0-10FFFF')) ?? facesFor(family).find((x) => x.weight === f.weight && x.style === f.style);
    faces.push({ family, weight: f.weight, style: f.style, status: f.status, display: f.display, url: file?.url ?? null, format: file?.format ?? null, unicodeRange: f.unicodeRange || null });
  });
  const resources = (performance.getEntriesByType('resource') as PerformanceResourceTiming[])
    .filter((e) => /\.(woff2?|ttf|otf|eot)(\?|#|$)/i.test(e.name) || /fonts\.gstatic\.com|use\.typekit\.net\/af\//.test(e.name))
    .map((e) => ({ url: e.name, bytes: e.encodedBodySize || e.transferSize || null, ms: Math.round(e.duration) }));
  const preloads = [...document.querySelectorAll<HTMLLinkElement>('link[rel="preload"][as="font"]')].map((l) => l.href);
  const googleCss = [...document.querySelectorAll<HTMLLinkElement>('link[href*="fonts.googleapis.com"]')].map((l) => l.href);
  return { faces, resources, preloads, googleCss };
}
