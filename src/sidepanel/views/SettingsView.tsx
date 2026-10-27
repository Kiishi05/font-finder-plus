import { useEffect, useState } from 'react';
import { CATALOG_COUNT, CATALOG_DATE } from '../../shared/catalog';
import type { Settings } from '../../shared/settings';
import { hasAllSitesAccess, requestAllSitesAccess } from '../../shared/settings';

interface Props {
  settings: Settings;
  update: (p: Partial<Settings>) => void;
  toast: (m: string) => void;
}

export function SettingsView({ settings, update, toast }: Props) {
  const [key, setKey] = useState(settings.googleFontsApiKey);
  const [show, setShow] = useState(false);
  const [test, setTest] = useState<{ state: 'idle' | 'testing' | 'ok' | 'error'; text?: string }>({ state: 'idle' });
  const [access, setAccess] = useState(false);

  useEffect(() => setKey(settings.googleFontsApiKey), [settings.googleFontsApiKey]);
  useEffect(() => {
    hasAllSitesAccess().then(setAccess);
  }, []);

  const testKey = async () => {
    setTest({ state: 'testing' });
    try {
      const res = await fetch(`https://www.googleapis.com/webfonts/v1/webfonts?key=${encodeURIComponent(key.trim())}&sort=alpha`);
      if (!res.ok) {
        setTest({ state: 'error', text: res.status === 400 || res.status === 403 ? 'Google rejected this key. Check that the Web Fonts Developer API is enabled for it.' : `Google answered ${res.status}.` });
        return;
      }
      const json = await res.json();
      setTest({ state: 'ok', text: `The key works. ${json.items?.length ?? 0} families available.` });
    } catch {
      setTest({ state: 'error', text: 'Could not reach Google Fonts. Check your connection.' });
    }
  };

  return (
    <>
      <section className="section">
        <h2>[Appearance]</h2>
        <div className="seg" role="group" aria-label="Theme">
          {(['system', 'light', 'dark'] as const).map((t) => (
            <button key={t} aria-pressed={settings.theme === t} onClick={() => update({ theme: t })}>
              {t === 'system' ? 'System' : t === 'light' ? 'Light' : 'Dark'}
            </button>
          ))}
        </div>
      </section>

      <section className="section">
        <h2>[Google Fonts API key]</h2>
        <p className="muted" style={{ margin: 0, fontSize: 12 }}>
          Used only to read the live Google Fonts catalogue. It is stored on this computer in Chrome storage and is never sent anywhere else.
        </p>
        <div className="row">
          <input
            className="field grow"
            type={show ? 'text' : 'password'}
            autoComplete="off"
            spellCheck={false}
            placeholder="Paste your key"
            aria-label="Google Fonts API key"
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
          <button className="btn sm ghost" onClick={() => setShow(!show)}>{show ? 'Hide' : 'Show'}</button>
        </div>
        <div className="row">
          <button
            className="btn sm primary"
            onClick={() => {
              update({ googleFontsApiKey: key.trim() });
              toast(key.trim() ? 'Key saved' : 'Key removed');
            }}
          >
            Save key
          </button>
          <button className="btn sm" disabled={!key.trim() || test.state === 'testing'} onClick={testKey}>
            {test.state === 'testing' ? 'Testing…' : 'Test key'}
          </button>
          {settings.googleFontsApiKey && (
            <button className="btn sm ghost" onClick={() => { setKey(''); update({ googleFontsApiKey: '' }); toast('Key removed'); }}>Remove</button>
          )}
        </div>
        {test.text && <span className={test.state === 'ok' ? 'ok' : 'err'} style={{ fontSize: 12 }}>{test.text}</span>}
      </section>

      <WhatFontIsKey settings={settings} update={update} toast={toast} />

      <section className="section">
        <h2>[Access to sites]</h2>
        <p className="muted" style={{ margin: 0, fontSize: 12 }}>
          {access
            ? 'Allowed. Font Finder Plus can read font files on any site to show foundry, format and metrics, and can start from this panel.'
            : 'Off. Some sites block reading their font files, so foundry, format and metrics may be missing there. You can still inspect any page from the toolbar icon.'}
        </p>
        <div className="row">
          {access ? (
            <button className="btn sm" onClick={async () => { await chrome.permissions.remove({ origins: ['<all_urls>'] }); setAccess(false); }}>Turn off</button>
          ) : (
            <button className="btn sm primary" onClick={async () => setAccess(await requestAllSitesAccess())}>Allow access to all sites</button>
          )}
        </div>
      </section>

      <section className="section">
        <h2>[Help]</h2>
        <div className="row">
          <span className="grow" style={{ fontSize: 12.5 }}>"How it works" guide on the Page tab</span>
          <button className="btn sm" disabled={!settings.guideDismissed} onClick={() => update({ guideDismissed: false })}>
            {settings.guideDismissed ? 'Show again' : 'Showing'}
          </button>
        </div>
      </section>

      <section className="section">
        <h2>[Privacy]</h2>
        <p className="muted" style={{ margin: 0, fontSize: 12 }}>
          Everything runs on this computer. Your library is stored locally. No browsing data is sent anywhere. Font files are downloaded only from the sites that already use them.
        </p>
        <span className="mono muted" style={{ fontSize: 10.5 }}>
          Google Fonts catalogue: {CATALOG_COUNT} families, updated {CATALOG_DATE}
        </span>
      </section>
    </>
  );
}

function WhatFontIsKey({ settings, update, toast }: Props) {
  const [key, setKey] = useState(settings.whatFontIsKey);
  const [show, setShow] = useState(false);
  useEffect(() => setKey(settings.whatFontIsKey), [settings.whatFontIsKey]);
  return (
    <section className="section">
      <h2>[WhatFontIs API key] Optional</h2>
      <p className="muted" style={{ margin: 0, fontSize: 12 }}>
        For identifying fonts from images. Font Finder Plus matches against free Google Fonts on this computer. With your own WhatFontIs key you can also ask
        WhatFontIs, which knows paid fonts too. The image is sent to whatfontis.com only when you click their button. The key is stored on this computer only.
      </p>
      <div className="row">
        <input className="field grow" type={show ? 'text' : 'password'} autoComplete="off" spellCheck={false} placeholder="Paste your WhatFontIs key" aria-label="WhatFontIs API key" value={key} onChange={(e) => setKey(e.target.value)} />
        <button className="btn sm ghost" onClick={() => setShow(!show)}>{show ? 'Hide' : 'Show'}</button>
      </div>
      <div className="row">
        <button className="btn sm primary" onClick={() => { update({ whatFontIsKey: key.trim() }); toast(key.trim() ? 'Key saved' : 'Key removed'); }}>Save key</button>
        {settings.whatFontIsKey && <button className="btn sm ghost" onClick={() => { setKey(''); update({ whatFontIsKey: '' }); toast('Key removed'); }}>Remove</button>}
        <a className="linkbtn" href="https://www.whatfontis.com/API-identify-fonts-from-image.html" target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>Get a key</a>
      </div>
    </section>
  );
}
