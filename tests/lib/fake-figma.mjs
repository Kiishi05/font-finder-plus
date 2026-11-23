// A stand-in for the `figma` global, strict like the real one (fonts must be loaded
// before use, missing fonts fail to load), so the plugin's code.js can run in Node.
// Used by tests/figma.mjs and tests/capture-all.mjs.
import vm from 'node:vm';

export function fakeFigma(available) {
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

export const styles = (family, list) => list.map((style) => ({ family, style }));
export const base = [
  ...styles('Inter', ['Regular', 'Medium', 'Semi Bold', 'Bold', 'Italic']),
  ...styles('Arimo', ['Regular', 'Bold', 'Italic', 'Bold Italic']),
  ...styles('Fraunces', ['Regular', 'Bold']),
  ...styles('Geist Mono', ['Regular']),
  ...styles('Lobster', ['Regular']),
];

export async function run(env, msg) {
  env.ui.messages.length = 0;
  await env.ui.onmessage(msg);
  return env.ui.messages;
}

/** Run the plugin's built code.js against a fake Figma. */
export async function startPlugin(env, code, html = '') {
  vm.runInContext(code, vm.createContext({ figma: env.figma, __html__: html, console, setTimeout, clearTimeout, Promise, JSON, Math, Map, Set, Array, Object, String, Number, Error, RegExp, Uint8Array }));
  await new Promise((r) => setTimeout(r, 20));
}
