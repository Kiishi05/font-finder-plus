import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState } from 'react';
import { db } from '../../shared/db';
import { PlusSignIcon, Tick02Icon } from '../../shared/icons';
import type { FontRecord } from '../../shared/types';
import { usePreviewFamily, type PreviewSource } from '../lib/preview';
import { Icon } from './Icon';

/** Collection colours, as in the approved design. */
export const SWATCHES = ['#3b5bdb', '#2f9e44', '#e8590c', '#c2255c', '#7048e8', '#0c8599', '#e67700', '#495057'];
/** Collection names stay short so they fit on one line. */
export const MAX_COLLECTION_NAME = 28;

/** What usePreviewFamily needs to show a saved font in its own face. */
export function previewSource(f: FontRecord): PreviewSource {
  return {
    family: f.family,
    kind: f.kind ?? (f.source === 'system' ? 'local' : 'web'),
    genericName: f.genericName,
    files: f.files?.length ? f.files : f.fileUrl ? [{ url: f.fileUrl, format: f.format ?? null, weight: '400', style: 'normal', unicodeRange: null }] : [],
  };
}

/** Close a menu or popover on a click outside it, or on Escape. */
export function useDismiss<T extends HTMLElement>(open: boolean, close: () => void) {
  const ref = useRef<T>(null);
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) closeRef.current();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
    };
    document.addEventListener('pointerdown', down);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', down);
      document.removeEventListener('keydown', key);
    };
  }, [open]);
  return ref;
}

/** A font as a pill, its name set in its own face, with a plus that becomes a tick. */
export function FontPill({ rec, on, onClick }: { rec: FontRecord; on: boolean; onClick: () => void }) {
  const preview = usePreviewFamily(previewSource(rec), null);
  const name = rec.displayName ?? rec.family;
  return (
    <button type="button" className="chip fpill" aria-pressed={on} aria-label={name} onClick={onClick}>
      <Icon icon={on ? Tick02Icon : PlusSignIcon} size={14} stroke={on ? 2 : 1.5} />
      <span className="pf" style={{ fontFamily: preview.css }}>{name}</span>
    </button>
  );
}

/** Toggle one saved font in and out of any number of collections. */
export function CollectionPicker({ savedId, hint = true }: { savedId: number; hint?: boolean }) {
  const saved = useLiveQuery(() => db.savedFonts.get(savedId), [savedId]);
  const collections = useLiveQuery(() => db.collections.orderBy('createdAt').toArray(), []) ?? [];
  if (!saved) return null;
  const toggle = async (id: number) => {
    const cur = (await db.savedFonts.get(savedId))?.collectionIds ?? [];
    const has = cur.includes(id);
    await db.savedFonts.update(savedId, { collectionIds: has ? cur.filter((c) => c !== id) : [...cur, id], updatedAt: Date.now() });
  };
  return (
    <div className="picker">
      {hint && (
        <span className="sub">
          {collections.length ? 'Add to collections. Pick as many as you like.' : 'Make a collection to group fonts, for example by project.'}
        </span>
      )}
      <div className="chips">
        {collections.map((c) => {
          const on = saved.collectionIds.includes(c.id!);
          return (
            <button key={c.id} className={`chip colchip${on ? ' on' : ''}`} aria-pressed={on} title={c.name} onClick={(e) => { e.stopPropagation(); toggle(c.id!); }}>
              {on ? <Icon icon={Tick02Icon} size={13} stroke={2} /> : <span className="sq" style={{ background: c.color }} />}
              <span className="cn">{c.name}</span>
            </button>
          );
        })}
        <NewCollectionInline onCreated={(id) => toggle(id)} />
      </div>
    </div>
  );
}

export function NewCollectionInline({ onCreated }: { onCreated?: (id: number) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const count = useLiveQuery(() => db.collections.count(), []) ?? 0;
  const [color, setColor] = useState<string | null>(null);
  const chosen = color ?? SWATCHES[count % SWATCHES.length];
  if (!open) {
    return (
      <button className="chip" onClick={(e) => { e.stopPropagation(); setOpen(true); }}>+ New collection</button>
    );
  }
  const create = async () => {
    const n = name.trim();
    if (!n) return;
    const id = await db.collections.add({ name: n, color: chosen, createdAt: Date.now() });
    setOpen(false);
    setName('');
    setColor(null);
    onCreated?.(id);
  };
  return (
    <div className="newcol-inline" onClick={(e) => e.stopPropagation()}>
      <label className="fld">
        <span className="fl"><span>Name</span><span className="cc">{name.length}/{MAX_COLLECTION_NAME}</span></span>
        <input className="field" autoFocus maxLength={MAX_COLLECTION_NAME} placeholder="For example: Client pitch" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && create()} aria-label="Collection name" />
      </label>
      <div className="swatches lswatches" role="radiogroup" aria-label="Collection colour">
        {SWATCHES.map((c) => (
          <button key={c} type="button" role="radio" style={{ '--c': c } as React.CSSProperties} aria-label={`Colour ${c}`} aria-checked={chosen === c} onClick={() => setColor(c)} />
        ))}
      </div>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn sm" onClick={() => setOpen(false)}>Cancel</button>
        <button className="btn sm primary" onClick={create} disabled={!name.trim()}>Create</button>
      </div>
    </div>
  );
}
