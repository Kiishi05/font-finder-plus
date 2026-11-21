import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useRef, useState } from 'react';
import { knownFont } from '../../shared/licences';
import { CLASS_LABEL, SOURCE_LABEL, googleFamily, googleFontsUrl, licenseBadge, adobeFontsUrl } from '../../shared/catalog';
import { declarationCss, fontStackCss, round, tidyStack } from '../../shared/css';
import { db, saveFont, upsertFont } from '../../shared/db';
import { Alert02Icon, Share08Icon, ArrowLeft01Icon, ArrowUpRight01Icon, Bookmark02Icon, Copy01Icon, Delete02Icon, SourceCodeIcon, Target02Icon } from '../../shared/icons';
import { sendToTab } from '../../shared/messages';
import { bestFileUrl, recordFromUsage } from '../../shared/records';
import { FORMAT_LABEL } from '../../shared/sources';
import type { FontRecord, PageFontUsage, ParsedFontFile } from '../../shared/types';
import { Icon } from '../components/Icon';
import { MissingNote } from '../components/MissingNote';
import { DEFAULT_TESTER, Tester, sampleText, type TesterState } from '../components/Tester';
import { analyzeFont } from '../lib/analyze';
import { usePageScan } from '../lib/hooks';
import { usePreviewFamily, type PreviewSource } from '../lib/preview';
import { parseFamilyList } from '../lib/stack';
import { roleSummary } from './PageView';
import { coverageFromFiles, coverageFromGoogle, type Coverage } from '../lib/coverage';
import { parseFontBytes } from '../lib/fonts';
import type { InstalledFace } from '../lib/installed';
import { GlyphsCard, glyphCount } from './details/GlyphsCard';
import { InstalledCard } from './details/InstalledCard';
import { FilesCard, fileCount } from './details/FilesCard';
import { LanguagesCard } from './details/LanguagesCard';
import { LicenceCard } from './details/LicenceCard';
import { Screenshots } from './details/Screenshots';
import { PairsCard } from './details/PairsCard';
import { PlaygroundCard, type Axis } from './details/PlaygroundCard';
import { SimilarCard } from './details/SimilarCard';
import { SectionNav } from './details/SectionNav';
import { CopyButton } from './details/CopyButton';
import { shapeFor, type ShapeResult } from '../lib/shapes';
import { CollectionPicker } from '../components/CollectionPicker';

interface Props {
  fontId: string;
  usage?: PageFontUsage;
  tabId: number | null;
  pageHost: string | null;
  onBack: () => void;
  onShare: (fontId: string) => void;
  /** The page's address and scan version, to find the other fonts on the page (Pairs, Try on page). */
  pageUrl?: string;
  scanVersion?: number;
  toast: (m: string) => void;
}

/** The sections the floating bar at the bottom jumps between. */
const SECTIONS: [string, string][] = [
  ['sec-licence', 'Licence'],
  ['sec-similar', 'Similar'],
  ['sec-pairs', 'Pairs'],
  ['sec-page', 'Page'],
  ['sec-letters', 'Letters'],
  ['sec-files', 'Files'],
];

export function FontDetail({ fontId, usage, tabId, pageHost, onBack, onShare, pageUrl, scanVersion, toast }: Props) {
  const { scan: pageScan } = usePageScan(tabId, !!usage && !!pageUrl, pageUrl, scanVersion ?? 0);
  const record = useLiveQuery(() => db.fonts.get(fontId).then((r) => r ?? null), [fontId]);
  const saved = useLiveQuery(() => db.savedFonts.where('fontId').equals(fontId).first(), [fontId]);
  const [busy, setBusy] = useState<'reading' | null>(null);
  const attempted = useRef(false);

  // A font's details open at the top, never part way down.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [fontId]);

  const base: Omit<FontRecord, 'updatedAt'> | null = useMemo(() => {
    if (usage) return recordFromUsage(usage, bestFileUrl(usage, usage.sample.fontWeight));
    return record ?? null;
  }, [usage, record]);

  // Read the font file once to get facts from its own tables.
  useEffect(() => {
    if (!base || attempted.current || record === undefined) return;
    const fileUrl = base.fileUrl ?? record?.fileUrl;
    if (!fileUrl || (record?.parsed?.codepoints && record.parsed.shape !== undefined)) return;
    attempted.current = true;
    setBusy('reading');
    analyzeFont({ ...base, fileUrl }, tabId).finally(() => setBusy(null));
  }, [base, record, tabId]);

  const data = { ...(base ?? {}), ...(record ?? {}) } as Partial<FontRecord>;
  const family = data.family ?? fontId.split('::')[0];
  const parsed: ParsedFontFile | null = record?.parsed ?? null;
  // Sites often rename Google fonts ("GeistSans", "__Geist_Mono_9a8b7c"). The
  // stored match is confirmed from the name inside the font file.
  const gfName = data.catalogFamily !== undefined ? data.catalogFamily : (usage?.catalogFamily ?? null);
  const gf = gfName ? googleFamily(gfName) : data.catalogFamily === undefined ? googleFamily(family) : null;
  const name = gf?.family ?? data.displayName ?? family;
  const kind = usage?.kind ?? data.kind ?? (data.source === 'system' ? 'local' : 'web');
  const previewSrc: PreviewSource | null = useMemo(
    () => ({ family, kind, genericName: usage?.genericName ?? data.genericName, files: usage?.files ?? data.files ?? (data.fileUrl ? [{ url: data.fileUrl, format: null, weight: '400', style: 'normal', unicodeRange: null }] : []) }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [family, kind, usage, data.fileUrl, (data.files ?? []).length],
  );
  const preview = usePreviewFamily(previewSrc, tabId);
  const sample = usage?.sample ?? saved?.sample ?? null;

  const gfW = gf?.a.find((a) => a[0] === 'wght');
  const wghtAxis = parsed?.axes.find((a) => a.tag === 'wght') ?? (gfW ? { tag: 'wght', name: 'Weight', min: gfW[1], max: gfW[2], default: gfW[3] } : undefined);
  const weights = useMemo(() => {
    if (wghtAxis) return [...new Set([wghtAxis.min, 300, 400, 600, 800, wghtAxis.max].filter((w) => w >= wghtAxis.min && w <= wghtAxis.max).map(String))].sort((a, b) => +a - +b);
    const fromPage = usage?.weights ?? [];
    return fromPage.length ? fromPage : [sample?.fontWeight ?? '400'];
  }, [wghtAxis, usage, sample]);
  const [weight, setWeight] = useState<string>(sample?.fontWeight ?? '400');
  const [italic, setItalic] = useState(false);
  const [tester, setTester] = useState<TesterState>({ ...DEFAULT_TESTER, mode: 'language', lang: 'en', size: 36 });

  const declared = parseFamilyList(usage?.declaredStacks[0] ?? data.declaredStack ?? `"${family}"`);
  const badge = licenseBadge(data.licenseType ?? 'unknown');
  const classification = data.classification ?? 'unknown';
  const isVariable = !!parsed?.axes.length || !!gf?.a.length;
  const cssText = () => (sample ? declarationCss(declared, sample, family) : `font-family: ${fontStackCss(tidyStack(declared, family))};`);

  const doSave = async () => {
    if (saved?.id != null) {
      await db.savedFonts.delete(saved.id);
      toast(`Removed ${name} from your library`);
      return;
    }
    if (!base) return;
    await saveFont(base, pageHost, sample);
    toast(`Saved ${name}`);
  };

  // Outline this font's elements on the page (a toggle, cleared when leaving).
  const [outlined, setOutlined] = useState(false);
  const outlinedRef = useRef(false);
  outlinedRef.current = outlined;
  const outline = async () => {
    if (!usage || tabId == null) return;
    if (outlined) {
      setOutlined(false);
      await sendToTab(tabId, { type: 'ffp:highlight', key: null });
      return;
    }
    const r = await sendToTab<{ shown: number; hidden: number; cleared?: boolean }>(tabId, { type: 'ffp:highlight', key: usage.key, label: name });
    if (!r) return toast('Could not reach the page. Reload it and try again.');
    setOutlined(true);
    toast(r.shown ? `Outlined ${r.shown} ${r.shown === 1 ? 'element' : 'elements'}${r.hidden ? ` (${r.hidden} hidden)` : ''}` : 'Its elements are hidden right now');
  };
  useEffect(() => () => {
    if (outlinedRef.current && tabId != null) void sendToTab(tabId, { type: 'ffp:highlight', key: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Characters: from the files this site loads, from Google Fonts (whole
  // family), or from the copy installed on this computer.
  const files = previewSrc?.files ?? [];
  const filesKey = files.map((f) => f.url).join('|');
  const [fileCov, setFileCov] = useState<Coverage | null>(null);
  const [gfCov, setGfCov] = useState<Coverage | null>(null);
  const [localCov, setLocalCov] = useState<Coverage | null>(null);
  const [covLoading, setCovLoading] = useState(false);
  useEffect(() => {
    let off = false;
    setFileCov(null);
    if (kind !== 'web' || !files.length) return;
    setCovLoading(true);
    coverageFromFiles(files, tabId, sample?.fontWeight, sample?.fontStyle)
      .then((c) => !off && setFileCov(c))
      .catch(() => undefined)
      .finally(() => !off && setCovLoading(false));
    return () => { off = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filesKey, kind, tabId]);
  useEffect(() => {
    let off = false;
    setGfCov(null);
    if (!gf) return;
    coverageFromGoogle(gf.family).then((c) => !off && setGfCov(c)).catch(() => undefined);
    return () => { off = true; };
  }, [gf?.family]);
  const onInstalled = async (faces: InstalledFace[]) => {
    const face = faces.find((f) => /^(regular|book|roman|normal)$/i.test(f.style)) ?? faces[0];
    if (!face) return;
    try {
      const parsedLocal = await parseFontBytes(await (await face.blob()).arrayBuffer());
      setLocalCov({ codepoints: new Set(parsedLocal.codepoints ?? []), from: 'installed', fileCount: 1 });
    } catch {
      toast('The installed font file could not be read');
    }
  };
  const langCoverage = gfCov ?? localCov ?? fileCov;

  // Shape, for similar fonts and pairs.
  const [shape, setShape] = useState<ShapeResult | null>(null);
  const [shapeLoading, setShapeLoading] = useState(true);
  useEffect(() => {
    let off = false;
    setShapeLoading(true);
    shapeFor({ catalogFamily: gf?.family ?? null, files, kind, family }, tabId)
      .then((r) => !off && setShape(r))
      .catch(() => !off && setShape(null))
      .finally(() => !off && setShapeLoading(false));
    return () => { off = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gf?.family, filesKey, kind, family, tabId]);
  const axes: Axis[] = parsed?.axes.length
    ? parsed.axes
    : (gf?.a ?? []).map(([tag, min, max, def]) => ({ tag, name: tag, min, max, default: def }));
  const glyphSet = fileCov?.codepoints ?? localCov?.codepoints ?? null;
  const glyphCss = kind === 'web' ? preview.css : `"${parsed?.familyName ?? family}", "FFP NotDef"`;
  const letters = glyphCount(glyphSet);
  const nFiles = kind === 'web' ? fileCount(files) : 0;

  const designerText = gf?.d.length ? gf.d.join(', ') : parsed?.designer ?? null;
  const foundryText = parsed?.manufacturer ?? null;
  const from = data.source === 'image' ? 'Image' : usage ? 'Page' : 'Library';
  const meta = [CLASS_LABEL[classification], isVariable ? 'Variable' : null, data.source ? SOURCE_LABEL[data.source] : 'Unknown source', foundryText].filter(Boolean).join(' · ');
  const known = knownFont(name);
  const em = (v: number | null | undefined) => (v && parsed?.unitsPerEm ? `${round(v / parsed.unitsPerEm, 2)} em` : null);
  const text = sampleText(tester, name);

  return (
    <div className="dview">
      <div className="subtop">
        <button className="backbtn tip" data-tip={`Back to ${from}`} aria-label="Back" onClick={onBack}><Icon icon={ArrowLeft01Icon} size={18} /></button>
        <span className="crumb"><span>{from} /</span><b>{name}</b></span>
        <button className={`btn sm dsave${saved ? ' on' : ' primary'}`} aria-pressed={!!saved} aria-label={saved ? 'Saved, click to remove from your library' : 'Save to your library'} onClick={doSave}>
          <Icon icon={Bookmark02Icon} size={15} filled={!!saved} />
          {saved ? 'Saved' : 'Save'}
        </button>
      </div>

      <section className="section dhead">
        <div className="meta">
          <span className={`lic ${badge.tone}${badge.tone === 'neutral' ? ' unknown' : ''}`}><i />{badge.text}</span>
          <span className="grow">{meta}</span>
        </div>
        <h1 className="nm" style={{ fontFamily: preview.css, fontWeight: Number(usage?.sample.fontWeight) || undefined }}>{name}</h1>
        {designerText && <p className="by">by {designerText}</p>}
        <div className="row3">
          <CopyButton className="btn sm" icon={Copy01Icon} label="Name" ariaLabel="Copy name" text={name} onFail={() => toast('Could not copy')} />
          <CopyButton className="btn sm" icon={SourceCodeIcon} label="CSS" ariaLabel="Copy CSS" text={cssText} onFail={() => toast('Could not copy')} />
          <button
            className="btn sm"
            onClick={async () => {
              // A share card needs the font's record; make sure it exists.
              if (!record && base) await upsertFont(base);
              onShare(fontId);
            }}
          >
            <Icon icon={Share08Icon} size={15} /> Share
          </button>
        </div>
        {gf ? (
          <a className="btn wide primary dfull" href={googleFontsUrl(gf.family)} target="_blank" rel="noreferrer">
            Open on Google Fonts <Icon icon={ArrowUpRight01Icon} size={15} />
          </a>
        ) : known ? (
          <a className={`btn wide dfull${known.licence === 'commercial' ? '' : ' primary'}`} href={known.url} target="_blank" rel="noreferrer">
            {known.licence === 'commercial' ? `Buy from ${known.by}` : `Get it from ${known.by}`} <Icon icon={ArrowUpRight01Icon} size={15} />
          </a>
        ) : (
          <p className="dnote">
            {data.source === 'image' ? 'Not in the catalogues we know. Search for it by name to find who makes it.' : parsed || kind !== 'web' ? 'Not in the Google Fonts catalogue.' : 'Not matched to Google Fonts yet. The font file is being checked.'}
          </p>
        )}
        {data.source === 'adobe' && !gf && (
          <a className="btn wide dfull" href={adobeFontsUrl(name)} target="_blank" rel="noreferrer">
            Find it on Adobe Fonts <Icon icon={ArrowUpRight01Icon} size={15} />
          </a>
        )}
        {data.source === 'adobe' && !gf && <p className="dnote">This site loads it from Adobe Fonts. To use it, add it to a web project with your own Adobe plan (most Creative Cloud plans include Adobe Fonts), or license it from the foundry.</p>}
        {data.source === 'image' && !gf && <p className="dnote">This font was named in an image. Font Finder Plus does not have its file, so previews below use a stand-in and its letters and languages cannot be checked.</p>}
      </section>

      <SectionNav items={SECTIONS} />

      {data.fileError && !parsed && (
        <div className="notice amber"><Icon icon={Alert02Icon} size={15} />{data.fileError}</div>
      )}
      {busy === 'reading' && <div className="notice neutral">Reading the font file…</div>}

      <Tester value={tester} onChange={setTester} min={14} max={120} extra={null} />

      <section className={`section dspec${tester.invert ? ' invert' : ''}`}>
        <div className="weights" role="group" aria-label="Weight and style">
          {weights.map((w) => (
            <button key={w} aria-pressed={weight === w && !italic} onClick={() => { setWeight(w); setItalic(false); }}>{w}</button>
          ))}
          <span className="wsep" aria-hidden="true" />
          <button style={{ fontStyle: 'italic' }} aria-pressed={italic} onClick={() => setItalic(!italic)}>Italic</button>
        </div>
        <p
          dir="auto"
          className={`specimen wrap${tester.align === 'center' ? ' center' : ''}`}
          style={{ fontFamily: preview.css, fontSize: tester.size, fontWeight: Number(weight) || 400, fontStyle: italic ? 'italic' : 'normal' }}
        >
          {text}
        </p>
        {kind !== 'generic' && <MissingNote css={preview.css} text={text} ready={preview.ready && !preview.failed} tester={tester} name={name} style={{ margin: 0 }} />}
        {preview.failed && <p className="dnote">The font file could not be loaded in the panel, so a fallback font is shown.</p>}
      </section>

      <PlaygroundCard id="sec-variable" axes={axes} fromFile={!!parsed?.axes.length} fontCss={preview.css} googleFamily={gf?.family ?? null} pageKey={usage?.key ?? null} tabId={tabId} text={text} toast={toast} />

      <LicenceCard id="sec-licence" name={name} licenseType={data.licenseType ?? 'unknown'} source={data.source ?? 'unknown'} parsed={parsed} fromCatalogue={!!gf?.l} />

      <SimilarCard
        id="sec-similar"
        shape={shape}
        loading={shapeLoading}
        exclude={gf?.family ?? name}
        classification={classification}
        pageKey={usage?.key ?? null}
        tabId={tabId}
        input={kind === 'generic' ? null : { fontId, family, catalogFamily: gf?.family ?? null, files, kind, classification, weight: usage?.sample.fontWeight ?? '400', style: usage?.sample.fontStyle ?? 'normal', onPage: !!usage }}
        sampleText={sampleText(tester, '')}
        toast={toast}
      />

      <PairsCard id="sec-pairs" shape={shape} loading={shapeLoading} classification={classification} name={name} fontCss={preview.css} exclude={gf?.family ?? name} pageKey={usage?.key ?? null} pageFonts={pageScan?.fonts ?? null} tabId={tabId} toast={toast} />

      <section className="section" id="sec-page">
        <div className="sechead"><h2>On this page</h2>{usage && <span className="count">{usage.elementCount} {usage.elementCount === 1 ? 'element' : 'elements'}</span>}</div>
        {!usage && <p className="sub">Open this font from the Page tab on a site to see where and how it is used.</p>}
        {usage && (
          <dl className="specs">
            <div><dt>{usage.weights.length === 1 ? 'Weight' : 'Weights'}</dt><dd>{usage.weights.join(', ')}</dd></div>
            <div><dt>{usage.sizes.length === 1 ? 'Size' : 'Sizes'}</dt><dd>{usage.sizes.slice(0, 12).map((v) => `${round(v, 1)}px`).join(', ')}{usage.sizes.length > 12 ? ` and ${usage.sizes.length - 12} more` : ''}</dd></div>
            <div><dt>Line height</dt><dd>{usage.sample.lineHeight}</dd></div>
            <div><dt>Letter spacing</dt><dd>{usage.sample.letterSpacing === 'normal' ? '0' : usage.sample.letterSpacing}</dd></div>
          </dl>
        )}
        <dl className="dkv">
          {usage && (<><dt>Used for</dt><dd>{roleSummary(usage, 7) || 'Not sure'}</dd></>)}
          <dt>Rendered as</dt>
          <dd>{kind === 'web' ? `${name}, web font` : kind === 'local' ? `${name}, installed on this computer` : `${name}`}</dd>
          {name !== family && (<><dt>CSS name</dt><dd className="mono">{family}</dd></>)}
          <dt>CSS stack</dt>
          <dd className="mono">{declared.join(', ')}</dd>
          {usage?.fellBackFrom.length ? (<><dt>Did not load</dt><dd>{usage.fellBackFrom.join(', ')}</dd></>) : null}
        </dl>
        <div className="dfoot">
          {usage && tabId != null && (
            <button className={`btn sm${outlined ? ' primary' : ''}`} aria-pressed={outlined} onClick={outline}>
              <Icon icon={Target02Icon} size={15} />{outlined ? 'Showing on page' : 'Show on page'}
            </button>
          )}
          <CopyButton className="btn sm" icon={SourceCodeIcon} label="Copy CSS" text={cssText} onFail={() => toast('Could not copy')} />
        </div>
      </section>

      <section className="section" id="sec-letters">
        <div className="sechead"><h2>Letters and languages</h2>{letters > 0 && <span className="count">{letters} letters</span>}</div>
        <GlyphsCard
          codepoints={glyphSet}
          fontCss={glyphCss}
          toast={toast}
          note={glyphSet ? (fileCov ? 'From the font files this site loads. Boxes mean the character is missing.' : 'From the copy installed on this computer.') : kind === 'web' ? 'The font file could not be read, so its characters cannot be shown.' : 'Use "Show installed styles" below to see the characters of the installed copy.'}
        />
        <LanguagesCard
          coverage={langCoverage}
          loading={covLoading || (!!gf && !gfCov)}
          fontCss={kind === 'web' ? preview.css : glyphCss}
          empty={kind === 'web' ? 'The font file could not be read, so its characters are unknown.' : 'Use "Show installed styles" below to read the installed copy and check its languages.'}
        />
      </section>

      <section className="section" id="sec-files">
        <div className="sechead"><h2>Files</h2><span className="count">{kind === 'web' ? `${nFiles} ${nFiles === 1 ? 'file' : 'files'}` : kind === 'local' ? 'Installed font' : 'No file'}</span></div>
        {kind === 'web' && <FilesCard files={files} toast={toast} />}
        {kind === 'web' && !nFiles && <p className="sub">No font file address is known for this font.</p>}
        <dl className="dkv">
          <dt>Served from</dt>
          <dd>{data.source ? SOURCE_LABEL[data.source] : 'Unknown'}{data.sourceHost ? <span className="faint"> {data.sourceHost}</span> : null}</dd>
          <dt>Format</dt>
          <dd>{parsed ? FORMAT_LABEL[parsed.format] ?? parsed.format : data.format ? FORMAT_LABEL[data.format] ?? data.format : kind === 'web' ? 'Unknown' : 'Installed font'}{parsed?.axes.length ? ', variable' : ''}</dd>
          <dt>Google Fonts</dt>
          <dd>{gf ? (<a href={googleFontsUrl(gf.family)} target="_blank" rel="noreferrer">Available as {gf.family}</a>) : 'Not in the catalogue'}</dd>
          <dt>Foundry</dt>
          <dd>{foundryText ? `${foundryText}${parsed?.manufacturer ? ' (from the file)' : ''}` : 'Unknown'}</dd>
          <dt>Designer</dt>
          <dd>{designerText ?? 'Unknown'}</dd>
          {parsed?.familyName && parsed.familyName !== name && (<><dt>Name in file</dt><dd>{parsed.familyName}</dd></>)}
          {parsed?.version && (<><dt>Version</dt><dd>{parsed.version}</dd></>)}
          {parsed && (<><dt>File</dt><dd>{round(parsed.byteLength / 1024, 1)} KB, {parsed.glyphCount} glyphs, {parsed.characterCount} characters</dd></>)}
          {em(parsed?.xHeight) && (<><dt>x-height</dt><dd>{em(parsed?.xHeight)}</dd></>)}
          {em(parsed?.capHeight) && (<><dt>Cap height</dt><dd>{em(parsed?.capHeight)}</dd></>)}
          {parsed && (<><dt>Units per em</dt><dd>{parsed.unitsPerEm}</dd></>)}
        </dl>
        <details className="dfold">
          <summary>Cap height and x-height diagram</summary>
          <MetricsCard fontCss={preview.css} weight={weight} parsed={parsed} />
        </details>
      </section>

      <InstalledCard family={parsed?.familyName ?? name} onFaces={onInstalled} />

      {saved && (
        <section className="section">
          <div className="sechead"><h2>In your library</h2></div>
          <CollectionPicker savedId={saved.id!} />
          <label className="dlabel" htmlFor="notes">Notes</label>
          <NotesField id={saved.id!} initial={saved.notes} />
          {saved.sitesSeen.length > 0 && <p className="dnote">Seen on {saved.sitesSeen.join(', ')}</p>}
          <Screenshots fontId={fontId} tabId={tabId} onPage={!!usage} toast={toast} />
          <button className="linkbtn danger" style={{ alignSelf: 'flex-start' }} onClick={async () => { await db.savedFonts.delete(saved.id!); toast('Removed from library'); }}>
            <Icon icon={Delete02Icon} size={15} /> Remove from library
          </button>
        </section>
      )}

      <div className="dend" aria-hidden="true" />
    </div>
  );
}

function NotesField({ id, initial }: { id: number; initial: string }) {
  const [value, setValue] = useState(initial);
  const timer = useRef<number>();
  return (
    <textarea
      id="notes"
      className="field"
      rows={3}
      placeholder="Where you might use it, what it pairs with…"
      value={value}
      onChange={(e) => {
        setValue(e.target.value);
        window.clearTimeout(timer.current);
        const v = e.target.value;
        timer.current = window.setTimeout(() => db.savedFonts.update(id, { notes: v, updatedAt: Date.now() }), 400);
      }}
    />
  );
}

function MetricsCard({ fontCss, weight, parsed }: { fontCss: string; weight: string; parsed: ParsedFontFile | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let raf = 0;
    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = 119;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      const c = canvas.getContext('2d')!;
      c.scale(dpr, dpr);
      const styles = getComputedStyle(document.documentElement);
      const ink = styles.getPropertyValue('--ink').trim();
      const field = styles.getPropertyValue('--inset').trim();
      const muted = styles.getPropertyValue('--faint').trim();
      const xline = styles.getPropertyValue('--muted').trim();
      c.fillStyle = field;
      c.beginPath();
      c.roundRect(0, 0, w, h, 12);
      c.fill();
      c.font = `${weight} 96px ${fontCss}`;
      const base = 94;
      const capA = c.measureText('H').actualBoundingBoxAscent;
      const xA = c.measureText('x').actualBoundingBoxAscent;
      const line = (y: number, color: string, dash: boolean) => {
        c.save();
        c.strokeStyle = color;
        if (dash) c.setLineDash([4, 3]);
        c.beginPath();
        c.moveTo(0, Math.round(y) + 0.5);
        c.lineTo(w, Math.round(y) + 0.5);
        c.stroke();
        c.restore();
      };
      line(base - capA, muted, true);
      line(base - xA, xline, true);
      line(base, ink, false);
      c.fillStyle = ink;
      c.fillText('Hxg', 14, base);
      c.font = `11px 'FFP Geist', system-ui, sans-serif`;
      c.textAlign = 'right';
      // Values from the font file (units and share of the em), or measured from how it draws.
      const em = (v: number) => `${Math.round(v * 100) / 100} em`;
      const capLabel = parsed?.capHeight ? `Cap height ${parsed.capHeight} · ${em(parsed.capHeight / parsed.unitsPerEm)}` : `Cap height ${em(capA / 96)}`;
      const xLabel = parsed?.xHeight ? `x-height ${parsed.xHeight} · ${em(parsed.xHeight / parsed.unitsPerEm)}` : `x-height ${em(xA / 96)}`;
      c.fillStyle = muted;
      c.fillText(capLabel, w - 10, base - capA - 5);
      c.fillStyle = xline;
      c.fillText(xLabel, w - 10, base - xA - 5);
      c.fillStyle = ink;
      c.fillText('Baseline', w - 10, base - 5);
    };
    document.fonts.ready.then(() => (raf = requestAnimationFrame(draw)));
    raf = requestAnimationFrame(draw);
    // It sits in a fold: draw again once it has a width.
    const ro = new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(draw); });
    ro.observe(canvas);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [fontCss, weight, parsed]);

  return (
    <div className="dmetrics">
      <p className="dnote">{parsed ? 'From the font file.' : 'Measured from how the font draws.'}</p>
      <canvas ref={ref} className="metrics-canvas" aria-label="Cap height, x-height and baseline diagram" />
      {parsed && (
        <div className="grid2" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 6 }}>
          <Metric k="Units per em" v={String(parsed.unitsPerEm)} />
          <Metric k="x-height to cap" v={parsed.capHeight && parsed.xHeight ? String(round(parsed.xHeight / parsed.capHeight, 2)) : 'n/a'} />
          <Metric k="Glyphs" v={String(parsed.glyphCount)} />
        </div>
      )}
    </div>
  );
}

function Metric({ k, v }: { k: string; v: string }) {
  return (
    <div className="dmetric">
      <span className="dnote">{k}</span>
      <span>{v}</span>
    </div>
  );
}
