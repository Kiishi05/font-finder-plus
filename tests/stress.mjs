// Worst-case audit (dev only, never shipped). Opens every view of the side
// panel with demo data and with realistic worst cases, at the panel's normal
// width, 320px, 200% zoom and in dark mode, and saves screenshots plus simple
// numbers (words, buttons, page length, how far down the first answer is).
//
// States, chosen by the page the panel reads (the extension's data boundary):
//   demo   tests/fixtures/index.html          the usual test page
//   worst  tests/fixtures/stress/worst.html   22 fonts (8 never load), long and build-tool names,
//                                              RTL, CJK, Vietnamese, 25 sizes, 200 hidden menu items
//   empty  tests/fixtures/stress/empty.html   a page with only a picture
//   one    tests/fixtures/stress/one.html     one font, one letter
// Image tab: post.png (demo) and stress/fontlist.html (20 names in two columns).
// Library and Fonts I've seen: seeded with 60 fonts, 24 long collection names, 300 sightings.
//
//   npm run build:test && node tests/stress.mjs        writes tests/output/stress/
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
const out = path.join(root, 'tests/output/stress');
fs.mkdirSync(out, { recursive: true });
const PORT = 8771;
const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: path.join(root, 'tests/fixtures'), stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));
const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
const ctx = await chromium.launchPersistentContext(await mkdtemp(path.join(tmpdir(), 'ffp-stress-')), {
  channel: 'chromium', headless: true, viewport: { width: 1280, height: 900 },
  proxy: proxy ? { server: proxy, bypass: '127.0.0.1,localhost' } : undefined,
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent('serviceworker');
const extId = new URL(sw.url()).host;
const metrics = [];

const ENVS = {
  light: { width: 400, theme: 'light' },
  dark: { width: 400, theme: 'dark' },
  narrow: { width: 320, theme: 'light' },
  zoom200: { width: 200, theme: 'light' }, // a 400px panel at 200% zoom
};

async function measure(panel, name) {
  const m = await panel.evaluate(() => {
    const text = document.body.innerText;
    const first = document.querySelector('.fcard, .blockcard, .lcard, .lrow, .seenrow, #sys-health');
    const overflowX = document.documentElement.scrollWidth > document.documentElement.clientWidth + 1;
    const clipped = [...document.querySelectorAll('button, a, .label, .fname, .name, b')].filter((e) => e.scrollWidth > e.clientWidth + 2 && getComputedStyle(e).overflow === 'hidden' && getComputedStyle(e).textOverflow !== 'ellipsis').length;
    const sizes = new Set([...document.querySelectorAll('body *')].filter((e) => e.childNodes.length && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())).map((e) => getComputedStyle(e).fontSize));
    const weights = new Set([...document.querySelectorAll('body *')].filter((e) => [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())).map((e) => getComputedStyle(e).fontWeight));
    return {
      words: text.split(/\s+/).filter(Boolean).length,
      buttons: document.querySelectorAll('button, a.btn, select, input[type=checkbox], input[type=range]').length,
      sections: document.querySelectorAll('.section, .fcard, .notice, .card, .blockcard').length,
      notices: document.querySelectorAll('.notice').length,
      height: document.documentElement.scrollHeight,
      firstAnswerY: first ? Math.round(first.getBoundingClientRect().top + scrollY) : null,
      overflowX,
      clipped,
      textSizes: sizes.size,
      weights: [...weights].sort().join(','),
    };
  });
  metrics.push({ name, ...m });
  return m;
}

async function shoot(panel, name) {
  await panel.waitForTimeout(400);
  await measure(panel, name);
  await panel.screenshot({ path: path.join(out, `${name}.png`), fullPage: true });
  console.log('shot', name);
}

async function openTab(url) {
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'networkidle' }).catch(() => {});
  await page.evaluate(() => document.fonts.ready).catch(() => {});
  const tabId = await sw.evaluate(async (u) => (await chrome.tabs.query({})).find((t) => t.url === u)?.id, url);
  await sw.evaluate(async (id) => { await chrome.scripting.executeScript({ target: { tabId: id }, files: ['content.js'] }); }, tabId);
  return { page, tabId };
}

async function panelFor(tabId, env) {
  const panel = await ctx.newPage();
  await panel.setViewportSize({ width: env.width, height: 860 });
  await panel.goto(`chrome-extension://${extId}/sidepanel.html?tab=${tabId}`);
  await panel.evaluate((t) => document.documentElement.setAttribute('data-theme', t), env.theme);
  return panel;
}

const tab = (panel, name) => panel.locator('.tabs button', { hasText: name }).click().catch(() => {});

const STATES = {
  demo: `http://127.0.0.1:${PORT}/index.html`,
  worst: `http://127.0.0.1:${PORT}/stress/worst.html`,
  empty: `http://127.0.0.1:${PORT}/stress/empty.html`,
  one: `http://127.0.0.1:${PORT}/stress/one.html`,
};

try {
  for (const [state, url] of Object.entries(STATES)) {
    const { page, tabId } = await openTab(url);
    const envs = state === 'demo' || state === 'worst' ? Object.keys(ENVS) : ['light'];
    for (const envName of envs) {
      const env = ENVS[envName];
      const panel = await panelFor(tabId, env);
      await panel.waitForSelector('.fcard, .empty, .notice', { timeout: 30000 }).catch(() => {});
      await panel.waitForTimeout(2500);
      await shoot(panel, `${state}-page-${envName}`);
      if (state === 'demo' || state === 'worst') {
        // Details of the first font card
        const det = panel.locator('.fcard').first().locator('button', { hasText: 'Details' });
        if (await det.count()) {
          await det.click();
          await panel.waitForTimeout(3500);
          await shoot(panel, `${state}-details-${envName}`);
          await panel.locator('button[aria-label="Back"]').click().catch(() => {});
        }
        await tab(panel, 'System');
        await panel.waitForSelector('#sys-health, #sys-styles', { timeout: 20000 }).catch(() => {});
        await shoot(panel, `${state}-system-${envName}`);
        // System with the folded cards open
        await panel.locator('#sys-dev button.fold').click().catch(() => {});
        await panel.locator('#sys-compare button.fold').click().catch(() => {});
        await shoot(panel, `${state}-system-open-${envName}`);
        // Use with my fonts: the three steps
        if (envName === 'light' || envName === 'dark' || envName === 'narrow') {
          await panel.locator('button.mfentry', { hasText: 'Use with my fonts' }).click().catch(() => {});
          await panel.waitForSelector('#mf-pick', { timeout: 10000 }).catch(() => {});
          await shoot(panel, `${state}-myfonts-1-${envName}`);
          await panel.locator('.slot', { hasText: 'Heading font' }).click().catch(() => {});
          await panel.waitForTimeout(1500);
          await shoot(panel, `${state}-myfonts-1-search-${envName}`);
          await panel.locator('.picker .search input').fill('Instrument Serif').catch(() => {});
          await panel.locator('.fitem', { hasText: 'Instrument Serif' }).first().click().catch(() => {});
          await panel.locator('.picker .search input').fill('Work Sans').catch(() => {});
          await panel.waitForTimeout(800);
          await panel.locator('.fitem', { hasText: /^Work Sans/ }).first().click().catch(() => {});
          await panel.locator('button', { hasText: 'See your styles' }).click().catch(() => {});
          await panel.waitForSelector('#mf-styles .mfrow', { timeout: 15000 }).catch(() => {});
          await panel.waitForTimeout(2500);
          await panel.locator('#mf-styles .mfrow button', { hasText: 'Edit' }).first().click().catch(() => {});
          await shoot(panel, `${state}-myfonts-2-${envName}`);
          await panel.locator('button', { hasText: 'Export these styles' }).click().catch(() => {});
          await shoot(panel, `${state}-myfonts-3-${envName}`);
          for (let i = 0; i < 3; i++) await panel.locator('.mftop .backbtn').click().catch(() => {});
        }
        await tab(panel, 'Page');
      }
      await panel.close();
    }
    await page.close();
  }

  // Image tab: a social post and a 20-name font list (light and dark)
  const lp = await ctx.newPage();
  await lp.goto(`http://127.0.0.1:${PORT}/stress/fontlist.html`, { waitUntil: 'networkidle' });
  await lp.evaluate(() => document.fonts.ready);
  const listPng = path.join(out, '_fontlist-input.png');
  await lp.locator('#list').screenshot({ path: listPng });
  await lp.goto(`http://127.0.0.1:${PORT}/post.html`, { waitUntil: 'networkidle' });
  await lp.evaluate(() => document.fonts.ready);
  const postPng = path.join(out, '_post-input.png');
  await lp.locator('#post').screenshot({ path: postPng });
  const { tabId: t0 } = await openTab(STATES.demo);
  for (const [name, file] of [['demo', postPng], ['worst', listPng]]) {
    for (const envName of ['light', 'dark']) {
      const panel = await panelFor(t0, ENVS[envName]);
      await tab(panel, 'Image');
      await panel.waitForTimeout(800);
      await shoot(panel, `${name}-image-start-${envName}`);
      await panel.setInputFiles('input[aria-label="Upload an image"]', file);
      await panel.waitForSelector('.ipic canvas, .ipic img', { timeout: 15000 });
      await shoot(panel, `${name}-image-loaded-${envName}`);
      // Reading starts by itself.
      await panel.waitForSelector('#allfonts, .ocrline', { timeout: 120000 }).catch(() => {});
      await panel.waitForFunction(() => !/Comparing letters|Matching…|Reading the text/.test(document.body.innerText), null, { timeout: 180000 }).catch(() => {});
      await shoot(panel, `${name}-image-results-${envName}`);
      await panel.close();
    }
  }

  // Library, Fonts I've seen, Settings: empty first, then seeded with worst-case data
  for (const seeded of [false, true]) {
    const panel = await panelFor(t0, ENVS.light);
    if (seeded) {
      await panel.evaluate(async () => {
        const db = await new Promise((r) => { const q = indexedDB.open('font-finder-plus'); q.onsuccess = () => r(q.result); });
        const tx = db.transaction(['fonts', 'savedFonts', 'collections', 'seen'], 'readwrite');
        const now = Date.now();
        const names = ['Konstantin Grotesk Condensed ExtraBold', '__Inter_Display_Variable_9a8b7c6d5e4f', 'Jo', 'Neue Haas Grotesk Display Pro 75 Bold', 'Söhne Mono', 'Đặng Serif', '王秀英宋体', 'GT America Standard Extended Medium'];
        const cols = ['Client: Northwind Industries Holdings rebrand Q3 2026', 'Editorial', 'Benachrichtigungseinstellungen', 'x', 'Maybe later (paid, ask legal first)'];
        for (let i = 0; i < 24; i++) tx.objectStore('collections').put({ id: 1000 + i, name: cols[i % cols.length] + (i >= cols.length ? ` ${i}` : ''), color: ['#3346FF', '#E2553D', '#19C05A'][i % 3], createdAt: now - i * 1000 });
        for (let i = 0; i < 60; i++) {
          const fam = names[i % names.length] + (i >= names.length ? ` ${i}` : '');
          const id = `${fam}::self-hosted`;
          tx.objectStore('fonts').put({ id, family: fam, displayName: fam, source: i % 3 ? 'self-hosted' : 'google', classification: ['sans', 'serif', 'mono', 'display', 'script', 'unknown'][i % 6], licenseType: ['OFL', 'commercial', 'unknown', 'system'][i % 4], designers: [], catalogFamily: null, kind: 'web', files: [], updatedAt: now });
          tx.objectStore('savedFonts').put({ id: 5000 + i, fontId: id, collectionIds: [1000 + (i % 24), 1001], notes: '', sitesSeen: ['northwind-industries-holdings.example.com', 'a.test'], sample: null, createdAt: now - i * 60000, updatedAt: now });
        }
        const hosts = Array.from({ length: 40 }, (_, i) => (i % 4 ? `site${i}.example.com` : `investor-relations.northwind-industries-holdings.example.com`));
        for (let i = 0; i < 300; i++) {
          const fam = names[i % names.length];
          const host = hosts[i % 40] + (i % 4 ? '' : `-${i}`);
          tx.objectStore('seen').put({ id: `${host}|${fam}${i}`, host, key: `${fam}${i}`, family: fam, displayName: fam, catalogFamily: null, kind: 'web', classification: 'sans', licenseType: 'commercial', roles: ['heading', 'body', 'button', 'link'], firstSeen: now - 86400000 * (i % 400), lastSeen: now - 86400000 * (i % 400), visits: i % 7 === 0 ? 1 : 1284, pages: [{ url: `https://${host}/workspaces/acme/projects/q3-launch/docs/9f8e7d6c5b4a?tab=comments`, title: 'Q3 Board Deck — FINAL (revised) v12' }] });
        }
        await new Promise((r) => (tx.oncomplete = r));
      });
      await sw.evaluate(async () => chrome.storage.local.set({ seenEnabled: true, seenPaused: ['site1.example.com'] }));
      await panel.reload();
    }
    const tag = seeded ? 'worst' : 'empty';
    await tab(panel, 'Library');
    await panel.waitForTimeout(1200);
    await shoot(panel, `${tag}-library-light`);
    await panel.locator('button', { hasText: "Fonts I've seen" }).click().catch(() => {});
    await panel.waitForTimeout(1200);
    await shoot(panel, `${tag}-seen-light`);
    await panel.locator('button[aria-label="Back"]').click().catch(() => {});
    await panel.locator('button[aria-label="Settings"]').click().catch(() => {});
    await panel.waitForTimeout(600);
    await shoot(panel, `${tag}-settings-light`);
    await panel.close();
  }

  // The hover card and toolbar on the page itself
  const { page: hp, tabId: ht } = await openTab(STATES.worst);
  await sw.evaluate(async (id) => chrome.tabs.sendMessage(id, { type: 'ffp:inspect', on: true }), ht);
  for (const sel of ['h1', 'p[dir=rtl]', 'code']) {
    const b = await hp.locator(sel).first().boundingBox();
    if (!b) continue;
    await hp.mouse.move(b.x + 20, b.y + 10);
    await hp.mouse.move(b.x + 24, b.y + 12);
    await hp.waitForTimeout(500);
    await hp.screenshot({ path: path.join(out, `worst-hover-${sel.replace(/\W/g, '')}.png`) });
  }
} finally {
  fs.writeFileSync(path.join(out, 'metrics.json'), JSON.stringify(metrics, null, 1));
  await ctx.close();
  server.kill();
}
