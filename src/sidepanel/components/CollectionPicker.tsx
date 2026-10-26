import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { COLLECTION_COLORS, db } from '../../shared/db';
import { Tick02Icon } from '../../shared/icons';
import { Icon } from './Icon';

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
        <span className="muted" style={{ fontSize: 11.5 }}>
          {collections.length ? 'Add to collections. Pick as many as you like.' : 'Make a collection to group fonts, for example by project.'}
        </span>
      )}
      <div className="chips">
        {collections.map((c) => {
          const on = saved.collectionIds.includes(c.id!);
          return (
            <button key={c.id} className={`chip${on ? ' on' : ''}`} aria-pressed={on} onClick={(e) => { e.stopPropagation(); toggle(c.id!); }}>
              {on ? <Icon icon={Tick02Icon} size={13} stroke={2} /> : <span className="sq" style={{ background: c.color }} />}
              {c.name}
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
  const [color, setColor] = useState(COLLECTION_COLORS[0]);
  if (!open) {
    return (
      <button className="chip" onClick={(e) => { e.stopPropagation(); setOpen(true); }}>+ New collection</button>
    );
  }
  const create = async () => {
    const n = name.trim();
    if (!n) return;
    const id = await db.collections.add({ name: n, color, createdAt: Date.now() });
    setOpen(false);
    setName('');
    onCreated?.(id);
  };
  return (
    <div className="stack" style={{ gap: 6, width: '100%' }} onClick={(e) => e.stopPropagation()}>
      <input className="field" autoFocus placeholder="Collection name" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && create()} aria-label="Collection name" />
      <div className="row">
        <div className="swatches" role="group" aria-label="Collection colour">
          {COLLECTION_COLORS.map((c) => (
            <button key={c} className="swatch" style={{ background: c }} aria-label={`Colour ${c}`} aria-pressed={color === c} onClick={() => setColor(c)} />
          ))}
        </div>
        <span className="grow" />
        <button className="btn sm ghost" onClick={() => setOpen(false)}>Cancel</button>
        <button className="btn sm primary" onClick={create} disabled={!name.trim()}>Create</button>
      </div>
    </div>
  );
}

