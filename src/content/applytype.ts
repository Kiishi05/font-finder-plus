// Set type styles on the real page (Use with my fonts, Paste type from Figma),
// and put it back. Like swap.ts: fonts are added with the FontFace API from
// bytes (so the page's security rules do not block them) and the values are
// inline styles, kept so undo restores exactly what was there.
import { base64ToArrayBuffer, type ApplyTypeFace, type ApplyTypeReply, type ApplyTypeStyle } from '../shared/messages';
import { measureTypeMetrics } from '../shared/typemeasure';
import type { TypeMetrics } from '../shared/typeadapt';
import { elementsForIssue } from './system';
import { familyOf, ownText } from './scan';

const PROPS = ['font-family', 'font-weight', 'font-size', 'line-height', 'letter-spacing', 'text-transform', 'font-size-adjust', 'font-variation-settings'] as const;
const saved = new Map<HTMLElement, Record<string, [string, string]>>();
/** Elements where this file set data-ffp-orig (so scans still see the page's own font). */
const marked = new Set<HTMLElement>();
const loaded = new Map<string, Promise<string | null>>();
let seq = 0;

const GENERIC = /^(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-serif|ui-sans-serif|ui-monospace)$/i;
const quote = (f: string) => (GENERIC.test(f) ? f : `"${f.replace(/["\\]/g, '')}"`);

// ------------------------------------------------------------- fonts

interface CssFace { url: string; weight: string; style: string; unicodeRange: string | null; subset: string }

function parseCss(css: string): CssFace[] {
  const out: CssFace[] = [];
  const re = /(?:\/\*\s*([\w-]+)\s*\*\/\s*)?@font-face\s*{([^}]*)}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) {
    const body = m[2];
    let url = /url\(['"]?((?:https:)?\/\/[^'")]+)['"]?\)/.exec(body)?.[1];
    if (url?.startsWith('//')) url = `https:${url}`;
    if (!url) continue;
    out.push({
      url,
      subset: m[1] ?? 'latin',
      style: /font-style:\s*([^;]+);/.exec(body)?.[1].trim() ?? 'normal',
      weight: /font-weight:\s*([^;]+);/.exec(body)?.[1].trim() ?? '400',
      unicodeRange: /unicode-range:\s*([^;]+);/.exec(body)?.[1].trim() ?? null,
    });
  }
  return out.filter((f) => /^(latin|latin-ext|vietnamese)$/.test(f.subset));
}

/** Fetch from the page; if the site blocks it, ask the background worker (needs all-sites access). */
async function get(url: string, as: 'text' | 'bytes'): Promise<string | ArrayBuffer | null> {
  try {
    const res = await fetch(url, { credentials: 'omit' });
    if (res.ok) return as === 'text' ? await res.text() : await res.arrayBuffer();
  } catch {
    /* try the background */
  }
  const r = await new Promise<{ ok: boolean; text?: string; base64?: string } | null>((resolve) => {
    try {
      chrome.runtime.sendMessage({ type: 'ffp:fetch-bg', url, as: as === 'text' ? 'text' : 'base64' }, (reply) => resolve(chrome.runtime.lastError ? null : reply ?? null));
    } catch {
      resolve(null);
    }
  });
  if (!r?.ok) return null;
  return as === 'text' ? r.text ?? null : r.base64 ? base64ToArrayBuffer(r.base64) : null;
}

async function addFaces(alias: string, faces: { data: ArrayBuffer; weight: string; style: string; unicodeRange: string | null }[]): Promise<boolean> {
  let any = false;
  await Promise.all(
    faces.map(async (f) => {
      try {
        const desc: FontFaceDescriptors = { weight: f.weight, style: f.style };
        if (f.unicodeRange) desc.unicodeRange = f.unicodeRange;
        const face = new FontFace(alias, f.data, desc);
        await face.load();
        document.fonts.add(face);
        any = true;
      } catch {
        /* skip this face */
      }
    }),
  );
  return any;
}

/** A font-family value that draws the style's font, loading it first when files or a stylesheet are given. */
async function familyFor(st: ApplyTypeStyle): Promise<{ css: string; loaded: boolean }> {
  const fam = st.family!.trim();
  const tail = [quote(fam), st.generic ?? 'sans-serif'].join(', ');
  // One load per family: later styles in the same family can leave out the files.
  const key = fam.toLowerCase();
  let p = loaded.get(key);
  if (!p && (st.faces?.length || st.fontUrlCss)) {
    p = (async () => {
      const alias = `FFP Type ${++seq}`;
      if (st.faces?.length) {
        const ok = await addFaces(alias, st.faces.map((f: ApplyTypeFace) => ({ data: base64ToArrayBuffer(f.base64), weight: f.weight, style: f.style, unicodeRange: f.unicodeRange })));
        return ok ? alias : null;
      }
      if (st.fontUrlCss && /^https:\/\//.test(st.fontUrlCss)) {
        const css = await get(st.fontUrlCss, 'text');
        if (typeof css !== 'string') return null;
        const faces = parseCss(css).slice(0, 40);
        const files = await Promise.all(faces.map(async (f) => ({ ...f, data: (await get(f.url, 'bytes')) as ArrayBuffer | null })));
        const ok = await addFaces(alias, files.filter((f): f is typeof f & { data: ArrayBuffer } => f.data instanceof ArrayBuffer));
        return ok ? alias : null;
      }
      return null;
    })();
    loaded.set(key, p);
    // A failed load can be tried again later.
    p.then((a) => !a && loaded.delete(key));
  }
  const alias = p ? await p : null;
  if (alias) return { css: `"${alias}", ${tail}`, loaded: true };
  // No files: the font may be installed on this computer or already used by the page.
  let ok = false;
  try {
    ok = document.fonts.check(`16px ${quote(fam)}`) && [...document.fonts].some((f) => f.family.replace(/['"]/g, '') === fam);
  } catch {
    ok = false;
  }
  return { css: tail, loaded: ok || localFont(fam) };
}

/** Is the family drawn by an installed font (its shape differs from the fallbacks)? */
function localFont(family: string): boolean {
  const c = document.createElement('canvas').getContext('2d');
  if (!c) return false;
  const sample = 'mmmmmmmmmmlli WWW 0123456789';
  for (const fb of ['monospace', 'serif', 'sans-serif']) {
    c.font = `72px ${fb}`;
    const base = c.measureText(sample).width;
    c.font = `72px ${quote(family)}, ${fb}`;
    if (Math.abs(c.measureText(sample).width - base) > 0.5) return true;
  }
  return false;
}

// ------------------------------------------------------------- where each role goes

const SELECTORS: Record<string, string> = {
  h1: 'h1', h2: 'h2', h3: 'h3', h4: 'h4', h5: 'h5', h6: 'h6',
  display: 'h1, [class*="display"], [class*="hero"] h1',
  lead: '[class*="lead"], [class*="lede"], [class*="intro"], [class*="subtitle"], [class*="subhead"]',
  body: 'p, li, dd, blockquote, td, th',
  small: 'small, [class*="small"], [class*="meta"], [class*="fine"]',
  caption: 'figcaption, caption, [class*="caption"]',
  label: 'label, [class*="eyebrow"], [class*="kicker"], [class*="overline"], [class*="label"], [class*="tag"]',
  button: 'button, [role="button"], input[type="submit"], input[type="button"], a[class*="btn"], a[class*="button"]',
  link: 'a',
  nav: 'nav a, nav li',
  code: 'code, pre, kbd, samp',
};

function isOurs(el: Element): boolean {
  return !!el.closest('#ffp-root, [data-ffp-ui]');
}

function elementsFor(st: ApplyTypeStyle): HTMLElement[] {
  if (st.styleId) {
    const exact = elementsForIssue(`style:${st.styleId}`).filter((e): e is HTMLElement => e instanceof HTMLElement && e.isConnected);
    if (exact.length) return exact;
  }
  const role = String(st.selectorRole || 'none').toLowerCase();
  if (role === 'none') return [];
  const sel = SELECTORS[role];
  let els: HTMLElement[] = sel ? [...document.querySelectorAll<HTMLElement>(sel)] : [];
  if (role === 'body') els = els.filter((e) => !e.closest('nav, header nav, button, h1, h2, h3, h4, h5, h6') && (e.textContent ?? '').trim().length > 0);
  if (role === 'link') els = els.filter((e) => !e.closest('nav'));
  if (role === 'label') {
    // Short all-caps text is a label too ("NEW", "ESSAY · 12 MIN READ").
    const caps = [...document.body.querySelectorAll<HTMLElement>('span, div, p, a, small, strong, b')].slice(0, 6000).filter((e) => {
      const t = ownText(e);
      return t.length > 0 && t.length < 60 && getComputedStyle(e).textTransform === 'uppercase';
    });
    els = [...new Set([...els, ...caps])];
  }
  return els.filter((e) => !isOurs(e) && (e.textContent ?? '').trim().length > 0);
}

// ------------------------------------------------------------- apply and undo

function remember(el: HTMLElement) {
  if (saved.has(el)) return;
  const props: Record<string, [string, string]> = {};
  for (const p of PROPS) props[p] = [el.style.getPropertyValue(p), el.style.getPropertyPriority(p)];
  saved.set(el, props);
  if (!el.hasAttribute('data-ffp-orig')) {
    el.setAttribute('data-ffp-orig', familyOf(el, getComputedStyle(el)));
    marked.add(el);
  }
}

export function undoType(): void {
  for (const [el, props] of saved) {
    for (const p of PROPS) {
      const [v, pr] = props[p];
      if (v) el.style.setProperty(p, v, pr);
      else el.style.removeProperty(p);
    }
    el.removeAttribute('data-ffp-type');
    if (marked.has(el)) el.removeAttribute('data-ffp-orig');
  }
  saved.clear();
  marked.clear();
}

export async function applyType(styles: ApplyTypeStyle[], on: boolean): Promise<ApplyTypeReply> {
  undoType();
  if (!on) return { ok: true, applied: [] };
  const applied: ApplyTypeReply['applied'] = [];
  const fams = await Promise.all(styles.map((st) => (st.family ? familyFor(st) : Promise.resolve(null))));
  styles.forEach((st, i) => {
    const els = elementsFor(st);
    const fam = fams[i];
    for (const el of els) {
      remember(el);
      if (fam) {
        el.style.setProperty('font-family', fam.css, 'important');
        el.style.setProperty('font-size-adjust', 'none', 'important');
        el.style.setProperty('font-variation-settings', 'normal', 'important');
      }
      if (st.weight != null) el.style.setProperty('font-weight', String(st.weight), 'important');
      if (st.size) el.style.setProperty('font-size', `${st.size}px`, 'important');
      if (st.lineHeight) el.style.setProperty('line-height', `${st.lineHeight}px`, 'important');
      if (st.letterSpacing != null) el.style.setProperty('letter-spacing', `${st.letterSpacing}em`, 'important');
      if (st.textTransform) el.style.setProperty('text-transform', st.textTransform, 'important');
      el.setAttribute('data-ffp-type', st.name ?? String(st.selectorRole));
    }
    applied.push({ name: st.name, role: String(st.selectorRole), count: els.length, fontLoaded: fam ? fam.loaded : true });
  });
  return { ok: true, applied };
}

export const typeApplied = () => saved.size > 0;

// ------------------------------------------------------------- measuring the page's fonts

/** Proportions of fonts as this page draws them (after loading them). */
export async function pageTypeMetrics(fonts: { family: string; weight: string; style: string }[]): Promise<(TypeMetrics | null)[]> {
  return Promise.all(
    fonts.map(async (f) => {
      const css = quote(f.family);
      await document.fonts.load(`${f.style} ${f.weight} 40px ${css}`, 'xHdpabcmi').catch(() => undefined);
      return measureTypeMetrics(css, f.weight, f.style);
    }),
  );
}
