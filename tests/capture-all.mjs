// Captures every screen and interaction state of the extension (side panel and the
// dock and card on the page) and of the Figma plugin as standalone HTML files, to lay
// out on a design canvas and redesign. Dev only, never shipped.
//
//   npm run build:test && npm run build:figma && node tests/capture-all.mjs
//
// Writes tests/output/capture/<flow>/<NN>-<slug>.html and tests/output/capture/manifest.json,
// a list of { flow, file, title, width, height }. Light mode, plus one "Dark" example per flow
// (the plugin has a few). States the product cannot reach in a test browser are listed in
// tests/output/capture/skipped.json.
//
// How some states are reached:
//   - "Before you start" and "A file on your computer": the test build always has access to
//     all sites and to files, so the panel is told it has no site access (chrome.permissions
//     answers no) and, for the file, given the error the background stores when Chrome refuses.
//   - "Reading" and the error state: the page's reply to "scan" is held back or lost.
//   - The tooltip on the dock: the class the dock itself uses to show a tip is added.
//   Everything else is clicked, typed and dragged as a person would.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FONT_RECORDER, snapshotHtml } from './lib/snapshot.mjs';
import { base, fakeFigma, run, startPlugin, styles as fontStyles } from './lib/fake-figma.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ext = path.join(root, 'dist-test');
const outDir = path.join(root, 'tests/output/capture');
const work = path.join(root, 'tests/output/capture-work');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(path.join(outDir, '.tmp'), { recursive: true });
fs.mkdirSync(work, { recursive: true });
const PORT = 8773;
const FIX = `http://127.0.0.1:${PORT}`;
const ONLY = process.env.FFP_FLOWS ? new Set(process.env.FFP_FLOWS.split(',')) : null;

// ------------------------------------------------------------- capture bookkeeping

const FLOWS = [
  ['Page', 'page'],
  ['Details', 'details'],
  ['Image', 'image'],
  ['System', 'system'],
  ['Use with my fonts', 'my-fonts'],
  ['Library', 'library'],
  ['Settings', 'settings'],
  ['On the page', 'on-page'],
  ['Figma plugin', 'figma-plugin'],
];
const FLOW_DIR = Object.fromEntries(FLOWS);
const shots = [];
const skipped = [];
let tmpN = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const slugify = (s) => s.toLowerCase().replace(/×/g, 'x').replace(/[^a-z0-9.]+/g, '-').replace(/\./g, '').replace(/^-|-$/g, '');

async function settle(page, ms = 400) {
  await page.evaluate(() => document.fonts.ready).catch(() => {});
  await page.waitForTimeout(ms);
  await page.evaluate(() => document.fonts.ready).catch(() => {});
}

/** Save one state. `order` sorts the state within its flow; `state` is its plain name. */
async function cap(page, flow, order, state, opts = {}) {
  await settle(page, opts.wait ?? 400);
  const title = `${flow} · ${state}`;
  const { html, width, height } = await snapshotHtml(page, { ...opts, title });
  const tmp = path.join(outDir, '.tmp', `${++tmpN}.html`);
  fs.writeFileSync(tmp, html);
  shots.push({ flow, order, slug: slugify(state), title, width, height, tmp, bytes: Buffer.byteLength(html) });
  console.log(`  [${flow}] ${state}  ${width}×${height}  ${(Buffer.byteLength(html) / 1024).toFixed(0)} KB`);
}

const skip = (flow, state, why) => {
  skipped.push({ flow, state, why });
  console.log(`  SKIP [${flow}] ${state}: ${why}`);
};

/** Run one step; a failure is logged and noted, and the run goes on. */
async function step(flow, state, fn) {
  try {
    await fn();
  } catch (e) {
    skip(flow, state, `failed: ${String(e?.message ?? e).split('\n')[0].slice(0, 200)}`);
  }
}

function finish() {
  fs.rmSync(path.join(outDir, 'manifest.json'), { force: true });
  const manifest = [];
  for (const [flow, dir] of FLOWS) {
    const list = shots.filter((s) => s.flow === flow).sort((a, b) => a.order - b.order);
    if (!list.length) continue;
    fs.mkdirSync(path.join(outDir, dir), { recursive: true });
    list.forEach((s, i) => {
      const file = `${dir}/${String(i + 1).padStart(2, '0')}-${s.slug}.html`;
      fs.renameSync(s.tmp, path.join(outDir, file));
      manifest.push({ flow, file, title: s.title, width: s.width, height: s.height });
    });
  }
  fs.rmSync(path.join(outDir, '.tmp'), { recursive: true, force: true });
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  fs.writeFileSync(path.join(outDir, 'skipped.json'), JSON.stringify(skipped, null, 2));
  const total = shots.reduce((n, s) => n + s.bytes, 0);
  console.log('\nSnapshots per flow:');
  for (const [flow] of FLOWS) console.log(`  ${flow}: ${manifest.filter((m) => m.flow === flow).length}`);
  console.log(`Total: ${manifest.length} snapshots, ${(total / 1024 / 1024).toFixed(1)} MB in ${path.relative(root, outDir)}`);
  if (skipped.length) console.log(`Skipped:\n${skipped.map((s) => `  [${s.flow}] ${s.state}: ${s.why}`).join('\n')}`);
}

// ------------------------------------------------------------- browser and extension

const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: path.join(root, 'tests/fixtures'), stdio: 'ignore' });
await sleep(800);
const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
const ctx = await chromium.launchPersistentContext(await mkdtemp(path.join(tmpdir(), 'ffp-capture-')), {
  channel: 'chromium', headless: true, viewport: { width: 1280, height: 800 }, colorScheme: 'light',
  proxy: proxy ? { server: proxy, bypass: '127.0.0.1,localhost' } : undefined,
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
await ctx.addInitScript(FONT_RECORDER);
let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent('serviceworker');
const extId = new URL(sw.url()).host;
// The tips above the dock start finished; the On the page flow replays them.
await sw.evaluate(async () => chrome.storage.local.set({ 'ffp:coachStep': 3 }));

const tabIdOf = (url) => sw.evaluate(async (u) => (await chrome.tabs.query({})).find((t) => t.url === u)?.id, url);
async function openTab(url, { inject = true, inspect = true } = {}) {
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'networkidle' }).catch(() => {});
  await page.evaluate(() => document.fonts.ready).catch(() => {});
  const tabId = await tabIdOf(page.url());
  if (inject) {
    await sw.evaluate(async (id) => { await chrome.scripting.executeScript({ target: { tabId: id }, files: ['content.js'] }); }, tabId);
    if (inspect) await sw.evaluate(async (id) => chrome.tabs.sendMessage(id, { type: 'ffp:inspect', on: true }), tabId);
  }
  return { page, tabId };
}

/** The side panel as a page, pinned to one tab. `init` runs in the panel before its own code. */
async function panelFor(tabId, { theme = 'light', init = null, arg = null, height = 860 } = {}) {
  const panel = await ctx.newPage();
  await panel.setViewportSize({ width: 400, height });
  if (init) await panel.addInitScript(init, arg);
  await panel.goto(`chrome-extension://${extId}/sidepanel.html${tabId != null ? `?tab=${tabId}` : ''}`);
  await panel.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
  return panel;
}
const setTheme = (panel, t) => panel.evaluate((x) => document.documentElement.setAttribute('data-theme', x), t);
const tab = async (panel, name) => {
  await panel.locator('.tabs button', { hasText: name }).click();
  await panel.waitForTimeout(500);
};
const back = (panel) => panel.locator('button[aria-label="Back"]').first().click();
const shadowEval = (page, fn, arg) => page.evaluate(([f, a]) => new Function('sr', 'a', `return (${f})(sr, a)`)(document.getElementById('ffp-root').shadowRoot, a), [fn.toString(), arg]);

// Pictures for the Image tab.
async function makePictures(indexPage) {
  const heading = path.join(work, 'heading.png');
  await indexPage.evaluate(() => window.scrollTo(0, 0));
  await indexPage.locator('h1').screenshot({ path: heading });
  const lp = await ctx.newPage();
  await lp.goto(`${FIX}/post.html`, { waitUntil: 'networkidle' });
  await lp.evaluate(() => document.fonts.ready);
  const post = path.join(work, 'post.png');
  await lp.locator('#post').screenshot({ path: post });
  await lp.setContent('<body style="margin:0"><div id="b" style="width:640px;height:360px;background:linear-gradient(135deg,#cfe3f5,#f6d9c4)"></div></body>');
  const blank = path.join(work, 'no-text.png');
  await lp.locator('#b').screenshot({ path: blank });
  await lp.close();
  const bad = path.join(work, 'notes.png');
  fs.writeFileSync(bad, 'This is a text file with a picture name, so it cannot be opened as a picture.\n');
  return { heading, post, blank, bad };
}

// Waits for the Image tab to finish reading (no "Reading the text" card).
const readingDone = (panel, timeout = 120000) => panel.waitForFunction(() => !document.querySelector('.ireading') && !/Opening the picture/.test(document.body.innerText), null, { timeout }).catch(() => {});
const useAnother = async (panel) => {
  const b = panel.locator('.ipic button:has-text("Use another"), .ipic button[aria-label="Use another picture"]').first();
  if (await b.count()) await b.click();
  await panel.waitForTimeout(300);
};

const FIG_TYPE = '{"ffp":"figma-type","v":1,"name":"Northwind type","styles":[{"name":"Display","role":"h1","family":"Fraunces","weight":600,"size":64,"lineHeight":68,"letterSpacing":-0.02},{"name":"Body","role":"body","family":"Inter","weight":400,"size":18,"lineHeight":28,"letterSpacing":0},{"name":"Spare","role":"none","family":"Inter","weight":400,"size":12,"lineHeight":16,"letterSpacing":0}]}';

// Product text for a local file Chrome will not let extensions read (from the real helper).
async function fileAccessError(fileUrl) {
  const { build } = require('esbuild');
  const tmp = path.join(root, 'node_modules/.cache/ffp-capture-access.mjs');
  await build({ entryPoints: [path.join(root, 'src/shared/pageaccess.ts')], outfile: tmp, format: 'esm', bundle: true, platform: 'node', logLevel: 'silent' });
  const acc = await import(`${tmp}?${Date.now()}`);
  return acc.explainInjectError(`Cannot access contents of url "${fileUrl}". Extension manifest must request permission to access this host.`, fileUrl, false);
}

const want = (flow) => !ONLY || ONLY.has(flow);
let figmaPayload = null;

try {
  const { page, tabId } = await openTab(`${FIX}/index.html`);
  const pics = await makePictures(page);
  const P = await panelFor(tabId);
  await P.waitForSelector('.fcard', { timeout: 30000 }).catch(() => {});

  // ----------------------------------------------------------- empty states first (fresh profile)
  if (want('Image')) await step('Image', 'Start', async () => {
    await tab(P, 'Image');
    await cap(P, 'Image', 1, 'Start');
    await setTheme(P, 'dark');
    await cap(P, 'Image', 1.5, 'Start · Dark');
    await setTheme(P, 'light');
  });
  if (want('Library')) {
    await step('Library', 'Empty library', async () => {
      await tab(P, 'Library');
      await P.waitForTimeout(800);
      await cap(P, 'Library', 8, 'Empty library');
    });
    await step('Library', "Fonts I've seen · Off", async () => {
      await P.locator('.libtile', { hasText: "Fonts I've seen" }).click();
      await P.waitForSelector('#seen-off', { timeout: 5000 });
      await cap(P, 'Library', 10.8, "Fonts I've seen · Off");
      await P.locator('#seen-off button', { hasText: 'Turn on' }).click();
      await P.waitForTimeout(600);
      await cap(P, 'Library', 10.9, "Fonts I've seen · Empty");
      await back(P);
    });
    await step('Library', 'Boards · Empty', async () => {
      await P.locator('.libtile', { hasText: 'Boards' }).click();
      await P.waitForTimeout(500);
      await cap(P, 'Library', 11.1, 'Boards · Empty');
      await back(P);
    });
  } else {
    await sw.evaluate(async () => chrome.storage.local.set({ seenEnabled: true })).catch(() => {});
  }
  await tab(P, 'Page');
  await P.waitForSelector('.fcard', { timeout: 30000 }).catch(() => {});

  // ----------------------------------------------------------- Page
  if (want('Page')) {
    const F = 'Page';
    await step(F, 'Before you start', async () => {
      const { page: fresh, tabId: freshId } = await openTab(`${FIX}/page2.html`, { inject: false });
      const p = await panelFor(freshId, { init: () => { chrome.permissions.contains = async () => false; } });
      await p.waitForSelector('.empty', { timeout: 10000 });
      await cap(p, F, 1, 'Before you start');
      await p.close();
      await fresh.close();
    });
    await step(F, 'Reading', async () => {
      const p = await panelFor(tabId, { init: () => {
        const send = chrome.tabs.sendMessage.bind(chrome.tabs);
        chrome.tabs.sendMessage = (id, msg, ...rest) => (msg?.type === 'ffp:scan' ? undefined : send(id, msg, ...rest));
      } });
      await p.waitForSelector('.ploading', { timeout: 10000 });
      await cap(p, F, 2, 'Reading');
      await p.close();
    });
    await step(F, "Can't read this page", async () => {
      const cp = await ctx.newPage();
      await cp.goto('chrome://version/').catch(() => {});
      const ids = await sw.evaluate(async () => (await chrome.tabs.query({})).map((t) => ({ id: t.id, url: t.url ?? null, active: t.active })));
      // Chrome hides the address of its own pages from the extension: it is the newest tab without one.
      const cid = ids.filter((t) => !t.url).map((t) => t.id).sort((a, b) => b - a)[0];
      const p = await panelFor(cid);
      await p.waitForFunction(() => /Chrome doesn't let extensions read this page/.test(document.body.innerText), null, { timeout: 15000 });
      await cap(p, F, 3, "Can't read this page (chrome://)");
      await p.close();
      await cp.close();
    });
    await step(F, 'A file on your computer', async () => {
      const fileUrl = `file://${path.join(root, 'tests/fixtures/page2.html')}`;
      const fp = await ctx.newPage();
      await fp.goto(fileUrl);
      const fid = await tabIdOf(fileUrl);
      const msg = await fileAccessError(fileUrl);
      await sw.evaluate(async ([id, m]) => chrome.storage.session.set({ [`injectError:${id}`]: m }), [fid, msg]);
      const p = await panelFor(fid, { init: () => { chrome.permissions.contains = async () => false; } });
      await p.waitForFunction(() => /Allow access to files/.test(document.body.innerText), null, { timeout: 10000 });
      await cap(p, F, 4, 'A file on your computer');
      await p.close();
      await fp.close();
    });
    await step(F, 'No fonts found', async () => {
      const { page: ep, tabId: eid } = await openTab(`${FIX}/stress/empty.html`);
      const p = await panelFor(eid);
      await p.waitForFunction(() => /No text on this page uses a font/.test(document.body.innerText), null, { timeout: 20000 });
      await cap(p, F, 5, 'No fonts found (picture-only page)');
      await p.close();
      await ep.close();
    });
    await step(F, 'This is a PDF', async () => {
      const { page: pp, tabId: pid } = await openTab(`${FIX}/pdf.html`);
      const p = await panelFor(pid);
      await p.waitForFunction(() => /This is a PDF/.test(document.body.innerText), null, { timeout: 15000 });
      await cap(p, F, 5.5, 'This is a PDF');
      await p.close();
      await pp.close();
    });

    await step(F, 'Main', async () => {
      await P.bringToFront();
      await P.waitForFunction(() => [...document.querySelectorAll('.fcard')].some((c) => c.textContent.includes('Libre Caslon Condensed')), null, { timeout: 20000 }).catch(() => {});
      await P.waitForFunction(() => { const rows = [...document.querySelectorAll('.mflist li')]; return rows.length && rows.every((r) => !/Measuring/.test(r.textContent)); }, null, { timeout: 30000 }).catch(() => {});
      await P.waitForTimeout(1500);
      await cap(P, F, 6, 'Main · How it works visible');
      await setTheme(P, 'dark');
      await cap(P, F, 6.1, 'Main · Dark');
      await setTheme(P, 'light');
    });
    await step(F, 'Paused', async () => {
      await P.locator('.pstatus button[role="switch"]').click();
      await P.waitForFunction(() => /Paused · turn on/.test(document.body.innerText), null, { timeout: 5000 });
      await cap(P, F, 6.2, 'Paused');
      await P.locator('.pstatus button[role="switch"]').click();
      await P.waitForFunction(() => /Inspecting · point/.test(document.body.innerText), null, { timeout: 5000 });
    });
    await step(F, 'Copy for Figma', async () => {
      await P.evaluate(() => { window.__copied = null; navigator.clipboard.writeText = async (t) => { window.__copied = t; }; });
      await P.locator('.pstatus button', { hasText: 'Copy for Figma' }).click();
      await P.waitForFunction(() => window.__copied, null, { timeout: 90000 });
      await P.waitForFunction(() => [...document.querySelectorAll('.pstatus button')].some((b) => b.textContent === 'Copied'), null, { timeout: 5000 }).catch(() => {});
      await cap(P, F, 6.3, 'Copy for Figma · Copied', { wait: 100 });
      figmaPayload = await P.evaluate(() => window.__copied);
      fs.writeFileSync(path.join(work, 'figma-payload.txt'), figmaPayload);
    });
    await step(F, 'How it works hidden', async () => {
      await P.locator('button[aria-label="Hide this guide"]').click();
      await P.waitForTimeout(300);
      await cap(P, F, 7, 'How it works hidden');
    });
    await step(F, 'Language menu', async () => {
      await P.evaluate(() => window.scrollTo(0, 0));
      await P.locator('.tester .ddbtn').first().click();
      await P.waitForSelector('.ddlist[role="listbox"]');
      await cap(P, F, 8, 'Language menu open');
      await P.keyboard.press('Escape');
    });
    await step(F, 'Language sample', async () => {
      await P.locator('.tester .ddbtn').first().click();
      await P.locator('.ddlist li[role="option"]', { hasText: /^Arabic$/ }).first().click();
      await P.waitForTimeout(800);
      await cap(P, F, 8.5, 'Language sample · Arabic (letters missing)');
      await P.locator('.tester .ddbtn').first().click();
      await P.locator('.ddlist li[role="option"]', { hasText: /^English$/ }).first().click();
    });
    await step(F, 'Preview style menu', async () => {
      await P.locator('.tester button[aria-label="Preview style"]').first().click();
      await P.waitForSelector('.ddlist.menu');
      await cap(P, F, 9, 'Preview style menu open');
      await P.keyboard.press('Escape');
    });
    await step(F, 'Make it free after Swap', async () => {
      await P.locator('section.mif button', { hasText: 'Swap all on the page' }).click();
      await P.waitForSelector('section.mif button:has-text("Undo all")', { timeout: 60000 });
      await P.waitForTimeout(500);
      await cap(P, F, 10, 'Make it free · After Swap');
      await P.locator('section.mif button', { hasText: 'Undo all' }).click();
      await P.waitForTimeout(300);
    });
    await step(F, 'Fonts did not load', async () => {
      await P.locator('.notloaded .nlhead').click();
      await cap(P, F, 11, 'Fonts did not load · Open');
      await P.locator('.notloaded .nlhead').click();
    });
    await step(F, 'Save picker', async () => {
      const card = P.locator('.fcard', { hasText: 'Inter' }).first();
      await card.locator('button[aria-label="Save Inter to your library"]').click();
      await card.locator('.cardpicker').waitFor({ timeout: 5000 });
      await cap(P, F, 12, 'Font card · Save and pick a collection');
      await card.locator('.cardpicker button', { hasText: 'Done' }).click();
    });
    await step(F, 'Show on page', async () => {
      await page.evaluate(() => window.scrollTo(0, 0));
      await P.locator('.fcard', { hasText: 'Fraunces' }).locator('button[aria-label="Show Fraunces on the page"]').click();
      await page.waitForTimeout(500);
      await cap(P, F, 13, 'Show on page active', { wait: 150 });
      if (want('On the page')) await cap(page, 'On the page', 9, 'Show on page · Outlines with the flag', { rootSel: '#ffp-root', wait: 150 });
      await P.locator('.fcard', { hasText: 'Fraunces' }).locator('button[aria-label="Hide outlines"]').click().catch(() => {});
    });
    await step(F, 'Site share view', async () => {
      await P.locator('.pstatus button[aria-label="Share card"]').click();
      await P.waitForSelector('canvas.cardcanvas', { timeout: 10000 });
      await P.waitForTimeout(1500);
      await cap(P, F, 14, 'Share · Fonts used on this site');
      await P.locator('.shareseg button', { hasText: 'Portrait' }).click().catch(() => {});
      await P.locator('.shareseg button', { hasText: 'Dark' }).click().catch(() => {});
      await P.waitForTimeout(1200);
      await cap(P, F, 14.5, 'Share · Fonts used on this site · Portrait, dark card');
      await back(P);
    });
    skip(F, 'Compare', 'Compare is not on the Page tab; it is in System (captured there as "Compare with another tab").');
    skip(F, 'Paste type from Figma', 'Paste type from Figma is not on the Page tab; it is in System (captured there).');
    await step(F, 'Offline', async () => {
      await ctx.setOffline(true);
      await P.waitForTimeout(600);
      await cap(P, F, 16.5, "You're offline");
      await ctx.setOffline(false);
      await P.waitForTimeout(400);
    });
    await step(F, 'Error', async () => {
      const p = await panelFor(tabId, { init: () => {
        const send = chrome.tabs.sendMessage.bind(chrome.tabs);
        chrome.tabs.sendMessage = (id, msg, ...rest) => {
          if (msg?.type !== 'ffp:scan') return send(id, msg, ...rest);
          const cb = rest.find((x) => typeof x === 'function');
          setTimeout(() => cb?.(undefined), 50);
        };
      } });
      await p.waitForFunction(() => /Couldn't finish reading this page/.test(document.body.innerText), null, { timeout: 15000 });
      await cap(p, F, 17, "Error · Couldn't finish reading");
      await p.close();
    });
  }

  // ----------------------------------------------------------- Details (Fraunces, a variable font)
  if (want('Details')) {
    const F = 'Details';
    await step(F, 'Top', async () => {
      await P.bringToFront();
      await tab(P, 'Page');
      await P.locator('.fcard', { hasText: 'Fraunces' }).locator('button.go', { hasText: 'Details' }).click();
      await P.waitForSelector('h1.nm');
      await P.waitForFunction(() => /\d+ letters/.test(document.body.innerText) || document.body.innerText.includes('could not'), null, { timeout: 20000 }).catch(() => {});
      await P.waitForFunction(() => /of \d+ supported/i.test(document.body.innerText), null, { timeout: 30000 }).catch(() => {});
      await P.waitForSelector('#sec-similar .match', { timeout: 30000 }).catch(() => {});
      await P.waitForSelector('#sec-pairs .dpair', { timeout: 20000 }).catch(() => {});
      await P.waitForTimeout(1500);
      await cap(P, F, 1, 'Top');
      await setTheme(P, 'dark');
      await cap(P, F, 1.5, 'Top · Dark');
      await setTheme(P, 'light');
    });
    const jump = async (id) => {
      await P.locator(`[data-jump="${id}"]`).first().click();
      await P.waitForTimeout(900);
    };
    await step(F, 'Licence', async () => { await jump('sec-licence'); await cap(P, F, 2.1, 'Licence'); });
    await step(F, 'Similar', async () => {
      await jump('sec-similar');
      await P.locator('#sec-similar button', { hasText: /^Show all \d+/ }).click().catch(() => {});
      await P.locator('#sec-similar .match button', { hasText: 'Try on page' }).first().click();
      await page.waitForFunction(() => document.querySelector('h1')?.getAttribute('data-ffp-swap'), null, { timeout: 20000 }).catch(() => {});
      await P.waitForSelector('#sec-similar .match button:has-text("Showing on page")', { timeout: 10000 }).catch(() => {});
      await cap(P, F, 2.2, 'Similar · Try on page active');
      await P.locator('#sec-similar .match button', { hasText: 'Showing on page' }).first().click().catch(() => {});
    });
    await step(F, 'Pairs', async () => { await jump('sec-pairs'); await cap(P, F, 2.3, 'Pairs'); });
    await step(F, 'On this page', async () => {
      await jump('sec-page');
      await P.locator('#sec-page button', { hasText: 'Show on page' }).click().catch(() => {});
      await cap(P, F, 2.4, 'On this page · Showing on page', { wait: 200 });
    });
    await step(F, 'Letters and languages', async () => {
      await jump('sec-letters');
      await P.locator('#sec-letters .dmorelang').click().catch(() => {});
      await cap(P, F, 2.5, 'Letters and languages');
    });
    await step(F, 'Glyphs', async () => {
      await P.locator('.dglyphs button', { hasText: /^See all \d+ letters/ }).click();
      await P.waitForSelector('.glyphs button');
      await P.fill('input[aria-label="Find a character"]', 'e');
      await P.waitForTimeout(200);
      await P.locator('.glyphs button').first().click();
      await P.waitForFunction(() => /LATIN/.test(document.querySelector('.glyphsel')?.textContent ?? ''), null, { timeout: 5000 }).catch(() => {});
      await cap(P, F, 2.6, 'Glyphs · All letters, one picked');
      await P.fill('input[aria-label="Find a character"]', '');
    });
    await step(F, 'Files', async () => {
      await jump('sec-files');
      await P.evaluate(() => document.querySelectorAll('#sec-files details.dfold').forEach((d) => { d.open = true; }));
      await cap(P, F, 2.7, 'Files · Metrics diagram open');
    });
    await step(F, 'On this computer', async () => {
      await P.locator('h2', { hasText: 'On this computer' }).scrollIntoViewIfNeeded();
      await cap(P, F, 2.8, 'On this computer');
    });
    await step(F, 'Variable playground', async () => {
      const sliders = P.locator('#sec-variable .axis input[type=range]');
      await sliders.first().scrollIntoViewIfNeeded();
      const n = await sliders.count();
      for (let i = 0; i < n; i++) {
        const [min, max] = await sliders.nth(i).evaluate((e) => [Number(e.min), Number(e.max)]);
        await sliders.nth(i).fill(String(Math.round(min + (max - min) * (i % 2 ? 0.25 : 0.8))));
      }
      await P.waitForTimeout(400);
      await cap(P, F, 3, 'Variable playground · Axes moved');
    });
    await step(F, 'Share card', async () => {
      await P.evaluate(() => window.scrollTo(0, 0));
      await P.locator('.dhead button', { hasText: 'Share' }).click();
      await P.waitForSelector('canvas.cardcanvas', { timeout: 10000 });
      await P.waitForTimeout(1500);
      await cap(P, F, 4, 'Share card');
      await back(P);
      await P.waitForSelector('h1.nm');
    });
    await back(P).catch(() => {});
  }

  // ----------------------------------------------------------- System
  if (want('System')) {
    const F = 'System';
    await step(F, 'Top', async () => {
      // A second tab read first, so Compare has something to compare with.
      const { page: p2page, tabId: t2 } = await openTab(`${FIX}/page2.html`);
      const p2 = await panelFor(t2);
      await p2.waitForSelector('.fcard', { timeout: 20000 }).catch(() => {});
      await tab(p2, 'System');
      await p2.waitForSelector('#sys-styles', { timeout: 20000 });
      await p2.close();
      void p2page;
      await P.bringToFront();
      await tab(P, 'System');
      await P.waitForSelector('#sys-styles', { timeout: 20000 });
      await P.waitForTimeout(1500);
      await cap(P, F, 1, 'Top · Type scale');
      await setTheme(P, 'dark');
      await cap(P, F, 1.5, 'Top · Dark');
      await setTheme(P, 'light');
    });
    for (const [i, r] of ['×1.2', '×1.25', '×1.333'].entries()) {
      await step(F, `Ratio ${r}`, async () => {
        await P.locator('#sys-styles .seg button', { hasText: r }).first().click();
        await cap(P, F, 2 + i / 10, `Ratio ${r}`);
      });
    }
    await step(F, 'More sizes', async () => {
      const more = P.locator('#sys-styles button.sysdisc');
      if (!(await more.count())) return skip(F, 'Scale · All sizes', 'this page has 8 sizes or fewer, so there is no "Show more"');
      await more.click();
      await cap(P, F, 2.5, 'Scale · All sizes shown');
      await more.click();
    });
    await step(F, 'Try on page', async () => {
      await P.locator('#sys-styles button', { hasText: 'Try on page' }).click();
      await page.waitForTimeout(600);
      await cap(P, F, 3, 'Clean scale · Try on page active');
      await P.locator('#sys-styles button', { hasText: 'Put page back' }).click();
      await page.waitForTimeout(300);
    });
    await step(F, 'Readability', async () => {
      const tiles = P.locator('#sys-health .tile:not(.sum)');
      const n = await tiles.count();
      const info = await tiles.evaluateAll((ts) => ts.map((t) => ({ name: t.querySelector('b')?.textContent ?? '', s: t.querySelector('.st')?.getAttribute('aria-label') })));
      // A failing one first, then the rest.
      const order = [...info.keys()].sort((a, b) => (info[a].s === 'Fails' ? -1 : 0) - (info[b].s === 'Fails' ? -1 : 0));
      for (const [k, i] of order.entries()) {
        await tiles.nth(i).click();
        await P.waitForTimeout(150);
        await cap(P, F, 4 + k / 100, `Readability · ${info[i].name} (${info[i].s === 'Fails' ? 'fails' : info[i].s === 'Passes' ? 'passes' : 'check'})`);
      }
      void n;
      await P.locator('#sys-health .tile', { hasText: 'Contrast' }).click();
      await P.locator('#sys-health .tdet button', { hasText: 'Show on page' }).click();
      await cap(P, F, 4.5, 'Readability · Contrast shown on page', { wait: 200 });
      await P.locator('#sys-health .tdet button', { hasText: 'Hide outlines' }).click().catch(() => {});
    });
    await step(F, 'Developer checks', async () => {
      await P.locator('#sys-dev button.fold').click();
      await cap(P, F, 5, 'Developer checks · Open');
      await P.locator('#sys-dev button.famhead').click().catch(() => {});
      await P.locator('#sys-parts button.part', { hasText: 'Readability' }).click().catch(() => {});
      await cap(P, F, 5.5, 'Developer checks · Each family and a health part open');
      await P.locator('#sys-dev button.fold').click();
    });
    await step(F, 'Export', async () => {
      await P.locator('#sys-export .sysdd > button').click();
      await P.waitForSelector('#sys-export li[role="option"]');
      await cap(P, F, 6, 'Export · Format menu open');
      const labels = await P.locator('#sys-export li[role="option"] .txt').allTextContents();
      await P.keyboard.press('Escape');
      await P.locator('#sys-export .sysdd > button').click().catch(() => {});
      await P.keyboard.press('Escape').catch(() => {});
      for (const [k, label] of labels.entries()) {
        await P.locator('#sys-export .sysdd > button').click();
        await P.locator('#sys-export li[role="option"]', { hasText: label }).first().click();
        await P.waitForTimeout(250);
        await cap(P, F, 6.01 + k / 100, `Export · ${label}`);
      }
      await P.locator('#sys-export .sysdd > button').click();
      await P.locator('#sys-export li[role="option"]', { hasText: 'CSS variables' }).first().click();
    });
    await step(F, 'Compare', async () => {
      await P.locator('#sys-compare button.fold').click();
      await P.waitForTimeout(600);
      await cap(P, F, 7, 'Compare with another tab · Open');
      await P.locator('#sys-compare button.fold').click();
    });
    await step(F, 'Paste type from Figma', async () => {
      await P.locator('button#sys-figma-paste').click();
      await P.waitForSelector('#sys-figma-paste input', { timeout: 5000 });
      await cap(P, F, 8, 'Paste type from Figma · Empty paste field');
      await P.locator('#sys-figma-paste input').fill('hello');
      await P.waitForTimeout(200);
      await cap(P, F, 8.1, 'Paste type from Figma · Not from the plugin');
      await P.locator('#sys-figma-paste input').fill(FIG_TYPE);
      await P.waitForSelector('#sys-figma-paste .landed', { timeout: 30000 });
      await page.waitForTimeout(600);
      await cap(P, F, 8.2, 'Paste type from Figma · Styles applied');
      await P.locator('#sys-figma-paste button', { hasText: 'Put page back' }).click();
      await page.waitForTimeout(300);
    });
  }

  // ----------------------------------------------------------- Use with my fonts
  if (want('Use with my fonts')) {
    const F = 'Use with my fonts';
    await step(F, 'Step 1', async () => {
      await P.bringToFront();
      await tab(P, 'System');
      await P.waitForSelector('#sys-styles', { timeout: 20000 });
      await P.locator('button.mfentry', { hasText: 'Use with my fonts' }).click();
      await P.waitForSelector('#mf-pick', { timeout: 10000 });
      await cap(P, F, 1, 'Step 1 · Pick your fonts (empty)');
    });
    await step(F, 'Font search', async () => {
      await P.locator('.slot', { hasText: 'Heading font' }).click();
      await P.waitForSelector('.picker .search input');
      await P.waitForTimeout(1500);
      await cap(P, F, 2, 'Step 1 · Font search open');
      await P.locator('.localask').scrollIntoViewIfNeeded().catch(() => {});
      if (await P.locator('.localask').count()) await cap(P, F, 3, 'Step 1 · Include fonts on this computer');
      else skip(F, 'Include fonts on this computer', 'this browser has no Local Font Access, so the row is not shown');
      await P.locator('.picker .search input').fill('Instrument');
      await P.waitForTimeout(1500);
      await cap(P, F, 2.5, 'Step 1 · Search typed');
    });
    await step(F, 'Fonts picked', async () => {
      await P.locator('.picker .search input').fill('Instrument Serif');
      await P.locator('.fitem', { hasText: 'Instrument Serif' }).first().click();
      await P.waitForSelector('.slotwrap .picker', { timeout: 5000 });
      await P.locator('.picker .search input').fill('Work Sans');
      await P.waitForFunction(() => [...document.querySelectorAll('.fitem .fn')].some((e) => /^Work Sans/.test(e.textContent) && /ffp-name/.test(e.style.fontFamily)), null, { timeout: 15000 }).catch(() => {});
      await P.locator('.fitem', { hasText: /^Work Sans/ }).first().click();
      await P.waitForTimeout(800);
      await cap(P, F, 4, 'Step 1 · Fonts picked');
    });
    await step(F, 'Step 2', async () => {
      await P.locator('button', { hasText: 'See your styles' }).click();
      await P.waitForSelector('#mf-styles .mfrow', { timeout: 15000 });
      await P.waitForFunction(() => /Bigger|Smaller|Same x-height/.test(document.querySelector('#mf-styles')?.textContent ?? ''), null, { timeout: 20000 }).catch(() => {});
      await P.waitForTimeout(800);
      await cap(P, F, 5, 'Step 2 · Your styles');
      await setTheme(P, 'dark');
      await cap(P, F, 5.5, 'Step 2 · Dark');
      await setTheme(P, 'light');
    });
    await step(F, 'Edit', async () => {
      await P.locator('.mfrow[data-style="h1"] button', { hasText: 'Edit' }).click();
      await P.locator('.mfrow[data-style="h1"] input').first().fill('60');
      await P.waitForTimeout(300);
      await cap(P, F, 6, 'Step 2 · A style open to edit');
    });
    await step(F, 'See it on this page', async () => {
      await P.locator('[role="switch"][aria-labelledby="mf-onpage-label"]').click();
      await page.waitForFunction(() => getComputedStyle(document.querySelector('h1')).fontSize === '60px', null, { timeout: 30000 }).catch(() => {});
      await cap(P, F, 7, 'Step 2 · See it on this page on');
      await P.locator('[role="switch"][aria-labelledby="mf-onpage-label"]').click();
      await page.waitForTimeout(300);
    });
    await step(F, 'Step 3', async () => {
      await P.locator('button', { hasText: 'Export these styles' }).click();
      await P.waitForSelector('#mf-export', { timeout: 5000 });
      for (const [k, fmt] of ['CSS', 'Tailwind', 'Figma'].entries()) {
        await P.locator('#mf-export .seg button', { hasText: fmt }).first().click();
        await P.waitForTimeout(250);
        await cap(P, F, 8 + k / 10, `Step 3 · Export as ${fmt}`);
      }
      await P.locator('#mf-export .seg button', { hasText: 'CSS' }).first().click();
      await P.locator('#mf-export .seg button', { hasText: "The site's" }).click();
      await cap(P, F, 9, "Step 3 · Names switched to the site's");
      await P.locator('#mf-export .seg button', { hasText: 'Simple' }).click();
      for (let i = 0; i < 3; i++) await P.locator('.mftop .backbtn').click().catch(() => {});
    });
  }

  // ----------------------------------------------------------- Library
  if (want('Library')) {
    const F = 'Library';
    await step(F, 'Seed', async () => {
      // Save fonts from the page, as a person would, then make collections.
      await P.bringToFront();
      await tab(P, 'Page');
      await P.waitForSelector('.fcard', { timeout: 20000 });
      for (const name of ['Fraunces', 'Inter', 'Geist Mono', 'Libre Caslon Condensed', 'Lobster', 'House Mono', 'Demo']) {
        const card = P.locator('.fcard', { hasText: name }).first();
        const btn = card.locator(`button[aria-label="Save ${name} to your library"]`);
        if (!(await btn.count())) continue;
        await btn.click();
        await card.locator('.cardpicker button', { hasText: 'Done' }).click({ timeout: 3000 }).catch(() => {});
        await P.waitForTimeout(200);
      }
      await tab(P, 'Library');
      await P.waitForSelector('.lcard', { timeout: 10000 });
      for (const [name, picks] of [['Editorial', ['Fraunces', 'Libre Caslon Condensed', 'Inter']], ['Client B', ['Geist Mono']]]) {
        await P.locator('.colrow .chip.newcol').click();
        await P.fill('input[aria-label="Collection name"]', name);
        for (const f of picks) await P.locator('.chips.addpills .chip', { hasText: f }).first().click().catch(() => {});
        await P.locator('button.stickysave').click();
        await P.waitForTimeout(400);
      }
      await P.waitForSelector('.lcard', { timeout: 10000 });
    });
    await step(F, 'Saved fonts', async () => {
      await P.locator('.colrow button', { hasText: /^All/ }).click().catch(() => {});
      await P.waitForTimeout(1200);
      await cap(P, F, 1, 'Saved fonts · Grid');
      await setTheme(P, 'dark');
      await cap(P, F, 1.05, 'Saved fonts · Grid · Dark');
      await setTheme(P, 'light');
      await P.locator('.viewtoggle button[aria-label="Wide list"]').click();
      await P.waitForSelector('.lrow');
      await cap(P, F, 1.1, 'Saved fonts · List');
      await P.locator('.viewtoggle button[aria-label="Grid"]').click();
    });
    await step(F, 'Search', async () => {
      await P.fill('#lib-search', 'fra');
      await P.waitForTimeout(300);
      await cap(P, F, 2, 'Search typed');
      await P.fill('#lib-search', 'zzz');
      await P.waitForTimeout(300);
      await cap(P, F, 2.5, 'Search · No fonts match');
      await P.fill('#lib-search', '');
    });
    await step(F, 'Filters', async () => {
      await P.locator('button[aria-label="Filters"]').click();
      await P.waitForSelector('.libfilters');
      await cap(P, F, 3, 'Filters open');
      await P.locator('button[aria-label="Close filters"]').click();
    });
    await step(F, 'Preview options', async () => {
      await P.locator('button[aria-label="Preview options"]').click();
      await cap(P, F, 3.5, 'Preview options menu');
      await P.locator('button[aria-label="Preview options"]').click();
    });
    await step(F, 'Collection selected', async () => {
      await P.locator('.colrow button', { hasText: 'Editorial' }).click();
      await P.waitForTimeout(500);
      await cap(P, F, 4, 'A collection selected');
      await P.locator('.colbar button[aria-label="Collection options"]').click();
      await cap(P, F, 4.5, 'Collection options menu');
      await P.locator('.colbar button[aria-label="Collection options"]').click();
    });
    await step(F, 'Add fonts', async () => {
      await P.locator('.colbar button', { hasText: 'Add fonts' }).click();
      await P.waitForSelector('.chips.addpills');
      await P.locator('.chips.addpills .chip', { hasText: 'Lobster' }).first().click().catch(() => {});
      await cap(P, F, 7, 'Add fonts to a collection');
      await P.locator('button.stickysave').click();
      await P.waitForTimeout(400);
    });
    await step(F, 'New collection', async () => {
      await P.locator('.colrow .chip.newcol').click();
      await P.fill('input[aria-label="Collection name"]', 'Moodboard');
      await cap(P, F, 5, 'New collection form');
      await P.locator('button.stickysave').click();
      await P.waitForTimeout(500);
    });
    await step(F, 'Empty collection', async () => {
      await P.locator('.colrow button', { hasText: 'Moodboard' }).click();
      await P.waitForTimeout(400);
      await cap(P, F, 9, 'Empty collection');
      await P.locator('.colrow button', { hasText: /^All/ }).click();
    });
    await step(F, 'Card menu', async () => {
      await P.locator('.lcard button[aria-label^="Options for"]').first().click();
      await P.waitForSelector('.lcard .cardmenu');
      await cap(P, F, 6, 'Card menu open');
      await P.locator('.lcard button[aria-label^="Options for"]').first().click();
    });
    await step(F, "Fonts I've seen", async () => {
      // Visit a few pages so there is a history: this site, a second page and another host.
      for (const u of [`${FIX}/page2.html`, `http://localhost:${PORT}/page2.html`, `${FIX}/stress/one.html`]) {
        const { page: vp, tabId: vid } = await openTab(u);
        const vpanel = await panelFor(vid);
        await vpanel.waitForSelector('.fcard', { timeout: 20000 }).catch(() => {});
        await vpanel.waitForTimeout(800);
        await vpanel.close();
        await vp.close();
      }
      await P.bringToFront();
      await P.locator('.libtile', { hasText: "Fonts I've seen" }).click();
      await P.waitForSelector('.seenrow', { timeout: 10000 });
      await cap(P, F, 10, "Fonts I've seen · List");
      await P.fill('#seen-search', 'serif');
      await P.waitForTimeout(400);
      await cap(P, F, 10.1, "Fonts I've seen · Search");
      await P.fill('#seen-search', '');
      await P.locator('button[aria-label="Stop recording 127.0.0.1"]').click();
      await P.waitForTimeout(400);
      await cap(P, F, 10.2, "Fonts I've seen · A site paused");
      await P.locator('button[aria-label="Record 127.0.0.1 again"]').click().catch(() => {});
      await back(P);
    });
    await step(F, 'Boards', async () => {
      await P.locator('.libtile', { hasText: 'Boards' }).click();
      await P.locator('button', { hasText: 'New board' }).first().click();
      await P.waitForSelector('input[aria-label="Board name"]');
      await cap(P, F, 11.2, 'New board');
      await P.fill('input[aria-label="Board name"]', 'Editorial picks');
      for (const f of ['Fraunces', 'Inter', 'Geist Mono']) await P.locator('.chips.addpills .chip', { hasText: f }).first().click().catch(() => {});
      await P.waitForSelector('canvas.cardcanvas', { timeout: 10000 });
      await P.waitForTimeout(1500);
      await cap(P, F, 11.3, 'Board editor with fonts');
      await P.locator('.bgpick button').nth(1).click().catch(() => {});
      await P.waitForTimeout(1200);
      await cap(P, F, 11.4, 'Board editor · Another background');
      await back(P);
      await P.waitForSelector('.boardcard', { timeout: 5000 });
      await cap(P, F, 11.5, 'Boards list');
      await back(P);
    });
    await step(F, 'Font share card', async () => {
      await P.locator('.lcard button[aria-label="Options for Fraunces"]').click();
      await P.locator('.lcard .cardmenu button', { hasText: 'Open details' }).click();
      await P.waitForSelector('h1.nm');
      await P.locator('.dhead button', { hasText: 'Share' }).click();
      await P.waitForSelector('canvas.cardcanvas', { timeout: 10000 });
      await P.waitForTimeout(1500);
      await cap(P, F, 12, 'Share card · Landscape, light');
      await P.locator('.seg button', { hasText: 'Portrait' }).click();
      await P.locator('.seg button', { hasText: 'Dark' }).click();
      await P.locator('textarea[aria-label="Card text"]').fill('Sphinx of black quartz, judge my vow');
      await P.locator('button[role="switch"][aria-label="Watermark"]').click();
      await P.waitForTimeout(1500);
      await cap(P, F, 12.1, 'Share card · Portrait, dark, own text, no watermark');
      await back(P);
      await P.waitForSelector('h1.nm');
      await back(P);
    });
    await step(F, 'Import and export', async () => {
      await P.locator('button[aria-label="More"]').click();
      await P.waitForSelector('.lmenu');
      await cap(P, F, 13, 'More menu · Import and export');
      const [dl] = await Promise.all([P.waitForEvent('download'), P.locator('.lmenu button', { hasText: 'Export library' }).click()]);
      await P.waitForTimeout(200);
      await cap(P, F, 13.1, 'Library exported', { wait: 100 });
      const backup = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
      backup.collections.push({ id: 999, name: 'Imported set', color: '#3346FF', createdAt: 1 });
      backup.savedFonts.push({ fontId: 'Lora::google', collectionIds: [999], notes: 'from a backup', sitesSeen: ['example.com'], createdAt: 1, updatedAt: 1 });
      backup.fonts.push({ id: 'Lora::google', family: 'Lora', source: 'google', kind: 'web', classification: 'serif', licenseType: 'OFL', designers: [], catalogFamily: 'Lora', displayName: 'Lora', updatedAt: 1 });
      const importFile = path.join(work, 'import.json');
      fs.writeFileSync(importFile, JSON.stringify(backup));
      await P.setInputFiles('input[aria-label="Import a library file"]', importFile);
      await P.waitForSelector('.toast', { timeout: 5000 }).catch(() => {});
      await cap(P, F, 13.2, 'Library imported', { wait: 100 });
    });
  }

  // ----------------------------------------------------------- Settings
  if (want('Settings')) {
    const F = 'Settings';
    await step(F, 'Main', async () => {
      await P.bringToFront();
      await tab(P, 'Page');
      await P.locator('button[aria-label="Settings"]').click();
      await P.waitForSelector('.settings');
      await cap(P, F, 1, 'Main');
    });
    await step(F, 'Options', async () => {
      const sw2 = (label) => P.locator(`button[role="switch"][aria-label="${label}"]`);
      await sw2("Fonts I've seen").click();
      await P.waitForTimeout(300);
      await cap(P, F, 2.1, "Fonts I've seen off");
      await sw2("Fonts I've seen").click();
      await sw2('How it works guide').click();
      await P.waitForTimeout(300);
      await cap(P, F, 2.2, 'How it works guide on');
      await sw2('How it works guide').click();
    });
    await step(F, 'Delete all data', async () => {
      await P.locator('button', { hasText: 'Delete all my data' }).click();
      await cap(P, F, 3, 'Delete all data · Confirm');
      await P.locator('.confirm button', { hasText: 'Cancel' }).click();
    });
    await step(F, 'Google Fonts key', async () => {
      await P.fill('input[aria-label="Google Fonts API key"]', 'AIzaSyD-example-key-0000000000000000');
      await P.locator('button[aria-label="Show key"]').click();
      await cap(P, F, 4, 'Google Fonts key · Typed and shown');
      await P.locator('.keyacts button', { hasText: 'Test key' }).click();
      await P.waitForSelector('.keyfield ~ .result, .result', { timeout: 20000 }).catch(() => {});
      await cap(P, F, 4.1, 'Google Fonts key · Tested');
      await P.fill('input[aria-label="Google Fonts API key"]', '');
    });
    await step(F, 'Dark', async () => {
      await P.locator('.themes button', { hasText: 'Dark' }).click();
      await P.waitForTimeout(400);
      await cap(P, F, 5, 'Main · Dark');
      await P.locator('.themes button', { hasText: 'System' }).click();
      await setTheme(P, 'light');
      await back(P);
    });
  }

  // ----------------------------------------------------------- Image
  if (want('Image')) {
    const F = 'Image';
    await P.bringToFront();
    await tab(P, 'Image');
    if (await P.locator('.ipic').count()) await useAnother(P);
    await step(F, 'Reading', async () => {
      await P.setInputFiles('input[aria-label="Upload an image"]', pics.heading);
      await P.waitForSelector('.ireading', { timeout: 15000 });
      await P.waitForFunction(() => Number(document.querySelector('.ireading .pctnum')?.textContent?.replace('%', '') ?? 0) > 5, null, { timeout: 30000 }).catch(() => {});
      await cap(P, F, 3, 'Reading the text', { wait: 50 });
    });
    await step(F, 'Picture loaded', async () => {
      await P.waitForSelector('.ocrline', { timeout: 120000 });
      await readingDone(P);
      await cap(P, F, 4, 'Picture loaded · Text found');
    });
    const adjust = async (order, state, fn) => step(F, state, async () => {
      await fn();
      // Each change reads the picture again, after a short pause.
      await P.waitForSelector('.ireading', { timeout: 2500 }).catch(() => {});
      await readingDone(P);
      await P.waitForTimeout(300);
      await readingDone(P);
      await cap(P, F, order, state);
      await P.locator('.iadj button', { hasText: 'Reset' }).click().catch(() => {});
      await P.waitForTimeout(300);
      await readingDone(P);
    });
    await adjust(5.1, 'Adjust · Crop', async () => {
      await P.locator('.itool', { hasText: 'Crop' }).click();
      const box = await P.locator('.ipic .istage canvas').first().boundingBox();
      await P.mouse.move(box.x + box.width * 0.05, box.y + box.height * 0.1);
      await P.mouse.down();
      await P.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.9, { steps: 6 });
      await P.mouse.up();
    });
    await adjust(5.2, 'Adjust · Perspective', async () => {
      await P.locator('.itool', { hasText: 'Perspective' }).click();
    });
    await adjust(5.3, 'Adjust · Turn 90°', async () => {
      await P.locator('.itool', { hasText: 'Turn 90°' }).click();
    });
    await adjust(5.4, 'Adjust · Invert', async () => {
      await P.locator('.itool', { hasText: 'Invert' }).click();
    });
    await adjust(5.5, 'Adjust · Sliders moved', async () => {
      await P.locator('.isl input[aria-label="Straighten"]').fill('4');
      await P.locator('.isl input[aria-label="Brightness"]').fill('18');
      await P.locator('.isl input[aria-label="Contrast"]').fill('35');
    });
    await step(F, 'Check the letters', async () => {
      await P.locator('button.ifold', { hasText: 'Check the letters' }).click();
      await P.waitForTimeout(300);
      await cap(P, F, 6, 'Text found · Check the letters open');
    });
    await step(F, 'Results for one font', async () => {
      await P.locator('button', { hasText: 'Find the fonts' }).click();
      await P.waitForSelector('.ires.match', { timeout: 90000 });
      await P.waitForFunction(() => /Has every letter|Missing \d+/.test(document.querySelector('.match')?.textContent ?? ''), null, { timeout: 15000 }).catch(() => {});
      await P.waitForTimeout(800);
      await cap(P, F, 7, 'Results for one font');
      if ((await P.locator('.ires.match .chip').count()) > 1) {
        await P.locator('.ires.match .chip').nth(1).click();
        await P.waitForTimeout(800);
        await cap(P, F, 7.1, 'Results for one font · Another match chosen');
      }
    });
    await step(F, 'Start with Recent', async () => {
      await useAnother(P);
      await P.waitForSelector('.histrow', { timeout: 5000 });
      await cap(P, F, 2, 'Start with Recent');
    });
    await step(F, 'Results for many fonts', async () => {
      await P.setInputFiles('input[aria-label="Upload an image"]', pics.post);
      await P.waitForSelector('#allfonts', { timeout: 120000 });
      await P.waitForFunction(() => document.querySelector('#allfonts') && !/Comparing letters|Matching…/.test(document.querySelector('#allfonts').textContent), null, { timeout: 180000 }).catch(() => {});
      await P.waitForTimeout(1500);
      await cap(P, F, 8, 'Results for many fonts');
      await useAnother(P);
    });
    await step(F, 'Fonts in this area', async () => {
      await page.evaluate(() => window.scrollTo(0, 0));
      await P.locator('button', { hasText: 'Select an area' }).click();
      await page.bringToFront();
      await page.waitForSelector('#ffp-select', { timeout: 5000 }).catch(() => {});
      const hb = await page.locator('h1').boundingBox();
      await page.mouse.move(hb.x - 4, hb.y - 4);
      await page.mouse.down();
      await page.mouse.move(hb.x + hb.width * 0.6, hb.y + hb.height * 0.5, { steps: 5 });
      await page.mouse.up();
      await P.waitForSelector('.ipic canvas', { timeout: 10000 }).catch(() => {});
      await P.bringToFront();
      await P.waitForSelector('.iexact', { timeout: 15000 });
      await P.waitForTimeout(800);
      await cap(P, F, 9, 'Fonts in this area (selected on the page)');
      await useAnother(P);
    });
    await step(F, 'No text found', async () => {
      await P.setInputFiles('input[aria-label="Upload an image"]', pics.blank);
      await P.waitForSelector('.inotext', { timeout: 120000 });
      await cap(P, F, 10, 'No text found');
      await useAnother(P);
    });
    await step(F, "Can't open the file", async () => {
      await P.setInputFiles('input[aria-label="Upload an image"]', pics.bad);
      await P.waitForSelector('.ifail', { timeout: 20000 });
      await cap(P, F, 11, "Can't open the file");
    });
  }

  // ----------------------------------------------------------- On the page
  if (want('On the page')) {
    const F = 'On the page';
    const OP = { rootSel: '#ffp-root' };
    const nameIs = (re) => page.waitForFunction((src) => new RegExp(src).test(document.getElementById('ffp-root').shadowRoot.querySelector('.name').textContent), re.source, { timeout: 8000 });
    await page.bringToFront();
    await page.evaluate(() => window.scrollTo(0, 0));
    await sw.evaluate(async (id) => chrome.tabs.sendMessage(id, { type: 'ffp:inspect', on: true }), tabId);
    await page.keyboard.press('Escape').catch(() => {});
    await sw.evaluate(async (id) => chrome.tabs.sendMessage(id, { type: 'ffp:inspect', on: true }), tabId);
    await page.mouse.move(1270, 790);
    await page.waitForTimeout(300);
    await shadowEval(page, (sr) => { sr.querySelector('.card').hidden = true; sr.querySelector('.hl').hidden = true; });
    await step(F, 'Dock', async () => {
      await cap(page, F, 1, 'Dock only', OP);
      await shadowEval(page, (sr) => sr.querySelector('.db[data-dock="inspect"]').classList.add('saytip'));
      await cap(page, F, 2, 'Dock · Tooltip showing', OP);
      await shadowEval(page, (sr) => sr.querySelector('.db[data-dock="inspect"]').classList.remove('saytip'));
      await shadowEval(page, (sr) => sr.querySelector('.db[data-dock="save"]').classList.add('saytip'));
      await cap(page, F, 2.1, 'Dock · Tooltip on Save the font', OP);
      await shadowEval(page, (sr) => sr.querySelector('.db[data-dock="save"]').classList.remove('saytip'));
    });
    const h1 = await page.locator('h1').boundingBox();
    await step(F, 'Tips', async () => {
      await sw.evaluate(async () => chrome.storage.local.set({ 'ffp:coachStep': 0 }));
      await page.waitForSelector('#ffp-root >> .coach:not([hidden])', { timeout: 5000 }).catch(() => {});
      await cap(page, F, 3.1, 'Tips · Step 1 of 3', OP);
      await page.mouse.move(h1.x + 40, h1.y + 20);
      await page.mouse.move(h1.x + 44, h1.y + 22);
      await page.waitForTimeout(500);
      await cap(page, F, 3.2, 'Tips · Step 2 of 3 (hover card)', OP);
      await page.mouse.click(h1.x + 44, h1.y + 22);
      await page.waitForTimeout(400);
      await cap(page, F, 3.3, 'Tips · Step 3 of 3 (pinned card)', OP);
      await sw.evaluate(async () => chrome.storage.local.set({ 'ffp:coachStep': 3 }));
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
    });
    await step(F, 'Hover card', async () => {
      await page.mouse.move(h1.x + 60, h1.y + 24);
      await page.mouse.move(h1.x + 64, h1.y + 26);
      await page.waitForTimeout(500);
      await cap(page, F, 4, 'Hover card (before pinning)', OP);
    });
    await step(F, 'Pinned card', async () => {
      await page.mouse.click(h1.x + 64, h1.y + 26);
      await page.waitForTimeout(400);
      await cap(page, F, 5, 'Pinned card', OP);
      await shadowEval(page, (sr) => sr.querySelector('.row[data-key="size"]').click());
      await page.waitForTimeout(120);
      await cap(page, F, 6, 'Pinned card · A value copied', { ...OP, wait: 60 });
      await page.waitForTimeout(1500);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
    });
    await step(F, 'Picture with text', async () => {
      await page.locator('#pic').scrollIntoViewIfNeeded();
      const pb = await page.locator('#pic').boundingBox();
      await page.mouse.move(pb.x + 200, pb.y + 40);
      await page.mouse.click(pb.x + 200, pb.y + 40);
      await nameIs(/^Picture with text$/);
      await page.waitForTimeout(400);
      await cap(page, F, 7.1, 'Picture card · Picture with text', OP);
      await page.mouse.click(pb.x + 200, pb.y + 40);
    });
    await step(F, 'Picture, no text', async () => {
      await page.locator('#plainpic').scrollIntoViewIfNeeded();
      const qb = await page.locator('#plainpic').boundingBox();
      await page.mouse.move(qb.x + 80, qb.y + 70);
      await page.mouse.move(qb.x + 84, qb.y + 72);
      await nameIs(/no text/);
      await page.waitForTimeout(300);
      await cap(page, F, 7.2, 'Picture card · No text', OP);
    });
    if (want('Image')) await step('Image', 'Identify a picture from the page', async () => {
      await page.locator('#pic').scrollIntoViewIfNeeded();
      const pb = await page.locator('#pic').boundingBox();
      await page.mouse.click(pb.x + 200, pb.y + 40);
      await nameIs(/^Picture with text$/);
      await shadowEval(page, (sr) => sr.querySelector('.identify').click());
      await P.waitForSelector('.ipic canvas', { timeout: 15000 });
      await P.bringToFront();
      await P.waitForSelector('.ocrline, #allfonts', { timeout: 120000 }).catch(() => {});
      await readingDone(P);
      await cap(P, 'Image', 12, 'Identify a picture from the page');
      await page.bringToFront();
    });
    await step(F, 'Paused dock', async () => {
      await sw.evaluate(async (id) => chrome.tabs.sendMessage(id, { type: 'ffp:inspect', on: true }), tabId);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.mouse.move(1270, 790);
      await shadowEval(page, (sr) => sr.querySelector('.db[data-dock="inspect"]').click());
      await page.waitForTimeout(300);
      await cap(page, F, 8, 'Paused dock', OP);
      await shadowEval(page, (sr) => sr.querySelector('.db[data-dock="inspect"]').classList.add('saytip'));
      await cap(page, F, 8.1, 'Paused dock · Tooltip', OP);
      await shadowEval(page, (sr) => { const b = sr.querySelector('.db[data-dock="inspect"]'); b.classList.remove('saytip'); b.click(); });
    });
    await step(F, 'Dock moved', async () => {
      await shadowEval(page, (sr) => { sr.querySelector('.card').hidden = true; sr.querySelector('.hl').hidden = true; });
      const g = await page.locator('#ffp-root >> .grip').boundingBox();
      await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
      await page.mouse.down();
      await page.mouse.move(260, 140, { steps: 8 });
      await page.mouse.up();
      await page.waitForTimeout(300);
      await shadowEval(page, (sr) => { sr.querySelector('.card').hidden = true; sr.querySelector('.hl').hidden = true; });
      await cap(page, F, 10, 'Dock moved', OP);
      await page.locator('#ffp-root >> .grip').dblclick();
    });
    skip(F, 'Dark', 'the dock and card on the page have one look (dark dock, white card); there is no dark mode to show');
  }
  await P.close();
} catch (e) {
  console.error('capture stopped:', e);
} finally {
  await ctx.close();
  server.kill();
}

// ------------------------------------------------------------- Figma plugin
if (want('Figma plugin')) {
  const F = 'Figma plugin';
  try {
    const payloadFile = [path.join(work, 'figma-payload.txt'), path.join(root, 'tests/output/figma-payload.txt')].find((f) => fs.existsSync(f));
    if (!payloadFile) throw new Error('no Figma payload: run the Page flow (or tests/run.mjs) first');
    const payloadText = fs.readFileSync(payloadFile, 'utf8');
    const payload = JSON.parse(payloadText.slice(payloadText.indexOf('\n') + 1));
    const code = fs.readFileSync(path.join(root, 'figma-plugin/dist/code.js'), 'utf8');
    const html = fs.readFileSync(path.join(root, 'figma-plugin/dist/ui.html'), 'utf8');

    // The plugin's real answers, from code.js on a fake Figma.
    const env = fakeFigma([...base]);
    await startPlugin(env, code);
    const [checked] = await run(env, { type: 'check', payload });
    const wenv = fakeFigma([...base, ...fontStyles('Fraunces', ['Semi Bold'])]);
    await startPlugin(wenv, code);
    await wenv.handStyle('Display', 'Fraunces', 'Semi Bold', 64, { unit: 'PIXELS', value: 68 }, { unit: 'PERCENT', value: -2 });
    await wenv.handStyle('Heading 2', 'Fraunces', 'Regular', 28, { unit: 'PERCENT', value: 120 }, { unit: 'PIXELS', value: -0.28 });
    await wenv.handStyle('Body', 'Inter', 'Regular', 17, { unit: 'AUTO' }, { unit: 'PERCENT', value: 0 });
    await wenv.handStyle('Label', 'Inter', 'Semi Bold', 13, { unit: 'PIXELS', value: 16 }, { unit: 'PIXELS', value: 0.13 });
    await wenv.handStyle('Caption', 'Inter', 'Regular', 12, { unit: 'PIXELS', value: 16 }, { unit: 'PERCENT', value: 0 });
    const [ws] = await run(wenv, { type: 'web-styles' });
    const fenv = fakeFigma([...base]);
    await startPlugin(fenv, code);
    await run(fenv, { type: 'check', payload });
    await run(fenv, { type: 'build', payload, choices: [], opts: { styles: true, variables: false, specimen: false, naming: 'role' } });
    const t1 = fenv.textLayer([['Stories ', 'Neue Haas Unica', 'Medium', 13], ['Gear', 'Neue Haas Unica', 'Bold', 13]]);
    const t2 = fenv.textLayer([['Walking the long way', 'Fraunces', 'Regular', 50]]);
    const t3 = fenv.textLayer([['const x = 1;', 'JetBrains Mono', 'Regular', 17]]);
    const t4 = fenv.textLayer([['Subscribe', 'Neue Haas Unica', 'Medium', 14]]);
    fenv.page.selection = [fenv.frameOf('Home · fieldjournal.example', [t1, t2, t3, t4])];
    const [scanned] = await run(fenv, { type: 'fix-scan' });
    const sc = scanned.result;
    const [fixedMsg] = await run(fenv, { type: 'fix-apply', map: { 'Neue Haas Unica': 'Arimo', 'JetBrains Mono': 'Geist Mono' }, link: true });
    const fx = fixedMsg.result;

    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 360, height: 640 } });
    await page.setContent(html);
    await page.evaluate(() => { document.addEventListener('copy', (e) => { window.__copied = e.target?.value ?? ''; }); });
    const tell = (m) => page.evaluate((x) => window.postMessage({ pluginMessage: x }, '*'), m);
    const paste = (t) => page.evaluate((x) => { const dt = new DataTransfer(); dt.setData('text/plain', x); document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true })); }, t);
    const dark = (on) => page.evaluate((d) => document.documentElement.classList.toggle('figma-dark', d), on);
    // The window scrolls inside; grow it so the whole screen shows, then snapshot.
    const shotP = async (order, state, { keepToast = false, withDark = false } = {}) => {
      if (!keepToast) await page.evaluate(() => { document.getElementById('toast').hidden = true; });
      for (const theme of withDark ? ['light', 'dark'] : ['light']) {
        await dark(theme === 'dark');
        await page.waitForTimeout(280);
        const extra = await page.evaluate(() => { const b = document.querySelector('#main .body'); return b ? Math.max(0, b.scrollHeight - b.clientHeight) : 0; });
        if (extra) await page.setViewportSize({ width: 360, height: 640 + extra });
        await cap(page, F, order + (theme === 'dark' ? 0.001 : 0), theme === 'dark' ? `${state} · Dark` : state, { fixedHeight: true, extraCss: '#main{height:{H}px}', wait: 200 });
        if (extra) await page.setViewportSize({ width: 360, height: 640 });
      }
      await dark(false);
    };
    const step2 = async (state, fn) => {
      try { await fn(); } catch (e) { skip(F, state, `failed: ${String(e?.message ?? e).split('\n')[0].slice(0, 200)}`); }
    };
    // The back button until Home (on Home the top bar's button is Settings).
    const goHome = async () => {
      for (let i = 0; i < 5; i++) {
        const at = await page.evaluate(() => document.querySelector('#main .body')?.dataset.screen);
        if (at === 'home') return;
        await page.evaluate(() => document.querySelector('.topbar .sqbtn[data-go]')?.click());
        await page.waitForTimeout(60);
      }
    };

    await tell({ type: 'init', saved: 2, standIns: { count: 2, styles: ['H1', 'Body'], fonts: ['Helvetica Neue LT Pro'] }, file: 'Northwind type', settings: { variables: true, specimen: true, naming: 'site' }, recent: ['ledgerly.example', 'northwind.example'], selection: { count: 0, name: '' } });
    await page.waitForSelector('#paste');
    await step2('Home', async () => shotP(1, 'Home', { withDark: true }));
    await step2('Still missing', async () => {
      await page.click('#recheck');
      await tell({ type: 'rechecked', result: { swapped: 0, still: ['Helvetica Neue LT Pro'], total: 2, standIns: { count: 2, styles: ['H1', 'Body'], fonts: ['Helvetica Neue LT Pro'] } } });
      await page.waitForTimeout(100);
      await shotP(1.5, 'Home · Still missing after Check again');
    });
    await step2('Settings', async () => {
      await page.click('[data-go="settings"]');
      await shotP(2, 'Settings');
      await goHome();
    });
    await step2('Paste', async () => {
      await page.click('#paste');
      await page.waitForTimeout(150);
      await shotP(3, 'Paste');
      await paste('hello');
      await page.waitForSelector('.alert');
      await shotP(3.1, 'Paste · Wrong paste', { keepToast: true });
      await page.click('#showmanual');
      await shotP(3.2, 'Paste box');
      await page.click('[data-go="paste"]');
    });
    await step2('Preview', async () => {
      await paste(payloadText);
      await page.waitForSelector('.fcard');
      await tell({ type: 'checked', status: checked.status });
      await page.waitForFunction(() => /Not in Figma/.test(document.querySelector('#main').textContent));
      await shotP(4, 'Preview', { withDark: true });
    });
    await step2('Type system', async () => {
      await page.click('[data-go="system"]');
      await shotP(5, 'Type system');
    });
    await step2('Stand-ins', async () => {
      await page.click('[data-go="standins"]');
      await shotP(6, 'Stand-ins');
      const hn = page.locator('.fcard', { hasText: 'Helvetica Neue LT Pro' });
      await hn.locator('[data-dd]').click();
      await shotP(6.1, 'Stand-ins · Menu open');
      await hn.locator('[data-pick][data-family="Arimo"]').click();
      await page.click('.foot [data-go="preview"]');
    });
    await step2('Creating', async () => {
      await page.click('#build');
      await tell({ type: 'progress', msg: 'Making text styles…' });
      await page.waitForTimeout(100);
      await shotP(7, 'Creating');
      await tell({ type: 'built', result: { styles: 7, variables: 12, page: 'p1', missing: ['Helvetica Neue LT Pro'] } });
      await page.waitForSelector('.donecard', { timeout: 5000 });
      await shotP(8, 'Done');
      await goHome();
    });
    await step2("Couldn't create", async () => {
      await paste(payloadText);
      await tell({ type: 'checked', status: checked.status });
      await page.click('#build');
      await tell({ type: 'error', msg: 'Cannot write to a read-only file', during: 'build' });
      await page.waitForSelector('.alert');
      await shotP(9, "Couldn't create the styles");
      await page.click('.foot [data-go="preview"]').catch(() => {});
      await goHome();
    });
    await step2('Fix a captured page', async () => {
      await page.click('[data-go="fix-select"]');
      await shotP(10, 'Fix a captured page · Select a frame');
      await tell({ type: 'selection', selection: { count: 1, name: 'Home · fieldjournal.example' } });
      await page.waitForFunction(() => !document.querySelector('#fixscan').disabled);
      await shotP(10.1, 'Fix a captured page · Frame selected');
      await page.click('#fixscan');
      await tell({ type: 'fix-scanned', result: sc });
      await page.waitForSelector('#fixapply');
      await shotP(11, 'Fix a captured page · Missing fonts', { withDark: true });
      await page.locator('.card.fg', { hasText: 'Neue Haas Unica' }).locator('[data-dd]').click();
      await shotP(11.1, 'Fix a captured page · Replacement menu open');
      await page.locator('.menu [data-pick]').first().click();
      await page.click('#fixapply');
      await tell({ type: 'fixed', result: fx });
      await page.waitForFunction(() => /Fixed/.test(document.querySelector('#main').textContent));
      await shotP(12, 'Fix a captured page · Fixed');
      await tell({ type: 'fix-scanned', result: { ...sc, fonts: [], layers: 0 } });
      await page.waitForTimeout(80);
      await shotP(13, 'Fix a captured page · Nothing to fix');
      await goHome();
    });
    await step2('See it on the web', async () => {
      await page.click('[data-go="web-styles"]');
      await tell({ type: 'web-styles', styles: [], file: 'Northwind type' });
      await page.waitForTimeout(80);
      await shotP(14, 'See it on the web · No text styles');
      await tell({ type: 'web-styles', styles: ws.styles, file: 'Northwind type' });
      await page.waitForSelector('.srow');
      await shotP(15, 'See it on the web · Styles and roles', { withDark: true });
      await page.locator('.srow', { hasText: 'Heading 2' }).locator('.rolebtn').click();
      await shotP(16, 'See it on the web · Role menu open');
      await page.click('[data-role][data-value="h2"]');
      await page.click('#web-next');
      await shotP(17, 'See it on the web · Pick a site');
      await page.fill('#site', 'ledgerly.example/pricing');
      await shotP(17.1, 'See it on the web · Site typed');
      await page.click('#copy');
      await page.waitForTimeout(120);
      await shotP(18, 'See it on the web · Copied');
    });
    await browser.close();
  } catch (e) {
    skip(F, 'all screens', `failed: ${String(e?.message ?? e).split('\n')[0]}`);
  }
}

finish();
