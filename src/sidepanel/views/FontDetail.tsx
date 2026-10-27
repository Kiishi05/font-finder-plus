import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CLASS_LABEL, SOURCE_LABEL, googleFamily, googleFontsUrl, licenseBadge } from '../../shared/catalog';
import { declarationCss, fontStackCss, round, tidyStack } from '../../shared/css';
import { db, saveFont, upsertFont } from '../../shared/db';
import { Alert02Icon, Share08Icon, ArrowLeft01Icon, ArrowUpRight01Icon, Bookmark02Icon, Copy01Icon, Delete02Icon, SourceCodeIcon } from '../../shared/icons';
import { bestFileUrl, recordFromUsage } from '../../shared/records';
import { FORMAT_LABEL } from '../../shared/sources';
import type { FontRecord, PageFontUsage, ParsedFontFile } from '../../shared/types';
import { Icon } from '../components/Icon';
import { MissingNote } from '../components/MissingNote';
import { DEFAULT_TESTER, Tester, sampleText, type TesterState } from '../components/Tester';
import { analyzeFont } from '../lib/analyze';
import { copyToClipboard } from '../lib/hooks';
import { usePreviewFamily, type PreviewSource } from '../lib/preview';
import { parseFamilyList } from '../lib/stack';
import { roleSummary } from './PageView';
import { coverageFromFiles, coverageFromGoogle, type Coverage } from '../lib/coverage';
import { parseFontBytes } from '../lib/fonts';
import type { InstalledFace } from '../lib/installed';
import { GlyphsCard } from './details/GlyphsCard';
import { InstalledCard } from './details/InstalledCard';
import { LanguagesCard } from './details/LanguagesCard';
import { LicenceCard } from './details/LicenceCard';
import { Screenshots } from './details/Screenshots';
import { PairsCard } from './details/PairsCard';
import { PlaygroundCard, type Axis } from './details/PlaygroundCard';
import { SimilarCard } from './details/SimilarCard';
import { shapeFor, type ShapeResult } from '../lib/shapes';
import { CollectionPicker } from '../components/CollectionPicker';

interface Props {
  fontId: string;
  usage?: PageFontUsage;
  tabId: number | null;
  pageHost: string | null;
  onBack: () => void;
  onShare: (fontId: string) => void;
  toast: (m: string) => void;
}

export function FontDetail({ fontId, usage, tabId, pageHost, onBack, onShare, toast }: Props) {
  const record = useLiveQuery(() => db.fonts.get(fontId).then((r) => r ?? null), [fontId]);
  const saved = useLiveQuery(() => db.savedFonts.where('fontId').equals(fontId).first(), [fontId]);
  const [busy, setBusy] = useState<'reading' | null>(null);
  const attempted = useRef(false);

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

  const designerText = gf?.d.length ? gf.d.join(', ') : parsed?.designer ?? null;
  const foundryText = parsed?.manufacturer ?? null;

  return (
    <>
      <div className="topbar">
        <button className="iconbtn" aria-label="Back" onClick={onBack}><Icon icon={ArrowLeft01Icon} /></button>
        <span className="label grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>[{usage ? 'Page' : 'Library'}] / [{name}]</span>
        <button className={`btn${saved ? ' done' : ' primary'}`} style={{ height: 38, borderRadius: 12 }} onClick={doSave}>
          <Icon icon={Bookmark02Icon} size={15} filled={!!saved} />
          {saved ? 'Saved' : 'Save'}
        </button>
      </div>

      <section className="section" style={{ gap: 12, padding: 16 }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="label">
            [{CLASS_LABEL[classification]}
            {isVariable ? ' · Variable' : ''} · {data.source ? SOURCE_LABEL[data.source] : 'Unknown source'}]
          </span>
          <span className={`lic ${badge.tone}`}><i />{badge.text}</span>
        </div>
        <h1 className="hero-name" style={{ fontFamily: preview.css, fontWeight: Number(weight) || 400 }}>{name}</h1>
        {designerText && <span className="mono muted" style={{ fontSize: 10.5 }}>by {designerText}</span>}
        <div className="row" style={{ gap: 6 }}>
          <button className="btn" style={{ flex: 1 }} onClick={async () => (await copyToClipboard(name)) && toast('Copied font name')}>
            <Icon icon={Copy01Icon} size={15} /> Copy name
          </button>
          <button
            className="btn"
            style={{ flex: 1 }}
            onClick={async () => {
              const css = sample ? declarationCss(declared, sample, family) : `font-family: ${fontStackCss(tidyStack(declared, family))};`;
              if (await copyToClipboard(css)) toast('Copied CSS');
            }}
          >
            <Icon icon={SourceCodeIcon} size={15} /> Copy CSS
          </button>
          <button
            className="btn"
            style={{ flex: 1 }}
            onClick={async () => {
              // A share card needs the font's record; make sure it exists.
              if (!record && base) await upsertFont(base);
              onShare(fontId);
            }}
          >
            <Icon icon={Share08Icon} size={15} /> Share card
          </button>
        </div>
        {gf ? (
          <a className="btn primary" href={googleFontsUrl(gf.family)} target="_blank" rel="noreferrer">
            Open on Google Fonts <Icon icon={ArrowUpRight01Icon} size={15} />
          </a>
        ) : (
          <span className="muted" style={{ fontSize: 11.5 }}>
            {parsed || kind !== 'web' ? 'Not in the Google Fonts catalogue.' : 'Not matched to Google Fonts yet. The font file is being checked.'}
          </span>
        )}
      </section>

      <nav className="jump" aria-label="Jump to">
        {[['sec-licence', 'Licence'], ['sec-similar', 'Similar'], ['sec-pairs', 'Pairs'], ...(axes.length ? [['sec-variable', 'Variable']] : []), ['sec-languages', 'Languages'], ['sec-glyphs', 'Glyphs']].map(([id, label]) => (
          <button key={id} onClick={() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>{label}</button>
        ))}
      </nav>

      <Tester
        value={tester}
        onChange={setTester}
        min={14}
        max={120}
        extra={null}
      />
      <section className="section" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="toggles" style={{ padding: '4px 14px', borderBottom: '1px solid var(--line)' }}>
          {weights.map((w) => (
            <button key={w} className="t" aria-pressed={weight === w && !italic} onClick={() => { setWeight(w); setItalic(false); }}>
              {w}
            </button>
          ))}
          <button className="t" style={{ fontStyle: 'italic' }} aria-pressed={italic} onClick={() => setItalic(!italic)}>Italic</button>
        </div>
        <p
          dir="auto" className={`specimen wrap${tester.align === 'center' ? ' center' : ''}${tester.invert ? ' invert' : ''}`}
          style={{ margin: 0, padding: '14px', fontFamily: preview.css, fontSize: tester.size, fontWeight: Number(weight) || 400, fontStyle: italic ? 'italic' : 'normal', lineHeight: 1.15 }}
        >
          {sampleText(tester, name)}
        </p>
        {kind !== 'generic' && <MissingNote css={preview.css} text={sampleText(tester, name)} ready={preview.ready && !preview.failed} tester={tester} name={name} />}
        {preview.failed && <p className="muted" style={{ margin: 0, padding: '0 14px 12px', fontSize: 11.5 }}>The font file could not be loaded in the panel, so a fallback font is shown.</p>}
      </section>

      <div id="sec-licence" className="stack" style={{ gap: 0 }}><LicenceCard name={name} licenseType={data.licenseType ?? 'unknown'} source={data.source ?? 'unknown'} parsed={parsed} fromCatalogue={!!gf?.l} /></div>

      <div id="sec-similar" className="stack" style={{ gap: 0 }}><SimilarCard
        shape={shape}
        loading={shapeLoading}
        exclude={gf?.family ?? name}
        classification={classification}
        pageKey={usage?.key ?? null}
        tabId={tabId}
        sampleText={sampleText(tester, '')}
        toast={toast}
      /></div>

      <div id="sec-pairs" className="stack" style={{ gap: 0 }}><PairsCard shape={shape} classification={classification} name={name} fontCss={preview.css} exclude={gf?.family ?? name} toast={toast} /></div>

      <div id="sec-variable" className="stack" style={{ gap: 0 }}><PlaygroundCard axes={axes} fromFile={!!parsed?.axes.length} fontCss={preview.css} googleFamily={gf?.family ?? null} pageKey={usage?.key ?? null} tabId={tabId} text={sampleText(tester, name)} toast={toast} /></div>

      <div id="sec-languages" className="stack" style={{ gap: 0 }}><LanguagesCard
        coverage={langCoverage}
        loading={covLoading || (!!gf && !gfCov)}
        fontCss={kind === 'web' ? preview.css : glyphCss}
        empty={kind === 'web' ? 'The font file could not be read, so its characters are unknown.' : 'Use "Show installed styles" below to read the installed copy and check its languages.'}
      /></div>

      <MetricsCard fontCss={preview.css} weight={weight} parsed={parsed} />

      {data.fileError && !parsed && (
        <div className="notice amber"><Icon icon={Alert02Icon} size={15} />{data.fileError}</div>
      )}
      {busy === 'reading' && <div className="notice neutral">Reading the font file…</div>}

      <section className="section">
        <h2>[Details]</h2>
        <dl className="kv">
          <dt>Rendered as</dt>
          <dd>{kind === 'web' ? `${name}, web font` : kind === 'local' ? `${name}, installed on this computer` : `${name}`}</dd>
          {name !== family && (<><dt>CSS name</dt><dd className="mono" style={{ fontSize: 11 }}>{family}</dd></>)}
          {parsed?.familyName && parsed.familyName !== name && (<><dt>Name in file</dt><dd>{parsed.familyName}</dd></>)}
          <dt>CSS stack</dt>
          <dd className="mono" style={{ fontSize: 11 }}>{declared.join(', ')}</dd>
          {usage?.fellBackFrom.length ? (<><dt>Did not load</dt><dd>{usage.fellBackFrom.join(', ')}</dd></>) : null}
          <dt>Google Fonts</dt>
          <dd>{gf ? (<a href={googleFontsUrl(gf.family)} target="_blank" rel="noreferrer">Available as {gf.family}</a>) : 'Not in the catalogue'}</dd>
          <dt>Served from</dt>
          <dd>{data.source ? SOURCE_LABEL[data.source] : 'Unknown'}{data.sourceHost ? <span className="mono muted" style={{ fontSize: 11 }}> {data.sourceHost}</span> : null}</dd>
          <dt>Format</dt>
          <dd>{parsed ? FORMAT_LABEL[parsed.format] ?? parsed.format : data.format ? FORMAT_LABEL[data.format] ?? data.format : kind === 'web' ? 'Unknown' : 'Installed font'}{parsed?.axes.length ? ' · variable' : ''}</dd>
          <dt>Foundry</dt>
          <dd>{foundryText ?? 'Unknown'}</dd>
          <dt>Designer</dt>
          <dd>{designerText ?? 'Unknown'}</dd>
          {parsed?.version && (<><dt>Version</dt><dd>{parsed.version}</dd></>)}
          {parsed && (<><dt>File</dt><dd>{round(parsed.byteLength / 1024, 1)} KB · {parsed.glyphCount} glyphs · {parsed.characterCount} characters</dd></>)}
          {usage && (<><dt>On this page</dt><dd>{roleSummary(usage, 7)}</dd><dt>Weights used</dt><dd className="mono" style={{ fontSize: 11.5 }}>{usage.weights.join(' · ')}</dd><dt>Sizes used</dt><dd className="mono" style={{ fontSize: 11.5 }}>{usage.sizes.slice(0, 12).map((s) => `${round(s, 1)}`).join(' · ')} px</dd></>)}
        </dl>
      </section>


      <InstalledCard family={parsed?.familyName ?? name} onFaces={onInstalled} />

      <div id="sec-glyphs" className="stack" style={{ gap: 0 }}><GlyphsCard
        codepoints={glyphSet}
        fontCss={glyphCss}
        toast={toast}
        note={glyphSet ? (fileCov ? 'From the font files this site loads. Boxes mean the character is missing.' : 'From the copy installed on this computer.') : kind === 'web' ? 'The font file could not be read, so its characters cannot be shown.' : 'Use "Show installed styles" above to see the characters of the installed copy.'}
      /></div>

      {saved && (
        <section className="section">
          <h2>[In your library] Collections</h2>
          <CollectionPicker savedId={saved.id!} />
          <label className="label" htmlFor="notes" style={{ marginTop: 6 }}>[Notes]</label>
          <NotesField id={saved.id!} initial={saved.notes} />
          {saved.sitesSeen.length > 0 && <span className="muted" style={{ fontSize: 12 }}>Seen on {saved.sitesSeen.join(', ')}</span>}
          <Screenshots fontId={fontId} tabId={tabId} onPage={!!usage} toast={toast} />
          <button className="btn ghost" style={{ alignSelf: 'flex-start', color: 'var(--red-text)', paddingLeft: 0 }} onClick={async () => { await db.savedFonts.delete(saved.id!); toast('Removed from library'); }}>
            <Icon icon={Delete02Icon} size={15} /> Remove from library
          </button>
        </section>
      )}
    </>
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
      const field = styles.getPropertyValue('--field').trim();
      const muted = styles.getPropertyValue('--muted').trim();
      const green = styles.getPropertyValue('--green-text').trim();
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
      line(base - xA, green, true);
      line(base, ink, false);
      c.fillStyle = ink;
      c.fillText('Hxg', 14, base);
      c.font = `10px 'FFP JetBrains Mono', monospace`;
      c.textAlign = 'right';
      // Values from the font file (units and share of the em), or measured from how it draws.
      const em = (v: number) => `${Math.round(v * 100) / 100} em`;
      const capLabel = parsed?.capHeight ? `CAP ${parsed.capHeight} · ${em(parsed.capHeight / parsed.unitsPerEm)}` : `CAP ${em(capA / 96)}`;
      const xLabel = parsed?.xHeight ? `X-HEIGHT ${parsed.xHeight} · ${em(parsed.xHeight / parsed.unitsPerEm)}` : `X-HEIGHT ${em(xA / 96)}`;
      c.fillStyle = muted;
      c.fillText(capLabel, w - 10, base - capA - 5);
      c.fillStyle = green;
      c.fillText(xLabel, w - 10, base - xA - 5);
      c.fillStyle = ink;
      c.fillText('BASELINE', w - 10, base - 5);
    };
    document.fonts.ready.then(() => (raf = requestAnimationFrame(draw)));
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [fontCss, weight, parsed]);

  return (
    <section className="section">
      <h2>[Metrics] {parsed ? 'from the font file' : 'measured from rendering'}</h2>
      <canvas ref={ref} className="metrics-canvas" aria-label="Cap height, x-height and baseline diagram" />
      {parsed && (
        <div className="grid2" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 6 }}>
          <Metric k="[Units/em]" v={String(parsed.unitsPerEm)} />
          <Metric k="[X/Cap]" v={parsed.capHeight && parsed.xHeight ? String(round(parsed.xHeight / parsed.capHeight, 2)) : 'n/a'} />
          <Metric k="[Glyphs]" v={String(parsed.glyphCount)} />
        </div>
      )}
    </section>
  );
}

function Metric({ k, v }: { k: string; v: string }) {
  return (
    <div className="stack" style={{ padding: '8px 10px', borderRadius: 10, background: 'var(--field)' }}>
      <span className="label" style={{ fontSize: 9 }}>{k}</span>
      <span>{v}</span>
    </div>
  );
}
