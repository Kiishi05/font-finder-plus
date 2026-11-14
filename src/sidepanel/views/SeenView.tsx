// Fonts I've seen: a local, opt-in history of the fonts on pages you read.
// Search it ("serif", "mono free", "stripe"), pause it per site, delete a site
// or everything.
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { CLASS_LABEL, licenseBadge } from '../../shared/catalog';
import { db } from '../../shared/db';
import { ArrowLeft01Icon, Clock01Icon, Delete02Icon, PauseIcon, PlayIcon, Search01Icon } from '../../shared/icons';
import { clearSeen, deleteSeenSite, searchSeen, seenSites, setPaused, type SeenGroup } from '../../shared/seen';
import type { Settings } from '../../shared/settings';
import { Icon } from '../components/Icon';
import { useGoogleFont } from '../lib/google';
import { ensureRecord } from '../lib/imagefonts';

const when = (t: number) => {
  const days = Math.floor((Date.now() - t) / 86400000);
  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : days < 30 ? `${days} days ago` : new Date(t).toLocaleDateString();
};

export function SeenView({ settings, update, host, onBack, onOpenFontId, toast }: {
  settings: Settings;
  update: (p: Partial<Settings>) => void;
  /** The site in the current tab. */
  host: string | null;
  onBack: () => void;
  onOpenFontId: (id: string) => void;
  toast: (m: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [confirm, setConfirm] = useState(false);
  const count = useLiveQuery(() => db.seen.count(), []) ?? 0;
  const groups = useLiveQuery(() => searchSeen(query), [query, count]) ?? [];
  const sites = useLiveQuery(() => seenSites(), [count]) ?? [];
  const paused = settings.seenPaused;
  const togglePause = async (h: string) => {
    const list = await setPaused(h, !paused.includes(h));
    update({ seenPaused: list });
    toast(list.includes(h) ? `Paused on ${h}` : `Recording again on ${h}`);
  };

  return (
    <>
      <div className="topbar">
        <button className="iconbtn" aria-label="Back" onClick={onBack}><Icon icon={ArrowLeft01Icon} /></button>
        <span className="label grow">[Library] / [Fonts I've seen]</span>
      </div>

      {!settings.seenEnabled ? (
        <div className="empty" id="seen-off">
          <Icon icon={Clock01Icon} size={28} />
          <h2>Fonts I've seen</h2>
          <p>Keep a history of the fonts on the pages you read with Font Finder Plus, so you can find them later: "where did I see that serif?"</p>
          <p className="muted">Off until you turn it on. The history stays on this computer and is never sent anywhere. You can pause it on any site, and delete a site or everything at any time.</p>
          <button className="btn primary" onClick={() => { update({ seenEnabled: true }); toast("Fonts I've seen is on"); }}>Turn on</button>
        </div>
      ) : (
        <>
          <div className="card" style={{ padding: '4px 14px' }}>
            <label className="tester-input" htmlFor="seen-search">
              <Icon icon={Search01Icon} size={15} />
              <input id="seen-search" placeholder="Search: a name, a site, serif, mono, free, heading…" value={query} onChange={(e) => setQuery(e.target.value)} />
            </label>
          </div>

          {host && (
            <div className="row" style={{ gap: 8, padding: '0 2px' }}>
              <span className="grow muted" style={{ fontSize: 12 }}>{paused.includes(host) ? `Paused on ${host}: its fonts are not recorded.` : `Recording fonts on ${host} when you read it.`}</span>
              <button className="btn sm" onClick={() => togglePause(host)}>
                <Icon icon={paused.includes(host) ? PlayIcon : PauseIcon} size={14} />{paused.includes(host) ? 'Resume here' : 'Pause on this site'}
              </button>
            </div>
          )}

          <section className="section" id="seen-list">
            <h2>[Seen] {groups.length} {groups.length === 1 ? 'font' : 'fonts'}{query ? ` matching "${query}"` : ''}</h2>
            {!count && <span className="muted" style={{ fontSize: 12.5 }}>Nothing yet. Open the Page tab on a few sites and their fonts will show up here.</span>}
            {!!count && !groups.length && <span className="muted" style={{ fontSize: 12.5 }}>No fonts match. Try a site name, "serif", "sans", "mono", "script", "free" or "paid".</span>}
            {groups.map((g) => <SeenRow key={g.name} g={g} onOpen={async () => onOpenFontId(await ensureRecord(g.catalogFamily ?? g.name))} />)}
          </section>

          {sites.length > 0 && (
            <section className="section" id="seen-sites">
              <h2>[Sites] {sites.length}</h2>
              {sites.map((s) => (
                <div key={s.host} className="row" style={{ gap: 8 }}>
                  <span className="grow" style={{ fontSize: 12.5 }}><b>{s.host}</b> <span className="muted">{s.fonts} {s.fonts === 1 ? 'font' : 'fonts'}, last {when(s.lastSeen)}{paused.includes(s.host) ? ', paused' : ''}</span></span>
                  <button className="btn sm ghost" aria-label={`${paused.includes(s.host) ? 'Resume' : 'Pause'} on ${s.host}`} onClick={() => togglePause(s.host)}><Icon icon={paused.includes(s.host) ? PlayIcon : PauseIcon} size={14} /></button>
                  <button className="btn sm ghost" aria-label={`Delete ${s.host} from the history`} onClick={async () => { await deleteSeenSite(s.host); toast(`Deleted ${s.host} from the history`); }}><Icon icon={Delete02Icon} size={14} /></button>
                </div>
              ))}
            </section>
          )}

          <section className="section">
            <h2>[History]</h2>
            {!confirm ? (
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <button className="btn sm" onClick={() => setConfirm(true)} disabled={!count}>Delete all history</button>
                <button className="btn sm ghost" onClick={() => { update({ seenEnabled: false }); toast("Fonts I've seen is off. Nothing new is recorded."); }}>Turn off</button>
              </div>
            ) : (
              <div role="alert" className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12 }}>Delete the fonts of all {sites.length} sites from this computer? This cannot be undone.</span>
                <button className="btn sm primary" onClick={async () => { await clearSeen(); setConfirm(false); toast('History deleted'); }}>Delete everything</button>
                <button className="btn sm ghost" onClick={() => setConfirm(false)}>Cancel</button>
              </div>
            )}
            <span className="muted" style={{ fontSize: 11.5 }}>Kept only in this browser on this computer. Turning it off keeps what is already here until you delete it.</span>
          </section>
        </>
      )}
    </>
  );
}

function SeenRow({ g, onOpen }: { g: SeenGroup; onOpen: () => void }) {
  const css = useGoogleFont(g.catalogFamily);
  const badge = licenseBadge(g.licenseType);
  return (
    <div className="seenrow">
      <div className="row" style={{ gap: 8, alignItems: 'baseline' }}>
        <button className="namebtn grow" style={{ fontFamily: g.catalogFamily ? css : undefined, fontSize: 17 }} onClick={onOpen}>{g.name}</button>
        <span className={`lic ${badge.tone}`}><i />{badge.text}</span>
      </div>
      <span className="muted" style={{ fontSize: 11.5 }}>{CLASS_LABEL[g.classification]}{g.roles.length ? ` · ${g.roles.slice(0, 3).join(', ')}` : ''}</span>
      {g.sites.slice(0, 4).map((s) => (
        <span key={s.host} style={{ fontSize: 12 }}>
          <a href={s.pages[0]?.url} target="_blank" rel="noreferrer">{s.host}</a>
          <span className="muted"> · {when(s.lastSeen)}{s.visits > 1 ? ` · ${s.visits} visits` : ''}</span>
        </span>
      ))}
      {g.sites.length > 4 && <span className="muted" style={{ fontSize: 11.5 }}>and {g.sites.length - 4} more sites</span>}
    </div>
  );
}
