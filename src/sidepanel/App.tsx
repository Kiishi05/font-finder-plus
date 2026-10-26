import { useEffect, useState } from 'react';
import { BRAND } from '../shared/brand';
import { Settings02Icon } from '../shared/icons';
import type { PageFontUsage } from '../shared/types';
import { Icon } from './components/Icon';
import { DEFAULT_TESTER, type TesterState } from './components/Tester';
import { useActiveTab, useSettings, useToast } from './lib/hooks';
import { FontDetail } from './views/FontDetail';
import { LibraryView } from './views/LibraryView';
import { PageView } from './views/PageView';
import { SettingsView } from './views/SettingsView';

export type View =
  | { name: 'page' }
  | { name: 'library' }
  | { name: 'settings' }
  | { name: 'detail'; fontId: string; usage?: PageFontUsage; from: 'page' | 'library' };

export function App() {
  const [view, setView] = useState<View>({ name: 'page' });
  const [settings, updateSettings] = useSettings();
  const tab = useActiveTab();
  const [toast, showToast] = useToast();
  const [tester, setTester] = useState<TesterState>(DEFAULT_TESTER);
  const [libTester, setLibTester] = useState<TesterState>({ ...DEFAULT_TESTER, size: 36 });

  useEffect(() => {
    const el = document.documentElement;
    if (settings.theme === 'system') el.removeAttribute('data-theme');
    else el.setAttribute('data-theme', settings.theme);
  }, [settings.theme]);

  const top = view.name === 'detail' ? view.from : view.name;

  return (
    <div className="app">
      {view.name !== 'detail' && (
        <div className="topbar">
          <div className="brand">{BRAND.shortName}</div>
          <nav className="tabs" aria-label="Sections">
            <button aria-current={top === 'page' ? 'page' : undefined} onClick={() => setView({ name: 'page' })}>Page</button>
            <button aria-current={top === 'library' ? 'page' : undefined} onClick={() => setView({ name: 'library' })}>Library</button>
          </nav>
          <button className="iconbtn" aria-label="Settings" aria-current={view.name === 'settings' ? 'page' : undefined} onClick={() => setView(view.name === 'settings' ? { name: 'page' } : { name: 'settings' })}>
            <Icon icon={Settings02Icon} />
          </button>
        </div>
      )}

      {view.name === 'page' && (
        <PageView tab={tab} tester={tester} onTester={setTester} onOpen={(usage, fontId) => setView({ name: 'detail', fontId, usage, from: 'page' })} toast={showToast} />
      )}
      {view.name === 'library' && (
        <LibraryView tester={libTester} onTester={setLibTester} onOpen={(fontId) => setView({ name: 'detail', fontId, from: 'library' })} />
      )}
      {view.name === 'settings' && <SettingsView settings={settings} update={updateSettings} toast={showToast} />}
      {view.name === 'detail' && (
        <FontDetail
          fontId={view.fontId}
          usage={view.usage}
          tabId={tab.tabId}
          pageHost={tab.ping?.host ?? null}
          onBack={() => setView(view.from === 'page' ? { name: 'page' } : { name: 'library' })}
          toast={showToast}
        />
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
