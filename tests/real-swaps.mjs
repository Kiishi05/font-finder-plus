// Opens real sites with the extension and reads Make it free and Similar fonts
// for their paid fonts, to check both give the same answer.
// Run: npm run build:test && node tests/real-swaps.mjs https://stripe.com/ https://www.anthropic.com/
import { createRequire } from 'node:module';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ext = path.join(root, 'dist-test');
const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
const ctx = await chromium.launchPersistentContext(await mkdtemp(path.join(tmpdir(), 'ffp-')), {
  channel: 'chromium', headless: true, viewport: { width: 1280, height: 900 },
  proxy: proxy ? { server: proxy } : undefined,
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent('serviceworker');
const extId = new URL(sw.url()).host;
for (const url of process.argv.slice(2)) {
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  const tabId = await sw.evaluate(async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0]?.id);
  await sw.evaluate(async (id) => { await chrome.scripting.executeScript({ target: { tabId: id }, files: ['content.js'] }); }, tabId);
  const panel = await ctx.newPage();
  await panel.goto(`chrome-extension://${extId}/sidepanel.html?tab=${tabId}`);
  await panel.waitForSelector('.fcard', { timeout: 30000 });
  await panel.waitForFunction(() => { const rows = [...document.querySelectorAll('.freerow')]; return rows.length && rows.every((r) => !/Measuring/.test(r.textContent)); }, null, { timeout: 90000 }).catch(() => {});
  const rows = await panel.$$eval('.freerow', (rs) => rs.map((r) => r.innerText.replace(/\s+/g, ' ')));
  console.log(`\n${url}\n  Make it free:`);
  rows.forEach((r) => console.log('   ', r));
  // Open the first paid font's details and read Similar fonts.
  const first = rows[0]?.split(' to ')[0];
  if (first) {
    await panel.locator('.fcard', { hasText: new RegExp(first, 'i') }).first().locator('button', { hasText: 'Details' }).click().catch((e) => console.log('  could not open details', String(e).slice(0, 80)));
    await panel.waitForSelector('#sec-similar', { timeout: 15000 }).catch(() => {});
    await panel.waitForFunction(() => !/Comparing letter|Measuring/.test(document.querySelector('#sec-similar')?.textContent ?? 'Measuring'), null, { timeout: 60000 }).catch(() => {});
    const sim = await panel.locator('#sec-similar').innerText().catch(() => '');
    console.log(`  Similar fonts for ${first}:`, sim.replace(/\s+/g, ' ').slice(0, 300));
  }
  await panel.close();
  await page.close();
}
await ctx.close();
