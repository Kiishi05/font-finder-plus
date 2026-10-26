import { googleFamily } from '../shared/catalog';
import { saveFont } from '../shared/db';
import { arrayBufferToBase64, sendToTab, type PingReply, type ToExtension } from '../shared/messages';
import { recordFromInfo, sampleFromInfo } from '../shared/records';

const MENU_ID = 'ffp-inspect';

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: 'Inspect fonts on this page',
    contexts: ['page', 'selection', 'link', 'image'],
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
    const error = /cannot access|cannot be scripted|chrome:\/\/|extensions gallery/i.test(String(err))
      ? 'Chrome does not let extensions read this page (for example chrome:// pages, the Chrome Web Store and PDF viewer).'
      : 'Could not start on this page. Reload the page and try again.';
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

chrome.action.onClicked.addListener((tab) => {
  if (tab.id == null) return;
  // Open the side panel first, while Chrome still counts this as a user gesture.
  chrome.sidePanel.open({ tabId: tab.id }).catch(() => undefined);
  toggleInspector(tab.id);
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID || tab?.id == null) return;
  chrome.sidePanel.open({ tabId: tab.id }).catch(() => undefined);
  toggleInspector(tab.id, true);
});

chrome.runtime.onMessage.addListener((msg: ToExtension | { type: 'ffp:fetch-bg'; url: string; as: 'text' | 'base64' }, sender, reply) => {
  switch (msg.type) {
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
