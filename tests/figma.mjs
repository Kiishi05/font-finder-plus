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
  const log = { notify: [], svgs: 0, images: 0, links: 0, pages: [], styles: [], vars: [], bound: 0, texts: 0 };
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
  const figma = {
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
  return { figma, ui, log, textStyles, available };
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
check('specimen shows licences with the legal note', allText.some((t) => /This is a summary, not legal advice\./.test(t)));
check('specimen says which fonts are not installed', allText.some((t) => /Not installed in Figma\. Shown with Arimo/.test(t)));
check('Google fonts also carry look-alikes, for when Figma lacks them', payload.fonts.filter((f) => f.catalogFamily).every((f) => f.standIn && f.standIn.family !== f.catalogFamily));
check('a code font Figma lacks falls back to a code font, not Inter', allText.some((t) => /Google Fonts, but this Figma does not have it yet\. Shown with Geist Mono/.test(t)), allText.filter((t) => /Shown with/.test(t)).join(' | ').slice(0, 300));
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

// ------------------------------------------------------------- the window
const { chromium } = require('playwright');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 420, height: 640 } });
const sent = [];
await page.exposeFunction('__sent', (m) => sent.push(m));
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.setContent(html);
// The window posts to its parent (Figma). Here the parent is the page itself, so collect those messages.
await page.evaluate(() => window.addEventListener('message', (e) => { const m = e.data?.pluginMessage; if (m && ['check', 'build', 'recheck', 'open'].includes(m.type)) window.__sent(m); }));
await page.evaluate(() => window.postMessage({ pluginMessage: { type: 'init', saved: 2 } }, '*'));
await page.waitForSelector('#paste');
check('window asks for a paste and offers Check again', (await page.locator('#recheck').count()) === 1 && /Paste from Font Finder Plus/.test(await page.textContent('#main')));
await page.evaluate((t) => {
  const dt = new DataTransfer();
  dt.setData('text/plain', t);
  document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }));
}, payloadText);
await page.waitForFunction(() => !!document.querySelector('.fonts'));
await page.waitForTimeout(100);
check('paste is read and a check is asked for', sent.some((m) => m.type === 'check'));
await page.evaluate((st) => window.postMessage({ pluginMessage: { type: 'checked', status: st } }, '*'), checked.status);
await page.waitForSelector('.chip');
const listText = await page.textContent('.fonts');
check('window lists fonts as installed or not', /Installed/.test(listText) && /Not installed/.test(listText));
check('window offers stand-ins for missing fonts', (await page.locator('select[data-key]').count()) >= 1 && (await page.locator('select[data-key]').evaluateAll((els) => els.some((e) => /Arimo/.test(e.innerHTML)))));
check('window shows previews', (await page.locator('img.pv').count()) >= 2);
check('window shows licences with the legal note', /This is a summary, not legal advice\./.test(listText));
await page.click('#build');
await page.waitForTimeout(100);
const b = sent.find((m) => m.type === 'build');
check('Create sends the payload and choices', b && b.payload.fonts.length === payload.fonts.length && b.opts.styles && b.opts.specimen);
await page.screenshot({ path: path.join(root, 'tests/output/figma-ui.png'), fullPage: true });
await page.evaluate(() => { document.documentElement.classList.add('figma-dark'); document.documentElement.style.setProperty('--figma-color-bg', '#2c2c2c'); document.documentElement.style.setProperty('--figma-color-text', '#fff'); document.documentElement.style.setProperty('--figma-color-bg-secondary', '#383838'); document.documentElement.style.setProperty('--figma-color-border', '#444'); });
await page.screenshot({ path: path.join(root, 'tests/output/figma-ui-dark.png'), fullPage: true });
await page.evaluate(() => window.postMessage({ pluginMessage: { type: 'init', saved: 0 } }, '*'));
check('window has no script errors', errors.length === 0, errors.join(' | '));
// A paste that is not from the extension.
await page.click('#again');
await page.evaluate(() => {
  const dt = new DataTransfer();
  dt.setData('text/plain', 'hello');
  document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }));
});
check('other pastes get a clear message', /not from Font Finder Plus/.test(await page.textContent('#toast')));
await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
