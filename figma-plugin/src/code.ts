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
  // Font Finder Plus's own font is Geist; Inter (always in Figma) when Geist is not available.
  const uiFam = findFamily(ix, ['Geist', UI_FAMILY]);
  const fam = uiFam ? uiFam.family : 'Inter';
  const styles = uiFam?.styles ?? ['Regular', 'Medium', 'Bold'];
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

function row(name: string, gap: number, padX: number, padY: number): FrameNode {
  const fr = figma.createFrame();
  fr.name = name;
  fr.layoutMode = 'HORIZONTAL';
  fr.primaryAxisSizingMode = 'AUTO';
  fr.counterAxisSizingMode = 'AUTO';
  fr.counterAxisAlignItems = 'CENTER';
  fr.itemSpacing = gap;
  fr.paddingLeft = fr.paddingRight = padX;
  fr.paddingTop = fr.paddingBottom = padY;
  fr.fills = [];
  return fr;
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

const keyOf = (s: FigmaStyle) => slug(s.token ?? s.name);
const GROUPS = ['Headings', 'Body', 'Buttons & labels', 'Code'] as const;
const WEIGHT_NAME: Record<string, string> = { '100': 'Thin', '200': 'Extra Light', '300': 'Light', '400': 'Regular', '500': 'Medium', '600': 'Semi Bold', '700': 'Bold', '800': 'Extra Bold', '900': 'Black' };
const weightName = (w: string) => WEIGHT_NAME[String(Math.round(Number(w) / 100) * 100)] ?? w;
const spacingPct = (s: FigmaStyle) => { const v = Math.round((s.letterSpacing / s.size) * 1000) / 10; return v === 0 ? '0%' : `${v}%`; };
const CASE: Record<string, string> = { uppercase: 'Uppercase', lowercase: 'Lowercase', capitalize: 'Title case' };

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
        getVar(`size/${keyOf(s)}`, 'FLOAT', ['FONT_SIZE']).setValueForMode(mode, Math.round(s.size * 100) / 100);
        if (s.lineHeight) getVar(`line-height/${keyOf(s)}`, 'FLOAT', ['LINE_HEIGHT']).setValueForMode(mode, Math.round(s.lineHeight * 100) / 100);
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
      const name = `${site}/${s.group ? `${s.group}/` : ''}${keyOf(s)}`;
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
          const size = vars.get(`size/${keyOf(s)}`);
          if (size) st.setBoundVariable('fontSize', size);
          const lh = vars.get(`line-height/${keyOf(s)}`);
          if (lh) st.setBoundVariable('lineHeight', lh);
        } catch {
          /* binding is optional */
        }
      }
      styleIds.set(keyOf(s), st.id);
      made++;
    }
    progress(`Made ${made} text styles.`);
  }

  // Specimen page: a style guide.
  let page: PageNode | null = null;
  if (opts.specimen) {
    page = figma.createPage();
    page.name = `Typography · ${site}`;
    await figma.setCurrentPageAsync(page);
    const W = 1200;
    const LINE = { r: 0.9, g: 0.9, b: 0.91 };
    const root = column(`Style guide · ${site}`, 0, 0);
    root.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];
    root.counterAxisSizingMode = 'FIXED';
    root.resize(W, root.height);
    page.appendChild(root);
    const full = (n: FrameNode) => {
      n.layoutSizingHorizontal = 'FILL';
      return n;
    };
    const divider = (n: FrameNode) => {
      n.strokes = [{ type: 'SOLID', color: LINE }];
      n.strokeTopWeight = 0;
      n.strokeLeftWeight = 0;
      n.strokeRightWeight = 0;
      n.strokeBottomWeight = 1;
      return n;
    };

    // Header band.
    const head = row('Header', 16, 40, 22);
    head.fills = [{ type: 'SOLID', color: INK }];
    root.appendChild(head);
    full(head);
    head.appendChild(text(`Style Guide · Typography`, ui.medium, 16, { color: { r: 1, g: 1, b: 1 } }));
    head.appendChild(text(`${site} · read by Font Finder Plus on ${p.scannedAt.slice(0, 10)}${p.scale ? ` · ${p.scale.name} scale (${p.scale.ratio})` : ''}`, ui.regular, 12, { color: { r: 0.7, g: 0.72, b: 0.76 } }));

    // One block per font: alphabet in the font used, a big "Aa", licence and where to get it.
    for (const f of p.fonts) {
      const u = used.get(f.key)!;
      const fontRow = divider(row(`Font · ${f.name}`, 40, 40, 36));
      root.appendChild(fontRow);
      full(fontRow);
      const left = column('About', 10, 0);
      left.fills = [];
      fontRow.appendChild(left);
      left.layoutSizingHorizontal = 'FILL';
      left.appendChild(text(`Font · ${f.name}${u.real ? '' : `  →  ${u.family}`}`, ui.bold, 18, { color: INK }));
      const regular: FontName = { family: u.family, style: pickStyle(u.styles, 400, false) ?? 'Regular' };
      const sampleFont = (await load(regular)) ? regular : ui.regular;
      left.appendChild(text('ABCDEFGHIJKLMNOPQRSTUVWXYZ\nabcdefghijklmnopqrstuvwxyz\n0123456789 !@#$%^&*()', sampleFont, 16, { color: INK, width: 640 }));
      const match = f.standIn && f.standIn.family === u.family ? ` (${f.standIn.score}% match, free)` : '';
      left.appendChild(
        text(
          u.real ? 'Installed in Figma.' : f.catalogFamily ? `Free on Google Fonts, but this Figma does not have it yet. Shown with ${u.family}${match} until you install it.` : `Not installed in Figma. Shown with ${u.family}${match} until you install it.`,
          ui.medium,
          12,
          { color: u.real ? OK : WARN, width: 640 },
        ),
      );
      left.appendChild(text(`${f.licence.name}. ${f.licence.short} This is a summary, not legal advice.`, ui.regular, 12, { color: GREY, width: 640 }));
      const facts = [f.foundry ? `Foundry: ${f.foundry}` : 'Foundry: unknown', f.designers.length ? `Design: ${f.designers.join(', ')}` : null, `Used for ${f.roles.join(', ') || 'text'} · weights ${f.weights.join(', ')}`].filter(Boolean).join(' · ');
      left.appendChild(text(facts, ui.regular, 12, { color: GREY, width: 640 }));
      if (f.getIt) left.appendChild(text(`Get it: ${f.getIt.label} ↗`, ui.medium, 12, { color: { r: 0.18, g: 0.27, b: 0.91 }, link: f.getIt.url }));
      if (!u.real && f.preview) {
        const label = text(`${f.name}, drawn in the real font:`, ui.regular, 11, { color: GREY });
        left.appendChild(label);
        try {
          if (f.preview.kind === 'svg') {
            const node = figma.createNodeFromSvg(f.preview.svg);
            node.name = `${f.name} (preview)`;
            node.rescale(40 / Math.max(1, f.preview.height));
            left.appendChild(node);
          } else {
            const img = figma.createImage(figma.base64Decode(f.preview.data.split(',')[1]));
            const rect = figma.createRectangle();
            rect.name = `${f.name} (preview)`;
            rect.resize(Math.max(1, (f.preview.width / Math.max(1, f.preview.height)) * 40), 40);
            rect.fills = [{ type: 'IMAGE', imageHash: img.hash, scaleMode: 'FIT' }];
            left.appendChild(rect);
          }
        } catch {
          /* the rest of the block still shows */
        }
      }
      // The big "Aa" card.
      const card = figma.createFrame();
      card.name = 'Aa';
      card.resize(240, 200);
      card.cornerRadius = 28;
      card.fills = [{ type: 'SOLID', color: { r: 0.95, g: 0.95, b: 0.95 } }];
      card.layoutMode = 'VERTICAL';
      card.primaryAxisAlignItems = 'CENTER';
      card.counterAxisAlignItems = 'CENTER';
      const bold: FontName = { family: u.family, style: pickStyle(u.styles, 700, false) ?? regular.style };
      card.appendChild(text('Aa', (await load(bold)) ? bold : sampleFont, 120, { color: INK }));
      fontRow.appendChild(card);
    }

    // Text styles, grouped like a style guide, each with its values beside a sample.
    for (const g of GROUPS) {
      const list = p.styles.filter((s) => (s.group ?? 'Body') === g);
      if (!list.length) continue;
      const sec = row(g, 0, 40, 0);
      sec.paddingTop = 36;
      sec.paddingBottom = 8;
      root.appendChild(sec);
      full(sec);
      sec.appendChild(text(g.toUpperCase(), ui.medium, 12, { color: GREY }));
      for (const s of list) {
        const f = byKey.get(s.fontKey);
        if (!f) continue;
        const u = used.get(f.key)!;
        const r = divider(row(s.label ?? s.name, 40, 40, 28));
        r.counterAxisAlignItems = 'MIN';
        root.appendChild(r);
        full(r);
        const spec = column('Values', 14, 0);
        spec.fills = [];
        spec.counterAxisSizingMode = 'FIXED';
        spec.resize(380, spec.height);
        r.appendChild(spec);
        spec.appendChild(text(s.label ?? s.name, ui.bold, 14, { color: INK }));
        const grid = row('Grid', 40, 0, 0);
        grid.fills = [];
        spec.appendChild(grid);
        const pair = (col: FrameNode, k: string, v: string) => {
          const cell = column(k, 2, 0);
          cell.fills = [];
          cell.appendChild(text(k, ui.regular, 11, { color: GREY }));
          cell.appendChild(text(v, ui.regular, 12, { color: INK }));
          col.appendChild(cell);
        };
        const c1 = column('A', 12, 0);
        const c2 = column('B', 12, 0);
        c1.fills = [];
        c2.fills = [];
        c1.counterAxisSizingMode = c2.counterAxisSizingMode = 'FIXED';
        c1.resize(160, c1.height);
        c2.resize(160, c2.height);
        grid.appendChild(c1);
        grid.appendChild(c2);
        pair(c1, 'Font name', u.real ? f.name : `${f.name} (shown in ${u.family})`);
        pair(c1, 'Size', `${Math.round(s.size * 10) / 10}px`);
        pair(c1, 'Line height', s.lineHeight ? `${Math.round(s.lineHeight * 10) / 10}px` : 'Auto');
        pair(c2, 'Letter spacing', spacingPct(s));
        pair(c2, 'Weight', weightName(s.weight) + (s.style !== 'normal' ? ' Italic' : ''));
        pair(c2, 'Case', CASE[s.transform] ?? 'As typed');
        const sampleText =
          g === 'Headings' ? `${(s.label ?? s.name).replace(/\s*\(.*\)$/, '')}\n${weightName(s.weight)}`
            : g === 'Code' ? 'const total = price * 1.2;'
              : g === 'Buttons & labels' ? `${/link/i.test(s.token ?? s.name) ? 'Link' : 'Button'}\n${weightName(s.weight)}`
                : `${(s.sample || 'The quick brown fox jumps over the lazy dog.').slice(0, 140)}\n${weightName(s.weight)}`;
        const t = text(sampleText, ui.regular, 14, { color: INK, width: 680 });
        const id = styleIds.get(keyOf(s));
        if (id) await t.setTextStyleIdAsync(id);
        t.name = s.label ?? s.name;
        r.appendChild(t);
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
