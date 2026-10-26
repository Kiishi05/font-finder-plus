import { useCallback, useEffect, useRef, useState } from 'react';
import { sendToExtension, sendToTab, type PingReply, type ScanReply, type ToExtension } from '../../shared/messages';
import { DEFAULT_SETTINGS, getSettings, hasAllSitesAccess, onSettingsChanged, setSettings, type Settings } from '../../shared/settings';
import type { ElementFontInfo, PageScan, SystemScan } from '../../shared/types';

export interface TabState {
  tabId: number | null;
  ping: PingReply | null;
  injectError: string | null;
  inspecting: boolean;
  pinned: ElementFontInfo | null;
  /** Goes up when the page starts using new fonts (lazy loading), so the scan refreshes. */
  fontsVersion: number;
  refresh: () => void;
}

/** Follows the active tab of this window and whether our script is running in it. */
export function useActiveTab(): TabState {
  const [tabId, setTabId] = useState<number | null>(null);
  const [ping, setPing] = useState<PingReply | null>(null);
  const [injectError, setInjectError] = useState<string | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const [pinned, setPinned] = useState<ElementFontInfo | null>(null);
  const [fontsVersion, setFontsVersion] = useState(0);
  const tabRef = useRef<number | null>(null);

  const check = useCallback(async (id: number | null) => {
    if (id == null) return;
    const p = await sendToTab<PingReply>(id, { type: 'ffp:ping' }, 800);
    if (tabRef.current !== id) return;
    setPing(p);
    setInspecting(!!p?.inspecting);
    const key = `injectError:${id}`;
    const st = await chrome.storage.session.get(key).catch(() => ({} as Record<string, string>));
    setInjectError(p ? null : (st[key] as string | undefined) ?? null);
  }, []);

  const follow = useCallback(async () => {
    // ?tab=<id> pins the panel to one tab. Used by the automated tests, which
    // open the panel as a normal page.
    const forced = Number(new URLSearchParams(location.search).get('tab'));
    const [tab] = forced ? [{ id: forced }] : await chrome.tabs.query({ active: true, currentWindow: true });
    const id = tab?.id ?? null;
    const prev = tabRef.current;
    tabRef.current = id;
    setTabId(id);
    setPinned(null);
    // Switching tabs moves the inspector: off in the tab you left, on in the
    // tab you opened (when the extension may run there).
    if (!forced && prev != null && id != null && prev !== id) {
      sendToTab(prev, { type: 'ffp:inspect', on: false }, 500);
      sendToTab(prev, { type: 'ffp:highlight', key: null }, 500);
      const p = await sendToTab<PingReply>(id, { type: 'ffp:ping' }, 600);
      if (p) {
        if (!p.inspecting) await sendToTab(id, { type: 'ffp:inspect', on: true });
      } else if (await hasAllSitesAccess()) {
        await sendToExtension({ type: 'ffp:inject', tabId: id, startInspecting: true });
      }
    }
    check(id);
  }, [check]);

  useEffect(() => {
    follow();
    const onActivated = () => follow();
    const onUpdated = (id: number, info: chrome.tabs.TabChangeInfo) => {
      if (id !== tabRef.current) return;
      if (info.status === 'loading') {
        setPing(null);
        setInspecting(false);
        setPinned(null);
      }
      if (info.status === 'complete') {
        // A new page loaded in this tab. With access to all sites, read it right
        // away; otherwise the panel explains what to click.
        (async () => {
          const p = await sendToTab<PingReply>(id, { type: 'ffp:ping' }, 600);
          if (!p && (await hasAllSitesAccess())) await sendToExtension({ type: 'ffp:inject', tabId: id, startInspecting: true });
          check(id);
        })();
      }
    };
    const onMsg = (msg: ToExtension, sender: chrome.runtime.MessageSender) => {
      if (sender.tab?.id !== tabRef.current) return;
      if (msg.type === 'ffp:inspector-state') {
        setInspecting(msg.on);
        check(tabRef.current);
      }
      if (msg.type === 'ffp:pinned') setPinned(msg.info);
      if (msg.type === 'ffp:page-changed') check(tabRef.current);
      if (msg.type === 'ffp:fonts-changed') setFontsVersion((v) => v + 1);
    };
    const onSession = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'session' && tabRef.current != null && changes[`injectError:${tabRef.current}`]) check(tabRef.current);
    };
    chrome.tabs.onActivated.addListener(onActivated);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.runtime.onMessage.addListener(onMsg);
    chrome.storage.onChanged.addListener(onSession);
    return () => {
      chrome.tabs.onActivated.removeListener(onActivated);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.runtime.onMessage.removeListener(onMsg);
      chrome.storage.onChanged.removeListener(onSession);
    };
  }, [follow, check]);

  return { tabId, ping, injectError, inspecting, pinned, fontsVersion, refresh: () => check(tabRef.current) };
}

// One scan per tab and address, shared by the Page and System tabs.
const scanCache = new Map<string, PageScan>();
const systemCache = new Map<string, SystemScan>();

/** Keep each tab's latest scan for this browser session, for Compare. */
function remember(tabId: number, scan: PageScan, system?: SystemScan) {
  const key = `compare:${tabId}`;
  chrome.storage.session.get(key).then((st) => {
    const prev = (st[key] as { system?: SystemScan } | undefined) ?? {};
    chrome.storage.session.set({ [key]: { scan, system: system ?? prev.system ?? null, savedAt: Date.now() } }).catch(() => undefined);
  });
}

export function usePageScan(tabId: number | null, ready: boolean, url: string | undefined, version = 0) {
  const cacheKey = `${tabId}|${url}|${version}`;
  const [scan, setScan] = useState<PageScan | null>(() => scanCache.get(cacheKey) ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    if (tabId == null || !ready) return;
    setLoading(true);
    setError(null);
    const r = await sendToTab<ScanReply>(tabId, { type: 'ffp:scan' }, 30000);
    setLoading(false);
    if (!r) setError('The page did not answer. Reload the page and try again.');
    else if (!r.ok) setError(r.error);
    else {
      scanCache.set(`${tabId}|${url}|${version}`, r.scan);
      remember(tabId, r.scan);
      setScan(r.scan);
    }
  }, [tabId, ready, url, version]);

  useEffect(() => {
    const cached = scanCache.get(cacheKey);
    // Keep showing the last scan of the same page while a refresh runs.
    if (cached) setScan(cached);
    else if (!version) setScan(null);
    if (ready && !cached) run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, ready, cacheKey]);

  return { scan, loading, error, rescan: run };
}

export function useSystemScan(tabId: number | null, ready: boolean, url: string | undefined, scan: PageScan | null, version = 0) {
  const cacheKey = `${tabId}|${url}|${version}`;
  const [system, setSystem] = useState<SystemScan | null>(() => systemCache.get(cacheKey) ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async () => {
    if (tabId == null || !ready) return;
    setLoading(true);
    setError(null);
    const r = await sendToTab<{ ok: boolean; system?: SystemScan; error?: string }>(tabId, { type: 'ffp:system' }, 30000);
    setLoading(false);
    if (!r) setError('The page did not answer. Reload the page and try again.');
    else if (!r.ok || !r.system) setError(r.error ?? 'Could not read the page.');
    else {
      systemCache.set(`${tabId}|${url}|${version}`, r.system);
      if (scan) remember(tabId, scan, r.system);
      setSystem(r.system);
    }
  }, [tabId, ready, url, scan, version]);
  useEffect(() => {
    const cached = systemCache.get(cacheKey);
    setSystem(cached ?? null);
    if (ready && !cached && scan) run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, cacheKey, !!scan]);
  return { system, loading, error, rerun: run };
}

export function useSettings(): [Settings, (p: Partial<Settings>) => void] {
  const [s, setS] = useState<Settings>(DEFAULT_SETTINGS);
  useEffect(() => {
    getSettings().then(setS);
    return onSettingsChanged((patch) => setS((prev) => ({ ...prev, ...patch })));
  }, []);
  const update = useCallback((p: Partial<Settings>) => {
    setS((prev) => ({ ...prev, ...p }));
    setSettings(p);
  }, []);
  return [s, update];
}

export function useToast(): [string | null, (msg: string) => void] {
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef<number>();
  const show = useCallback((m: string) => {
    setMsg(m);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMsg(null), 1600);
  }, []);
  return [msg, show];
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}
