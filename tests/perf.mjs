// Performance check: a big generated page (20,000 elements, 40 font stacks).
// Measures injection, a full scan, hover response on the page, panel load and memory.
// Run: npm run build:test && node tests/perf.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ext = path.join(root, 'dist-test');
const dir = await mkdtemp(path.join(tmpdir(), 'ffp-perf-'));

const stacks = ['Arial', 'Georgia', 'Courier New', 'Verdana', 'Times New Roman', 'Trebuchet MS', 'DejaVu Sans', 'DejaVu Serif', 'Liberation Mono', 'monospace'];
let body = '';
for (let i = 0; i < 20000; i++) {
  const f = stacks[i % stacks.length];
  const w = [400, 700][i % 2];
  const s = 12 + (i % 4) * 4;
  body += `<p style="font-family:'Fam${i % 40}','${f}';font-weight:${w};font-size:${s}px">Paragraph ${i} with some sample words to measure</p>\n`;
}
fs.writeFileSync(path.join(dir, 'big.html'), `<!doctype html><meta charset="utf-8"><title>Big</title><body>${body}</body>`);

const PORT = 8766;
const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: dir, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));

const ctx = await chromium.launchPersistentContext(await mkdtemp(path.join(tmpdir(), 'ffp-')), {
  channel: 'chromium',
  headless: true,
  viewport: { width: 1280, height: 860 },
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
const rows = [];
const budget = (name, ms, max) => rows.push({ name, ms: Math.round(ms), max, ok: ms <= max });
try {
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent('serviceworker');
  const extId = new URL(sw.url()).host;
  const page = await ctx.newPage();
  const url = `http://127.0.0.1:${PORT}/big.html`;
  await page.goto(url, { waitUntil: 'load' });
  const tabId = await sw.evaluate(async (u) => (await chrome.tabs.query({ url: u }))[0].id, url);

  let t = Date.now();
  await sw.evaluate(async (id) => {
    await chrome.scripting.executeScript({ target: { tabId: id }, files: ['content.js'] });
    await chrome.tabs.sendMessage(id, { type: 'ffp:inspect', on: true });
  }, tabId);
  budget('inject and start the inspector', Date.now() - t, 500);

  t = Date.now();
  const reply = await sw.evaluate(async (id) => chrome.tabs.sendMessage(id, { type: 'ffp:scan' }), tabId);
  budget(`full scan (${reply?.scan?.fonts?.length ?? 0} fonts, 20,000 elements)`, Date.now() - t, 2500);

  t = Date.now();
  await sw.evaluate(async (id) => chrome.tabs.sendMessage(id, { type: 'ffp:scan' }), tabId);
  budget('second scan', Date.now() - t, 2500);

  // Hover: time from mouse move to the hover card being drawn, over 20 moves.
  const hover = await page.evaluate(async () => {
    const ps = [...document.querySelectorAll('p')].slice(0, 20);
    const times = [];
    for (const p of ps) {
      const r = p.getBoundingClientRect();
      const t0 = performance.now();
      p.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: r.left + 5, clientY: r.top + 5 }));
      await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    return times[Math.floor(times.length * 0.9)];
  });
  budget('hover card (90th percentile, includes 2 frames)', hover, 60);

  const panel = await ctx.newPage();
  t = Date.now();
  await panel.goto(`chrome-extension://${extId}/sidepanel.html?tab=${tabId}`);
  await panel.waitForSelector('.fcard', { timeout: 30000 });
  budget('panel open to first font card', Date.now() - t, 3000);

  const cdp = await ctx.newCDPSession(panel);
  await cdp.send('HeapProfiler.collectGarbage');
  const { usedSize } = await cdp.send('Runtime.getHeapUsage');
  rows.push({ name: 'panel memory (JS heap)', ms: null, mb: +(usedSize / 1048576).toFixed(1), max: 80, ok: usedSize / 1048576 <= 80 });
  const pcdp = await ctx.newCDPSession(page);
  const ph = await pcdp.send('Runtime.getHeapUsage');
  rows.push({ name: 'page memory with inspector on (JS heap)', ms: null, mb: +(ph.usedSize / 1048576).toFixed(1), max: 60, ok: ph.usedSize / 1048576 <= 60 });
} finally {
  await ctx.close();
  server.kill();
}
for (const r of rows) console.log(`${r.ok ? 'PASS' : 'SLOW'}  ${r.name}: ${r.ms != null ? `${r.ms} ms (budget ${r.max})` : `${r.mb} MB (budget ${r.max})`}`);
fs.mkdirSync(path.join(root, 'tests/output'), { recursive: true });
fs.writeFileSync(path.join(root, 'tests/output/perf.json'), JSON.stringify(rows, null, 2));
process.exit(rows.every((r) => r.ok) ? 0 : 1);
