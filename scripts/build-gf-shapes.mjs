// Measures the shape of every Google Fonts family (regular weight) and writes
// src/shared/data/gf-shapes.json. Each family is fetched through the Google
// Fonts text API with only the letters needed, so files are a few KB.
// Run: npm run build:shapes   (needs network)
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const fontkit = require('fontkit');

const tmp = path.join(root, 'node_modules/.cache/ffp-shape.mjs');
await fs.mkdir(path.dirname(tmp), { recursive: true });
await build({ entryPoints: [path.join(root, 'src/shared/shape.ts')], outfile: tmp, format: 'esm', bundle: true, platform: 'node', logLevel: 'silent' });
const { shapeFromFont, packShape, SHAPE_TEXT } = await import(tmp);

const catalog = JSON.parse(await fs.readFile(path.join(root, 'src/shared/data/gf-catalog.json'), 'utf8'));
const families = Object.entries(catalog.families);
const out = {};
const failed = [];

function variant(entry) {
  const w = entry.w ?? [];
  if (w.includes('400') || !w.length) return '';
  const upright = w.filter((v) => !v.endsWith('i')).sort((a, b) => Math.abs(a - 400) - Math.abs(b - 400));
  if (upright.length) return `:wght@${upright[0]}`;
  return `:ital,wght@1,${w[0].replace('i', '')}`;
}

async function one([family, entry]) {
  const q = `family=${family.replace(/ /g, '+')}${variant(entry)}&text=${encodeURIComponent(SHAPE_TEXT)}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const css = await (await fetch(`https://fonts.googleapis.com/css2?${q}`)).text();
      const url = /url\((https:[^)]+)\)/.exec(css)?.[1];
      if (!url) throw new Error('no url');
      const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
      const font = fontkit.create(buf);
      const shape = shapeFromFont(font.fonts ? font.fonts[0] : font);
      if (!shape) throw new Error('no shape');
      out[family] = packShape(shape);
      return;
    } catch (err) {
      if (attempt === 2) failed.push(`${family}: ${err.message}`);
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
  }
}

let i = 0;
const queue = [...families];
await Promise.all(Array.from({ length: 12 }, async () => {
  while (queue.length) {
    await one(queue.shift());
    if (++i % 200 === 0) console.log(`${i}/${families.length}`);
  }
}));

const sorted = Object.fromEntries(Object.keys(out).sort().map((k) => [k, out[k]]));
await fs.writeFile(
  path.join(root, 'src/shared/data/gf-shapes.json'),
  JSON.stringify({ generated: new Date().toISOString().slice(0, 10), fields: ['x', 'cap', 'asc', 'desc', 'w', 'stem', 'contrast', 'round', 'g2', 'a2', 'sq', 'n/o', 's/o', 'a/o', 'e/o', 'r/o', 't/o', 'M/H', 'R/H', 'S/H', 'tl', 'dot'], count: Object.keys(sorted).length, families: sorted }),
);
console.log(`Measured ${Object.keys(sorted).length} families. Not measured: ${failed.length}`);
if (failed.length) console.log(failed.slice(0, 40).join('\n'));
