// Builds what "Send to Figma" copies: every font on the page with its licence,
// where to get it, its closest free stand-in and a preview, plus the page's
// text styles. Everything is worked out here, on this computer.
import { googleFontsUrl } from '../../shared/catalog';
import { FIGMA_MARK, serializePayload, type FigmaFont, type FigmaPayload, type FigmaPreview, type FigmaStyle } from '../../shared/figma-payload';
import { knownFont, summaryFor } from '../../shared/licences';
import { sendToTab } from '../../shared/messages';
import { db } from '../../shared/db';
import { bestFileUrl, fontId } from '../../shared/records';
import type { PageFontUsage, PageScan, SystemScan } from '../../shared/types';
import { getFontBytes, outlineText } from './fonts';
import { freeLookalikes } from './lookalike';
import { organizeStyles } from '../../shared/styleguide';
import { detectScale, nameStyles } from './system';

const SOURCE_NAME: Record<string, string> = { google: 'Google Fonts', adobe: 'Adobe Fonts', 'self-hosted': 'the site', system: 'your computer' };

async function previewFor(f: PageFontUsage, text: string, tabId: number): Promise<FigmaPreview | null> {
  const url = f.kind === 'web' ? bestFileUrl(f, '400') : null;
  if (url) {
    try {
      const o = await outlineText(await getFontBytes(url, tabId), text, 48);
      return { kind: 'svg', ...o };
    } catch {
      /* fall back to how the page draws it */
    }
  }
  const r = await sendToTab<{ ok: boolean; png?: string; width?: number; height?: number }>(
    tabId,
    { type: 'ffp:specimen', family: f.family, weight: '400', style: 'normal', text },
    8000,
  );
  return r?.ok && r.png ? { kind: 'png', data: r.png, width: r.width ?? 0, height: r.height ?? 0 } : null;
}

async function fontFor(f: PageFontUsage, tabId: number): Promise<FigmaFont> {
  const rec = await db.fonts.get(fontId(f.family, f.source)).catch(() => undefined);
  const name = rec?.displayName ?? f.displayName ?? f.family;
  const lic = rec?.licenseType ?? f.licenseType;
  const known = knownFont(name) ?? knownFont(f.family);
  const sum = summaryFor(lic, known, f.source);
  const catalogFamily = rec?.catalogFamily ?? f.catalogFamily;
  let getIt: FigmaFont['getIt'] = null;
  if (catalogFamily) getIt = { label: 'Google Fonts (free)', url: googleFontsUrl(catalogFamily) };
  else if (known) getIt = { label: known.by, url: known.url };
  else if (sum.url) getIt = { label: sum.name, url: sum.url };

  let standIn: FigmaFont['standIn'] = null;
  let alternatives: FigmaFont['alternatives'] = [];
  // Free look-alikes. Google fonts get them too: Figma's own Google Fonts list can lag behind.
  const look = await freeLookalikes({ fontId: fontId(f.family, f.source), family: f.family, catalogFamily, files: f.files, kind: f.kind, classification: f.classification, weight: f.sample.fontWeight, style: f.sample.fontStyle, onPage: true }, tabId);
  const m = look?.matches ?? [];
  if (m[0]) standIn = { family: m[0].family, score: m[0].score, reason: m[0].reason };
  alternatives = m.slice(1).map((x) => ({ family: x.family, score: x.score }));

  const previewText = name.length > 30 ? name.slice(0, 30) : name;
  return {
    key: f.key,
    name,
    cssFamily: f.family,
    catalogFamily,
    classification: rec?.classification ?? f.classification,
    kind: f.kind === 'local' ? 'local' : 'web',
    licence: { type: lic, name: sum.name, short: sum.short, url: sum.url },
    source: SOURCE_NAME[f.source] ?? f.source,
    host: f.sourceHost ?? null,
    foundry: rec?.foundry ?? rec?.parsed?.manufacturer ?? known?.by ?? null,
    designers: rec?.designers?.length ? rec.designers : f.designers ?? [],
    getIt,
    weights: f.weights,
    italic: f.styles.some((s) => s !== 'normal'),
    roles: Object.keys(f.roles),
    elements: f.elementCount,
    standIn,
    alternatives,
    preview: await previewFor(f, previewText, tabId).catch(() => null),
    previewText,
  };
}

/** Everything the Figma plugin needs, as the text to paste. */
export async function buildFigmaPayload(scan: PageScan, tabId: number, system?: SystemScan | null): Promise<{ text: string; payload: FigmaPayload }> {
  let sys = system ?? null;
  if (!sys) {
    const r = await sendToTab<{ ok: boolean; system?: SystemScan }>(tabId, { type: 'ffp:system' }, 30000);
    sys = r?.ok && r.system ? r.system : null;
  }
  const named = sys ? nameStyles(sys.styles) : [];
  const usedKeys = new Set(named.map((s) => s.fontKey));
  const fonts = scan.fonts.filter((f) => f.kind !== 'generic' && (f.elementCount > 0 || usedKeys.has(f.key)));
  // One entry per font: a family used in two ways (say body and code) is listed once.
  const out: FigmaFont[] = [];
  const alias = new Map<string, string>();
  for (const f of fonts) {
    const ff = await fontFor(f, tabId);
    const same = out.find((o) => o.name.toLowerCase() === ff.name.toLowerCase());
    if (same) {
      alias.set(ff.key, same.key);
      same.roles = [...new Set([...same.roles, ...ff.roles])];
      same.weights = [...new Set([...same.weights, ...ff.weights])].sort();
      same.elements += ff.elements;
      same.italic ||= ff.italic;
    } else out.push(ff);
  }
  const byKey = new Map(out.map((f) => [f.key, f]));
  for (const [from, to] of alias) byKey.set(from, byKey.get(to)!);
  const all: FigmaStyle[] = named
    .filter((s) => byKey.has(s.fontKey))
    .map((s) => ({
      name: s.name,
      fontKey: byKey.get(s.fontKey)!.key,
      fontName: byKey.get(s.fontKey)!.name,
      cssFamily: s.family,
      weight: s.weight,
      style: s.style,
      size: s.size,
      lineHeight: s.lineHeight,
      letterSpacing: s.letterSpacing,
      transform: s.transform,
      sample: s.sample,
      count: s.count,
    }));
  // A tidy system: near-duplicates merged, grouped and named like a style guide.
  const styles: FigmaStyle[] = organizeStyles(all);
  const scale = named.length ? detectScale(named) : null;
  const payload: FigmaPayload = {
    mark: FIGMA_MARK,
    version: 1,
    site: { host: scan.host, url: scan.url, title: scan.title },
    scannedAt: new Date().toISOString(),
    fonts: out,
    styles,
    scale: scale?.ratio && scale.label ? { ratio: scale.ratio, name: scale.label } : null,
  };
  return { text: serializePayload(payload), payload };
}
