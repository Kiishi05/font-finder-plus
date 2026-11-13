// Builds the free-font catalogues beyond Google Fonts:
//   Fontshare (Indian Type Foundry): names, licence, designers, and each family
//     measured like Google Fonts (shape + letter prints), so it can be suggested
//     as a look-alike, swapped on the page and found in images.
//   Font Squirrel, Bye Bye Binary, Collletttivo, Open Foundry: names, links and
//     foundry, to confirm a font's name and say where to get it.
// Writes src/shared/data/free-catalog.json, src/shared/data/fontshare-shapes.json
// and public/data/fontshare-index.bin.gz. Run: npm run build:free
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const fontkit = require('fontkit');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36' };
const tmp = path.join(root, 'node_modules/.cache/ffp-free.mjs');
await build({ stdin: { contents: "export * from './src/shared/shape.ts'; export * from './src/shared/glyphprint.ts';", resolveDir: root, loader: 'ts' }, outfile: tmp, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent', loader: { '.json': 'json' } });
const m = await import(`${tmp}?t=${Date.now()}`);
const google = JSON.parse(fs.readFileSync(path.join(root, 'src/shared/data/gf-catalog.json'), 'utf8')).families;
const squash = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const inGoogle = new Set(Object.keys(google).map(squash));
const text = async (u) => (await fetch(u, { headers: UA })).text();
const titleCase = (slug) => slug.split('-').map((w) => (/^(bbb|eb|dm|ibm|pt|mplus)$/i.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1))).join(' ');

const fonts = {};
const add = (name, e) => {
  if (!name || inGoogle.has(squash(name)) || fonts[name]) return;
  fonts[name] = e;
};

// ------------------------------------------------------------- Fontshare
const fsList = [];
for (let off = 0; ; off += 100) {
  const d = JSON.parse(await text(`https://api.fontshare.com/v2/fonts?offset=${off}&limit=100`));
  fsList.push(...d.fonts);
  if (!d.has_more) break;
}
const CLASS = (c) => (/script|handwritten/i.test(c) ? 'script' : /mono/i.test(c) ? 'mono' : /display/i.test(c) && !/sans|serif/i.test(c) ? 'display' : /serif|slab/i.test(c) ? 'serif' : /sans/i.test(c) ? 'sans' : 'display');
const shapes = {};
const records = [];
const fsFamilies = [];
const fsWeights = [];
const per = m.GLYPH_CHARS.length * m.RECORD;
function prints(font) {
  const out = new Uint8Array(per);
  let any = 0;
  for (let i = 0; i < m.GLYPH_CHARS.length; i++) {
    const cp = m.GLYPH_CHARS.codePointAt(i);
    if (!font.hasGlyphForCodePoint(cp)) continue;
    const g = font.glyphForCodePoint(cp);
    const ink = m.cropInk(m.raster(g, font.unitsPerEm, 96));
    if (!ink) continue;
    out.set(m.makeRecord(ink, (g.bbox.maxY - g.bbox.minY) / font.unitsPerEm, g.bbox.minY / font.unitsPerEm), i * m.RECORD);
    any++;
  }
  return any >= 20 ? out : null;
}
async function fsFile(slug, weight) {
  const css = await text(`https://api.fontshare.com/v2/css?f[]=${slug}@${weight}&display=swap`);
  const faces = [...css.matchAll(/@font-face\s*{([^}]*)}/g)].map((x) => x[1]).filter((b) => /font-style:\s*normal/.test(b));
  const url = faces.map((b) => /url\('?(\/\/[^')]+\.woff2)'?\)/.exec(b)?.[1]).find(Boolean);
  if (!url) return null;
  const buf = Buffer.from(await (await fetch(`https:${url}`, { headers: UA })).arrayBuffer());
  const f0 = fontkit.create(buf);
  return f0.fonts ? f0.fonts[0] : f0;
}
for (const f of fsList) {
  if (inGoogle.has(squash(f.name))) continue;
  const weights = [...new Set(f.styles.filter((s) => !s.is_italic && s.weight?.number > 1).map((s) => s.weight.number))].sort((a, b) => a - b);
  const italic = f.styles.some((s) => s.is_italic);
  add(f.name, {
    s: 'fontshare',
    u: `https://www.fontshare.com/fonts/${f.slug}`,
    slug: f.slug,
    l: f.license_type === 'sil_ofl' ? 'OFL' : 'fontshare',
    c: CLASS(f.category ?? ''),
    d: (f.designers ?? []).map((x) => x.name).filter(Boolean),
    f: f.publisher?.name ?? 'Indian Type Foundry',
    w: weights,
    i: italic,
  });
  try {
    const near = (t) => weights.reduce((a, b) => (Math.abs(b - t) < Math.abs(a - t) ? b : a), weights[0]);
    const reg = await fsFile(f.slug, near(400));
    if (!reg) continue;
    const shape = m.shapeFromFont(m.regularInstance(reg));
    const r = prints(m.regularInstance(reg));
    if (!shape || !r) continue;
    const boldW = near(700);
    const bold = boldW >= 600 ? await fsFile(f.slug, boldW).catch(() => null) : null;
    const b = bold ? prints(bold) : null;
    shapes[f.name] = m.packShape(shape);
    const block = new Uint8Array(per * 2);
    block.set(r, 0);
    if (b) block.set(b, per);
    records.push(block);
    fsFamilies.push(f.name);
    fsWeights.push(1 | (b ? 2 : 0));
    process.stdout.write('.');
  } catch (err) {
    console.log(`\n${f.name}: ${err.message}`);
  }
}
console.log(`\nFontshare: ${fsFamilies.length} families measured`);

// ------------------------------------------------------------- Font Squirrel
const fsq = JSON.parse(await text('https://www.fontsquirrel.com/api/fontlist/all'));
const FSQ_CLASS = (c) => (/serif|slab/i.test(c) && !/sans/i.test(c) ? 'serif' : /sans/i.test(c) ? 'sans' : /mono|typewriter|programming/i.test(c) ? 'mono' : /script|handdrawn|calligraph|comic/i.test(c) ? 'script' : 'display');
for (const x of fsq) add(x.family_name, { s: 'fontsquirrel', u: `https://www.fontsquirrel.com/fonts/${x.family_urlname}`, l: 'fontsquirrel', c: FSQ_CLASS(x.classification ?? ''), d: [], f: x.foundry_name || null });
console.log(`Font Squirrel: ${fsq.length} families`);

// ------------------------------------------------------------- Open-source foundries (names and links)
async function slugs(url, re) {
  try {
    return [...new Set([...(await text(url)).matchAll(re)].map((x) => x[1]))];
  } catch {
    return [];
  }
}
const bbb = await slugs('https://typotheque.genderfluid.space/', /href="\/fr\/fontes\/([a-z0-9-]+)"/g);
for (const sl of bbb) add(titleCase(sl), { s: 'byebyebinary', u: `https://typotheque.genderfluid.space/fr/fontes/${sl}`, l: 'byebyebinary', c: 'unknown', d: [], f: 'Bye Bye Binary' });
const coll = await slugs('https://www.collletttivo.it/typefaces', /href="\/typefaces\/([a-z0-9-]+)"/g);
for (const sl of coll) add(titleCase(sl), { s: 'collletttivo', u: `https://www.collletttivo.it/typefaces/${sl}`, l: 'freefoundry', c: 'unknown', d: [], f: 'Collletttivo' });
const of = await slugs('https://open-foundry.com/fonts', /href="\/fonts\/([a-z0-9_-]+)"/g);
for (const sl of of) add(titleCase(sl), { s: 'openfoundry', u: `https://open-foundry.com/fonts/${sl}`, l: 'freefoundry', c: 'unknown', d: [], f: 'Open Foundry' });
console.log(`Bye Bye Binary: ${bbb.length}, Collletttivo: ${coll.length}, Open Foundry: ${of.length}`);

// ------------------------------------------------------------- write
fs.writeFileSync(path.join(root, 'src/shared/data/free-catalog.json'), JSON.stringify({ generated: new Date().toISOString().slice(0, 10), count: Object.keys(fonts).length, fonts }));
fs.writeFileSync(path.join(root, 'src/shared/data/fontshare-shapes.json'), JSON.stringify({ generated: new Date().toISOString().slice(0, 10), families: shapes, index: { families: fsFamilies, weights: fsWeights } }));
const all = new Uint8Array(records.length * per * 2);
records.forEach((b, i) => all.set(b, i * per * 2));
fs.writeFileSync(path.join(root, 'public/data/fontshare-index.bin.gz'), zlib.gzipSync(all, { level: 9 }));
console.log(`Wrote ${Object.keys(fonts).length} free fonts (outside Google Fonts), ${fsFamilies.length} measured.`);
