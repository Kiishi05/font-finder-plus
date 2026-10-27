// Builds the extension into dist/ (or dist-test/ with FFP_TEST=1).
//   sidepanel.html + React app + font worker  (Vite app build)
//   background.js                              (ES module service worker)
//   content.js                                 (single IIFE file, injected on demand)
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { readFile, writeFile, rm, mkdir, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isTest = process.env.FFP_TEST === '1';
const watch = process.argv.includes('--watch');
const outDir = path.join(root, isTest ? 'dist-test' : 'dist');

await rm(outDir, { recursive: true, force: true });

const common = {
  configFile: false,
  logLevel: 'warn',
  define: { 'process.env.NODE_ENV': JSON.stringify('production'), __FFP_TEST__: JSON.stringify(isTest) },
};

// 1. Side panel (copies public/ into outDir)
await build({
  ...common,
  root: path.join(root, 'src/sidepanel'),
  base: './',
  publicDir: path.join(root, 'public'),
  plugins: [react()],
  worker: { format: 'es' },
  build: {
    outDir,
    emptyOutDir: false,
    target: 'chrome116',
    sourcemap: false,
    chunkSizeWarningLimit: 2000,
    rollupOptions: { input: path.join(root, 'src/sidepanel/sidepanel.html') },
    watch: watch ? {} : null,
  },
});

// 2. Background service worker and 3. content script
for (const [entry, file, format] of [
  ['src/background/index.ts', 'background.js', 'es'],
  ['src/content/index.ts', 'content.js', 'iife'],
]) {
  await build({
    ...common,
    publicDir: false,
    build: {
      outDir,
      emptyOutDir: false,
      target: 'chrome116',
      sourcemap: false,
      lib: { entry: path.join(root, entry), formats: [format], name: 'ffp', fileName: () => file },
      rollupOptions: { output: { inlineDynamicImports: true } },
      watch: watch ? {} : null,
    },
  });
}

// The side panel HTML is emitted at its source path; move it to the root.
const nested = path.join(outDir, 'sidepanel.html');
try {
  await readFile(nested);
} catch {
  /* already at root */
}

// 4. Text recognition (Tesseract) and HEIC decoding (libheif), copied as they
// are from node_modules so they run locally; nothing is downloaded at run time.
const nm = (p) => path.join(root, 'node_modules', p);
const copies = [
  ['tesseract.js/dist/worker.min.js', 'ocr/worker.min.js'],
  ['tesseract.js-core/tesseract-core-lstm.wasm.js', 'ocr/core/tesseract-core-lstm.wasm.js'],
  ['tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'ocr/core/tesseract-core-simd-lstm.wasm.js'],
  ['tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js', 'ocr/core/tesseract-core-relaxedsimd-lstm.wasm.js'],
  ['tesseract.js-core/LICENSE', 'ocr/LICENSE-tesseract-core.txt'],
  ['@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', 'ocr/lang/eng.traineddata.gz'],
  ['libheif-js/libheif-wasm/libheif.js', 'heic/libheif.js'],
  ['libheif-js/libheif-wasm/libheif.wasm', 'heic/libheif.wasm'],
  ['libheif-js/LICENSE', 'heic/LICENSE-libheif-LGPL-3.0.txt'],
];
for (const [from, to] of copies) {
  await mkdir(path.dirname(path.join(outDir, to)), { recursive: true });
  await copyFile(nm(from), path.join(outDir, to));
}

// Test builds get host access up front so automated tests need no permission prompt.
if (isTest) {
  const mf = JSON.parse(await readFile(path.join(outDir, 'manifest.json'), 'utf8'));
  mf.host_permissions = ['<all_urls>'];
  mf.name += ' (test build)';
  await writeFile(path.join(outDir, 'manifest.json'), JSON.stringify(mf, null, 2));
}

console.log(`Built ${path.relative(root, outDir)}/`);
