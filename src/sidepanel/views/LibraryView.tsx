import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CLASS_LABEL, SOURCE_LABEL, licenseBadge } from '../../shared/catalog';
import { db, deleteCollection } from '../../shared/db';
import {
  ArrowDown01Icon, ArrowLeft01Icon, ArrowUpRight01Icon, Cancel01Icon, Clock01Icon, ContrastIcon, DashboardSquare01Icon, Delete02Icon, Download01Icon,
  GridViewIcon, LanguageSquareIcon, LibBookmarkAddIcon, LibEditIcon, LibFilterIcon, LibFolderIcon, LibMoreIcon, Menu01Icon, PencilEdit01Icon,
  PlusSignIcon, Search01Icon, TextAlignCenterIcon, TextAlignLeftIcon, Tick02Icon, Upload01Icon, ArrowReloadHorizontalIcon,
} from '../../shared/icons';
import type { Classification, Collection, FontRecord, SavedFont, SourceKind } from '../../shared/types';
import { Icon } from '../components/Icon';
import { exportLibrary, importLibrary } from '../lib/backup';
import { downloadBlob } from '../lib/cards';
import { MissingNote } from '../components/MissingNote';
import { DEFAULT_TESTER, sampleText, type TesterState } from '../components/Tester';
import { LANGUAGE_SAMPLES } from '../lib/samples';
import { usePreviewFamily } from '../lib/preview';
import { FontPill, MAX_COLLECTION_NAME, SWATCHES, previewSource, useDismiss } from '../components/CollectionPicker';

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

const CLASSES: Classification[] = ['serif', 'sans', 'mono', 'display', 'script', 'unknown'];
const LICENSES: { value: Exclude<LicenseFilter, 'all'>; label: string }[] = [
  { value: 'free', label: 'Free' },
  { value: 'commercial', label: 'Paid' },
  { value: 'system', label: 'System font' },
  { value: 'unknown', label: 'Unknown' },
];
const sourceLabel = (s: Exclude<SourceFilter, 'all'>) => (s === 'on-google' ? 'On Google Fonts' : SOURCE_LABEL[s]);
const fontsWord = (n: number) => `${n} ${n === 1 ? 'font' : 'fonts'}`;

interface Editor {
  /** null: a new collection. */
  id: number | null;
  name: string;
  color: string;
  /** Saved font ids in the collection. */
  picks: Set<number>;
}

interface Props {
  tester: TesterState;
  onTester: (t: TesterState) => void;
  onOpen: (fontId: string) => void;
  onBoards: () => void;
  onSeen: () => void;
  toast: (m: string) => void;
}

export function LibraryView({ tester, onTester, onOpen, onBoards, onSeen, toast }: Props) {
  const savedQ = useLiveQuery(() => db.savedFonts.orderBy('createdAt').reverse().toArray(), []);
  const saved = savedQ ?? [];
  const fonts = useLiveQuery(() => db.fonts.toArray(), []) ?? [];
  const collections = useLiveQuery(() => db.collections.orderBy('createdAt').toArray(), []) ?? [];
  const boardCount = useLiveQuery(() => db.boards.count(), []) ?? 0;
  const seenCount = useLiveQuery(async () => {
    const names = new Set<string>();
    await db.seen.each((f) => names.add((f.catalogFamily ?? f.displayName).toLowerCase()));
    return names.size;
  }, []) ?? 0;
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
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [menu, setMenu] = useState<null | 'lib' | 'col'>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editor, setEditor] = useState<Editor | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const libMenuRef = useDismiss<HTMLSpanElement>(menu === 'lib', () => setMenu(null));
  const colMenuRef = useDismiss<HTMLSpanElement>(menu === 'col', () => setMenu(null));
  const rowRef = useRef<HTMLDivElement>(null);

  const byId = useMemo(() => new Map(fonts.map((f) => [f.id, f])), [fonts]);
  const all = useMemo(
    () => saved.map((s) => ({ s, f: byId.get(s.fontId) })).filter((x): x is { s: SavedFont; f: FontRecord } => !!x.f),
    [saved, byId],
  );
  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all.filter(({ s, f }) => {
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
  }, [all, query, cls, lic, src, collection, collections]);

  const counts = useMemo(() => {
    const m = new Map<number, number>();
    for (const s of saved) for (const c of s.collectionIds) m.set(c, (m.get(c) ?? 0) + 1);
    return m;
  }, [saved]);

  // Sources to filter by: the ones your fonts come from (and the one chosen).
  const sources = useMemo(() => {
    const set = new Set<SourceKind>(all.map(({ f }) => f.source));
    if (src !== 'all' && src !== 'on-google') set.add(src);
    return (Object.keys(SOURCE_LABEL) as SourceKind[]).filter((k) => set.has(k));
  }, [all, src]);

  const activeCollection = collections.find((c) => c.id === collection);
  const active: { key: 'cls' | 'lic' | 'src'; label: string; clear: () => void }[] = [
    ...(cls !== 'all' ? [{ key: 'cls' as const, label: CLASS_LABEL[cls], clear: () => setCls('all') }] : []),
    ...(lic !== 'all' ? [{ key: 'lic' as const, label: LICENSES.find((l) => l.value === lic)!.label, clear: () => setLic('all') }] : []),
    ...(src !== 'all' ? [{ key: 'src' as const, label: sourceLabel(src), clear: () => setSrc('all') }] : []),
  ];
  const clearFilters = () => { setCls('all'); setLic('all'); setSrc('all'); };

  // The chosen collection scrolls into view in its row.
  useEffect(() => {
    const row = rowRef.current;
    const on = row?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!row || !on) return;
    const left = on.offsetLeft;
    const right = left + on.offsetWidth;
    if (left < row.scrollLeft + 12 || right > row.scrollLeft + row.clientWidth - 24) row.scrollTo({ left: Math.max(0, left - 60) });
  }, [collection, collections.length]);

  const openEditor = (c: Collection | null, preselect?: number) => {
    setMenu(null);
    setEditor(
      c
        ? { id: c.id!, name: c.name, color: c.color, picks: new Set(saved.filter((s) => s.collectionIds.includes(c.id!)).map((s) => s.id!)) }
        : { id: null, name: '', color: SWATCHES[collections.length % SWATCHES.length], picks: new Set(preselect != null ? [preselect] : []) },
    );
    window.scrollTo(0, 0);
  };

  const doExport = async () => {
    setMenu(null);
    const data = await exportLibrary();
    downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), `font-finder-plus-library-${new Date().toISOString().slice(0, 10)}.json`);
    toast(`Exported ${data.savedFonts.length} fonts, ${data.collections.length} collections and ${data.boards.length} boards`);
  };
  const importInput = (
    <input
      ref={fileRef}
      type="file"
      accept="application/json,.json"
      aria-label="Import a library file"
      hidden
      onChange={async (e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        setMenu(null);
        if (!file) return;
        try {
          const r = await importLibrary(JSON.parse(await file.text()));
          toast(`Imported ${r.fonts} new ${r.fonts === 1 ? 'font' : 'fonts'}${r.merged ? `, merged ${r.merged}` : ''}, ${r.collections} new collections, ${r.boards} boards`);
        } catch (err) {
          toast(err instanceof SyntaxError ? 'This file is not valid JSON.' : err instanceof Error ? err.message : 'Could not import this file.');
        }
      }}
    />
  );

  if (editor) {
    return (
      <div className="libv">
        {importInput}
        <CollectionEditor
          editor={editor}
          onChange={setEditor}
          all={all}
          original={collections.find((c) => c.id === editor.id)}
          onDone={(id, msg) => { setEditor(null); if (id != null) setCollection(id); else setCollection('all'); toast(msg); window.scrollTo(0, 0); }}
          onBack={() => setEditor(null)}
        />
      </div>
    );
  }

  const tiles = (
    <div className="libtiles">
      <button className="libtile" onClick={onBoards}>
        <span className="ic"><Icon icon={DashboardSquare01Icon} size={16} /></span>
        <span className="t"><b>Boards</b><span>{boardCount ? `${boardCount} ${boardCount === 1 ? 'board' : 'boards'}` : 'None yet'}</span></span>
      </button>
      <button className="libtile" onClick={onSeen}>
        <span className="ic"><Icon icon={Clock01Icon} size={16} /></span>
        <span className="t"><b>Fonts I've seen</b><span>{seenCount ? fontsWord(seenCount) : 'Nothing yet'}</span></span>
      </button>
    </div>
  );

  // Wait for the library to load, so the empty layout never flashes and then jumps.
  if (savedQ === undefined) return <div className="libv" aria-busy="true" />;
  if (saved.length === 0) {
    return (
      <div className="libv">
        {importInput}
        <section className="empty">
          <span className="eic"><Icon icon={LibBookmarkAddIcon} size={24} /></span>
          <div className="et">
            <h2>Your library is empty</h2>
            <p>Save the fonts you like and they collect here, with where you found them. Everything stays on this computer.</p>
          </div>
          <ol className="steps">
            <li><span className="n">1</span><span>Hover text on any page and click Save on the card</span></li>
            <li><span className="n">2</span><span>Or press the bookmark on a font in the Page tab</span></li>
          </ol>
          <div className="eacts">
            <button className="btn" onClick={() => fileRef.current?.click()}><Icon icon={Upload01Icon} size={15} />Import a library file</button>
            <button className="btn" onClick={() => openEditor(null)}><Icon icon={PlusSignIcon} size={15} />New collection</button>
          </div>
        </section>
        {tiles}
      </div>
    );
  }

  const inCollection = activeCollection ? counts.get(activeCollection.id!) ?? 0 : 0;

  return (
    <div className="libv">
      {importInput}
      <div className="libsearch">
        <span className="s"><Icon icon={Search01Icon} size={16} /></span>
        <input id="lib-search" type="text" aria-label="Search your library" placeholder={`Search ${fontsWord(saved.length).replace('font', 'saved font')}`} value={query} onChange={(e) => setQuery(e.target.value)} />
        <button
          className={`iconbtn sm tip${filtersOpen || active.length ? ' on' : ''}`}
          data-tip="Filters"
          aria-label="Filters"
          aria-expanded={filtersOpen}
          onClick={() => setFiltersOpen(!filtersOpen)}
        >
          <Icon icon={LibFilterIcon} size={16} />
          {!!active.length && <span className="dotbadge" />}
        </button>
        <div className="viewtoggle" role="group" aria-label="Layout">
          <button aria-pressed={view === 'grid'} aria-label="Grid" title="Grid" onClick={() => setView('grid')}><Icon icon={GridViewIcon} size={15} /></button>
          <button aria-pressed={view === 'list'} aria-label="Wide list" title="Wide list" onClick={() => setView('list')}><Icon icon={Menu01Icon} size={15} /></button>
        </div>
        <span className="anchor" ref={libMenuRef}>
          <button className="iconbtn sm tip tipr" data-tip="More" aria-label="More" aria-expanded={menu === 'lib'} onClick={() => setMenu(menu === 'lib' ? null : 'lib')}>
            <Icon icon={LibMoreIcon} size={16} />
          </button>
          {menu === 'lib' && (
            <div className="lmenu" role="menu">
              <button role="menuitem" title="Save your library as a file, to back it up or move it to another computer" onClick={doExport}><Icon icon={Download01Icon} size={16} />Export library</button>
              <button role="menuitem" title="Add fonts from a Font Finder Plus library file" onClick={() => fileRef.current?.click()}><Icon icon={Upload01Icon} size={16} />Import a library file</button>
              <div className="sep" />
              <button role="menuitem" onClick={() => openEditor(null)}><Icon icon={PlusSignIcon} size={16} />New collection</button>
            </div>
          )}
        </span>
      </div>

      <div className="colrow" ref={rowRef} role="group" aria-label="Collections">
        <button className="chip newcol" onClick={() => openEditor(null)}><Icon icon={PlusSignIcon} size={14} />New collection</button>
        <button className="chip" aria-pressed={collection === 'all'} onClick={() => { setCollection('all'); setConfirmDelete(false); }}>All <span className="n">{saved.length}</span></button>
        {collections.map((c) => (
          <button key={c.id} className="chip" title={c.name} aria-pressed={collection === c.id} onClick={() => { setCollection(c.id!); setConfirmDelete(false); setMenu(null); }}>
            <span className="sw" style={{ background: c.color }} />
            <span className="cn">{c.name}</span>
            <span className="n">{counts.get(c.id!) ?? 0}</span>
          </button>
        ))}
      </div>

      {tiles}

      {filtersOpen && (
        <section className="section libfilters" aria-label="Filters">
          <div className="fhead">
            <h2>Filters</h2>
            <button className="iconbtn sm tip tipr" data-tip="Close" aria-label="Close filters" onClick={() => setFiltersOpen(false)}><Icon icon={Cancel01Icon} size={16} /></button>
          </div>
          <div className="fgroup">
            <span>Style</span>
            <div className="chips">
              <button className="chip" aria-pressed={cls === 'all'} onClick={() => setCls('all')}>All</button>
              {CLASSES.map((c) => <button key={c} className="chip" aria-pressed={cls === c} onClick={() => setCls(c)}>{CLASS_LABEL[c]}</button>)}
            </div>
          </div>
          <div className="fgroup">
            <span>Licence</span>
            <div className="chips">
              <button className="chip" aria-pressed={lic === 'all'} onClick={() => setLic('all')}>Any</button>
              {LICENSES.map((l) => <button key={l.value} className="chip" aria-pressed={lic === l.value} onClick={() => setLic(l.value)}>{l.label}</button>)}
            </div>
          </div>
          <div className="fgroup">
            <span>Where it comes from</span>
            <div className="chips">
              <button className="chip" aria-pressed={src === 'all'} onClick={() => setSrc('all')}>Any</button>
              <button className="chip" aria-pressed={src === 'on-google'} onClick={() => setSrc('on-google')}>On Google Fonts</button>
              {sources.map((k) => <button key={k} className="chip" aria-pressed={src === k} onClick={() => setSrc(k)}>{SOURCE_LABEL[k]}</button>)}
            </div>
          </div>
          <div className="ffoot">
            <button className="linkbtn" disabled={!active.length} onClick={clearFilters}>Clear filters</button>
            <button className="btn sm primary" onClick={() => setFiltersOpen(false)}>Show {fontsWord(items.length)}</button>
          </div>
        </section>
      )}

      {!filtersOpen && active.length > 0 && (
        <div className="activef">
          {active.map((a) => (
            <button key={a.key} className="chip on" aria-label={`Remove filter ${a.label}`} onClick={a.clear}>{a.label}<Icon icon={Cancel01Icon} size={14} /></button>
          ))}
          <button className="linkbtn" onClick={clearFilters}>Clear all</button>
        </div>
      )}

      {activeCollection && (
        <section className="colbar">
          {confirmDelete ? (
            <>
              <span className="grow">Delete “{activeCollection.name}”? Its fonts stay in your library.</span>
              <button className="btn sm" onClick={() => setConfirmDelete(false)}>Cancel</button>
              <button className="btn sm dangerfill" onClick={async () => { const n = activeCollection.name; await deleteCollection(activeCollection.id!); setCollection('all'); setConfirmDelete(false); toast(`Deleted ${n}. Its fonts stay in your library.`); }}>Delete</button>
            </>
          ) : (
            <>
              <span className="sw" style={{ background: activeCollection.color }} />
              <b><span className="cn" title={activeCollection.name}>{activeCollection.name}</span><span className="n">{fontsWord(inCollection)}</span></b>
              <button className="btn sm primary" onClick={() => openEditor(activeCollection)}><Icon icon={PlusSignIcon} size={14} />Add fonts</button>
              <span className="anchor" ref={colMenuRef}>
                <button className="iconbtn sm tip tipr" data-tip="More" aria-label="Collection options" aria-expanded={menu === 'col'} onClick={() => setMenu(menu === 'col' ? null : 'col')}>
                  <Icon icon={LibMoreIcon} size={16} />
                </button>
                {menu === 'col' && (
                  <div className="lmenu" role="menu">
                    <button role="menuitem" onClick={() => openEditor(activeCollection)}><Icon icon={LibEditIcon} size={16} />Rename or change colour</button>
                    <div className="sep" />
                    <button role="menuitem" className="danger" onClick={() => { setMenu(null); setConfirmDelete(true); }}><Icon icon={Delete02Icon} size={16} />Delete collection</button>
                  </div>
                )}
              </span>
            </>
          )}
        </section>
      )}

      <PreviewBar value={tester} onChange={onTester} />

      {activeCollection && inCollection === 0 ? (
        <section className="empty">
          <span className="eic"><Icon icon={LibFolderIcon} size={24} /></span>
          <div className="et">
            <h2>Nothing in {activeCollection.name} yet</h2>
            <p>Add fonts from your library. A font can be in as many collections as you like.</p>
          </div>
          <div className="eacts"><button className="btn primary" onClick={() => openEditor(activeCollection)}><Icon icon={PlusSignIcon} size={15} />Add fonts</button></div>
        </section>
      ) : items.length === 0 ? (
        <section className="empty">
          <div className="et">
            <h2>No fonts match</h2>
            <p>Try another word, or clear the filters.</p>
          </div>
          <div className="eacts"><button className="btn sm" onClick={() => { clearFilters(); setQuery(''); }}>Clear filters</button></div>
        </section>
      ) : (
        <div className={view === 'grid' ? 'grid2' : 'list'}>
          {items.map(({ s, f }) => (
            <LibraryCard
              key={s.id}
              f={f}
              s={s}
              collections={collections}
              tester={tester}
              wide={view === 'list'}
              onOpen={() => onOpen(f.id)}
              onNewCollection={() => openEditor(null, s.id)}
              toast={toast}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** Type to preview, size, and the rest of the sample options folded into a menu. */
function PreviewBar({ value, onChange }: { value: TesterState; onChange: (t: TesterState) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss<HTMLSpanElement>(open, () => setOpen(false));
  const set = (p: Partial<TesterState>) => onChange({ ...value, ...p });
  const changed = value.mode === 'language' || value.align !== 'left' || value.invert;
  return (
    <div className="libtester">
      <Icon icon={PencilEdit01Icon} size={16} />
      <input
        id="tester-text"
        type="text"
        aria-label="Preview text"
        placeholder={value.mode === 'language' ? 'Type to preview' : 'Type to preview'}
        value={value.text}
        onChange={(e) => set({ text: e.target.value, mode: e.target.value ? 'mine' : 'names' })}
      />
      <span className="px">{value.size}px</span>
      <input type="range" aria-label="Preview size" min={14} max={72} value={value.size} onChange={(e) => set({ size: Number(e.target.value) })} />
      <span className="anchor" ref={ref}>
        <button className={`iconbtn sm tip tipr${changed ? ' on' : ''}`} data-tip="Preview options" aria-label="Preview options" aria-expanded={open} onClick={() => setOpen(!open)}>
          <Icon icon={ArrowDown01Icon} size={16} />
        </button>
        {open && (
          <div className="lmenu wide" role="menu">
            <div className="mlbl">Show</div>
            <button role="menuitemradio" aria-checked={value.mode === 'names'} title="Show each font's own name" onClick={() => set({ mode: 'names' })}>Font name{value.mode === 'names' && <span className="tick"><Icon icon={Tick02Icon} size={15} /></span>}</button>
            <button role="menuitemradio" aria-checked={value.mode === 'mine'} title="Show the text you typed" onClick={() => set({ mode: 'mine' })}>Your text{value.mode === 'mine' && <span className="tick"><Icon icon={Tick02Icon} size={15} /></span>}</button>
            <label className="mselect">
              <Icon icon={LanguageSquareIcon} size={16} />
              <select
                aria-label="Language sample"
                value={value.mode === 'language' ? value.lang : ''}
                onChange={(e) => set(e.target.value ? { mode: 'language', lang: e.target.value } : { mode: 'names' })}
              >
                <option value="">A language sample…</option>
                {LANGUAGE_SAMPLES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
              </select>
            </label>
            <div className="sep" />
            <button role="menuitemradio" aria-checked={value.align === 'left'} onClick={() => set({ align: 'left' })}><Icon icon={TextAlignLeftIcon} size={16} />Align left{value.align === 'left' && <span className="tick"><Icon icon={Tick02Icon} size={15} /></span>}</button>
            <button role="menuitemradio" aria-checked={value.align === 'center'} onClick={() => set({ align: 'center' })}><Icon icon={TextAlignCenterIcon} size={16} />Align centre{value.align === 'center' && <span className="tick"><Icon icon={Tick02Icon} size={15} /></span>}</button>
            <button role="menuitemcheckbox" aria-checked={value.invert} onClick={() => set({ invert: !value.invert })}><Icon icon={ContrastIcon} size={16} />Light text on dark{value.invert && <span className="tick"><Icon icon={Tick02Icon} size={15} /></span>}</button>
            <div className="sep" />
            <button role="menuitem" onClick={() => { onChange({ ...DEFAULT_TESTER, mode: 'names', size: 36 }); setOpen(false); }}><Icon icon={ArrowReloadHorizontalIcon} size={16} />Reset preview</button>
          </div>
        )}
      </span>
    </div>
  );
}

function LibraryCard({ f, s, collections, tester, wide, onOpen, onNewCollection, toast }: {
  f: FontRecord;
  s: SavedFont;
  collections: Collection[];
  tester: TesterState;
  wide: boolean;
  onOpen: () => void;
  onNewCollection: () => void;
  toast: (m: string) => void;
}) {
  const [menu, setMenu] = useState(false);
  const ref = useDismiss<HTMLDivElement>(menu, () => setMenu(false));
  const preview = usePreviewFamily(previewSource(f), null);
  const badge = licenseBadge(f.licenseType);
  const name = f.displayName ?? f.family;
  const onGoogle = !!f.catalogFamily || f.source === 'google';
  const text = sampleText(tester, name);
  const toggle = async (c: Collection) => {
    const cur = (await db.savedFonts.get(s.id!))?.collectionIds ?? [];
    const has = cur.includes(c.id!);
    await db.savedFonts.update(s.id!, { collectionIds: has ? cur.filter((x) => x !== c.id) : [...cur, c.id!], updatedAt: Date.now() });
    toast(has ? `Removed ${name} from ${c.name}` : `Added ${name} to ${c.name}`);
  };
  const open = (e: React.MouseEvent) => {
    if ((e.target as Element).closest('.lmenu, .more')) return;
    onOpen();
  };
  const menuEl = menu && (
    <div className={`lmenu cardmenu${wide ? '' : ' incard'}`} role="menu" onClick={(e) => e.stopPropagation()}>
      <div className="mlbl">Add to collection</div>
      <div className="mlist">
        {collections.map((c) => {
          const on = s.collectionIds.includes(c.id!);
          return (
            <button key={c.id} role="menuitemcheckbox" aria-checked={on} className="mcol" onClick={() => toggle(c)}>
              <span className="mdot" style={{ background: c.color }} />
              <span className="mname">{c.name}</span>
              {on && <span className="tick"><Icon icon={Tick02Icon} size={15} /></span>}
            </button>
          );
        })}
      </div>
      <button role="menuitem" onClick={() => { setMenu(false); onNewCollection(); }}><Icon icon={PlusSignIcon} size={16} />New collection…</button>
      <div className="sep" />
      <button role="menuitem" onClick={() => { setMenu(false); onOpen(); }}><Icon icon={ArrowUpRight01Icon} size={16} />Open details</button>
      <button role="menuitem" className="danger" onClick={async () => { setMenu(false); await db.savedFonts.delete(s.id!); toast(`Removed ${name} from your library`); }}>
        <Icon icon={Delete02Icon} size={16} />Remove
      </button>
    </div>
  );
  const more = (
    <span className="anchor moreanchor">
      <button className="iconbtn sm more" aria-label={`Options for ${name}`} aria-expanded={menu} onClick={(e) => { e.stopPropagation(); setMenu(!menu); }}>
        <Icon icon={LibMoreIcon} size={16} />
      </button>
      {wide && menuEl}
    </span>
  );
  const nameBtn = <button className="namebtn" onClick={(e) => { e.stopPropagation(); onOpen(); }}>{name}</button>;
  const missing = f.kind !== 'generic' && (
    <MissingNote css={preview.css} text={text} ready={preview.ready && !preview.failed} tester={tester} name={name} style={{ margin: 0 }} />
  );
  const align = tester.align === 'center' ? 'center' : 'left';

  if (wide) {
    return (
      <div ref={ref} className={`lrow${menu ? ' menuopen' : ''}`} onClick={open}>
        <div className="nm">
          <b>{nameBtn}</b>
          <span className={`lic ${badge.tone}`}><i />{badge.text}</span>
          <span className="s">{CLASS_LABEL[f.classification]} · {SOURCE_LABEL[f.source]}{onGoogle && f.source !== 'google' ? ' · On Google Fonts' : ''}</span>
          {more}
        </div>
        <div dir="auto" className={`spec${tester.invert ? ' invert' : ''}`} style={{ fontFamily: preview.css, fontSize: tester.size, textAlign: align }}>{text}</div>
        {missing}
      </div>
    );
  }
  return (
    <div ref={ref} className={`lcard${menu ? ' menuopen' : ''}`} onClick={open}>
      <div dir="auto" className={`spec${tester.invert ? ' invert' : ''}`} style={{ fontFamily: preview.css, fontSize: Math.min(tester.size, 40), justifyContent: align === 'center' ? 'center' : 'flex-start', textAlign: align }}>
        <span>{text}</span>
      </div>
      {missing}
      <div className="meta">
        <div className="nm"><b>{nameBtn}</b></div>
        <div className="sm2">
          <span className={`lic ${badge.tone}`}><i />{badge.text}</span>
          <span>{CLASS_LABEL[f.classification]}</span>
        </div>
      </div>
      {more}
      {menuEl}
    </div>
  );
}

/** New collection, or rename one, change its colour and pick its fonts. */
function CollectionEditor({ editor: e, onChange, all, original, onDone, onBack }: {
  editor: Editor;
  onChange: (e: Editor) => void;
  all: { s: SavedFont; f: FontRecord }[];
  original: Collection | undefined;
  onDone: (id: number | null, message: string) => void;
  onBack: () => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const isNew = e.id == null;
  const n = e.picks.size;
  const set = (p: Partial<Editor>) => onChange({ ...e, ...p });
  const toggle = (id: number) => {
    const picks = new Set(e.picks);
    if (picks.has(id)) picks.delete(id);
    else picks.add(id);
    set({ picks });
  };
  const colours = original && !SWATCHES.includes(original.color) ? [original.color, ...SWATCHES] : SWATCHES;
  const save = async () => {
    const name = e.name.trim();
    if (!name) return;
    const id = await db.transaction('rw', db.collections, db.savedFonts, async () => {
      let cid = e.id;
      if (cid == null) cid = await db.collections.add({ name, color: e.color, createdAt: Date.now() });
      else await db.collections.update(cid, { name, color: e.color });
      const now = Date.now();
      for (const s of await db.savedFonts.toArray()) {
        const has = s.collectionIds.includes(cid);
        const want = e.picks.has(s.id!);
        if (has !== want) await db.savedFonts.update(s.id!, { collectionIds: want ? [...s.collectionIds, cid] : s.collectionIds.filter((c) => c !== cid), updatedAt: now });
      }
      return cid;
    });
    onDone(id, isNew ? `Created ${name}` : 'Saved');
  };
  const title = isNew ? 'New collection' : original?.name ?? 'Collection';
  return (
    <>
      <div className="subtop">
        <button className="backbtn tip" data-tip="Back" aria-label="Back" onClick={onBack}><Icon icon={ArrowLeft01Icon} size={18} /></button>
        <span className="crumb"><span>Library</span><span className="sl">/</span><b>{title}</b></span>
      </div>
      <section className="section">
        <label className="fld">
          <span className="fl"><span>Name</span><span className={`cc${e.name.length > MAX_COLLECTION_NAME ? ' over' : ''}`}>{e.name.length}/{MAX_COLLECTION_NAME}</span></span>
          <input className="field" type="text" aria-label="Collection name" maxLength={Math.max(MAX_COLLECTION_NAME, e.name.length)} placeholder="For example: Client pitch" value={e.name} autoFocus={isNew} onChange={(ev) => set({ name: ev.target.value })} onKeyDown={(ev) => ev.key === 'Enter' && save()} />
        </label>
        <div className="fld">
          <span>Colour</span>
          <div className="lswatches" role="radiogroup" aria-label="Colour">
            {colours.map((c) => (
              <button key={c} type="button" role="radio" aria-checked={e.color === c} aria-label={`Colour ${c}`} style={{ '--c': c } as React.CSSProperties} onClick={() => set({ color: c })} />
            ))}
          </div>
        </div>
      </section>
      <section className="section" style={{ gap: 12 }}>
        <div className="sechead">
          <h2>Fonts in this collection</h2>
          <span className="count">{n} added</span>
          {n > 0 && <button className="linkbtn" onClick={() => set({ picks: new Set() })}>Clear</button>}
        </div>
        <div className="chips addpills">
          {all.map(({ s, f }) => <FontPill key={s.id} rec={f} on={e.picks.has(s.id!)} onClick={() => toggle(s.id!)} />)}
        </div>
      </section>
      <button className="btn primary wide stickysave" disabled={!e.name.trim()} onClick={save}>
        {isNew ? `Create collection${n ? ` with ${fontsWord(n)}` : ''}` : 'Save changes'}
      </button>
      {!isNew && (
        confirm ? (
          <div className="confirmrow" role="alert">
            <span className="grow">Delete “{original?.name}”? Its fonts stay in your library.</span>
            <button className="btn sm" onClick={() => setConfirm(false)}>Cancel</button>
            <button className="btn sm dangerfill" onClick={async () => { await deleteCollection(e.id!); onDone(null, `Deleted ${original?.name ?? 'the collection'}. Its fonts stay in your library.`); }}>Delete</button>
          </div>
        ) : (
          <button className="linkbtn danger delcol" onClick={() => setConfirm(true)}><Icon icon={Delete02Icon} size={15} />Delete collection</button>
        )
      )}
    </>
  );
}
