import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { googleFamily, licenseBadge } from '../../shared/catalog';
import { db, saveFont } from '../../shared/db';
import { SaveFontButton } from '../components/SaveFontButton';
import { ensureRecord, pageFontFiles } from '../lib/imagefonts';
import { knownFont } from '../../shared/licences';
import { findFontNames, namesFromContext } from '../lib/fontnames';
import { splitSamples } from '../lib/segments';
import { AllFonts, Lic, Note, Tick, WhereToGet, blocksFor, type BlockSummary } from './identify/AllFonts';
import { imageVerdict } from '../../shared/imagerank';
import { Alert02Icon, ArrowDown01Icon, ContrastIcon, Delete02Icon, ImageCropIcon, ImageNotFound01Icon, ImageUploadIcon, InformationCircleIcon, PerspectiveIcon, RotateClockwiseIcon, ScanImageIcon, Target02Icon } from '../../shared/icons';
import { sendToTab } from '../../shared/messages';
import type { ImageJob, LicenseType, PageFontUsage, PageScan } from '../../shared/types';
import { bestFileUrl, fontId, recordFromUsage } from '../../shared/records';
import { usePreviewFamily } from '../lib/preview';
import { Icon } from '../components/Icon';
import { canvasBlob } from '../lib/cards';
import { trySwap, undoSwap, useGoogleFontReady, useSwaps } from '../lib/google';
import { heicToCanvas, isHeic } from '../lib/heic';
import { NO_EDIT, cutGlyphs, finish, geometry, letterTiles, looksInverted, type Edit } from '../lib/imageprep';
import { INDEX_COUNT, matchGlyphs, type ImageMatch } from '../lib/matcher';
import { useMissing } from '../lib/missing';
import { recognize, type OcrLine } from '../lib/ocr';
import { usePageScan, type TabState } from '../lib/hooks';

/** A request from the right-click menu (an image's address) or the hover card (a picture's area). */
export interface IdentifyRequest {
  srcUrl?: string;
  rect?: { x: number; y: number; w: number; h: number; dpr: number };
  tabId: number;
  pageUrl: string;
  /** Alt text and the post around the picture (from the hover card). */
  context?: string[];
}

interface Props {
  tab: TabState;
  pending: IdentifyRequest | null;
  onPendingUsed: () => void;
  onOpenFont: (usage: PageFontUsage, fontId: string) => void;
  /** Open the details of a font found in an image (Google family or a named font). */
  onOpenFontId: (fontId: string) => void;
  toast: (m: string) => void;
  /** Changes when the on-page dock asks to select an area: starts Select an area once the tab is ready. */
  selectNow?: number;
}

interface Exact {
  fonts: { key: string; name: string; family: string; licenseType: string; source: string; count: number; sample: string }[];
  pictures: number;
}

type Source = {
  canvas: HTMLCanvasElement;
  kind: NonNullable<ImageJob['source']>;
  pageUrl?: string;
  /** Alt text and the post around the picture, on a page. */
  context?: string[];
  /** What the picture card calls it: the file's name, or where it came from. */
  name?: string;
  /** Opened again from Recent: its entry there is updated instead of adding a new one. */
  jobId?: number;
};

const KIND_NAME: Record<Source['kind'], string> = { paste: 'Pasted picture', upload: 'Uploaded picture', page: 'Area of the page', image: 'Picture from the page' };

const MAX_SIDE = 2400;
const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

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

const hostOf = (url?: string) => {
  try {
    return url ? new URL(url).hostname : '';
  } catch {
    return '';
  }
};

/** "Today", "Yesterday" or "12 Nov". */
function when(t: number): string {
  const d = new Date(t), now = new Date();
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) });
}

export function IdentifyView({ tab, pending, onPendingUsed, onOpenFont, onOpenFontId, toast, selectNow }: Props) {
  const { scan } = usePageScan(tab.tabId, !!tab.ping, tab.ping?.url, tab.fontsVersion);
  const [exact, setExact] = useState<Exact | null>(null);
  // Match the area as a picture (off when a selected area is only real text, read exactly).
  const [showEditor, setShowEditor] = useState(true);
  const [source, setSource] = useState<Source | null>(null);
  const [edit, setEdit] = useState<Edit>(NO_EDIT);
  const [autoInverted, setAutoInverted] = useState(false);
  const [adjust, setAdjust] = useState(false);
  const [lines, setLines] = useState<OcrLine[] | null>(null);
  // The prepared picture the text was read from (adjusting does not change results until it is read again).
  const [readImage, setReadImage] = useState<HTMLCanvasElement | null>(null);
  const [chosen, setChosen] = useState<number[]>([]);
  const [corrections, setCorrections] = useState<Record<string, string>>({});
  const [matches, setMatches] = useState<ImageMatch[] | null>(null);
  const [usedLetters, setUsedLetters] = useState(0);
  const [busy, setBusy] = useState<null | 'loading' | 'reading' | 'matching'>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // A file that is not a picture we can open.
  const [openFail, setOpenFail] = useState<{ name?: string; detail: string } | null>(null);
  // Every text style in the image, or one chosen line.
  const [mode, setMode] = useState<'all' | 'line'>('all');
  const fileRef = useRef<HTMLInputElement>(null);
  const autoRead = useRef<Source | null>(null);
  const remembered = useRef<HTMLCanvasElement | null>(null);
  // Font names in the post around the picture ("… — Lil Grotesk").
  const postNames = useMemo(() => namesFromContext(source?.context), [source]);

  const reset = () => {
    setSource(null);
    setEdit(NO_EDIT);
    setLines(null);
    setReadImage(null);
    setChosen([]);
    setCorrections({});
    setMatches(null);
    setError(null);
    setOpenFail(null);
    setAutoInverted(false);
    setExact(null);
    setShowEditor(true);
    setAdjust(false);
  };

  const load = useCallback(async (canvas: HTMLCanvasElement, kind: Source['kind'], pageUrl?: string, context?: string[], name?: string, jobId?: number) => {
    reset();
    setSource({ canvas, kind, pageUrl, context, name, jobId });
    // Light text on a dark background reads better inverted.
    if (looksInverted(finish(canvas, NO_EDIT))) {
      setEdit({ ...NO_EDIT, invert: true });
      setAutoInverted(true);
    }
  }, []);

  const loadFile = async (file: File | Blob, kind: Source['kind']) => {
    setBusy('loading');
    setError(null);
    setOpenFail(null);
    const name = file instanceof File && kind === 'upload' ? file.name : undefined;
    try {
      const canvas = file instanceof File && isHeic(file) ? await heicToCanvas(file) : await canvasFromBlob(file);
      await load(canvas, kind, undefined, undefined, name);
    } catch (err) {
      setOpenFail({ name: file instanceof File ? file.name : undefined, detail: err instanceof Error ? err.message : typeof err === 'string' ? `This image could not be opened: ${err}` : 'This image could not be opened.' });
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
        if (pending.rect) {
          // "Identify this picture" from the hover card: take that area of the screen.
          await sendToTab(pending.tabId, { type: 'ffp:hide-ui', hidden: true });
          await new Promise((r) => setTimeout(r, 120));
          canvas = await captureRect(pending.tabId, pending.rect);
        }
        if (!canvas && pending.srcUrl) {
          try {
            const res = await fetch(pending.srcUrl, { credentials: 'omit' });
            if (res.ok) canvas = await canvasFromBlob(await res.blob());
          } catch {
            /* the site blocks downloading it: take it from the screen instead */
          }
        }
        if (!canvas && pending.srcUrl) {
          const r = await sendToTab<{ rect: { x: number; y: number; w: number; h: number; dpr: number } | null }>(pending.tabId, { type: 'ffp:image-rect', src: pending.srcUrl });
          if (!r?.rect) throw new Error('The image could not be read. Try Select an area instead.');
          canvas = await captureRect(pending.tabId, r.rect);
        }
        if (!canvas) throw new Error('The picture could not be read. Try Select an area instead.');
        let context = pending.context;
        if (!context?.length && pending.srcUrl) context = (await sendToTab<{ context?: string[] }>(pending.tabId, { type: 'ffp:picture-context', src: pending.srcUrl }))?.context;
        await load(canvas, pending.rect ? 'page' : 'image', pending.pageUrl, context ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'The image could not be read.');
      } finally {
        setBusy(null);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);

  // The dock's "Read a picture or an area": start selecting as soon as the tab is known.
  const selectDone = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!selectNow || selectDone.current === selectNow || tab.tabId == null) return;
    selectDone.current = selectNow;
    selectArea();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectNow, tab.tabId]);

  const selectArea = async () => {
    if (tab.tabId == null) return;
    setError(null);
    setOpenFail(null);
    const r = await sendToTab<{ rect: { x: number; y: number; w: number; h: number; dpr: number } | null; inside: Exact | null }>(tab.tabId, { type: 'ffp:select-area' }, 120000);
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
      const canvas = await captureRect(tab.tabId, r.rect);
      // Same tick as load, so the area is never read as a picture when it is only real text.
      load(canvas, 'page', tab.ping?.url);
      // Real text in the area: its fonts are read exactly from the page, no guessing.
      if (r.inside?.fonts.length) {
        setExact(r.inside);
        setShowEditor(r.inside.pictures > 0);
      }
    } catch {
      setError('Chrome did not allow a screenshot of this page. Click the Font Finder Plus icon on the page and try again.');
    } finally {
      setBusy(null);
    }
  };

  const openJob = async (j: ImageJob) => {
    setBusy('loading');
    try {
      const c = await canvasFromBlob(j.image);
      await load(c, j.source ?? 'upload', j.pageUrl, undefined, 'Picture from Recent', j.id);
    } catch {
      setError('This picture could not be opened again.');
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
    setLines(null);
    setReadImage(prepared);
    try {
      // Columns and runs of names become separate samples.
      const found = splitSamples(await recognize(prepared, setProgress));
      setLines(found);
      setCorrections({});
      setMode(blocksFor(found).length >= 2 || findFontNames(found).length || postNames.length || !found.length ? 'all' : 'line');
      // Start with the clearest, longest line.
      const best = found.map((l, i) => [i, l.confidence * Math.min(1, l.text.length / 12)] as const).sort((a, b) => b[1] - a[1])[0];
      setChosen(best ? [best[0]] : []);
      if (!found.length && postNames.length) setError('No readable text was found in the picture itself. The post around it names a font, shown below.');
    } catch (err) {
      setError(`Text recognition failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(null);
    }
  };

  // Reading starts by itself once a picture is open.
  useEffect(() => {
    if (!source || !showEditor || !prepared || busy || autoRead.current === source) return;
    autoRead.current = source;
    read();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, showEditor, prepared, busy]);

  /** Keep this search in Recent (or update its entry, when it was opened from there). */
  const remember = async (image: HTMLCanvasElement, ocrText: string, results: NonNullable<ImageJob['results']>) => {
    if (source?.jobId != null) {
      await db.imageJobs.update(source.jobId, { ocrText, results });
      return;
    }
    const blob = await canvasBlob(image);
    await db.imageJobs.add({ image: blob, createdAt: Date.now(), ocrText, results, source: source?.kind, pageUrl: source?.pageUrl });
  };

  const onAllDone = (best: BlockSummary[]) => {
    if (!readImage || remembered.current === readImage || !best.length) return;
    remembered.current = readImage;
    const biggest = [...best].sort((a, b) => b.size - a.size)[0];
    remember(readImage, biggest.text.trim().slice(0, 80), best.slice(0, 10).map(({ family, bold, score, reason }) => ({ family, bold, score, reason }))).catch(() => undefined);
  };

  const chosenLines = useMemo(() => (lines ? chosen.map((i) => ({ line: lines[i], index: i })) : []), [lines, chosen]);
  const tiles = useMemo(() => (readImage && chosenLines.length ? letterTiles(readImage, chosenLines) : []), [readImage, chosenLines]);
  const text = tiles.map((t) => (t.space ? ' ' : '') + (corrections[t.key] ?? t.text)).join('');

  const match = async () => {
    if (!readImage) return;
    const glyphs = cutGlyphs(readImage, chosenLines, corrections);
    setUsedLetters(glyphs.length);
    if (glyphs.length < 2) {
      setError('Too few letters to compare. Choose a longer line, or correct letters that were read wrongly.');
      return;
    }
    setBusy('matching');
    setError(null);
    try {
      // A picture from this tab: also compare with the fonts this page uses (often paid ones).
      const sameTab = source && (source.kind === 'page' || source.kind === 'image') && scan && (!source.pageUrl || source.pageUrl === scan.url);
      const extra = sameTab ? await pageFontFiles(scan!.fonts, tab.tabId) : [];
      const res = await matchGlyphs(glyphs, 10, extra);
      setMatches(res);
      await remember(readImage, text, res.map(({ family, bold, score, reason }) => ({ family, bold, score, reason })));
    } catch (err) {
      setError(`Matching failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(null);
    }
  };

  const samePage = !!(source && (source.kind === 'page' || source.kind === 'image') && scan && (!source.pageUrl || source.pageUrl === scan.url));
  const noText = !!lines && lines.length === 0 && !postNames.length && busy !== 'reading';
  const picTitle = source ? source.name ?? KIND_NAME[source.kind] : '';
  const host = hostOf(source?.pageUrl);
  const fileInput = <input ref={fileRef} type="file" accept="image/*,.heic,.heif" hidden aria-label="Upload an image" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) loadFile(f, 'upload'); }} />;

  return (
    <>
      {fileInput}
      {!source && !openFail && (
        <StartCard
          canSelect={!!tab.ping}
          busy={!!busy}
          onSelect={selectArea}
          onUpload={() => fileRef.current?.click()}
          onFile={(f) => loadFile(f, 'upload')}
        />
      )}

      {!source && openFail && (
        <section className="empty">
          <span className="eic"><Icon icon={ImageNotFound01Icon} size={24} /></span>
          <div className="et">
            <h2>This file can't be opened</h2>
            <p title={openFail.detail}>{openFail.name ? `“${openFail.name}” isn't a picture we can read.` : "This isn't a picture we can read."} Use a JPG, PNG, WebP, GIF or HEIC, or take a screenshot of the part you want.</p>
          </div>
          <div className="eacts">
            <button className="btn primary" onClick={() => fileRef.current?.click()}><Icon icon={ImageUploadIcon} size={16} />Choose another file</button>
            <button className="btn" onClick={selectArea} disabled={!tab.ping || !!busy} title={tab.ping ? undefined : 'Click the Font Finder Plus icon on the page first'}><Icon icon={ScanImageIcon} size={16} />Select an area instead</button>
          </div>
        </section>
      )}

      {busy === 'loading' && <div className="notice neutral" role="status">Opening the picture…</div>}
      {error && <div className="notice neutral ierr" role="alert"><Icon icon={Alert02Icon} size={15} /><span>{error}</span></div>}

      {source && prepared && (
        <PictureCard
          prepared={prepared}
          title={picTitle}
          sub={noText
            ? 'Read on this computer, so nothing is uploaded. Use Adjust to crop or brighten it, then read it again.'
            : `${host ? `From ${host}. ` : ''}Read on this computer. Nothing is uploaded.`}
          big={noText}
          adjust={adjust}
          onAdjust={() => setAdjust(!adjust)}
          onAnother={reset}
        />
      )}

      {source && geo && prepared && adjust && (
        <Editor
          source={source}
          geo={geo}
          prepared={prepared}
          edit={edit}
          setEdit={setEdit}
          autoInverted={autoInverted}
          onReset={() => { setEdit(NO_EDIT); setAutoInverted(false); }}
          reading={busy === 'reading'}
          onRead={() => { setAdjust(false); setShowEditor(true); autoRead.current = source; read(); }}
        />
      )}

      {busy === 'reading' && (
        <section className="section ireading" aria-live="polite">
          <div className="row"><span className="grow">Reading the text</span><span className="pctnum">{Math.round(progress * 100)}%</span></div>
          <div className="ibar"><i style={{ transform: `scaleX(${progress})` }} /></div>
        </section>
      )}

      {exact && (
        <ExactFonts exact={exact} scan={scan} tabId={tab.tabId} onOpenFont={onOpenFont} showEditor={showEditor} onShowEditor={() => setShowEditor(true)} />
      )}

      {noText && (
        <section className="empty">
          <span className="eic"><Icon icon={ImageNotFound01Icon} size={24} /></span>
          <div className="et">
            <h2>No text found in this picture</h2>
            <p>Font Finder Plus needs a few clear letters. Crop closer to the words with Adjust, turn up the contrast if the text is faint, or turn on Invert colours for light text on dark.</p>
          </div>
        </section>
      )}

      {lines && (lines.length > 0 || postNames.length > 0) && showEditor && mode === 'all' && readImage && busy !== 'reading' && (
        <AllFonts
          image={readImage}
          lines={lines}
          postNames={postNames}
          scan={scan}
          tabId={tab.tabId}
          samePage={samePage}
          onOpenFontId={onOpenFontId}
          toast={toast}
          onDone={onAllDone}
          headExtra={lines.length > 0 && (
            <p className="sub">Each text style is matched on its own. <button className="linkbtn" onClick={() => setMode('line')}>Pick one line instead</button></p>
          )}
        />
      )}

      {lines && lines.length > 0 && showEditor && mode === 'line' && busy !== 'reading' && (
        <section className="section iline">
          <div className="sechead">
            <h2>Text found<span className="count">{lines.length}</span></h2>
            <button className="linkbtn" onClick={() => setMode('all')}>Every font in the picture</button>
          </div>
          <p className="sub">Choose the line to match.</p>
          <div className="ocrlines">
            {lines.map((l, i) => (
              <label key={i} className={`ocrline${chosen.includes(i) ? ' on' : ''}`}>
                <input type="checkbox" checked={chosen.includes(i)} onChange={() => { setChosen(chosen.includes(i) ? chosen.filter((x) => x !== i) : [...chosen, i]); setMatches(null); }} />
                <span className="grow" style={{ overflowWrap: 'anywhere' }}>{l.text}</span>
                <span className={`pill ${l.confidence >= 80 ? 'neutral' : l.confidence >= 55 ? 'warn' : 'bad'}`} title="How sure the reading is">{Math.round(l.confidence)}%</span>
              </label>
            ))}
          </div>
          {tiles.length > 0 && (
            <div className="iletters">
              <div>
                <h3>Letters</h3>
                <p className="sub">Fix any that were read wrongly. Letters with a yellow edge were hard to read. Only a to z, A to Z and 0 to 9 are compared.</p>
              </div>
              <div className="tiles">
                {tiles.map((t) => (
                  <label key={t.key} className={`tile${t.confidence < 60 ? ' unsure' : ''}`} title={`Read as "${t.text}" (${Math.round(t.confidence)}% sure)`}>
                    <img src={t.thumb} alt="" />
                    <input aria-label={`Letter read as ${t.text}`} maxLength={1} value={corrections[t.key] ?? t.text} onChange={(e) => { setCorrections({ ...corrections, [t.key]: e.target.value }); setMatches(null); }} />
                  </label>
                ))}
              </div>
            </div>
          )}
          <button className="btn primary wide" onClick={match} disabled={!!busy || !chosen.length}>
            {busy === 'matching' ? 'Comparing letters…' : 'Find the closest fonts'}
          </button>
        </section>
      )}

      {matches && readImage && showEditor && mode === 'line' && (
        <Results matches={matches} usedLetters={usedLetters} text={text} image={readImage} scan={scan} tabId={tab.tabId} toast={toast} onOpenFontId={onOpenFontId} />
      )}

      {!source && <History onOpen={openJob} toast={toast} />}
    </>
  );
}

// ------------------------------------------------------------- start

function StartCard({ canSelect, busy, onSelect, onUpload, onFile }: { canSelect: boolean; busy: boolean; onSelect: () => void; onUpload: () => void; onFile: (f: File) => void }) {
  const [over, setOver] = useState(false);
  return (
    <section className="section istart">
      <h2>Find the fonts in a picture</h2>
      <p className="sub">A logo, a poster, a screenshot or a post. It is read on this computer and never uploaded.</p>
      <button
        className={`idrop${over ? ' over' : ''}`}
        onClick={onUpload}
        disabled={busy}
        aria-label="Drop a picture here, or click to choose one"
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const f = [...e.dataTransfer.files].find((x) => x.type.startsWith('image/') || isHeic(x)) ?? e.dataTransfer.files[0];
          if (f) onFile(f);
        }}
      >
        <span className="dicon"><Icon icon={ImageUploadIcon} size={24} /></span>
        <b>Drop a picture here</b>
        <span className="dsub">or paste with <kbd>{IS_MAC ? '⌘' : 'Ctrl'}</kbd> <kbd>V</kbd></span>
      </button>
      <div className="istartbtns">
        <button className="btn primary" onClick={onSelect} disabled={!canSelect || busy} title={canSelect ? 'Drag over the text you want on the page' : 'Click the Font Finder Plus icon on the page first'}>
          <Icon icon={ScanImageIcon} size={16} />Select an area on the page
        </button>
        <button className="btn" onClick={onUpload} disabled={busy}>
          <Icon icon={ImageUploadIcon} size={16} />Upload
        </button>
      </div>
      <p className="ihint">
        <Icon icon={InformationCircleIcon} size={15} />
        <span>
          On any page, right-click a picture and choose <b>Identify the font in this image</b>.
          {!canSelect && ' To select an area, first click the Font Finder Plus icon on the page.'}
        </span>
      </p>
    </section>
  );
}

// ------------------------------------------------------------- picture

function PictureCard({ prepared, title, sub, big, adjust, onAdjust, onAnother }: { prepared: HTMLCanvasElement; title: string; sub: string; big: boolean; adjust: boolean; onAdjust: () => void; onAnother: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    c.width = prepared.width;
    c.height = prepared.height;
    c.getContext('2d')!.drawImage(prepared, 0, 0);
  }, [prepared, big]);
  return (
    <section className={`section ipic${big ? ' big' : ''}`}>
      <div className="ithumb"><canvas ref={ref} className="prepared" aria-label="The picture, as it is read" /></div>
      <div className="ipinfo">
        <b title={title}>{title}</b>
        <span>{sub}</span>
        <div className="pacts">
          <button className="btn sm iadjust" aria-expanded={adjust} onClick={onAdjust}>
            <Icon icon={ImageCropIcon} size={15} />Adjust<span className="chev"><Icon icon={ArrowDown01Icon} size={14} /></span>
          </button>
          <button className="btn sm" onClick={onAnother}>Use another</button>
        </div>
      </div>
    </section>
  );
}

// ------------------------------------------------------------- editor

function Editor({ source, geo, prepared, edit, setEdit, autoInverted, onReset, reading, onRead }: { source: Source; geo: HTMLCanvasElement; prepared: HTMLCanvasElement; edit: Edit; setEdit: (e: Edit) => void; autoInverted: boolean; onReset: () => void; reading: boolean; onRead: () => void }) {
  const [mode, setMode] = useState<'crop' | 'perspective'>('crop');
  const view = mode === 'perspective' ? source.canvas : geo;
  const ref = useRef<HTMLCanvasElement>(null);
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const [live, setLive] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [handle, setHandle] = useState<number | null>(null);
  void prepared;

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    c.width = view.width;
    c.height = view.height;
    c.getContext('2d')!.drawImage(view, 0, 0);
  }, [view]);

  const toImage = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * view.width, y: ((e.clientY - r.top) / r.height) * view.height };
  };
  const corners: [number, number][] = edit.perspective ?? [[0, 0], [source.canvas.width, 0], [source.canvas.width, source.canvas.height], [0, source.canvas.height]];
  const pct = (v: number, of: number) => `${(v / of) * 100}%`;
  const crop = live ?? edit.crop;

  return (
    <section className="section iadj" aria-label="Adjust the picture">
      <div className="sechead">
        <h2>Adjust</h2>
        <button className="linkbtn" onClick={onReset}>Reset</button>
      </div>
      <div className="itools" role="group" aria-label="Tool">
        <button className="btn sm" aria-pressed={mode === 'crop'} onClick={() => setMode('crop')}><Icon icon={ImageCropIcon} size={15} />Crop</button>
        <button className="btn sm" aria-pressed={mode === 'perspective'} onClick={() => { setMode('perspective'); if (!edit.perspective) setEdit({ ...edit, perspective: corners, crop: null }); }}><Icon icon={PerspectiveIcon} size={15} />Perspective</button>
        <button className="btn sm" onClick={() => setEdit({ ...edit, turn: (((edit.turn + 1) % 4) as Edit['turn']), crop: null })}><Icon icon={RotateClockwiseIcon} size={15} />Turn 90°</button>
      </div>
      <div className="ieditwrap">
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
        <p className="ehint">
          <span>
            {mode === 'crop'
              ? edit.crop ? 'Drag again to change the crop.' : 'Drag over the text you want. Tighter crops give better matches.'
              : 'Drag the four corners onto the corners of a slanted sign or page to flatten it. Then switch back to Crop.'}
          </span>
          {edit.crop && <button className="linkbtn" onClick={() => setEdit({ ...edit, crop: null })}>Clear crop</button>}
          {edit.perspective && <button className="linkbtn" onClick={() => setEdit({ ...edit, perspective: null, crop: null })}>Clear perspective</button>}
        </p>
      </div>
      <div className="isliders">
        <Slider label="Straighten" value={edit.rotate} min={-20} max={20} step={0.5} unit="°" onChange={(v) => setEdit({ ...edit, rotate: v, crop: null })} />
        <Slider label="Brightness" value={edit.brightness} min={-100} max={100} step={1} onChange={(v) => setEdit({ ...edit, brightness: v })} />
        <Slider label="Contrast" value={edit.contrast} min={-100} max={100} step={1} onChange={(v) => setEdit({ ...edit, contrast: v })} />
      </div>
      <div className="iinv">
        <Icon icon={ContrastIcon} size={16} />
        <span>Invert colours</span>
        <span className="faint">for light text on dark</span>
        <span className="grow" />
        <button className="switch" role="switch" aria-checked={edit.invert} aria-label="Invert colours" onClick={() => setEdit({ ...edit, invert: !edit.invert })} />
      </div>
      {autoInverted && <p className="sub iauto">Invert was turned on because the picture looks like light text on a dark background.</p>}
      <button className="btn primary wide" onClick={onRead} disabled={reading}>{reading ? 'Reading the text…' : 'Read again'}</button>
    </section>
  );
}

function Slider({ label, value, min, max, step, unit = '', onChange }: { label: string; value: number; min: number; max: number; step: number; unit?: string; onChange: (v: number) => void }) {
  return (
    <label className="isl">
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label={label} />
      <span className="val">{value}{unit}</span>
    </label>
  );
}

// ------------------------------------------------------------- results (one chosen line)

function Results({ matches, usedLetters, text, image, scan, tabId, toast, onOpenFontId }: { matches: ImageMatch[]; usedLetters: number; text: string; image: HTMLCanvasElement; scan: PageScan | null; tabId: number | null; toast: (m: string) => void; onOpenFontId: (id: string) => void }) {
  const verdict = imageVerdict(matches.map((m) => m.score), usedLetters);
  const top = matches[0] ?? null;
  const close = matches.length > 2 && (matches[0]?.score ?? 0) - matches[2].score <= 3;
  const imgUrl = useMemo(() => image.toDataURL('image/png'), [image]);
  const onPage = matches.some((m) => m.onPage);
  const topUsage = top?.onPage ? scan?.fonts.find((f) => (f.displayName || f.family) === top.family) ?? null : null;
  const topKnown = topUsage ? knownFont(topUsage.displayName || topUsage.family) : null;
  return (
    <div className="iresults">
      <section className="section ireshead">
        <div className="sechead"><h2>Closest fonts<span className="count">{matches.length}</span></h2></div>
        {verdict === 'exact' && top && (
          <p className="sub">
            Likely {top.family}. Its letters match very closely. In our accuracy test, matches labelled like this were right every time.
            {top.onPage && topUsage ? ` It is a font this page uses${topKnown ? `, sold by ${topKnown.by}` : ''}.` : ''}
            {topKnown && <> <a className="linkbtn" href={topKnown.url} target="_blank" rel="noreferrer">{topKnown.licence === 'commercial' ? `Buy from ${topKnown.by}` : `Get it from ${topKnown.by}`}</a></>}
          </p>
        )}
        {verdict === 'close' && <p className="sub">No free font is a clear match. The font in your picture may be one of these, or a paid font that looks like them.</p>}
        {verdict === 'unlikely' && (
          <p className="sub">
            {usedLetters < 4 ? `Only ${usedLetters} ${usedLetters === 1 ? 'letter was' : 'letters were'} compared. ` : 'No free font matches closely, so the font is probably paid or made for this design. '}
            For better results crop tightly around one line, use a bigger or sharper picture, straighten it, and fix any letters read wrongly. Joined-up script lettering often cannot be split into letters.
          </p>
        )}
        {close && verdict !== 'unlikely' && <p className="sub">Several fonts here are almost the same. Compare details such as a, g, R, Q and y to tell them apart.</p>}
      </section>
      {matches.map((m, i) => <ImageMatchRow key={m.family} m={m} rank={i + 1} likely={i === 0 && verdict === 'exact'} text={text} imgUrl={imgUrl} image={image} usage={m.onPage ? scan?.fonts.find((f) => (f.displayName || f.family) === m.family) ?? null : null} liveTarget={!m.onPage ? liveTarget(scan) : null} tabId={tabId} toast={toast} onOpenFontId={onOpenFontId} />)}
      <p className="ifoot">
        Compared letter by letter on this computer with {INDEX_COUNT.toLocaleString()} free Google Fonts families{onPage ? ' and the fonts this page uses' : ''}. A paid font that is not on this page gets its closest free look-alikes, not its own name.
      </p>
    </div>
  );
}

/** Where "Try on page" puts a match: the page's heading font, or its most used font. */
function liveTarget(scan: PageScan | null): PageFontUsage | null {
  const fonts = (scan?.fonts ?? []).filter((f) => f.kind !== 'generic');
  return [...fonts].sort((a, b) => (b.roles.heading ?? 0) - (a.roles.heading ?? 0) || b.elementCount - a.elementCount)[0] ?? null;
}

/** Fonts of the real text inside the selected area, read exactly from the page. */
function ExactFonts({ exact, scan, tabId, onOpenFont, showEditor, onShowEditor }: { exact: Exact; scan: PageScan | null; tabId: number | null; onOpenFont: Props['onOpenFont']; showEditor: boolean; onShowEditor: () => void }) {
  return (
    <section className="section iexact">
      <div className="sechead"><h2>Fonts in this area<span className="count">{exact.fonts.length}</span></h2></div>
      <p className="sub">
        This area has real text, so its fonts are read exactly from the page. No guessing needed.
        {exact.pictures > 0 && ` It also has ${exact.pictures === 1 ? 'a picture' : `${exact.pictures} pictures`} (images or drawings), which are matched below.`}
      </p>
      <div className="ilist">
        {exact.fonts.map((f) => {
          const usage = scan?.fonts.find((u) => u.key === f.key) ?? null;
          const badge = licenseBadge(f.licenseType as LicenseType);
          return (
            <div key={f.key} className="match">
              <div className="nmrow">
                <b>{f.name}</b>
                <span className={`lic ${badge.tone}`}><i />{badge.text}</span>
              </div>
              <span className="inote" style={{ overflowWrap: 'anywhere' }}>“{f.sample}”</span>
              {usage && (
                <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                  <button className="btn sm on-card" onClick={() => onOpenFont(usage, fontId(usage.family, usage.source))}>Details</button>
                  {tabId != null && <button className="btn sm on-card" onClick={() => sendToTab(tabId, { type: 'ffp:highlight', key: f.key, label: f.name })}><Icon icon={Target02Icon} size={14} />Show on page</button>}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {!showEditor && (
        <div className="iask">
          <span className="grow">Want to compare it as a picture instead?</span>
          <button className="btn sm" onClick={onShowEditor}>Match it as a picture</button>
        </div>
      )}
    </section>
  );
}

function ImageMatchRow({ m, rank, likely, text, imgUrl, image, usage, liveTarget: target, tabId, toast, onOpenFontId }: { m: ImageMatch; rank: number; likely: boolean; text: string; imgUrl: string; image: HTMLCanvasElement; usage: PageFontUsage | null; liveTarget: PageFontUsage | null; tabId: number | null; toast: (msg: string) => void; onOpenFontId: (id: string) => void }) {
  const swaps = useSwaps(tabId);
  const [trying, setTrying] = useState(false);
  const live = !!target && swaps[target.key] === m.family;
  const tryLive = async () => {
    if (!target || tabId == null) return;
    if (live) return undoSwap(tabId, target.key);
    setTrying(true);
    try {
      await trySwap(tabId, target.key, m.family, null);
      toast(`Showing ${m.family} on the page in place of ${target.displayName || target.family}`);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not try it on the page');
    } finally {
      setTrying(false);
    }
  };
  const google = useGoogleFontReady(m.onPage ? null : m.family);
  const page = usePreviewFamily(usage, tabId);
  const css = m.onPage ? page.css : google.css;
  const ready = m.onPage ? page.ready && !page.failed : google.ready;
  const [compare, setCompare] = useState(rank === 1);
  const sample = text.trim() || m.family;
  const missing = useMissing(css, sample, ready);
  const gf = googleFamily(m.family);
  const id = m.onPage && usage ? fontId(usage.family, usage.source) : `${m.family}::google`;
  const save = async () => {
    if (m.onPage && usage) await saveFont(recordFromUsage(usage, bestFileUrl(usage, usage.sample.fontWeight)), null, usage.sample);
    else await saveFont({ id, family: m.family, displayName: m.family, catalogFamily: m.family, source: 'google', kind: 'web', classification: gf?.c ?? 'unknown', licenseType: gf?.l ?? 'unknown', designers: gf?.d ?? [], files: [] }, null, null);
    // Keep the image it was found from with the font.
    const blob = await canvasBlob(image);
    const shot = await db.screenshots.add({ blob, pageUrl: 'Identified from an image', createdAt: Date.now() });
    const sp = await db.specimens.where('fontId').equals(id).first();
    if (sp?.id) await db.specimens.update(sp.id, { screenshotIds: [...sp.screenshotIds, shot] });
    else await db.specimens.add({ fontId: id, screenshotIds: [shot], pairing: null, notes: '', createdAt: Date.now() });
  };
  return (
    <section className="section ires match">
      <div className="icut">
        {compare && <img src={imgUrl} alt="Your picture" />}
        <span className="isample" dir="auto" style={{ fontFamily: css, fontWeight: m.bold ? 700 : 400 }} title={`Your text set in ${m.family}`}>{sample}</span>
      </div>
      <div className="iinfo">
        <div className="nmrow">
          <b>{m.family}{m.bold ? ' Bold' : ''}</b>
          {m.onPage ? <span className="gtag">On this page{usage ? ` · ${licenseBadge(usage.licenseType).text}` : ''}</span> : <Lic name={m.family} />}
          <span className="grow" />
          <span className="pct">{m.score}% match</span>
        </div>
        {likely ? <Tick>Likely this font. {m.reason}</Tick> : <Note>{m.reason}</Note>}
        {ready && (missing.length
          ? <span className="inote err">Missing {missing.length} of your letters ({missing.slice(0, 6).map((c) => `“${c}”`).join(' ')})</span>
          : <Tick>Has every letter of your text</Tick>)}
      </div>
      <div className="ilinks">
        <button className="linkbtn" onClick={() => setCompare(!compare)}>{compare ? 'Hide your picture' : 'Compare with your picture'}</button>
        {target && tabId != null && (
          <button className="linkbtn" onClick={tryLive} disabled={trying} title={`Shows ${m.family} on the page in place of ${target.displayName || target.family}`}>
            {trying ? 'Loading…' : live ? 'Showing on page · Undo' : 'Try it live on the page'}
          </button>
        )}
      </div>
      <div className="racts">
        {!m.onPage && <button className="btn sm" onClick={async () => onOpenFontId(await ensureRecord(m.family))}>Details</button>}
        <SaveFontButton fontId={id} name={m.family} onSave={save} toast={toast} />
        <span className="grow" />
        {!m.onPage && <WhereToGet name={m.family} />}
      </div>
    </section>
  );
}

// ------------------------------------------------------------- recent

function History({ onOpen, toast }: { onOpen: (j: ImageJob) => void; toast: (m: string) => void }) {
  const jobs = useLiveQuery(() => db.imageJobs.orderBy('createdAt').reverse().limit(20).toArray(), []) ?? [];
  const urls = useMemo(() => jobs.map((j) => URL.createObjectURL(j.image)), [jobs]);
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls]);
  if (!jobs.length) return null;
  return (
    <section className="section irecent">
      <div className="sechead">
        <h2>Recent<span className="count">{jobs.length}</span></h2>
        <button className="linkbtn danger" onClick={async () => { await db.imageJobs.clear(); toast('Recent cleared'); }}>Clear all</button>
      </div>
      <div className="rlist">
        {jobs.map((j, i) => {
          const top = j.results?.[0];
          return (
            <div key={j.id} className="histrow">
              <button className="histmain" onClick={() => onOpen(j)} aria-label={`Open ${top?.family ?? 'this picture'} again`}>
                <span className="rthumb"><img src={urls[i]} alt="" /></span>
                <span className="rt">
                  <b>{top ? `${top.family}${top.bold ? ' Bold' : ''} · ${top.score}%` : 'No match'}</b>
                  <span>{j.ocrText ? `“${j.ocrText}” · ` : ''}{when(j.createdAt)}</span>
                </span>
              </button>
              <button className="iconbtn sm rdel tip" data-tip="Delete" aria-label="Delete from Recent" onClick={async () => { await db.imageJobs.delete(j.id!); toast('Deleted from Recent'); }}><Icon icon={Delete02Icon} size={16} /></button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
