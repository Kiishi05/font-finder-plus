import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState } from 'react';
import { db } from '../../shared/db';
import { ArrowLeft01Icon, Copy01Icon, Download01Icon } from '../../shared/icons';
import { Icon } from '../components/Icon';
import { Select } from '../components/Select';
import { SIZES, canvasBlob, cardFontFor, downloadBlob, drawShareCard, fontCssFor, slug, type CardSize, type Theme } from '../lib/cards';

/** Make a share card image for one font (optionally with a second font for the text). */
export function ShareView({ fontId, onBack, toast }: { fontId: string; onBack: () => void; toast: (m: string) => void }) {
  const rec = useLiveQuery(() => db.fonts.get(fontId), [fontId]);
  const saved = useLiveQuery(() => db.savedFonts.toArray(), []) ?? [];
  const records = useLiveQuery(() => db.fonts.bulkGet(saved.map((s) => s.fontId)), [saved.map((s) => s.fontId).join('|')]) ?? [];
  const [size, setSize] = useState<CardSize>('landscape');
  const [theme, setTheme] = useState<Theme>('light');
  const [text, setText] = useState('The quick brown fox jumps over the lazy dog');
  const [weight, setWeight] = useState('400');
  const [second, setSecond] = useState('');
  const [watermark, setWatermark] = useState(true);
  const [busy, setBusy] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!rec || !canvas.current) return;
    let off = false;
    (async () => {
      const css = await fontCssFor(rec);
      const other = second ? records.find((r) => r?.id === second) : null;
      const otherCss = other ? await fontCssFor(other) : null;
      if (off || !canvas.current) return;
      await drawShareCard(canvas.current, {
        size,
        theme,
        text,
        font: cardFontFor(rec, css, weight),
        second: other && otherCss ? cardFontFor(other, otherCss) : null,
        watermark,
      });
    })();
    return () => { off = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rec, size, theme, text, weight, second, watermark, records.length]);

  if (rec === undefined) return null;
  if (!rec) return <div className="empty"><p>This font is not in your library yet. Save it first.</p></div>;
  const name = rec.displayName ?? rec.family;
  const file = `${slug(name)}-${size}.png`;

  const download = async () => {
    if (!canvas.current) return;
    setBusy(true);
    downloadBlob(await canvasBlob(canvas.current), file);
    setBusy(false);
  };
  const copy = async () => {
    if (!canvas.current) return;
    try {
      const blob = await canvasBlob(canvas.current);
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      toast('Copied the image');
    } catch {
      toast('Chrome did not allow copying the image. Use Download instead.');
    }
  };

  return (
    <>
      <div className="topbar">
        <button className="iconbtn" aria-label="Back" onClick={onBack}><Icon icon={ArrowLeft01Icon} /></button>
        <span className="label grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>[Share card] / [{name}]</span>
      </div>
      <section className="section">
        <canvas ref={canvas} className="cardcanvas" aria-label={`Share card for ${name}`} />
        <span className="mono muted" style={{ fontSize: 10.5 }}>{SIZES[size][0]} × {SIZES[size][1]} px · PNG</span>
      </section>
      <section className="section">
        <h2>[Card]</h2>
        <div className="seg" role="group" aria-label="Size">
          <button aria-pressed={size === 'landscape'} onClick={() => setSize('landscape')}>Landscape 1200×675</button>
          <button aria-pressed={size === 'portrait'} onClick={() => setSize('portrait')}>Portrait 1080×1350</button>
        </div>
        <div className="seg" role="group" aria-label="Theme">
          {(['light', 'dark', 'green'] as Theme[]).map((t) => <button key={t} aria-pressed={theme === t} onClick={() => setTheme(t)}>{t[0].toUpperCase() + t.slice(1)}</button>)}
        </div>
        <label className="stack" style={{ gap: 4 }}>
          <span className="label">[Text]</span>
          <textarea className="field" rows={2} value={text} onChange={(e) => setText(e.target.value)} aria-label="Card text" />
        </label>
        <div className="grid2" style={{ gap: 6 }}>
          <Select label="Weight" value={weight} onChange={setWeight} options={['300', '400', '500', '600', '700', '800'].map((w) => ({ value: w, label: `Weight ${w}` }))} />
          <Select label="Text in a second font" value={second} onChange={setSecond} options={[{ value: '', label: 'Text in this font' }, ...records.filter((r) => r && r.id !== fontId).map((r) => ({ value: r!.id, label: `Text in ${r!.displayName ?? r!.family}` }))]} />
        </div>
        <div className="row">
          <span className="grow" style={{ fontSize: 12.5 }}>Watermark "Font Finder Plus"</span>
          <button className="switch" role="switch" aria-checked={watermark} aria-label="Watermark" onClick={() => setWatermark(!watermark)} />
        </div>
      </section>
      <div className="row" style={{ gap: 6 }}>
        <button className="btn primary" style={{ flex: 1, height: 40 }} onClick={download} disabled={busy}><Icon icon={Download01Icon} size={15} />Download PNG</button>
        <button className="btn" style={{ flex: 1, height: 40 }} onClick={copy}><Icon icon={Copy01Icon} size={15} />Copy image</button>
      </div>
      <span className="muted" style={{ fontSize: 11.5 }}>Check the font's licence before sharing images made with a paid font.</span>
    </>
  );
}
