import { hasText } from '../shared/textdetect';
import { explainInjectError } from '../shared/pageaccess';
import { googleFamily } from '../shared/catalog';
import { saveFont } from '../shared/db';
import { arrayBufferToBase64, sendToTab, type PingReply, type ToExtension } from '../shared/messages';
import { recordFromInfo, sampleFromInfo } from '../shared/records';

const MENU_ID = 'ffp-inspect';
const IMAGE_MENU_ID = 'ffp-identify-image';

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: 'Inspect fonts on this page',
    contexts: ['page', 'selection', 'link'],
  });
  chrome.contextMenus.create({
    id: IMAGE_MENU_ID,
    title: 'Identify the font in this image',
    contexts: ['image'],
  });
});

async function ensureInjected(tabId: number): Promise<{ ok: boolean; inspecting: boolean; error?: string }> {
  const ping = await sendToTab<PingReply>(tabId, { type: 'ffp:ping' }, 600);
  if (ping) return { ok: true, inspecting: ping.inspecting };
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    await chrome.storage.session.remove(`injectError:${tabId}`);
    return { ok: true, inspecting: false };
  } catch (err) {
    const url = await chrome.tabs.get(tabId).then((t) => t.url, () => undefined);
    const fileAccess = await chrome.extension.isAllowedFileSchemeAccess().catch(() => false);
    const error = explainInjectError(String(err), url, fileAccess);
    await chrome.storage.session.set({ [`injectError:${tabId}`]: error });
    return { ok: false, inspecting: false, error };
  }
}

async function toggleInspector(tabId: number, forceOn?: boolean) {
  const state = await ensureInjected(tabId);
  if (!state.ok) return state;
  const on = forceOn ?? !state.inspecting;
  await sendToTab(tabId, { type: 'ffp:inspect', on });
  return { ok: true, inspecting: on };
}

// Windows whose side panel is open (the panel keeps a port connected).
const openPanels = new Set<number>();
// Windows whose panel was closed from the dock's panel button: keep the dock then.
const keepDock = new Map<number, number>();

chrome.runtime.onConnect.addListener((port) => {
  const m = /^ffp-panel:(\d+)$/.exec(port.name);
  if (!m) return;
  const windowId = Number(m[1]);
  openPanels.add(windowId);
  tellTabs(windowId, true);
  port.onDisconnect.addListener(async () => {
    openPanels.delete(windowId);
    // Give a reconnect (background restart) a moment before treating it as closed.
    await new Promise((r) => setTimeout(r, 600));
    if (openPanels.has(windowId)) return;
    tellTabs(windowId, false);
    // Closing the panel with its X turns Font Finder Plus off on the page too,
    // unless the dock's own panel button closed it (then only the panel goes).
    const kept = keepDock.get(windowId);
    keepDock.delete(windowId);
    if (kept && Date.now() - kept < 3000) return;
    const tabs = await chrome.tabs.query({ windowId });
    for (const t of tabs) if (t.id != null) sendToTab(t.id, { type: 'ffp:inspect', on: false }, 500);
  });
});

/** Let the dock on each page in the window show whether the side panel is open. */
async function tellTabs(windowId: number, open: boolean) {
  const tabs = await chrome.tabs.query({ windowId });
  for (const t of tabs) {
    if (t.id == null) continue;
    sendToTab(t.id, { type: 'ffp:panel-state', open }, 500);
    if (!open) sendToTab(t.id, { type: 'ffp:highlight', key: null }, 500);
  }
}

chrome.action.onClicked.addListener(async (tab) => {
  if (tab.id == null) return;
  // The icon (and Alt + Shift + F) turns the dock on the page on and off.
  // The side panel opens from the dock, not by itself.
  const state = await toggleInspector(tab.id);
  // A page Chrome keeps extensions off (new tab, Web Store): open the panel so it can explain.
  if (!state.ok) chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => undefined);
});

// A new page in a tab: forget any "cannot read this page" message from the last one.
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === 'loading') chrome.storage.session.remove(`injectError:${tabId}`).catch(() => undefined);
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === IMAGE_MENU_ID && tab?.id != null) {
    chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => undefined);
    // The side panel picks this up and opens Identify with the image.
    chrome.storage.session.set({ 'identify:pending': { srcUrl: info.srcUrl, tabId: tab.id, pageUrl: info.pageUrl, at: Date.now() } });
    ensureInjected(tab.id);
    return;
  }
  if (info.menuItemId !== MENU_ID || tab?.id == null) return;
  toggleInspector(tab.id, true);
});

/** Does this area of the visible tab contain text? Screenshot, crop, quick check. */
async function pictureHasText(windowId: number, r: { x: number; y: number; w: number; h: number; dpr: number }): Promise<boolean> {
  const url = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
  const bmp = await createImageBitmap(await (await fetch(url)).blob());
  const k = 1; // the screenshot is in device pixels
  const sx = Math.round(r.x * r.dpr * k), sy = Math.round(r.y * r.dpr * k);
  const sw = Math.max(1, Math.round(r.w * r.dpr * k)), sh = Math.max(1, Math.round(r.h * r.dpr * k));
  const c = new OffscreenCanvas(sw, sh);
  const ctx = c.getContext('2d')!;
  ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, sw, sh);
  return hasText(ctx.getImageData(0, 0, sw, sh));
}

chrome.runtime.onMessage.addListener((msg: ToExtension | { type: 'ffp:fetch-bg'; url: string; as: 'text' | 'base64' } | { type: 'ffp:picture-text'; rect: { x: number; y: number; w: number; h: number; dpr: number } }, sender, reply) => {
  switch (msg.type) {
    case 'ffp:open-panel': {
      const windowId = sender.tab?.windowId;
      if (windowId == null) return void reply({ ok: false });
      // Open at once: Chrome only allows it while the click on the dock still counts.
      chrome.sidePanel.open({ windowId }).catch(() => undefined);
      if (msg.view) chrome.storage.session.set({ 'panel:request': { view: msg.view, select: !!msg.select, family: msg.family, at: Date.now() } });
      reply({ ok: true });
      return false;
    }
    case 'ffp:close-panel-request':
      if (sender.tab?.windowId != null) keepDock.set(sender.tab.windowId, Date.now());
      chrome.runtime.sendMessage({ type: 'ffp:close-panel' }, () => void chrome.runtime.lastError);
      reply({ ok: true });
      return false;
    case 'ffp:panel-open?':
      reply({ open: sender.tab?.windowId != null && openPanels.has(sender.tab.windowId) });
      return false;
    case 'ffp:picture-text': {
      const windowId = sender.tab?.windowId;
      if (windowId == null) return void reply({ ok: false });
      pictureHasText(windowId, msg.rect)
        .then((has) => reply({ ok: true, hasText: has }))
        .catch(() => reply({ ok: false }));
      return true;
    }
    case 'ffp:save-from-page': {
      const site = safeHost(msg.pageUrl);
      const rec = recordFromInfo(msg.info, msg.fileUrl, msg.files ?? []);
      rec.designers = googleFamily(msg.info.family)?.d ?? [];
      saveFont(rec, site, sampleFromInfo(msg.info))
        .then(() => reply({ ok: true }))
        .catch(() => reply({ ok: false }));
      return true;
    }
    case 'ffp:fetch-bg':
      fetchWithPermission(msg.url, msg.as).then(reply);
      return true;
    case 'ffp:identify-rect':
      // From the hover card on a picture: the side panel (open while inspecting) takes it from here.
      if (sender.tab?.id != null) chrome.storage.session.set({ 'identify:pending': { rect: msg.rect, tabId: sender.tab.id, pageUrl: msg.pageUrl, context: Array.isArray(msg.context) ? msg.context.slice(0, 80) : [], at: Date.now() } });
      reply({ ok: true });
      return false;
    case 'ffp:inject':
      toggleInspector(msg.tabId, msg.startInspecting).then(reply);
      return true;
  }
  void sender;
  return false;
});

async function fetchWithPermission(url: string, as: 'text' | 'base64') {
  const allowed = await chrome.permissions.contains({ origins: ['<all_urls>'] });
  if (!allowed) return { ok: false, error: 'no-permission' };
  try {
    const res = await fetch(url, { credentials: 'omit' });
    if (!res.ok) return { ok: false, error: `The server answered ${res.status}.` };
    if (as === 'text') return { ok: true, text: await res.text() };
    const buf = await res.arrayBuffer();
    if (buf.byteLength > 4 * 1024 * 1024) return { ok: false, error: 'The font file is larger than 4 MB.' };
    return { ok: true, base64: arrayBufferToBase64(buf) };
  } catch {
    return { ok: false, error: 'The file could not be downloaded.' };
  }
}

function safeHost(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}
