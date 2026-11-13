// Font Finder Plus for Figma. Takes what the browser extension copied (a
// website's fonts and text styles), shows which fonts this Figma has, and builds
// text styles, variables and a specimen page. Free stand-ins fill in for fonts
// that are not installed; "Check again" swaps the real fonts in once they are.
import type { FigmaFont, FigmaPayload, FigmaStyle } from '../../src/shared/figma-payload';
import { familyIndex, findFamily, pickStyle, slug, textCase, type AvailableFont } from './match';
import { findMissing, replaceMissing, restoreOriginals, textLayers } from './fix';

declare const __html__: string;

type Index = ReturnType<typeof familyIndex>;
interface Choice { key: string; family: string | null }
interface Opts { styles: boolean; variables: boolean; specimen: boolean }
interface Saved { realNames: string[]; weight: string; italic: boolean; site: string; font: string }

const UI_FAMILY = 'Inter';
const FALLBACKS: Record<string, string[]> = {
  mono: ['Roboto Mono', 'Source Code Pro', 'IBM Plex Mono', 'Geist Mono', 'JetBrains Mono', 'Courier New'],
  serif: ['Source Serif 4', 'Merriweather', 'Lora', 'Georgia', 'Times New Roman'],
  script: ['Dancing Script', 'Pacifico'],
};
const TIMEOUT = 8000;

figma.showUI(__html__, { width: 420, height: 640, themeColors: true });

let index: Index | null = null;
let lastPayload: FigmaPayload | null = null;
async function getIndex(fresh = false): Promise<Index> {
  if (!index || fresh) index = familyIndex((await figma.listAvailableFontsAsync()).map((f) => f.fontName as AvailableFont));
  return index;
}

/** loadFontAsync with a time limit (it can hang on fonts that are not available). */
async function load(font: FontName): Promise<boolean> {
  try {
    await Promise.race([figma.loadFontAsync(font), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), TIMEOUT))]);
    return true;
  } catch {
    return false;
  }
}

const namesOf = (f: FigmaFont) => [f.name, f.cssFamily, f.catalogFamily];

/** What this Figma has for each font: the real family, and which stand-ins. */
async function check(p: FigmaPayload) {
  const ix = await getIndex(true);
  const status: Record<string, { real: string | null; standIns: Record<string, boolean> }> = {};
  for (const f of p.fonts) {
    const real = findFamily(ix, namesOf(f));
    const standIns: Record<string, boolean> = {};
    for (const s of [f.standIn?.family, ...f.alternatives.map((a) => a.family)]) if (s) standIns[s] = !!findFamily(ix, [s]);
    status[f.key] = { real: real?.family ?? null, standIns };
  }
  return status;
}

let uiFonts: { regular: FontName; medium: FontName; bold: FontName } | null = null;
async function loadUiFonts() {
  if (uiFonts) return uiFonts;
  const ix = await getIndex();
  const inter = findFamily(ix, [UI_FAMILY]);
  const fam = inter ? inter.family : 'Inter';
  const styles = inter?.styles ?? ['Regular', 'Medium', 'Bold'];
  const f = (w: number): FontName => ({ family: fam, style: pickStyle(styles, w, false) ?? 'Regular' });
  uiFonts = { regular: f(400), medium: f(500), bold: f(700) };
  await Promise.all([load(uiFonts.regular), load(uiFonts.medium), load(uiFonts.bold)]);
  return uiFonts;
}

/** The family to use for a font: the real one if installed, else the chosen stand-in, else Inter. */
function familyFor(f: FigmaFont, ix: Index, chosen: string | null): { family: string; styles: string[]; real: boolean } {
  const real = findFamily(ix, namesOf(f));
  if (real) return { ...real, real: true };
  const stand = findFamily(ix, [chosen, f.standIn?.family, ...f.alternatives.map((a) => a.family)]);
  if (stand) return { ...stand, real: false };
  // Nothing close is installed: at least keep the kind of font.
  const backup = findFamily(ix, FALLBACKS[f.classification] ?? []);
  if (backup) return { ...backup, real: false };
  return { ...(findFamily(ix, [UI_FAMILY]) ?? { family: UI_FAMILY, styles: ['Regular', 'Bold'] }), real: false };
}

function text(chars: string, font: FontName, size: number, opts: { color?: RGB; width?: number; link?: string } = {}): TextNode {
  const t = figma.createText();
  t.fontName = font;
  t.fontSize = size;
  t.characters = chars;
  if (opts.color) t.fills = [{ type: 'SOLID', color: opts.color }];
  if (opts.width) {
    t.textAutoResize = 'HEIGHT';
    t.resize(opts.width, t.height);
  }
  if (opts.link) t.setRangeHyperlink(0, chars.length, { type: 'URL', value: opts.link });
  return t;
}

function column(name: string, gap: number, pad: number): FrameNode {
  const fr = figma.createFrame();
  fr.name = name;
  fr.layoutMode = 'VERTICAL';
  fr.primaryAxisSizingMode = 'AUTO';
  fr.counterAxisSizingMode = 'AUTO';
  fr.itemSpacing = gap;
  fr.paddingTop = fr.paddingBottom = fr.paddingLeft = fr.paddingRight = pad;
  return fr;
}

const GREY = { r: 0.38, g: 0.4, b: 0.45 };
const INK = { r: 0.07, g: 0.08, b: 0.1 };
const OK = { r: 0.08, g: 0.48, b: 0.29 };
const WARN = { r: 0.6, g: 0.38, b: 0 };

const lhText = (s: FigmaStyle) => (s.lineHeight ? `${Math.round(s.size)}/${Math.round(s.lineHeight)}` : `${Math.round(s.size)}/auto`);

async function build(p: FigmaPayload, choices: Choice[], opts: Opts) {
  const ix = await getIndex(true);
  const ui = await loadUiFonts();
  const chosen = new Map(choices.map((c) => [c.key, c.family]));
  const used = new Map<string, { family: string; styles: string[]; real: boolean }>();
  for (const f of p.fonts) used.set(f.key, familyFor(f, ix, chosen.get(f.key) ?? null));
  const byKey = new Map(p.fonts.map((f) => [f.key, f]));
  const site = p.site.host;
  const progress = (msg: string) => figma.ui.postMessage({ type: 'progress', msg });

  // Variables: one collection per site, sizes and line heights bound to the styles.
  let collection: VariableCollection | null = null;
  const vars = new Map<string, Variable>();
  if (opts.variables) {
    try {
      const name = `Typography · ${site}`;
      collection = (await figma.variables.getLocalVariableCollectionsAsync()).find((c) => c.name === name) ?? figma.variables.createVariableCollection(name);
      const existing = await figma.variables.getLocalVariablesAsync();
      const getVar = (n: string, type: VariableResolvedDataType, scopes: VariableScope[]) => {
        let v = existing.find((x) => x.name === n && x.variableCollectionId === collection!.id) ?? null;
        if (!v) {
          v = figma.variables.createVariable(n, collection!, type);
          v.scopes = scopes;
        }
        vars.set(n, v);
        return v;
      };
      const mode = collection.modes[0].modeId;
      for (const f of p.fonts) {
        const u = used.get(f.key)!;
        const v = getVar(`font/${slug(f.name)}`, 'STRING', ['FONT_FAMILY']);
        v.setValueForMode(mode, u.family);
        v.description = u.real ? `${f.name} (installed).` : `${f.name} is not installed. ${u.family} stands in for it.`;
      }
      for (const s of p.styles) {
        getVar(`size/${slug(s.name)}`, 'FLOAT', ['FONT_SIZE']).setValueForMode(mode, Math.round(s.size * 100) / 100);
        if (s.lineHeight) getVar(`line-height/${slug(s.name)}`, 'FLOAT', ['LINE_HEIGHT']).setValueForMode(mode, Math.round(s.lineHeight * 100) / 100);
      }
    } catch (err) {
      collection = null;
      progress(`Variables were skipped: ${String((err as Error)?.message ?? err)}`);
    }
  }

  // Text styles named after the site: "example.com/h1".
  const styleIds = new Map<string, string>();
  let made = 0;
  if (opts.styles) {
    const local = await figma.getLocalTextStylesAsync();
    for (const s of p.styles) {
      const f = byKey.get(s.fontKey);
      if (!f) continue;
      const u = used.get(f.key)!;
      const italic = s.style !== 'normal';
      const font: FontName = { family: u.family, style: pickStyle(u.styles, s.weight, italic) ?? 'Regular' };
      if (!(await load(font))) continue;
      const name = `${site}/${slug(s.name)}`;
      const st = local.find((x) => x.name === name) ?? figma.createTextStyle();
      st.name = name;
      st.fontName = font;
      st.fontSize = Math.round(s.size * 100) / 100;
      st.lineHeight = s.lineHeight ? { unit: 'PIXELS', value: Math.round(s.lineHeight * 100) / 100 } : { unit: 'AUTO' };
      st.letterSpacing = { unit: 'PIXELS', value: Math.round(s.letterSpacing * 100) / 100 };
      st.textCase = textCase(s.transform);
      st.description = u.real
        ? `${f.name} ${s.weight}${italic ? ' italic' : ''}, ${lhText(s)}. From ${site}.`
        : `Real font: ${f.name} ${s.weight}${italic ? ' italic' : ''} (not installed). Stand-in: ${font.family} ${font.style}. From ${site}. Run Font Finder Plus > Check again after installing it.`;
      const saved: Saved = { realNames: namesOf(f).filter((x): x is string => !!x), weight: s.weight, italic, site, font: f.name };
      st.setPluginData('ffp', JSON.stringify(saved));
      if (collection) {
        try {
          const size = vars.get(`size/${slug(s.name)}`);
          if (size) st.setBoundVariable('fontSize', size);
          const lh = vars.get(`line-height/${slug(s.name)}`);
          if (lh) st.setBoundVariable('lineHeight', lh);
        } catch {
          /* binding is optional */
        }
      }
      styleIds.set(s.name, st.id);
      made++;
    }
    progress(`Made ${made} text styles.`);
  }

  // Specimen page.
  let page: PageNode | null = null;
  if (opts.specimen) {
    page = figma.createPage();
    page.name = `Fonts · ${site}`;
    await figma.setCurrentPageAsync(page);
    const root = column(`Fonts used on ${site}`, 32, 48);
    root.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];
    page.appendChild(root);
    root.appendChild(text(`Fonts used on ${site}`, ui.bold, 32, { color: INK }));
    const missing = p.fonts.filter((f) => !used.get(f.key)!.real).length;
    root.appendChild(
      text(
        `${p.fonts.length} fonts and ${p.styles.length} text styles, from ${p.site.url}, read by Font Finder Plus on ${p.scannedAt.slice(0, 10)}.` +
          (missing ? ` ${missing} not installed here, so a free look-alike stands in for ${missing === 1 ? 'it' : 'each'}.` : ' Every font is installed.') +
          (p.scale ? ` Type scale: ${p.scale.name} (${p.scale.ratio}).` : ''),
        ui.regular,
        14,
        { color: GREY, width: 720 },
      ),
    );

    for (const f of p.fonts) {
      const u = used.get(f.key)!;
      const card = column(f.name, 10, 24);
      card.cornerRadius = 16;
      card.fills = [{ type: 'SOLID', color: { r: 0.96, g: 0.965, b: 0.975 } }];
      card.counterAxisSizingMode = 'FIXED';
      card.resize(780, card.height);
      root.appendChild(card);
      card.appendChild(text(`${f.roles.length ? `Used for ${f.roles.join(', ')}` : 'Used on the page'} · ${f.elements} elements · weights ${f.weights.join(', ')}`, ui.medium, 11, { color: GREY }));
      // The font itself, drawn from its file or as the page draws it.
      if (f.preview?.kind === 'svg') {
        try {
          const node = figma.createNodeFromSvg(f.preview.svg);
          node.name = `${f.name} (preview)`;
          const h = 56;
          node.rescale(h / Math.max(1, f.preview.height));
          card.appendChild(node);
        } catch {
          /* fall through to the name */
        }
      } else if (f.preview?.kind === 'png') {
        try {
          const img = figma.createImage(figma.base64Decode(f.preview.data.split(',')[1]));
          const rect = figma.createRectangle();
          rect.name = `${f.name} (preview)`;
          const h = 56;
          rect.resize(Math.max(1, (f.preview.width / Math.max(1, f.preview.height)) * h), h);
          rect.fills = [{ type: 'IMAGE', imageHash: img.hash, scaleMode: 'FIT' }];
          card.appendChild(rect);
        } catch {
          /* fall through */
        }
      }
      card.appendChild(text(f.name, ui.bold, 20, { color: INK }));
      const match = f.standIn && f.standIn.family === u.family ? ` (${f.standIn.score}% match, free)` : '';
      const status = u.real
        ? 'Installed in Figma.'
        : f.catalogFamily
          ? `Free on Google Fonts, but this Figma does not have it yet. Shown with ${u.family}${match} until you install it from Google Fonts.`
          : `Not installed in Figma. Shown with ${u.family}${match} until you install it.`;
      card.appendChild(text(status, ui.medium, 13, { color: u.real ? OK : WARN, width: 732 }));
      card.appendChild(text(`${f.licence.name}. ${f.licence.short} This is a summary, not legal advice.`, ui.regular, 13, { color: INK, width: 732 }));
      const facts = [f.foundry ? `Foundry: ${f.foundry}` : 'Foundry: unknown', f.designers.length ? `Design: ${f.designers.join(', ')}` : null, `Served by ${f.source}${f.host ? ` (${f.host})` : ''}`].filter(Boolean).join(' · ');
      card.appendChild(text(facts, ui.regular, 12, { color: GREY, width: 732 }));
      if (f.getIt) card.appendChild(text(`Get it: ${f.getIt.label} ↗`, ui.medium, 13, { color: { r: 0.18, g: 0.27, b: 0.91 }, link: f.getIt.url }));
      if (!u.real && f.alternatives.length) card.appendChild(text(`Other free look-alikes: ${[f.standIn, ...f.alternatives].filter((a): a is { family: string; score: number } => !!a && a.family !== u.family).map((a) => `${a.family} ${a.score}%`).join(', ')}`, ui.regular, 12, { color: GREY, width: 732 }));
    }

    if (p.styles.length) {
      const list = column('Text styles', 18, 0);
      list.fills = [];
      root.appendChild(list);
      list.appendChild(text('Text styles', ui.bold, 24, { color: INK }));
      for (const s of p.styles) {
        const id = styleIds.get(s.name);
        const row = column(s.name, 4, 0);
        row.fills = [];
        list.appendChild(row);
        const f = byKey.get(s.fontKey);
        const u = f ? used.get(f.key) : null;
        row.appendChild(text(`${s.name.toUpperCase()} · ${lhText(s)} · ${s.fontName} ${s.weight}${u && !u.real ? ` → ${u.family}` : ''}`, ui.medium, 11, { color: GREY }));
        const sample = (s.sample || 'The quick brown fox jumps over the lazy dog').slice(0, 90);
        const t = text(sample, ui.regular, 14, { color: INK, width: 780 });
        if (id) await t.setTextStyleIdAsync(id);
        row.appendChild(t);
      }
    }
    figma.viewport.scrollAndZoomIntoView([root]);
  }
  return { styles: made, variables: vars.size, page: page?.name ?? null, missing: p.fonts.filter((f) => !used.get(f.key)!.real).map((f) => f.name) };
}

/** Swap stand-ins for real fonts that have been installed since. */
async function recheck() {
  const ix = await getIndex(true);
  const styles = (await figma.getLocalTextStylesAsync()).filter((s) => s.getPluginData('ffp'));
  let swapped = 0;
  const still = new Set<string>();
  for (const st of styles) {
    let saved: Saved;
    try {
      saved = JSON.parse(st.getPluginData('ffp')) as Saved;
    } catch {
      continue;
    }
    const real = findFamily(ix, saved.realNames);
    if (!real) {
      still.add(saved.font);
      continue;
    }
    if (st.fontName.family === real.family) continue;
    const font: FontName = { family: real.family, style: pickStyle(real.styles, saved.weight, saved.italic) ?? 'Regular' };
    if (!(await load(font))) continue;
    st.fontName = font;
    st.description = `${saved.font} ${saved.weight}${saved.italic ? ' italic' : ''}. From ${saved.site}. Real font installed.`;
    swapped++;
  }
  return { swapped, still: [...still], total: styles.length };
}

async function countSaved() {
  const styles = (await figma.getLocalTextStylesAsync()).filter((s) => s.getPluginData('ffp')).length;
  const layers = textLayers([figma.currentPage]).filter((t) => t.getPluginData('ffp-original')).length;
  return styles + layers;
}

figma.ui.onmessage = async (msg: { type: string; [k: string]: unknown }) => {
  try {
    if (msg.type === 'check') {
      lastPayload = msg.payload as FigmaPayload;
      figma.clientStorage.setAsync('ffp-last-payload', lastPayload).catch(() => undefined);
      figma.ui.postMessage({ type: 'checked', status: await check(lastPayload) });
    } else if (msg.type === 'find-missing') {
      lastPayload ??= ((await figma.clientStorage.getAsync('ffp-last-payload').catch(() => null)) as FigmaPayload | null) ?? null;
      const sel = figma.currentPage.selection;
      const r = findMissing(textLayers(sel.length ? sel : [figma.currentPage]), await getIndex(true), lastPayload);
      figma.ui.postMessage({ type: 'missing', ...r, scope: sel.length ? 'selection' : 'page', site: lastPayload?.site.host ?? null });
    } else if (msg.type === 'fix-missing') {
      const sel = figma.currentPage.selection;
      const r = await replaceMissing(textLayers(sel.length ? sel : [figma.currentPage]), await getIndex(), msg.choices as Record<string, string>, load);
      figma.ui.postMessage({ type: 'fixed', ...r });
      figma.notify(`Font Finder Plus: replaced missing fonts in ${r.changed} text layers.`);
    } else if (msg.type === 'build') {
      const r = await build(msg.payload as FigmaPayload, msg.choices as Choice[], msg.opts as Opts);
      figma.ui.postMessage({ type: 'built', result: r });
      figma.notify(`Font Finder Plus: ${r.styles} text styles${r.page ? ` and the page "${r.page}"` : ''} created.`);
    } else if (msg.type === 'recheck') {
      const result = await recheck();
      const back = await restoreOriginals(textLayers([figma.currentPage]), await getIndex(), load);
      figma.ui.postMessage({ type: 'rechecked', result: { ...result, swapped: result.swapped + back.restored, still: [...new Set([...result.still, ...back.still])] } });
    } else if (msg.type === 'open') figma.openExternal(String(msg.url));
    else if (msg.type === 'close') figma.closePlugin();
  } catch (err) {
    figma.ui.postMessage({ type: 'error', msg: String((err as Error)?.message ?? err) });
  }
};

countSaved().then((n) => figma.ui.postMessage({ type: 'init', saved: n }));
