// End-to-end checks for Phase 1. Loads the test build into Chromium, opens the
// fixture page, injects the content script the same way the toolbar icon does,
// and checks detection, the hover card and the side panel.
//
//   npm run build:test && node tests/run.mjs
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Playwright: use the local package if installed, otherwise the global one.
const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  ({ chromium } = require(path.join(execSync('npm root -g').toString().trim(), 'playwright')));
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ext = path.join(root, 'dist-test');
const out = path.join(root, 'tests/output');
await mkdir(out, { recursive: true });

const PORT = 8765;
const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: path.join(root, 'tests/fixtures'), stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
const ctx = await chromium.launchPersistentContext(await mkdtemp(path.join(tmpdir(), 'ffp-')), {
  channel: 'chromium',
  headless: true,
  viewport: { width: 1280, height: 860 },
  proxy: proxy ? { server: proxy, bypass: '127.0.0.1,localhost' } : undefined,
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});

try {
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent('serviceworker');
  const extId = new URL(sw.url()).host;
  check('extension loads', !!extId, extId);

  const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);

  const tabId = await sw.evaluate(async (url) => (await chrome.tabs.query({ url }))[0].id, `http://127.0.0.1:${PORT}/index.html`);

  // Inject and start, as the toolbar click does.
  await sw.evaluate(async (id) => {
    await chrome.scripting.executeScript({ target: { tabId: id }, files: ['content.js'] });
    await chrome.tabs.sendMessage(id, { type: 'ffp:inspect', on: true });
  }, tabId);

  const scanReply = await sw.evaluate(async (id) => chrome.tabs.sendMessage(id, { type: 'ffp:scan' }), tabId);
  check('scan answers', scanReply?.ok === true, scanReply?.error ?? '');
  const scan = scanReply.scan;
  const fam = (name) => scan.fonts.find((f) => f.family === name);
  console.log('  fonts:', scan.fonts.map((f) => `${f.family}[${f.kind}/${f.source}/${f.licenseType}] ${f.elementCount}`).join(' | '));
  console.log('  not loaded:', JSON.stringify(scan.notLoaded));

  check('Fraunces detected as Google Fonts', fam('Fraunces')?.source === 'google' && fam('Fraunces')?.kind === 'web');
  check('Fraunces license is OFL from catalogue', fam('Fraunces')?.licenseType === 'OFL');
  check('Fraunces used for headings', (fam('Fraunces')?.roles.heading ?? 0) >= 1);
  check('Inter detected as Google Fonts body', fam('Inter')?.source === 'google' && (fam('Inter')?.roles.body ?? 0) >= 1);
  check('House Mono detected as self-hosted', fam('House Mono')?.source === 'self-hosted');
  check('House Mono used for code', (fam('House Mono')?.roles.code ?? 0) >= 1);
  const geist = fam('__Geist_Mono_9a8b7c');
  check('renamed Google font matched by name', geist?.catalogFamily === 'Geist Mono' && geist?.displayName === 'Geist Mono', JSON.stringify({ c: geist?.catalogFamily, d: geist?.displayName }));
  check('renamed Google font license from catalogue', geist?.licenseType === 'OFL');
  const sohne = scan.notLoaded.find((n) => n.family === 'Sohne Test');
  check('font that failed to load is reported', !!sohne, sohne ? `fell back to ${sohne.fellBackTo}` : '');
  const nonexist = scan.notLoaded.find((n) => n.family === 'Nonexistent Serif');
  check('missing local font is reported', !!nonexist, nonexist ? `fell back to ${nonexist.fellBackTo}` : '');
  check('system font detected for button', scan.fonts.some((f) => f.roles.button && (f.kind === 'local' || f.kind === 'generic')));

  // Hover card on the heading
  const h1 = await page.locator('h1').boundingBox();
  await page.mouse.move(h1.x + 40, h1.y + 20);
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(out, 'tooltip-hover.png') });
  // Pin with Space and copy the size row
  await page.keyboard.press('Space');
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(out, 'tooltip-pinned.png') });

  // Side panel as a page, pinned to the fixture tab
  const panel = await ctx.newPage();
  await panel.setViewportSize({ width: 400, height: 1100 });
  await panel.goto(`chrome-extension://${extId}/sidepanel.html?tab=${tabId}`);
  await panel.waitForSelector('.fcard', { timeout: 20000 });
  await panel.waitForTimeout(2500);
  await panel.screenshot({ path: path.join(out, 'panel-page.png'), fullPage: true });
  const cards = await panel.locator('.fcard').count();
  check('side panel lists fonts', cards >= 4, `${cards} cards`);
  check('page card shows Geist Mono by its real name', (await panel.locator('.fcard', { hasText: 'Geist Mono' }).count()) === 1);
  // BrandSerif is only recognised after the file's own name table is read.
  await panel.waitForFunction(() => [...document.querySelectorAll('.fcard')].some((c) => c.textContent.includes('Libre Caslon Condensed')), null, { timeout: 15000 }).catch(() => {});
  check('font renamed in CSS confirmed from its file', (await panel.locator('.fcard', { hasText: 'Libre Caslon Condensed' }).count()) === 1);
  check('how it works guide is shown', (await panel.locator('.guide').count()) === 1);
  check('side panel shows not-loaded warning', (await panel.locator('.notice.amber').count()) >= 1);

  // Font detail for Fraunces
  await panel.locator('.fcard', { hasText: 'Fraunces' }).locator('button', { hasText: 'Details' }).click();
  await panel.waitForSelector('.hero-name');
  await panel.waitForFunction(() => document.body.innerText.includes('Glyphs') || document.body.innerText.includes('could not'), null, { timeout: 20000 }).catch(() => {});
  await panel.waitForTimeout(1500);
  await panel.screenshot({ path: path.join(out, 'panel-detail.png'), fullPage: true });
  const detailText = await panel.locator('body').innerText();
  check('detail shows designers from catalogue', detailText.includes('Undercase Type'));
  check('detail read the font file (format WOFF2)', detailText.includes('WOFF2'));
  check('detail shows variable axes', /opsz/i.test(detailText));
  check('detail links to Google Fonts', (await panel.locator('a[href="https://fonts.google.com/specimen/Fraunces"]').count()) >= 1);

  // Save to library and create a collection
  await panel.locator('.topbar button', { hasText: 'Save' }).click();
  await panel.waitForSelector('text=[In your library]');
  await panel.locator('button', { hasText: '+ New collection' }).click();
  await panel.fill('input[aria-label="Collection name"]', 'Editorial');
  await panel.locator('button', { hasText: 'Create' }).click();
  await panel.waitForTimeout(400);
  await panel.locator('button[aria-label="Back"]').click();
  await panel.locator('.tabs button', { hasText: 'Library' }).click();
  await panel.waitForSelector('.lrow');
  await panel.waitForTimeout(1200);
  await panel.screenshot({ path: path.join(out, 'panel-library.png'), fullPage: true });
  const libText = await panel.locator('body').innerText();
  check('library shows saved font', libText.includes('Fraunces'));
  check('collection created with count', /Editorial\s*1/.test(libText));

  // Filters: classification Mono should hide Fraunces
  await panel.selectOption('select[aria-label="Style"]', 'mono');
  await panel.waitForTimeout(200);
  check('filter by classification works', (await panel.locator('.lrow').count()) === 0);
  await panel.selectOption('select[aria-label="Style"]', 'all');
  await panel.selectOption('select[aria-label="Source"]', 'on-google');
  await panel.waitForTimeout(200);
  check('filter "Available on Google Fonts" works', (await panel.locator('.lrow').count()) === 1);
  await panel.selectOption('select[aria-label="Source"]', 'all');
  await panel.fill('#lib-search', 'undercase');
  await panel.waitForTimeout(200);
  check('search by designer works', (await panel.locator('.lrow').count()) === 1);
  // The select arrow must sit inside the select box.
  const arrowInside = await panel.evaluate(() => [...document.querySelectorAll('.selectwrap')].every((w) => {
    const a = w.getBoundingClientRect(); const i = w.querySelector('svg').getBoundingClientRect();
    return i.right <= a.right - 4 && i.left >= a.left;
  }));
  check('dropdown arrows sit inside their boxes', arrowInside);
  await panel.locator('.viewtoggle button[aria-label="Grid"]').click();
  await panel.waitForTimeout(300);
  await panel.screenshot({ path: path.join(out, 'panel-library-grid.png'), fullPage: true });
  await panel.locator('.viewtoggle button[aria-label="Wide list"]').click();

  // Save from the hover card (code element, self-hosted)
  await page.bringToFront();
  await page.keyboard.press('Space'); // unpin
  const code = await page.locator('code').boundingBox();
  await page.mouse.click(code.x + 10, code.y + 6);
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(out, 'tooltip-code.png') });
  const saved = await sw.evaluate(async () => {
    const req = indexedDB.open('font-finder-plus');
    const dbh = await new Promise((r) => (req.onsuccess = () => r(req.result)));
    const tx = dbh.transaction('savedFonts');
    const all = await new Promise((r) => {
      const q = tx.objectStore('savedFonts').getAll();
      q.onsuccess = () => r(q.result);
    });
    return all.map((s) => s.fontId);
  });
  check('save from page stored in library DB', saved.includes('Fraunces::google'), saved.join(', '));

  // Dark theme screenshot
  await panel.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await panel.locator('.tabs button', { hasText: 'Page' }).click();
  await panel.waitForSelector('.fcard');
  await panel.waitForTimeout(1500);
  await panel.screenshot({ path: path.join(out, 'panel-page-dark.png'), fullPage: true });
} catch (err) {
  check('test run finished without errors', false, String(err?.stack ?? err));
} finally {
  await ctx.close();
  server.kill();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
