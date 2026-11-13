// Builds the Figma plugin into figma-plugin/dist (code.js and ui.html with its script inlined).
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'figma-plugin');
const out = path.join(dir, 'dist');
fs.mkdirSync(out, { recursive: true });
// Google Fonts family names (to tell a missing Google font from a paid one), from the bundled catalogue.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'src/shared/data/gf-catalog.json'), 'utf8'));
fs.mkdirSync(path.join(dir, 'src/gen'), { recursive: true });
fs.writeFileSync(path.join(dir, 'src/gen/google-names.json'), JSON.stringify(Object.keys(catalog.families)));

await build({ entryPoints: [path.join(dir, 'src/code.ts')], outfile: path.join(out, 'code.js'), bundle: true, format: 'iife', target: 'es2017', minify: true, logLevel: 'warning' });
const ui = await build({ entryPoints: [path.join(dir, 'src/ui.ts')], bundle: true, format: 'iife', target: 'es2017', minify: true, write: false, logLevel: 'warning' });
const js = ui.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const html = fs.readFileSync(path.join(dir, 'src/ui.html'), 'utf8').replace('/*__UI_JS__*/', () => js);
fs.writeFileSync(path.join(out, 'ui.html'), html);
console.log(`Built figma-plugin/dist (code.js ${(fs.statSync(path.join(out, 'code.js')).size / 1024).toFixed(1)} KB, ui.html ${(html.length / 1024).toFixed(1)} KB)`);
