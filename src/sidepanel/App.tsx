import { useEffect, useRef, useState } from 'react';
import { ArrowUp01Icon, Settings02Icon } from '../shared/icons';
import type { PageFontUsage } from '../shared/types';
import { Icon } from './components/Icon';
import { DEFAULT_TESTER, type TesterState } from './components/Tester';
import { useActiveTab, useSettings, useToast } from './lib/hooks';
import { FontDetail } from './views/FontDetail';
import { LibraryView } from './views/LibraryView';
import { PageView } from './views/PageView';
import { SettingsView } from './views/SettingsView';
import { SystemView } from './views/SystemView';
import { IdentifyView, type IdentifyRequest } from './views/IdentifyView';
import { ShareView } from './views/ShareView';
import { SiteShareView } from './views/SiteShareView';
import { BoardEditor, BoardsView } from './views/BoardsView';
import { SeenView } from './views/SeenView';

export type View =
  | { name: 'page' }
  | { name: 'library' }
  | { name: 'system' }
  | { name: 'image' }
  | { name: 'boards' }
  | { name: 'seen' }
  | { name: 'board'; id: number }
  | { name: 'share'; fontId: string; back: View }
  | { name: 'siteshare' }
  | { name: 'settings' }
  | { name: 'detail'; fontId: string; usage?: PageFontUsage; from: 'page' | 'library' | 'image'; /** The page it was opened from: leaving it closes the details. */ pageUrl?: string; tabId?: number | null };

/** Written by the dock on the web page, then the panel opens: which view to show. */
interface PanelRequest {
  view: 'page' | 'system' | 'image' | 'detail';
  select?: boolean;
  family?: string;
  at: number;
}

export function App() {
  const [view, setView] = useState<View>({ name: 'page' });
  const imageScroll = useRef(0);
  // Settings is a sub page: Back returns to the view it was opened from.
  const settingsBack = useRef<View>({ name: 'page' });
  const [settings, updateSettings] = useSettings();
  const tab = useActiveTab();
  const [toast, showToast] = useToast();
  const [tester, setTester] = useState<TesterState>(DEFAULT_TESTER);
  const [libTester, setLibTester] = useState<TesterState>({ ...DEFAULT_TESTER, mode: 'names', size: 36 });

  // Right-click "Identify the font in this image" opens the Image tab with that image.
  const [pending, setPending] = useState<IdentifyRequest | null>(null);
  const lastHost = useRef<string | null | undefined>(undefined);
  const pendingAt = useRef(0);
  useEffect(() => {
    const take = (v: unknown) => {
      const p = v as (IdentifyRequest & { at: number }) | undefined;
      if (p && Date.now() - p.at < 60000) {
        pendingAt.current = Date.now();
        setPending(p);
        setView({ name: 'image' });
      }
    };
    chrome.storage.session.get('identify:pending').then((st) => take(st['identify:pending']));
    const on = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'session' && changes['identify:pending']?.newValue) take(changes['identify:pending'].newValue);
    };
    chrome.storage.onChanged.addListener(on);
    return () => chrome.storage.onChanged.removeListener(on);
  }, []);

  // The dock on the page asks for a view (Every font, Type system, Read an area, a font's details).
  const [openFamily, setOpenFamily] = useState<{ family: string; at: number } | null>(null);
  const [selectNow, setSelectNow] = useState(0);
  useEffect(() => {
    const take = (v: unknown) => {
      const r = v as PanelRequest | undefined;
      if (!r || typeof r.at !== 'number' || Date.now() - r.at > 10000) return;
      chrome.storage.session.remove('panel:request');
      // Keep the view when the tab changes right after (the dock opened the panel on that tab).
      pendingAt.current = Date.now();
      if (r.view === 'detail') {
        setView({ name: 'page' });
        setOpenFamily(r.family ? { family: r.family, at: Date.now() } : null);
      } else if (r.view === 'image') {
        setView({ name: 'image' });
        if (r.select) setSelectNow(Date.now());
      } else if (r.view === 'system' || r.view === 'page') {
        setView(r.view === 'system' ? { name: 'system' } : { name: 'page' });
      }
    };
    chrome.storage.session.get('panel:request').then((st) => take(st['panel:request']));
    const on = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'session' && changes['panel:request']?.newValue) take(changes['panel:request'].newValue);
    };
    chrome.storage.onChanged.addListener(on);
    return () => chrome.storage.onChanged.removeListener(on);
  }, []);

  // The dock's "Close the panel".
  useEffect(() => {
    const on = (msg: unknown) => {
      if ((msg as { type?: string } | null)?.type === 'ffp:close-panel') window.close();
    };
    chrome.runtime.onMessage.addListener(on);
    return () => chrome.runtime.onMessage.removeListener(on);
  }, []);

  useEffect(() => {
    const el = document.documentElement;
    if (settings.theme === 'system') el.removeAttribute('data-theme');
    else el.setAttribute('data-theme', settings.theme);
  }, [settings.theme]);

  // Moving to another website (in this tab or by switching tabs) shows that site's Page view, from any view.
  const lastTab = useRef<number | null | undefined>(undefined);
  useEffect(() => {
    const host = tab.ping?.host ?? null;
    const moved = lastTab.current !== undefined && (tab.tabId !== lastTab.current || host !== lastHost.current);
    // Right-click "Identify the font in this image" on another tab opens Image, not Page.
    if (moved && Date.now() - pendingAt.current > 3000) setView({ name: 'page' });
    lastTab.current = tab.tabId;
    lastHost.current = host;
  }, [tab.tabId, tab.ping?.host]);

  // A font's details from a page belong to that page: on another tab or site, show that page instead.
  useEffect(() => {
    if (view.name !== 'detail' || !view.pageUrl) return;
    const sameTab = view.tabId === tab.tabId;
    const samePage = !tab.ping?.url || stripHash(tab.ping.url) === stripHash(view.pageUrl);
    if (!sameTab || !samePage) setView(view.from === 'image' ? { name: 'image' } : { name: 'page' });
  }, [tab.tabId, tab.ping?.url]); // eslint-disable-line react-hooks/exhaustive-deps

  const top = view.name === 'detail' ? view.from : view.name === 'boards' || view.name === 'board' || view.name === 'seen' ? 'library' : view.name === 'share' ? 'library' : view.name === 'siteshare' ? 'page' : view.name;
  const fullScreen = view.name === 'detail' || view.name === 'settings' || view.name === 'seen' || view.name === 'boards' || view.name === 'board' || view.name === 'share' || view.name === 'siteshare';

  return (
    <div className="app">
      {!fullScreen && (
        <div className="topbar">
          <nav className="tabs" aria-label="Sections">
            <button aria-current={top === 'page' ? 'page' : undefined} onClick={() => setView({ name: 'page' })}>Page</button>
            <button aria-current={top === 'image' ? 'page' : undefined} onClick={() => setView({ name: 'image' })}>Image</button>
            <button aria-current={top === 'system' ? 'page' : undefined} onClick={() => setView({ name: 'system' })}>System</button>
            <button aria-current={top === 'library' ? 'page' : undefined} onClick={() => setView({ name: 'library' })}>Library</button>
          </nav>
          <button className="iconbtn" aria-label="Settings" onClick={() => { settingsBack.current = view; setView({ name: 'settings' }); }}>
            <Icon icon={Settings02Icon} />
          </button>
        </div>
      )}

      {view.name === 'page' && (
        <PageView tab={tab} tester={tester} onTester={setTester} onOpen={(usage, fontId) => setView({ name: 'detail', fontId, usage, from: 'page', pageUrl: tab.ping?.url, tabId: tab.tabId })} onShare={() => setView({ name: 'siteshare' })} toast={showToast} openFamily={openFamily} onOpenFamilyDone={() => setOpenFamily(null)} />
      )}
      {view.name === 'library' && (
        <LibraryView tester={libTester} onTester={setLibTester} onOpen={(fontId) => setView({ name: 'detail', fontId, from: 'library' })} onBoards={() => setView({ name: 'boards' })} onSeen={() => setView({ name: 'seen' })} toast={showToast} />
      )}
      {view.name === 'system' && <SystemView tab={tab} toast={showToast} />}
      {/* Kept open behind a font's details, so going back keeps the image and its results. */}
      {(view.name === 'image' || (view.name === 'detail' && view.from === 'image')) && (
        <div className="viewstack" hidden={view.name !== 'image'}>
          <IdentifyView
            tab={tab}
            pending={pending}
            onPendingUsed={() => { setPending(null); chrome.storage.session.remove('identify:pending'); }}
            onOpenFont={(usage, fontId) => { imageScroll.current = window.scrollY; setView({ name: 'detail', fontId, usage, from: 'image' }); }}
            onOpenFontId={(fontId) => { imageScroll.current = window.scrollY; setView({ name: 'detail', fontId, from: 'image' }); }}
            toast={showToast}
            selectNow={selectNow}
          />
        </div>
      )}
      {view.name === 'settings' && <SettingsView settings={settings} update={updateSettings} toast={showToast} onBack={() => setView(settingsBack.current)} onOpenSeen={() => setView({ name: 'seen' })} />}
      {view.name === 'detail' && (
        <FontDetail
          fontId={view.fontId}
          usage={view.usage}
          tabId={tab.tabId}
          pageHost={tab.ping?.host ?? null}
          onBack={() => {
            setView(view.from === 'page' ? { name: 'page' } : view.from === 'image' ? { name: 'image' } : { name: 'library' });
            if (view.from === 'image') requestAnimationFrame(() => window.scrollTo(0, imageScroll.current));
          }}
          onShare={(fontId) => setView({ name: 'share', fontId, back: view })}
          pageUrl={tab.ping?.url}
          scanVersion={tab.fontsVersion}
          toast={showToast}
        />
      )}
      {view.name === 'seen' && <SeenView settings={settings} update={updateSettings} host={tab.ping?.host ?? null} onBack={() => setView({ name: 'library' })} onOpenFontId={(fontId) => setView({ name: 'detail', fontId, from: 'library' })} toast={showToast} />}
      {view.name === 'boards' && <BoardsView onBack={() => setView({ name: 'library' })} onOpen={(id) => setView({ name: 'board', id })} />}
      {view.name === 'board' && <BoardEditor id={view.id} onBack={() => setView({ name: 'boards' })} toast={showToast} />}
      {view.name === 'siteshare' && <SiteShareView tab={tab} onBack={() => setView({ name: 'page' })} toast={showToast} />}
      {view.name === 'share' && <ShareView fontId={view.fontId} onBack={() => setView(view.back)} toast={showToast} />}
      <BackToTop />
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

const stripHash = (u: string) => u.replace(/#.*$/, '');

/** Floating button that appears after scrolling down. */
function BackToTop() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const on = () => setShow(window.scrollY > 500);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);
  if (!show) return null;
  return (
    <button className="totop" aria-label="Back to top" title="Back to top" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
      <Icon icon={ArrowUp01Icon} size={18} />
    </button>
  );
}
