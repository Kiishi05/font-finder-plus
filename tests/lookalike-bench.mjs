// Accuracy test for "closest free font" (Make it free, Similar fonts, Figma
// stand-ins). Each case is a font whose right free answer is known: a copy of
// a famous font that ships with Linux, or a Google font built from another one.
// For each, the matcher must put the expected family first (top 1) or near the
// top (top 3). Run: node tests/lookalike-bench.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fontkit = require('fontkit');
const { build } = require('esbuild');
const cacheDir = path.join(root, 'node_modules/.cache/bench');
fs.mkdirSync(cacheDir, { recursive: true });
const tmp = path.join(cacheDir, 'core.mjs');
await build({
  stdin: { contents: "export * from './src/shared/similar.ts'; export * from './src/shared/shape.ts'; export * from './src/shared/glyphprint.ts'; export * from './src/shared/matchcore.ts'; export * from './src/shared/lookalike-core.ts';", resolveDir: root, loader: 'ts' },
  outfile: tmp, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent', loader: { '.json': 'json' },
});
const m = await import(`${tmp}?t=${Date.now()}`);
const meta = JSON.parse(fs.readFileSync(path.join(root, 'src/shared/data/glyph-index.json'), 'utf8'));
const ix = new Uint8Array(zlib.gunzipSync(fs.readFileSync(path.join(root, 'public/data/glyph-index.bin.gz'))));

const L = '/usr/share/fonts/truetype';
// [query, how to get it, expected free families (first is the main answer), why]
const CASES = [
  ['Liberation Sans', `${L}/liberation/LiberationSans-Regular.ttf`, ['Arimo'], 'same design'],
  ['Liberation Serif', `${L}/liberation/LiberationSerif-Regular.ttf`, ['Tinos'], 'same design'],
  ['Liberation Mono', `${L}/liberation/LiberationMono-Regular.ttf`, ['Cousine'], 'same design'],
  ['FreeSans (Helvetica copy)', `${L}/freefont/FreeSans.ttf`, ['Arimo'], 'Arial/Arimo is the free Helvetica stand-in'],
  ['FreeSerif (Times copy)', `${L}/freefont/FreeSerif.ttf`, ['Tinos', 'STIX Two Text'], 'Tinos matches Times New Roman; STIX Two is also Times-based'],
  ['FreeMono (Courier copy)', `${L}/freefont/FreeMono.ttf`, ['Courier Prime'], 'Courier Prime is the free Courier'],
  ['Courier 10 Pitch', '/usr/share/fonts/X11/Type1/c0419bt_.pfb', ['Courier Prime'], 'Courier design'],
  ['Carlito (Calibri metrics)', `${L}/crosextra/Carlito-Regular.ttf`, ['Lato'], 'Carlito is built from Lato'],
  ['Bitstream Charter', '/usr/share/fonts/X11/Type1/c0648bt_.pfb', ['Charis SIL'], 'Charis SIL is built from Charter'],
  ['Noto Sans', 'gf:Noto Sans', ['Open Sans'], 'Noto Sans Latin is built from Open Sans'],
  ['Open Sans', 'gf:Open Sans', ['Noto Sans'], 'same design'],
  ['Public Sans', 'gf:Public Sans', ['Libre Franklin'], 'Public Sans is built from Libre Franklin'],
  ['Libre Franklin', 'gf:Libre Franklin', ['Public Sans'], 'same design'],
  ['Heebo (Roboto Latin)', 'gf:Heebo', ['Roboto'], 'Heebo extends Roboto'],
  ['Yantramanav (Roboto Latin)', 'gf:Yantramanav', ['Roboto', 'Heebo'], 'Latin is Roboto'],
  ['Assistant (Source Sans Latin)', 'gf:Assistant', ['Source Sans 3'], 'Assistant extends Source Sans'],
  ['Cairo (Titillium Latin)', 'gf:Cairo', ['Titillium Web'], 'Latin is Titillium Web'],
  ['Readex Pro (Lexend)', 'gf:Readex Pro', ['Lexend'], 'Readex Pro extends Lexend'],
  ['Crimson Pro', 'gf:Crimson Pro', ['Crimson Text'], 'redraw of Crimson Text'],
  ['Crimson Text', 'gf:Crimson Text', ['Crimson Pro'], 'same design'],
  ['Fira Code', 'gf:Fira Code', ['Fira Mono'], 'Fira Code extends Fira Mono'],
  ['PT Sans Caption', 'gf:PT Sans Caption', ['PT Sans'], 'caption cut of PT Sans'],
  ['PT Serif Caption', 'gf:PT Serif Caption', ['PT Serif'], 'caption cut of PT Serif'],
  ['Ubuntu Sans', 'gf:Ubuntu Sans', ['Ubuntu'], 'rework of Ubuntu'],
  ['Roboto Flex', 'gf:Roboto Flex', ['Roboto'], 'variable Roboto'],
  ['Atkinson Hyperlegible Next', 'gf:Atkinson Hyperlegible Next', ['Atkinson Hyperlegible'], 'new version'],
  ['Alegreya Sans', 'gf:Alegreya Sans', ['Alegreya Sans SC'], 'skip: variant'],
  ['Merriweather Sans', 'gf:Merriweather Sans', ['Merriweather'], 'skip: different design'],
  ['Noto Serif', 'gf:Noto Serif', ['Noto Serif Display', 'Tinos'], 'skip'],
  ['IBM Plex Sans', 'gf:IBM Plex Sans', ['IBM Plex Sans Condensed'], 'skip'],
  ['Hanken Grotesk', 'gf:Hanken Grotesk', ['Schibsted Grotesk'], 'skip'],
  ['Montserrat', 'gf:Montserrat', ['Montserrat Alternates'], 'skip'],
  ['Arimo', 'gf:Arimo', ['Liberation Sans'], 'skip'],
  ['Cousine', 'gf:Cousine', ['Liberation Mono'], 'skip'],
  ['Gelasio (Georgia metrics)', 'gf:Gelasio', ['Georgia'], 'skip'],
  ['Spline Sans Mono', 'gf:Spline Sans Mono', ['Spline Sans'], 'skip'],
  ['Roboto Serif', 'gf:Roboto Serif', ['Roboto Slab'], 'skip'],
  ['Encode Sans', 'gf:Encode Sans', ['Encode Sans Expanded'], 'skip'],
  ['Lato', 'gf:Lato', ['Carlito'], 'Carlito is built from Lato'],
  ['Titillium Web', 'gf:Titillium Web', ['Cairo'], 'Cairo Latin is Titillium'],
  ['Source Sans 3', 'gf:Source Sans 3', ['Assistant', 'Varta'], 'Assistant extends Source Sans'],
  ['Lexend', 'gf:Lexend', ['Readex Pro'], 'Readex Pro extends Lexend'],
  ['Fira Mono', 'gf:Fira Mono', ['Fira Code'], 'same design'],
  ['Ubuntu', 'gf:Ubuntu', ['Ubuntu Sans'], 'same design'],
  ['PT Sans', 'gf:PT Sans', ['PT Sans Caption'], 'same design'],
  ['PT Serif', 'gf:PT Serif', ['PT Serif Caption'], 'same design'],
  ['Courier Prime', 'gf:Courier Prime', ['Cousine', 'Courier New'], 'skip'],
  ['Tinos', 'gf:Tinos', ['Liberation Serif', 'Times New Roman'], 'skip if none'],
  ['Inter Tight', 'gf:Inter Tight', ['Inter'], 'tight-spaced Inter'],
];

const ACTIVE = CASES.filter((c) => !c[3].startsWith('skip'));
const TEXT = [...new Set((m.SHAPE_TEXT + m.LOOKALIKE_CHARS + 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ').split(''))].join('');

async function loadFont(src) {
  if (!src.startsWith('gf:')) {
    if (!fs.existsSync(src)) return null;
    return fs.readFileSync(src);
  }
  const fam = src.slice(3);
  const file = path.join(cacheDir, `${fam.replace(/\W+/g, '_')}.font`);
  if (fs.existsSync(file)) return fs.readFileSync(file);
  const css = await (await fetch(`https://fonts.googleapis.com/css2?family=${fam.replace(/ /g, '+')}&text=${encodeURIComponent(TEXT)}`)).text();
  const url = /url\((https:[^)]+)\)/.exec(css)?.[1];
  if (!url) return null;
  const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
  fs.writeFileSync(file, buf);
  return buf;
}

function prints(font) {
  const upm = font.unitsPerEm;
  const q = [];
  for (const c of m.LOOKALIKE_CHARS) {
    const cp = c.codePointAt(0);
    if (!font.hasGlyphForCodePoint(cp)) continue;
    const g = font.glyphForCodePoint(cp);
    const bmp = m.raster(g, upm, 96);
    const ink = bmp && m.cropInk(bmp);
    if (!ink) continue;
    const rec = m.makeRecord(ink, (g.bbox.maxY - g.bbox.minY) / upm, g.bbox.minY / upm);
    const pq = m.recordToQuery(rec, m.GLYPH_CHARS.indexOf(c));
    q.push({ ...pq, bits: Uint8Array.from(pq.bits) });
  }
  return q;
}

const rankOf = (list, names) => {
  const i = list.findIndex((x) => names.includes(x));
  return i < 0 ? 999 : i + 1;
};

let browserPage = null;
async function canvasMeasure(buf) {
  if (!browserPage) {
    const { chromium } = require('playwright');
    const b = await chromium.launch();
    browserPage = await b.newPage();
    browserPage.__browser = b;
    const js = path.join(cacheDir, 'page.js');
    await build({ stdin: { contents: "import * as g from './src/shared/glyphprint.ts'; import * as s from './src/shared/shape.ts'; window.G = g; window.S = s;", resolveDir: root, loader: 'ts' }, outfile: js, bundle: true, format: 'iife', logLevel: 'silent', loader: { '.json': 'json' } });
    await browserPage.setContent('<meta charset="utf-8"><body></body>');
    await browserPage.addScriptTag({ path: js });
  }
  return browserPage.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const name = 'Q' + Math.random().toString(36).slice(2);
    const ff = new FontFace(name, bytes);
    await ff.load();
    document.fonts.add(ff);
    const prints = G.printsFromCanvas(`"${name}"`);
    const shape = S.shapeFromCanvas(`"${name}"`);
    document.fonts.delete(ff);
    return { prints, shape };
  }, Buffer.from(buf).toString('base64'));
}

export async function runBench({ quiet = false, share, canvas = false } = {}) {
  const rows = [];
  for (const [name, src, expect, why] of ACTIVE) {
    const pool = new Set(m.similarTo(m.shapeOf('Roboto'), { limit: 5000 }).map((x) => x.family));
    const exists = expect.filter((e) => pool.has(e) && !(src.startsWith('gf:') && e.startsWith(src.slice(3) + ' ')));
    if (!exists.length) continue;
    const buf = await loadFont(src).catch(() => null);
    if (!buf) { if (!quiet) console.log(`SKIP  ${name} (font not available)`); continue; }
    let f0;
    try { f0 = fontkit.create(buf); } catch { if (!quiet) console.log(`SKIP  ${name} (cannot read this font format)`); continue; }
    const font = f0.fonts ? f0.fonts[0] : f0;
    let shape = m.shapeFromFont(font);
    let queryPrints = null;
    if (canvas) {
      const c = await canvasMeasure(buf);
      shape = c.shape;
      queryPrints = c.prints.map((p) => ({ ...p, bits: Uint8Array.from(p.bits) }));
    }
    if (!shape) continue;
    const self = src.startsWith('gf:') ? src.slice(3) : m.shapeOf(name.replace(/ \(.*$/, '')) ? name.replace(/ \(.*$/, '') : undefined;
    const cls = m.classOf?.(self) ?? undefined;
    const metric = m.similarTo(shape, { exclude: self, limit: 5000 });
    const ranked = m.rankFonts(ix, meta.families, meta.weights, queryPrints ?? prints(font), meta.families.length, false);
    const letters = new Map(ranked.map((x) => [x.family, Math.round(Math.max(0, Math.min(1, (x.total - 0.75) / 0.23)) * 100)]));
    const blended = m.blend(metric.filter((x) => x.family !== self), letters, 50, share);
    const lettersOnly = ranked.map((x) => x.family).filter((f) => f !== self && !(self && f.startsWith(self + ' ')));
    const r = {
      name, expect: exists, why,
      final: rankOf(blended.map((x) => x.family), exists),
      metric: rankOf(metric.map((x) => x.family), exists),
      letters: rankOf(lettersOnly, exists),
      top: blended.slice(0, 3).map((x) => `${x.family} ${x.score}`),
    };
    rows.push(r);
    if (process.env.DEBUG && r.final > 1) console.log('      letters top:', ranked.slice(0, 10).map((x) => `${x.family} ${Math.round(Math.max(0, (x.total - 0.75) / 0.23) * 100)}`).join(' | '));
    if (!quiet) console.log(`${r.final === 1 ? 'TOP1' : r.final <= 3 ? 'TOP3' : 'MISS'}  ${name.padEnd(32)} want ${exists[0].padEnd(20)} rank ${String(r.final).padStart(3)} (proportions ${r.metric}, letters ${r.letters})  got: ${r.top.join(' | ')}`);
  }
  const top1 = rows.filter((r) => r.final === 1).length;
  const top3 = rows.filter((r) => r.final <= 3).length;
  if (!quiet) console.log(`\n${canvas ? 'As the page draws it' : 'From the font file'}: top 1 ${top1}/${rows.length}, top 3 ${top3}/${rows.length}`);
  if (browserPage) { await browserPage.__browser.close(); browserPage = null; }
  return { rows, top1, top3, n: rows.length };
}

if (process.argv[2] === 'sweep') {
  for (const share of [0.4, 0.5, 0.6, 0.7, 0.8, 0.9]) {
    const r = await runBench({ quiet: true, share });
    console.log(`letters ${share}: top1 ${r.top1}/${r.n}, top3 ${r.top3}/${r.n}`);
  }
  process.exit(0);
}
if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv[2] !== 'sweep') {
  const { top1, top3, n } = await runBench({ canvas: process.argv[2] === 'canvas' });
  fs.mkdirSync(path.join(root, 'tests/output'), { recursive: true });
  process.exit(top1 / n >= 0.85 && top3 / n >= 0.95 ? 0 : 1);
}
