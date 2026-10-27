// End-to-end checks for Phase 1. Loads the test build into Chromium, opens the
// fixture page, injects the content script the same way the toolbar icon does,
// and checks detection, the hover card and the side panel.
//
//   npm run build:test && node tests/run.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
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
  check('icon font left out of the list', !scan.fonts.some((f) => /Icons/.test(f.family)) && scan.iconFonts.includes('Site Icons'), JSON.stringify(scan.iconFonts));
  const demo = scan.fonts.find((f) => f.key === 'demo::web');
  check('separate weight files are grouped as one family', demo?.displayName === 'Demo' && demo.memberFamilies?.length === 2 && demo.styleNames?.includes('Bold'), JSON.stringify(demo && { d: demo.displayName, m: demo.memberFamilies, s: demo.styleNames }));
  check('words drawn as pictures are noted', scan.pictureText?.count >= 1 && scan.pictureText.examples.includes('Specimen Name'), JSON.stringify(scan.pictureText));
  check('real SVG text is read', fam('__Geist_Mono_9a8b7c')?.elementCount === 2, String(fam('__Geist_Mono_9a8b7c')?.elementCount));
  const measured = await sw.evaluate(async (id) => chrome.tabs.sendMessage(id, { type: 'ffp:measure', family: 'Fraunces', weight: '400', style: 'normal' }), tabId);
  const ref = JSON.parse(fs.readFileSync(path.join(root, 'src/shared/data/gf-shapes.json'), 'utf8')).families.Fraunces;
  const ms = measured?.shape;
  check('measuring on the page matches the measured font data', !!ms && Math.abs(ms.x - ref[0]) < 0.02 && Math.abs(ms.w - ref[4]) < 0.03 && Math.abs(ms.contrast - ref[6]) / ref[6] < 0.3 && ms.g2 === ref[8] && ms.a2 === ref[9], JSON.stringify({ page: ms && [ms.x, ms.w, ms.contrast, ms.g2, ms.a2], data: [ref[0], ref[4], ref[6], ref[8], ref[9]] }));
  check('system font detected for button', scan.fonts.some((f) => f.roles.button && (f.kind === 'local' || f.kind === 'generic')));

  // Hover card on the heading
  const h1 = await page.locator('h1').boundingBox();
  await page.mouse.move(h1.x + 40, h1.y + 20);
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(out, 'tooltip-hover.png') });
  // Click pins the card
  await page.mouse.click(h1.x + 40, h1.y + 20);
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(out, 'tooltip-pinned.png') });
  const ui = (sel) => page.evaluate((s) => {
    const el = document.getElementById('ffp-root')?.shadowRoot?.querySelector(s);
    return el ? { hidden: el.hidden, text: el.textContent, n: el.children.length } : null;
  }, sel);
  check('control bar with Stop is shown while inspecting', (await ui('.bar'))?.hidden === false && /Stop/.test((await ui('.bar')).text));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  check('Esc does not stop inspecting (Chrome uses it for full screen)', (await ui('.bar'))?.hidden === false);
  await page.evaluate(() => document.getElementById('ffp-root').shadowRoot.querySelector('.close').click());
  await page.waitForTimeout(100);
  check('close button hides the card', (await ui('.card'))?.hidden === true);
  await page.evaluate(() => document.getElementById('ffp-root').shadowRoot.querySelector('.stop').click());
  await page.waitForTimeout(100);
  check('Stop button turns inspecting off', (await ui('.bar'))?.hidden === true);
  await sw.evaluate(async (id) => chrome.tabs.sendMessage(id, { type: 'ffp:inspect', on: true }), tabId);
  await page.mouse.move(h1.x + 40, h1.y + 20);
  await page.mouse.move(h1.x + 60, h1.y + 24);
  await page.waitForTimeout(300);
  await page.mouse.click(h1.x + 60, h1.y + 24);
  await page.waitForTimeout(100);
  check('click pins the card', await page.evaluate(() => document.getElementById('ffp-root').shadowRoot.querySelector('.card').classList.contains('pinned')));

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
  // Show on page: outlines sit on the heading text itself
  await panel.locator('.fcard', { hasText: 'Fraunces' }).locator('button', { hasText: 'Show on page' }).click();
  await page.waitForTimeout(300);
  const marks = await page.evaluate(() => {
    const sr = document.getElementById('ffp-root').shadowRoot;
    const h = document.querySelector('h1').getBoundingClientRect();
    const ms = [...sr.querySelectorAll('.mark')].map((m) => m.getBoundingClientRect());
    return { n: ms.length, onHeading: ms.some((m) => m.top >= h.top - 16 && m.bottom <= h.bottom + 16 && m.width <= h.width + 12), flag: sr.querySelector('.flag').textContent };
  });
  check('Show on page outlines the text', marks.n >= 2 && marks.onHeading, JSON.stringify(marks));
  check('Show on page counts text hidden in a closed menu', /2 hidden/.test(marks.flag), marks.flag);
  check('hidden uses are counted in the scan', fam('Fraunces')?.hiddenCount === 2, String(fam('Fraunces')?.hiddenCount));
  await panel.locator('.fcard', { hasText: 'Libre Caslon Condensed' }).locator('button', { hasText: 'Show on page' }).click();
  await page.waitForTimeout(300);
  const quote = await page.evaluate(() => {
    const sr = document.getElementById('ffp-root').shadowRoot;
    const ms = [...sr.querySelectorAll('.mark')].map((m) => m.getBoundingClientRect());
    const q = document.querySelector('blockquote').getBoundingClientRect();
    return { n: ms.length, covers: ms.length === 1 && ms[0].top <= q.top + 4 && ms[0].bottom >= q.bottom - 4 };
  });
  check('a paragraph in one font is outlined as one block', quote.covers, JSON.stringify(quote));
  check('button changes to Hide outlines', (await panel.locator('.fcard', { hasText: 'Libre Caslon Condensed' }).locator('button', { hasText: 'Hide outlines' }).count()) === 1);
  await panel.locator('.fcard', { hasText: 'Libre Caslon Condensed' }).locator('button', { hasText: 'Hide outlines' }).click();
  await page.waitForTimeout(200);
  check('second click removes the outlines', await page.evaluate(() => document.getElementById('ffp-root').shadowRoot.querySelectorAll('.mark').length === 0));
  check('button returns to Show on page', (await panel.locator('.fcard', { hasText: 'Libre Caslon Condensed' }).locator('button', { hasText: 'Show on page' }).count()) === 1);
  await panel.locator('.fcard', { hasText: 'Inter' }).first().locator('button', { hasText: 'Show on page' }).click();
  await page.waitForTimeout(300);
  const mixed = await page.evaluate(() => {
    const sr = document.getElementById('ffp-root').shadowRoot;
    const code = document.querySelector('code').getBoundingClientRect();
    const ms = [...sr.querySelectorAll('.mark')].map((m) => m.getBoundingClientRect());
    const coversCode = ms.some((m) => m.left <= code.left + 2 && m.right >= code.right - 2 && m.top <= code.top + 2 && m.bottom >= code.bottom - 2);
    return { n: ms.length, coversCode };
  });
  check('mixed paragraph: the code word in another font is not outlined', mixed.n >= 2 && !mixed.coversCode, JSON.stringify(mixed));
  await panel.locator('.fcard', { hasText: 'Inter' }).first().locator('button', { hasText: 'Hide outlines' }).click();
  await page.screenshot({ path: path.join(out, 'show-on-page.png') });
  // Language sample
  await panel.selectOption('select[aria-label="Language sample"]', 'yo');
  await panel.waitForTimeout(150);
  await panel.selectOption('select[aria-label="Language sample"]', 'ar');
  await panel.waitForTimeout(400);
  const miss = await panel.locator('.missing').first().innerText().catch(() => '');
  check('missing letters are named in words, in quotes', /does not support Arabic\. \d+ letters are missing \(“/.test(miss), miss.slice(0, 90));
  await panel.selectOption('select[aria-label="Language sample"]', 'zh-hans');
  await panel.waitForTimeout(500);
  const missZh = await panel.locator('.missing').first().innerText().catch(() => '');
  check('missing Chinese is detected too', /does not support Chinese/.test(missZh), missZh.slice(0, 80));
  await panel.selectOption('select[aria-label="Language sample"]', 'yo');
  await panel.waitForTimeout(150);
  check('language sample shows Yoruba text', (await panel.locator('.fcard .specimen').first().innerText()).includes('káàárọ̀'));
  await panel.screenshot({ path: path.join(out, 'panel-page-yoruba.png'), fullPage: true });
  await panel.locator('.toggles button', { hasText: 'Font name' }).click();
  const interCard = panel.locator('.fcard', { hasText: 'Inter' }).first();
  await interCard.locator('.actions button', { hasText: 'Save' }).click();
  await panel.waitForTimeout(300);
  check('saving shows the collection picker', (await interCard.locator('.cardpicker').count()) === 1);
  await interCard.locator('.actions button', { hasText: 'Saved' }).click();
  await panel.waitForTimeout(300);
  check('clicking Saved unsaves the font', (await interCard.locator('.actions button', { hasText: /^Save$/ }).count()) === 1 && (await interCard.locator('.cardpicker').count()) === 0);
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
  await panel.waitForFunction(() => /of \d+ supported/i.test(document.body.innerText) && document.body.innerText.includes('full family on Google Fonts'), null, { timeout: 30000 }).catch(() => {});
  await panel.waitForSelector('.glyphs button', { timeout: 20000 }).catch(() => {});
  await panel.screenshot({ path: path.join(out, 'panel-detail-phase2.png'), fullPage: true });
  const d2 = await panel.locator('body').innerText();
  check('licence card in plain language', d2.includes('SIL Open Font License') && d2.includes('Websites') && d2.includes('This is a summary, not legal advice.'));
  check('language coverage checked against Google Fonts', /\d+ of 35 supported/i.test(d2) && d2.includes('full family on Google Fonts'), (d2.match(/\d+ of 35 supported/i) || [''])[0]);
  check('Fraunces supports Vietnamese, not Arabic', await panel.evaluate(() => {
    const rows = [...document.querySelectorAll('.langhead')].map((r) => r.innerText.replace(/\s+/g, ' '));
    const none = document.querySelector('.langs')?.innerText ?? '';
    return rows.some((r) => r.startsWith('Vietnamese') && r.includes('Supported')) && /Not supported \(\d+\)[\s\S]*Arabic/.test(none);
  }));
  check('glyph grid shows the font\'s characters', (await panel.locator('.glyphs button').count()) > 100, String(await panel.locator('.glyphs button').count()));
  await panel.fill('input[aria-label="Find a character"]', 'é');
  await panel.waitForTimeout(100);
  check('glyph search finds a letter', (await panel.locator('.glyphs button').count()) === 1);
  await panel.locator('.glyphs button').first().click();
  check('glyph detail shows the code point', (await panel.locator('.glyphsel').innerText()).includes('U+00E9'));
  check('installed check answers', /Installed|Not installed/.test(d2));
  // Phase 3: similar fonts, live swap, pairs, playground
  await panel.waitForSelector('.match', { timeout: 15000 }).catch(() => {});
  const sim = await panel.evaluate(() => [...document.querySelectorAll('.match b')].map((b) => b.textContent));
  check('similar free fonts listed', sim.length >= 5 && !sim.includes('Fraunces'), sim.slice(0, 5).join(', '));
  await panel.locator('.match button', { hasText: 'Try on page' }).first().click();
  await page.waitForFunction(() => document.querySelector('h1')?.getAttribute('data-ffp-swap'), null, { timeout: 20000 }).catch(() => {});
  const swapped = await page.evaluate(() => ({ attr: document.querySelector('h1').getAttribute('data-ffp-swap'), ff: getComputedStyle(document.querySelector('h1')).fontFamily, adj: getComputedStyle(document.querySelector('h1')).fontSizeAdjust }));
  check('Try on page swaps the font live', !!swapped.attr && /FFP Swap/.test(swapped.ff), JSON.stringify(swapped));
  await page.screenshot({ path: path.join(out, 'swap-on-page.png') });
  const rescan = await sw.evaluate(async (id) => chrome.tabs.sendMessage(id, { type: 'ffp:scan' }), tabId);
  const hb0 = await page.locator('h1').boundingBox();
  await page.bringToFront();
  await page.mouse.move(hb0.x + 30, hb0.y + 20);
  await page.mouse.move(hb0.x + 34, hb0.y + 22);
  await page.waitForTimeout(400);
  const swapCard = await page.evaluate(() => { const sr = document.getElementById('ffp-root').shadowRoot; return sr.querySelector('.name').textContent + ' | ' + sr.querySelector('.meta').textContent; });
  check('hover card shows the swapped-in font', swapCard.startsWith(swapped.attr) && /SHOWING INSTEAD OF FRAUNCES/.test(swapCard), swapCard);
  await panel.bringToFront();
  check('a re-scan still reports the original font while swapped', rescan.scan.fonts.some((f) => f.family === 'Fraunces'));
  await panel.locator('.match button', { hasText: 'Showing on page' }).first().click();
  await page.waitForTimeout(300);
  check('Undo puts the original font back', await page.evaluate(() => !document.querySelector('h1').hasAttribute('data-ffp-swap') && !/FFP Swap/.test(getComputedStyle(document.querySelector('h1')).fontFamily)));
  check('pairs suggested', (await panel.locator('text=[Pairs well with]').count()) === 1 && (await panel.locator('.pairprev').count()) >= 3);
  check('variable playground has sliders', (await panel.locator('.axis input[type=range]').count()) >= 2);
  await panel.screenshot({ path: path.join(out, 'panel-detail-phase3.png'), fullPage: true });
  check('detail links to Google Fonts', (await panel.locator('a[href="https://fonts.google.com/specimen/Fraunces"]').count()) >= 1);

  // Save to library and create a collection
  await panel.locator('.topbar button', { hasText: 'Save' }).click();
  await panel.waitForSelector('text=[In your library]');
  await panel.locator('button', { hasText: '+ New collection' }).click();
  await panel.fill('input[aria-label="Collection name"]', 'Editorial');
  await panel.locator('button', { hasText: 'Create' }).click();
  await panel.waitForTimeout(400);

  // Phase 5: screenshot of where you saw it
  await panel.locator('button', { hasText: 'Save a screenshot of this page' }).click();
  await panel.waitForSelector('.shot img', { timeout: 10000 }).catch(() => {});
  check('screenshot saved with the font', (await panel.locator('.shot img').count()) === 1);
  const [viewer] = await Promise.all([ctx.waitForEvent('page'), panel.locator('.shotimg').first().click()]);
  await viewer.waitForLoadState();
  await viewer.waitForSelector('.viewer img', { timeout: 10000 }).catch(() => {});
  check('clicking a screenshot opens it full size', await viewer.evaluate(() => { const i = document.querySelector('.viewer img'); return !!i && i.complete && i.naturalWidth > 100; }).catch(() => false));
  await viewer.close();

  // Phase 5: share card
  await panel.locator('button', { hasText: 'Share card' }).click();
  await panel.waitForSelector('canvas.cardcanvas');
  await panel.waitForTimeout(1500);
  const cardInfo = async () => panel.evaluate(() => {
    const c = document.querySelector('canvas.cardcanvas');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let ink = 0;
    for (let i = 0; i < d.length; i += 4 * 97) if (d[i] < 100) ink++;
    return { w: c.width, h: c.height, ink };
  });
  const land = await cardInfo();
  check('share card is 1200 x 675 and drawn', land.w === 1200 && land.h === 675 && land.ink > 50, JSON.stringify(land));
  await panel.screenshot({ path: path.join(out, 'panel-share-landscape.png'), fullPage: true });
  await panel.locator('.seg button', { hasText: 'Portrait' }).click();
  await panel.waitForTimeout(1200);
  const port = await cardInfo();
  check('share card portrait is 1080 x 1350', port.w === 1080 && port.h === 1350, JSON.stringify(port));
  await panel.locator('.seg button', { hasText: 'Dark' }).click();
  await panel.waitForTimeout(800);
  await panel.screenshot({ path: path.join(out, 'panel-share-portrait-dark.png'), fullPage: true });
  const [dl] = await Promise.all([panel.waitForEvent('download'), panel.locator('button', { hasText: 'Download PNG' }).click()]);
  check('share card downloads as PNG', dl.suggestedFilename() === 'fraunces-portrait.png', dl.suggestedFilename());
  await panel.locator('button[aria-label="Back"]').click();
  await panel.waitForSelector('.hero-name');

  await panel.locator('button[aria-label="Back"]').click();
  await panel.locator('.tabs button', { hasText: 'Library' }).click();
  await panel.waitForSelector('.lcard');
  await panel.waitForTimeout(1200);
  await panel.screenshot({ path: path.join(out, 'panel-library.png'), fullPage: true });
  const libText = await panel.locator('body').innerText();
  check('library shows saved font', libText.includes('Fraunces'));
  check('collection created with count', /Editorial\s*1/.test(libText));

  check('library shows a grid by default', (await panel.locator('.grid2 .lcard').count()) === 1);
  // Add to a second collection from the library card
  await panel.locator('.lcard button[aria-label="Add to collection"]').click();
  await panel.locator('.lcard .chip', { hasText: '+ New collection' }).click();
  await panel.fill('.lcard input[aria-label="Collection name"]', 'Client B');
  await panel.locator('.lcard button', { hasText: 'Create' }).click();
  await panel.waitForTimeout(400);
  const inBoth = await panel.locator('.chips').first().innerText();
  check('a font can be in two collections', /Editorial\s*1/.test(inBoth) && /Client B\s*1/.test(inBoth), inBoth.replace(/\n/g, ' '));
  await panel.screenshot({ path: path.join(out, 'panel-library-picker.png'), fullPage: true });
  // Add fonts from inside a collection
  await panel.locator('.chips').first().locator('button', { hasText: 'Client B' }).click();
  await panel.locator('button', { hasText: 'Add fonts' }).click();
  check('Add fonts lists saved fonts', (await panel.locator('.section .chip', { hasText: 'Fraunces' }).count()) === 1);
  await panel.locator('.section .chip', { hasText: 'Fraunces' }).click();
  await panel.waitForTimeout(200);
  check('Add fonts can remove a font too', (await panel.locator('.grid2 .lcard').count()) === 0);
  await panel.locator('.section .chip', { hasText: 'Fraunces' }).click();
  await panel.locator('.section button', { hasText: 'Done' }).click();
  await panel.locator('.chips').first().locator('button', { hasText: 'All' }).click();
  await panel.locator('.viewtoggle button[aria-label="Wide list"]').click();
  await panel.waitForSelector('.lrow');

  // Phase 5: boards
  await panel.locator('.libtools button', { hasText: 'Boards' }).click();
  await panel.locator('button', { hasText: 'New board' }).click();
  await panel.fill('input[aria-label="Board name"]', 'Editorial picks');
  await panel.locator('.chips .chip', { hasText: 'Fraunces' }).click();
  await panel.waitForSelector('canvas.cardcanvas');
  await panel.waitForTimeout(1500);
  const board = await panel.evaluate(() => { const c = document.querySelector('canvas.cardcanvas'); return { w: c.width, h: c.height }; });
  check('board drawn at 1200 wide', board.w === 1200 && board.h >= 400, JSON.stringify(board));
  await panel.screenshot({ path: path.join(out, 'panel-board.png'), fullPage: true });
  const [bdl] = await Promise.all([panel.waitForEvent('download'), panel.locator('button', { hasText: 'Download PNG' }).click()]);
  check('board downloads as PNG', bdl.suggestedFilename() === 'editorial-picks-board.png', bdl.suggestedFilename());
  await panel.locator('button[aria-label="Back"]').click();
  await panel.waitForSelector('.lrow', { timeout: 5000 }).catch(() => {});
  check('board listed', (await panel.locator('.lrow', { hasText: 'Editorial picks' }).count()) === 1);
  await panel.locator('button[aria-label="Back"]').click();
  await panel.waitForSelector('.libtools');

  // Phase 5: export and import
  const [edl] = await Promise.all([panel.waitForEvent('download'), panel.locator('.libtools button', { hasText: 'Export' }).click()]);
  const backup = JSON.parse(fs.readFileSync(await edl.path(), 'utf8'));
  check('library export has fonts, collections and boards', backup.format === 'font-finder-plus-library' && backup.savedFonts.length >= 1 && backup.collections.some((c) => c.name === 'Editorial') && backup.boards.length === 1);
  backup.collections.push({ id: 999, name: 'Imported set', color: '#3346FF', createdAt: 1 });
  backup.savedFonts.push({ fontId: 'Lora::google', collectionIds: [999], notes: 'from a backup', sitesSeen: ['example.com'], createdAt: 1, updatedAt: 1 });
  backup.fonts.push({ id: 'Lora::google', family: 'Lora', source: 'google', kind: 'web', classification: 'serif', licenseType: 'OFL', designers: [], catalogFamily: 'Lora', displayName: 'Lora', updatedAt: 1 });
  const importFile = path.join(out, 'import.json');
  fs.writeFileSync(importFile, JSON.stringify(backup));
  await panel.setInputFiles('input[aria-label="Import a library file"]', importFile);
  await panel.waitForTimeout(800);
  const libAfter = await panel.locator('body').innerText();
  check('import adds new fonts and collections without duplicates', libAfter.includes('Imported set') && libAfter.includes('Lora') && (libAfter.match(/Editorial\s+\d/g) || []).length === 1, (libAfter.match(/Imported set|Lora|Editorial\s+\d/g) || []).join(','));

  // Filters: classification Mono should hide Fraunces
  await panel.selectOption('select[aria-label="Style"]', 'mono');
  await panel.waitForTimeout(200);
  check('filter by classification works', (await panel.locator('.lrow').count()) === 0);
  await panel.selectOption('select[aria-label="Style"]', 'all');
  await panel.selectOption('select[aria-label="Source"]', 'on-google');
  await panel.waitForTimeout(200);
  check('filter "Available on Google Fonts" works', (await panel.locator('.lrow').count()) === 2);
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
  await panel.fill('#lib-search', '');
  await panel.waitForTimeout(300);
  await panel.screenshot({ path: path.join(out, 'panel-library-list.png'), fullPage: true });
  await panel.locator('.viewtoggle button[aria-label="Grid"]').click();

  // Save from the hover card (code element, self-hosted)
  await page.bringToFront();
  const code = await page.locator('code').boundingBox();
  const about = await page.locator('nav a', { hasText: 'About' }).boundingBox();
  await page.mouse.click(about.x + 5, about.y + 5); // unpins (and the link is not followed)
  await page.waitForTimeout(100);
  check('second click unpins the card', !(await page.evaluate(() => document.getElementById('ffp-root').shadowRoot.querySelector('.card').classList.contains('pinned'))));
  check('links are not followed while inspecting', !page.url().includes('#'));
  await page.mouse.click(code.x + 10, code.y + 6); // pins on the code
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

  // Phase 4: System tab
  const page2 = await ctx.newPage();
  await page2.goto(`http://127.0.0.1:${PORT}/page2.html`, { waitUntil: 'networkidle' });
  const tab2 = await sw.evaluate(async () => (await chrome.tabs.query({})).find((t) => t.url?.includes('page2.html'))?.id);
  await sw.evaluate(async (id) => chrome.scripting.executeScript({ target: { tabId: id }, files: ['content.js'] }), tab2);
  const panel2 = await ctx.newPage();
  await panel2.goto(`chrome-extension://${extId}/sidepanel.html?tab=${tab2}`);
  await panel2.waitForSelector('.fcard', { timeout: 20000 });
  await panel2.locator('.tabs button', { hasText: 'System' }).click();
  await panel2.waitForSelector('#sys-styles', { timeout: 20000 });
  await panel2.close();

  await panel.locator('.tabs button', { hasText: 'System' }).click();
  await panel.waitForSelector('#sys-styles', { timeout: 20000 });
  await panel.waitForTimeout(1200);
  await panel.screenshot({ path: path.join(out, 'panel-system.png'), fullPage: true });
  const sysText = await panel.locator('body').innerText();
  const names = await panel.evaluate(() => [...document.querySelectorAll('.tagname')].map((n) => n.textContent));
  check('type styles listed and named', names.includes('h1') && names.includes('body'), names.join(', '));
  check('size scale reported', /scale|No single size scale/i.test(await panel.locator('.scalebox').innerText()));
  check('readability flags low contrast', /Low contrast text/.test(sysText));
  await panel.locator('.issue', { hasText: 'Low contrast text' }).locator('button', { hasText: 'Show on page' }).click();
  await page.waitForTimeout(300);
  check('readability Show on page outlines the text', await page.evaluate(() => document.getElementById('ffp-root').shadowRoot.querySelectorAll('.mark').length >= 1));
  check('developer section counts font files', /\[Files\]\s*\n?\s*[1-9]/i.test(sysText) || /FILES\]\s*[1-9]/.test(sysText), (sysText.match(/FILES\][^\n]*\n?[^\n]*/i) || [''])[0]);
  const exported = async () => panel.locator('pre.code').innerText();
  const css = await exported();
  check('CSS export has variables and a Google Fonts import', css.includes('--font-heading') && css.includes('fonts.googleapis.com/css2?family=Fraunces') && css.includes('.text-h1'));
  await panel.selectOption('select[aria-label="Export format"]', 'tailwind4');
  check('Tailwind v4 export uses @theme', (await exported()).includes('@theme {') && (await exported()).includes('--text-h1--line-height'));
  await panel.selectOption('select[aria-label="Export format"]', 'tailwind3');
  check('Tailwind v3 export is a config', (await exported()).includes('module.exports') && (await exported()).includes('fontSize'));
  await panel.selectOption('select[aria-label="Export format"]', 'tokens');
  let tokensOk = false;
  try { const t = JSON.parse(await exported()); tokensOk = t.typography?.h1?.$type === 'typography'; } catch { tokensOk = false; }
  check('design tokens export is valid JSON', tokensOk);
  await panel.selectOption('select[aria-label="Export format"]', 'framer');
  check('Framer export lists text styles', (await exported()).includes('Line height:'));
  const cmp = await panel.locator('#sys-compare').innerText();
  check('compare shows the other tab', cmp.includes('127.0.0.1') && /Fonts/.test(cmp) && /Body text/.test(cmp), cmp.slice(0, 120).replace(/\n/g, ' '));

  // Make it free: a font with no file to read is measured on the page
  await panel.locator('.tabs button', { hasText: 'Page' }).click();
  await panel.waitForFunction(() => /Acme Mono/.test(document.querySelector('.freelist')?.textContent ?? ''), null, { timeout: 20000 }).catch(() => {});
  await panel.waitForFunction(() => { const r = [...document.querySelectorAll('.freerow')].find((x) => x.textContent.includes('Acme Mono')); return r && !/Measuring/.test(r.textContent); }, null, { timeout: 20000 }).catch(() => {});
  const acme = await panel.evaluate(() => [...document.querySelectorAll('.freerow')].find((x) => x.textContent.includes('Acme Mono'))?.textContent ?? 'missing');
  check('Make it free measures fonts it cannot download', /%/.test(acme) && !/Could not|Not measured/.test(acme), acme);
  check('Make it free shows the free licence of a close match', /Free · SIL Open Font License/.test(acme), acme);
  await panel.waitForFunction(() => [...document.querySelectorAll('.fcard')].some((c) => /Courier New|Liberation Mono/.test(c.textContent)), null, { timeout: 15000 }).catch(() => {});
  check('text added later in a new style is picked up', (await panel.locator('.fcard', { hasText: /Courier New|Liberation Mono/ }).count()) >= 1);
  await panel.bringToFront();
  await panel.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await panel.waitForTimeout(400);
  const scrollInfo = await panel.evaluate(() => ({ y: window.scrollY, h: document.documentElement.scrollHeight, vh: innerHeight }));
  check('back to top button appears after scrolling', (await panel.locator('.totop').count()) === 1, JSON.stringify(scrollInfo));
  await panel.locator('.totop').click();
  await panel.waitForTimeout(900);
  check('back to top scrolls up', await panel.evaluate(() => window.scrollY < 50));
  await page.bringToFront();

  // A font that loads later is picked up without clicking anything
  await panel.locator('.tabs button', { hasText: 'Page' }).click();
  await panel.waitForFunction(() => [...document.querySelectorAll('.fcard')].some((c) => c.textContent.includes('Lobster')), null, { timeout: 20000 }).catch(() => {});
  check('a font that loads later is added to the list by itself', (await panel.locator('.fcard', { hasText: 'Lobster' }).count()) === 1);

  // Going to another page in the same tab: read by itself (access to all sites is on in the test build)
  await page.goto(`http://127.0.0.1:${PORT}/page2.html`, { waitUntil: 'networkidle' });
  await panel.waitForFunction(() => document.body.innerText.includes('Second page') || [...document.querySelectorAll('.fcard')].length === 1, null, { timeout: 20000 }).catch(() => {});
  await panel.waitForTimeout(1500);
  const navCards = await panel.evaluate(() => [...document.querySelectorAll('.fcard .fname')].map((n) => n.firstChild?.textContent));
  check('a new page in the tab is read by itself', navCards.length === 1 && navCards[0] === 'Inter', JSON.stringify(navCards));
  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'networkidle' });

  // Phase 6: identify fonts from images
  const logs = [];
  panel.on('console', (m) => m.type() === 'error' && logs.push('panel: ' + m.text().slice(0, 200)));
  panel.on('pageerror', (e) => logs.push('panel error: ' + e.message.slice(0, 200)));
  page.on('console', (m) => m.type() === 'error' && logs.push('page: ' + m.text().slice(0, 200)));
  await page.bringToFront();
  await page.evaluate(() => window.scrollTo(0, 0));
  const shotPath = path.join(out, 'heading.png');
  await page.locator('h1').screenshot({ path: shotPath });
  await panel.bringToFront();
  await panel.locator('.tabs button', { hasText: 'Image' }).click();
  await panel.setInputFiles('input[aria-label="Upload an image"]', shotPath);
  await panel.waitForSelector('.editbox canvas', { timeout: 10000 });
  await panel.locator('button', { hasText: 'Read the text' }).click();
  await panel.waitForSelector('.ocrline', { timeout: 90000 }).catch(() => {});
  const ocrText = await panel.locator('.ocrline').first().innerText().catch(() => '');
  check('text recognition runs inside the extension', /slow|careful|Notes/i.test(ocrText), ocrText.replace(/\s+/g, ' ').slice(0, 60));
  check('letters are shown to check and correct', (await panel.locator('.tile').count()) >= 10);
  await panel.locator('button', { hasText: 'Find the closest fonts' }).click();
  await panel.waitForSelector('.match', { timeout: 60000 }).catch(() => {});
  const found = await panel.evaluate(() => [...document.querySelectorAll('.match b')].map((b) => b.textContent));
  check('the font in the image is among the closest matches', found.slice(0, 3).some((f) => /Fraunces/.test(f)), found.slice(0, 5).join(', '));
  await panel.waitForFunction(() => /Has every letter|Missing \d+/.test(document.querySelector('.match')?.textContent ?? ''), null, { timeout: 15000 }).catch(() => {});
  const first = await panel.locator('.match').first().innerText();
  check('matches show the free licence and letter coverage', /Free · SIL Open Font License/.test(first) && /Has every letter of your text/.test(first), first.replace(/\s+/g, ' ').slice(0, 160));
  check('the text read keeps its spaces', /Notes on slow/.test(await panel.locator('.match .mprev').first().innerText()));
  await panel.screenshot({ path: path.join(out, 'panel-identify.png'), fullPage: true });
  await panel.locator('button', { hasText: 'Use another image' }).click();
  await panel.waitForSelector('.histrow', { timeout: 5000 }).catch(() => {});
  check('the search is kept in history', (await panel.locator('.histrow').count()) >= 1);

  // Select an area on the page
  await panel.locator('button', { hasText: 'Select an area on the page' }).click();
  await page.bringToFront();
  const overlay = await page.waitForSelector('#ffp-select', { timeout: 5000 }).then(() => true).catch(() => false);
  console.log('  select overlay shown:', overlay);
  const hb = await page.locator('h1').boundingBox();
  await page.mouse.move(hb.x - 4, hb.y - 4);
  await page.mouse.down();
  await page.mouse.move(hb.x + hb.width * 0.6, hb.y + hb.height * 0.5, { steps: 5 });
  await page.mouse.up();
  // Keep the page in front: the screenshot is of the visible tab (in real use the side panel sits beside it).
  await panel.waitForSelector('.editbox canvas', { timeout: 10000 }).catch(() => {});
  await panel.bringToFront();
  await panel.waitForSelector('text=[Fonts in this area]', { timeout: 10000 }).catch(() => {});
  const exactText = await panel.locator('body').innerText();
  check('selecting real text lists its exact fonts', /Fonts in this area/i.test(exactText) && /Fraunces/.test(exactText) && /known exactly/.test(exactText));
  await panel.locator('button', { hasText: 'Match it as an image anyway' }).click();
  await panel.waitForSelector('.editbox canvas', { timeout: 10000 }).catch(() => {});
  const sel = await panel.evaluate(() => { const c = document.querySelector('.editbox canvas'); return c ? { w: c.width, h: c.height } : document.querySelector('.notice')?.textContent ?? 'no notice'; });
  check('selecting an area of the page captures it', !!sel && sel.w > 100 && sel.h > 20, JSON.stringify(sel));
  await panel.locator('button', { hasText: 'Use another image' }).click().catch(() => {});

  // Paste an image
  const pngB64 = fs.readFileSync(shotPath).toString('base64');
  await panel.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], 'pasted.png', { type: 'image/png' }));
    window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt }));
  }, pngB64);
  await panel.waitForSelector('.editbox canvas', { timeout: 10000 }).catch(() => {});
  check('pasting an image opens it', (await panel.locator('.editbox canvas').count()) === 1);
  await panel.locator('button', { hasText: 'Use another image' }).click();

  // Hover a picture: the card says it is a picture and can identify it, matching the page's own fonts too
  await page.bringToFront();
  await page.locator('#pic').scrollIntoViewIfNeeded();
  const pb = await page.locator('#pic').boundingBox();
  await page.mouse.click(pb.x + 200, pb.y + 40);
  await page.waitForTimeout(300);
  const picCard = await page.evaluate(() => { const sr = document.getElementById('ffp-root').shadowRoot; return { name: sr.querySelector('.name').textContent, note: !sr.querySelector('.picnote').hidden }; });
  check('hovering a picture says it is a picture, not text', picCard.name === 'Picture, not text' && picCard.note, JSON.stringify(picCard));
  await page.evaluate(() => document.getElementById('ffp-root').shadowRoot.querySelector('.identify').click());
  await panel.waitForSelector('.editbox canvas', { timeout: 15000 }).catch(() => {});
  check('Identify this picture opens it in the Image tab', (await panel.locator('.editbox canvas').count()) === 1);
  await panel.bringToFront();
  await panel.locator('button', { hasText: 'Read the text' }).click();
  await panel.waitForSelector('.ocrline', { timeout: 90000 }).catch(() => {});
  await panel.locator('button', { hasText: 'Find the closest fonts' }).click();
  await panel.waitForSelector('.match', { timeout: 60000 }).catch(() => {});
  const picMatches = await panel.evaluate(() => [...document.querySelectorAll('.match')].slice(0, 3).map((m) => m.querySelector('b').textContent + (/On this page/.test(m.textContent) ? ' (on page)' : '')));
  check('a picture in a font the page uses is matched to that font', picMatches.some((m) => /Demo.*on page/.test(m)), picMatches.join(', '));
  await panel.locator('button', { hasText: 'Use another image' }).click();

  // Right-click an image (the menu itself cannot be clicked in a test; it stores this request)
  const imgUrl = `http://127.0.0.1:${PORT}/heading.png`;
  fs.copyFileSync(shotPath, path.join(root, 'tests/fixtures/heading.png'));
  await sw.evaluate(async ([src, id]) => chrome.storage.session.set({ 'identify:pending': { srcUrl: src, tabId: id, pageUrl: 'http://127.0.0.1/', at: Date.now() } }), [imgUrl, tabId]);
  await panel.waitForSelector('.editbox canvas', { timeout: 10000 }).catch(() => {});
  check('right-click "Identify the font in this image" opens the image', (await panel.locator('.editbox canvas').count()) === 1);
  await panel.locator('button', { hasText: 'Use another image' }).click();

  // HEIC (iPhone) photo
  const heic = '/tmp/claude-0/-home-user-font-finder-plus/d778d12b-bf83-5531-b188-a6c1d99ab026/scratchpad/heic/example.heic';
  if (fs.existsSync(heic)) {
    await panel.setInputFiles('input[aria-label="Upload an image"]', heic);
    await panel.waitForSelector('.editbox canvas', { timeout: 30000 }).catch(() => {});
    const hc = await panel.evaluate(() => { const c = document.querySelector('.editbox canvas'); return c ? { w: c.width, h: c.height } : document.querySelector('.notice')?.textContent ?? 'no notice'; });
    check('HEIC photos open', !!hc && hc.w > 100, JSON.stringify(hc));
    await panel.locator('button', { hasText: 'Use another image' }).click().catch(() => {});
  }

  if (logs.length) console.log('  logs:\n   ' + logs.slice(0, 12).join('\n   '));
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

// Unit checks (no browser)
{
  const { build } = require('esbuild');
  const tmp = path.join(root, 'node_modules/.cache/ffp-css.mjs');
  await build({ entryPoints: [path.join(root, 'src/shared/css.ts')], outfile: tmp, format: 'esm', bundle: true, platform: 'node', logLevel: 'silent' });
  const { tidyStack } = await import(tmp);
  const long = ['anthropic-sans', 'system-ui', 'Segoe UI', 'Roboto', 'Helvetica', 'Arial', 'PingFang SC', 'Noto Sans Thai', 'sans-serif', 'ui-sans-serif'];
  check('Copy CSS keeps a short font stack', JSON.stringify(tidyStack(long, 'anthropic-sans')) === JSON.stringify(['anthropic-sans', 'sans-serif']), JSON.stringify(tidyStack(long, 'anthropic-sans')));
  const tmp2 = path.join(root, 'node_modules/.cache/ffp-lic.mjs');
  await build({ entryPoints: [path.join(root, 'src/shared/catalog.ts')], outfile: tmp2, format: 'esm', bundle: true, platform: 'node', logLevel: 'silent', loader: { '.json': 'json' } });
  const cat = await import(tmp2);
  check('ALL_CAPS CSS names are shown in normal case', cat.cleanFamilyName('MARTINA_PLANTIJN') === 'Martina Plantijn' && cat.cleanFamilyName('SOEHNE') === 'Soehne');
  check('Soehne spelling is recognised as a Klim font', cat.licenseFromCatalog('SOEHNE', 'self-hosted') === 'commercial');
  check('Copy CSS keeps fallbacks up to the font that renders', JSON.stringify(tidyStack(['Söhne', 'Helvetica', 'Arial', 'sans-serif'], 'Arial')) === JSON.stringify(['Söhne', 'Helvetica', 'Arial', 'sans-serif']));
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
