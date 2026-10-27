import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { CLASS_LABEL, SOURCE_LABEL, licenseBadge } from '../../shared/catalog';
import { db, deleteCollection } from '../../shared/db';
import { DashboardSquare01Icon, Download01Icon, Upload01Icon, FolderAddIcon, GridViewIcon, Menu01Icon, PlusSignIcon, Search01Icon, Tick02Icon } from '../../shared/icons';
import type { Classification, FontRecord, SavedFont, SourceKind } from '../../shared/types';
import { Icon } from '../components/Icon';
import { Select } from '../components/Select';
import { exportLibrary, importLibrary } from '../lib/backup';
import { downloadBlob } from '../lib/cards';
import { MissingNote } from '../components/MissingNote';
import { Tester, sampleText, type TesterState } from '../components/Tester';
import { usePreviewFamily } from '../lib/preview';
import { CollectionPicker, NewCollectionInline } from '../components/CollectionPicker';

type LicenseFilter = 'all' | 'free' | 'system' | 'commercial' | 'unknown';
type SourceFilter = SourceKind | 'all' | 'on-google';

const VIEW_KEY = 'ffp-library-view';
function readView(): 'list' | 'grid' {
  try {
    return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'grid';
  } catch {
    return 'grid';
  }
}

interface Props {
  tester: TesterState;
  onTester: (t: TesterState) => void;
  onOpen: (fontId: string) => void;
  onBoards: () => void;
  toast: (m: string) => void;
}

export function LibraryView({ tester, onTester, onOpen, onBoards, toast }: Props) {
  const saved = useLiveQuery(() => db.savedFonts.orderBy('createdAt').reverse().toArray(), []) ?? [];
  const fonts = useLiveQuery(() => db.fonts.toArray(), []) ?? [];
  const collections = useLiveQuery(() => db.collections.orderBy('createdAt').toArray(), []) ?? [];
  const [query, setQuery] = useState('');
  const [cls, setCls] = useState<Classification | 'all'>('all');
  const [lic, setLic] = useState<LicenseFilter>('all');
  const [src, setSrc] = useState<SourceFilter>('all');
  const [view, setViewState] = useState<'list' | 'grid'>(readView);
  const setView = (v: 'list' | 'grid') => {
    setViewState(v);
    try { localStorage.setItem(VIEW_KEY, v); } catch { /* not important */ }
  };
  const [collection, setCollection] = useState<number | 'all'>('all');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [adding, setAdding] = useState(false);

  const byId = useMemo(() => new Map(fonts.map((f) => [f.id, f])), [fonts]);
  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    return saved
      .map((s) => ({ s, f: byId.get(s.fontId) }))
      .filter((x): x is { s: SavedFont; f: FontRecord } => !!x.f)
      .filter(({ s, f }) => {
        if (collection !== 'all' && !s.collectionIds.includes(collection)) return false;
        if (cls !== 'all' && f.classification !== cls) return false;
        if (src === 'on-google' && !(f.catalogFamily || f.source === 'google')) return false;
        if (src !== 'all' && src !== 'on-google' && f.source !== src) return false;
        if (lic !== 'all') {
          const free = ['OFL', 'APACHE', 'UFL', 'free-other'].includes(f.licenseType);
          if (lic === 'free' && !free) return false;
          if (lic === 'system' && f.licenseType !== 'system') return false;
          if (lic === 'commercial' && f.licenseType !== 'commercial') return false;
          if (lic === 'unknown' && f.licenseType !== 'unknown') return false;
        }
        if (q) {
          const names = collections.filter((c) => s.collectionIds.includes(c.id!)).map((c) => c.name.toLowerCase());
          const hay = [f.family, f.displayName ?? '', f.catalogFamily ?? '', f.foundry ?? '', ...(f.designers ?? []), f.sourceHost ?? '', ...s.sitesSeen, s.notes, ...names].join(' ').toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      });
  }, [saved, byId, query, cls, lic, src, collection, collections]);

  const counts = useMemo(() => {
    const m = new Map<number, number>();
    for (const s of saved) for (const c of s.collectionIds) m.set(c, (m.get(c) ?? 0) + 1);
    return m;
  }, [saved]);

  const activeCollection = collections.find((c) => c.id === collection);

  return (
    <>
      <div className="card" style={{ padding: '4px 14px' }}>
        <label className="tester-input" htmlFor="lib-search" style={{ borderBottom: '1px solid var(--line)' }}>
          <Icon icon={Search01Icon} size={15} />
          <input id="lib-search" placeholder={`Search ${saved.length} saved ${saved.length === 1 ? 'font' : 'fonts'}`} value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="viewtoggle" style={{ background: 'var(--field)' }} role="group" aria-label="Layout">
          <button aria-pressed={view === 'list'} aria-label="Wide list" title="Wide list" onClick={() => setView('list')}><Icon icon={Menu01Icon} size={15} /></button>
          <button aria-pressed={view === 'grid'} aria-label="Grid" title="Grid" onClick={() => setView('grid')}><Icon icon={GridViewIcon} size={15} /></button>
        </div>
        </label>
        <div className="filters" style={{ padding: '8px 0' }}>
          <Select<Classification | 'all'>
            label="Style"
            value={cls}
            onChange={setCls}
            options={[{ value: 'all', label: 'All styles' }, ...(['serif', 'sans', 'mono', 'display', 'script', 'unknown'] as Classification[]).map((c) => ({ value: c, label: CLASS_LABEL[c] }))]}
          />
          <Select<LicenseFilter>
            label="License"
            value={lic}
            onChange={setLic}
            options={[
              { value: 'all', label: 'Any license' },
              { value: 'free', label: 'Free (open license)' },
              { value: 'commercial', label: 'Commercial' },
              { value: 'system', label: 'System font' },
              { value: 'unknown', label: 'Unknown' },
            ]}
          />
          <Select<SourceFilter>
            label="Source"
            value={src}
            onChange={setSrc}
            options={[
              { value: 'all', label: 'Any source' },
              { value: 'on-google', label: 'Available on Google Fonts' },
              ...(Object.keys(SOURCE_LABEL) as SourceKind[]).map((k) => ({ value: k, label: `Served from ${SOURCE_LABEL[k]}` })),
            ]}
          />
        </div>
      </div>

      <div className="libtools">
        <button className="btn" onClick={onBoards}><Icon icon={DashboardSquare01Icon} size={15} />Boards</button>
        <button
          className="btn"
          title="Save your library as a file, to back it up or move it to another computer"
          onClick={async () => {
            const data = await exportLibrary();
            downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), `font-finder-plus-library-${new Date().toISOString().slice(0, 10)}.json`);
            toast(`Exported ${data.savedFonts.length} fonts, ${data.collections.length} collections and ${data.boards.length} boards`);
          }}
        >
          <Icon icon={Download01Icon} size={15} />Export
        </button>
        <label className="btn" title="Add fonts from a Font Finder Plus library file">
          <Icon icon={Upload01Icon} size={15} />Import
          <input
            type="file"
            accept="application/json,.json"
            aria-label="Import a library file"
            hidden
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              try {
                const r = await importLibrary(JSON.parse(await file.text()));
                toast(`Imported ${r.fonts} new ${r.fonts === 1 ? 'font' : 'fonts'}${r.merged ? `, merged ${r.merged}` : ''}, ${r.collections} new collections, ${r.boards} boards`);
              } catch (err) {
                toast(err instanceof SyntaxError ? 'This file is not valid JSON.' : err instanceof Error ? err.message : 'Could not import this file.');
              }
            }}
          />
        </label>
      </div>

      <Tester value={tester} onChange={onTester} min={14} max={72} />

      <div className="chips">
        <button className={`chip${collection === 'all' ? ' on' : ''}`} onClick={() => { setCollection('all'); setAdding(false); }}>All <span className="mono">{saved.length}</span></button>
        {collections.map((c) => (
          <button key={c.id} className={`chip${collection === c.id ? ' on' : ''}`} onClick={() => { setCollection(c.id!); setRenaming(null); setConfirmDelete(false); setAdding(false); }}>
            <span className="sq" style={{ background: c.color }} />
            {c.name} <span className="mono">{counts.get(c.id!) ?? 0}</span>
          </button>
        ))}
        <NewCollectionInline />
      </div>

      {activeCollection && (
        <div className="row card" style={{ padding: '8px 12px', gap: 10 }}>
          {renaming !== null ? (
            <>
              <input className="field grow" aria-label="New collection name" value={renaming} onChange={(e) => setRenaming(e.target.value)} autoFocus />
              <button className="btn sm primary" disabled={!renaming.trim()} onClick={async () => { await db.collections.update(activeCollection.id!, { name: renaming.trim() }); setRenaming(null); }}>Save</button>
              <button className="btn sm ghost" onClick={() => setRenaming(null)}>Cancel</button>
            </>
          ) : confirmDelete ? (
            <>
              <span className="grow">Delete “{activeCollection.name}”? Fonts stay in your library.</span>
              <button className="btn sm" onClick={() => setConfirmDelete(false)}>Keep</button>
              <button className="btn sm primary" onClick={async () => { await deleteCollection(activeCollection.id!); setCollection('all'); setConfirmDelete(false); }}>Delete</button>
            </>
          ) : (
            <>
              <span className="grow" style={{ fontWeight: 500 }}>{activeCollection.name}</span>
              <button className="btn sm primary" aria-expanded={adding} onClick={() => setAdding(!adding)}><Icon icon={PlusSignIcon} size={14} />Add fonts</button>
              <button className="linkbtn" onClick={() => setRenaming(activeCollection.name)}>Rename</button>
              <button className="linkbtn" onClick={() => setConfirmDelete(true)}>Delete</button>
            </>
          )}
        </div>
      )}

      {activeCollection && adding && (
        <AddFonts collectionId={activeCollection.id!} name={activeCollection.name} saved={saved} byId={byId} onDone={() => setAdding(false)} />
      )}

      {saved.length === 0 ? (
        <div className="empty">
          <h2>Your library is empty</h2>
          <p>Save fonts from the Page tab or from the hover card on any website. They stay on this computer only.</p>
        </div>
      ) : items.length === 0 ? (
        <div className="notice neutral">{activeCollection && !query && cls === 'all' && lic === 'all' && src === 'all' ? 'This collection is empty. Click Add fonts above, or use Add to collection on any font.' : 'No saved fonts match these filters.'}</div>
      ) : (
        <div className={view === 'grid' ? 'grid2' : 'list'}>
          {items.map(({ s, f }) => (
            <LibraryCard key={s.id} f={f} savedId={s.id!} tester={tester} wide={view === 'list'} onOpen={() => onOpen(f.id)} />
          ))}
        </div>
      )}
    </>
  );
}

function LibraryCard({ f, savedId, tester, wide, onOpen }: { f: FontRecord; savedId: number; tester: TesterState; wide: boolean; onOpen: () => void }) {
  const [picking, setPicking] = useState(false);
  const preview = usePreviewFamily(
    {
      family: f.family,
      kind: f.kind ?? (f.source === 'system' ? 'local' : 'web'),
      genericName: f.genericName,
      files: f.files?.length ? f.files : f.fileUrl ? [{ url: f.fileUrl, format: f.format ?? null, weight: '400', style: 'normal', unicodeRange: null }] : [],
    },
    null,
  );
  const badge = licenseBadge(f.licenseType);
  const name = f.displayName ?? f.family;
  const onGoogle = !!f.catalogFamily || f.source === 'google';
  const addBtn = (
    <button
      className={`iconbtn sm${picking ? ' on' : ''}`}
      aria-label="Add to collection"
      title="Add to collection"
      aria-expanded={picking}
      onClick={(e) => { e.stopPropagation(); setPicking(!picking); }}
    >
      <Icon icon={FolderAddIcon} size={16} />
    </button>
  );
  const open = (e: React.MouseEvent | React.KeyboardEvent) => {
    if ((e.target as Element).closest('.picker, .cardpicker')) return;
    onOpen();
  };
  // The whole card is clickable with a mouse; keyboard users reach the name button.
  const common = { onClick: open } as const;
  const nameBtn = <button className="namebtn" onClick={(e) => { e.stopPropagation(); onOpen(); }}>{name}</button>;
  const picker = picking && (
    <div className="cardpicker" style={{ padding: wide ? '10px 0 0' : '10px' }}>
      <CollectionPicker savedId={savedId} />
    </div>
  );
  if (wide) {
    return (
      <div className={`lrow${tester.invert ? ' invert' : ''}`} {...common}>
        <span className="lhead">
          <span className="meta">
            <b>{nameBtn}</b>
            <span className={`lic ${badge.tone}`}><i />{badge.text}</span>
            <span className="label">{CLASS_LABEL[f.classification]} · {SOURCE_LABEL[f.source]}</span>
            {onGoogle && <span className="gtag">On Google Fonts</span>}
          </span>
          {addBtn}
        </span>
        <span dir="auto" className={`prev specimen${tester.invert ? ' invert' : ''}`} style={{ fontFamily: preview.css, fontSize: tester.size, padding: 0, textAlign: tester.align === 'center' ? 'center' : 'left' }}>
          {sampleText(tester, name)}
        </span>
        {f.kind !== 'generic' && <MissingNote css={preview.css} text={sampleText(tester, name)} ready={preview.ready && !preview.failed} tester={tester} name={name} style={{ margin: 0 }} />}
        {picker}
      </div>
    );
  }
  return (
    <div className={`lcard${tester.invert ? ' invert' : ''}`} {...common}>
      <span dir="auto" className={`prev specimen${tester.invert ? ' invert' : ''}`} style={{ fontFamily: preview.css, fontSize: Math.min(tester.size, 40), justifyContent: tester.align === 'center' ? 'center' : 'flex-start' }}>
        {sampleText(tester, name)}
      </span>
      {f.kind !== 'generic' && <MissingNote css={preview.css} text={sampleText(tester, name)} ready={preview.ready && !preview.failed} tester={tester} name={name} style={{ margin: '0 10px 8px' }} />}
      <span className="meta">
        <span className="row" style={{ alignItems: 'flex-start', gap: 4 }}>
          <b className="grow">{nameBtn}</b>
          {addBtn}
        </span>
        <span className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <span className={`lic ${badge.tone}`}><i />{badge.text}</span>
          <span className="label">{CLASS_LABEL[f.classification]}</span>
          {onGoogle && <span className="gtag">On Google Fonts</span>}
        </span>
      </span>
      {picker}
    </div>
  );
}

/** Pick saved fonts to put in a collection. */
function AddFonts({ collectionId, name, saved, byId, onDone }: { collectionId: number; name: string; saved: SavedFont[]; byId: Map<string, FontRecord>; onDone: () => void }) {
  const toggle = async (s: SavedFont) => {
    const has = s.collectionIds.includes(collectionId);
    await db.savedFonts.update(s.id!, { collectionIds: has ? s.collectionIds.filter((c) => c !== collectionId) : [...s.collectionIds, collectionId], updatedAt: Date.now() });
  };
  return (
    <div className="section">
      <h2>[Add fonts to {name}]</h2>
      {saved.length === 0 ? (
        <span className="muted" style={{ fontSize: 12 }}>Save some fonts first, from the Page tab or the hover card.</span>
      ) : (
        <div className="chips">
          {saved.map((s) => {
            const f = byId.get(s.fontId);
            if (!f) return null;
            const on = s.collectionIds.includes(collectionId);
            return (
              <button key={s.id} className={`chip${on ? ' on' : ''}`} aria-pressed={on} onClick={() => toggle(s)}>
                {on ? <Icon icon={Tick02Icon} size={13} stroke={2} /> : <Icon icon={PlusSignIcon} size={13} />}
                {f.displayName ?? f.family}
              </button>
            );
          })}
        </div>
      )}
      <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={onDone}>Done</button>
    </div>
  );
}
