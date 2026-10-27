import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { googleFamily, googleFontsUrl, LICENSE_LABEL } from '../../shared/catalog';
import { db, saveFont } from '../../shared/db';
import { Alert02Icon, ArrowUpRight01Icon, Bookmark02Icon, Delete02Icon, ImageCropIcon, ImageUploadIcon, PerspectiveIcon, RotateClockwiseIcon, ScanImageIcon } from '../../shared/icons';
import { sendToTab } from '../../shared/messages';
import type { ImageJob } from '../../shared/types';
import { Icon } from '../components/Icon';
import { canvasBlob } from '../lib/cards';
import { useGoogleFontReady } from '../lib/google';
import { heicToCanvas, isHeic } from '../lib/heic';
import { NO_EDIT, cutGlyphs, finish, geometry, letterTiles, looksInverted, type Edit } from '../lib/imageprep';
import { INDEX_COUNT, matchGlyphs, type ImageMatch } from '../lib/matcher';
import { useMissing } from '../lib/missing';
import { recognize, type OcrLine } from '../lib/ocr';
import type { TabState } from '../lib/hooks';
import { askWhatFontIs, type WfiResult } from '../lib/whatfontis';

interface Props {
  tab: TabState;
  whatFontIsKey: string;
  pending: { srcUrl: string; tabId: number; pageUrl: string } | null;
  onPendingUsed: () => void;
  toast: (m: string) => void;
}

type Source = { canvas: HTMLCanvasElement; kind: NonNullable<ImageJob['source']>; pageUrl?: string };

const MAX_SIDE = 2400;

async function canvasFromBlob(blob: Blob): Promise<HTMLCanvasElement> {
  const bmp = await createImageBitmap(blob);
  const k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  return c;
}

/** Screenshot the visible tab and cut out a rectangle (CSS pixels). */
async function captureRect(tabId: number, r: { x: number; y: number; w: number; h: number; dpr: number }): Promise<HTMLCanvasElement> {
  const tab = await chrome.tabs.get(tabId);
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  await sendToTab(tabId, { type: 'ffp:hide-ui', hidden: false });
  const full = await canvasFromBlob(await (await fetch(dataUrl)).blob());
  const img = await createImageBitmap(await (await fetch(dataUrl)).blob());
  const k = full.width / img.width;
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(r.w * r.dpr * k));
  c.height = Math.max(1, Math.round(r.h * r.dpr * k));
  c.getContext('2d')!.drawImage(full, r.x * r.dpr * k, r.y * r.dpr * k, c.width, c.height, 0, 0, c.width, c.height);
  return c;
}

export function IdentifyView({ tab, whatFontIsKey, pending, onPendingUsed, toast }: Props) {
  const [source, setSource] = useState<Source | null>(null);
  const [edit, setEdit] = useState<Edit>(NO_EDIT);
  const [autoInverted, setAutoInverted] = useState(false);
  const [lines, setLines] = useState<OcrLine[] | null>(null);
  const [chosen, setChosen] = useState<number[]>([]);
  const [corrections, setCorrections] = useState<Record<string, string>>({});
  const [matches, setMatches] = useState<ImageMatch[] | null>(null);
  const [usedLetters, setUsedLetters] = useState(0);
  const [busy, setBusy] = useState<null | 'loading' | 'reading' | 'matching'>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [viewJob, setViewJob] = useState<ImageJob | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setSource(null);
    setEdit(NO_EDIT);
    setLines(null);
    setChosen([]);
    setCorrections({});
    setMatches(null);
    setError(null);
    setViewJob(null);
    setAutoInverted(false);
  };

  const load = useCallback(async (canvas: HTMLCanvasElement, kind: Source['kind'], pageUrl?: string) => {
    reset();
    setSource({ canvas, kind, pageUrl });
    // Light text on a dark background reads better inverted.
    if (looksInverted(finish(canvas, NO_EDIT))) {
      setEdit({ ...NO_EDIT, invert: true });
      setAutoInverted(true);
    }
  }, []);

  const loadFile = async (file: File | Blob, kind: Source['kind']) => {
    setBusy('loading');
    setError(null);
    try {
      const canvas = file instanceof File && isHeic(file) ? await heicToCanvas(file) : await canvasFromBlob(file);
      await load(canvas, kind);
    } catch (err) {
      setError(err instanceof Error ? err.message : typeof err === 'string' ? `This image could not be opened: ${err}` : 'This image could not be opened.');
    } finally {
      setBusy(null);
    }
  };

  // Paste an image anywhere in the panel while this tab is open.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'));
      const f = item?.getAsFile();
      if (f) {
        e.preventDefault();
        loadFile(f, 'paste');
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // "Identify the font in this image" from the right-click menu.
  useEffect(() => {
    if (!pending) return;
    onPendingUsed();
    (async () => {
      setBusy('loading');
      try {
        let canvas: HTMLCanvasElement | null = null;
        try {
          const res = await fetch(pending.srcUrl, { credentials: 'omit' });
          if (res.ok) canvas = await canvasFromBlob(await res.blob());
        } catch {
          /* the site blocks downloading it: take it from the screen instead */
        }
        if (!canvas) {
          const r = await sendToTab<{ rect: { x: number; y: number; w: number; h: number; dpr: number } | null }>(pending.tabId, { type: 'ffp:image-rect', src: pending.srcUrl });
          if (!r?.rect) throw new Error('The image could not be read. Try Select an area instead.');
          canvas = await captureRect(pending.tabId, r.rect);
        }
        await load(canvas, 'image', pending.pageUrl);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'The image could not be read.');
      } finally {
        setBusy(null);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);

  const selectArea = async () => {
    if (tab.tabId == null) return;
    setError(null);
    const r = await sendToTab<{ rect: { x: number; y: number; w: number; h: number; dpr: number } | null }>(tab.tabId, { type: 'ffp:select-area' }, 120000);
    if (!r) {
      setError('The page did not answer. Click the Font Finder Plus icon on the page first.');
      return;
    }
    if (!r.rect) {
      sendToTab(tab.tabId, { type: 'ffp:hide-ui', hidden: false });
      return;
    }
    setBusy('loading');
    try {
      await load(await captureRect(tab.tabId, r.rect), 'page', tab.ping?.url);
    } catch {
      setError('Chrome did not allow a screenshot of this page. Click the Font Finder Plus icon on the page and try again.');
    } finally {
      setBusy(null);
    }
  };

  const geo = useMemo(() => (source ? geometry(source.canvas, edit) : null), [source, edit.turn, edit.rotate, edit.perspective]); // eslint-disable-line react-hooks/exhaustive-deps
  const prepared = useMemo(() => (geo ? finish(geo, edit) : null), [geo, edit]);

  const read = async () => {
    if (!prepared) return;
    setBusy('reading');
    setProgress(0);
    setError(null);
    setMatches(null);
    try {
      const found = await recognize(prepared, setProgress);
      setLines(found);
      setCorrections({});
      // Start with the clearest, longest line.
      const best = found.map((l, i) => [i, l.confidence * Math.min(1, l.text.length / 12)] as const).sort((a, b) => b[1] - a[1])[0];
      setChosen(best ? [best[0]] : []);
      if (!found.length) setError('No text was found. Crop closer to the text, or try Invert if the text is light on dark.');
    } catch (err) {
      setError(`Text recognition failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(null);
    }
  };

  const chosenLines = useMemo(() => (lines ? chosen.map((i) => ({ line: lines[i], index: i })) : []), [lines, chosen]);
  const tiles = useMemo(() => (prepared && chosenLines.length ? letterTiles(prepared, chosenLines) : []), [prepared, chosenLines]);
  const text = tiles.map((t) => (t.space ? ' ' : '') + (corrections[t.key] ?? t.text)).join('');

  const match = async () => {
    if (!prepared) return;
    const glyphs = cutGlyphs(prepared, chosenLines, corrections);
    setUsedLetters(glyphs.length);
    if (glyphs.length < 2) {
      setError('Too few letters to compare. Choose a longer line, or correct letters that were read wrongly.');
      return;
    }
    setBusy('matching');
    setError(null);
    try {
      const res = await matchGlyphs(glyphs, 10);
      setMatches(res);
      const image = await canvasBlob(prepared);
      await db.imageJobs.add({ image, createdAt: Date.now(), ocrText: text, results: res.map(({ family, bold, score, reason }) => ({ family, bold, score, reason })), source: source?.kind, pageUrl: source?.pageUrl });
    } catch (err) {
      setError(`Matching failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(null);
    }
  };

  if (viewJob) return <PastJob job={viewJob} onBack={() => setViewJob(null)} onAgain={async () => { const c = await canvasFromBlob(viewJob.image); load(c, viewJob.source ?? 'upload', viewJob.pageUrl); }} toast={toast} />;

  return (
    <>
      {!source && (
        <section className="section">
          <h2>[Identify a font from an image]</h2>
          <span style={{ fontSize: 12.5 }}>Find the closest free fonts to text in a picture: a logo, a poster, a screenshot. Matching runs on this computer against {INDEX_COUNT.toLocaleString()} Google Fonts families.</span>
          <div className="idsrc">
            <button className="btn primary" onClick={selectArea} disabled={!tab.ping || !!busy}>
              <Icon icon={ScanImageIcon} size={16} />Select an area on the page
            </button>
            <button className="btn" onClick={() => fileRef.current?.click()} disabled={!!busy}>
              <Icon icon={ImageUploadIcon} size={16} />Upload an image
            </button>
            <input ref={fileRef} type="file" accept="image/*,.heic,.heif" hidden aria-label="Upload an image" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) loadFile(f, 'upload'); }} />
          </div>
          <div
            className="dropzone"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = [...e.dataTransfer.files].find((x) => x.type.startsWith('image/') || isHeic(x));
              if (f) loadFile(f, 'upload');
            }}
          >
            Drop an image here, or paste one (<kbd>Ctrl</kbd>/<kbd>Cmd</kbd> + <kbd>V</kbd>). JPG, PNG, WebP, GIF and iPhone HEIC.
          </div>
          <span className="muted" style={{ fontSize: 11.5 }}>
            On any web page you can also right-click an image and choose <b>Identify the font in this image</b>.
            {!tab.ping && ' To select an area, first click the Font Finder Plus icon on the page.'}
          </span>
        </section>
      )}

      {busy === 'loading' && <div className="notice neutral">Opening the image…</div>}
      {error && <div className="notice amber"><Icon icon={Alert02Icon} size={15} />{error}</div>}

      {source && geo && prepared && (
        <Editor source={source} geo={geo} prepared={prepared} edit={edit} setEdit={(e) => { setEdit(e); setLines(null); setMatches(null); }} autoInverted={autoInverted} onReset={reset} />
      )}

      {source && (
        <button className="btn primary" style={{ height: 40 }} onClick={read} disabled={!!busy}>
          {busy === 'reading' ? `Reading the text… ${Math.round(progress * 100)}%` : lines ? 'Read the text again' : 'Read the text'}
        </button>
      )}

      {lines && lines.length > 0 && (
        <section className="section">
          <h2>[Text found] Choose the line to match</h2>
          <div className="ocrlines">
            {lines.map((l, i) => (
              <label key={i} className={`ocrline${chosen.includes(i) ? ' on' : ''}`}>
                <input type="checkbox" checked={chosen.includes(i)} onChange={() => { setChosen(chosen.includes(i) ? chosen.filter((x) => x !== i) : [...chosen, i]); setMatches(null); }} />
                <span className="grow" style={{ overflowWrap: 'anywhere' }}>{l.text}</span>
                <span className={`pill ${l.confidence >= 80 ? 'good' : l.confidence >= 55 ? 'warn' : 'bad'}`}>{Math.round(l.confidence)}%</span>
              </label>
            ))}
          </div>
          {tiles.length > 0 && (
            <>
              <span className="label">[Letters] Fix any that were read wrongly</span>
              <div className="tiles">
                {tiles.map((t) => (
                  <label key={t.key} className={`tile${t.confidence < 60 ? ' unsure' : ''}`} title={`Read as "${t.text}" (${Math.round(t.confidence)}% sure)`}>
                    <img src={t.thumb} alt="" />
                    <input aria-label={`Letter read as ${t.text}`} maxLength={1} value={corrections[t.key] ?? t.text} onChange={(e) => { setCorrections({ ...corrections, [t.key]: e.target.value }); setMatches(null); }} />
                  </label>
                ))}
              </div>
              <span className="muted" style={{ fontSize: 11.5 }}>Letters with a yellow edge were hard to read. Only a to z, A to Z and 0 to 9 are compared.</span>
            </>
          )}
          <button className="btn primary" style={{ height: 40 }} onClick={match} disabled={!!busy || !chosen.length}>
            {busy === 'matching' ? 'Comparing letters…' : 'Find the closest fonts'}
          </button>
        </section>
      )}

      {matches && prepared && (
        <Results matches={matches} usedLetters={usedLetters} text={text} image={prepared} whatFontIsKey={whatFontIsKey} toast={toast} />
      )}

      {!source && <History onOpen={setViewJob} />}
    </>
  );
}

// ------------------------------------------------------------- editor

function Editor({ source, geo, prepared, edit, setEdit, autoInverted, onReset }: { source: Source; geo: HTMLCanvasElement; prepared: HTMLCanvasElement; edit: Edit; setEdit: (e: Edit) => void; autoInverted: boolean; onReset: () => void }) {
  const [mode, setMode] = useState<'crop' | 'perspective'>('crop');
  const view = mode === 'perspective' ? source.canvas : geo;
  const ref = useRef<HTMLCanvasElement>(null);
  const prepRef = useRef<HTMLCanvasElement>(null);
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const [live, setLive] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [handle, setHandle] = useState<number | null>(null);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    c.width = view.width;
    c.height = view.height;
    c.getContext('2d')!.drawImage(view, 0, 0);
  }, [view]);
  useEffect(() => {
    const c = prepRef.current;
    if (!c) return;
    c.width = prepared.width;
    c.height = prepared.height;
    c.getContext('2d')!.drawImage(prepared, 0, 0);
  }, [prepared]);

  const toImage = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * view.width, y: ((e.clientY - r.top) / r.height) * view.height };
  };
  const corners: [number, number][] = edit.perspective ?? [[0, 0], [source.canvas.width, 0], [source.canvas.width, source.canvas.height], [0, source.canvas.height]];
  const pct = (v: number, of: number) => `${(v / of) * 100}%`;
  const crop = live ?? edit.crop;

  return (
    <section className="section">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2>[Adjust the image]</h2>
        <button className="linkbtn" style={{ fontSize: 12 }} onClick={onReset}>Use another image</button>
      </div>
      <div className="seg" role="group" aria-label="Tool">
        <button aria-pressed={mode === 'crop'} onClick={() => setMode('crop')}><span className="row" style={{ gap: 6, justifyContent: 'center' }}><Icon icon={ImageCropIcon} size={14} />Crop</span></button>
        <button aria-pressed={mode === 'perspective'} onClick={() => { setMode('perspective'); if (!edit.perspective) setEdit({ ...edit, perspective: corners, crop: null }); }}><span className="row" style={{ gap: 6, justifyContent: 'center' }}><Icon icon={PerspectiveIcon} size={14} />Perspective</span></button>
      </div>
      <div
        className="editbox"
        onPointerDown={(e) => {
          if (mode !== 'crop') return;
          (e.target as Element).setPointerCapture?.(e.pointerId);
          setDrag(toImage(e));
        }}
        onPointerMove={(e) => {
          if (mode === 'crop' && drag) {
            const p = toImage(e);
            setLive({ x: Math.min(drag.x, p.x), y: Math.min(drag.y, p.y), w: Math.abs(p.x - drag.x), h: Math.abs(p.y - drag.y) });
          }
          if (mode === 'perspective' && handle != null) {
            const p = toImage(e);
            const next = corners.map((c, i) => (i === handle ? [Math.max(0, Math.min(view.width, p.x)), Math.max(0, Math.min(view.height, p.y))] : c)) as [number, number][];
            setEdit({ ...edit, perspective: next });
          }
        }}
        onPointerUp={() => {
          if (mode === 'crop' && drag) {
            if (live && live.w > 6 && live.h > 6) setEdit({ ...edit, crop: live });
            setDrag(null);
            setLive(null);
          }
          setHandle(null);
        }}
      >
        <canvas ref={ref} aria-label="Image to identify" />
        {mode === 'crop' && crop && (
          <div className="cropbox" style={{ left: pct(crop.x, view.width), top: pct(crop.y, view.height), width: pct(crop.w, view.width), height: pct(crop.h, view.height) }} />
        )}
        {mode === 'perspective' && (
          <>
            <svg className="quad" viewBox={`0 0 ${view.width} ${view.height}`} preserveAspectRatio="none">
              <polygon points={corners.map((c) => c.join(',')).join(' ')} />
            </svg>
            {corners.map((c, i) => (
              <span
                key={i}
                className="handle"
                role="slider"
                aria-label={['Top left corner', 'Top right corner', 'Bottom right corner', 'Bottom left corner'][i]}
                aria-valuenow={Math.round(c[0])}
                style={{ left: pct(c[0], view.width), top: pct(c[1], view.height) }}
                onPointerDown={(e) => { e.stopPropagation(); (e.target as Element).setPointerCapture?.(e.pointerId); setHandle(i); }}
              />
            ))}
          </>
        )}
      </div>
      <span className="muted" style={{ fontSize: 11.5 }}>
        {mode === 'crop'
          ? edit.crop ? 'Drag again to change the crop.' : 'Drag over the text you want to identify. Tighter crops give better matches.'
          : 'Drag the four corners onto the corners of a slanted sign or page to flatten it. Then switch back to Crop.'}
      </span>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <button className="btn sm" onClick={() => setEdit({ ...edit, turn: (((edit.turn + 1) % 4) as Edit['turn']), crop: null })}><Icon icon={RotateClockwiseIcon} size={14} />Turn 90°</button>
        {edit.crop && <button className="btn sm ghost" onClick={() => setEdit({ ...edit, crop: null })}>Clear crop</button>}
        {edit.perspective && <button className="btn sm ghost" onClick={() => setEdit({ ...edit, perspective: null, crop: null })}>Clear perspective</button>}
      </div>
      <div className="axes">
        <Slider label="Straighten" value={edit.rotate} min={-20} max={20} step={0.5} unit="°" onChange={(v) => setEdit({ ...edit, rotate: v, crop: null })} />
        <Slider label="Brightness" value={edit.brightness} min={-100} max={100} step={1} onChange={(v) => setEdit({ ...edit, brightness: v })} />
        <Slider label="Contrast" value={edit.contrast} min={-100} max={100} step={1} onChange={(v) => setEdit({ ...edit, contrast: v })} />
      </div>
      <div className="row">
        <span className="grow" style={{ fontSize: 12.5 }}>Invert (for light text on a dark background)</span>
        <button className="switch" role="switch" aria-checked={edit.invert} aria-label="Invert" onClick={() => setEdit({ ...edit, invert: !edit.invert })} />
      </div>
      {autoInverted && <span className="muted" style={{ fontSize: 11.5 }}>Invert was turned on because the image looks like light text on a dark background.</span>}
      <span className="label">[What gets read]</span>
      <canvas ref={prepRef} className="prepared" aria-label="Prepared image" />
    </section>
  );
}

function Slider({ label, value, min, max, step, unit = '', onChange }: { label: string; value: number; min: number; max: number; step: number; unit?: string; onChange: (v: number) => void }) {
  return (
    <label className="axis">
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label={label} />
      <span className="mono" style={{ fontSize: 11.5, textAlign: 'right' }}>{value}{unit}</span>
    </label>
  );
}

// ------------------------------------------------------------- results

function Results({ matches, usedLetters, text, image, whatFontIsKey, toast }: { matches: ImageMatch[]; usedLetters: number; text: string; image: HTMLCanvasElement; whatFontIsKey: string; toast: (m: string) => void }) {
  const [wfi, setWfi] = useState<WfiResult[] | null>(null);
  const [wfiBusy, setWfiBusy] = useState(false);
  const [wfiError, setWfiError] = useState<string | null>(null);
  const top = matches[0]?.score ?? 0;
  const low = top < 60 || usedLetters < 4;
  const close = matches.length > 2 && top - matches[2].score <= 3;
  const imgUrl = useMemo(() => image.toDataURL('image/png'), [image]);
  return (
    <section className="section">
      <h2>[Closest matches] Free Google Fonts</h2>
      {low && (
        <div className="notice amber">
          <Icon icon={Alert02Icon} size={15} />
          <span>
            Low confidence{usedLetters < 4 ? `: only ${usedLetters} ${usedLetters === 1 ? 'letter was' : 'letters were'} compared` : ''}. For better results crop tightly around one line, use a bigger or sharper image,
            straighten it, and fix any letters read wrongly. The font may also be a paid font that is not in this list.
          </span>
        </div>
      )}
      {close && !low && <span className="muted" style={{ fontSize: 12 }}>Several fonts here are almost the same. Compare details such as a, g, R, Q and y to tell them apart.</span>}
      <div className="matches">
        {matches.map((m, i) => <ImageMatchRow key={m.family} m={m} rank={i + 1} text={text} imgUrl={imgUrl} image={image} toast={toast} />)}
      </div>
      <span className="muted" style={{ fontSize: 11.5 }}>
        These are the closest matches among free Google Fonts, compared letter by letter on this computer. They are not a guarantee of the exact font.
      </span>
      <div className="stack" style={{ gap: 6, paddingTop: 6, borderTop: '1px solid var(--line)' }}>
        <span className="label">[Exact match from WhatFontIs]</span>
        {whatFontIsKey ? (
          <>
            <button className="btn sm" style={{ alignSelf: 'flex-start' }} disabled={wfiBusy} onClick={async () => {
              setWfiBusy(true);
              setWfiError(null);
              try {
                setWfi(await askWhatFontIs(whatFontIsKey, image));
              } catch (err) {
                setWfiError(err instanceof Error ? err.message : 'WhatFontIs did not answer.');
              } finally {
                setWfiBusy(false);
              }
            }}>{wfiBusy ? 'Asking WhatFontIs…' : 'Ask WhatFontIs (sends this image to whatfontis.com)'}</button>
            {wfiError && <span className="err" style={{ fontSize: 12 }}>{wfiError}</span>}
            {wfi && (
              <div className="stack" style={{ gap: 4 }}>
                <span className="muted" style={{ fontSize: 11.5 }}>Results from whatfontis.com. These may include paid fonts.</span>
                {wfi.length ? wfi.map((r) => (
                  <a key={r.title} className="wfi" href={r.url ?? undefined} target="_blank" rel="noreferrer">
                    {r.image && <img src={r.image} alt="" />}
                    <span>{r.title}</span>
                  </a>
                )) : <span style={{ fontSize: 12 }}>WhatFontIs found nothing for this image.</span>}
              </div>
            )}
          </>
        ) : (
          <span className="muted" style={{ fontSize: 12 }}>For paid fonts too, add your own WhatFontIs API key in Settings. Nothing is sent unless you ask.</span>
        )}
      </div>
    </section>
  );
}

function ImageMatchRow({ m, rank, text, imgUrl, image, toast }: { m: ImageMatch; rank: number; text: string; imgUrl: string; image: HTMLCanvasElement; toast: (msg: string) => void }) {
  const { css, ready } = useGoogleFontReady(m.family);
  const [compare, setCompare] = useState(rank === 1);
  const sample = text.trim() || m.family;
  const missing = useMissing(css, sample, ready);
  const gf = googleFamily(m.family);
  const save = async () => {
    const id = `${m.family}::google`;
    await saveFont({ id, family: m.family, displayName: m.family, catalogFamily: m.family, source: 'google', kind: 'web', classification: gf?.c ?? 'unknown', licenseType: gf?.l ?? 'unknown', designers: gf?.d ?? [], files: [] }, null, null);
    // Keep the image it was found from with the font.
    const blob = await canvasBlob(image);
    const shot = await db.screenshots.add({ blob, pageUrl: 'Identified from an image', createdAt: Date.now() });
    const sp = await db.specimens.where('fontId').equals(id).first();
    if (sp?.id) await db.specimens.update(sp.id, { screenshotIds: [...sp.screenshotIds, shot] });
    else await db.specimens.add({ fontId: id, screenshotIds: [shot], pairing: null, notes: '', createdAt: Date.now() });
    toast(`Saved ${m.family} to your library, with the image`);
  };
  return (
    <div className="match">
      <div className="row" style={{ alignItems: 'baseline' }}>
        <span className="mono muted" style={{ fontSize: 11 }}>{rank}</span>
        <b className="grow" style={{ fontSize: 13 }}>{m.family}{m.bold ? ' Bold' : ''}</b>
        <span className="mono" style={{ fontSize: 12 }}>{m.score}%</span>
      </div>
      {compare && <img className="cmpimg" src={imgUrl} alt="Your image" />}
      <div className="mprev" dir="auto" style={{ fontFamily: css, fontWeight: m.bold ? 700 : 400 }}>{sample}</div>
      <span className="muted" style={{ fontSize: 11.5 }}>{m.reason}</span>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap', fontSize: 11.5 }}>
        <span className="lic free"><i />Free · {gf?.l ? LICENSE_LABEL[gf.l] : 'Google Fonts'}</span>
        {ready && <span className={missing.length ? 'err' : 'ok'}>{missing.length ? `Missing ${missing.length} of your letters (${missing.slice(0, 6).map((c) => `“${c}”`).join(' ')})` : 'Has every letter of your text'}</span>}
      </div>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <button className={`btn sm${compare ? ' done' : ''}`} onClick={() => setCompare(!compare)}>{compare ? 'Hide your image' : 'Compare with your image'}</button>
        <button className="btn sm" onClick={save}><Icon icon={Bookmark02Icon} size={13} />Save</button>
        <a className="btn sm ghost" href={googleFontsUrl(m.family)} target="_blank" rel="noreferrer">Google Fonts <Icon icon={ArrowUpRight01Icon} size={13} /></a>
      </div>
    </div>
  );
}

// ------------------------------------------------------------- history

function History({ onOpen }: { onOpen: (j: ImageJob) => void }) {
  const jobs = useLiveQuery(() => db.imageJobs.orderBy('createdAt').reverse().limit(20).toArray(), []) ?? [];
  const urls = useMemo(() => jobs.map((j) => URL.createObjectURL(j.image)), [jobs]);
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls]);
  if (!jobs.length) return null;
  return (
    <section className="section">
      <h2>[Recent] {jobs.length}</h2>
      <div className="list">
        {jobs.map((j, i) => (
          <div key={j.id} className="histrow">
            <button className="histmain" onClick={() => onOpen(j)}>
              <img src={urls[i]} alt="" />
              <span className="stack" style={{ gap: 2, minWidth: 0 }}>
                <b style={{ fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{j.results?.[0]?.family ?? 'No match'}{j.results?.[0] ? ` · ${j.results[0].score}%` : ''}</b>
                <span className="muted" style={{ fontSize: 11.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>“{j.ocrText}” · {new Date(j.createdAt).toLocaleDateString()}</span>
              </span>
            </button>
            <button className="iconbtn sm" aria-label="Delete from history" title="Delete" onClick={() => db.imageJobs.delete(j.id!)}><Icon icon={Delete02Icon} size={14} /></button>
          </div>
        ))}
      </div>
    </section>
  );
}

function PastJob({ job, onBack, onAgain, toast }: { job: ImageJob; onBack: () => void; onAgain: () => void; toast: (m: string) => void }) {
  const url = useMemo(() => URL.createObjectURL(job.image), [job]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  void toast;
  return (
    <section className="section">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2>[From {new Date(job.createdAt).toLocaleString()}]</h2>
        <button className="linkbtn" style={{ fontSize: 12 }} onClick={onBack}>Back</button>
      </div>
      <img className="cmpimg" src={url} alt="The image" />
      <span className="muted" style={{ fontSize: 12 }}>Text read: “{job.ocrText}”{job.pageUrl ? ` · from ${job.pageUrl}` : ''}</span>
      <div className="matches">
        {(job.results ?? []).map((r, i) => (
          <div key={r.family} className="match">
            <div className="row"><span className="mono muted" style={{ fontSize: 11 }}>{i + 1}</span><b className="grow">{r.family}{r.bold ? ' Bold' : ''}</b><span className="mono">{r.score}%</span></div>
            <span className="muted" style={{ fontSize: 11.5 }}>{r.reason}</span>
            <a className="btn sm ghost" style={{ alignSelf: 'flex-start' }} href={googleFontsUrl(r.family)} target="_blank" rel="noreferrer">Google Fonts <Icon icon={ArrowUpRight01Icon} size={13} /></a>
          </div>
        ))}
      </div>
      <button className="btn" onClick={onAgain}>Open this image again to adjust and match</button>
    </section>
  );
}
