// Cross-site matrix: opens real sites, injects the inspector, scans, and writes
// tests/output/sites.md with the fonts found, timings and any errors.
// Run: npm run build:test && node tests/sites.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ext = path.join(root, 'dist-test');

const SITES = [
  ['News, serif', 'https://www.theguardian.com/international'],
  ['Wikipedia (English)', 'https://en.wikipedia.org/wiki/Typeface'],
  ['Wikipedia (Arabic, right to left)', 'https://ar.wikipedia.org/wiki/%D8%AE%D8%B7_(%D8%B7%D8%A8%D8%A7%D8%B9%D8%A9)'],
  ['Wikipedia (Chinese)', 'https://zh.wikipedia.org/wiki/%E5%AD%97%E4%BD%93'],
  ['Wikipedia (Japanese)', 'https://ja.wikipedia.org/wiki/%E6%9B%B8%E4%BD%93'],
  ['GitHub', 'https://github.com/'],
  ['Stripe', 'https://stripe.com/'],
  ['Vercel (Geist)', 'https://vercel.com/'],
  ['Linear', 'https://linear.app/'],
  ['Klim (foundry)', 'https://klim.co.nz/'],
  ['Commercial Type (foundry)', 'https://commercialtype.com/'],
  ['Google Fonts', 'https://fonts.google.com/'],
  ['Apple', 'https://www.apple.com/'],
  ['BBC', 'https://www.bbc.co.uk/'],
  ['MDN (docs)', 'https://developer.mozilla.org/en-US/'],
];

const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
const ctx = await chromium.launchPersistentContext(await mkdtemp(path.join(tmpdir(), 'ffp-')), {
  channel: 'chromium',
  headless: true,
  viewport: { width: 1280, height: 860 },
  proxy: proxy ? { server: proxy } : undefined,
  ignoreHTTPSErrors: false,
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent('serviceworker');

const rows = [];
for (const [label, url] of SITES) {
  const page = await ctx.newPage();
  const row = { label, url, ok: false, fonts: [], ms: 0, notLoaded: 0, error: '' };
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.evaluate(() => document.fonts.ready);
    const tabId = await sw.evaluate(async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0]?.id);
    await sw.evaluate(async (id) => {
      await chrome.scripting.executeScript({ target: { tabId: id }, files: ['content.js'] });
      await chrome.tabs.sendMessage(id, { type: 'ffp:inspect', on: true });
    }, tabId);
    const t = Date.now();
    const reply = await sw.evaluate(async (id) => chrome.tabs.sendMessage(id, { type: 'ffp:scan' }), tabId);
    row.ms = Date.now() - t;
    if (!reply?.ok) throw new Error(reply?.error ?? 'no reply');
    row.fonts = reply.scan.fonts.filter((f) => f.kind !== 'generic').map((f) => `${f.displayName ?? f.family} (${f.licenseType})`);
    row.notLoaded = reply.scan.notLoaded?.length ?? 0;
    // Hover the first heading and check the card appears.
    const h = page.locator('h1, h2').first();
    if (await h.count()) {
      await h.hover({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(300);
      row.card = await page.evaluate(() => !!document.querySelector('ffp-root'));
    }
    row.ok = row.fonts.length > 0;
  } catch (e) {
    row.error = String(e.message ?? e).split('\n')[0].slice(0, 140);
  }
  console.log(`${row.ok ? 'OK  ' : 'FAIL'}  ${label}: ${row.fonts.length} fonts, ${row.ms} ms ${row.error}`);
  rows.push(row);
  await page.close();
}
await ctx.close();

const md = ['# Cross-site test', '', `Run on ${new Date().toISOString().slice(0, 10)}, headless Chromium.`, '', '| Site | Result | Scan | Fonts found | Not loaded |', '|---|---|---|---|---|'];
for (const r of rows) md.push(`| [${r.label}](${r.url}) | ${r.ok ? 'OK' : `Failed: ${r.error || 'no fonts'}`} | ${r.ms} ms | ${r.fonts.join(', ').replace(/\|/g, '/')} | ${r.notLoaded} |`);
fs.mkdirSync(path.join(root, 'tests/output'), { recursive: true });
fs.writeFileSync(path.join(root, 'tests/output/sites.md'), md.join('\n') + '\n');
console.log(`\n${rows.filter((r) => r.ok).length}/${rows.length} sites OK`);
