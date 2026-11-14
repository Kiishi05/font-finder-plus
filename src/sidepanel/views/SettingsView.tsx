import { useEffect, useState } from 'react';
import { CATALOG_COUNT, CATALOG_DATE } from '../../shared/catalog';
import { db } from '../../shared/db';
import { Alert02Icon, ArrowLeft01Icon, ArrowUpRight01Icon, Clock01Icon, Delete02Icon, Download01Icon, Tick02Icon, Upload01Icon, ViewIcon, ViewOffIcon } from '../../shared/icons';
import type { Settings } from '../../shared/settings';
import { hasAllSitesAccess, requestAllSitesAccess } from '../../shared/settings';
import { Icon } from '../components/Icon';
import { exportLibrary, importLibrary } from '../lib/backup';
import { downloadBlob } from '../lib/cards';

interface Props {
  settings: Settings;
  update: (p: Partial<Settings>) => void;
  toast: (m: string) => void;
  /** Back to the view Settings was opened from. */
  onBack?: () => void;
  /** Open the Fonts I've seen history. */
  onOpenSeen?: () => void;
}

const KEY_GUIDE = 'https://developers.google.com/fonts/docs/developer_api#APIKey';

const longDate = (iso: string) => {
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
};

const version = () => {
  try {
    return chrome.runtime.getManifest().version;
  } catch {
    return '';
  }
};

function Switch({ on, label, onChange }: { on: boolean; label: string; onChange: () => void }) {
  return <button className="switch" role="switch" aria-checked={on} aria-label={label} onClick={onChange} />;
}

function Thumb({ kind }: { kind: 'system' | 'light' | 'dark' }) {
  return (
    <span className={`thumb ${kind}`} aria-hidden="true">
      <i className="tb" />
      <i className="c" />
      <i className="l1" />
      <i className="l2" />
    </span>
  );
}

export function SettingsView({ settings, update, toast, onBack, onOpenSeen }: Props) {
  const [key, setKey] = useState(settings.googleFontsApiKey);
  const [show, setShow] = useState(false);
  const [test, setTest] = useState<{ state: 'idle' | 'testing' | 'ok' | 'error'; text?: string }>({ state: 'idle' });
  const [access, setAccess] = useState(false);
  const [confirmWipe, setConfirmWipe] = useState(false);

  useEffect(() => setKey(settings.googleFontsApiKey), [settings.googleFontsApiKey]);
  useEffect(() => {
    hasAllSitesAccess().then(setAccess);
  }, []);

  const testKey = async () => {
    setTest({ state: 'testing' });
    try {
      const res = await fetch(`https://www.googleapis.com/webfonts/v1/webfonts?key=${encodeURIComponent(key.trim())}&sort=alpha`);
      if (!res.ok) {
        setTest({ state: 'error', text: res.status === 400 || res.status === 403 ? 'Google did not accept this key. Check that the Web Fonts Developer API is turned on for it.' : `Google answered ${res.status}.` });
        return;
      }
      const json = await res.json();
      setTest({ state: 'ok', text: `The key works. The live list has ${(json.items?.length ?? 0).toLocaleString('en-GB')} families.` });
    } catch {
      setTest({ state: 'error', text: 'Could not reach Google Fonts. Check your connection.' });
    }
  };

  const toggleAccess = async () => {
    if (access) {
      await chrome.permissions.remove({ origins: ['<all_urls>'] });
      setAccess(false);
      toast('Turned off');
    } else {
      const ok = await requestAllSitesAccess();
      setAccess(ok);
      if (ok) toast('Can read fonts on every site');
    }
  };

  const doExport = async () => {
    const data = await exportLibrary();
    downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), `font-finder-plus-library-${new Date().toISOString().slice(0, 10)}.json`);
    toast(`Exported ${data.savedFonts.length} fonts, ${data.collections.length} collections and ${data.boards.length} boards`);
  };

  const doImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const r = await importLibrary(JSON.parse(await file.text()));
      toast(`Imported ${r.fonts} new ${r.fonts === 1 ? 'font' : 'fonts'}${r.merged ? `, merged ${r.merged}` : ''}, ${r.collections} new collections, ${r.boards} boards`);
    } catch (err) {
      toast(err instanceof SyntaxError ? 'This file is not valid JSON.' : err instanceof Error ? err.message : 'Could not import this file.');
    }
  };

  const paused = settings.seenPaused.length;
  const saved = !!settings.googleFontsApiKey;
  const ver = version();

  return (
    <div className="settings">
      <div className="subtop">
        <button className="backbtn tip" aria-label="Back" data-tip="Back" onClick={onBack}>
          <Icon icon={ArrowLeft01Icon} size={18} />
        </button>
        <span className="crumb"><b>Settings</b></span>
      </div>

      <section className="section">
        <div className="chead"><h2>Appearance</h2></div>
        <div className="themes" role="radiogroup" aria-label="Theme">
          {(['system', 'light', 'dark'] as const).map((t) => (
            <button key={t} className="tcard" role="radio" aria-checked={settings.theme === t} onClick={() => update({ theme: t })}>
              <Thumb kind={t} />
              <span className="tl"><i className="radio" />{t === 'system' ? 'System' : t === 'light' ? 'Light' : 'Dark'}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="section">
        <div className="chead">
          <h2>Read fonts on every site</h2>
          <Switch on={access} label="Read fonts on every site" onChange={toggleAccess} />
        </div>
        <p className="sub">
          {access
            ? 'On. Font Finder Plus can open font files on any site, so it can show the foundry, format and metrics, and can start from this panel.'
            : 'Off. Sites that block their font files will be missing the foundry, format and metrics. Inspecting still works from the toolbar icon.'}
        </p>
      </section>

      <section className="section" id="seen-settings">
        <div className="chead">
          <h2>Fonts I've seen</h2>
          <Switch
            on={settings.seenEnabled}
            label="Fonts I've seen"
            onChange={() => {
              update({ seenEnabled: !settings.seenEnabled });
              toast(settings.seenEnabled ? "Fonts I've seen is off" : "Fonts I've seen is on");
            }}
          />
        </div>
        <p className="sub">
          {settings.seenEnabled
            ? `On. The fonts on pages you read are kept in a history on this computer${paused ? `, except on ${paused} paused ${paused === 1 ? 'site' : 'sites'}` : ''}, so you can find them later.`
            : 'Off. Turn it on to keep a history of the fonts on pages you read, so you can find them later. It stays on this computer.'}
        </p>
        {settings.seenEnabled && onOpenSeen && (
          <div>
            <button className="btn sm" onClick={onOpenSeen}><Icon icon={Clock01Icon} size={15} />Open the history</button>
          </div>
        )}
      </section>

      <section className="section">
        <div className="chead">
          <h2>“How it works” guide</h2>
          <Switch
            on={!settings.guideDismissed}
            label="How it works guide"
            onChange={() => {
              update({ guideDismissed: !settings.guideDismissed });
              toast(settings.guideDismissed ? 'The guide shows on the Page tab' : 'Guide hidden');
            }}
          />
        </div>
        <p className="sub">A short guide at the top of the Page tab, for when you're new.</p>
      </section>

      <section className="section">
        <div className="chead">
          <h2>Google Fonts API key</h2>
          <span className={`kpill${saved ? ' ok' : ''}`}>{saved ? 'Added' : 'Optional'}</span>
        </div>
        <p className="sub">
          Font Finder Plus has a built-in list of {CATALOG_COUNT.toLocaleString('en-GB')} Google Fonts. Add a key to use the live list instead, with fonts added since {longDate(CATALOG_DATE)}. The key stays on this computer.
        </p>
        <div className="keyfield">
          <input
            type={show ? 'text' : 'password'}
            autoComplete="off"
            spellCheck={false}
            placeholder="Paste your key"
            aria-label="Google Fonts API key"
            value={key}
            onChange={(e) => {
              setKey(e.target.value);
              setTest({ state: 'idle' });
            }}
          />
          <button className="iconbtn sm tip" aria-label={show ? 'Hide key' : 'Show key'} data-tip={show ? 'Hide' : 'Show'} onClick={() => setShow(!show)}>
            <Icon icon={show ? ViewOffIcon : ViewIcon} size={17} />
          </button>
        </div>
        {test.text && (
          <div className={`result ${test.state === 'ok' ? 'ok' : 'err'}`} role="status">
            <Icon icon={test.state === 'ok' ? Tick02Icon : Alert02Icon} size={15} />
            <span>{test.text}</span>
          </div>
        )}
        <div className="keyacts">
          <button
            className="btn sm primary"
            disabled={!key.trim() && !saved}
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
          <span className="grow" />
          {saved ? (
            <button
              className="linkbtn danger"
              onClick={() => {
                setKey('');
                setTest({ state: 'idle' });
                update({ googleFontsApiKey: '' });
                toast('Key removed');
              }}
            >
              <Icon icon={Delete02Icon} size={15} />Remove
            </button>
          ) : (
            <a className="linkbtn" href={KEY_GUIDE} target="_blank" rel="noreferrer">
              Get a key <Icon icon={ArrowUpRight01Icon} size={14} />
            </a>
          )}
        </div>
      </section>

      <section className="section">
        <div className="chead"><h2>Your data</h2></div>
        <p className="sub">
          Your library and history stay on this computer, and nothing about your browsing is sent anywhere. Font files only come from the sites that already use them, and free look-alikes from Google Fonts and Fontshare.
        </p>
        <div className="dacts">
          <button className="btn" title="Save your library as a file, to back it up or move it to another computer" onClick={doExport}>
            <Icon icon={Download01Icon} size={15} />Export library
          </button>
          <label className="btn" title="Add fonts from a Font Finder Plus library file">
            <Icon icon={Upload01Icon} size={15} />Import library
            <input type="file" accept="application/json,.json" aria-label="Import a library file" hidden onChange={doImport} />
          </label>
        </div>
        {!confirmWipe ? (
          <button className="btn danger wide wipe" onClick={() => setConfirmWipe(true)}>
            <Icon icon={Delete02Icon} size={15} />Delete all my data
          </button>
        ) : (
          <div className="confirm" role="alert">
            <b>Delete all your data?</b>
            <p>This removes your saved fonts, collections, boards, history and screenshots from this computer. It can't be undone. Export your library first if you want a copy.</p>
            <div className="crow">
              <button
                className="btn dangerfill"
                onClick={async () => {
                  await Promise.all(db.tables.map((t) => t.clear()));
                  setConfirmWipe(false);
                  toast('All your data was deleted');
                }}
              >
                Delete everything
              </button>
              <button className="btn" onClick={() => setConfirmWipe(false)}>Cancel</button>
            </div>
          </div>
        )}
      </section>

      <p className="ver">Font Finder Plus{ver ? ` ${ver}` : ''}</p>
    </div>
  );
}
