import { GENERIC_FAMILIES, classify, genericClassification, googleFamily, licenseFromCatalog } from '../shared/catalog';
import { formatFromUrl, sourceFromUrl } from '../shared/sources';
import type { Classification, FaceFile, LicenseType, Role, SourceKind } from '../shared/types';

export const OWN_FONT_PREFIX = 'FFP ';

// ---------------------------------------------------------------- font stacks

export function parseFamilyList(value: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quote: string | null = null;
  for (const ch of value) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === ',') {
      if (cur.trim()) out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

export function isGeneric(name: string): boolean {
  return GENERIC_FAMILIES.has(name.toLowerCase());
}

// ---------------------------------------------------------------- @font-face map

interface CssFace {
  family: string;
  url: string | null;
  format: string | null;
  weight: string;
  style: string;
  unicodeRange: string | null;
  sheetHost: string | null;
}

let cssFaces: CssFace[] = [];
let unreadableSheets: string[] = [];
let facesReady: Promise<void> | null = null;

function pickSrc(src: string, base: string): { url: string | null; format: string | null } {
  // src: url("a.woff2") format("woff2"), url(a.woff) format("woff"), local("X")
  const parts = src.split(/,(?![^(]*\))/);
  const candidates: { url: string; format: string | null }[] = [];
  for (const p of parts) {
    const u = p.match(/url\(\s*(['"]?)(.*?)\1\s*\)/);
    if (!u) continue;
    const f = p.match(/format\(\s*['"]?([^'")]+)['"]?\s*\)/);
    let abs = u[2];
    try {
      abs = new URL(u[2], base).href;
    } catch {
      /* keep as written */
    }
    candidates.push({ url: abs, format: formatFromUrl(abs, f ? f[1] : null) });
  }
  if (!candidates.length) return { url: null, format: null };
  const best = candidates.find((c) => c.format === 'woff2') ?? candidates[0];
  return best;
}

function cleanFamily(f: string): string {
  return f.trim().replace(/^['"]|['"]$/g, '').trim();
}

function walkRules(rules: CSSRuleList, base: string, host: string | null, out: CssFace[]) {
  for (const rule of Array.from(rules)) {
    if (rule instanceof CSSFontFaceRule) {
      const s = rule.style;
      const { url, format } = pickSrc(s.getPropertyValue('src'), base);
      out.push({
        family: cleanFamily(s.getPropertyValue('font-family')),
        url,
        format,
        weight: s.getPropertyValue('font-weight') || '400',
        style: s.getPropertyValue('font-style') || 'normal',
        unicodeRange: s.getPropertyValue('unicode-range') || null,
        sheetHost: host,
      });
    } else if (rule instanceof CSSImportRule) {
      try {
        if (rule.styleSheet?.cssRules) walkRules(rule.styleSheet.cssRules, rule.styleSheet.href ?? base, host, out);
      } catch {
        if (rule.href) unreadableSheets.push(new URL(rule.href, base).href);
      }
    } else if ('cssRules' in rule && (rule as CSSGroupingRule).cssRules) {
      walkRules((rule as CSSGroupingRule).cssRules, base, host, out);
    }
  }
}

/** Parse @font-face blocks out of raw CSS text (for stylesheets we cannot read through the CSSOM). */
function parseCssText(text: string, base: string, out: CssFace[], depth = 0): string[] {
  const imports: string[] = [];
  for (const m of text.matchAll(/@import\s+(?:url\()?\s*['"]?([^'")\s;]+)['"]?\s*\)?[^;]*;/g)) {
    try {
      imports.push(new URL(m[1], base).href);
    } catch {
      /* ignore */
    }
  }
  const host = safeHost(base);
  for (const m of text.matchAll(/@font-face\s*{([^}]*)}/g)) {
    const block = m[1];
    const get = (prop: string) => {
      const r = new RegExp(`(?:^|;|\\s)${prop}\\s*:\\s*([^;]+)`, 'i').exec(block);
      return r ? r[1].trim() : '';
    };
    const { url, format } = pickSrc(get('src'), base);
    out.push({
      family: cleanFamily(get('font-family')),
      url,
      format,
      weight: get('font-weight') || '400',
      style: get('font-style') || 'normal',
      unicodeRange: get('unicode-range') || null,
      sheetHost: host,
    });
  }
  return depth < 2 ? imports : [];
}

function safeHost(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

async function fetchCssText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { credentials: 'omit' });
    if (res.ok) return await res.text();
  } catch {
    /* CORS or network: try the background worker */
  }
  const reply = await new Promise<{ ok: boolean; text?: string } | null>((resolve) => {
    try {
      chrome.runtime.sendMessage({ type: 'ffp:fetch-bg', url, as: 'text' }, (r) => {
        if (chrome.runtime.lastError) resolve(null);
        else resolve(r);
      });
    } catch {
      resolve(null);
    }
  });
  return reply?.ok ? reply.text ?? null : null;
}

export function loadFaceMap(force = false): Promise<void> {
  if (facesReady && !force) return facesReady;
  facesReady = (async () => {
    const out: CssFace[] = [];
    unreadableSheets = [];
    for (const sheet of Array.from(document.styleSheets)) {
      const base = sheet.href ?? document.baseURI;
      try {
        walkRules(sheet.cssRules, base, sheet.href ? safeHost(sheet.href) : location.hostname, out);
      } catch {
        if (sheet.href) unreadableSheets.push(sheet.href);
      }
    }
    // Cross-origin stylesheets: read their text instead.
    const queue = [...new Set(unreadableSheets)];
    const seen = new Set<string>();
    const stillUnreadable: string[] = [];
    while (queue.length) {
      const href = queue.shift()!;
      if (seen.has(href)) continue;
      seen.add(href);
      const text = await fetchCssText(href);
      if (text == null) {
        stillUnreadable.push(href);
        continue;
      }
      queue.push(...parseCssText(text, href, out));
    }
    unreadableSheets = stillUnreadable;
    cssFaces = out;
  })();
  return facesReady;
}

export function facesFor(family: string): FaceFile[] {
  const lower = family.toLowerCase();
  const files: FaceFile[] = cssFaces
    .filter((f) => f.family.toLowerCase() === lower)
    .map((f) => ({ url: f.url, format: f.format, weight: f.weight, style: f.style, unicodeRange: f.unicodeRange }));
  // Attach load status from document.fonts and add faces created by script.
  for (const ff of fontFaceSet()) {
    if (cleanFamily(ff.family).toLowerCase() !== lower) continue;
    const match = files.find(
      (f) => f.weight === ff.weight && f.style === ff.style && (f.unicodeRange ?? 'U+0-10FFFF').toUpperCase() === ff.unicodeRange.toUpperCase(),
    );
    if (match) match.status = ff.status;
    else if (!files.some((f) => f.weight === ff.weight && f.style === ff.style)) {
      files.push({ url: null, format: null, weight: ff.weight, style: ff.style, unicodeRange: ff.unicodeRange, status: ff.status });
    }
  }
  return files;
}

function fontFaceSet(): FontFace[] {
  const out: FontFace[] = [];
  document.fonts.forEach((f) => {
    if (!f.family.replace(/['"]/g, '').startsWith(OWN_FONT_PREFIX)) out.push(f);
  });
  return out;
}

/** Where the family's files come from. */
export function sourceForFamily(family: string, kind: 'web' | 'local' | 'generic'): { source: SourceKind; host: string | null; fileUrl: string | null; format: string | null } {
  if (kind !== 'web') return { source: 'system', host: null, fileUrl: null, format: null };
  const files = facesFor(family);
  const withUrl = files.filter((f) => f.url);
  const best =
    withUrl.find((f) => f.status === 'loaded' && coversLatin(f.unicodeRange)) ??
    withUrl.find((f) => f.status === 'loaded') ??
    withUrl.find((f) => coversLatin(f.unicodeRange)) ??
    withUrl[0];
  if (best?.url) {
    const s = sourceFromUrl(best.url, location.hostname);
    return { source: s.kind, host: s.host, fileUrl: best.url, format: best.format };
  }
  // The family exists as a web font but we could not see its CSS.
  if (unreadableSheets.length === 1) {
    const s = sourceFromUrl(unreadableSheets[0], location.hostname);
    if (s.kind === 'adobe' || s.kind === 'google' || s.kind === 'bunny') return { source: s.kind, host: s.host, fileUrl: null, format: null };
  }
  return { source: files.length && files.every((f) => !f.url) && !cssFaces.some((c) => c.family.toLowerCase() === family.toLowerCase()) ? 'script' : 'unknown', host: null, fileUrl: null, format: null };
}

// ---------------------------------------------------------------- unicode ranges

function parseRanges(range: string | null): [number, number][] {
  if (!range) return [[0, 0x10ffff]];
  return range.split(',').map((part) => {
    const p = part.trim().replace(/^u\+/i, '');
    if (p.includes('?')) {
      return [parseInt(p.replace(/\?/g, '0'), 16), parseInt(p.replace(/\?/g, 'F'), 16)] as [number, number];
    }
    const [a, b] = p.split('-');
    const start = parseInt(a, 16);
    return [start, b ? parseInt(b, 16) : start] as [number, number];
  });
}

function coversLatin(range: string | null): boolean {
  return parseRanges(range).some(([a, b]) => a <= 0x41 && b >= 0x41);
}

function coversText(range: string, text: string): boolean {
  const ranges = parseRanges(range);
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp <= 0x20) continue;
    if (ranges.some(([a, b]) => cp >= a && cp <= b)) return true;
  }
  return false;
}

// ---------------------------------------------------------------- local availability

const canvas = document.createElement('canvas');
const ctx = canvas.getContext('2d')!;
const PROBES = ['mmmmmmmmmmlli', 'WQ@#%&1234567890', 'Hamburgefonstiv'];
const widthCache = new Map<string, number[]>();

function widths(fontFamilyCss: string, weight = '400', style = 'normal'): number[] {
  const key = `${style}|${weight}|${fontFamilyCss}`;
  const hit = widthCache.get(key);
  if (hit) return hit;
  ctx.font = `${style} ${weight} 72px ${fontFamilyCss}`;
  const w = PROBES.map((p) => ctx.measureText(p).width);
  widthCache.set(key, w);
  return w;
}

const localCache = new Map<string, boolean>();

export function isLocallyAvailable(family: string): boolean {
  const key = family.toLowerCase();
  const hit = localCache.get(key);
  if (hit !== undefined) return hit;
  const q = JSON.stringify(family);
  const available = ['monospace', 'serif', 'sans-serif'].some((g) => {
    const base = widths(g);
    const test = widths(`${q}, ${g}`);
    return test.some((w, i) => Math.abs(w - base[i]) > 0.01);
  });
  localCache.set(key, available);
  return available;
}

const PLATFORM = /mac/i.test(navigator.platform) ? 'mac' : /win/i.test(navigator.platform) ? 'win' : 'linux';
const BY_PLATFORM: Record<string, Record<string, string[]>> = {
  mac: { 'sans-serif': ['Helvetica'], serif: ['Times'], monospace: ['Courier', 'Menlo'], 'system-ui': [] },
  win: { 'sans-serif': ['Arial'], serif: ['Times New Roman'], monospace: ['Courier New', 'Consolas'], 'system-ui': ['Segoe UI Variable', 'Segoe UI'] },
  linux: { 'sans-serif': ['DejaVu Sans', 'Liberation Sans', 'Noto Sans'], serif: ['DejaVu Serif', 'Liberation Serif', 'Noto Serif'], monospace: ['DejaVu Sans Mono', 'Liberation Mono', 'Noto Sans Mono'], 'system-ui': ['Cantarell', 'Ubuntu', 'DejaVu Sans', 'Noto Sans', 'Liberation Sans'] },
};

const GENERIC_CANDIDATES: Record<string, string[]> = {
  'sans-serif': ['Helvetica', 'Arial', 'Liberation Sans', 'DejaVu Sans', 'Roboto', 'Noto Sans', 'Verdana'],
  serif: ['Times', 'Times New Roman', 'Liberation Serif', 'DejaVu Serif', 'Noto Serif', 'Georgia'],
  monospace: ['Menlo', 'Courier', 'Courier New', 'Consolas', 'Liberation Mono', 'DejaVu Sans Mono', 'Noto Sans Mono'],
  cursive: ['Apple Chancery', 'Comic Sans MS', 'Comic Neue'],
  fantasy: ['Papyrus', 'Impact'],
  'system-ui': ['Segoe UI Variable', 'Segoe UI', 'Roboto', 'Ubuntu', 'Cantarell', 'Noto Sans', 'DejaVu Sans', 'Helvetica Neue'],
};

const genericCache = new Map<string, string | null>();

/** Find which installed font a generic family name maps to, by comparing measured widths. */
export function resolveGeneric(generic: string): string | null {
  const g = generic.toLowerCase();
  const key = ['-apple-system', 'blinkmacsystemfont', 'ui-sans-serif'].includes(g) ? 'system-ui' : g;
  if (genericCache.has(key)) return genericCache.get(key)!;
  const candidates = [...(BY_PLATFORM[PLATFORM][key] ?? []), ...(GENERIC_CANDIDATES[key] ?? [])];
  const base = widths(key === 'system-ui' ? 'system-ui' : key);
  let found: string | null = null;
  for (const c of candidates) {
    if (!isLocallyAvailable(c)) continue;
    const w = widths(JSON.stringify(c));
    if (w.every((x, i) => Math.abs(x - base[i]) < 0.01)) {
      found = c;
      break;
    }
  }
  if (!found && key === 'system-ui' && PLATFORM === 'mac') found = 'San Francisco';
  genericCache.set(key, found);
  return found;
}

// ---------------------------------------------------------------- rendered font

export interface Rendered {
  family: string;
  kind: 'web' | 'local' | 'generic';
  genericName?: string;
  declared: string[];
  fellBackFrom: string[];
  /** Families in fellBackFrom that were declared as web fonts but did not load. */
  failedWeb: string[];
}

const renderedCache = new Map<string, Rendered>();

export function clearRenderCache() {
  renderedCache.clear();
  localCache.clear();
  widthCache.clear();
  genericCache.clear();
}

/** Work out which family in the stack the browser actually used for this text. */
export function resolveRendered(fontFamily: string, weight: string, style: string, text: string): Rendered {
  const sample = text.slice(0, 200);
  const key = `${fontFamily}|${weight}|${style}|${sample.replace(/[\x00-\x7f]/g, '').slice(0, 20)}`;
  const hit = renderedCache.get(key);
  if (hit) return hit;
  const declared = parseFamilyList(fontFamily);
  const skipped: string[] = [];
  const failedWeb: string[] = [];
  const faces = fontFaceSet();
  let result: Rendered | null = null;

  for (const fam of declared) {
    if (isGeneric(fam)) {
      const resolved = resolveGeneric(fam);
      result = resolved
        ? { family: resolved, kind: 'local', genericName: fam, declared, fellBackFrom: skipped, failedWeb }
        : { family: `System ${fam}`, kind: 'generic', genericName: fam, declared, fellBackFrom: skipped, failedWeb };
      break;
    }
    const lower = fam.toLowerCase();
    const web = faces.filter((f) => cleanFamily(f.family).toLowerCase() === lower);
    if (web.length) {
      const usable = web.filter((f) => (f.status === 'loaded' || f.status === 'loading') && coversText(f.unicodeRange, sample || 'A'));
      if (usable.length) {
        result = { family: cleanFamily(web[0].family), kind: 'web', declared, fellBackFrom: skipped, failedWeb };
        break;
      }
      // Declared as a web font but nothing usable loaded. Could still be installed locally.
      if (isLocallyAvailable(fam) && !web.some((f) => f.status === 'loaded')) {
        result = { family: fam, kind: 'local', declared, fellBackFrom: skipped, failedWeb };
        break;
      }
      skipped.push(fam);
      failedWeb.push(fam);
      continue;
    }
    if (isLocallyAvailable(fam)) {
      result = { family: fam, kind: 'local', declared, fellBackFrom: skipped, failedWeb };
      break;
    }
    skipped.push(fam);
  }
  if (!result) {
    // Nothing in the stack matched: the browser default (usually serif) is used.
    const resolved = resolveGeneric('serif');
    result = resolved
      ? { family: resolved, kind: 'local', genericName: 'browser default', declared, fellBackFrom: skipped, failedWeb }
      : { family: 'Browser default', kind: 'generic', genericName: 'serif', declared, fellBackFrom: skipped, failedWeb };
  }
  renderedCache.set(key, result);
  return result;
}

// ---------------------------------------------------------------- roles, metrics

export function roleOf(el: Element): Role {
  if (el.closest('h1,h2,h3,h4,h5,h6,[role="heading"]')) return 'heading';
  if (el.closest('button,[role="button"],input[type="submit"],input[type="button"],input[type="reset"]')) return 'button';
  if (el.closest('code,pre,kbd,samp')) return 'code';
  if (el.closest('nav,[role="navigation"]')) return 'nav';
  if (el.closest('a[href]')) return 'link';
  if (el.closest('figcaption,caption,small,label,sup,sub,legend')) return 'caption';
  return 'body';
}

export function elementLabel(el: Element): string {
  const h = el.closest('h1,h2,h3,h4,h5,h6');
  if (h) return h.tagName;
  return el.tagName.toUpperCase();
}

/** Measure cap height and x-height of the rendered font at a given size, in px. */
export function measureMetrics(familyCss: string, weight: string, style: string, sizePx: number): { cap: number; x: number; descent: number } {
  ctx.font = `${style} ${weight} 100px ${familyCss}`;
  const H = ctx.measureText('H');
  const x = ctx.measureText('x');
  const g = ctx.measureText('g');
  const k = sizePx / 100;
  return {
    cap: H.actualBoundingBoxAscent * k,
    x: x.actualBoundingBoxAscent * k,
    descent: g.actualBoundingBoxDescent * k,
  };
}

export function familyCss(r: Rendered): string {
  if (r.kind === 'generic') return r.genericName && r.genericName !== 'browser default' ? r.genericName : 'serif';
  return JSON.stringify(r.family);
}

export function fontFacts(r: Rendered): { source: SourceKind; host: string | null; fileUrl: string | null; format: string | null; classification: Classification; licenseType: LicenseType; designers: string[] } {
  const src = sourceForFamily(r.family, r.kind);
  const classification = r.kind === 'generic' ? genericClassification(r.genericName ?? 'serif') : classify(r.family, src.source);
  return {
    ...src,
    classification,
    licenseType: r.kind === 'generic' ? 'system' : licenseFromCatalog(r.family, src.source),
    designers: googleFamily(r.family)?.d ?? [],
  };
}
