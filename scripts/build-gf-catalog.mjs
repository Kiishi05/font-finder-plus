// Builds src/shared/data/gf-catalog.json from public Google Fonts sources.
//
// 1. Family list, category, designers, subsets and axes come from
//    https://fonts.google.com/metadata/fonts (the public metadata the Google
//    Fonts website itself uses).
// 2. The licence is NOT in that metadata or in the Developer API. It is read
//    from the official google/fonts repository, where every family lives in a
//    folder named after its licence: ofl/, apache/ or ufl/. We check which
//    folder holds the family's METADATA.pb and read its `license:` line.
//    If no folder is found the licence is stored as null (shown as unknown).
//
// Run: npm run build:catalog

import { writeFile } from 'node:fs/promises';

const META_URL = 'https://fonts.google.com/metadata/fonts';
const RAW = 'https://raw.githubusercontent.com/google/fonts/main';
const OUT = new URL('../src/shared/data/gf-catalog.json', import.meta.url);
const CONCURRENCY = 24;

const CATEGORY = {
  'Sans Serif': 'sans',
  Serif: 'serif',
  Monospace: 'mono',
  Display: 'display',
  Handwriting: 'script',
};

function dirName(family) {
  return family.toLowerCase().replace(/[^a-z0-9]/g, '');
}

async function fetchText(url) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 font-finder-plus-build' } });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`${res.status} ${url}`);
      return await res.text();
    } catch (err) {
      if (attempt === 3) throw err;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    }
  }
  return null;
}

async function licenseFor(family) {
  const dir = dirName(family);
  for (const folder of ['ofl', 'apache', 'ufl']) {
    const pb = await fetchText(`${RAW}/${folder}/${dir}/METADATA.pb`);
    if (pb) {
      const m = pb.match(/^license:\s*"([^"]+)"/m);
      const lic = m ? m[1].toUpperCase() : folder.toUpperCase();
      return lic === 'APACHE2' ? 'APACHE' : lic;
    }
  }
  return null;
}

async function pool(items, fn) {
  const out = new Array(items.length);
  let i = 0;
  let done = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
      done++;
      if (done % 200 === 0) console.log(`  ${done}/${items.length}`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return out;
}

const raw = await fetchText(META_URL);
if (!raw) throw new Error('Could not download Google Fonts metadata');
const meta = JSON.parse(raw.replace(/^\)\]\}'\s*/, ''));
const list = meta.familyMetadataList;
console.log(`Families: ${list.length}. Reading licences from google/fonts…`);

const licences = await pool(list, (f) => licenseFor(f.family));

const families = {};
let unknown = 0;
list.forEach((f, idx) => {
  const lic = licences[idx];
  if (!lic) unknown++;
  families[f.family] = {
    c: CATEGORY[f.category] ?? 'unknown',
    d: f.designers ?? [],
    l: lic,
    s: (f.subsets ?? []).filter((s) => s !== 'menu'),
    a: (f.axes ?? []).map((a) => [a.tag, a.min, a.max, a.defaultValue]),
    w: Object.keys(f.fonts ?? {}),
    p: f.popularity ?? null,
  };
});

const out = {
  generated: new Date().toISOString().slice(0, 10),
  source: 'fonts.google.com/metadata/fonts + github.com/google/fonts licence folders',
  count: list.length,
  families,
};
await writeFile(OUT, JSON.stringify(out));
console.log(`Wrote ${list.length} families (${unknown} with unknown licence) to ${OUT.pathname}`);
