// Runs the accuracy tests and writes docs/accuracy.md and docs/accuracy.json:
// how often Font Finder Plus finds the right font in images, and how often its
// free look-alikes pick the right family. Runs before each release
// (npm run package) so the numbers stay current. Needs npm run build:test first.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runBench } from '../tests/lookalike-bench.mjs';
import { runImageBench, QUALITIES } from '../tests/image-bench.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = JSON.parse(fs.readFileSync(path.join(root, 'public/manifest.json'), 'utf8')).version;
const date = new Date().toISOString().slice(0, 10);

console.log('Look-alikes from font files…');
const fileBench = await runBench({ quiet: true });
console.log('Look-alikes as the page draws them…');
const pageBench = await runBench({ quiet: true, canvas: true });
console.log('Identifying fonts in images…');
const img = await runImageBench({ quiet: true });

const pct = (a, n) => (n ? `${Math.round((a / n) * 100)}%` : 'n/a');
const out = { version, date, lookalike: { file: fileBench, page: pageBench }, image: img };
fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
fs.writeFileSync(path.join(root, 'docs/accuracy.json'), JSON.stringify(out, null, 1));

const md = [];
md.push(`# Font Finder Plus accuracy`, '');
md.push(`Version ${version}, measured ${date}. Rerun with \`npm run accuracy\` (also runs before every \`npm run package\`).`, '');
md.push('## Identifying a font in an image', '');
md.push(`A sentence is drawn as a picture in ${img.all.n / QUALITIES.length} popular Google Fonts families at three qualities, then run through the same steps as the extension: text recognition, cutting out letters, and matching against ${'~1,900'} Google Fonts families on this computer. A family whose letters are the same drawings (for example Inter and Inter Tight) counts as right.`, '');
md.push('| Picture | Right font first | In the top 5 |', '|---|---|---|');
for (const q of QUALITIES) {
  const r = img.byQuality[q.id];
  md.push(`| ${q.label} | ${r.top1} of ${r.n} (${pct(r.top1, r.n)}) | ${r.top5} of ${r.n} (${pct(r.top5, r.n)}) |`);
}
md.push(`| **All** | **${img.all.top1} of ${img.all.n} (${pct(img.all.top1, img.all.n)})** | **${img.all.top5} of ${img.all.n} (${pct(img.all.top5, img.all.n)})** |`, '');
const exact = img.rows.filter((r) => r.top.length && (r.top[0][1] >= 80 || (r.top[0][1] >= 60 && r.lead >= 5)));
md.push(`Results labelled **"Likely this font"** (score 80 or more, or 60 or more with a 5-point lead): ${exact.length} of ${img.all.n} pictures, right in ${exact.filter((r) => r.rank === 1).length} of ${exact.length} (${pct(exact.filter((r) => r.rank === 1).length, exact.length)}).`, '');
const misses = img.rows.filter((r) => r.rank > 5);
if (misses.length) {
  md.push('Not found in the top 5:', '');
  for (const r of misses) md.push(`- ${r.font} (${r.quality}): read "${r.read.slice(0, 40)}", closest ${r.top.map(([f, s]) => `${f} ${s}`).join(', ') || 'none'}`);
  md.push('');
}
md.push('## Free look-alikes (Make it free, Similar fonts, Figma stand-ins)', '');
md.push('Fonts whose right free answer is known: copies of famous fonts that ship with Linux (Helvetica, Times, Courier, Arial, Calibri) and Google Fonts families built from another (Public Sans from Libre Franklin, Noto Sans from Open Sans, Heebo from Roboto...).', '');
md.push('| Measured from | Right family first | In the top 3 |', '|---|---|---|');
md.push(`| Font files | ${fileBench.top1} of ${fileBench.n} (${pct(fileBench.top1, fileBench.n)}) | ${fileBench.top3} of ${fileBench.n} (${pct(fileBench.top3, fileBench.n)}) |`);
md.push(`| How the page draws it | ${pageBench.top1} of ${pageBench.n} (${pct(pageBench.top1, pageBench.n)}) | ${pageBench.top3} of ${pageBench.n} (${pct(pageBench.top3, pageBench.n)}) |`, '');
md.push('| Font | Should find | Rank (files) | Top 3 found |', '|---|---|---|---|');
for (const r of fileBench.rows) md.push(`| ${r.name} | ${r.expect.join(' or ')} | ${r.final === 999 ? 'not in top 50' : r.final} | ${r.top.join(', ')} |`);
md.push('', '## What this does not measure', '');
md.push('- Paid fonts in images: the extension only knows free Google Fonts by shape, plus the fonts of the page you are on. For a paid font it finds the closest free ones, not the font itself.');
md.push('- Joined-up script lettering (Lobster, Pacifico, Dancing Script): letters touch and cannot be cut apart, so these usually fail.');
md.push('- Photos taken at an angle, unusual colours or very short text. The pictures here are drawn, not photographed.');
md.push('- Fonts on web pages are read from the page itself (the font the browser actually used), so they are not part of this test.');
fs.writeFileSync(path.join(root, 'docs/accuracy.md'), md.join('\n') + '\n');
console.log(`Wrote docs/accuracy.md: images ${img.all.top1}/${img.all.n} first, look-alikes ${fileBench.top1}/${fileBench.n} first`);
