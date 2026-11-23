// Tests the Figma plugin without Figma: runs dist/code.js against a fake
// `figma` object that is strict like the real one (fonts must be loaded before
// use, missing fonts fail to load), and drives dist/ui.html in a browser.
// Needs tests/output/figma-payload.txt, written by tests/run.mjs.
// Run: npm run build:figma && node tests/figma.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

const payloadText = fs.readFileSync(path.join(root, 'tests/output/figma-payload.txt'), 'utf8');
const payload = JSON.parse(payloadText.slice(payloadText.indexOf('\n') + 1));
const code = fs.readFileSync(path.join(root, 'figma-plugin/dist/code.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'figma-plugin/dist/ui.html'), 'utf8');

// ------------------------------------------------------------- fake Figma
function fakeFigma(available) {
  const loaded = new Set();
  const key = (f) => `${f.family}::${f.style}`;
  const has = (f) => available.some((a) => a.family === f.family && a.style === f.style);
  const log = { notify: [], svgs: 0, images: 0, links: 0, pages: [], styles: [], vars: [], bound: 0, texts: 0, undo: 0, linked: 0 };
  const ui = { messages: [], onmessage: null, postMessage: (m) => ui.messages.push(m) };
  let id = 0;
  const node = (type, extra = {}) => {
    const n = { id: `${type}:${++id}`, type, name: '', children: [], height: 20, width: 100, fills: [], pluginData: {}, ...extra };
    n.appendChild = (c) => n.children.push(c);
    n.resize = (w, h) => { n.width = w; n.height = h; };
    n.rescale = (k) => { n.width *= k; n.height *= k; };
    n.setPluginData = (k, v) => { n.pluginData[k] = v; };
    n.getPluginData = (k) => n.pluginData[k] ?? '';
    return n;
  };
  const requireLoaded = (f) => {
    if (!f || !loaded.has(key(f))) throw new Error(`Font not loaded: ${f && key(f)}`);
  };
  const textStyles = [];
  const collections = [];
  const variables = [];
  const page = { type: 'PAGE', name: 'Page 1', selection: [], children: [], findAllWithCriteria: () => page.children.filter((c) => c.type === 'TEXT') };
  const store = {};
  const handlers = {};
  const figma = {
    root: { name: 'Northwind type' },
    on: (ev, fn) => { handlers[ev] = fn; },
    commitUndo: () => { log.undo++; },
    currentPage: page,
    clientStorage: { getAsync: async (k) => store[k], setAsync: async (k, v) => { store[k] = JSON.parse(JSON.stringify(v)); } },
    showUI: () => {},
    ui,
    notify: (m) => log.notify.push(m),
    openExternal: () => {},
    closePlugin: () => {},
    listAvailableFontsAsync: async () => available.map((fontName) => ({ fontName })),
    loadFontAsync: async (f) => {
      if (!has(f)) throw new Error(`The font "${key(f)}" could not be loaded`);
      loaded.add(key(f));
    },
    getLocalTextStylesAsync: async () => [...textStyles],
    createTextStyle: () => {
      const st = node('TEXT_STYLE');
      let fontName = null;
      Object.defineProperty(st, 'fontName', { get: () => fontName, set: (f) => { requireLoaded(f); fontName = f; } });
      st.setBoundVariable = (field, v) => { if (!['fontSize', 'lineHeight'].includes(field) || !v) throw new Error('bad bind'); log.bound++; };
      textStyles.push(st);
      log.styles.push(st);
      return st;
    },
    createText: () => {
      log.texts++;
      const t = node('TEXT');
      let fontName = null;
      let chars = '';
      Object.defineProperty(t, 'fontName', { get: () => fontName, set: (f) => { requireLoaded(f); fontName = f; } });
      Object.defineProperty(t, 'characters', { get: () => chars, set: (c) => { requireLoaded(fontName); chars = c; } });
      t.setRangeHyperlink = (a, b, v) => { if (!v?.value) throw new Error('bad link'); log.links++; };
      t.setRangeFills = (a, b, v) => { if (!Array.isArray(v)) throw new Error('bad fills'); t.rangeFills = v; };
      t.setTextStyleIdAsync = async (sid) => { const st = textStyles.find((s) => s.id === sid); if (!st) throw new Error('no style'); requireLoaded(st.fontName); t.textStyleId = sid; };
      return t;
    },
    createFrame: () => node('FRAME'),
    createRectangle: () => node('RECTANGLE'),
    createPage: () => { const p = node('PAGE'); log.pages.push(p); return p; },
    setCurrentPageAsync: async () => {},
    createNodeFromSvg: (svg) => {
      if (!/^<svg[\s\S]*<path[^>]+d="M[\s\S]*<\/svg>$/.test(svg)) throw new Error('bad svg');
      log.svgs++;
      return node('FRAME');
    },
    base64Decode: (s) => Uint8Array.from(Buffer.from(s, 'base64')),
    createImage: (bytes) => { if (!(bytes[0] === 0x89 && bytes[1] === 0x50)) throw new Error('not a png'); log.images++; return { hash: `img${++id}` }; },
    viewport: { scrollAndZoomIntoView: () => {} },
    variables: {
      getLocalVariableCollectionsAsync: async () => [...collections],
      getLocalVariablesAsync: async () => [...variables],
      createVariableCollection: (name) => { const c = { id: `c${++id}`, name, modes: [{ modeId: 'm1' }] }; collections.push(c); return c; },
      createVariable: (name, c, type) => {
        if (typeof c !== 'object') throw new Error('createVariable needs the collection');
        const v = { id: `v${++id}`, name, variableCollectionId: c.id, resolvedType: type, scopes: [], values: {}, setValueForMode: (m, val) => { if ((type === 'FLOAT') !== (typeof val === 'number')) throw new Error('wrong value type'); v.values[m] = val; } };
        variables.push(v);
        log.vars.push(v);
        return v;
      },
    },
  };
  /** A text layer as a web capture makes it: runs of text in fonts that may be missing. */
  const textLayer = (runs) => {
    const t = node('TEXT');
    let segs = [];
    let pos = 0;
    for (const [text, family, style, size = 16] of runs) { segs.push({ start: pos, end: pos + text.length, fontName: { family, style }, fontSize: size }); pos += text.length; }
    t.characters = runs.map((r) => r[0]).join('');
    Object.defineProperty(t, 'hasMissingFont', { get: () => segs.some((sg) => !has(sg.fontName)) });
    t.getStyledTextSegments = () => segs.map((sg) => ({ ...sg, fontName: { ...sg.fontName } }));
    t.setRangeFontName = (a, b, f) => {
      requireLoaded(f);
      segs = segs.map((sg) => (sg.start >= a && sg.end <= b ? { ...sg, fontName: f } : sg));
    };
    t.setRangeTextStyleIdAsync = async (a, b, sid) => {
      const st = textStyles.find((x) => x.id === sid);
      if (!st) throw new Error('no style');
      requireLoaded(st.fontName);
      segs = segs.map((sg) => (sg.start >= a && sg.end <= b ? { ...sg, fontName: st.fontName, textStyleId: sid } : sg));
      log.linked++;
    };
    t.segments = () => segs;
    page.children.push(t);
    return t;
  };
  /** A frame holding text layers, as a web capture makes it. */
  const frameOf = (name, texts) => {
    const f = node('FRAME', { name });
    f.children.push(...texts);
    f.findAllWithCriteria = ({ types }) => texts.filter((t) => types.includes(t.type));
    return f;
  };
  /** A text style made by hand in Figma (not by the plugin). */
  const handStyle = async (name, family, style, size, lineHeight, letterSpacing) => {
    await figma.loadFontAsync({ family, style });
    const st = figma.createTextStyle();
    st.name = name;
    st.fontName = { family, style };
    st.fontSize = size;
    st.lineHeight = lineHeight;
    st.letterSpacing = letterSpacing;
    return st;
  };
  return { figma, ui, log, textStyles, available, textLayer, page, frameOf, handStyle, handlers, store };
}

const styles = (family, list) => list.map((style) => ({ family, style }));
const base = [
  ...styles('Inter', ['Regular', 'Medium', 'Semi Bold', 'Bold', 'Italic']),
  ...styles('Arimo', ['Regular', 'Bold', 'Italic', 'Bold Italic']),
  ...styles('Fraunces', ['Regular', 'Bold']),
  ...styles('Geist Mono', ['Regular']),
  ...styles('Lobster', ['Regular']),
];

async function run(env, msg) {
  env.ui.messages.length = 0;
  await env.ui.onmessage(msg);
  return env.ui.messages;
}

const env = fakeFigma([...base]);
const ctx = vm.createContext({ figma: env.figma, __html__: '<html></html>', console, setTimeout, clearTimeout, Promise, JSON, Math, Map, Set, Array, Object, String, Number, Error, RegExp, Uint8Array });
vm.runInContext(code, ctx);
await new Promise((r) => setTimeout(r, 20));
check('plugin starts and reports earlier styles', env.ui.messages.some((m) => m.type === 'init' && m.saved === 0));

const [checked] = await run(env, { type: 'check', payload });
const hn = payload.fonts.find((f) => f.name === 'Helvetica Neue LT Pro');
check('check: Helvetica Neue LT Pro is not installed, Arimo is', checked?.type === 'checked' && checked.status[hn.key].real === null && checked.status[hn.key].standIns.Arimo === true, JSON.stringify(checked?.status?.[hn.key]));
const fr = payload.fonts.find((f) => f.catalogFamily === 'Fraunces');
check('check: an installed Google font is found', fr && checked.status[fr.key].real === 'Fraunces');

const built = await run(env, { type: 'build', payload, choices: payload.fonts.map((f) => ({ key: f.key, family: null })), opts: { styles: true, variables: true, specimen: true } });
const done = built.find((m) => m.type === 'built');
const err = built.find((m) => m.type === 'error');
check('build finishes without errors', !!done && !err, err?.msg ?? '');
check('text styles are created for every style', env.log.styles.length === payload.styles.length, `${env.log.styles.length} of ${payload.styles.length}`);
const hnStyle = env.log.styles.find((s) => /^Real font: /.test(s.description));
const missingName = hnStyle ? JSON.parse(hnStyle.getPluginData('ffp')).font : null;
const missingFont = payload.fonts.find((f) => f.name === missingName);
check('a missing font is stood in by a free look-alike, with the real name kept', !!hnStyle && hnStyle.fontName.family !== missingName && JSON.parse(hnStyle.getPluginData('ffp')).realNames.includes(missingName), hnStyle ? `${missingName} -> ${hnStyle.fontName.family} ${hnStyle.fontName.style}` : 'none');
check('variables for sizes are made and bound', env.log.vars.some((v) => v.name.startsWith('size/')) && env.log.bound >= payload.styles.length, `${env.log.vars.length} variables, ${env.log.bound} bound`);
check('font family variables record the stand-in', env.log.vars.some((v) => v.name === 'font/Helvetica Neue LT Pro' && v.values.m1 === 'Arimo'));
check('specimen page made with vector and picture previews', env.log.pages.length === 1 && env.log.svgs >= 1 && env.log.images >= 1, `svg ${env.log.svgs}, png ${env.log.images}`);
const allText = [];
const walk = (n) => { if (n.type === 'TEXT') allText.push(n.characters); n.children?.forEach(walk); };
env.log.pages.forEach(walk);
check('text styles are grouped into style guide folders', env.log.styles.every((st) => /\/(Headings|Body|Buttons & labels|Code)\//.test(st.name)) && env.log.styles.length <= 16, env.log.styles.map((st) => st.name).slice(0, 6).join(' | '));
check('specimen is laid out as the style guide (header, labels, alphabet, Aa)', allText.includes('Style Guide ~ Typography') && ['Font', 'Letter Spacing', 'Size', 'Paragraph Spacing', 'Line Height', 'Weight'].every((k) => allText.includes(k)) && allText.some((t) => /^Font ~ /.test(t)) && allText.some((t) => /^ABCDEFGHIJKLMNOPQRSTUVWXYZ abc/.test(t)) && allText.includes('Aa') && !allText.includes('HEADINGS'), allText.slice(0, 8).join(' | '));
const frames = [];
const walkF = (n) => { if (n.type === 'FRAME') frames.push(n); n.children?.forEach(walkF); };
env.log.pages.forEach(walkF);
const rootFrame = env.log.pages[0].children[0];
const hex = (c) => '#' + [c.r, c.g, c.b].map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
const card = frames.find((f) => f.name === 'Aa');
const info = frames.find((f) => f.name === 'Font info');
const valuesCol = frames.find((f) => f.name === 'Values');
const sampleCol = frames.find((f) => f.name === 'Sample');
check('style guide sizes match the design (1000 wide, Aa card 217 by 166 radius 32, columns 263 and 604)', rootFrame.width === 1000 && card?.width === 217 && card?.height === 166 && card?.cornerRadius === 32 && hex(card.fills[0].color) === '#F3F3F3' && valuesCol?.width === 263 && sampleCol?.width === 604, `${rootFrame.width} ${card?.width}x${card?.height} r${card?.cornerRadius} ${valuesCol?.width} ${sampleCol?.width}`);
check('font info sits in a light grey box', !!info && info.fills[0] && hex(info.fills[0].color) === '#F7F7F8' && info.children.some((c) => /^Licence /.test(c.characters ?? '')), info ? hex(info.fills[0].color) : 'none');
check('header is black and text colours follow the design', hex(rootFrame.children[0].fills[0].color) === '#000000' && frames.some((f) => f.name === 'Size' && hex(f.children[0].fills[0].color) === '#667185' && hex(f.children[1].fills[0].color) === '#344054'));
check('button styles are labelled BUTTON/TAG', payload.styles.filter((s) => s.group === 'Buttons & labels' && !/link/i.test(s.token)).every((s) => /^BUTTON\/TAG \(button/.test(s.label)), payload.styles.map((s) => s.label).join(' | '));
check('paragraph spacing is read from the page', payload.styles.some((s) => (s.paragraphSpacing ?? 0) > 0), payload.styles.map((s) => s.paragraphSpacing).join(','));
// Save the built page for tests/figma-preview.mjs (draws it as HTML to look at).
const ser = (n) => ({ type: n.type, name: n.name, layoutMode: n.layoutMode, layoutWrap: n.layoutWrap, counterAxisSpacing: n.counterAxisSpacing, clipsContent: n.clipsContent, x: n.x, y: n.y, lineHeight: n.lineHeight, letterSpacing: n.letterSpacing, strokes: n.strokes, strokeWeight: n.strokeWeight, rangeFills: n.rangeFills, primaryAxisSizingMode: n.primaryAxisSizingMode, itemSpacing: n.itemSpacing, padding: [n.paddingTop, n.paddingRight, n.paddingBottom, n.paddingLeft], width: n.width, height: n.height, fills: n.fills, strokeBottomWeight: n.strokeBottomWeight, cornerRadius: n.cornerRadius, counterAxisAlignItems: n.counterAxisAlignItems, primaryAxisAlignItems: n.primaryAxisAlignItems, layoutSizingHorizontal: n.layoutSizingHorizontal, counterAxisSizingMode: n.counterAxisSizingMode, characters: n.characters, fontSize: n.fontSize, fontName: n.fontName, textStyle: n.textStyleId ? (() => { const st = env.log.styles.find((x) => x.id === n.textStyleId); return st && { size: st.fontSize, family: st.fontName.family, style: st.fontName.style, lineHeight: st.lineHeight, textCase: st.textCase }; })() : null, children: (n.children ?? []).map(ser) });
fs.writeFileSync(path.join(root, 'tests/output/figma-specimen.json'), JSON.stringify(ser(env.log.pages[0]).children[0]));
check('specimen shows licences with the legal note', allText.some((t) => /This is a summary, not legal advice\./.test(t)));
check('specimen says which fonts are not installed', allText.some((t) => /Not installed in Figma\. Shown with Arimo/.test(t)));
check('Google fonts also carry look-alikes, for when Figma lacks them', payload.fonts.filter((f) => f.catalogFamily).every((f) => f.standIn && f.standIn.family !== f.catalogFamily));
check('a code font Figma lacks falls back to a code font, not Inter', allText.some((t) => /Free on Google Fonts, not installed in this Figma yet\. Shown with Geist Mono/.test(t)), allText.filter((t) => /Shown with/.test(t)).join(' | ').slice(0, 300));
check('specimen links to where to get each font', env.log.links >= 1);
check('no em dashes in plugin copy', !/—/.test(allText.join(' ')) && !/—/.test(html));

// The user installs the real font, then clicks Check again.
env.available.push(...styles(missingFont?.cssFamily ?? 'none', ['Roman', 'Bold', 'Italic']));
const [re] = await run(env, { type: 'recheck' });
check('Check again swaps the real font in once installed', re?.result?.swapped >= 1 && hnStyle?.fontName.family === missingFont?.cssFamily, `${re?.result?.swapped} swapped, now ${hnStyle?.fontName.family} ${hnStyle?.fontName.style}`);

// Building again updates the same styles instead of adding new ones.
const before = env.textStyles.length;
await run(env, { type: 'build', payload, choices: [], opts: { styles: true, variables: true, specimen: false } });
check('building again reuses the same styles and variables', env.textStyles.length === before);

// ------------------------------------------------------------- see it on the web: conversions
// web.ts holds the pure parts (units, roles, the copied JSON). Bundle it on the fly to test it directly.
const { build: esbuild } = require('esbuild');
const webOut = path.join(root, 'tests/output/figma-web.mjs');
await esbuild({ entryPoints: [path.join(root, 'figma-plugin/src/web.ts')], bundle: true, format: 'esm', outfile: webOut, logLevel: 'warning' });
const web = await import(`${webOut}?${Date.now()}`);
check('line height: AUTO is 1.2 times the size', web.lineHeightPx({ unit: 'AUTO' }, 64) === 76.8 && web.lineHeightPx(null, 15) === 18);
check('line height: percent and pixels', web.lineHeightPx({ unit: 'PERCENT', value: 125 }, 16) === 20 && web.lineHeightPx({ unit: 'PIXELS', value: 68 }, 64) === 68);
check('letter spacing: Figma percent to em', web.letterSpacingEm({ unit: 'PERCENT', value: -2 }, 64) === -0.02 && web.letterSpacingEm({ unit: 'PERCENT', value: 0 }, 16) === 0);
check('letter spacing: Figma pixels to em', web.letterSpacingEm({ unit: 'PIXELS', value: -1.28 }, 64) === -0.02 && web.letterSpacingEm({ unit: 'PIXELS', value: 0.32 }, 16) === 0.02);
check('weight from the style name', [['Regular', 400], ['Medium', 500], ['SemiBold', 600], ['Semi Bold Italic', 600], ['Bold', 700], ['ExtraBold', 800], ['Black', 900], ['Light', 300], ['Thin', 100]].every(([n, w]) => web.weightFromStyle(n) === w));
const guessed = web.guessRoles([
  { name: 'Display', size: 64 }, { name: 'Heading 2', size: 28 }, { name: 'Body', size: 17 }, { name: 'Label', size: 13 }, { name: 'Caption', size: 12 },
  { name: 'Type/H1', size: 40 }, { name: 'Button/Primary', size: 14 }, { name: 'Nav link', size: 14 }, { name: 'Paragraph large', size: 20 }, { name: 'Quote', size: 22 },
]);
check('roles are guessed from style names', guessed.join(',') === 'h1,h2,body,label,none,h1,label,label,body,none', guessed.join(','));
const bySize = web.guessRoles([{ name: 'Big', size: 48 }, { name: 'Huge', size: 56 }, { name: 'Mid', size: 22 }, { name: 'Normal', size: 16 }, { name: 'Tiny', size: 12 }]);
check('roles fall back to sizes, with one main heading', bySize.join(',') === 'h2,h1,h2,body,label', bySize.join(','));
check('ticking an unused style gives it a role', web.roleWhenTicked({ name: 'Caption', size: 12 }) === 'label' && web.roleWhenTicked({ name: 'Quote', size: 22 }) === 'h2');
check('sites are read as web addresses', web.normalizeSite('ledgerly.example')?.url === 'https://ledgerly.example' && web.normalizeSite('http://a.example/pricing/')?.label === 'a.example/pricing' && web.normalizeSite('not a site') === null && web.normalizeSite('') === null);
check('the payload name is the style folder, else the file', web.payloadName('Northwind type', ['acme.com/Headings/H1', 'acme.com/Body/body']) === 'acme.com' && web.payloadName('Northwind type', ['Display', 'Body']) === 'Northwind type');

// ------------------------------------------------------------- see it on the web: reading styles in Figma
const wenv = fakeFigma([...base, ...styles('Fraunces', ['Semi Bold']), ...styles('Inter', ['Regular'])]);
vm.runInContext(code, vm.createContext({ figma: wenv.figma, __html__: '', console, setTimeout, clearTimeout, Promise, JSON, Math, Map, Set, Array, Object, String, Number, Error, RegExp, Uint8Array }));
await new Promise((r) => setTimeout(r, 20));
await wenv.handStyle('Display', 'Fraunces', 'Semi Bold', 64, { unit: 'PIXELS', value: 68 }, { unit: 'PERCENT', value: -2 });
await wenv.handStyle('Heading 2', 'Fraunces', 'Regular', 28, { unit: 'PERCENT', value: 120 }, { unit: 'PIXELS', value: -0.28 });
await wenv.handStyle('Body', 'Inter', 'Regular', 17, { unit: 'AUTO' }, { unit: 'PERCENT', value: 0 });
await wenv.handStyle('Label', 'Inter', 'Semi Bold', 13, { unit: 'PIXELS', value: 16 }, { unit: 'PIXELS', value: 0.13 });
await wenv.handStyle('Caption', 'Inter', 'Regular', 12, { unit: 'PIXELS', value: 16 }, { unit: 'PERCENT', value: 0 });
const [ws] = await run(wenv, { type: 'web-styles' });
const wsBy = Object.fromEntries((ws?.styles ?? []).map((s) => [s.name, s]));
check('See it on the web reads the local text styles', ws?.type === 'web-styles' && ws.styles.length === 5 && ws.file === 'Northwind type');
check('styles are read in web units', wsBy.Display?.weight === 600 && wsBy.Display.size === 64 && wsBy.Display.lineHeight === 68 && wsBy.Display.letterSpacing === -0.02 && wsBy['Heading 2'].lineHeight === 33.6 && wsBy['Heading 2'].letterSpacing === -0.01 && wsBy.Body.lineHeight === 20.4 && wsBy.Label.letterSpacing === 0.01, JSON.stringify(wsBy.Display));
check('styles come with guessed roles', ['Display:h1', 'Heading 2:h2', 'Body:body', 'Label:label', 'Caption:none'].every((p) => { const [n, r] = p.split(':'); return wsBy[n]?.role === r; }), ws?.styles.map((s) => `${s.name}:${s.role}`).join(' '));

// Recent sites and settings live in clientStorage.
const [rec] = await run(wenv, { type: 'remember-site', site: 'ledgerly.example' });
await run(wenv, { type: 'remember-site', site: 'northwind.example' });
const [rec2] = await run(wenv, { type: 'remember-site', site: 'ledgerly.example' });
check('recent sites are kept in clientStorage, newest first, no repeats', rec?.recent?.[0] === 'ledgerly.example' && rec2?.recent?.join(',') === 'ledgerly.example,northwind.example' && wenv.store['ffp-recent-sites']?.length === 2);
const [rec3] = await run(wenv, { type: 'forget-site', site: 'ledgerly.example' });
const [rec4] = await run(wenv, { type: 'clear-sites' });
check('recent sites can be removed and cleared', rec3?.recent?.join(',') === 'northwind.example' && rec4?.recent?.length === 0);
const [sset] = await run(wenv, { type: 'settings', settings: { specimen: false, naming: 'role' } });
check('settings are saved', sset?.settings?.specimen === false && sset.settings.variables === true && wenv.store['ffp-settings']?.naming === 'role');

// ------------------------------------------------------------- fix a captured page
const fenv = fakeFigma([...base]);
vm.runInContext(code, vm.createContext({ figma: fenv.figma, __html__: '', console, setTimeout, clearTimeout, Promise, JSON, Math, Map, Set, Array, Object, String, Number, Error, RegExp, Uint8Array }));
await new Promise((r) => setTimeout(r, 20));
// Create the site's styles first, so JetBrains Mono (not in this Figma) has a Font Finder Plus style to link to.
await run(fenv, { type: 'check', payload });
await run(fenv, { type: 'build', payload, choices: [], opts: { styles: true, variables: false, specimen: false, naming: 'role' } });
check('styles can be named by role (Settings)', fenv.log.styles.some((s) => s.name === 'Headings/Heading 1') && fenv.log.styles.every((s) => !s.name.startsWith('127.0.0.1/')), fenv.log.styles.map((s) => s.name).slice(0, 4).join(' | '));
const t1 = fenv.textLayer([['Stories ', 'Neue Haas Unica', 'Medium', 13], ['Gear', 'Neue Haas Unica', 'Bold', 13]]);
const t2 = fenv.textLayer([['Walking the long way', 'Fraunces', 'Regular', 50]]);
const t3 = fenv.textLayer([['const x = 1;', 'JetBrains Mono', 'Regular', 17]]);
const t4 = fenv.textLayer([['Subscribe', 'Neue Haas Unica', 'Medium', 14]]);
fenv.page.selection = [fenv.frameOf('Home · fieldjournal.example', [t1, t2, t3, t4])];
fenv.handlers.selectionchange?.();
const selMsg = fenv.ui.messages.at(-1);
check('the window hears when the selection changes', selMsg?.type === 'selection' && selMsg.selection.count === 1 && selMsg.selection.name === 'Home · fieldjournal.example');
const [scanned] = await run(fenv, { type: 'fix-scan' });
const sc = scanned?.result;
const haas = sc?.fonts.find((f) => f.family === 'Neue Haas Unica');
const jb = sc?.fonts.find((f) => f.family === 'JetBrains Mono');
check('Fix finds the fonts Figma is missing in the selection', sc?.texts === 4 && sc.fonts.length === 2 && haas?.layers === 2 && haas.styles.join(',') === 'Medium,Bold' && sc.layers === 3 && !sc.fonts.some((f) => f.family === 'Fraunces'), JSON.stringify(sc?.fonts.map((f) => [f.family, f.layers, f.styles])));
check('Fix offers replacements this Figma has', haas?.candidates.length >= 1 && haas.candidates.every((c) => base.some((b) => b.family === c.family)) && jb?.candidates[0]?.family === 'Geist Mono' && jb.licence === 'OFL', `${haas?.candidates.map((c) => c.family).join(',')} | ${jb?.candidates.map((c) => `${c.family} ${c.score}`).join(',')}`);
const [fixedMsg] = await run(fenv, { type: 'fix-apply', map: { 'Neue Haas Unica': 'Arimo', 'JetBrains Mono': 'Geist Mono' }, link: true });
const fx = fixedMsg?.result;
check('Fix swaps missing fonts and keeps the weight', fx?.layers === 3 && !t1.hasMissingFont && !t4.hasMissingFont && t1.segments()[0].fontName.family === 'Arimo' && t1.segments()[1].fontName.style === 'Bold', JSON.stringify(t1.segments().map((s) => s.fontName)));
check('Fix links runs to a matching Font Finder Plus text style', fx?.linked === 1 && !!t3.segments()[0].textStyleId && !t3.hasMissingFont, `${fx?.linked} linked, ${JSON.stringify(t3.segments()[0].fontName)}`);
check('Fix leaves installed fonts alone and is one undo step', t2.segments()[0].fontName.family === 'Fraunces' && fenv.log.undo === 1);
const [scanned2] = await run(fenv, { type: 'fix-scan' });
check('after fixing, nothing is left to fix', scanned2?.result?.fonts.length === 0);

// ------------------------------------------------------------- the window
const { chromium } = require('playwright');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 360, height: 640 } });
const sent = [];
await page.exposeFunction('__sent', (m) => sent.push(m));
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.setContent(html);
// The window posts to its parent (Figma). Here the parent is the page itself, so collect those messages,
// and catch what the window copies to the clipboard.
await page.evaluate(() => {
  const ours = ['check', 'build', 'recheck', 'open', 'goto-page', 'web-styles', 'remember-site', 'forget-site', 'clear-sites', 'settings', 'fix-scan', 'fix-apply'];
  window.addEventListener('message', (e) => { const m = e.data?.pluginMessage; if (m && ours.includes(m.type) && !('styles' in m) && !('recent' in m) && !('result' in m)) window.__sent(m); });
  document.addEventListener('copy', (e) => { window.__copied = e.target?.value ?? ''; });
});
const tell = (m) => page.evaluate((x) => window.postMessage({ pluginMessage: x }, '*'), m);
const mainText = async () => (await page.innerText('#main')).replace(/\s+/g, ' ');
const waitSent = async (pred) => { for (let i = 0; i < 40 && !sent.some(pred); i++) await page.waitForTimeout(25); return sent.some(pred); };
const paste = (t) => page.evaluate((x) => { const dt = new DataTransfer(); dt.setData('text/plain', x); document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true })); }, t);
const shots = [];
const dark = (on) => page.evaluate((d) => document.documentElement.classList.toggle('figma-dark', d), on);
async function shot(name, keepToast = false) {
  if (!keepToast) await page.evaluate(() => { document.getElementById('toast').hidden = true; });
  await page.waitForTimeout(80);
  for (const theme of ['light', 'dark']) {
    await dark(theme === 'dark');
    await page.waitForTimeout(260); // let colour transitions finish
    const file = path.join(root, `tests/output/figma-ui-${name}-${theme}.png`);
    await page.screenshot({ path: file });
    shots.push(file);
  }
  await dark(false);
}
const between = async (a, b) => page.evaluate(([x, y]) => { const r1 = document.querySelector(x).getBoundingClientRect(); const r2 = document.querySelector(y).getBoundingClientRect(); return Math.round(r2.top - r1.bottom); }, [a, b]);

await tell({ type: 'init', saved: 2, standIns: { count: 2, styles: ['H1', 'Body'], fonts: ['Helvetica Neue LT Pro'] }, file: 'Northwind type', settings: { variables: true, specimen: true, naming: 'site' }, recent: ['ledgerly.example', 'northwind.example'], selection: { count: 0, name: '' } });
await page.waitForSelector('#paste');
const home = await mainText();
check('Home: file bar, two doors, Fix row and a stand-in note', /This file Northwind type/.test(home) && /Bring a website's type in/.test(home) && /Paste from Font Finder Plus/.test(home) && /See your type on the web/.test(home) && /Fix a captured page/.test(home) && /2 text styles use a stand-in/.test(home) && (await page.locator('#recheck').count()) === 1 && (await page.locator('[data-go="settings"]').count()) === 1, home.slice(0, 200));
const headGap = await page.evaluate(() => { const h = document.querySelector('.ht h3'); const p = h.nextElementSibling; return Math.round(p.getBoundingClientRect().top - h.getBoundingClientRect().bottom); });
const sizes = await page.evaluate(() => ({ card: getComputedStyle(document.querySelector('.card')).borderRadius, btn: document.querySelector('#recheck').getBoundingClientRect().height, sq: document.querySelector('.sqbtn').getBoundingClientRect().height }));
check('cards have 18px corners, headings sit 6px from their text, buttons are 38px', sizes.card === '18px' && headGap === 6 && sizes.btn === 38 && sizes.sq === 38, `${sizes.card} gap ${headGap} btn ${sizes.btn} sq ${sizes.sq}`);
await shot('home');
await page.click('#recheck');
check('Check again asks the plugin', await waitSent((m) => m.type === 'recheck'));
await tell({ type: 'rechecked', result: { swapped: 0, still: ['Helvetica Neue LT Pro'], total: 2, standIns: { count: 2, styles: ['H1', 'Body'], fonts: ['Helvetica Neue LT Pro'] } } });
check('Check again says when the font is still missing', /Helvetica Neue LT Pro is still not installed/.test(await mainText()));
await shot('home-still');

// Settings
await page.click('[data-go="settings"]');
check('Settings: defaults, naming and recent websites', /When creating/.test(await mainText()) && /Name text styles/.test(await mainText()) && (await page.locator('.sitelist [data-forget]').count()) === 2);
await page.click('[data-def="specimen"]');
await page.click('[data-naming="role"]');
await waitSent((m) => m.type === 'settings' && m.settings.naming === 'role');
const setMsgs = sent.filter((m) => m.type === 'settings');
check('Settings are sent to the plugin to keep', setMsgs.at(-1)?.settings?.specimen === false && setMsgs.at(-1)?.settings?.naming === 'role');
await shot('settings');
await page.click('[data-naming="site"]');
await page.click('[data-def="specimen"]');
await page.click('[data-go="home"]');

// Bring a website in: a wrong paste, then the real one.
await paste('hello');
await page.waitForSelector('.alert');
check('other pastes get a clear message', /That isn't from Font Finder Plus/.test(await mainText()) && /not from Font Finder Plus/.test(await page.textContent('#toast')));
await shot('paste-error', true);
await page.click('#showmanual');
check('Paste into a box is offered', (await page.locator('#manual').count()) === 1 && (await page.locator('#readbox').isDisabled()));
await shot('paste-box');
await page.click('[data-go="paste"]');
await paste(payloadText);
await page.waitForSelector('.fcard');
await page.waitForTimeout(50);
check('paste is read and a check is asked for', sent.some((m) => m.type === 'check'));
await tell({ type: 'checked', status: checked.status });
await page.waitForFunction(() => /Not in Figma/.test(document.querySelector('#main').textContent));
const hnCard = page.locator('.fcard', { hasText: 'Helvetica Neue LT Pro' });
const frCard = page.locator('.fcard', { hasText: 'Fraunces' }).first();
check('Preview groups the styles by font, installed or not', /By font/.test(await mainText()) && /Not in Figma/.test(await hnCard.textContent()) && /In Figma/.test(await frCard.textContent()) && (await frCard.locator('.uses div').count()) >= 1 && /Heading 1/.test(await frCard.textContent()));
check('Preview shows the fonts drawn in the real font', (await page.locator('img.pv').count()) >= 2);
check('Preview shows which stand-in is used', /Arimo stands in for now/.test(await hnCard.textContent()));
check('licence badges: green only Free, amber only Paid', (await page.locator('.lic.free').first().textContent()) === 'Free' && /Paid/.test(await hnCard.locator('.lic').textContent()) && (await page.evaluate(() => getComputedStyle(document.querySelector('.lic.paid .dot')).backgroundColor)) === 'rgb(227, 155, 18)');
await shot('preview');
await page.click('[data-go="system"]');
check('Type system shows the scale', /Minor second · 1.067/.test(await mainText()) && (await page.locator('.scale div').count()) === payload.styles.length);
await shot('system');
await page.click('[data-go="standins"]');
const hnStand = page.locator('.fcard', { hasText: 'Helvetica Neue LT Pro' });
await hnStand.locator('[data-dd]').click();
check('Stand-ins offers look-alikes for missing fonts', (await hnStand.locator('[data-pick][data-family="Arimo"]').count()) === 1);
await shot('standins-menu');
await hnStand.locator('[data-pick][data-family="Arimo"]').click();
check('Stand-ins shows licences with the legal note and where to get it', /This is a summary, not legal advice\./.test(await hnStand.textContent()) && (await hnStand.locator('[data-url]').count()) === 1);
await shot('standins');
await page.click('.foot [data-go="preview"]');
await page.click('#build');
await page.waitForTimeout(50);
const b = sent.find((m) => m.type === 'build');
check('Create sends the payload, choices and settings', b && b.payload.fonts.length === payload.fonts.length && b.opts.styles && b.opts.specimen && b.opts.naming === 'site' && b.choices.some((c) => c.key === hn.key && c.family === 'Arimo'));
check('Create shows the progress screen', /Creating in Figma/.test(await mainText()));
await tell({ type: 'progress', msg: 'Making text styles…' });
await page.waitForTimeout(50);
check('progress moves the steps on, 8px below the bar', (await page.locator('.plist li.done').count()) >= 2 && (await between('.bar', '.plist')) === 8 + 14);
await shot('creating');
await tell({ type: 'built', result: { styles: 7, variables: 12, page: 'p1', missing: ['Helvetica Neue LT Pro'] } });
await page.waitForSelector('.donecard', { timeout: 5000 }).catch(() => {});
check('a finished build shows what was made', /7 text styles are in this file/.test(await mainText()) && (await page.locator('#again').count()) === 1 && (await page.locator('#gotopage').count()) === 1);
await shot('done');
await page.click('[data-go="preview"]').catch(() => {});
await page.evaluate(() => document.querySelector('.topbar [data-go]').click());
await page.waitForTimeout(30);
// A failed build keeps the choices and says why.
await paste(payloadText);
await tell({ type: 'checked', status: checked.status });
await page.click('#build');
await tell({ type: 'error', msg: 'Cannot write to a read-only file', during: 'build' });
await page.waitForSelector('.alert');
check('a failed build shows an error with Try again', /Couldn't create the styles/.test(await mainText()) && /read-only/.test(await mainText()) && (await page.locator('#build').count()) === 1);
const alertGap = await page.evaluate(() => {
  const ai = document.querySelector('.alert .ai').getBoundingClientRect();
  const b = document.querySelector('.alert .t b').getBoundingClientRect();
  return Math.round(b.top - ai.top);
});
check('error icon is top-aligned with the first line', alertGap >= 0 && alertGap <= 6, `${alertGap}px`);
await shot('build-error');
const redOnDark = await page.evaluate(() => { document.documentElement.classList.add('figma-dark'); const c = getComputedStyle(document.querySelector('.alert .ai')).color; document.documentElement.classList.remove('figma-dark'); return c; });
check('errors stay readable in dark mode', redOnDark === 'rgb(255, 138, 128)', redOnDark);
await page.click('.foot [data-go="preview"]');
await page.evaluate(() => document.querySelector('.topbar [data-go]').click());

// See it on the web
await page.click('[data-go="web-styles"]');
check('See it on the web asks for the text styles', await waitSent((m) => m.type === 'web-styles'));
await tell({ type: 'web-styles', styles: [], file: 'Northwind type' });
check('no text styles: an empty state that leads to a paste', /No text styles in this file/.test(await mainText()) && (await page.locator('.foot [data-go="paste"]').count()) === 1);
await shot('web-empty');
await tell({ type: 'web-styles', styles: ws.styles, file: 'Northwind type' });
await page.waitForSelector('.srow');
check('styles are grouped by font with a checkbox and a role', (await page.locator('.card.fg').count()) === 2 && (await page.locator('.srow .ck').count()) === 5 && (await page.locator('.srow .rolebtn').count()) === 5);
const roleText = await page.locator('.srow .rolebtn').allTextContents();
check('roles use plain names', roleText.join('|') === 'Main heading|Other headings|Paragraphs|Buttons and menu|Not used', roleText.join('|'));
const rowGeo = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('.card.fg')[0].querySelectorAll('.srow')];
  const ck = rows[0].querySelector('.ck').getBoundingClientRect();
  const b = rows[0].querySelector('.si b').getBoundingClientRect();
  return { ckTop: Math.round(ck.top), bTop: Math.round(b.top), gap: Math.round(rows[1].querySelector('.si').getBoundingClientRect().top - rows[0].querySelector('.si').getBoundingClientRect().bottom), border: getComputedStyle(rows[1]).borderTopWidth };
});
check('checkboxes top-aligned, rows 30px apart without dividers', rowGeo.ckTop === rowGeo.bTop && rowGeo.gap === 30 && rowGeo.border === '0px', JSON.stringify(rowGeo));
await shot('web-styles');
// Caption is unticked; tick it (it gets a role), then set Heading 2 to Not used through its menu.
await page.click('[data-use][aria-label="Use Caption"]');
check('ticking an unused style gives it a role', (await page.locator('.srow', { hasText: 'Caption' }).locator('.rolebtn').textContent()) === 'Buttons and menu');
await page.click('[data-use][aria-label="Use Caption"]');
await page.locator('.srow', { hasText: 'Heading 2' }).locator('.rolebtn').click();
await shot('web-role-menu');
await page.click('[data-role][data-value="none"]');
check('picking Not used unticks the style', (await page.locator('[data-use][aria-label="Use Heading 2"]').getAttribute('aria-checked')) === 'false');
await page.locator('.srow', { hasText: 'Heading 2' }).locator('.rolebtn').click();
await page.click('[data-role][data-value="h2"]');
await page.click('#web-next');
check('Pick a site: a 44px field and recent sites as chips', (await page.locator('.field').evaluate((e) => e.getBoundingClientRect().height)) === 44 && (await page.locator('.rchip').count()) === 2 && (await page.locator('#copy').isDisabled()));
await page.fill('#site', 'ledgerly.example/pricing');
check('a typed site enables Copy for Chrome', !(await page.locator('#copy').isDisabled()) && /Copy for Chrome/.test(await page.textContent('#copy')));
await shot('web-site');
await page.click('#copy');
await page.waitForTimeout(80);
const copied = await page.evaluate(() => window.__copied);
let wp = null;
try { wp = JSON.parse(copied); } catch {}
check('Copy for Chrome copies the figma-type JSON', !!wp && Object.keys(wp).join(',') === 'ffp,v,name,site,styles' && wp.ffp === 'figma-type' && wp.v === 1 && wp.name === 'Northwind type' && wp.site === 'https://ledgerly.example/pricing', copied?.slice(0, 120));
const d = wp?.styles?.find((s) => s.name === 'Display');
check('each style carries role, family, weight and web units', wp?.styles?.length === 4 && !!d && Object.keys(d).join(',') === 'name,role,family,weight,size,lineHeight,letterSpacing' && d.role === 'h1' && d.family === 'Fraunces' && d.weight === 600 && d.size === 64 && d.lineHeight === 68 && d.letterSpacing === -0.02 && wp.styles.find((s) => s.name === 'Body')?.lineHeight === 20.4 && !wp.styles.some((s) => s.name === 'Caption'), JSON.stringify(wp?.styles));
check('the copied screen says what to do in Chrome', (await page.textContent('#copied-how')) === 'In Chrome, open ledgerly.example/pricing, click Font Finder Plus, then System → Paste type from Figma.');
check('the site is remembered', await waitSent((m) => m.type === 'remember-site' && m.site === 'ledgerly.example/pricing'));
check('no Open in Chrome button pretends to work', !/Open .* in Chrome/.test(await mainText()));
await shot('web-copied');
await page.click('.topbar [data-go]');
await page.click('[data-forget="northwind.example"]');
check('a recent site can be removed with its x', (await waitSent((m) => m.type === 'forget-site' && m.site === 'northwind.example')) && (await page.locator('.rchip').count()) === 1);
await page.evaluate(() => document.querySelector('.topbar [data-go]').click());
await page.evaluate(() => document.querySelector('.topbar [data-go]').click());

// Fix a captured page
await page.click('[data-go="fix-select"]');
check('Fix: asks for a frame and waits for one', /Select a captured frame/.test(await mainText()) && (await page.locator('#fixscan').isDisabled()));
await shot('fix-select');
await tell({ type: 'selection', selection: { count: 1, name: 'Home · fieldjournal.example' } });
await page.waitForFunction(() => !document.querySelector('#fixscan').disabled);
await page.click('#fixscan');
check('Find missing fonts scans the selection', await waitSent((m) => m.type === 'fix-scan'));
await tell({ type: 'fix-scanned', result: sc });
await page.waitForSelector('#fixapply');
check('missing fonts are listed with a replacement each', (await page.locator('.card.fg').count()) === 2 && /Neue Haas Unica/.test(await mainText()) && /2 layers/.test(await mainText()) && /Fix 3 layers/.test(await page.textContent('#fixapply')));
await shot('fix');
await page.locator('.card.fg', { hasText: 'Neue Haas Unica' }).locator('[data-dd]').click();
const alt = await page.locator('.menu [data-pick]').nth(1).getAttribute('data-family');
await page.locator('.menu [data-pick]').nth(1).click();
await page.click('#link');
await page.click('#fixapply');
await waitSent((m) => m.type === 'fix-apply');
const fa = sent.find((m) => m.type === 'fix-apply');
check('Fix sends the chosen replacements', fa?.map['Neue Haas Unica'] === alt && fa.map['JetBrains Mono'] === 'Geist Mono' && fa.link === false, JSON.stringify(fa));
await tell({ type: 'fixed', result: fx });
await page.waitForFunction(() => /Fixed/.test(document.querySelector('#main').textContent));
check('Fixed says how many layers changed and how to undo', /Fixed 3 layers/.test(await mainText()) && /to undo/.test(await mainText()) && /Linked to text styles/.test(await mainText()));
await shot('fixed');
await tell({ type: 'fix-scanned', result: { ...sc, fonts: [], layers: 0 } });
await page.waitForTimeout(50);
check('Nothing to fix has its own empty state', /Nothing to fix/.test(await mainText()));
await shot('fix-nothing');

// The rules the design insists on.
const rules = await page.evaluate(() => {
  const html = document.documentElement.outerHTML;
  return { noPulse: !/@keyframes\s+pulse/i.test(html) };
});
check('no pulsing animations', rules.noPulse);
check('no em dashes in plugin copy', !/—/.test(html));
check('window has no script errors', errors.length === 0, errors.join(' | '));
await browser.close();
console.log(`Screenshots: ${shots.length} in tests/output/figma-ui-*.png`);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
