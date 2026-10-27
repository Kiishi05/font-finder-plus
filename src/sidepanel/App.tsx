import { useEffect, useState } from 'react';
import { BRAND } from '../shared/brand';
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

export type View =
  | { name: 'page' }
  | { name: 'library' }
  | { name: 'system' }
  | { name: 'image' }
  | { name: 'boards' }
  | { name: 'board'; id: number }
  | { name: 'share'; fontId: string; back: View }
  | { name: 'siteshare' }
  | { name: 'settings' }
  | { name: 'detail'; fontId: string; usage?: PageFontUsage; from: 'page' | 'library' };

export function App() {
  const [view, setView] = useState<View>({ name: 'page' });
  const [settings, updateSettings] = useSettings();
  const tab = useActiveTab();
  const [toast, showToast] = useToast();
  const [tester, setTester] = useState<TesterState>(DEFAULT_TESTER);
  const [libTester, setLibTester] = useState<TesterState>({ ...DEFAULT_TESTER, size: 36 });

  // Right-click "Identify the font in this image" opens the Image tab with that image.
  const [pending, setPending] = useState<IdentifyRequest | null>(null);
  useEffect(() => {
    const take = (v: unknown) => {
      const p = v as (IdentifyRequest & { at: number }) | undefined;
      if (p && Date.now() - p.at < 60000) {
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

  useEffect(() => {
    const el = document.documentElement;
    if (settings.theme === 'system') el.removeAttribute('data-theme');
    else el.setAttribute('data-theme', settings.theme);
  }, [settings.theme]);

  const top = view.name === 'detail' ? view.from : view.name === 'boards' || view.name === 'board' ? 'library' : view.name === 'share' ? 'library' : view.name === 'siteshare' ? 'page' : view.name;
  const fullScreen = view.name === 'detail' || view.name === 'boards' || view.name === 'board' || view.name === 'share' || view.name === 'siteshare';

  return (
    <div className="app">
      {!fullScreen && (
        <div className="topbar">
          <div className="brand">{BRAND.shortName}</div>
          <nav className="tabs" aria-label="Sections">
            <button aria-current={top === 'page' ? 'page' : undefined} onClick={() => setView({ name: 'page' })}>Page</button>
            <button aria-current={top === 'image' ? 'page' : undefined} onClick={() => setView({ name: 'image' })}>Image</button>
            <button aria-current={top === 'system' ? 'page' : undefined} onClick={() => setView({ name: 'system' })}>System</button>
            <button aria-current={top === 'library' ? 'page' : undefined} onClick={() => setView({ name: 'library' })}>Library</button>
          </nav>
          <button className="iconbtn" aria-label="Settings" aria-current={view.name === 'settings' ? 'page' : undefined} onClick={() => setView(view.name === 'settings' ? { name: 'page' } : { name: 'settings' })}>
            <Icon icon={Settings02Icon} />
          </button>
        </div>
      )}

      {view.name === 'page' && (
        <PageView tab={tab} tester={tester} onTester={setTester} onOpen={(usage, fontId) => setView({ name: 'detail', fontId, usage, from: 'page' })} onShare={() => setView({ name: 'siteshare' })} toast={showToast} />
      )}
      {view.name === 'library' && (
        <LibraryView tester={libTester} onTester={setLibTester} onOpen={(fontId) => setView({ name: 'detail', fontId, from: 'library' })} onBoards={() => setView({ name: 'boards' })} toast={showToast} />
      )}
      {view.name === 'system' && <SystemView tab={tab} toast={showToast} />}
      {view.name === 'image' && (
        <IdentifyView tab={tab} pending={pending} onPendingUsed={() => { setPending(null); chrome.storage.session.remove('identify:pending'); }} onOpenFont={(usage, fontId) => setView({ name: 'detail', fontId, usage, from: 'page' })} toast={showToast} />
      )}
      {view.name === 'settings' && <SettingsView settings={settings} update={updateSettings} toast={showToast} />}
      {view.name === 'detail' && (
        <FontDetail
          fontId={view.fontId}
          usage={view.usage}
          tabId={tab.tabId}
          pageHost={tab.ping?.host ?? null}
          onBack={() => setView(view.from === 'page' ? { name: 'page' } : { name: 'library' })}
          onShare={(fontId) => setView({ name: 'share', fontId, back: view })}
          pageUrl={tab.ping?.url}
          scanVersion={tab.fontsVersion}
          toast={showToast}
        />
      )}
      {view.name === 'boards' && <BoardsView onBack={() => setView({ name: 'library' })} onOpen={(id) => setView({ name: 'board', id })} />}
      {view.name === 'board' && <BoardEditor id={view.id} onBack={() => setView({ name: 'boards' })} toast={showToast} />}
      {view.name === 'siteshare' && <SiteShareView tab={tab} onBack={() => setView({ name: 'page' })} toast={showToast} />}
      {view.name === 'share' && <ShareView fontId={view.fontId} onBack={() => setView(view.back)} toast={showToast} />}
      <BackToTop />
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

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
