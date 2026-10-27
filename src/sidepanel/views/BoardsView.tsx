import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState } from 'react';
import { db } from '../../shared/db';
import { ArrowLeft01Icon, Delete02Icon, Download01Icon, PlusSignIcon, Tick02Icon } from '../../shared/icons';
import type { Board } from '../../shared/types';
import { Icon } from '../components/Icon';
import { canvasBlob, cardFontFor, downloadBlob, drawBoard, fontCssFor, slug, type Theme } from '../lib/cards';

export function BoardsView({ onBack, onOpen }: { onBack: () => void; onOpen: (id: number) => void }) {
  const boards = useLiveQuery(() => db.boards.orderBy('updatedAt').reverse().toArray(), []) ?? [];
  const create = async () => {
    const now = Date.now();
    const id = await db.boards.add({ name: 'Untitled board', fontIds: [], text: 'The quick brown fox jumps over the lazy dog', theme: 'light', createdAt: now, updatedAt: now });
    onOpen(id);
  };
  return (
    <>
      <div className="topbar">
        <button className="iconbtn" aria-label="Back" onClick={onBack}><Icon icon={ArrowLeft01Icon} /></button>
        <span className="label grow">[Library] / [Boards]</span>
        <button className="btn primary" style={{ height: 38, borderRadius: 12 }} onClick={create}><Icon icon={PlusSignIcon} size={15} />New board</button>
      </div>
      {!boards.length ? (
        <div className="empty">
          <h2>Specimen boards</h2>
          <p>A board shows several of your saved fonts together, in your own text, with each font's alphabet. Download it as an image to share or keep.</p>
          <button className="btn primary" onClick={create}>Make a board</button>
        </div>
      ) : (
        <div className="list">
          {boards.map((b) => (
            <button key={b.id} className="lrow" onClick={() => onOpen(b.id!)}>
              <span className="meta"><b>{b.name}</b><span className="label">{b.fontIds.length} {b.fontIds.length === 1 ? 'font' : 'fonts'} · {b.theme}</span></span>
              <span className="muted" style={{ fontSize: 12 }}>{b.text}</span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

export function BoardEditor({ id, onBack, toast }: { id: number; onBack: () => void; toast: (m: string) => void }) {
  const board = useLiveQuery(() => db.boards.get(id), [id]);
  const saved = useLiveQuery(() => db.savedFonts.orderBy('createdAt').reverse().toArray(), []) ?? [];
  const records = useLiveQuery(() => db.fonts.bulkGet(saved.map((s) => s.fontId)), [saved.map((s) => s.fontId).join('|')]) ?? [];
  const [watermark, setWatermark] = useState(true);
  const [confirm, setConfirm] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const timer = useRef<number>();

  const update = (patch: Partial<Board>) => db.boards.update(id, { ...patch, updatedAt: Date.now() });

  useEffect(() => {
    if (!board || !canvas.current) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      const recs = board.fontIds.map((f) => records.find((r) => r?.id === f)).filter((r): r is NonNullable<typeof r> => !!r);
      const fonts = await Promise.all(recs.map(async (r) => cardFontFor(r, await fontCssFor(r))));
      if (canvas.current) await drawBoard(canvas.current, { name: board.name, theme: board.theme, text: board.text, fonts, watermark });
    }, 150);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board, records.length, watermark]);

  if (board === undefined) return null;
  if (!board) return <div className="empty"><p>This board was deleted.</p><button className="btn" onClick={onBack}>Back</button></div>;

  const toggle = (fontId: string) => update({ fontIds: board.fontIds.includes(fontId) ? board.fontIds.filter((f) => f !== fontId) : [...board.fontIds, fontId] });

  return (
    <>
      <div className="topbar">
        <button className="iconbtn" aria-label="Back" onClick={onBack}><Icon icon={ArrowLeft01Icon} /></button>
        <span className="label grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>[Boards] / [{board.name}]</span>
      </div>
      <section className="section">
        <label className="stack" style={{ gap: 4 }}>
          <span className="label">[Board name]</span>
          <input className="field" value={board.name} onChange={(e) => update({ name: e.target.value })} aria-label="Board name" />
        </label>
        <label className="stack" style={{ gap: 4 }}>
          <span className="label">[Text]</span>
          <textarea className="field" rows={2} value={board.text} onChange={(e) => update({ text: e.target.value })} aria-label="Board text" />
        </label>
        <div className="seg" role="group" aria-label="Theme">
          {(['light', 'dark'] as Theme[]).map((t) => <button key={t} aria-pressed={board.theme === t} onClick={() => update({ theme: t as Board['theme'] })}>{t === 'light' ? 'Light' : 'Dark'}</button>)}
        </div>
        <div className="row">
          <span className="grow" style={{ fontSize: 12.5 }}>Watermark "Font Finder Plus"</span>
          <button className="switch" role="switch" aria-checked={watermark} aria-label="Watermark" onClick={() => setWatermark(!watermark)} />
        </div>
      </section>
      <section className="section">
        <h2>[Fonts on this board] {board.fontIds.length}</h2>
        {!saved.length && <span className="muted" style={{ fontSize: 12 }}>Save fonts to your library first. They then appear here to add.</span>}
        <div className="chips">
          {records.map((r) => {
            if (!r) return null;
            const on = board.fontIds.includes(r.id);
            return (
              <button key={r.id} className={`chip${on ? ' on' : ''}`} aria-pressed={on} onClick={() => toggle(r.id)}>
                {on ? <Icon icon={Tick02Icon} size={13} stroke={2} /> : <Icon icon={PlusSignIcon} size={13} />}
                {r.displayName ?? r.family}
              </button>
            );
          })}
        </div>
      </section>
      <section className="section">
        <h2>[Preview]</h2>
        {board.fontIds.length ? <canvas ref={canvas} className="cardcanvas" aria-label="Board preview" /> : <span className="muted" style={{ fontSize: 12 }}>Add fonts above to see the board.</span>}
      </section>
      <div className="row" style={{ gap: 6 }}>
        <button className="btn primary" style={{ flex: 1, height: 40 }} disabled={!board.fontIds.length} onClick={async () => canvas.current && downloadBlob(await canvasBlob(canvas.current), `${slug(board.name)}-board.png`)}>
          <Icon icon={Download01Icon} size={15} />Download PNG
        </button>
        {confirm ? (
          <button className="btn" style={{ height: 40, color: 'var(--red-text)' }} onClick={async () => { await db.boards.delete(id); toast('Board deleted'); onBack(); }}>Delete for good</button>
        ) : (
          <button className="btn" style={{ height: 40 }} onClick={() => setConfirm(true)}><Icon icon={Delete02Icon} size={15} />Delete</button>
        )}
      </div>
    </>
  );
}
