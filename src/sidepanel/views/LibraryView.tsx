import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { CLASS_LABEL, SOURCE_LABEL, licenseBadge } from '../../shared/catalog';
import { db, deleteCollection } from '../../shared/db';
import { Search01Icon } from '../../shared/icons';
import type { Classification, FontRecord, SavedFont, SourceKind } from '../../shared/types';
import { Icon } from '../components/Icon';
import { Tester, sampleText, type TesterState } from '../components/Tester';
import { usePreviewFamily } from '../lib/preview';
import { NewCollectionInline } from './FontDetail';

type LicenseFilter = 'all' | 'free' | 'system' | 'commercial' | 'unknown';

interface Props {
  tester: TesterState;
  onTester: (t: TesterState) => void;
  onOpen: (fontId: string) => void;
}

export function LibraryView({ tester, onTester, onOpen }: Props) {
  const saved = useLiveQuery(() => db.savedFonts.orderBy('createdAt').reverse().toArray(), []) ?? [];
  const fonts = useLiveQuery(() => db.fonts.toArray(), []) ?? [];
  const collections = useLiveQuery(() => db.collections.orderBy('createdAt').toArray(), []) ?? [];
  const [query, setQuery] = useState('');
  const [cls, setCls] = useState<Classification | 'all'>('all');
  const [lic, setLic] = useState<LicenseFilter>('all');
  const [src, setSrc] = useState<SourceKind | 'all'>('all');
  const [collection, setCollection] = useState<number | 'all'>('all');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const byId = useMemo(() => new Map(fonts.map((f) => [f.id, f])), [fonts]);
  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    return saved
      .map((s) => ({ s, f: byId.get(s.fontId) }))
      .filter((x): x is { s: SavedFont; f: FontRecord } => !!x.f)
      .filter(({ s, f }) => {
        if (collection !== 'all' && !s.collectionIds.includes(collection)) return false;
        if (cls !== 'all' && f.classification !== cls) return false;
        if (src !== 'all' && f.source !== src) return false;
        if (lic !== 'all') {
          const free = ['OFL', 'APACHE', 'UFL'].includes(f.licenseType);
          if (lic === 'free' && !free) return false;
          if (lic === 'system' && f.licenseType !== 'system') return false;
          if (lic === 'commercial' && f.licenseType !== 'commercial') return false;
          if (lic === 'unknown' && f.licenseType !== 'unknown') return false;
        }
        if (q) {
          const names = collections.filter((c) => s.collectionIds.includes(c.id!)).map((c) => c.name.toLowerCase());
          const hay = [f.family, f.foundry ?? '', ...(f.designers ?? []), f.sourceHost ?? '', ...s.sitesSeen, s.notes, ...names].join(' ').toLowerCase();
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
        </label>
        <div className="filters" style={{ padding: '8px 0' }}>
          <select className="select" aria-label="Classification" value={cls} onChange={(e) => setCls(e.target.value as Classification | 'all')}>
            <option value="all">All styles</option>
            {(['serif', 'sans', 'mono', 'display', 'script', 'unknown'] as Classification[]).map((c) => (
              <option key={c} value={c}>{CLASS_LABEL[c]}</option>
            ))}
          </select>
          <select className="select" aria-label="License" value={lic} onChange={(e) => setLic(e.target.value as LicenseFilter)}>
            <option value="all">Any license</option>
            <option value="free">Free (open license)</option>
            <option value="commercial">Commercial</option>
            <option value="system">System font</option>
            <option value="unknown">Unknown</option>
          </select>
          <select className="select" aria-label="Source" value={src} onChange={(e) => setSrc(e.target.value as SourceKind | 'all')}>
            <option value="all">Any source</option>
            {(Object.keys(SOURCE_LABEL) as SourceKind[]).map((k) => (
              <option key={k} value={k}>{SOURCE_LABEL[k]}</option>
            ))}
          </select>
        </div>
      </div>

      <Tester value={tester} onChange={onTester} min={14} max={72} />

      <div className="chips">
        <button className={`chip${collection === 'all' ? ' on' : ''}`} onClick={() => setCollection('all')}>All <span className="mono">{saved.length}</span></button>
        {collections.map((c) => (
          <button key={c.id} className={`chip${collection === c.id ? ' on' : ''}`} onClick={() => { setCollection(c.id!); setRenaming(null); setConfirmDelete(false); }}>
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
              <button className="linkbtn" onClick={() => setRenaming(activeCollection.name)}>Rename</button>
              <button className="linkbtn" onClick={() => setConfirmDelete(true)}>Delete</button>
            </>
          )}
        </div>
      )}

      {saved.length === 0 ? (
        <div className="empty">
          <h2>Your library is empty</h2>
          <p>Save fonts from the Page tab or from the hover card on any website. They stay on this computer only.</p>
        </div>
      ) : items.length === 0 ? (
        <div className="notice neutral">No saved fonts match these filters.</div>
      ) : (
        <div className="grid2">
          {items.map(({ s, f }) => (
            <LibraryCard key={s.id} f={f} tester={tester} onOpen={() => onOpen(f.id)} />
          ))}
        </div>
      )}
    </>
  );
}

function LibraryCard({ f, tester, onOpen }: { f: FontRecord; tester: TesterState; onOpen: () => void }) {
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
  return (
    <button className={`lcard${tester.invert ? ' invert' : ''}`} onClick={onOpen}>
      <span className={`prev specimen${tester.invert ? ' invert' : ''}`} style={{ fontFamily: preview.css, fontSize: tester.size, justifyContent: tester.align === 'center' ? 'center' : 'flex-start' }}>
        {sampleText(tester, f.family)}
      </span>
      <span className="meta">
        <b>{f.family}</b>
        <span className="lic mono" style={{ fontSize: 9.5 }}>
          <span className={`lic ${badge.tone}`} style={{ fontSize: 9.5 }}><i /></span>
          {badge.text.toUpperCase()} · {CLASS_LABEL[f.classification].toUpperCase()} · {SOURCE_LABEL[f.source].toUpperCase()}
        </span>
      </span>
    </button>
  );
}
