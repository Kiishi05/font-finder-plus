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

// Privacy audit: every request made by an extension page (panel, background).
const extRequests = [];
ctx.on('request', (r) => {
  let from = '';
  try { from = r.serviceWorker()?.url() ?? ''; } catch {}
  if (!from) try { from = r.frame()?.url() ?? ''; } catch {}
  if (from.startsWith('chrome-extension://')) extRequests.push(r.url());
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
  const sr = (js) => page.evaluate(js);
  check('dock is shown while inspecting', (await ui('.dock'))?.hidden === false && (await ui('.dock')).n >= 7);
  check('the side panel does not open by itself (dock has the panel button)', !!(await ui('.db[data-dock="panel"]')));
  check('pinned card shows one Pinned button and the actions', (await ui('.pin'))?.hidden === false && /Pinned/.test((await ui('.pin')).text) && (await ui('.foot'))?.hidden === false);
  await sr(() => document.getElementById('ffp-root').shadowRoot.querySelector('.row[data-key="size"]').click());
  await page.waitForTimeout(100);
  check('clicking a value copies it', /Copied/.test((await ui('.row[data-key="size"]'))?.text ?? ''));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  check('Esc unpins first and keeps inspecting', (await ui('.dock'))?.hidden === false && !(await sr(() => document.getElementById('ffp-root').shadowRoot.querySelector('.card').classList.contains('pinned'))));
  await page.mouse.move(h1.x + 44, h1.y + 22);
  await page.waitForTimeout(200);
  await page.keyboard.press('Space');
  await page.waitForTimeout(100);
  check('Space pins the card', await sr(() => document.getElementById('ffp-root').shadowRoot.querySelector('.card').classList.contains('pinned')));
  await page.keyboard.press('Space');
  await sr(() => document.getElementById('ffp-root').shadowRoot.querySelector('.db[data-dock="inspect"]').click());
  await page.waitForTimeout(100);
  check('Inspect in the dock pauses pointing', (await ui('.card'))?.hidden === true && (await sr(() => document.getElementById('ffp-root').shadowRoot.querySelector('.db[data-dock="inspect"]').getAttribute('aria-pressed'))) === 'false');
  await sr(() => document.getElementById('ffp-root').shadowRoot.querySelector('.db[data-dock="off"]').click());
  await page.waitForTimeout(100);
  check('Turn off in the dock stops inspecting', (await ui('.dock'))?.hidden === true);
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
  await panel.locator('.fcard', { hasText: 'Fraunces' }).locator('button[aria-label="Show Fraunces on the page"]').click();
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
  await panel.locator('.fcard', { hasText: 'Libre Caslon Condensed' }).locator('button[aria-label="Show Libre Caslon Condensed on the page"]').click();
  await page.waitForTimeout(300);
  const quote = await page.evaluate(() => {
    const sr = document.getElementById('ffp-root').shadowRoot;
    const ms = [...sr.querySelectorAll('.mark')].map((m) => m.getBoundingClientRect());
    const q = document.querySelector('blockquote').getBoundingClientRect();
    return { n: ms.length, covers: ms.length === 1 && ms[0].top <= q.top + 4 && ms[0].bottom >= q.bottom - 4 };
  });
  check('a paragraph in one font is outlined as one block', quote.covers, JSON.stringify(quote));
  check('button changes to Hide outlines', (await panel.locator('.fcard', { hasText: 'Libre Caslon Condensed' }).locator('button[aria-label="Hide outlines"][aria-pressed="true"]').count()) === 1);
  await panel.locator('.fcard', { hasText: 'Libre Caslon Condensed' }).locator('button[aria-label="Hide outlines"]').click();
  await page.waitForTimeout(200);
  check('second click removes the outlines', await page.evaluate(() => document.getElementById('ffp-root').shadowRoot.querySelectorAll('.mark').length === 0));
  check('button returns to Show on page', (await panel.locator('.fcard', { hasText: 'Libre Caslon Condensed' }).locator('button[aria-label="Show Libre Caslon Condensed on the page"][aria-pressed="false"]').count()) === 1);
  await panel.locator('.fcard', { hasText: 'Inter' }).first().locator('button[aria-label="Show Inter on the page"]').click();
  await page.waitForTimeout(300);
  const mixed = await page.evaluate(() => {
    const sr = document.getElementById('ffp-root').shadowRoot;
    const code = document.querySelector('code').getBoundingClientRect();
    const ms = [...sr.querySelectorAll('.mark')].map((m) => m.getBoundingClientRect());
    const coversCode = ms.some((m) => m.left <= code.left + 2 && m.right >= code.right - 2 && m.top <= code.top + 2 && m.bottom >= code.bottom - 2);
    return { n: ms.length, coversCode };
  });
  check('mixed paragraph: the code word in another font is not outlined', mixed.n >= 2 && !mixed.coversCode, JSON.stringify(mixed));
  await panel.locator('.fcard', { hasText: 'Inter' }).first().locator('button[aria-label="Hide outlines"]').click();
  await page.screenshot({ path: path.join(out, 'show-on-page.png') });
  // Language sample (a listbox: the button opens it, then pick an option)
  const pickSample = async (label) => {
    await panel.locator('.tester .ddbtn').first().click();
    await panel.locator('.ddlist li[role="option"]').filter({ hasText: new RegExp(`^${label.replace(/[()]/g, '\\$&')}$`) }).first().click();
  };
  check('the sample starts as the English pangram', /Sample text: English/.test(await panel.locator('.tester .ddbtn').first().getAttribute('aria-label')) && (await panel.locator('.fcard .specimen').first().innerText()).includes('The quick brown fox'));
  await pickSample('Yoruba');
  await panel.waitForTimeout(150);
  await pickSample('Arabic');
  await panel.waitForTimeout(400);
  const miss = await panel.locator('.missing').first().innerText().catch(() => '');
  check('missing letters are named in words, in quotes', /does not support Arabic\. \d+ letters are missing \(“/.test(miss), miss.slice(0, 90));
  await pickSample('Chinese (Simplified)');
  await panel.waitForTimeout(500);
  const missZh = await panel.locator('.missing').first().innerText().catch(() => '');
  check('missing Chinese is detected too', /does not support Chinese/.test(missZh), missZh.slice(0, 80));
  await pickSample('Yoruba');
  await panel.waitForTimeout(150);
  check('language sample shows Yoruba text', (await panel.locator('.fcard .specimen').first().innerText()).includes('káàárọ̀'));
  await panel.screenshot({ path: path.join(out, 'panel-page-yoruba.png'), fullPage: true });
  await pickSample('Font name');
  check('Font name sample shows each font in its own name', (await panel.locator('.fcard', { hasText: 'Fraunces' }).locator('.specimen').innerText()).trim() === 'Fraunces');
  const interCard = panel.locator('.fcard', { hasText: 'Inter' }).first();
  await interCard.locator('button[aria-label="Save Inter to your library"]').click();
  await panel.waitForTimeout(300);
  check('saving shows the collection picker', (await interCard.locator('.cardpicker').count()) === 1);
  await interCard.locator('button[aria-label^="Saved. Click to remove"]').click();
  await panel.waitForTimeout(300);
  check('clicking Saved unsaves the font', (await interCard.locator('button[aria-label="Save Inter to your library"][aria-pressed="false"]').count()) === 1 && (await interCard.locator('.cardpicker').count()) === 0);
  await panel.locator('.notloaded .nlhead').click();
  check('side panel shows not-loaded warning', (await panel.locator('.notloaded').count()) >= 1 && /Sohne Test/.test(await panel.locator('.notloaded .nllist').innerText().catch(() => '')));

  // Font detail for Fraunces
  await panel.locator('.fcard', { hasText: 'Fraunces' }).locator('button.go', { hasText: 'Details' }).click();
  await panel.waitForSelector('h1.nm');
  await panel.waitForFunction(() => /\d+ letters/.test(document.body.innerText) || document.body.innerText.includes('could not'), null, { timeout: 20000 }).catch(() => {});
  await panel.waitForTimeout(1500);
  await panel.screenshot({ path: path.join(out, 'panel-detail.png'), fullPage: true });
  const detailText = await panel.locator('body').innerText();
  check('detail shows designers from catalogue', detailText.includes('Undercase Type'));
  check('detail read the font file (format WOFF2)', detailText.includes('WOFF2'));
  check('detail shows variable axes', /opsz/i.test(detailText));
  await panel.waitForFunction(() => /of \d+ supported/i.test(document.body.innerText) && document.body.innerText.includes('full family on Google Fonts'), null, { timeout: 30000 }).catch(() => {});
  await panel.waitForSelector('.glyphs button', { timeout: 20000 }).catch(() => {});
  await panel.locator('#sec-letters .dmorelang').click().catch(() => {});
  await panel.screenshot({ path: path.join(out, 'panel-detail-phase2.png'), fullPage: true });
  const d2 = await panel.locator('body').innerText();
  check('licence card in plain language', d2.includes('SIL Open Font License') && d2.includes('Websites') && d2.includes('A summary, not legal advice.'));
  check('language coverage checked against Google Fonts', /\d+ of 35 supported/i.test(d2) && d2.includes('full family on Google Fonts'), (d2.match(/\d+ of 35 supported/i) || [''])[0]);
  check('Fraunces supports Vietnamese, not Arabic', await panel.evaluate(() => {
    const rows = [...document.querySelectorAll('.langhead')].map((r) => r.innerText.replace(/\s+/g, ' '));
    const none = [...document.querySelectorAll('.langhead')].find((r) => r.querySelector('.dnone'))?.innerText ?? '';
    return rows.some((r) => r.startsWith('Vietnamese') && r.includes('Supported')) && /Arabic/.test(none) && /Not included/.test(none);
  }));
  await panel.locator('.dglyphs button', { hasText: /^See all \d+ letters/ }).click();
  check('glyph grid shows the font\'s characters', (await panel.locator('.glyphs button').count()) > 100, String(await panel.locator('.glyphs button').count()));
  await panel.fill('input[aria-label="Find a character"]', 'é');
  await panel.waitForTimeout(100);
  check('glyph search finds a letter', (await panel.locator('.glyphs button').count()) === 1);
  await panel.locator('.glyphs button').first().click();
  check('glyph detail shows the code point', (await panel.locator('.glyphsel').innerText()).includes('U+00E9'));
  await panel.waitForFunction(() => /LATIN SMALL LETTER E WITH ACUTE/.test(document.querySelector('.glyphsel')?.textContent ?? ''), null, { timeout: 5000 }).catch(() => {});
  check('glyph detail shows the Unicode name', /LATIN SMALL LETTER E WITH ACUTE/.test(await panel.locator('.glyphsel').innerText()));
  // Pairs: try the partner on the page
  const pairBtn = panel.locator('.dpair button', { hasText: 'Try on page' }).first();
  check('pairs offer Try on page', (await pairBtn.count()) === 1);
  if (await pairBtn.count()) {
    await pairBtn.click();
    await page.waitForFunction(() => document.querySelector('main p')?.hasAttribute('data-ffp-swap'), null, { timeout: 20000 }).catch(() => {});
    check('a pair is shown on the page', await page.evaluate(() => !!document.querySelector('main p')?.hasAttribute('data-ffp-swap')));
    await panel.locator('.dpair button', { hasText: 'Showing on page' }).first().click();
    await page.waitForTimeout(300);
  }
  check('installed check answers', /Installed|Not installed/.test(d2));
  // Phase 3: similar fonts, live swap, pairs, playground
  await panel.waitForSelector('#sec-similar .match', { timeout: 15000 }).catch(() => {});
  await panel.locator('#sec-similar button', { hasText: /^Show all \d+/ }).click().catch(() => {});
  const sim = await panel.evaluate(() => [...document.querySelectorAll('#sec-similar .match b')].map((b) => b.textContent));
  check('similar free fonts listed', sim.length >= 5 && !sim.includes('Fraunces'), sim.slice(0, 5).join(', '));
  await panel.locator('#sec-similar .match button', { hasText: 'Try on page' }).first().click();
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
  check('hover card shows the swapped-in font', swapCard.startsWith(swapped.attr) && /showing instead of Fraunces/.test(swapCard), swapCard);
  await panel.bringToFront();
  check('a re-scan still reports the original font while swapped', rescan.scan.fonts.some((f) => f.family === 'Fraunces'));
  check('our stand-in font never shows up as a page font (also on text inside a swapped heading)', !rescan.scan.fonts.some((f) => /^FFP /i.test(f.family) || /FFP Swap/i.test(f.displayName)), rescan.scan.fonts.map((f) => f.family).join(', '));
  await panel.locator('#sec-similar .match button', { hasText: 'Showing on page' }).first().click();
  await page.waitForTimeout(300);
  check('Undo puts the original font back', await page.evaluate(() => !document.querySelector('h1').hasAttribute('data-ffp-swap') && !/FFP Swap/.test(getComputedStyle(document.querySelector('h1')).fontFamily)));
  check('pairs suggested', /Pair with a (heading|body) font/.test(await panel.locator('#sec-pairs h2').innerText()) && (await panel.locator('#sec-pairs .dpair').count()) >= 3);
  check('variable playground has sliders', (await panel.locator('.axis input[type=range]').count()) >= 2);
  await panel.screenshot({ path: path.join(out, 'panel-detail-phase3.png'), fullPage: true });
  check('detail links to Google Fonts', (await panel.locator('a[href="https://fonts.google.com/specimen/Fraunces"]').count()) >= 1);

  // Save to library and create a collection
  await panel.locator('.subtop button.dsave').click();
  await panel.waitForSelector('h2:text-is("In your library")');
  check('Save in the details turns to Saved', /Saved/.test(await panel.locator('.subtop button.dsave.on').innerText().catch(() => '')));
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
  await panel.locator('.dhead button', { hasText: 'Share' }).click();
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
  // The select arrow must sit inside the select box.
  const arrowInside = await panel.evaluate(() => { const ws = [...document.querySelectorAll('.selectwrap')]; return ws.length > 0 && ws.every((w) => {
    const a = w.getBoundingClientRect(); const i = w.querySelector('svg').getBoundingClientRect();
    return i.right <= a.right - 4 && i.left >= a.left;
  }); });
  check('dropdown arrows sit inside their boxes', arrowInside);
  await panel.locator('button[aria-label="Back"]').click();
  await panel.waitForSelector('h1.nm');

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
  await panel.locator('.lcard button[aria-label="Options for Fraunces"]').click();
  check('the card menu lists collections to tick', (await panel.locator('.lcard .cardmenu [role="menuitemcheckbox"][aria-checked="true"]', { hasText: 'Editorial' }).count()) === 1);
  await panel.locator('.lcard .cardmenu button', { hasText: 'New collection…' }).click();
  await panel.fill('input[aria-label="Collection name"]', 'Client B');
  await panel.locator('button', { hasText: 'Create collection' }).click();
  await panel.waitForTimeout(400);
  const inBoth = await panel.locator('.colrow').innerText();
  check('a font can be in two collections', /Editorial\s*1/.test(inBoth) && /Client B\s*1/.test(inBoth), inBoth.replace(/\n/g, ' '));
  await panel.screenshot({ path: path.join(out, 'panel-library-picker.png'), fullPage: true });
  // Add fonts from inside a collection
  await panel.locator('.colrow button', { hasText: 'Client B' }).click();
  await panel.locator('.colbar button', { hasText: 'Add fonts' }).click();
  check('Add fonts lists saved fonts', (await panel.locator('.section .chip.fpill', { hasText: 'Fraunces' }).count()) === 1);
  await panel.locator('.section .chip.fpill', { hasText: 'Fraunces' }).click();
  await panel.locator('button.wide', { hasText: 'Save changes' }).click();
  await panel.waitForTimeout(300);
  check('Add fonts can remove a font too', (await panel.locator('.grid2 .lcard').count()) === 0);
  await panel.locator('.colbar button', { hasText: 'Add fonts' }).click();
  await panel.locator('.section .chip.fpill', { hasText: 'Fraunces' }).click();
  await panel.locator('button.wide', { hasText: 'Save changes' }).click();
  await panel.waitForTimeout(300);
  await panel.locator('.colrow button', { hasText: /^All/ }).click();
  await panel.locator('.viewtoggle button[aria-label="Wide list"]').click();
  await panel.waitForSelector('.lrow');

  // Phase 5: boards
  await panel.locator('.libtile', { hasText: 'Boards' }).click();
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
  await panel.waitForSelector('.boardcard', { timeout: 5000 }).catch(() => {});
  check('board listed', (await panel.locator('.boardcard', { hasText: 'Editorial picks' }).count()) === 1);
  await panel.locator('button[aria-label="Back"]').click();
  await panel.waitForSelector('.libtile');

  // Phase 5: export and import
  await panel.locator('button[aria-label="More"]').click();
  const [edl] = await Promise.all([panel.waitForEvent('download'), panel.locator('.lmenu button', { hasText: 'Export library' }).click()]);
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
  check('import adds new fonts and collections without duplicates', libAfter.includes('Imported set') && libAfter.includes('Lora') && (libAfter.match(/Editorial\s*\d/g) || []).length === 1, (libAfter.match(/Imported set|Lora|Editorial\s*\d/g) || []).join(','));

  // Filters: classification Mono should hide Fraunces
  const fchip = (group, label) => panel.locator('.libfilters .fgroup', { hasText: group }).locator('.chip', { hasText: label });
  await panel.locator('button[aria-label="Filters"]').click();
  await fchip('Style', /^Mono$/).click();
  await panel.waitForTimeout(200);
  check('filter by classification works', (await panel.locator('.lrow').count()) === 0);
  await fchip('Style', /^All$/).click();
  await fchip('Where it comes from', /^On Google Fonts$/).click();
  await panel.waitForTimeout(200);
  check('filter "Available on Google Fonts" works', (await panel.locator('.lrow').count()) === 2);
  await fchip('Where it comes from', /^Any$/).click();
  await panel.locator('button[aria-label="Close filters"]').click();
  await panel.fill('#lib-search', 'undercase');
  await panel.waitForTimeout(200);
  check('search by designer works', (await panel.locator('.lrow').count()) === 1);
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
  await panel.locator('#sys-styles button.sysdisc', { hasText: /^Show \d+ more/ }).click().catch(() => {});
  const sysText = await panel.locator('body').innerText();
  const names = await panel.evaluate(() => [...document.querySelectorAll('#sys-styles .cr')].map((n) => n.dataset.style));
  check('type styles listed and named', names.includes('h1') && names.includes('body'), names.join(', '));
  // Clean scale: this site next to a tidy scale built from the body size.
  const scaleText = await panel.locator('#sys-styles').innerText();
  check('clean scale: explainer names the body size and the step', /tidy scale built from its body size \(\d+(\.\d)?px\)\. Each step is 1\.(2|25|333)× the one before/.test(scaleText), scaleText.slice(0, 160).replace(/\n/g, ' '));
  check('clean scale: ratio switch marks the closest, each value shows its difference', /How much bigger each step is/.test(scaleText) && /closest/.test(scaleText) && /(\+|−)\d+(\.5)?px|same/.test(scaleText) && /Style\s+This site\s+Clean scale/.test(scaleText));
  await panel.locator('#sys-styles .seg button', { hasText: '×1.333' }).click();
  check('switching the ratio redoes the scale', /Each step is 1\.333×/.test(await panel.locator('#sys-styles').innerText()));
  const farLook = await panel.evaluate(() => {
    const b = document.querySelector('#sys-styles .cs.far .cv b');
    if (!b) return 'none';
    const cs = getComputedStyle(b);
    return `${cs.fontWeight}|${cs.color}|${!!b.parentElement.querySelector('.fardot')}`;
  });
  check('sizes far from the scale get a dot and bold text, not amber', farLook === 'none' || (/^(6|7|8|9)00\|/.test(farLook) && farLook.endsWith('|true') && !/rgb\((227, 155, 18|138, 90, 0|240, 180, 76|242, 176, 74)\)/.test(farLook)), farLook);
  await panel.locator('#sys-styles button', { hasText: 'Try on page' }).click();
  await page.waitForTimeout(600);
  const tried = await page.evaluate(() => document.querySelectorAll('[data-ffp-type]').length);
  check('Try on page puts the clean scale on the page', tried > 0, `${tried} elements`);
  await panel.locator('#sys-styles button', { hasText: 'Put page back' }).click();
  await page.waitForTimeout(300);
  check('Put page back undoes the clean scale', await page.evaluate(() => document.querySelectorAll('[data-ffp-type]').length === 0 && getComputedStyle(document.querySelector('h1')).fontSize === '48px'));
  check('Use with my fonts is a white card button below the scale', await panel.evaluate(() => { const b = document.querySelector('button.mfentry'); return !!b && b.previousElementSibling?.id === 'sys-styles' && /Use with my fonts/.test(b.textContent) && /Pick a heading and body font\. Sizes and spacing are adjusted to fit them\./.test(b.textContent); }));
  // Ladder readability: a score, then check tiles with icons and measured values.
  check('readability flags low contrast', /Low contrast text/.test(sysText));
  const tiles = await panel.evaluate(() => [...document.querySelectorAll('#sys-health .tile:not(.sum)')].map((t) => `${t.querySelector('.st')?.getAttribute('aria-label')}|${t.querySelector('.v')?.textContent}|${t.querySelector('b')?.textContent}`));
  check('readability: 7 check tiles, each with a status icon and a measured value', tiles.length === 7 && tiles.every((t) => /^(Passes|Check|Fails)\|[^|]+\|/.test(t)) && tiles.some((t) => /^Fails\|\d+(\.\d)?:1\|Contrast$/.test(t)), tiles.join('; '));
  await panel.locator('#sys-health .tile', { hasText: 'Contrast' }).click();
  await panel.locator('#sys-health .tdet button', { hasText: 'Show on page' }).click();
  await page.waitForTimeout(300);
  check('readability Show on page outlines the text', await page.evaluate(() => document.getElementById('ffp-root').shadowRoot.querySelectorAll('.mark').length >= 1));
  await panel.locator('#sys-health .tile', { hasText: 'Body size' }).click();
  check('choosing a tile shows its detail', /Body text/.test(await panel.locator('#sys-health .tdet').innerText()));
  // Developer checks are folded.
  check('developer checks start folded', !(await panel.locator('#sys-dev .stat').count()));
  await panel.locator('#sys-dev button.fold').click();
  const filesStat = await panel.evaluate(() => [...document.querySelectorAll('#sys-dev .stat')].find((st) => st.querySelector('span')?.textContent === 'Files')?.querySelector('b')?.textContent ?? '');
  check('developer section counts font files', /^[1-9]\d*$/.test(filesStat), `Files ${filesStat}`);
  const exported = async () => panel.locator('#sys-export pre.code').innerText();
  const css = await exported();
  check('CSS export has variables and a Google Fonts import', css.includes('--font-heading') && css.includes('fonts.googleapis.com/css2?family=Fraunces') && css.includes('.text-h1'));
  const pickExport = async (label) => {
    await panel.locator('#sys-export .sysdd > button').click();
    await panel.locator('#sys-export li[role="option"]', { hasText: label }).click();
  };
  await pickExport('Tailwind v4');
  check('Tailwind v4 export uses @theme', (await exported()).includes('@theme {') && (await exported()).includes('--text-h1--line-height'));
  await pickExport('Tailwind v3');
  check('Tailwind v3 export is a config', (await exported()).includes('module.exports') && (await exported()).includes('fontSize'));
  await pickExport('Design tokens');
  let tokensOk = false;
  try { const t = JSON.parse(await exported()); tokensOk = t.typography?.h1?.$type === 'typography'; } catch { tokensOk = false; }
  check('design tokens export is valid JSON', tokensOk);
  await pickExport('Framer text styles');
  check('Framer export lists text styles with their tags', (await exported()).includes('Line height:') && (await exported()).includes('Tag: H1'));
  await pickExport('Webflow styles');
  const wf = await exported();
  check('Webflow export is a setup guide: fonts, variables, tag styles and classes', /Site settings > Fonts/.test(wf) && /Variables panel/.test(wf) && /All H1 Headings/.test(wf) && /Body \(All Pages\)/.test(wf), wf.slice(0, 160));
  check('one export dropdown with Copy and Download', (await panel.locator('#sys-export .sysdd').count()) === 1 && (await panel.locator('#sys-export button', { hasText: /^Copy$/ }).count()) === 1 && (await panel.locator('#sys-export button', { hasText: 'Download' }).count()) === 1);
  await pickExport('Figma (Font Finder Plus plugin)');
  check('Figma is in the same dropdown, with Copy for Figma', (await panel.locator('#sys-export button', { hasText: 'Copy for Figma' }).count()) === 1);
  await pickExport('CSS variables');
  // Phase 10: type system health check
  const health = await panel.locator('#sys-health').innerText();
  const score = Number(/(\d+)\s*\/100/.exec(health)?.[1] ?? -1);
  const parts = await panel.locator('#sys-parts').innerText();
  check('health check gives one score out of 100 with a grade', score >= 0 && score <= 100 && /\d+\/100 · (Excellent|Good|Fair|Needs work)/.test(parts), `${score} ${parts.slice(0, 80).replace(/\n/g, ' ')}`);
  check('health check scores families, sizes, weights, loading and readability', ['Font families', 'Sizes', 'Weights', 'Loading', 'Readability'].every((k) => parts.includes(k)));
  // One part opens at a time: read each one's findings.
  await panel.locator('#sys-parts button.part', { hasText: 'Readability' }).click();
  const healthRead = await panel.locator('#sys-parts').innerText();
  await panel.locator('#sys-parts button.part', { hasText: 'Font families' }).click();
  const healthOpen = healthRead + '\n' + (await panel.locator('#sys-parts').innerText());
  check('health findings say what to fix (low contrast, a font that never loads)', /Low contrast text/.test(healthOpen) && /never loads/.test(healthOpen) && score < 100, healthOpen.replace(/\s+/g, ' ').slice(0, 300));
  await panel.locator('#sys-compare button.fold').click();
  const cmp = await panel.locator('#sys-compare').innerText();
  // The other tab is on the same site, so it is named by its title.
  check('compare shows the other tab', /127\.0\.0\.1|Second page/.test(cmp) && /Fonts/.test(cmp) && /Body text/.test(cmp), cmp.slice(0, 120).replace(/\n/g, ' '));

  // Paste type from Figma: the plugin's format, applied to the page, with undo.
  await panel.locator('button#sys-figma-paste').click();
  await panel.waitForSelector('#sys-figma-paste input', { timeout: 5000 }).catch(() => {});
  const figType = '{"ffp":"figma-type","v":1,"name":"Northwind type","styles":[{"name":"Display","role":"h1","family":"Fraunces","weight":600,"size":64,"lineHeight":68,"letterSpacing":-0.02},{"name":"Body","role":"body","family":"Inter","weight":400,"size":18,"lineHeight":28,"letterSpacing":0},{"name":"Spare","role":"none","family":"Inter","weight":400,"size":12,"lineHeight":16,"letterSpacing":0}]}';
  if (await panel.locator('#sys-figma-paste input').count()) await panel.locator('#sys-figma-paste input').fill(figType);
  await panel.waitForSelector('#sys-figma-paste .landed', { timeout: 30000 }).catch(() => {});
  const landed = await panel.locator('#sys-figma-paste').innerText().catch(() => '');
  const h1Now = await page.evaluate(() => { const cs = getComputedStyle(document.querySelector('h1')); return `${cs.fontSize}|${cs.lineHeight}|${cs.fontWeight}|${cs.letterSpacing}`; });
  check('Paste type from Figma applies the styles to the page', h1Now.startsWith('64px|68px|600|') && /-1\.28px/.test(h1Now), h1Now);
  check('Paste type from Figma shows where each style landed', /Northwind type/.test(landed) && /Display/.test(landed) && /H1 · 1/.test(landed) && /Body text · \d+/.test(landed) && /Not applied/.test(landed), landed.replace(/\n/g, ' | ').slice(0, 200));
  await panel.locator('#sys-figma-paste button', { hasText: 'Put page back' }).click();
  await page.waitForTimeout(300);
  check('Paste type from Figma has an undo', await page.evaluate(() => getComputedStyle(document.querySelector('h1')).fontSize === '48px' && !document.querySelector('[data-ffp-type]')));

  // Use with my fonts: its own sub-page in three steps.
  await panel.locator('button.mfentry', { hasText: 'Use with my fonts' }).click();
  await panel.waitForSelector('#mf-pick', { timeout: 10000 });
  const top1 = await panel.locator('.mftop').innerText();
  check('Use with my fonts is a sub-page: back button and the step as its title', /Step 1 of 3\s*·\s*Pick your fonts/.test(top1) && (await panel.locator('.mftop .backbtn').count()) === 1 && !(await panel.locator('.topbar').count()), top1);
  check('the example font link is gone', !/Try with Instrument Serif/.test(await panel.locator('body').innerText()));
  await panel.locator('.slot', { hasText: 'Heading font' }).click();
  const search = panel.locator('.picker .search input');
  check('a slot opens a font search (44px field, no stroke)', await search.evaluate((i) => { const l = i.closest('.search'); const cs = getComputedStyle(l); return l.getBoundingClientRect().height === 44 && cs.borderTopWidth === '0px'; }).catch(() => false));
  await search.fill('Instrument Serif');
  await panel.locator('.fitem', { hasText: 'Instrument Serif' }).first().click();
  await panel.waitForSelector('.slotwrap .picker', { timeout: 5000 });
  check('after the heading font, the body font list opens by itself', /Body font/.test(await panel.locator('.slotwrap:has(.picker)').innerText()));
  await panel.locator('.picker .search input').fill('Work Sans');
  await panel.waitForFunction(() => [...document.querySelectorAll('.fitem .fn')].some((e) => /^Work Sans/.test(e.textContent) && /ffp-name/.test(e.style.fontFamily)), null, { timeout: 15000 }).catch(() => {});
  const ownFont = await panel.locator('.fitem', { hasText: /^Work Sans/ }).first().locator('.fn').evaluate((e) => e.style.fontFamily);
  check('results are set in their own font', /ffp-name/.test(ownFont), ownFont);
  await panel.locator('.fitem', { hasText: /^Work Sans/ }).first().click();
  await panel.locator('button', { hasText: 'See your styles' }).click();
  await panel.waitForSelector('#mf-styles .mfrow', { timeout: 15000 });
  await panel.waitForFunction(() => /Bigger|Smaller|Same x-height/.test(document.querySelector('#mf-styles')?.textContent ?? ''), null, { timeout: 20000 }).catch(() => {});
  const top2 = await panel.locator('.mftop').innerText();
  const stylesText = await panel.locator('#mf-styles').innerText();
  check('Step 2 of 3 · Your styles', /Step 2 of 3\s*·\s*Your styles/.test(top2), top2);
  check('each style shows from → to with a plain reason, from the fonts\' measurements', /→/.test(stylesText) && /(Bigger|Smaller): (Instrument Serif|Work Sans) has a (smaller|bigger) (x-height|cap height)/.test(stylesText), stylesText.slice(0, 300).replace(/\n/g, ' | '));
  check('heading and body fonts stay at the top with Change buttons', await panel.evaluate(() => { const c = document.querySelector('.mfchosen'); return !!c && /Instrument Serif/.test(c.textContent) && /Work Sans/.test(c.textContent) && c.querySelectorAll('button').length === 2; }));
  check('no big sample block: samples are capped at a modest size', await panel.evaluate(() => [...document.querySelectorAll('#mf-styles .smp')].every((s) => parseFloat(getComputedStyle(s).fontSize) <= 26)));
  await panel.locator('.mfrow[data-style="h1"] button', { hasText: 'Edit' }).click();
  await panel.locator('.mfrow[data-style="h1"] input').first().fill('60');
  await panel.waitForTimeout(200);
  const h1Row = await panel.locator('.mfrow[data-style="h1"]').innerText();
  check('values can be edited', /60px/.test(h1Row) && /You set this/.test(h1Row), h1Row.replace(/\n/g, ' | ').slice(0, 200));
  await panel.locator('#mf-onpage-label').locator('xpath=../..').locator('[role="switch"]').click();
  await page.waitForFunction(() => getComputedStyle(document.querySelector('h1')).fontSize === '60px', null, { timeout: 30000 }).catch(() => {});
  const h1Mine = await page.evaluate(() => { const cs = getComputedStyle(document.querySelector('h1')); return `${cs.fontSize}|${cs.fontFamily}`; });
  check('See it on this page changes the real website', /^60px\|"FFP Type \d+", "Instrument Serif"/.test(h1Mine), h1Mine);
  check('the page font really loads', await page.evaluate(() => [...document.fonts].some((f) => /^"?FFP Type/.test(f.family) && f.status === 'loaded')));
  await panel.screenshot({ path: path.join(out, 'panel-myfonts-styles.png'), fullPage: true });
  await panel.locator('[role="switch"][aria-labelledby="mf-onpage-label"]').click();
  await page.waitForTimeout(400);
  check('turning it off puts the page back', await page.evaluate(() => getComputedStyle(document.querySelector('h1')).fontSize === '48px' && !document.querySelector('[data-ffp-type]')));
  await panel.locator('button', { hasText: 'Export these styles' }).click();
  await panel.waitForSelector('#mf-export', { timeout: 5000 });
  const mine = async () => panel.locator('#mf-export pre.code').innerText();
  const mineCss = await mine();
  check('Step 3 of 3 · Export, as CSS', /Step 3 of 3\s*·\s*Export/.test(await panel.locator('.mftop').innerText()) && /--font-heading: "Instrument Serif", serif;/.test(mineCss) && /\.heading-1 \{/.test(mineCss) && /font-size: 60px;/.test(mineCss) && /fonts\.googleapis\.com\/css2\?family=Instrument\+Serif/.test(mineCss), mineCss.slice(0, 200));
  await panel.locator('#mf-export .seg button', { hasText: "The site's" }).click();
  check('style names can be the site\'s', /\n\.h1 \{/.test(await mine()));
  await panel.locator('#mf-export .seg button', { hasText: 'Tailwind' }).click();
  check('Tailwind export', /@theme \{/.test(await mine()) && /--text-h1: 60px;/.test(await mine()));
  await panel.locator('#mf-export .seg button', { hasText: 'Figma' }).click();
  check('Figma export reuses Copy for Figma', (await panel.locator('#mf-export button', { hasText: 'Copy for Figma' }).count()) === 1);
  await panel.screenshot({ path: path.join(out, 'panel-myfonts-export.png'), fullPage: true });
  for (let i = 0; i < 3; i++) await panel.locator('.mftop .backbtn').click();
  check('Back steps through and returns to the System tab', (await panel.locator('#sys-styles').count()) === 1);

  // Make it free: a font with no file to read is measured on the page
  await panel.locator('.tabs button', { hasText: 'Page' }).click();
  // A row's text, with its tooltips (the licence of the match is in one).
  const freeRow = (name) => panel.evaluate((n) => { const r = [...document.querySelectorAll('.mflist li')].find((x) => x.textContent.includes(n)); return r ? [r.textContent, ...[...r.querySelectorAll('[title]')].map((t) => t.title)].join(' | ') : 'missing'; }, name);
  await panel.waitForFunction(() => /Acme Mono/.test(document.querySelector('.mflist')?.textContent ?? ''), null, { timeout: 20000 }).catch(() => {});
  await panel.waitForFunction(() => { const r = [...document.querySelectorAll('.mflist li')].find((x) => x.textContent.includes('Acme Mono')); return r && !/Measuring/.test(r.textContent); }, null, { timeout: 20000 }).catch(() => {});
  const acme = await freeRow('Acme Mono');
  check('Make it free measures fonts it cannot download', /%/.test(acme) && !/Could not|Not measured/.test(acme), acme);
  await panel.waitForFunction(() => { const r = [...document.querySelectorAll('.mflist li')].find((x) => x.textContent.includes('Helvetica Neue LT Pro')); return r && !/Measuring/.test(r.textContent); }, null, { timeout: 20000 }).catch(() => {});
  const hn = await freeRow('Helvetica Neue LT Pro');
  check('Make it free swaps a Helvetica-shaped font for Arimo, by letter shapes', /Arimo/.test(hn), hn);
  check('Make it free shows the free licence of a close match', /Free on Google Fonts · SIL Open Font License/.test(acme), acme);

  // Send to Figma: copies fonts, licences, stand-ins, previews and styles.
  await panel.evaluate(() => { window.__copied = null; navigator.clipboard.writeText = async (t) => { window.__copied = t; }; });
  await panel.locator('.pstatus button', { hasText: 'Copy for Figma' }).click();
  await panel.waitForFunction(() => window.__copied, null, { timeout: 90000 }).catch(() => {});
  const figmaText = await panel.evaluate(() => window.__copied ?? '');
  fs.writeFileSync(path.join(out, 'figma-payload.txt'), figmaText);
  let fp = null;
  try { fp = JSON.parse(figmaText.slice(figmaText.indexOf('\n') + 1)); } catch {}
  const fhn = fp?.fonts?.find((f) => f.name === 'Helvetica Neue LT Pro');
  await panel.waitForFunction(() => [...document.querySelectorAll('.pstatus button')].some((b) => b.textContent === 'Copied'), null, { timeout: 5000 }).catch(() => {});
  check('Copy for Figma says Copied on the button', (await panel.locator('.pstatus button', { hasText: /^Copied$/ }).count()) === 1);
  check('Send to Figma copies the page for the plugin', figmaText.startsWith('FONT-FINDER-PLUS/FIGMA/1') && fp?.fonts?.length >= 4 && fp?.styles?.length >= 3, `${fp?.fonts?.length} fonts, ${fp?.styles?.length} styles, ${(figmaText.length / 1024).toFixed(0)} KB`);
  check('Figma payload has a stand-in, licence and vector preview for a paid font', fhn?.standIn?.family === 'Arimo' && /Monotype/.test(fhn?.getIt?.label ?? '') && fhn?.preview?.kind === 'svg' && fhn.preview.svg.includes('<path'), JSON.stringify({ s: fhn?.standIn, g: fhn?.getIt, p: fhn?.preview?.kind }));
  const figNames = (fp?.fonts ?? []).map((f) => f.name.toLowerCase());
  check('each font is listed once in the Figma payload', figNames.length === new Set(figNames).size, figNames.join(', '));
  const facme = fp?.fonts?.find((f) => f.name === 'Acme Mono');
  check('fonts without a readable file get a picture preview from the page', facme?.preview?.kind === 'png' && facme.preview.data.startsWith('data:image/png'), facme?.preview?.kind ?? 'none');
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
  // The text is read by itself once a picture opens. A picture with one style goes straight to its lines;
  // with several styles, "Pick one line instead" switches to them.
  const lineMode = async () => {
    await panel.waitForFunction(() => document.querySelector('.ocrline') || document.querySelector('#allfonts'), null, { timeout: 90000 }).catch(() => {});
    if (!(await panel.locator('.ocrline').count()) && (await panel.locator('button', { hasText: 'Pick one line instead' }).count())) await panel.locator('button', { hasText: 'Pick one line instead' }).click();
    await panel.waitForSelector('.ocrline', { timeout: 5000 }).catch(() => {});
  };
  await panel.setInputFiles('input[aria-label="Upload an image"]', shotPath);
  await panel.waitForSelector('.ipic canvas', { timeout: 10000 });
  await lineMode();
  const ocrText = await panel.locator('.ocrline').first().innerText().catch(() => '');
  check('text recognition runs inside the extension', /slow|careful|Notes/i.test(ocrText), ocrText.replace(/\s+/g, ' ').slice(0, 60));
  check('letters are shown to check and correct', (await panel.locator('.tile').count()) >= 10);
  await panel.locator('button', { hasText: 'Find the closest fonts' }).click();
  await panel.waitForSelector('.ires.match', { timeout: 60000 }).catch(() => {});
  const found = await panel.evaluate(() => [...document.querySelectorAll('.ires.match .nmrow b')].map((b) => b.textContent));
  check('the font in the image is among the closest matches', found.slice(0, 3).some((f) => /Fraunces/.test(f)), found.slice(0, 5).join(', '));
  await panel.waitForFunction(() => /Has every letter|Missing \d+/.test(document.querySelector('.match')?.textContent ?? ''), null, { timeout: 15000 }).catch(() => {});
  // The licence is the badge's tooltip.
  const first = await panel.locator('.match').first().evaluate((m) => [m.innerText, ...[...m.querySelectorAll('.lic[title]')].map((t) => t.title)].join(' | '));
  check('matches show the free licence and letter coverage', /Free · SIL Open Font License/.test(first) && /Has every letter of your text/.test(first), first.replace(/\s+/g, ' ').slice(0, 160));
  const liveBtn = panel.locator('.match button', { hasText: 'Try it live on the page' }).first();
  await liveBtn.click();
  await page.waitForFunction(() => !!document.querySelector('[data-ffp-swap]'), null, { timeout: 20000 }).catch(() => {});
  check('image matches can be tried live on the page', await page.evaluate(() => !!document.querySelector('[data-ffp-swap]')));
  await panel.locator('.match button', { hasText: 'Showing on page' }).first().click();
  await page.waitForTimeout(300);
  check('the text read keeps its spaces', /Notes on slow/.test(await panel.locator('.match .isample').first().innerText()));
  await panel.screenshot({ path: path.join(out, 'panel-identify.png'), fullPage: true });
  await panel.locator('button', { hasText: 'Use another' }).click();
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
  await panel.waitForSelector('.ipic canvas', { timeout: 10000 }).catch(() => {});
  await panel.bringToFront();
  await panel.waitForSelector('.iexact', { timeout: 10000 }).catch(() => {});
  const exactText = await panel.locator('body').innerText();
  check('selecting real text lists its exact fonts', /Fonts in this area/i.test(exactText) && /Fraunces/.test(exactText) && /read exactly from the page/.test(exactText), exactText.replace(/\s+/g, ' ').slice(0, 300));
  await panel.locator('button', { hasText: 'Match it as a picture' }).click();
  await panel.waitForSelector('.ipic canvas', { timeout: 10000 }).catch(() => {});
  await panel.waitForFunction(() => document.querySelector('.ocrline') || document.querySelector('#allfonts') || document.querySelector('.ireading'), null, { timeout: 10000 }).catch(() => {});
  const sel = await panel.evaluate(() => { const c = document.querySelector('.ipic canvas'); return c ? { w: c.width, h: c.height, reading: !!document.querySelector('.ocrline, #allfonts, .ireading') } : document.querySelector('.notice')?.textContent ?? 'no notice'; });
  check('selecting an area of the page captures it', !!sel && sel.w > 100 && sel.h > 20 && sel.reading, JSON.stringify(sel));
  await panel.locator('button', { hasText: 'Use another' }).click().catch(() => {});

  // Paste an image
  const pngB64 = fs.readFileSync(shotPath).toString('base64');
  await panel.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], 'pasted.png', { type: 'image/png' }));
    window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt }));
  }, pngB64);
  await panel.waitForSelector('.ipic canvas', { timeout: 10000 }).catch(() => {});
  check('pasting an image opens it', (await panel.locator('.ipic canvas').count()) === 1);
  await panel.locator('button', { hasText: 'Use another' }).click();

  // Hover a picture: the card says it is a picture and can identify it, matching the page's own fonts too
  await page.bringToFront();
  await page.locator('#pic').scrollIntoViewIfNeeded();
  const pb = await page.locator('#pic').boundingBox();
  await page.mouse.click(pb.x + 200, pb.y + 40);
  await page.waitForTimeout(300);
  const picCard = await page.evaluate(() => { const sr = document.getElementById('ffp-root').shadowRoot; return { name: sr.querySelector('.name').textContent, note: !sr.querySelector('.picnote').hidden }; });
  await page.waitForFunction(() => document.getElementById('ffp-root').shadowRoot.querySelector('.name').textContent !== 'Picture', null, { timeout: 5000 }).catch(() => {});
  const picCard2 = await page.evaluate(() => { const sr = document.getElementById('ffp-root').shadowRoot; return { name: sr.querySelector('.name').textContent, note: !sr.querySelector('.picnote').hidden, button: !sr.querySelector('.identify').hidden }; });
  check('hovering a picture with text offers to identify it', picCard2.name === 'Picture with text' && picCard2.note && picCard2.button, JSON.stringify(picCard2));
  void picCard;
  // A picture with no text, under an empty layer (as on X): no Identify button.
  await page.mouse.click(pb.x + 200, pb.y + 40);
  await page.locator('#plainpic').scrollIntoViewIfNeeded();
  const qb = await page.locator('#plainpic').boundingBox();
  await page.mouse.move(qb.x + 80, qb.y + 70);
  await page.waitForFunction(() => /no text|Picture with text/.test(document.getElementById('ffp-root').shadowRoot.querySelector('.name').textContent), null, { timeout: 5000 }).catch(() => {});
  const plain = await page.evaluate(() => { const sr = document.getElementById('ffp-root').shadowRoot; return { name: sr.querySelector('.name').textContent, button: !sr.querySelector('.identify').hidden }; });
  check('a picture with no text (under an empty layer) says so, with no Identify button', plain.name === 'Picture, no text' && !plain.button, JSON.stringify(plain));
  await page.locator('#pic').scrollIntoViewIfNeeded();
  const pb2 = await page.locator('#pic').boundingBox();
  await page.mouse.click(pb2.x + 200, pb2.y + 40);
  await page.waitForFunction(() => document.getElementById('ffp-root').shadowRoot.querySelector('.name').textContent === 'Picture with text', null, { timeout: 5000 }).catch(() => {});
  await page.evaluate(() => document.getElementById('ffp-root').shadowRoot.querySelector('.identify').click());
  await panel.waitForSelector('.ipic canvas', { timeout: 15000 }).catch(() => {});
  check('Identify this picture opens it in the Image tab', (await panel.locator('.ipic canvas').count()) === 1);
  await panel.bringToFront();
  await lineMode();
  await panel.locator('button', { hasText: 'Find the closest fonts' }).click();
  await panel.waitForSelector('.ires.match', { timeout: 60000 }).catch(() => {});
  const picMatches = await panel.evaluate(() => [...document.querySelectorAll('.ires.match')].slice(0, 3).map((m) => m.querySelector('.nmrow b').textContent + (/On this page/.test(m.textContent) ? ' (on page)' : '')));
  check('a picture in a font the page uses is matched to that font', picMatches.some((m) => /Demo.*on page/.test(m)), picMatches.join(', '));
  await panel.locator('button', { hasText: 'Use another' }).click();

  // Right-click an image (the menu itself cannot be clicked in a test; it stores this request)
  const imgUrl = `http://127.0.0.1:${PORT}/heading.png`;
  fs.copyFileSync(shotPath, path.join(root, 'tests/fixtures/heading.png'));
  await sw.evaluate(async ([src, id]) => chrome.storage.session.set({ 'identify:pending': { srcUrl: src, tabId: id, pageUrl: 'http://127.0.0.1/', at: Date.now() } }), [imgUrl, tabId]);
  await panel.waitForSelector('.ipic canvas', { timeout: 10000 }).catch(() => {});
  check('right-click "Identify the font in this image" opens the image', (await panel.locator('.ipic canvas').count()) === 1);
  await panel.locator('button', { hasText: 'Use another' }).click();

  // HEIC (iPhone) photo
  const heic = '/tmp/claude-0/-home-user-font-finder-plus/d778d12b-bf83-5531-b188-a6c1d99ab026/scratchpad/heic/example.heic';
  if (fs.existsSync(heic)) {
    await panel.setInputFiles('input[aria-label="Upload an image"]', heic);
    await panel.waitForSelector('.ipic canvas', { timeout: 30000 }).catch(() => {});
    const hc = await panel.evaluate(() => { const c = document.querySelector('.ipic canvas'); return c ? { w: c.width, h: c.height } : document.querySelector('.notice')?.textContent ?? 'no notice'; });
    check('HEIC photos open', !!hc && hc.w > 100, JSON.stringify(hc));
    await panel.locator('button', { hasText: 'Use another' }).click().catch(() => {});
  }

  if (logs.length) console.log('  logs:\n   ' + logs.slice(0, 12).join('\n   '));
  // Share card: fonts used on the site
  await panel.locator('.tabs button', { hasText: 'Page' }).click();
  await panel.waitForSelector('.fcard');
  await panel.locator('.pstatus button[aria-label="Share card"]').click();
  await panel.waitForSelector('canvas.cardcanvas', { timeout: 10000 });
  await panel.waitForTimeout(1500);
  const siteCard = await panel.evaluate(() => { const c = document.querySelector('canvas.cardcanvas'); return { w: c.width, h: c.height }; });
  check('"Fonts used on" share card is drawn', siteCard.w === 1200 && siteCard.h === 675, JSON.stringify(siteCard));
  await panel.screenshot({ path: path.join(out, 'panel-site-card.png'), fullPage: true });
  const [sdl] = await Promise.all([panel.waitForEvent('download'), panel.locator('button', { hasText: 'Download PNG' }).click()]);
  check('"Fonts used on" share card downloads', /^fonts-used-on-127-0-0-1-landscape\.png$/.test(sdl.suggestedFilename()), sdl.suggestedFilename());
  await panel.locator('button[aria-label="Back"]').click();

  // Dark theme screenshot
  await panel.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await panel.locator('.tabs button', { hasText: 'Page' }).click();
  await panel.waitForSelector('.fcard');
  await panel.waitForTimeout(1500);
  await panel.screenshot({ path: path.join(out, 'panel-page-dark.png'), fullPage: true });

  // Phase 8: every font in a social post, names read from it, save all, details
  const postPage = await ctx.newPage();
  await postPage.goto(`http://127.0.0.1:${PORT}/post.html`, { waitUntil: 'networkidle' });
  await postPage.evaluate(() => document.fonts.ready);
  const postPath = path.join(out, 'post.png');
  await postPage.locator('#post').screenshot({ path: postPath });
  await postPage.close();
  await panel.bringToFront();
  await panel.locator('.tabs button', { hasText: 'Image' }).click();
  if (await panel.locator('button', { hasText: 'Use another' }).count()) await panel.locator('button', { hasText: 'Use another' }).click();
  await panel.setInputFiles('input[aria-label="Upload an image"]', postPath);
  await panel.waitForSelector('.ipic canvas', { timeout: 10000 });
  await panel.waitForSelector('#allfonts', { timeout: 90000 }).catch(() => {});
  await panel.waitForFunction(() => document.querySelector('#allfonts') && !/Comparing letters|Matching…/.test(document.querySelector('#allfonts').textContent), null, { timeout: 90000 }).catch(() => {});
  const allText = await panel.locator('#allfonts').innerText().catch(() => '');
  check('a post with several fonts opens "Every font in the image"', (await panel.locator('#allfonts').count()) === 1 && (await panel.locator('.ocrline').count()) === 0 && (await panel.locator('#allfonts button', { hasText: 'Pick one line instead' }).count()) === 1);
  check('each text style is matched on its own', (await panel.locator('.blockcard').count()) >= 4, `${await panel.locator('.blockcard').count()} blocks`);
  check('font names written in the image are found', /Clash Display/.test(allText) && /Space Mono/.test(allText) && /Fraunces/.test(allText), allText.replace(/\s+/g, ' ').slice(0, 200));
  const monoCard = await panel.evaluate(() => [...document.querySelectorAll('.blockcard')].find((c) => c.querySelector('.nmrow b')?.textContent === 'Space Mono')?.textContent ?? '');
  check('a name written in its own font is confirmed two ways (name and letters)', /Name and letters match|the letters match Space Mono/.test(monoCard), monoCard.replace(/\s+/g, ' ').slice(0, 200));
  check('paid or other-catalogue names say where to get them', /Get it from Indian Type Foundry/.test(allText));
  const clashCard = await panel.evaluate(() => [...document.querySelectorAll('.blockcard')].find((c) => /Clash Display/.test(c.textContent))?.textContent ?? '');
  check('a block named as one font but looking like another is not called "Likely"', /The image names Clash Display/.test(clashCard) && !/Likely this font|Name and letters match/.test(clashCard), clashCard.replace(/\s+/g, ' ').slice(0, 160));
  const colsBefore = await panel.evaluate(async () => (await new Promise((r) => { const q = indexedDB.open('font-finder-plus'); q.onsuccess = () => { const t = q.result.transaction('collections').objectStore('collections').count(); t.onsuccess = () => r(t.result); }; q.onerror = () => r(-1); })));
  await panel.locator('#allfonts button', { hasText: 'Save all' }).click();
  await panel.waitForSelector('.toast', { timeout: 10000 }).catch(() => {});
  const saveToast = await panel.locator('.toast').innerText().catch(() => '');
  check('Save all saves every font found to a new collection', /Saved [3-9] fonts to a new collection/.test(saveToast), saveToast);
  void colsBefore;
  // Clash Display has a block of its own: its Details is on that card.
  await panel.locator('#allfonts button', { hasText: 'Details for Clash Display' }).first().click();
  await panel.waitForSelector('button[aria-label="Back"]', { timeout: 10000 });
  const namedDetail = await panel.locator('body').innerText();
  check('Details on a named font says who makes it and where to get it', /Get it from Indian Type Foundry \(Fontshare\)/.test(namedDetail) && /named in an image/.test(namedDetail), namedDetail.replace(/\s+/g, ' ').slice(0, 160));
  await panel.locator('button[aria-label="Back"]').click();
  await panel.waitForSelector('#allfonts', { timeout: 5000 }).catch(() => {});
  check('going back keeps the image results', (await panel.locator('#allfonts .blockcard').count()) >= 4);
  await panel.screenshot({ path: path.join(out, 'panel-image-allfonts.png'), fullPage: true });

  // A list of fonts, two columns, each name set in its own font (like a "fonts I use" post).
  const listPage = await ctx.newPage();
  await listPage.goto(`http://127.0.0.1:${PORT}/fontlist.html`, { waitUntil: 'networkidle' });
  await listPage.evaluate(() => document.fonts.ready);
  const listPath = path.join(out, 'fontlist.png');
  await listPage.locator('#list').screenshot({ path: listPath });
  await listPage.close();
  await panel.bringToFront();
  await panel.locator('.tabs button', { hasText: 'Image' }).click();
  if (await panel.locator('button', { hasText: 'Use another' }).count()) await panel.locator('button', { hasText: 'Use another' }).click();
  await panel.setInputFiles('input[aria-label="Upload an image"]', listPath);
  await panel.waitForSelector('.ipic canvas', { timeout: 10000 });
  await panel.waitForSelector('#allfonts', { timeout: 90000 }).catch(() => {});
  await panel.waitForFunction(() => document.querySelector('#allfonts') && !/Comparing letters|Matching…/.test(document.querySelector('#allfonts').textContent), null, { timeout: 120000 }).catch(() => {});
  // Each card is named by its heading (the name written in the picture, or the closest font), or says "The image names X".
  const listCards = await panel.evaluate(() => [...document.querySelectorAll('.blockcard')].map((c) => ({ name: c.querySelector('.nmrow b')?.textContent ?? '', text: c.textContent.replace(/\s+/g, ' ') })));
  const listNamed = (n) => listCards.filter((c) => c.name === n || c.text.includes(`The image names ${n},`)).map((c) => c.text);
  check('a list of fonts gets one sample per name, columns kept apart', ['Inter', 'Fraunces', 'Geist Mono', 'Space Mono', 'Lobster', 'Coolvetica'].every((n) => listNamed(n).length === 1), listCards.map((c) => c.text.slice(0, 70)).join(' || ').slice(0, 600));
  check('two names side by side on one line are split ("Instrument Serif" and "Tusker Grotesk")', listNamed('Instrument Serif').length === 1 && listNamed('Tusker Grotesk').length === 1 && !listCards.some((c) => /Instrument Serif Tusker/.test(c.text)));
  const listConfirmed = listCards.filter((c) => /Name and letters match|the letters match/.test(c.text)).length;
  check('free fonts named and set in themselves are confirmed by their letters', listConfirmed >= 3, `${listConfirmed} confirmed`);
  check('a name not in any list says it cannot be checked, with closest free fonts', listNamed('Tusker Grotesk').some((c) => /not in the font lists we check/.test(c)), listNamed('Tusker Grotesk')[0]?.slice(0, 200));
  await panel.screenshot({ path: path.join(out, 'panel-fontlist.png'), fullPage: true });

  // A font's details belong to the page they were opened from.
  await panel.locator('.tabs button', { hasText: 'Page' }).click();
  await panel.waitForSelector('.fcard', { timeout: 15000 }).catch(() => {});
  await panel.locator('.fcard').first().locator('button.go', { hasText: 'Details' }).click();
  await panel.waitForSelector('button[aria-label="Back"]', { timeout: 10000 }).catch(() => {});
  await page.goto(`http://127.0.0.1:${PORT}/page2.html`, { waitUntil: 'networkidle' });
  await panel.waitForFunction(() => !document.querySelector('button[aria-label="Back"]'), null, { timeout: 15000 }).catch(() => {});
  check("moving to another page closes the old page's font details", (await panel.locator('button[aria-label="Back"]').count()) === 0);
  // Moving to another website shows its Page view, from any view (here: Library).
  await panel.locator('.tabs button', { hasText: 'Library' }).click();
  await panel.waitForTimeout(500);
  await page.goto(`http://localhost:${PORT}/page2.html`, { waitUntil: 'networkidle' });
  const tabL = await sw.evaluate(async () => (await chrome.tabs.query({})).find((t) => t.url?.includes('localhost'))?.id);
  if (tabL != null) await sw.evaluate(async (id) => chrome.scripting.executeScript({ target: { tabId: id }, files: ['content.js'] }).catch(() => {}), tabL);
  await panel.waitForFunction(() => document.querySelector('.tabs button[aria-current="page"]')?.textContent === 'Page', null, { timeout: 15000 }).catch(() => {});
  check('moving to another website switches the panel to Page, from Library', (await panel.locator('.tabs button[aria-current="page"]').innerText().catch(() => '')) === 'Page');
  // A PDF says so, instead of listing 0 fonts.
  await page.goto(`http://127.0.0.1:${PORT}/pdf.html`, { waitUntil: 'load' });
  const tabP = await sw.evaluate(async () => (await chrome.tabs.query({})).find((t) => t.url?.includes('pdf.html'))?.id);
  if (tabP != null) await sw.evaluate(async (id) => chrome.scripting.executeScript({ target: { tabId: id }, files: ['content.js'] }).catch(() => {}), tabP);
  await panel.waitForFunction(() => /This is a PDF/.test(document.body.innerText), null, { timeout: 15000 }).catch(() => {});
  check('a PDF shows a clear message, not 0 fonts', /This is a PDF/.test(await panel.locator('body').innerText()));
  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'networkidle' });
  await panel.waitForSelector('.fcard', { timeout: 20000 }).catch(() => {});

  // Phase 9: Fonts I've seen (off by default, local, searchable, pause and delete per site).
  const seenCount = () => panel.evaluate(async () => (await new Promise((r) => { const q = indexedDB.open('font-finder-plus'); q.onsuccess = () => { try { const t = q.result.transaction('seen').objectStore('seen').count(); t.onsuccess = () => r(t.result); } catch { r(-1); } }; q.onerror = () => r(-1); })));
  // Wait for the saved fonts to load: the tiles move up when the empty state gives way to the list.
  const openSeen = async () => {
    await panel.locator('.tabs button', { hasText: 'Library' }).click();
    await panel.waitForSelector('#lib-search', { timeout: 10000 }).catch(() => {});
    await panel.locator('.libtile', { hasText: "Fonts I've seen" }).click();
  };
  await openSeen();
  await panel.waitForSelector('#seen-off', { timeout: 5000 }).catch(() => {});
  check("Fonts I've seen is off by default and records nothing", (await panel.locator('#seen-off').count()) === 1 && (await seenCount()) === 0, `count ${await seenCount()} · ${(await panel.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 200)}`);
  await panel.locator('#seen-off button', { hasText: 'Turn on' }).click();
  await page.goto(`http://127.0.0.1:${PORT}/page2.html`, { waitUntil: 'networkidle' });
  await panel.waitForSelector('.fcard', { timeout: 20000 }).catch(() => {});
  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'networkidle' });
  await panel.waitForSelector('.fcard', { timeout: 20000 }).catch(() => {});
  await panel.waitForTimeout(800);
  check('once on, the fonts of pages you read are recorded', (await seenCount()) >= 3, `count ${await seenCount()}`);
  await openSeen();
  await panel.waitForSelector('.seenrow', { timeout: 5000 }).catch(() => {});
  await panel.fill('#seen-search', 'serif');
  await panel.waitForTimeout(400);
  const serifs = await panel.locator('.seenrow').allInnerTexts();
  check('search "serif" finds the serif seen on the site, with where it was seen', serifs.some((t) => /Fraunces/.test(t) && /127\.0\.0\.1/.test(t)) && !serifs.some((t) => /^Inter\b/.test(t)), serifs.map((t) => t.split('\n')[0]).join(', '));
  await panel.fill('#seen-search', 'mono');
  await panel.waitForTimeout(400);
  // The style (Mono) is in the name's tooltip.
  const monos = await panel.locator('.seenrow').evaluateAll((rows) => rows.map((r) => `${r.innerText}\n${r.querySelector('.namebtn')?.title ?? ''}`));
  check('search "mono" finds the code fonts', monos.length >= 1 && monos.every((t) => /Mono|Monospace/i.test(t)), monos.map((t) => t.split('\n')[0]).join(', '));
  await panel.fill('#seen-search', '');
  await panel.locator('button[aria-label="Pause recording on 127.0.0.1"]').click();
  await panel.waitForTimeout(300);
  check('pausing on a site is remembered', /Paused on 127\.0\.0\.1/.test(await panel.locator('body').innerText()) && (await sw.evaluate(async () => (await chrome.storage.local.get('seenPaused')).seenPaused)).includes('127.0.0.1'));
  await panel.locator('button[aria-label="Delete 127.0.0.1 from the history"]').click();
  await panel.waitForTimeout(400);
  check('deleting a site removes its fonts from the history', (await seenCount()) === (await panel.evaluate(async () => 0)) || !(await panel.locator('.seenrow', { hasText: '127.0.0.1' }).count()));
  await panel.locator('button[aria-label="Resume recording on 127.0.0.1"]').click().catch(() => {});
  await panel.locator('button[aria-label="Back"]').click();
  await panel.locator('.tabs button', { hasText: 'Page' }).click();
  await panel.waitForSelector('.fcard', { timeout: 20000 }).catch(() => {});

  // Unit checks for the Use with my fonts maths and the Figma type format.
  try {
    execSync('node tests/typeadapt.mjs', { cwd: root, stdio: 'pipe' });
    check('typeadapt unit checks pass', true);
  } catch (e) {
    check('typeadapt unit checks pass', false, String(e.stdout ?? e).split('\n').filter((l) => l.startsWith('FAIL')).join('; '));
  }

  // Accessibility audit with axe-core, light and dark, on each main view.
  const axeSrc = await fs.promises.readFile(require.resolve('axe-core/axe.min.js'), 'utf8');
  const a11y = [];
  for (const theme of ['light', 'dark']) {
    await panel.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
    for (const tab of ['Page', 'Image', 'System', 'Library']) {
      await panel.locator('.tabs button', { hasText: tab }).click();
      await panel.waitForTimeout(1200);
      if (!(await panel.evaluate(() => !!window.axe))) await panel.evaluate(axeSrc);
      const v = await panel.evaluate(async () => (await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] })).violations.map((x) => ({ id: x.id, impact: x.impact, n: x.nodes.length, html: x.nodes.slice(0, 3).map((n) => n.html.slice(0, 140)) })));
      for (const x of v) a11y.push({ theme, tab, ...x });
    }
    await panel.locator('button[aria-label="Settings"]').click();
    await panel.waitForTimeout(600);
    const sv = await panel.evaluate(async () => (await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] })).violations.map((x) => ({ id: x.id, impact: x.impact, n: x.nodes.length, html: x.nodes.slice(0, 3).map((n) => n.html.slice(0, 140)) })));
    for (const x of sv) a11y.push({ theme, tab: 'Settings', ...x });
    await panel.locator('button[aria-label="Back"]').click();
  }
  await fs.promises.writeFile(path.join(out, 'a11y.json'), JSON.stringify(a11y, null, 2));
  check('accessibility: no WCAG A/AA violations in the panel', a11y.length === 0, a11y.map((x) => `${x.theme}/${x.tab}:${x.id}(${x.n})`).join(', '));

  const allowed = /^(chrome-extension:|data:|blob:|https:\/\/fonts\.googleapis\.com\/|https:\/\/fonts\.gstatic\.com\/|https:\/\/www\.googleapis\.com\/webfonts\/|https:\/\/api\.fontshare\.com\/|https:\/\/cdn\.fontshare\.com\/|http:\/\/127\.0\.0\.1:)/;
  const odd = [...new Set(extRequests.filter((u) => !allowed.test(u)))];
  await fs.promises.writeFile(path.join(out, 'requests.json'), JSON.stringify([...new Set(extRequests.map((u) => u.slice(0, 120)))], null, 2));
  // Delete all my data (Settings > Privacy).
  await panel.locator('button[aria-label="Settings"]').click();
  await panel.locator('button', { hasText: 'Delete all my data' }).click();
  await panel.locator('button', { hasText: 'Delete everything' }).click();
  await panel.waitForTimeout(500);
  const left = await panel.evaluate(async () => {
    const dbs = await indexedDB.databases();
    const name = dbs.map((d) => d.name).find((n) => /ffp|font/i.test(n ?? ''));
    return new Promise((res) => {
      const req = indexedDB.open(name);
      req.onsuccess = async () => {
        const idb = req.result;
        const counts = await Promise.all([...idb.objectStoreNames].map((s) => new Promise((r) => { const c = idb.transaction(s).objectStore(s).count(); c.onsuccess = () => r(c.result); })));
        res(counts.reduce((a, b) => a + b, 0));
      };
    });
  });
  check('Delete all my data empties the library', left === 0, `rows left: ${left}`);

  check('privacy: the extension only talks to Google Fonts, Fontshare and the page\'s own font files', odd.length === 0, odd.slice(0, 5).join(' '));
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
  check('Google Fonts preview names are cleaned (gf_Poppins variant0)', cat.cleanFamilyName('gf_Poppins variant0') === 'Poppins' && cat.cleanFamilyName('gf_Great_Vibes variant0') === 'Great Vibes', cat.cleanFamilyName('gf_Great_Vibes variant0'));
  check('joined-up names are split (HelveticaNeueLTPro)', cat.cleanFamilyName('HelveticaNeueLTPro') === 'Helvetica Neue LT Pro' && cat.cleanFamilyName('JetBrainsMono') === 'JetBrains Mono' && cat.cleanFamilyName('McLaren') === 'McLaren' && cat.cleanFamilyName('SFProText') === 'SF Pro Text', [cat.cleanFamilyName('HelveticaNeueLTPro'), cat.cleanFamilyName('SFProText')].join(', '));
  const { runBench } = await import('./lookalike-bench.mjs');
  for (const canvas of [false, true]) {
    const b = await runBench({ quiet: true, canvas });
    check(`look-alike accuracy (${canvas ? 'as the page draws it' : 'from font files'}): right family first in 80%+, top 3 in 90%+`, b.top1 / b.n >= 0.8 && b.top3 / b.n >= 0.9, `top 1 ${b.top1}/${b.n}, top 3 ${b.top3}/${b.n}`);
  }
  const tmp3 = path.join(root, 'node_modules/.cache/ffp-access.mjs');
  await build({ entryPoints: [path.join(root, 'src/shared/pageaccess.ts')], outfile: tmp3, format: 'esm', bundle: true, platform: 'node', logLevel: 'silent' });
  const acc = await import(tmp3);
  check('a local file explains how to allow file access', /Allow access to file URLs/.test(acc.explainInjectError('Cannot access contents of url "file:///Users/me/site.html"', undefined, false)));
  check("Chrome's own pages, the Web Store and PDFs get clear reasons", /Chrome's own pages/.test(acc.explainInjectError('Cannot access a chrome:// URL', 'chrome://newtab/', false)) && /Web Store/.test(acc.explainInjectError('The extensions gallery cannot be scripted.', 'https://chromewebstore.google.com/detail/x', false)) && /PDF/.test(acc.explainInjectError('Cannot access contents of url "https://a.com/doc.pdf"', undefined, false)));
  check('Google Docs and Figma are recognised as drawing text as pictures', !!acc.drawsTextAsPictures('https://docs.google.com/document/d/abc/edit') && !!acc.drawsTextAsPictures('https://www.figma.com/design/abc/x') && !acc.drawsTextAsPictures('https://stripe.com'));
  // Junk lines from text recognition, crosswalk stripes, and names in the post around a picture.
  const tmp5 = path.join(root, 'node_modules/.cache/ffp-ocrclean.mjs');
  await build({ stdin: { contents: "export * from './src/sidepanel/lib/ocrclean.ts'; export * from './src/shared/textdetect.ts'; export { namesFromContext } from './src/sidepanel/lib/fontnames.ts'; export { adobeFontsUrl } from './src/shared/catalog.ts';", resolveDir: root, loader: 'ts' }, outfile: tmp5, format: 'esm', bundle: true, platform: 'node', logLevel: 'silent', loader: { '.json': 'json' } });
  const oc = await import(tmp5);
  check('Adobe Fonts links use its own search (no guessed page addresses)', oc.adobeFontsUrl('Freight Text Pro') === 'https://fonts.adobe.com/search?query=Freight%20Text');
  const OL = (text, confidence) => ({ text, confidence, bbox: { x0: 0, y0: 0, x1: 1, y1: 1 }, baseline: null, symbols: [] });
  const kept = oc.realLines([OL('CEgl es — — Es', 52), OL('®) © a', 61), OL('Lil Grotesk', 74), OL('Payments infrastructure for the internet', 91), OL('ee EE', 40), OL('Lauch Type', 66)]).map((l) => l.text);
  check('text recognition junk is dropped, real lines are kept', kept.join('|') === 'Lil Grotesk|Payments infrastructure for the internet|Lauch Type', kept.join('|'));
  const draw = (w, h, paint) => { const data = new Uint8ClampedArray(w * h * 4).fill(255); const set = (x, y, v) => { const i = (y * w + x) * 4; data[i] = data[i + 1] = data[i + 2] = v; }; for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) set(x, y, paint(x, y)); return { width: w, height: h, data }; };
  const stripes = draw(320, 140, (x, y) => { if (y < 40 || y > 110) return 90; const shift = (110 - y) * 0.2; for (let i = 0; i < 7; i++) { const x0 = 30 + i * 38 + shift; if (x >= x0 && x < x0 + 18) return 238; } return 90; });
  check('a row of identical stripes (a crosswalk) is not taken for text', oc.hasText(stripes) === false);
  const postN = oc.namesFromContext(['Two fresh grotesks this week', 'noirblancrouge.com/fonts/lil-grot… — Lil Grotesk', 'usemodify.com/fonts/lunchtyp… — Lunchtype', '12 replies']);
  check('font names in the post around a picture are found (Lil Grotesk not confirmed, Lunchtype confirmed)', postN.some((n) => n.name === 'Lil Grotesk' && n.kind === 'unknown') && postN.some((n) => n.name === 'Lunchtype' && n.kind !== 'unknown'), JSON.stringify(postN.map((n) => [n.name, n.kind])));
  check('an ordinary post names no fonts', oc.namesFromContext(['Just landed in Lisbon', 'Great coffee and a long walk by the river today']).length === 0);
  const tmp4 = path.join(root, 'node_modules/.cache/ffp-names.mjs');
  await build({ stdin: { contents: "export * from './src/sidepanel/lib/fontnames.ts'; export * from './src/shared/freecatalog.ts'; export * from './src/shared/licences.ts';", resolveDir: root, loader: 'ts' }, outfile: tmp4, format: 'esm', bundle: true, platform: 'node', logLevel: 'silent', loader: { '.json': 'json' } });
  const nm = await import(tmp4);
  const L = (t) => ({ text: t, confidence: 90, bbox: { x0: 0, y0: 0, x1: 300, y1: 20 }, baseline: null, symbols: [] });
  check('free catalogues: Amiamie is confirmed (Bye Bye Binary), Satoshi is Fontshare', nm.freeFont('Amiamie')?.s === 'byebyebinary' && nm.knownFont('Satoshi')?.licence === 'fontshare' && nm.fontshareFamily('Satoshi')?.slug === 'satoshi');
  const post = nm.findFontNames([L('Amiamie'), L('Amiamie is an Helvetica-inspired typeface')]).map((n) => n.name);
  check('a name in a post about type is confirmed from the free catalogues', post.includes('Amiamie'), post.join(', '));
  const recipe = nm.findFontNames([L('Delicious'), L('Bake for 20 minutes')]).map((n) => n.name);
  check('everyday words from the free lists are not taken as fonts outside posts about type', !recipe.length, recipe.join(', '));
  check('names ending in VF are grouped under the family', cat.familyGroupName(cat.cleanFamilyName('die-grotesk-vf')) === 'Die Grotesk', cat.familyGroupName(cat.cleanFamilyName('die-grotesk-vf')));
  check('Soehne spelling is recognised as a Klim font', cat.licenseFromCatalog('SOEHNE', 'self-hosted') === 'commercial');
  check('Copy CSS keeps fallbacks up to the font that renders', JSON.stringify(tidyStack(['Söhne', 'Helvetica', 'Arial', 'sans-serif'], 'Arial')) === JSON.stringify(['Söhne', 'Helvetica', 'Arial', 'sans-serif']));
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
