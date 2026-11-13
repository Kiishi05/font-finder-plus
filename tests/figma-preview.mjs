// Draws the specimen page the Figma plugin builds (saved by tests/figma.mjs) as
// HTML, to look at its layout without Figma. Writes tests/output/figma-specimen.png.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tree = JSON.parse(fs.readFileSync(path.join(root, 'tests/output/figma-specimen.json'), 'utf8'));
const rgb = (c) => `rgb(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)})`;
const esc = (t) => String(t).replace(/[&<]/g, (c) => (c === '&' ? '&amp;' : '&lt;')).replace(/\n/g, '<br>');
const weight = (st) => (/black/i.test(st) ? 900 : /extra ?bold/i.test(st) ? 800 : /semi ?bold/i.test(st) ? 600 : /bold/i.test(st) ? 700 : /medium/i.test(st) ? 500 : /light/i.test(st) ? 300 : 400);
function draw(n) {
  const fill = n.fills?.find?.((f) => f.type === 'SOLID');
  if (n.type === 'TEXT') {
    const ts = n.textStyle;
    const fam = ts?.family ?? n.fontName?.family ?? 'Inter';
    const st = ts?.style ?? n.fontName?.style ?? 'Regular';
    const size = ts?.size ?? n.fontSize ?? 14;
    const lh = ts?.lineHeight?.unit === 'PIXELS' ? `${ts.lineHeight.value}px` : 'normal';
    const tc = ts?.textCase === 'UPPER' ? 'uppercase' : 'none';
    const w = n.width && n.width !== 100 ? `width:${n.width}px;` : '';
    return `<div style="${w}font-family:'${fam}',Inter,sans-serif;font-weight:${weight(st)};font-style:${/italic/i.test(st) ? 'italic' : 'normal'};font-size:${size}px;line-height:${lh};text-transform:${tc};color:${fill ? rgb(fill.color) : '#111'}">${esc(n.characters ?? '')}</div>`;
  }
  if (n.type === 'RECTANGLE') return `<div style="width:${n.width}px;height:${n.height}px;background:#ddd"></div>`;
  const dir = n.layoutMode === 'HORIZONTAL' ? 'row' : 'column';
  const [pt = 0, pr = 0, pb = 0, pl = 0] = n.padding ?? [];
  const bg = fill ? `background:${rgb(fill.color)};` : '';
  const border = n.strokeBottomWeight ? 'border-bottom:1px solid #e6e6e8;' : '';
  const fixedW = n.counterAxisSizingMode === 'FIXED' || (n.width && n.width !== 100 && !n.layoutMode) ? `width:${n.width}px;flex:none;` : '';
  const fillW = n.layoutSizingHorizontal === 'FILL' ? 'align-self:stretch;flex:1 1 auto;' : '';
  const card = n.name === 'Aa' ? `width:${n.width}px;height:${n.height}px;flex:none;justify-content:center;` : '';
  const align = n.counterAxisAlignItems === 'CENTER' ? 'align-items:center;' : 'align-items:flex-start;';
  return `<div title="${esc(n.name)}" style="display:flex;flex-direction:${dir};gap:${n.itemSpacing ?? 0}px;padding:${pt}px ${pr}px ${pb}px ${pl}px;${bg}${border}${fixedW}${fillW}${card}${align}border-radius:${n.cornerRadius ?? 0}px;box-sizing:border-box">${(n.children ?? []).map(draw).join('')}</div>`;
}
const fams = new Set();
JSON.stringify(tree, (k, v) => { if (k === 'family' && typeof v === 'string') fams.add(v); return v; });
const link = `https://fonts.googleapis.com/css2?${[...fams].map((f) => `family=${f.replace(/ /g, '+')}:wght@400;500;700`).join('&')}&display=block`;
const html = `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="${link}"><body style="margin:0;background:#f0f0f0;padding:24px">${draw(tree)}</body>`;
const { chromium } = require('playwright');
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1260, height: 900 } });
await p.setContent(html);
await p.evaluate(() => document.fonts.ready);
await p.waitForTimeout(1500);
await p.screenshot({ path: path.join(root, 'tests/output/figma-specimen.png'), fullPage: true });
await b.close();
console.log('Wrote tests/output/figma-specimen.png');
