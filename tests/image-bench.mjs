// Accuracy test for "Identify a font from an image". Draws a sentence in 50
// popular Google Fonts families as a picture, at three qualities (clean, small
// text, blurry JPEG), then runs the same steps as the extension: text
// recognition (Tesseract), cutting out letters, and matching against the
// glyph index. Counts how often the right family comes first and in the top 5.
// Run: npm run build:test && node tests/image-bench.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { build } = require('esbuild');
const cache = path.join(root, 'node_modules/.cache/imgbench');
fs.mkdirSync(cache, { recursive: true });

export const FONTS = [
  'Roboto', 'Open Sans', 'Montserrat', 'Lato', 'Poppins', 'Inter', 'Oswald', 'Raleway', 'Nunito', 'Playfair Display',
  'Merriweather', 'Rubik', 'Work Sans', 'Lora', 'PT Serif', 'Libre Baskerville', 'DM Sans', 'Space Grotesk', 'Bebas Neue', 'Abril Fatface',
  'Pacifico', 'Lobster', 'Dancing Script', 'Source Code Pro', 'JetBrains Mono', 'Fira Sans', 'IBM Plex Serif', 'Crimson Text', 'EB Garamond', 'Archivo',
  'Barlow', 'Karla', 'Manrope', 'Outfit', 'Sora', 'Josefin Sans', 'Quicksand', 'Cormorant Garamond', 'Spectral', 'Bitter',
  'Arvo', 'Zilla Slab', 'Anton', 'Righteous', 'Comfortaa', 'Caveat', 'Shadows Into Light', 'Inconsolata', 'Space Mono', 'Noto Serif',
];
export const QUALITIES = [
  { id: 'clean', label: 'Clean, large text (64px)', px: 64, blur: 0, jpeg: 0 },
  { id: 'small', label: 'Small text (22px)', px: 22, blur: 0, jpeg: 0 },
  { id: 'rough', label: 'Blurry, compressed photo-like (40px, blur, JPEG 50%)', px: 40, blur: 1.2, jpeg: 0.5 },
];
const TEXT = 'Quick brown foxes jump over lazy dogs';

async function fontBytes(fam) {
  const file = path.join(cache, `${fam.replace(/\W+/g, '_')}.font`);
  if (fs.existsSync(file)) return fs.readFileSync(file);
  const css = await (await fetch(`https://fonts.googleapis.com/css2?family=${fam.replace(/ /g, '+')}&text=${encodeURIComponent(TEXT + 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ')}`)).text();
  const url = /url\((https:[^)]+)\)/.exec(css)?.[1];
  if (!url) throw new Error(`no file for ${fam}`);
  const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
  fs.writeFileSync(file, buf);
  return buf;
}

export async function runImageBench({ quiet = false, fonts = FONTS } = {}) {
  const ext = path.join(root, 'dist-test');
  if (!fs.existsSync(path.join(ext, 'ocr'))) throw new Error('Run npm run build:test first');
  // A page served next to the extension's OCR files, running the same code as the panel.
  const site = path.join(cache, 'site');
  fs.mkdirSync(site, { recursive: true });
  const link = path.join(site, 'ocr');
  if (!fs.existsSync(link)) fs.symlinkSync(path.join(ext, 'ocr'), link);
  await build({
    stdin: {
      contents: `window.chrome = { runtime: { getURL: (p) => location.origin + '/' + p } };
        import { recognize } from './src/sidepanel/lib/ocr.ts';
        import { cutGlyphs } from './src/sidepanel/lib/imageprep.ts';
        window.Bench = { recognize, cutGlyphs };`,
      resolveDir: root, loader: 'ts',
    },
    outfile: path.join(site, 'bench.js'), bundle: true, format: 'iife', logLevel: 'silent', loader: { '.json': 'json' },
    define: { 'import.meta.url': 'location.href' },
  });
  fs.writeFileSync(path.join(site, 'index.html'), '<!doctype html><meta charset="utf-8"><body><script src="bench.js"></script></body>');
  const PORT = 8799;
  const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: site, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 700));

  const coreTmp = path.join(cache, 'core.mjs');
  await build({ stdin: { contents: "export * from './src/shared/matchcore.ts'; export * from './src/shared/glyphprint.ts'; export * from './src/shared/imagerank.ts';", resolveDir: root, loader: 'ts' }, outfile: coreTmp, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent', loader: { '.json': 'json' } });
  const m = await import(`${coreTmp}?t=${Date.now()}`);
  const meta = JSON.parse(fs.readFileSync(path.join(root, 'src/shared/data/glyph-index.json'), 'utf8'));
  const ix = new Uint8Array(zlib.gunzipSync(fs.readFileSync(path.join(root, 'public/data/glyph-index.bin.gz'))));
  const per = m.GLYPH_CHARS.length * m.RECORD;
  const famIndex = new Map(meta.families.map((f, i) => [f, i]));
  // Two families count as the same answer when their Regular letters are the same drawings.
  const sameLetters = (a, b) => {
    const ia = famIndex.get(a), ib = famIndex.get(b);
    if (ia == null || ib == null) return false;
    let sum = 0, n = 0;
    for (const ch of 'abcdefghijklmnopqrstuvwxyz') {
      const ci = m.GLYPH_CHARS.indexOf(ch);
      const oa = ia * 2 * per + ci * m.RECORD, ob = ib * 2 * per + ci * m.RECORD;
      if (m.isMissing(ix, oa) || m.isMissing(ix, ob)) continue;
      sum += m.shapeSimilarity(ix, oa, ix, ob);
      n++;
    }
    return n > 10 && sum / n >= 0.985;
  };

  const { chromium } = require('playwright');
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/index.html`);
  await page.waitForFunction(() => !!window.Bench);

  const rows = [];
  try {
    for (const fam of fonts) {
      if (!famIndex.has(fam)) continue;
      let bytes;
      try { bytes = await fontBytes(fam); } catch { continue; }
      for (const q of QUALITIES) {
        const out = await page.evaluate(async ({ b64, text, q }) => {
          const name = 'F' + Math.random().toString(36).slice(2);
          const ff = new FontFace(name, Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
          await ff.load();
          document.fonts.add(ff);
          let c = document.createElement('canvas');
          const ctx0 = c.getContext('2d');
          ctx0.font = `${q.px}px "${name}"`;
          const w = Math.ceil(ctx0.measureText(text).width) + q.px;
          c.width = w; c.height = Math.ceil(q.px * 1.9);
          const ctx = c.getContext('2d');
          ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
          if (q.blur) ctx.filter = `blur(${q.blur}px)`;
          ctx.fillStyle = '#111'; ctx.font = `${q.px}px "${name}"`;
          ctx.fillText(text, q.px / 2, q.px * 1.3);
          if (q.jpeg) {
            const img = new Image();
            img.src = c.toDataURL('image/jpeg', q.jpeg);
            await img.decode();
            const c2 = document.createElement('canvas');
            c2.width = c.width; c2.height = c.height;
            c2.getContext('2d').drawImage(img, 0, 0);
            c = c2;
          }
          document.fonts.delete(ff);
          const lines = await window.Bench.recognize(c);
          if (!lines.length) return { read: '', glyphs: [] };
          const best = lines.map((l, i) => [i, l.confidence * Math.min(1, l.text.length / 12)]).sort((a, b) => b[1] - a[1])[0][0];
          const glyphs = window.Bench.cutGlyphs(c, [{ line: lines[best], index: best }], {});
          return { read: lines[best].text, glyphs: glyphs.map((g) => ({ ci: g.ci, bits: Array.from(g.bits), aspect: g.aspect, h: g.h, bottom: g.bottom })) };
        }, { b64: Buffer.from(bytes).toString('base64'), text: TEXT, q });
        const glyphs = out.glyphs.map((g) => ({ ...g, bits: Uint8Array.from(g.bits) }));
        const ranked = glyphs.length >= 2 ? m.orderImageMatches(m.rankFonts(ix, meta.families, meta.weights, glyphs, 60), 10) : [];
        const names = ranked.map((r) => r.family);
        const rank = names.findIndex((n) => n === fam || sameLetters(n, fam)) + 1 || 999;
        const score = (r) => Math.round(Math.max(0, Math.min(1, (r.total - 0.75) / 0.23)) * 100);
        const row = { font: fam, quality: q.id, rank, read: out.read, letters: glyphs.length, top: ranked.slice(0, 3).map((r) => [r.family, score(r)]), lead: ranked.length > 1 ? score(ranked[0]) - score(ranked[1]) : 0 };
        rows.push(row);
        if (!quiet) console.log(`${rank === 1 ? 'TOP1' : rank <= 5 ? 'TOP5' : 'MISS'}  ${q.id.padEnd(5)} ${fam.padEnd(20)} rank ${String(rank).padStart(3)}  read "${out.read.slice(0, 30)}"  got ${row.top.map(([f, s]) => `${f} ${s}`).join(' | ')}`);
      }
    }
  } finally {
    await browser.close();
    server.kill();
  }
  const by = (id) => rows.filter((r) => !id || r.quality === id);
  const summary = (list) => ({ n: list.length, top1: list.filter((r) => r.rank === 1).length, top5: list.filter((r) => r.rank <= 5).length });
  const res = { rows, all: summary(by()), byQuality: Object.fromEntries(QUALITIES.map((q) => [q.id, summary(by(q.id))])) };
  if (!quiet) {
    for (const q of QUALITIES) console.log(`${q.label}: top 1 ${res.byQuality[q.id].top1}/${res.byQuality[q.id].n}, top 5 ${res.byQuality[q.id].top5}/${res.byQuality[q.id].n}`);
    console.log(`All: top 1 ${res.all.top1}/${res.all.n}, top 5 ${res.all.top5}/${res.all.n}`);
  }
  return res;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const res = await runImageBench();
  fs.mkdirSync(path.join(root, 'tests/output'), { recursive: true });
  fs.writeFileSync(path.join(root, 'tests/output/image-bench.json'), JSON.stringify(res, null, 2));
}
