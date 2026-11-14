// Fonts I've seen: a local, opt-in history of the fonts on pages you read.
// Search it ("serif", "mono free", "stripe"), pause it per site, delete a site
// or everything.
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { CLASS_LABEL, licenseBadge } from '../../shared/catalog';
import { db } from '../../shared/db';
import { ArrowDown01Icon, ArrowLeft01Icon, Clock01Icon, Delete02Icon, PauseIcon, PlayIcon, Search01Icon } from '../../shared/icons';
import { clearSeen, deleteSeenSite, searchSeen, seenSites, setPaused, type SeenGroup } from '../../shared/seen';
import type { Settings } from '../../shared/settings';
import { Icon } from '../components/Icon';
import { useGoogleFont } from '../lib/google';
import { ensureRecord } from '../lib/imagefonts';

const when = (t: number) => {
  const days = Math.floor((Date.now() - t) / 86400000);
  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : days < 7 ? `${days} days ago` : days < 14 ? 'last week' : days < 30 ? `${Math.floor(days / 7)} weeks ago` : new Date(t).toLocaleDateString();
};
const fontsWord = (n: number) => `${n} ${n === 1 ? 'font' : 'fonts'}`;
const FIRST_ROWS = 20;
const FIRST_SITES = 8;

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
  const [allRows, setAllRows] = useState(false);
  const [allSites, setAllSites] = useState(false);
  const count = useLiveQuery(() => db.seen.count(), []);
  const groups = useLiveQuery(() => searchSeen(query), [query, count]) ?? [];
  const sites = useLiveQuery(() => seenSites(), [count]) ?? [];
  const paused = settings.seenPaused;
  const togglePause = async (h: string) => {
    const list = await setPaused(h, !paused.includes(h));
    update({ seenPaused: list });
    toast(list.includes(h) ? `Paused on ${h}` : `Recording again on ${h}`);
  };
  const turnOff = () => { update({ seenEnabled: false }); toast("Fonts I've seen is off. Nothing new is recorded."); };
  const hostPaused = !!host && paused.includes(host);

  const top = (
    <div className="subtop">
      <button className="backbtn tip" data-tip="Back" aria-label="Back" onClick={onBack}><Icon icon={ArrowLeft01Icon} size={18} /></button>
      <span className="crumb"><span>Library</span><span className="sl">/</span><b>Fonts I've seen</b></span>
    </div>
  );

  if (!settings.seenEnabled) {
    return (
      <div className="libv">
        {top}
        <section className="empty" id="seen-off">
          <span className="eic"><Icon icon={Clock01Icon} size={24} /></span>
          <div className="et">
            <h2>Fonts I've seen is off</h2>
            <p>Turn it on to keep a history of the fonts on the pages you read with Font Finder Plus, so you can find them later: “where did I see that serif?”</p>
          </div>
          <p className="sub">The history stays on this computer and is never sent anywhere. You can pause it on any site, and delete a site or everything at any time.</p>
          <div className="eacts">
            <button className="btn primary" onClick={() => { update({ seenEnabled: true }); toast("Fonts I've seen is on"); }}>Turn on</button>
          </div>
        </section>
      </div>
    );
  }

  const recbar = host && (
    <section className="recbar">
      <i className={`recdot${hostPaused ? ' off' : ''}`} />
      <span className="grow">{hostPaused ? 'Paused on' : 'Recording on'} <b>{host}</b></span>
      <button className="btn sm" aria-label={hostPaused ? `Resume recording on ${host}` : `Pause recording on ${host}`} onClick={() => togglePause(host)}>
        <Icon icon={hostPaused ? PlayIcon : PauseIcon} size={15} />{hostPaused ? 'Resume' : 'Pause'}
      </button>
    </section>
  );

  if (count === 0) {
    return (
      <div className="libv">
        {top}
        {recbar}
        <section className="empty">
          <span className="eic"><Icon icon={Clock01Icon} size={24} /></span>
          <div className="et">
            <h2>Nothing recorded yet</h2>
            <p>Fonts I've seen is on. Browse as usual and the fonts on pages you read with Font Finder Plus open will show up here.</p>
          </div>
          <div className="eacts"><button className="btn sm" onClick={turnOff}>Turn off</button></div>
        </section>
      </div>
    );
  }

  const rows = allRows ? groups : groups.slice(0, FIRST_ROWS);
  const siteRows = allSites ? sites : sites.slice(0, FIRST_SITES);

  return (
    <div className="libv">
      {top}
      {recbar}

      <div className="libsearch">
        <span className="s"><Icon icon={Search01Icon} size={16} /></span>
        <input id="seen-search" type="text" aria-label="Search the history" placeholder="A name, a site, serif, heading…" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>

      <section className="section" id="seen-list">
        <div className="sechead">
          <h2>Seen</h2>
          <span className="count">{fontsWord(groups.length)}{query ? ` matching “${query}”` : ''}</span>
        </div>
        {!groups.length && count !== undefined && <p className="sub">No fonts match. Try a site name, “serif”, “sans”, “mono”, “script”, “free” or “paid”.</p>}
        {!!groups.length && (
          <div className="seenlist">
            {rows.map((g) => <SeenRow key={g.name} g={g} onOpen={async () => onOpenFontId(await ensureRecord(g.catalogFamily ?? g.name))} />)}
          </div>
        )}
        {groups.length > FIRST_ROWS && (
          <div><button className="linkbtn" onClick={() => setAllRows(!allRows)}>{allRows ? 'Show fewer' : `Show all ${groups.length}`}<Icon icon={ArrowDown01Icon} size={14} className={allRows ? 'flip' : undefined} /></button></div>
        )}
      </section>

      {sites.length > 0 && (
        <section className="section" id="seen-sites">
          <div className="sechead"><h2>Sites</h2><span className="count">{sites.length}</span></div>
          <p className="sub">Pause a site to stop recording its fonts, for example your bank or work tools. Fonts already recorded stay until you delete them.</p>
          <div className="sites">
            {siteRows.map((s) => {
              const p = paused.includes(s.host);
              return (
                <div key={s.host} className={`site${p ? ' paused' : ''}`}>
                  <b title={`${s.host}, last ${when(s.lastSeen)}`}>{s.host}</b>
                  {p && <span className="ptag">Paused</span>}
                  <span className="n">{fontsWord(s.fonts)}</span>
                  <button className="iconbtn sm tip tipr" data-tip={p ? 'Record this site again' : 'Stop recording this site'} aria-label={p ? `Record ${s.host} again` : `Stop recording ${s.host}`} onClick={() => togglePause(s.host)}>
                    <Icon icon={p ? PlayIcon : PauseIcon} size={15} />
                  </button>
                  <button className="iconbtn sm tip tipr danger" data-tip="Delete its history" aria-label={`Delete ${s.host} from the history`} onClick={async () => { await deleteSeenSite(s.host); toast(`Deleted ${s.host} from the history`); }}>
                    <Icon icon={Delete02Icon} size={15} />
                  </button>
                </div>
              );
            })}
          </div>
          {sites.length > FIRST_SITES && (
            <div><button className="linkbtn" onClick={() => setAllSites(!allSites)}>{allSites ? 'Show fewer' : `Show all ${sites.length}`}<Icon icon={ArrowDown01Icon} size={14} className={allSites ? 'flip' : undefined} /></button></div>
          )}
        </section>
      )}

      <section className="section">
        <div className="sechead"><h2>History</h2></div>
        <p className="sub">Kept only in this browser on this computer. Nothing is sent anywhere. Turning it off keeps what is already here until you delete it.</p>
        {!confirm ? (
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <button className="btn sm danger" onClick={() => setConfirm(true)} disabled={!count}><Icon icon={Delete02Icon} size={15} />Delete all history</button>
            <button className="btn sm" onClick={turnOff}>Turn off</button>
          </div>
        ) : (
          <div role="alert" className="confirmrow">
            <span className="grow">Delete the fonts of all {sites.length} {sites.length === 1 ? 'site' : 'sites'} from the history? This cannot be undone.</span>
            <button className="btn sm" onClick={() => setConfirm(false)}>Cancel</button>
            <button className="btn sm dangerfill" onClick={async () => { await clearSeen(); setConfirm(false); toast('History deleted'); }}>Delete</button>
          </div>
        )}
      </section>
    </div>
  );
}

function SeenRow({ g, onOpen }: { g: SeenGroup; onOpen: () => void }) {
  const css = useGoogleFont(g.catalogFamily);
  const badge = licenseBadge(g.licenseType);
  const [more, setMore] = useState(false);
  const [first, ...rest] = g.sites;
  return (
    <div className="seenrow" onClick={(e) => { if (!(e.target as Element).closest('a, .linkbtn, .namebtn')) onOpen(); }}>
      <button className="namebtn n" style={{ fontFamily: g.catalogFamily ? css : undefined }} title={`${g.name} · ${CLASS_LABEL[g.classification]}`} onClick={onOpen}>{g.name}</button>
      <span className={`lic ${badge.tone}`}><i />{badge.text}</span>
      <span className="w">
        {first && <><a href={first.pages[0]?.url} target="_blank" rel="noreferrer">{first.host}</a> · {when(first.lastSeen)}</>}
        {g.roles.length ? ` · ${g.roles.slice(0, 3).join(', ')}` : ''}
        {rest.length > 0 && (
          <> · <button className="linkbtn" aria-expanded={more} onClick={() => setMore(!more)}>{more ? 'fewer sites' : `${rest.length} more ${rest.length === 1 ? 'site' : 'sites'}`}</button></>
        )}
      </span>
      {more && (
        <span className="w sitesmore">
          <span>{CLASS_LABEL[g.classification]}{first && first.visits > 1 ? ` · ${first.host}: ${first.visits.toLocaleString()} visits` : ''}</span>
          {rest.map((s) => (
            <span key={s.host}>
              <a href={s.pages[0]?.url} target="_blank" rel="noreferrer">{s.host}</a> · {when(s.lastSeen)}{s.visits > 1 ? ` · ${s.visits.toLocaleString()} visits` : ''}
            </span>
          ))}
        </span>
      )}
    </div>
  );
}
