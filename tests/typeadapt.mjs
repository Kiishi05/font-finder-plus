// Unit checks for the "Use with my fonts" maths (src/shared/typeadapt.ts) and
// the "Paste type from Figma" format (src/shared/figmatype.ts). No browser.
//
//   node tests/typeadapt.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { transformWithEsbuild } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ffp-unit-'));
async function load(rel) {
  const src = fs.readFileSync(path.join(root, rel), 'utf8');
  const { code } = await transformWithEsbuild(src, rel, { loader: 'ts', format: 'esm', target: 'es2022' });
  const file = path.join(tmp, path.basename(rel).replace(/\.ts$/, '.mjs'));
  fs.writeFileSync(file, code);
  return import(pathToFileURL(file).href);
}

const T = await load('src/shared/typeadapt.ts');
const F = await load('src/shared/figmatype.ts');

let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

// Measured proportions (per em), close to the real fonts.
const inter = { xh: 0.546, cap: 0.727, asc: 0.757, desc: 0.21, wx: 0.98, normal: 1.21 };
const fraunces = { xh: 0.482, cap: 0.7, asc: 0.74, desc: 0.24, wx: 1.08, normal: 1.23 };
const instrument = { xh: 0.51, cap: 0.72, asc: 0.76, desc: 0.27, wx: 0.74, normal: 1.3 };
const sohneMono = { xh: 0.55, cap: 0.73, asc: 0.76, desc: 0.24, wx: 1.09, mono: true };
const theirs = (m) => ({ name: 'Theirs', metrics: m, weights: 'any' });
const yours = (m, weights = 'any', name = 'Yours') => ({ name, metrics: m, weights });

// Size follows the x-height.
{
  const a = T.adaptStyle({ size: 16, lh: 1.5, ls: 0, weight: 400, caps: false }, theirs(inter), yours(fraunces, 'any', 'Fraunces'));
  const want = T.roundSize(16 * inter.xh / fraunces.xh);
  check('size keeps the x-height (smaller x-height gets bigger)', a.size === want && a.size > 16, `${a.size} vs ${want}`);
  check('reason names the font and the x-height', /Bigger: Fraunces has a smaller x-height/.test(a.why.size), a.why.size);
  const b = T.adaptStyle({ size: 16, lh: 1.5, ls: 0, weight: 400, caps: false }, theirs(fraunces), yours(inter));
  check('a bigger x-height makes the size smaller', b.size < 16 && /Smaller/.test(b.why.size), `${b.size}`);
  const same = T.adaptStyle({ size: 16, lh: 1.5, ls: 0, weight: 400, caps: false }, theirs(inter), yours(inter));
  check('the same font changes nothing', same.size === 16 && same.lh === 1.5 && same.ls === 0 && same.weight === 400, JSON.stringify(same));
}
// All caps follows the cap height.
{
  const a = T.adaptStyle({ size: 12, lh: 1.3, ls: 0.08, weight: 500, caps: true }, theirs(inter), yours(fraunces));
  check('all caps uses the cap height', a.size === T.roundSize(12 * inter.cap / fraunces.cap) && /cap height/.test(a.why.size), `${a.size} ${a.why.size}`);
}
// Line height from vertical proportions.
{
  const big = T.adaptStyle({ size: 48, lh: 1.1, ls: -0.02, weight: 600, caps: false }, theirs(inter), yours(instrument));
  const extT = (inter.asc + inter.desc) / inter.xh;
  const extF = (instrument.asc + instrument.desc) / instrument.xh;
  const want = T.roundLh((1.1 * 48 * Math.pow(extF / extT, 0.5)) / big.size);
  check('large text line height follows the extent per x-height', big.lh === want, `${big.lh} vs ${want}`);
  check('line height is rounded to 0.05', Math.abs(big.lh * 20 - Math.round(big.lh * 20)) < 1e-9);
  const body = T.adaptStyle({ size: 16, lh: null, ls: 0, weight: 400, caps: false }, theirs(inter), yours(fraunces));
  check('normal line height uses the font box', body.lh > 1 && body.lh < 1.6, String(body.lh));
}
// Letter spacing.
{
  const big = T.adaptStyle({ size: 48, lh: 1.1, ls: -0.02, weight: 600, caps: false }, theirs(inter), yours(instrument, 'any', 'Instrument Serif'));
  check('a narrower font loosens large negative tracking', big.ls > -0.02 && big.ls <= 0 && /Looser: Instrument Serif is narrower/.test(big.why.ls), `${big.ls} ${big.why.ls}`);
  const wide = T.adaptStyle({ size: 48, lh: 1.1, ls: -0.02, weight: 600, caps: false }, theirs(instrument), yours(inter));
  check('a wider font tightens large tracking', wide.ls < -0.02, String(wide.ls));
  const small = T.adaptStyle({ size: 12, lh: 1.4, ls: 0, weight: 400, caps: false }, theirs(inter), yours(inter));
  check('very small text opens up a little', small.ls === 0.01, String(small.ls));
  const caps = T.adaptStyle({ size: 12, lh: 1.3, ls: 0.08, weight: 500, caps: true }, theirs(sohneMono), yours(inter));
  check('caps from a mono font to a proportional one get tighter', caps.ls === T.roundLs(0.08 * 0.75), String(caps.ls));
  check('letter spacing is rounded to 0.005em', Math.abs(caps.ls / 0.005 - Math.round(caps.ls / 0.005)) < 1e-6);
}
// Weight.
{
  check('nearest weight', T.nearestWeight(600, [400, 700]) === 700 && T.nearestWeight(500, [400, 700]) === 400 && T.nearestWeight(550, [500, 600]) === 600);
  check('variable fonts keep the weight', T.nearestWeight(650, 'any') === 650);
  const one = T.adaptStyle({ size: 48, lh: 1.1, ls: 0, weight: 600, caps: false }, theirs(inter), yours(instrument, [400], 'Instrument Serif'));
  check('a one-weight font says so', one.weight === 400 && /one weight/.test(one.why.weight), one.why.weight);
  check('weights from style names', JSON.stringify(T.weightsFromStyleNames(['Regular', 'Bold', 'Bold Italic', 'SemiBold', 'Light'])) === '[300,400,600,700]');
  check('weights from the catalogue', T.weightsFromCatalog(['400', '700', '400i']).join() === '400,700' && T.weightsFromCatalog([], [['wght', 100, 900, 400]]) === 'any');
}
// No metrics: nothing but the weight changes.
{
  const a = T.adaptStyle({ size: 20, lh: 1.4, ls: 0.01, weight: 500, caps: false }, theirs(null), yours(null, [400, 700]));
  check('without measurements the values are kept', a.size === 20 && a.lh === 1.4 && a.ls === 0.01 && a.weight === 400 && /could not be measured/.test(a.why.size));
}
// Clean scale.
{
  const sizes = [50, 27, 20, 17, 12.5, 11];
  const rows = T.cleanScale(sizes, (s) => s, 17, 1.25);
  check('clean scale: body is the base', rows[3].ideal === 17 && rows[3].diff === 0 && rows[3].step === 0);
  check('clean scale: steps of base × ratio^n, to the half pixel', rows[1].ideal === 26.5 && rows[0].ideal === 52 && rows[0].diff === 2, rows.map((r) => r.ideal).join(','));
  check('clean scale: far sizes are marked', rows.find((r) => r.size === 12.5).far === true && rows.find((r) => r.size === 27).far === false);
  check('closest ratio picks the best fit', T.closestRatio([16 * 1.25 ** 3, 16 * 1.25 ** 2, 16 * 1.25, 16], 16) === 1.25 && T.closestRatio([16 * 1.2 ** 3, 16 * 1.2 ** 2, 16 * 1.2, 16], 16) === 1.2);
  check('difference text', T.diffText(2) === '+2px' && T.diffText(-0.5) === '−0.5px' && T.diffText(0) === 'same');
}
// Paste type from Figma.
{
  const sample = '{"ffp":"figma-type","v":1,"name":"Northwind type","styles":[{"name":"Display","role":"h1","family":"Fraunces","weight":600,"size":64,"lineHeight":68,"letterSpacing":-0.02},{"name":"Body","role":"body","family":"Inter","weight":400,"size":16,"lineHeight":24,"letterSpacing":0},{"name":"Spare","role":"none","family":"Inter","weight":400,"size":12}]}';
  const c = F.parseFigmaType(sample);
  check('Figma type: parses the shared format', c && c.name === 'Northwind type' && c.styles.length === 3 && c.styles[0].lineHeight === 68 && c.styles[0].letterSpacing === -0.02);
  const apply = F.figmaTypeToApply(c, (f) => (f === 'Fraunces' ? 'https://fonts.googleapis.com/css2?family=Fraunces' : undefined));
  check('Figma type: role none is left out, px and em kept', apply.length === 2 && apply[0].selectorRole === 'h1' && apply[0].size === 64 && apply[0].lineHeight === 68 && apply[0].letterSpacing === -0.02 && !!apply[0].fontUrlCss && !apply[1].fontUrlCss);
  check('Figma type: other text is ignored', F.parseFigmaType('hello') === null && F.parseFigmaType('{"ffp":"other"}') === null && F.parseFigmaType('{"ffp":"figma-type","v":2,"styles":[]}') === null);
  const odd = F.parseFigmaType('{"ffp":"figma-type","v":1,"styles":[{"role":"H2","family":"Inter","size":"24"},{"role":"h1","size":10}]}');
  check('Figma type: tolerant of odd values', odd && odd.styles.length === 1 && odd.styles[0].role === 'h2' && odd.styles[0].size === 24 && odd.styles[0].weight === 400 && odd.name === 'Type from Figma');
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(failed ? `\n${failed} failed` : '\nAll typeadapt checks passed');
process.exit(failed ? 1 : 0);
