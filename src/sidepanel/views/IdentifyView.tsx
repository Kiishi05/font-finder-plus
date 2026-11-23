import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { googleFamily, licenseBadge } from '../../shared/catalog';
import { db, saveFont } from '../../shared/db';
import { SaveFontButton } from '../components/SaveFontButton';
import { ensureRecord, pageFontFiles } from '../lib/imagefonts';
import { knownFont } from '../../shared/licences';
import { findFontNames, namesFromContext } from '../lib/fontnames';
import { splitSamples } from '../lib/segments';
import { AllFonts, Cmp, Lic, WhereToGet, blocksFor, cutOut, type BlockSummary } from './identify/AllFonts';
import { imageVerdict } from '../../shared/imagerank';
import {
  Alert02Icon,
  ArrowDown01Icon,
  ContrastIcon,
  Delete02Icon,
  ImageNotFound01Icon,
  ImageUploadIcon,
  InformationCircleIcon,
  PerspectiveIcon,
  RotateClockwiseIcon,
  ScanImageIcon,
  Target02Icon,
  Tick02Icon,
  ImgCloseIcon,
  ImgCropIcon,
  ImgFileIcon,
  ImgResetIcon,
  ImgStraightenIcon,
  ImgSunIcon,
} from '../../shared/icons';
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

/** The picture and its lines (Adjust, Text found), or the fonts found in it. */
type Stage = 'picture' | 'results';
type Tool = null | 'crop' | 'perspective';
/** What "Find the fonts" matched: every line on its own, or one text style (with letters that can be corrected). */
interface Run { mode: 'all' | 'line'; lines: OcrLine[] }

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

/** Several text styles, or font names, among these lines: each is matched on its own. */
const severalStyles = (lines: OcrLine[], postNames: number) => blocksFor(lines).length >= 2 || findFontNames(lines).length > 0 || postNames > 0;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function IdentifyView({ tab, pending, onPendingUsed, onOpenFont, onOpenFontId, toast, selectNow }: Props) {
  const { scan } = usePageScan(tab.tabId, !!tab.ping, tab.ping?.url, tab.fontsVersion);
  const [exact, setExact] = useState<Exact | null>(null);
  // Match the area as a picture (off when a selected area is only real text, read exactly).
  const [showEditor, setShowEditor] = useState(true);
  const [source, setSource] = useState<Source | null>(null);
  const [edit, setEdit] = useState<Edit>(NO_EDIT);
  const [autoInverted, setAutoInverted] = useState(false);
  const [stage, setStage] = useState<Stage>('picture');
  const [tool, setTool] = useState<Tool>(null);
  const [lines, setLines] = useState<OcrLine[] | null>(null);
  // The prepared picture the text was read from (adjusting reads it again).
  const [readImage, setReadImage] = useState<HTMLCanvasElement | null>(null);
  const [chosen, setChosen] = useState<number[]>([]);
  const [corrections, setCorrections] = useState<Record<string, string>>({});
  const [run, setRun] = useState<Run | null>(null);
  const [matches, setMatches] = useState<ImageMatch[] | null>(null);
  const [usedLetters, setUsedLetters] = useState(0);
  const [busy, setBusy] = useState<null | 'loading' | 'reading' | 'matching'>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // A file that is not a picture we can open.
  const [openFail, setOpenFail] = useState<{ name?: string; detail: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const autoRead = useRef<Source | null>(null);
  const readFor = useRef<HTMLCanvasElement | null>(null);
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
    setRun(null);
    setMatches(null);
    setError(null);
    setOpenFail(null);
    setAutoInverted(false);
    setExact(null);
    setShowEditor(true);
    setStage('picture');
    setTool(null);
    readFor.current = null;
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

  /** Read the text. The first reading of a picture with several styles goes straight to its fonts. */
  const read = async (img: HTMLCanvasElement, first: boolean) => {
    setBusy('reading');
    setProgress(0);
    setError(null);
    setMatches(null);
    setRun(null);
    setLines(null);
    setReadImage(img);
    try {
      // Columns and runs of names become separate samples.
      const found = splitSamples(await recognize(img, setProgress));
      setLines(found);
      setCorrections({});
      const several = severalStyles(found, postNames.length);
      // Start with the clearest, longest line, or every line when there are several styles.
      const best = found.map((l, i) => [i, l.confidence * Math.min(1, l.text.length / 12)] as const).sort((a, b) => b[1] - a[1])[0];
      setChosen(several ? found.map((_, i) => i) : best ? [best[0]] : []);
      if (first && several) {
        setRun({ mode: 'all', lines: found });
        setStage('results');
      }
      if (!found.length && postNames.length) setError('No readable text was found in the picture itself. The post around it names a font, shown below.');
    } catch (err) {
      setError(`Text recognition failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(null);
    }
  };

  // Reading starts by itself once a picture is open, and again shortly after it is adjusted.
  useEffect(() => {
    if (!source || !showEditor || !prepared || busy || stage !== 'picture' || readFor.current === prepared) return;
    const first = autoRead.current !== source;
    const t = setTimeout(() => {
      autoRead.current = source;
      readFor.current = prepared;
      read(prepared, first);
    }, first ? 0 : 700);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, showEditor, prepared, busy, stage]);

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

  const chosenLines = useMemo(() => (lines ? [...chosen].sort((a, b) => a - b).map((i) => ({ line: lines[i], index: i })) : []), [lines, chosen]);
  const several = useMemo(() => severalStyles(chosenLines.map((c) => c.line), postNames.length), [chosenLines, postNames]);
  const tiles = useMemo(() => (readImage && chosenLines.length && !several ? letterTiles(readImage, chosenLines) : []), [readImage, chosenLines, several]);
  const text = tiles.map((t) => (t.space ? ' ' : '') + (corrections[t.key] ?? t.text)).join('');

  /** Match one text style (the chosen lines together), with the letters as corrected. */
  const match = async (): Promise<boolean> => {
    if (!readImage) return false;
    const glyphs = cutGlyphs(readImage, chosenLines, corrections);
    setUsedLetters(glyphs.length);
    if (glyphs.length < 2) {
      setError('Too few letters to compare. Choose a longer line, or correct letters that were read wrongly.');
      return false;
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
      return true;
    } catch (err) {
      setError(`Matching failed: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    } finally {
      setBusy(null);
    }
  };

  /** "Find the fonts": each chosen line on its own, or one text style letter by letter. */
  const findFonts = async () => {
    const sel = chosenLines.map((c) => c.line);
    if (several) {
      // Unchanged since the last time: keep the fonts already found.
      const same = run?.mode === 'all' && run.lines.length === sel.length && run.lines.every((l, i) => l === sel[i]);
      if (!same) setRun({ mode: 'all', lines: sel });
      setStage('results');
      return;
    }
    if (matches && run?.mode === 'line') {
      setStage('results');
      return;
    }
    if (await match()) {
      setRun({ mode: 'line', lines: sel });
      setStage('results');
    }
  };

  const toggleLine = (i: number) => {
    setChosen(chosen.includes(i) ? chosen.filter((x) => x !== i) : [...chosen, i]);
    setMatches(null);
  };

  const samePage = !!(source && (source.kind === 'page' || source.kind === 'image') && scan && (!source.pageUrl || source.pageUrl === scan.url));
  const noText = !!lines && lines.length === 0 && !postNames.length && busy !== 'reading';
  const picTitle = source ? source.name ?? KIND_NAME[source.kind] : '';
  const host = hostOf(source?.pageUrl);
  const changed = JSON.stringify(edit) !== JSON.stringify(NO_EDIT);
  const fileInput = <input ref={fileRef} type="file" accept="image/*,.heic,.heif" hidden aria-label="Upload an image" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) loadFile(f, 'upload'); }} />;
  const showResults = stage === 'results' && !!run && !!readImage && showEditor;
  const picSub = showResults
    ? run!.mode === 'all' ? `${plural(run!.lines.length, 'line')} read` : `${plural(run!.lines.length, 'line')} matched`
    : source ? `${source.canvas.width} × ${source.canvas.height}${host ? ` · from ${host}` : ''} · read on this computer` : '';

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
        <section className="section ifail">
          <div className="iht">
            <span className="eic"><Icon icon={ImageNotFound01Icon} size={22} /></span>
            <h2>This file can't be opened</h2>
            <p title={openFail.detail}>{openFail.name ? `“${openFail.name}” isn't a picture we can read.` : "This isn't a picture we can read."} Use a JPG, PNG, WebP, GIF or HEIC, or take a screenshot of the part you want.</p>
          </div>
          <div className="irow2">
            <button className="btn primary" onClick={() => fileRef.current?.click()}><Icon icon={ImgFileIcon} size={16} />Choose another file</button>
            <button className="btn" onClick={selectArea} disabled={!tab.ping || !!busy} title={tab.ping ? undefined : 'Click the Font Finder Plus icon on the page first'}><Icon icon={ScanImageIcon} size={16} />Select an area instead</button>
          </div>
        </section>
      )}

      {busy === 'loading' && <div className="notice neutral iload" role="status">Opening the picture…</div>}

      {source && prepared && geo && (
        <PictureCard
          source={source}
          geo={geo}
          prepared={prepared}
          edit={edit}
          setEdit={setEdit}
          tool={stage === 'picture' && showEditor ? tool : null}
          compact={showResults}
          title={picTitle}
          sub={picSub}
          onAdjust={() => setStage('picture')}
          onAnother={reset}
        />
      )}

      {error && <div className="notice ierr" role="alert"><Icon icon={Alert02Icon} size={16} /><span>{error}</span></div>}

      {exact && (
        <ExactFonts exact={exact} scan={scan} tabId={tab.tabId} onOpenFont={onOpenFont} showEditor={showEditor} onShowEditor={() => setShowEditor(true)} />
      )}

      {source && prepared && showEditor && stage === 'picture' && (
        <AdjustCard
          edit={edit}
          setEdit={setEdit}
          tool={tool}
          setTool={setTool}
          source={source}
          changed={changed}
          autoInverted={autoInverted}
          onReset={() => { setEdit(NO_EDIT); setAutoInverted(false); setTool(null); }}
        />
      )}

      {source && showEditor && stage === 'picture' && busy === 'reading' && (
        <section className="section iline ireading" aria-live="polite">
          <div className="sechead"><h2>Reading the text</h2><span className="pctnum">{Math.round(progress * 100)}%</span></div>
          <div className="ibar"><i style={{ transform: `scaleX(${progress})` }} /></div>
          <p className="sub">Read on this computer. Nothing is uploaded.</p>
        </section>
      )}

      {noText && showEditor && stage === 'picture' && (
        <section className="section inotext">
          <div className="iht">
            <h2>No text found</h2>
            <p>Font Finder Plus needs a few clear letters. Crop closer to the words, turn up the contrast if the text is faint, or use Invert for light text on dark. It reads the picture again after each change.</p>
          </div>
        </section>
      )}

      {lines && lines.length > 0 && showEditor && stage === 'picture' && busy !== 'reading' && (
        <TextFound
          lines={lines}
          chosen={chosen}
          onToggle={toggleLine}
          tiles={tiles}
          corrections={corrections}
          onCorrect={(key, v) => { setCorrections({ ...corrections, [key]: v }); setMatches(null); }}
          several={several}
          busy={busy}
          onFind={findFonts}
        />
      )}

      {run?.mode === 'all' && readImage && showEditor && (run.lines.length > 0 || postNames.length > 0) && (
        <AllFonts
          hidden={!showResults}
          image={readImage}
          lines={run.lines}
          postNames={postNames}
          scan={scan}
          tabId={tab.tabId}
          samePage={samePage}
          onOpenFontId={onOpenFontId}
          toast={toast}
          onDone={onAllDone}
        />
      )}

      {showResults && run?.mode === 'line' && matches && readImage && (
        <Results matches={matches} usedLetters={usedLetters} text={text} lines={run.lines} image={readImage} scan={scan} tabId={tab.tabId} toast={toast} onOpenFontId={onOpenFontId} />
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
      <div className="iht">
        <h2>Find the font in a picture</h2>
        <p>A screenshot, logo or poster. It's read on this computer. Nothing is uploaded.</p>
      </div>
      <button
        className={`idrop${over ? ' over' : ''}`}
        onClick={onUpload}
        disabled={busy}
        aria-label="Drop a picture here, paste one, or click to choose a file"
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const f = [...e.dataTransfer.files].find((x) => x.type.startsWith('image/') || isHeic(x)) ?? e.dataTransfer.files[0];
          if (f) onFile(f);
        }}
      >
        <span className="dicon"><Icon icon={ImageUploadIcon} size={20} /></span>
        <b>Drop a picture here</b>
        <span className="dsub">or paste it <kbd>{IS_MAC ? '⌘' : 'Ctrl'}</kbd><kbd>V</kbd></span>
      </button>
      <div className="irow2">
        <button className="btn primary" onClick={onSelect} disabled={!canSelect || busy} title={canSelect ? 'Drag over the text you want on the page' : 'Click the Font Finder Plus icon on the page first'}>
          <Icon icon={ScanImageIcon} size={16} />Select an area
        </button>
        <button className="btn" onClick={onUpload} disabled={busy}>
          <Icon icon={ImgFileIcon} size={16} />Choose a file
        </button>
      </div>
      <p className="ihint">
        <Icon icon={InformationCircleIcon} size={16} />
        <span>
          On any page, right-click a picture and choose <b>Identify the font in this image</b>.
          {!canSelect && ' To select an area, first click the Font Finder Plus icon on the page.'}
        </span>
      </p>
    </section>
  );
}

// ------------------------------------------------------------- picture

/** The picture as it is read. With Crop or Perspective on, it is the place to drag. */
function PictureCard({ source, geo, prepared, edit, setEdit, tool, compact, title, sub, onAdjust, onAnother }: {
  source: Source; geo: HTMLCanvasElement; prepared: HTMLCanvasElement; edit: Edit; setEdit: (e: Edit) => void; tool: Tool;
  compact: boolean; title: string; sub: string; onAdjust: () => void; onAnother: () => void;
}) {
  return (
    <section className={`section ipic${compact ? ' compact' : ''}`}>
      {tool ? <EditStage source={source} geo={geo} edit={edit} setEdit={setEdit} tool={tool} /> : <Preview canvas={prepared} />}
      <div className="ifile">
        <div>
          <b title={title}>{title}</b>
          <span>{sub}</span>
        </div>
        {compact ? (
          <>
            <button className="btn sm" onClick={onAdjust}><Icon icon={ImgCropIcon} size={16} />Adjust</button>
            <button className="iconbtn sm iclose" aria-label="Use another picture" title="Use another picture" onClick={onAnother}><Icon icon={ImgCloseIcon} size={17} /></button>
          </>
        ) : (
          <button className="btn sm" onClick={onAnother}>Use another</button>
        )}
      </div>
    </section>
  );
}

function Preview({ canvas }: { canvas: HTMLCanvasElement }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    c.width = canvas.width;
    c.height = canvas.height;
    c.getContext('2d')!.drawImage(canvas, 0, 0);
  }, [canvas]);
  return <div className="istage"><canvas ref={ref} className="prepared" aria-label="The picture, as it is read" /></div>;
}

function EditStage({ source, geo, edit, setEdit, tool }: { source: Source; geo: HTMLCanvasElement; edit: Edit; setEdit: (e: Edit) => void; tool: 'crop' | 'perspective' }) {
  const view = tool === 'perspective' ? source.canvas : geo;
  const ref = useRef<HTMLCanvasElement>(null);
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

  const toImage = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * view.width, y: ((e.clientY - r.top) / r.height) * view.height };
  };
  const corners: [number, number][] = edit.perspective ?? [[0, 0], [source.canvas.width, 0], [source.canvas.width, source.canvas.height], [0, source.canvas.height]];
  const pct = (v: number, of: number) => `${(v / of) * 100}%`;
  const crop = live ?? edit.crop;

  return (
    <div className="istage editing">
      <div
        className="editbox"
        onPointerDown={(e) => {
          if (tool !== 'crop') return;
          (e.target as Element).setPointerCapture?.(e.pointerId);
          setDrag(toImage(e));
        }}
        onPointerMove={(e) => {
          if (tool === 'crop' && drag) {
            const p = toImage(e);
            setLive({ x: Math.min(drag.x, p.x), y: Math.min(drag.y, p.y), w: Math.abs(p.x - drag.x), h: Math.abs(p.y - drag.y) });
          }
          if (tool === 'perspective' && handle != null) {
            const p = toImage(e);
            const next = corners.map((c, i) => (i === handle ? [Math.max(0, Math.min(view.width, p.x)), Math.max(0, Math.min(view.height, p.y))] : c)) as [number, number][];
            setEdit({ ...edit, perspective: next });
          }
        }}
        onPointerUp={() => {
          if (tool === 'crop' && drag) {
            if (live && live.w > 6 && live.h > 6) setEdit({ ...edit, crop: live });
            setDrag(null);
            setLive(null);
          }
          setHandle(null);
        }}
      >
        <canvas ref={ref} aria-label={tool === 'crop' ? 'Drag over the text to crop the picture' : 'Drag the corners to flatten the picture'} />
        {tool === 'crop' && crop && (
          <div className="cropbox" style={{ left: pct(crop.x, view.width), top: pct(crop.y, view.height), width: pct(crop.w, view.width), height: pct(crop.h, view.height) }} />
        )}
        {tool === 'perspective' && (
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
    </div>
  );
}

// ------------------------------------------------------------- adjust

function AdjustCard({ edit, setEdit, tool, setTool, source, changed, autoInverted, onReset }: {
  edit: Edit; setEdit: (e: Edit) => void; tool: Tool; setTool: (t: Tool) => void; source: Source; changed: boolean; autoInverted: boolean; onReset: () => void;
}) {
  const corners: [number, number][] = [[0, 0], [source.canvas.width, 0], [source.canvas.width, source.canvas.height], [0, source.canvas.height]];
  return (
    <section className="section iadj" aria-label="Adjust the picture">
      <div className="sechead">
        <h2>Adjust</h2>
        <button className="btn sm" onClick={onReset} disabled={!changed && !tool}><Icon icon={ImgResetIcon} size={16} />Reset</button>
      </div>
      <div className="itools" role="group" aria-label="Tools">
        <button className="itool" aria-pressed={tool === 'crop'} onClick={() => setTool(tool === 'crop' ? null : 'crop')}><Icon icon={ImgCropIcon} size={18} />Crop</button>
        <button className="itool" aria-pressed={tool === 'perspective'} onClick={() => { if (tool === 'perspective') return setTool(null); setTool('perspective'); if (!edit.perspective) setEdit({ ...edit, perspective: corners, crop: null }); }}><Icon icon={PerspectiveIcon} size={18} />Perspective</button>
        <button className="itool" onClick={() => setEdit({ ...edit, turn: (((edit.turn + 1) % 4) as Edit['turn']), crop: null })}><Icon icon={RotateClockwiseIcon} size={18} />Turn 90°</button>
        <button className="itool" aria-pressed={edit.invert} onClick={() => setEdit({ ...edit, invert: !edit.invert })} title="For light text on a dark background"><Icon icon={ContrastIcon} size={18} />Invert</button>
      </div>
      {(tool || autoInverted) && (
        <div className="ehint">
          {tool === 'crop' && <p>{edit.crop ? 'Drag again to change the crop.' : 'Drag over the text you want. A tight crop gives better matches.'}</p>}
          {tool === 'perspective' && <p>Drag the four corners onto the corners of a slanted sign or page to flatten it.</p>}
          {!tool && autoInverted && <p>Invert is on because the picture looks like light text on a dark background.</p>}
          {tool === 'crop' && edit.crop && <button className="linkbtn" onClick={() => setEdit({ ...edit, crop: null })}>Clear crop</button>}
          {tool === 'perspective' && edit.perspective && <button className="linkbtn" onClick={() => { setEdit({ ...edit, perspective: null, crop: null }); setTool(null); }}>Clear perspective</button>}
        </div>
      )}
      <div className="isliders">
        <Slider icon={ImgStraightenIcon} label="Straighten" value={edit.rotate} min={-20} max={20} step={0.5} shown={`${edit.rotate}°`} onChange={(v) => setEdit({ ...edit, rotate: v, crop: null })} />
        <Slider icon={ImgSunIcon} label="Brightness" value={edit.brightness} min={-100} max={100} step={1} shown={`${100 + edit.brightness}%`} onChange={(v) => setEdit({ ...edit, brightness: v })} />
        <Slider icon={ContrastIcon} label="Contrast" value={edit.contrast} min={-100} max={100} step={1} shown={`${100 + edit.contrast}%`} onChange={(v) => setEdit({ ...edit, contrast: v })} />
      </div>
    </section>
  );
}

function Slider({ icon, label, value, min, max, step, shown, onChange }: { icon: unknown; label: string; value: number; min: number; max: number; step: number; shown: string; onChange: (v: number) => void }) {
  return (
    <label className="isl">
      <Icon icon={icon} size={16} />
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label={label} />
      <span className="val">{shown}</span>
    </label>
  );
}

// ------------------------------------------------------------- text found

function TextFound({ lines, chosen, onToggle, tiles, corrections, onCorrect, several, busy, onFind }: {
  lines: OcrLine[]; chosen: number[]; onToggle: (i: number) => void;
  tiles: { key: string; text: string; thumb: string; confidence: number }[]; corrections: Record<string, string>; onCorrect: (key: string, v: string) => void;
  several: boolean; busy: string | null; onFind: () => void;
}) {
  const [letters, setLetters] = useState(false);
  const unsure = tiles.filter((t) => t.confidence < 60).length;
  return (
    <section className="section iline">
      <div className="iht">
        <div className="sechead"><h2>Text found</h2><span className="icount">{plural(lines.length, 'line')}</span></div>
        <p>Pick the lines to match. Each one is matched on its own.</p>
      </div>
      <div className="ocrlines">
        {lines.map((l, i) => (
          <label key={i} className={`ocrline${chosen.includes(i) ? ' on' : ''}`} title={`Read with ${Math.round(l.confidence)}% confidence`}>
            <input type="checkbox" checked={chosen.includes(i)} onChange={() => onToggle(i)} />
            <span className="bx" aria-hidden="true"><Icon icon={Tick02Icon} size={13} stroke={2} /></span>
            <span className="lt" dir="auto">{l.text}</span>
            {l.confidence < 55 && <span className="lsure">Hard to read</span>}
          </label>
        ))}
      </div>
      {tiles.length > 0 && (
        <div className={`iletters${letters ? ' open' : ''}`}>
          <button className="ifold" aria-expanded={letters} onClick={() => setLetters(!letters)}>
            <span>
              <b>Check the letters</b>
              <small>{unsure ? `${plural(unsure, 'letter was', 'letters were')} hard to read. Fix any that are wrong.` : 'Fix any that were read wrongly.'}</small>
            </span>
            <Icon icon={ArrowDown01Icon} size={16} className="chev" />
          </button>
          {letters && (
            <>
              <div className="tiles">
                {tiles.map((t) => (
                  <label key={t.key} className={`tile${t.confidence < 60 ? ' unsure' : ''}`} title={`Read as "${t.text}" (${Math.round(t.confidence)}% sure)`}>
                    <img src={t.thumb} alt="" />
                    <input aria-label={`Letter read as ${t.text}`} maxLength={1} value={corrections[t.key] ?? t.text} onChange={(e) => onCorrect(t.key, e.target.value)} />
                  </label>
                ))}
              </div>
              <p className="sub">Letters with a dashed edge were hard to read. Only a to z, A to Z and 0 to 9 are compared.</p>
            </>
          )}
        </div>
      )}
      <button className="btn primary wide ifind" onClick={onFind} disabled={!!busy || !chosen.length}>
        {busy === 'matching' ? 'Comparing letters…' : 'Find the fonts'}
      </button>
      {!several && chosen.length > 1 && <p className="sub ifindnote">These lines look like one text style, so they are matched together.</p>}
    </section>
  );
}

// ------------------------------------------------------------- results (one text style)

function Results({ matches, usedLetters, text, lines, image, scan, tabId, toast, onOpenFontId }: { matches: ImageMatch[]; usedLetters: number; text: string; lines: OcrLine[]; image: HTMLCanvasElement; scan: PageScan | null; tabId: number | null; toast: (m: string) => void; onOpenFontId: (id: string) => void }) {
  const verdict = imageVerdict(matches.map((m) => m.score), usedLetters);
  const top = matches[0] ?? null;
  const close = matches.length > 2 && (matches[0]?.score ?? 0) - matches[2].score <= 3;
  const onPage = matches.some((m) => m.onPage);
  const topUsage = top?.onPage ? scan?.fonts.find((f) => (f.displayName || f.family) === top.family) ?? null : null;
  const topKnown = topUsage ? knownFont(topUsage.displayName || topUsage.family) : null;
  // The real crop of the chosen lines.
  const cut = useMemo(() => {
    if (!lines.length) return null;
    const box = { x0: Math.min(...lines.map((l) => l.bbox.x0)), y0: Math.min(...lines.map((l) => l.bbox.y0)), x1: Math.max(...lines.map((l) => l.bbox.x1)), y1: Math.max(...lines.map((l) => l.bbox.y1)) };
    return cutOut(image, box);
  }, [image, lines]);
  let say = '';
  if (verdict === 'exact' && top) say = `Likely ${top.family}: its letters match very closely.${top.onPage && topUsage ? ` It is a font this page uses${topKnown ? `, sold by ${topKnown.by}` : ''}.` : ''}`;
  else if (verdict === 'close') say = 'No free font is a clear match. It may be one of these, or a paid font that looks like them.';
  else say = `${usedLetters < 4 ? `Only ${plural(usedLetters, 'letter was', 'letters were')} compared. ` : 'No free font matches closely, so it is probably paid or made for this design. '}Crop tightly around one line, straighten it, and fix letters read wrongly.`;
  return (
    <div className="iresults">
      <section className="section ireshead">
        <div className="iht">
          <div className="sechead"><h2>Fonts in this picture</h2><span className="icount">1</span></div>
          <p>
            {say}
            {close && verdict !== 'unlikely' ? ' Several are almost the same: compare a, g, R and y.' : ''}
            {topKnown && <> <a className="linkbtn inl" href={topKnown.url} target="_blank" rel="noreferrer">{topKnown.licence === 'commercial' ? `Buy from ${topKnown.by}` : `Get it from ${topKnown.by}`}</a></>}
          </p>
        </div>
      </section>
      <LineCard matches={matches} verdict={verdict} text={text} cut={cut} image={image} scan={scan} tabId={tabId} toast={toast} onOpenFontId={onOpenFontId} />
      <p className="ifoot">
        Compared letter by letter on this computer with {INDEX_COUNT.toLocaleString()} free Google Fonts families{onPage ? ' and the fonts this page uses' : ''}. A paid font that is not on this page gets its closest free look-alikes, not its own name.
      </p>
    </div>
  );
}

/** Where "Try it live on the page" puts a match: the page's heading font, or its most used font. */
function liveTarget(scan: PageScan | null): PageFontUsage | null {
  const fonts = (scan?.fonts ?? []).filter((f) => f.kind !== 'generic');
  return [...fonts].sort((a, b) => (b.roles.heading ?? 0) - (a.roles.heading ?? 0) || b.elementCount - a.elementCount)[0] ?? null;
}

/** The text style's card: the picked match, the line compared with it, the other matches, then actions. */
function LineCard({ matches, verdict, text, cut, image, scan, tabId, toast, onOpenFontId }: {
  matches: ImageMatch[]; verdict: ReturnType<typeof imageVerdict>; text: string; cut: ReturnType<typeof cutOut> | null;
  image: HTMLCanvasElement; scan: PageScan | null; tabId: number | null; toast: (msg: string) => void; onOpenFontId: (id: string) => void;
}) {
  const [pick, setPick] = useState(0);
  const m = matches[pick] ?? matches[0];
  const usage = m.onPage ? scan?.fonts.find((f) => (f.displayName || f.family) === m.family) ?? null : null;
  const target = !m.onPage ? liveTarget(scan) : null;
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
  const sample = text.trim() || m.family;
  const missing = useMissing(css, sample, ready);
  const gf = googleFamily(m.family);
  const id = m.onPage && usage ? fontId(usage.family, usage.source) : `${m.family}::google`;
  const likely = pick === 0 && verdict === 'exact';
  const save = async () => {
    if (m.onPage && usage) await saveFont(recordFromUsage(usage, bestFileUrl(usage, usage.sample.fontWeight)), null, usage.sample);
    else await saveFont({ id, family: m.family, displayName: m.family, catalogFamily: m.family, source: 'google', kind: 'web', classification: gf?.c ?? 'unknown', licenseType: gf?.l ?? 'unknown', designers: [], files: [] }, null, null);
    // Keep the image it was found from with the font.
    const blob = await canvasBlob(image);
    const shot = await db.screenshots.add({ blob, pageUrl: 'Identified from an image', createdAt: Date.now() });
    const sp = await db.specimens.where('fontId').equals(id).first();
    if (sp?.id) await db.specimens.update(sp.id, { screenshotIds: [...sp.screenshotIds, shot] });
    else await db.specimens.add({ fontId: id, screenshotIds: [shot], pairing: null, notes: '', createdAt: Date.now() });
  };
  const why = m.onPage
    ? 'A font this page uses. Its letters match the picture.'
    : likely ? 'Exact match. The letters line up very closely.'
      : pick === 0 && verdict === 'unlikely' ? 'Nearest free font. The real one is probably paid or made for this design.'
        : pick === 0 ? 'Closest free font by its letters.' : 'Another close free font.';
  const coverage = !ready ? '' : missing.length ? ` Missing ${missing.length} of your letters (${missing.slice(0, 6).map((c) => `“${c}”`).join(' ')}).` : ' Has every letter of your text.';
  return (
    <section className="section ires match">
      <div className="nmrow">
        <b>{m.family}{m.bold ? ' Bold' : ''}</b>
        {m.onPage ? <span className="gtag">On this page{usage ? ` · ${licenseBadge(usage.licenseType).text}` : ''}</span> : <Lic name={m.family} />}
        <span className="pct" title={m.reason}><strong>{m.score}%</strong> match</span>
      </div>
      <p className="iwhy">{why}{coverage}</p>
      <Cmp cut={cut} label={likely || m.onPage ? 'Match' : 'Closest'} sample={sample} css={ready ? css : null} bold={m.bold} family={m.family} />
      {target && tabId != null && (
        <div className="ilive">
          <button className="linkbtn" onClick={tryLive} disabled={trying} title={`Shows ${m.family} on the page in place of ${target.displayName || target.family}`}>
            {trying ? 'Loading…' : live ? 'Showing on page · Undo' : 'Try it live on the page'}
          </button>
          <span>{live ? `In place of ${target.displayName || target.family}` : `Shows it in place of ${target.displayName || target.family}`}</span>
        </div>
      )}
      {matches.length > 1 && (
        <div className="chips" role="radiogroup" aria-label="Matches">
          <span className="olbl">Matches</span>
          {matches.slice(0, 6).map((x, j) => (
            <button key={x.family + j} role="radio" aria-checked={j === pick} className={`chip${j === pick ? ' on' : ''}`} onClick={() => setPick(j)}>{x.family}<em>{x.score}</em></button>
          ))}
        </div>
      )}
      <div className="racts">
        <SaveFontButton fontId={id} name={m.family} onSave={save} toast={toast} />
        {!m.onPage && <button className="btn sm" onClick={async () => onOpenFontId(await ensureRecord(m.family))}>Details</button>}
        <span className="grow" />
        {!m.onPage && <WhereToGet name={m.family} />}
      </div>
    </section>
  );
}

// ------------------------------------------------------------- read exactly from the page

/** Fonts of the real text inside the selected area, read exactly from the page. */
function ExactFonts({ exact, scan, tabId, onOpenFont, showEditor, onShowEditor }: { exact: Exact; scan: PageScan | null; tabId: number | null; onOpenFont: Props['onOpenFont']; showEditor: boolean; onShowEditor: () => void }) {
  return (
    <section className="section iexact">
      <div className="iht">
        <div className="sechead"><h2>Fonts in this area</h2><span className="icount">{exact.fonts.length}</span></div>
        <p>
          This area has real text, so its fonts are read exactly from the page. No guessing needed.
          {exact.pictures > 0 && ` It also has ${exact.pictures === 1 ? 'a picture' : `${exact.pictures} pictures`} (images or drawings), which are matched below.`}
        </p>
      </div>
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
                <div className="exacts">
                  <button className="btn sm" onClick={() => onOpenFont(usage, fontId(usage.family, usage.source))}>Details</button>
                  {tabId != null && <button className="btn sm" onClick={() => sendToTab(tabId, { type: 'ffp:highlight', key: f.key, label: f.name })}><Icon icon={Target02Icon} size={16} />Show on page</button>}
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

// ------------------------------------------------------------- recent

function History({ onOpen, toast }: { onOpen: (j: ImageJob) => void; toast: (m: string) => void }) {
  const jobs = useLiveQuery(() => db.imageJobs.orderBy('createdAt').reverse().limit(20).toArray(), []) ?? [];
  const urls = useMemo(() => jobs.map((j) => URL.createObjectURL(j.image)), [jobs]);
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls]);
  if (!jobs.length) return null;
  return (
    <section className="section irecent">
      <div className="sechead">
        <h2>Recent</h2>
        <span className="icount">{jobs.length}</span>
        <button className="linkbtn" onClick={async () => { await db.imageJobs.clear(); toast('Recent cleared'); }}>Clear all</button>
      </div>
      <div className="rlist">
        {jobs.map((j, i) => {
          const res = j.results ?? [];
          const top = res[0];
          const fonts = [...new Set(res.slice(0, 3).map((r) => `${r.family}${r.bold ? ' Bold' : ''}`))];
          const title = j.ocrText ? `“${j.ocrText}”` : KIND_NAME[j.source ?? 'upload'];
          return (
            <div key={j.id} className="histrow">
              <button className="histmain" onClick={() => onOpen(j)} aria-label={`Open ${top?.family ?? 'this picture'} again`}>
                <span className="rthumb"><img src={urls[i]} alt="" /></span>
                <span className="rt">
                  <b dir="auto">{title}</b>
                  <span>{when(j.createdAt)} · {fonts.length ? `${fonts.join(', ')}${top ? ` · ${top.score}%` : ''}` : 'No match'}</span>
                </span>
              </button>
              <button className="iconbtn sm rdel" title="Delete from Recent" aria-label="Delete from Recent" onClick={async () => { await db.imageJobs.delete(j.id!); toast('Deleted from Recent'); }}><Icon icon={Delete02Icon} size={17} /></button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
