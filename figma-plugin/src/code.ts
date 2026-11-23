// Font Finder Plus for Figma. Takes what the browser extension copied (a
// website's fonts and text styles), shows which fonts this Figma has, and builds
// text styles, variables and a specimen page. Free stand-ins fill in for fonts
// that are not installed; "Check again" swaps the real fonts in once they are.
// It also fixes captured frames whose fonts Figma is missing, and copies the
// file's own text styles for the extension to try on a website.
import type { FigmaFont, FigmaPayload, FigmaStyle } from '../../src/shared/figma-payload';
import { familyIndex, findFamily, isItalicStyle, pickStyle, slug, textCase, weightOfStyle, type AvailableFont } from './match';
import { guessRoles, letterSpacingEm, lineHeightPx, type FigmaLetterSpacing, type FigmaLineHeight, type WebStyle } from './web';

declare const __html__: string;

type Index = ReturnType<typeof familyIndex>;
interface Choice { key: string; family: string | null }
interface Opts { styles: boolean; variables: boolean; specimen: boolean; naming?: 'site' | 'role' }
interface Saved { realNames: string[]; weight: string; italic: boolean; site: string; font: string; licence?: string }
interface Settings { variables: boolean; specimen: boolean; naming: 'site' | 'role' }
const DEFAULT_SETTINGS: Settings = { variables: true, specimen: true, naming: 'site' };

const UI_FAMILY = 'Inter';
const FALLBACKS: Record<string, string[]> = {
  mono: ['Roboto Mono', 'Source Code Pro', 'IBM Plex Mono', 'Geist Mono', 'JetBrains Mono', 'Courier New'],
  serif: ['Source Serif 4', 'Merriweather', 'Lora', 'Georgia', 'Times New Roman'],
  script: ['Dancing Script', 'Pacifico'],
};
/** Common sans serifs, for a missing font Font Finder Plus knows nothing about. */
const SANS = ['Inter', 'Arimo', 'Roboto', 'Helvetica Neue', 'Helvetica', 'Arial'];
const TIMEOUT = 8000;

figma.showUI(__html__, { width: 360, height: 640, themeColors: true });

let index: Index | null = null;
let lastPayload: FigmaPayload | null = null;
/** The specimen page made last, for "Go to the specimen page". */
let lastPageId: string | null = null;
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

let uiFonts: { regular: FontName; medium: FontName; semibold: FontName; bold: FontName } | null = null;
async function loadUiFonts() {
  if (uiFonts) return uiFonts;
  const ix = await getIndex();
  // Font Finder Plus's own font is Geist; Inter (always in Figma) when Geist is not available.
  const uiFam = findFamily(ix, ['Geist', UI_FAMILY]);
  const fam = uiFam ? uiFam.family : 'Inter';
  const styles = uiFam?.styles ?? ['Regular', 'Medium', 'Semi Bold', 'Bold'];
  const f = (w: number): FontName => ({ family: fam, style: pickStyle(styles, w, false) ?? 'Regular' });
  uiFonts = { regular: f(400), medium: f(500), semibold: f(600), bold: f(700) };
  await Promise.all([load(uiFonts.regular), load(uiFonts.medium), load(uiFonts.semibold), load(uiFonts.bold)]);
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

function text(chars: string, font: FontName, size: number, opts: { color?: RGB; width?: number; link?: string; lineHeight?: number; tracking?: number } = {}): TextNode {
  const t = figma.createText();
  t.fontName = font;
  t.fontSize = size;
  t.characters = chars;
  if (opts.lineHeight) t.lineHeight = { unit: 'PIXELS', value: opts.lineHeight };
  if (opts.tracking) t.letterSpacing = { unit: 'PERCENT', value: opts.tracking };
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

const hexRgb = (h: string): RGB => ({ r: parseInt(h.slice(1, 3), 16) / 255, g: parseInt(h.slice(3, 5), 16) / 255, b: parseInt(h.slice(5, 7), 16) / 255 });
const BLACK = hexRgb('#000000');
const WHITE = hexRgb('#FFFFFF');
const TEXT = hexRgb('#181D27');
const LABEL = hexRgb('#667185');
const VALUE = hexRgb('#344054');
const HAIRLINE = hexRgb('#F7F7F7');
const CARD = hexRgb('#F3F3F3');
const INFO_BG = hexRgb('#F7F7F8');
const LINK = hexRgb('#2E46E8');
const OK = hexRgb('#147A4A');
const WARN = hexRgb('#996100');

const keyOf = (s: FigmaStyle) => slug(s.token ?? s.name);
const GROUPS = ['Headings', 'Body', 'Buttons & labels', 'Code'] as const;
const WEIGHT_NAME: Record<string, string> = { '100': 'Thin', '200': 'Extra Light', '300': 'Light', '400': 'Regular', '500': 'Medium', '600': 'Semi Bold', '700': 'Bold', '800': 'Extra Bold', '900': 'Black' };
const weightName = (w: string) => WEIGHT_NAME[String(Math.round(Number(w) / 100) * 100)] ?? w;
const spacingPct = (s: FigmaStyle) => { const v = Math.round((s.letterSpacing / s.size) * 1000) / 10; return v === 0 ? '0%' : `${v}%`; };
const CASE: Record<string, string> = { uppercase: 'Uppercase', lowercase: 'Lowercase', capitalize: 'Title case' };

/** "example.com/Headings/h1" by site and tag, or "Headings/Heading 1" by role (Settings). */
function styleName(s: FigmaStyle, site: string, naming: 'site' | 'role') {
  if (naming === 'role') return `${s.group ?? 'Body'}/${slug((s.label ?? s.name).replace(/\s*\(.*\)$/, '').replace(/\//g, '-'))}`;
  return `${site}/${s.group ? `${s.group}/` : ''}${keyOf(s)}`;
}

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
    progress('Adding variables…');
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
    progress('Making text styles…');
    const local = await figma.getLocalTextStylesAsync();
    for (const s of p.styles) {
      const f = byKey.get(s.fontKey);
      if (!f) continue;
      const u = used.get(f.key)!;
      const italic = s.style !== 'normal';
      const font: FontName = { family: u.family, style: pickStyle(u.styles, s.weight, italic) ?? 'Regular' };
      if (!(await load(font))) continue;
      const name = styleName(s, site, opts.naming ?? 'site');
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
      const saved: Saved = { realNames: namesOf(f).filter((x): x is string => !!x), weight: s.weight, italic, site, font: f.name, licence: f.licence.type };
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

  // Specimen page: a style guide laid out like a designer's (1000px wide, black header,
  // one block per font with an "Aa" card, then every text style with its values and a sample).
  let page: PageNode | null = null;
  if (opts.specimen) {
    progress('Drawing the specimen page…');
    page = figma.createPage();
    lastPageId = page.id;
    page.name = `Typography · ${site}`;
    await figma.setCurrentPageAsync(page);
    const root = column(`Style guide · ${site}`, 0, 0);
    root.fills = [{ type: 'SOLID', color: WHITE }];
    root.counterAxisSizingMode = 'FIXED';
    root.resize(1000, root.height);
    page.appendChild(root);
    const fill = <T extends SceneNode & { layoutSizingHorizontal: string }>(n: T) => {
      n.layoutSizingHorizontal = 'FILL';
      return n;
    };

    // Header: black band, "Style Guide ~ Typography".
    const head = row('Header', 10, 24, 24);
    head.fills = [{ type: 'SOLID', color: BLACK }];
    root.appendChild(head);
    fill(head);
    head.appendChild(text('Style Guide ~ Typography', ui.semibold, 16, { color: WHITE, lineHeight: 21, tracking: -3 }));

    // One block per font.
    for (const f of p.fonts) {
      const u = used.get(f.key)!;
      const block = row(`Font · ${f.name}`, 40, 40, 24);
      block.primaryAxisAlignItems = 'SPACE_BETWEEN';
      block.counterAxisAlignItems = 'MIN';
      block.strokes = [{ type: 'SOLID', color: HAIRLINE }];
      block.strokeWeight = 1;
      root.appendChild(block);
      fill(block);

      const left = column('Font', 75, 0);
      left.fills = [];
      block.appendChild(left);
      left.appendChild(text(`Font ~ ${f.name}`, ui.semibold, 18, { color: BLACK, lineHeight: 18, tracking: -2 }));
      const lower = column('Alphabet and info', 16, 0);
      lower.fills = [];
      left.appendChild(lower);
      const regular: FontName = { family: u.family, style: pickStyle(u.styles, 400, false) ?? 'Regular' };
      const sampleFont = (await load(regular)) ? regular : ui.regular;
      lower.appendChild(text('ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz 0123456789 !@#$%^&*()', sampleFont, 18, { color: TEXT, lineHeight: 24, width: 640 }));

      // Light grey box: installed or not, licence, foundry, where to get it.
      const info = column('Font info', 6, 16);
      info.paddingTop = info.paddingBottom = 12;
      info.cornerRadius = 12;
      info.fills = [{ type: 'SOLID', color: INFO_BG }];
      info.counterAxisSizingMode = 'FIXED';
      info.resize(640, info.height);
      lower.appendChild(info);
      const line = (k: string, v: string, color: RGB = VALUE, link?: string) => {
        const t = text(`${k}  ${v}`, ui.regular, 12, { color, lineHeight: 20, width: 608, link });
        t.setRangeFills(0, k.length, [{ type: 'SOLID', color: LABEL }]);
        info.appendChild(t);
      };
      const match = f.standIn && f.standIn.family === u.family ? ` (${f.standIn.score}% match, free)` : '';
      line('Status', u.real ? 'Installed in Figma' : f.catalogFamily ? `Free on Google Fonts, not installed in this Figma yet. Shown with ${u.family}${match}.` : `Not installed in Figma. Shown with ${u.family}${match}.`, u.real ? OK : WARN);
      line('Licence', `${f.licence.name}. ${f.licence.short} This is a summary, not legal advice.`);
      line('Foundry', [f.foundry ?? 'unknown', f.designers.length ? `design by ${f.designers.join(', ')}` : null].filter(Boolean).join(', '));
      line('Used for', `${f.roles.join(', ') || 'text'}, weights ${f.weights.join(', ')}`);
      if (f.getIt) line('Get it', `${f.getIt.label} ↗`, LINK, f.getIt.url);
      if (!u.real && f.preview) {
        try {
          let node: SceneNode;
          if (f.preview.kind === 'svg') {
            const svg = figma.createNodeFromSvg(f.preview.svg);
            svg.rescale(32 / Math.max(1, f.preview.height));
            node = svg;
          } else {
            const img = figma.createImage(figma.base64Decode(f.preview.data.split(',')[1]));
            const rect = figma.createRectangle();
            rect.resize(Math.max(1, (f.preview.width / Math.max(1, f.preview.height)) * 32), 32);
            rect.fills = [{ type: 'IMAGE', imageHash: img.hash, scaleMode: 'FIT' }];
            node = rect;
          }
          node.name = `${f.name}, drawn in the real font`;
          info.appendChild(node);
        } catch {
          /* the rest of the block still shows */
        }
      }

      // The "Aa" card: 217 by 166, radius 32, the letters large and cropped.
      const card = figma.createFrame();
      card.name = 'Aa';
      card.resize(217, 166);
      card.cornerRadius = 32;
      card.clipsContent = true;
      card.fills = [{ type: 'SOLID', color: CARD }];
      block.appendChild(card);
      const semi: FontName = { family: u.family, style: pickStyle(u.styles, 600, false) ?? regular.style };
      const aa = text('Aa', (await load(semi)) ? semi : sampleFont, 150, { color: BLACK, lineHeight: 180, tracking: -4 });
      card.appendChild(aa);
      aa.x = -35;
      aa.y = 23;
    }

    // Every text style: values on the left, a sample on the right.
    const all = column('All fonts', 64, 0);
    all.paddingTop = all.paddingBottom = 32;
    all.fills = [];
    root.appendChild(all);
    fill(all);
    const ordered = GROUPS.flatMap((g) => p.styles.filter((s) => (s.group ?? 'Body') === g));
    for (const s of ordered) {
      const f = byKey.get(s.fontKey);
      if (!f) continue;
      const u = used.get(f.key)!;
      const g = s.group ?? 'Body';
      const label = s.label ?? s.name;
      const r = row(label, 64, 40, 0);
      r.primaryAxisAlignItems = 'SPACE_BETWEEN';
      r.counterAxisAlignItems = 'MIN';
      all.appendChild(r);
      fill(r);

      const spec = column('Values', 16, 0);
      spec.fills = [];
      spec.counterAxisSizingMode = 'FIXED';
      spec.resize(263, spec.height);
      r.appendChild(spec);
      spec.appendChild(text(label, ui.medium, 14, { color: BLACK, lineHeight: 16, tracking: -2, width: 263 }));
      const grid = row('Values grid', 24, 0, 0);
      grid.layoutWrap = 'WRAP';
      grid.counterAxisSpacing = 16;
      grid.primaryAxisSizingMode = 'FIXED';
      grid.resize(263, grid.height);
      grid.fills = [];
      spec.appendChild(grid);
      const pair = (k: string, v: string) => {
        const cell = column(k, 0, 0);
        cell.fills = [];
        cell.counterAxisSizingMode = 'FIXED';
        cell.resize(119, cell.height);
        cell.appendChild(text(k, ui.regular, 12, { color: LABEL, lineHeight: 20 }));
        cell.appendChild(text(v, ui.regular, 12, { color: VALUE, lineHeight: 20, width: 119 }));
        grid.appendChild(cell);
      };
      pair('Font', u.real ? f.name : `${f.name} (shown in ${u.family})`);
      pair('Letter Spacing', spacingPct(s));
      pair('Size', `${Math.round(s.size * 10) / 10}px`);
      pair('Paragraph Spacing', `${Math.round(s.paragraphSpacing ?? 0)}px`);
      pair('Line Height', s.lineHeight ? `${Math.round(s.lineHeight * 10) / 10}px` : 'Auto');
      pair('Weight', weightName(s.weight) + (s.style !== 'normal' ? ' Italic' : ''));

      const right = row('Sample', 40, 0, 0);
      right.layoutWrap = 'WRAP';
      right.counterAxisSpacing = 48;
      right.primaryAxisSizingMode = 'FIXED';
      right.resize(604, right.height);
      right.fills = [];
      r.appendChild(right);
      const button = g === 'Buttons & labels';
      const sample = column(label, button ? 16 : 4, 0);
      sample.fills = [];
      sample.counterAxisSizingMode = 'FIXED';
      sample.resize(604, sample.height);
      right.appendChild(sample);
      const first =
        g === 'Headings' ? label.replace(/\s*\(.*\)$/, '')
          : g === 'Code' ? 'const total = price * 1.2;'
            : button ? (/link/i.test(s.token ?? s.name) ? 'LINK' : 'BUTTON')
              : (s.sample || 'The quick brown fox jumps over the lazy dog.').slice(0, 160);
      const id = styleIds.get(keyOf(s));
      for (const chars of [first, button ? weightName(s.weight).toUpperCase() : weightName(s.weight)]) {
        const t = text(chars, ui.regular, 14, { color: BLACK, width: 604 });
        if (id) await t.setTextStyleIdAsync(id);
        t.name = chars;
        sample.appendChild(t);
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

const readSaved = (st: BaseStyle): Saved | null => {
  try {
    const raw = st.getPluginData('ffp');
    return raw ? (JSON.parse(raw) as Saved) : null;
  } catch {
    return null;
  }
};
const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
/** True when a style made by this plugin still shows a stand-in instead of the real font. */
const usesStandIn = (st: TextStyle, saved: Saved) => !saved.realNames.some((n) => squash(n) === squash(st.fontName.family));

/** Text styles that use a stand-in: how many, which styles and which real fonts. */
async function standInSummary() {
  const styles: string[] = [];
  const fonts = new Set<string>();
  for (const st of await figma.getLocalTextStylesAsync()) {
    const saved = readSaved(st);
    if (!saved || !usesStandIn(st, saved)) continue;
    styles.push(st.name.split('/').pop()!);
    fonts.add(saved.font);
  }
  return { count: styles.length, styles, fonts: [...fonts] };
}

// ------------------------------------------------------------- settings and recent sites

async function getSettings(): Promise<Settings> {
  const s = (await figma.clientStorage.getAsync('ffp-settings').catch(() => null)) as Partial<Settings> | null;
  return { ...DEFAULT_SETTINGS, ...(s ?? {}) };
}
async function getRecent(): Promise<string[]> {
  const r = await figma.clientStorage.getAsync('ffp-recent-sites').catch(() => null);
  return Array.isArray(r) ? r.filter((x): x is string => typeof x === 'string').slice(0, 6) : [];
}
async function setRecent(list: string[]) {
  const clean = [...new Set(list.filter(Boolean))].slice(0, 6);
  await figma.clientStorage.setAsync('ffp-recent-sites', clean);
  return clean;
}

// ------------------------------------------------------------- see it on the web

/** The file's local text styles, in web units, with a guessed role for each. */
async function webStyles(): Promise<WebStyle[]> {
  const local = await figma.getLocalTextStylesAsync();
  const roles = guessRoles(local.map((st) => ({ name: st.name, size: Number(st.fontSize) || 16 })));
  return local.map((st, i) => {
    const size = Number(st.fontSize) || 16;
    const saved = readSaved(st);
    return {
      id: st.id,
      name: st.name,
      family: st.fontName.family,
      style: st.fontName.style,
      weight: weightOfStyle(st.fontName.style),
      size: Math.round(size * 100) / 100,
      lineHeight: lineHeightPx(st.lineHeight as FigmaLineHeight, size),
      letterSpacing: letterSpacingEm(st.letterSpacing as FigmaLetterSpacing, size),
      role: roles[i],
      paid: saved?.licence === 'commercial',
      standInFor: saved && usesStandIn(st, saved) ? saved.font : null,
    };
  });
}

// ------------------------------------------------------------- fix a captured page

interface Candidate { family: string; score: number | null }
interface MissingFont { family: string; styles: string[]; layers: number; licence: string | null; candidates: Candidate[] }

/** The text layers in the selection (the selected layers and everything inside them). */
function selectedTexts(): TextNode[] {
  const out: TextNode[] = [];
  for (const n of figma.currentPage.selection) {
    if (n.type === 'TEXT') out.push(n);
    else if ('findAllWithCriteria' in n) out.push(...(n as FrameNode).findAllWithCriteria({ types: ['TEXT'] }));
  }
  return [...new Set(out)];
}

function selectionInfo() {
  const sel = figma.currentPage.selection;
  return { count: sel.length, name: sel.length === 1 ? sel[0].name : sel.length ? `${sel.length} layers` : '' };
}

/** Fonts this Figma could use instead of a missing one, best first. */
function candidatesFor(family: string, ix: Index): { list: Candidate[]; licence: string | null } {
  const seen = new Set<string>();
  const list: Candidate[] = [];
  const add = (fam: string | null | undefined, score: number | null) => {
    if (!fam) return;
    const hit = findFamily(ix, [fam]);
    if (!hit || seen.has(hit.family)) return;
    seen.add(hit.family);
    list.push({ family: hit.family, score });
  };
  // The same family under another name, or with other styles (only the style is missing).
  add(family, null);
  // The look-alikes Font Finder Plus found for it, from the last paste.
  const f = lastPayload?.fonts.find((x) => namesOf(x).some((n) => n && squash(n) === squash(family)));
  if (f) {
    add(f.standIn?.family, f.standIn?.score ?? null);
    for (const a of f.alternatives) add(a.family, a.score);
  }
  // Then a font of the same kind, then Inter.
  const kind = f?.classification ?? (/mono|code|courier/i.test(family) ? 'mono' : /serif|times|garamond|caslon|georgia/i.test(family) && !/sans/i.test(family) ? 'serif' : 'sans');
  for (const fam of FALLBACKS[kind] ?? SANS) add(fam, null);
  add(UI_FAMILY, null);
  return { list, licence: f?.licence.type ?? null };
}

/** The fonts that text layers in the selection use but this Figma lacks. */
async function scanSelection() {
  const ix = await getIndex(true);
  const texts = selectedTexts();
  const missing = new Map<string, { styles: Set<string>; layers: Set<TextNode> }>();
  for (const t of texts) {
    if (!t.hasMissingFont) continue;
    for (const seg of t.getStyledTextSegments(['fontName'])) {
      const fn = seg.fontName;
      const fam = findFamily(ix, [fn.family]);
      if (fam && fam.styles.includes(fn.style)) continue;
      const m = missing.get(fn.family) ?? { styles: new Set<string>(), layers: new Set<TextNode>() };
      m.styles.add(fn.style);
      m.layers.add(t);
      missing.set(fn.family, m);
    }
  }
  const fonts: MissingFont[] = [...missing].map(([family, m]) => {
    const c = candidatesFor(family, ix);
    return { family, styles: [...m.styles], layers: m.layers.size, licence: c.licence, candidates: c.list };
  });
  fonts.sort((a, b) => b.layers - a.layers);
  const layers = new Set([...missing.values()].flatMap((m) => [...m.layers])).size;
  return { ...selectionInfo(), texts: texts.length, layers, fonts };
}

/**
 * Swap each missing font for the chosen one, keeping weight and italic. With `link`,
 * a run whose real font, weight and size match a text style this plugin made uses that
 * style instead. One undo step.
 */
async function fixSelection(map: Record<string, string>, link: boolean) {
  const ix = await getIndex(true);
  const texts = selectedTexts();
  const local = link
    ? (await figma.getLocalTextStylesAsync()).map((st) => ({ st, saved: readSaved(st) })).filter((x): x is { st: TextStyle; saved: Saved } => !!x.saved)
    : [];
  const fixed = new Set<TextNode>();
  const failed = new Set<string>();
  let linked = 0;
  for (const t of texts) {
    if (!t.hasMissingFont) continue;
    for (const seg of t.getStyledTextSegments(['fontName', 'fontSize'])) {
      const fn = seg.fontName;
      const target = map[fn.family];
      if (!target) continue;
      const have = findFamily(ix, [fn.family]);
      if (have && have.styles.includes(fn.style)) continue;
      const weight = weightOfStyle(fn.style);
      const italic = isItalicStyle(fn.style);
      const match = local.find(({ st, saved }) =>
        saved.realNames.some((n) => squash(n) === squash(fn.family)) &&
        Math.abs((Number(saved.weight) || 400) - weight) < 100 &&
        saved.italic === italic &&
        Math.abs(Number(st.fontSize) - Number(seg.fontSize)) < 0.5);
      if (match && (await load(match.st.fontName))) {
        await t.setRangeTextStyleIdAsync(seg.start, seg.end, match.st.id);
        linked++;
        fixed.add(t);
        continue;
      }
      const fam = findFamily(ix, [target]);
      const font: FontName | null = fam ? { family: fam.family, style: pickStyle(fam.styles, weight, italic) ?? 'Regular' } : null;
      if (!font || !(await load(font))) {
        failed.add(target);
        continue;
      }
      t.setRangeFontName(seg.start, seg.end, font);
      fixed.add(t);
    }
  }
  if (fixed.size) figma.commitUndo();
  return { layers: fixed.size, linked, failed: [...failed], map };
}

async function init() {
  const [summary, settings, recent] = await Promise.all([standInSummary(), getSettings(), getRecent()]);
  const last = (await figma.clientStorage.getAsync('ffp-last-payload').catch(() => null)) as FigmaPayload | null;
  if (last && !lastPayload) lastPayload = last;
  figma.ui.postMessage({ type: 'init', saved: summary.count, standIns: summary, file: figma.root.name, settings, recent, selection: selectionInfo() });
}

figma.on('selectionchange', () => figma.ui.postMessage({ type: 'selection', selection: selectionInfo() }));

figma.ui.onmessage = async (msg: { type: string; [k: string]: unknown }) => {
  try {
    if (msg.type === 'check') {
      lastPayload = msg.payload as FigmaPayload;
      figma.clientStorage.setAsync('ffp-last-payload', lastPayload).catch(() => undefined);
      figma.ui.postMessage({ type: 'checked', status: await check(lastPayload) });
    } else if (msg.type === 'build') {
      const r = await build(msg.payload as FigmaPayload, msg.choices as Choice[], msg.opts as Opts);
      figma.ui.postMessage({ type: 'built', result: r });
      figma.notify(`Font Finder Plus: ${r.styles} text styles${r.page ? ` and the page "${r.page}"` : ''} created.`);
    } else if (msg.type === 'recheck') {
      const result = await recheck();
      figma.ui.postMessage({ type: 'rechecked', result: { ...result, standIns: await standInSummary() } });
    } else if (msg.type === 'goto-page') {
      const node = lastPageId ? await figma.getNodeByIdAsync(lastPageId) : null;
      if (node && node.type === 'PAGE') {
        await figma.setCurrentPageAsync(node);
        if (node.children.length) figma.viewport.scrollAndZoomIntoView([node.children[0]]);
      } else figma.notify('The style guide page is no longer in this file.');
    } else if (msg.type === 'web-styles') {
      figma.ui.postMessage({ type: 'web-styles', styles: await webStyles(), file: figma.root.name });
    } else if (msg.type === 'remember-site') {
      const site = String(msg.site ?? '');
      figma.ui.postMessage({ type: 'recent', recent: await setRecent([site, ...(await getRecent()).filter((x) => x !== site)]) });
    } else if (msg.type === 'forget-site') {
      figma.ui.postMessage({ type: 'recent', recent: await setRecent((await getRecent()).filter((x) => x !== msg.site)) });
    } else if (msg.type === 'clear-sites') {
      figma.ui.postMessage({ type: 'recent', recent: await setRecent([]) });
    } else if (msg.type === 'settings') {
      const s: Settings = { ...(await getSettings()), ...(msg.settings as Partial<Settings>) };
      await figma.clientStorage.setAsync('ffp-settings', s);
      figma.ui.postMessage({ type: 'settings', settings: s });
    } else if (msg.type === 'fix-scan') {
      figma.ui.postMessage({ type: 'fix-scanned', result: await scanSelection() });
    } else if (msg.type === 'fix-apply') {
      figma.ui.postMessage({ type: 'fixed', result: await fixSelection(msg.map as Record<string, string>, !!msg.link) });
    } else if (msg.type === 'open') figma.openExternal(String(msg.url));
    else if (msg.type === 'close') figma.closePlugin();
  } catch (err) {
    figma.ui.postMessage({ type: 'error', msg: String((err as Error)?.message ?? err), during: msg.type });
  }
};

init();
