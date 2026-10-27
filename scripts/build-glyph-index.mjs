// Builds the glyph index used to identify fonts from images:
// public/data/glyph-index.bin.gz (fingerprints) and
// src/shared/data/glyph-index.json (family list).
// Regular and Bold of each Latin Google Fonts family, letters a-z, A-Z, 0-9,
// fetched through the Google Fonts text API so each file holds only those letters.
// Run: npm run build:glyphs   (needs network)
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const fontkit = require('fontkit');

const tmp = path.join(root, 'node_modules/.cache/ffp-glyph.mjs');
await fs.mkdir(path.dirname(tmp), { recursive: true });
await build({ stdin: { contents: "export * from './src/shared/glyphprint.ts'; export { raster } from './src/shared/shape.ts';", resolveDir: root, loader: 'ts' }, outfile: tmp, format: 'esm', bundle: true, platform: 'node', logLevel: 'silent' });
const { GLYPH_CHARS, RECORD, makeRecord, cropInk, raster } = await import(tmp);

const catalog = JSON.parse(await fs.readFile(path.join(root, 'src/shared/data/gf-catalog.json'), 'utf8')).families;
const shapes = JSON.parse(await fs.readFile(path.join(root, 'src/shared/data/gf-shapes.json'), 'utf8')).families;
// Same Latin families the similar-font suggestions use.
const SECONDARY = new Set(['japanese', 'korean', 'chinese-simplified', 'chinese-traditional', 'chinese-hongkong', 'tibetan', 'sinhala', 'myanmar', 'khmer', 'lao']);
const SCRIPT = /\b(Devanagari|Hindi|Marathi|Tamil|Bangla|Bengali|Gujarati|Gurmukhi|Kannada|Telugu|Malayalam|Oriya|Odia|Arabic|Hebrew|Thai|Armenian|Georgian|Ethiopic|Sinhala|Khmer|Lao|Myanmar|Tibetan|Mongolian|Javanese|Balinese|Cherokee|Adlam|Syriac|Kufi|Naskh|Nastaliq|Urdu|JP|KR|SC|TC|HK)\b/;
const seen = new Set();
// Most used first: when two families share the same letters (script versions,
// copies), the better known one is kept, and ties in matching go to it.
const families = Object.keys(shapes)
  .filter((f) => catalog[f]?.s.includes('latin') && !catalog[f].s.some((x) => SECONDARY.has(x)) && !SCRIPT.test(f))
  .sort((a, b) => (catalog[a].p ?? 9999) - (catalog[b].p ?? 9999))
  .filter((f) => {
    const sig = shapes[f].join(',');
    if (seen.has(sig)) return false;
    seen.add(sig);
    return true;
  });

function weightParam(entry, want) {
  const w = entry.w ?? [];
  const wght = (entry.a ?? []).find((a) => a[0] === 'wght');
  if (wght) {
    if (want < wght[1] || want > wght[2]) return null;
    return `:wght@${want}`;
  }
  const upright = w.filter((v) => !v.endsWith('i')).map(Number);
  if (want === 400) {
    if (!upright.length) return null;
    const best = upright.sort((a, b) => Math.abs(a - 400) - Math.abs(b - 400))[0];
    return best === 400 && w.length === 1 ? '' : `:wght@${best}`;
  }
  const bold = upright.filter((v) => v >= 600).sort((a, b) => Math.abs(a - 700) - Math.abs(b - 700))[0];
  return bold ? `:wght@${bold}` : null;
}

const records = new Map(); // family -> [regular Uint8Array | null, bold | null]
let failed = 0;

async function measure(family, want) {
  const p = weightParam(catalog[family], want);
  if (p === null) return null;
  const q = `family=${family.replace(/ /g, '+')}${p}&text=${encodeURIComponent(GLYPH_CHARS)}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const css = await (await fetch(`https://fonts.googleapis.com/css2?${q}`)).text();
      const url = /url\((https:[^)]+)\)/.exec(css)?.[1];
      if (!url) return null;
      const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
      const f0 = fontkit.create(buf);
      const font = f0.fonts ? f0.fonts[0] : f0;
      const upm = font.unitsPerEm;
      const out = new Uint8Array(GLYPH_CHARS.length * RECORD);
      for (let i = 0; i < GLYPH_CHARS.length; i++) {
        const cp = GLYPH_CHARS.codePointAt(i);
        if (!font.hasGlyphForCodePoint(cp)) continue;
        const g = font.glyphForCodePoint(cp);
        const bmp = raster(g, upm, 96);
        const ink = bmp && cropInk(bmp);
        if (!ink) continue;
        const bb = g.bbox;
        out.set(makeRecord(ink, (bb.maxY - bb.minY) / upm, bb.minY / upm), i * RECORD);
      }
      return out;
    } catch {
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
  }
  failed++;
  return null;
}

let done = 0;
const queue = [...families];
await Promise.all(Array.from({ length: 12 }, async () => {
  while (queue.length) {
    const f = queue.shift();
    const [reg, bold] = await Promise.all([measure(f, 400), measure(f, 700)]);
    if (reg || bold) records.set(f, [reg, bold]);
    if (++done % 200 === 0) console.log(`${done}/${families.length}`);
  }
}));

const list = families.filter((f) => records.has(f)); // keeps the popularity order
const per = GLYPH_CHARS.length * RECORD;
const bin = new Uint8Array(list.length * 2 * per);
const weights = [];
list.forEach((f, i) => {
  const [reg, bold] = records.get(f);
  if (reg) bin.set(reg, (i * 2) * per);
  if (bold) bin.set(bold, (i * 2 + 1) * per);
  weights.push((reg ? 1 : 0) | (bold ? 2 : 0));
});
await fs.mkdir(path.join(root, 'public/data'), { recursive: true });
await fs.writeFile(path.join(root, 'public/data/glyph-index.bin.gz'), zlib.gzipSync(bin, { level: 9 }));
await fs.writeFile(
  path.join(root, 'src/shared/data/glyph-index.json'),
  JSON.stringify({ generated: new Date().toISOString().slice(0, 10), chars: GLYPH_CHARS, record: RECORD, families: list, weights }),
);
const gz = (await fs.stat(path.join(root, 'public/data/glyph-index.bin.gz'))).size;
console.log(`Indexed ${list.length} families (${weights.filter((w) => w & 2).length} with bold). ${Math.round(bin.length / 1024)} KB raw, ${Math.round(gz / 1024)} KB compressed. Failed requests: ${failed}`);
