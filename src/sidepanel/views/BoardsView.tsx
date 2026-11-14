import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState } from 'react';
import { db } from '../../shared/db';
import { ArrowLeft01Icon, DashboardSquare01Icon, Delete02Icon, Download01Icon, PlusSignIcon } from '../../shared/icons';
import type { Board, FontRecord } from '../../shared/types';
import { Icon } from '../components/Icon';
import { FontPill, previewSource } from '../components/CollectionPicker';
import { usePreviewFamily } from '../lib/preview';
import { canvasBlob, cardFontFor, downloadBlob, drawBoard, fontCssFor, slug, type Theme } from '../lib/cards';

const edited = (t: number) => {
  const days = Math.floor((Date.now() - t) / 86400000);
  return days <= 0 ? 'Edited today' : days === 1 ? 'Edited yesterday' : days < 7 ? `Edited ${days} days ago` : days < 14 ? 'Edited last week' : `Edited ${new Date(t).toLocaleDateString()}`;
};

function SubTop({ parent, title, onBack, children }: { parent: string; title: string; onBack: () => void; children?: React.ReactNode }) {
  return (
    <div className="subtop">
      <button className="backbtn tip" data-tip="Back" aria-label="Back" onClick={onBack}><Icon icon={ArrowLeft01Icon} size={18} /></button>
      <span className="crumb"><span>{parent}</span><span className="sl">/</span><b>{title}</b></span>
      {children}
    </div>
  );
}

export function BoardsView({ onBack, onOpen }: { onBack: () => void; onOpen: (id: number) => void }) {
  const boards = useLiveQuery(() => db.boards.orderBy('updatedAt').reverse().toArray(), []);
  const create = async () => {
    const now = Date.now();
    const id = await db.boards.add({ name: 'Untitled board', fontIds: [], text: 'The quick brown fox jumps over the lazy dog', theme: 'light', createdAt: now, updatedAt: now });
    onOpen(id);
  };
  const newBtn = <button className="btn sm primary" onClick={create}><Icon icon={PlusSignIcon} size={15} />New board</button>;
  return (
    <div className="libv">
      <SubTop parent="Library" title="Boards" onBack={onBack}>{!!boards?.length && newBtn}</SubTop>
      {boards && !boards.length ? (
        <section className="empty">
          <span className="eic"><Icon icon={DashboardSquare01Icon} size={24} /></span>
          <div className="et">
            <h2>Make your first board</h2>
            <p>A board is an image of fonts set in your own text, with each font's alphabet, to share with a client or a team. Download it as a PNG.</p>
          </div>
          <div className="eacts">{newBtn}</div>
        </section>
      ) : boards ? (
        <>
          <div className="boardgrid">
            {boards.map((b) => (
              <button key={b.id} className="boardcard" onClick={() => onOpen(b.id!)}>
                <BoardThumb b={b} />
                <span className="meta">
                  <b>{b.name || 'Untitled board'}</b>
                  <span>{b.fontIds.length} {b.fontIds.length === 1 ? 'font' : 'fonts'} · {edited(b.updatedAt)}</span>
                </span>
              </button>
            ))}
          </div>
          <p className="sub" style={{ padding: '0 6px' }}>A board is an image of fonts set in your own text, to share with a client or a team. Download it as a PNG.</p>
        </>
      ) : null}
    </div>
  );
}

/** A small picture of the board: its background and the first fonts in the board's text. */
function BoardThumb({ b }: { b: Board }) {
  const recs = useLiveQuery(() => db.fonts.bulkGet(b.fontIds.slice(0, 3)), [b.fontIds.slice(0, 3).join('|')]) ?? [];
  const fonts = recs.filter((r): r is FontRecord => !!r);
  return (
    <span className={`bthumb ${b.theme}`} aria-hidden="true">
      {fonts.length ? fonts.map((r) => <ThumbLine key={r.id} rec={r} text={b.text} />) : <span className="bempty">No fonts yet</span>}
    </span>
  );
}

function ThumbLine({ rec, text }: { rec: FontRecord; text: string }) {
  const preview = usePreviewFamily(previewSource(rec), null);
  return <span className="bt" style={{ fontFamily: preview.css }}>{text.trim() || rec.displayName || rec.family}</span>;
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
  if (!board) {
    return (
      <div className="libv">
        <SubTop parent="Library" title="Boards" onBack={onBack} />
        <section className="empty"><div className="et"><h2>This board was deleted</h2></div><div className="eacts"><button className="btn" onClick={onBack}>Back to boards</button></div></section>
      </div>
    );
  }

  const toggle = (fontId: string) => update({ fontIds: board.fontIds.includes(fontId) ? board.fontIds.filter((f) => f !== fontId) : [...board.fontIds, fontId] });
  const n = board.fontIds.length;

  return (
    <div className="libv">
      <SubTop parent="Boards" title={board.name || 'Untitled board'} onBack={onBack} />
      <section className="section bprev">
        {n ? <canvas ref={canvas} className="cardcanvas" aria-label="Board preview" /> : <div className={`bthumb big ${board.theme}`}><span className="bempty">Add fonts to see the board</span></div>}
      </section>
      <section className="section">
        <label className="fld">
          <span>Name</span>
          <input className="field" type="text" value={board.name} placeholder="Untitled board" onChange={(e) => update({ name: e.target.value })} aria-label="Board name" />
        </label>
        <label className="fld">
          <span>Text on the board</span>
          <input className="field" type="text" value={board.text} placeholder="Each font's name" onChange={(e) => update({ text: e.target.value })} aria-label="Board text" />
        </label>
        <div className="fld">
          <span>Background of the image</span>
          <div className="bgpick" role="radiogroup" aria-label="Background">
            {(['light', 'dark'] as Theme[]).map((t) => (
              <button key={t} type="button" role="radio" aria-checked={board.theme === t} onClick={() => update({ theme: t as Board['theme'] })}>
                <i className={`sw2 ${t}`} />{t === 'light' ? 'Light' : 'Dark'}
              </button>
            ))}
          </div>
        </div>
        <div className="switchrow">
          <span>Show “Made with Font Finder Plus”</span>
          <button className="switch" role="switch" aria-checked={watermark} aria-label="Show the credit line" onClick={() => setWatermark(!watermark)} />
        </div>
      </section>
      <section className="section" style={{ gap: 12 }}>
        <div className="sechead">
          <h2>Fonts on this board</h2>
          <span className="count">{n} added</span>
          {n > 0 && <button className="linkbtn" onClick={() => update({ fontIds: [] })}>Clear</button>}
        </div>
        {!saved.length && <p className="sub">Save fonts to your library first. They then appear here to add.</p>}
        <div className="chips addpills">
          {records.map((r) => r && <FontPill key={r.id} rec={r} on={board.fontIds.includes(r.id)} onClick={() => toggle(r.id)} />)}
        </div>
        <div className="bacts">
          <button className="btn primary wide" disabled={!n} onClick={async () => canvas.current && downloadBlob(await canvasBlob(canvas.current), `${slug(board.name)}-board.png`)}>
            <Icon icon={Download01Icon} size={16} />Download PNG
          </button>
          {confirm ? (
            <div className="confirmrow" role="alert">
              <span className="grow">Delete this board? This cannot be undone.</span>
              <button className="btn sm" onClick={() => setConfirm(false)}>Cancel</button>
              <button className="btn sm dangerfill" onClick={async () => { await db.boards.delete(id); toast('Board deleted'); onBack(); }}>Delete</button>
            </div>
          ) : (
            <button className="btn danger wide" onClick={() => setConfirm(true)}><Icon icon={Delete02Icon} size={16} />Delete board</button>
          )}
        </div>
      </section>
    </div>
  );
}
