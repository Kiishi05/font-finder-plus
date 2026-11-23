// "Use with my fonts": a sub-page of the System tab in three steps.
// 1. Pick your fonts  2. Your styles (the page's styles redone in them)  3. Export
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft01Icon, ArrowRight01Icon, Copy01Icon, Download01Icon, FigmaIcon, PlusSignIcon, Search01Icon, SysComputerIcon, SysEditIcon, SysUndoIcon, Tick02Icon } from '../../shared/icons';
import { sendToTab, type ApplyTypeFace } from '../../shared/messages';
import type { AdaptKey, TypeMetrics } from '../../shared/typeadapt';
import { Icon } from '../components/Icon';
import { applyToPage, undoOnPage } from '../lib/applytype';
import { copyToClipboard, usePageScan, useSystemScan, type TabState } from '../lib/hooks';
import { libraryFonts, localFonts, localFontsReady, measurePicked, nameFont, pageFontFor, searchFonts, type PickedFont } from '../lib/myfonts';
import { buildRows, exportMine, fEm, fLh, fPx, figmaMine, metricsKey, rowsToApply, type Edit, type Fonts, type MyFormat, type MyRow, type NameStyle, type Slot } from '../lib/mystyles';
import { localFontAccessAvailable } from '../lib/installed';
import { nameStyles } from '../lib/system';

interface Props {
  tab: TabState;
  toast: (m: string) => void;
  onBack: () => void;
}

const SLOT_LABEL: Record<Slot, string> = { heading: 'Heading font', body: 'Body font', mono: 'Mono font' };
const STEP_TITLE = ['Pick your fonts', 'Your styles', 'Export'];

export function MyFontsView({ tab, toast, onBack }: Props) {
  const ready = !!tab.ping;
  const { scan } = usePageScan(tab.tabId, ready, tab.ping?.url, tab.fontsVersion);
  const { system } = useSystemScan(tab.tabId, ready, tab.ping?.url, scan, tab.fontsVersion);
  const styles = useMemo(() => (system ? nameStyles(system.styles) : []), [system]);
  const siteFonts = useMemo(() => new Map((scan?.fonts ?? []).map((f) => [f.key, f])), [scan]);

  const [step, setStep] = useState(1);
  const [fonts, setFonts] = useState<Fonts>({ heading: null, body: null, mono: null });
  const [picking, setPicking] = useState<Slot | null>(null);
  const [slots, setSlots] = useState<Record<string, Slot>>({});
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [onPage, setOnPage] = useState(false);
  const [names, setNames] = useState<NameStyle>('simple');
  const [format, setFormat] = useState<MyFormat>('css');

  // The site's fonts, measured the way the page draws them.
  const [theirs, setTheirs] = useState<Map<string, TypeMetrics | null>>(new Map());
  useEffect(() => {
    if (tab.tabId == null || !styles.length) return;
    const list = [...new Map(styles.map((s) => [metricsKey(s), { family: s.family, weight: s.weight, style: s.style }])).values()];
    sendToTab<{ ok: boolean; metrics: (TypeMetrics | null)[] }>(tab.tabId, { type: 'ffp:type-metrics', fonts: list }, 15000).then((r) => {
      if (r?.ok) setTheirs(new Map(list.map((f, i) => [metricsKey(f), r.metrics[i] ?? null])));
    });
  }, [tab.tabId, styles]);

  // Your fonts, loaded and measured in the panel.
  const [yours, setYours] = useState<Map<string, TypeMetrics | null>>(new Map());
  const [cssOf, setCssOf] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    for (const f of Object.values(fonts)) {
      if (!f || cssOf.has(f.id)) continue;
      measurePicked(f, tab.tabId).then(({ css, metrics }) => {
        setCssOf((m) => new Map(m).set(f.id, css));
        setYours((m) => new Map(m).set(f.id, metrics));
      });
    }
  }, [fonts, tab.tabId, cssOf]);

  const rows = useMemo(() => (fonts.heading && fonts.body ? buildRows(styles, fonts, siteFonts, theirs, yours, slots, edits) : []), [styles, fonts, siteFonts, theirs, yours, slots, edits]);

  // The files the page needs, fetched once per font.
  const pageFonts = useRef(new Map<string, { faces?: ApplyTypeFace[]; fontUrlCss?: string }>());
  const showOnPage = useCallback(async (list: MyRow[]) => {
    if (tab.tabId == null) return false;
    for (const f of new Set(list.map((r) => r.font))) {
      if (!pageFonts.current.has(f.id)) pageFonts.current.set(f.id, await pageFontFor(f, tab.tabId));
    }
    const r = await applyToPage(tab.tabId, 'mine', rowsToApply(list, pageFonts.current));
    return !!r?.ok;
  }, [tab.tabId]);

  // Keep the page in step with your edits while it shows your fonts.
  useEffect(() => {
    if (!onPage || !rows.length) return;
    const t = window.setTimeout(() => showOnPage(rows), 250);
    return () => window.clearTimeout(t);
  }, [onPage, rows, showOnPage]);
  // Leaving this page puts the website back.
  const tabRef = useRef(tab.tabId);
  tabRef.current = tab.tabId;
  const onPageRef = useRef(onPage);
  onPageRef.current = onPage;
  useEffect(() => () => {
    if (onPageRef.current && tabRef.current != null) undoOnPage(tabRef.current);
  }, []);

  const togglePage = async () => {
    if (tab.tabId == null) return;
    if (onPage) {
      setOnPage(false);
      await undoOnPage(tab.tabId);
      return;
    }
    setOnPage(true);
    if (!(await showOnPage(rows))) {
      setOnPage(false);
      toast('The page did not answer. Reload it and try again.');
    }
  };

  const back = () => {
    if (step === 1) onBack();
    else setStep(step - 1);
    window.scrollTo(0, 0);
  };
  const go = (n: number) => {
    setStep(n);
    window.scrollTo(0, 0);
  };
  const choose = (slot: Slot, f: PickedFont | null) => {
    const next = { ...fonts, [slot]: f };
    setFonts(next);
    // After the heading font, the body font list opens by itself.
    setPicking(slot === 'heading' && !next.body ? 'body' : null);
  };

  if (!ready || !system) {
    return (
      <div className="mfv">
        <SubTop step={step} onBack={back} />
        <section className="section"><p className="sub">{ready ? 'Reading the page\'s text styles…' : 'Click the Font Finder Plus icon on a page first.'}</p></section>
      </div>
    );
  }

  return (
    <div className="mfv">
      <SubTop step={step} onBack={back} />
      {step === 1 && (
        <section className="section" id="mf-pick">
          <p className="sub">Tap a slot to choose from your Library, Google Fonts or this computer.</p>
          <div className="slots">
            {(['heading', 'body', 'mono'] as Slot[]).map((slot) => (
              <div key={slot} className="slotwrap">
                <SlotButton slot={slot} font={fonts[slot]} css={fonts[slot] ? cssOf.get(fonts[slot]!.id) : undefined} open={picking === slot} onClick={() => setPicking(picking === slot ? null : slot)} />
                {picking === slot && <Picker slot={slot} current={fonts[slot]} onPick={(f) => choose(slot, f)} onClose={() => setPicking(null)} />}
              </div>
            ))}
          </div>
          <div className="acts">
            <button className="btn primary wide" disabled={!fonts.heading || !fonts.body} onClick={() => go(2)}>
              {fonts.heading && fonts.body ? 'See your styles' : 'Pick a heading and body font'}<Icon icon={ArrowRight01Icon} size={16} />
            </button>
          </div>
        </section>
      )}
      {step === 2 && (
        <>
          <section className="section mfchosen">
            {(['heading', 'body', 'mono'] as Slot[]).filter((s) => s !== 'mono' || fonts.mono).map((slot) => (
              <div key={slot} className="chosen">
                <span className="aa" style={{ fontFamily: cssOf.get(fonts[slot]!.id) }} aria-hidden="true">Aa</span>
                <span className="t"><small>{SLOT_LABEL[slot]}</small><b style={{ fontFamily: cssOf.get(fonts[slot]!.id) }}>{fonts[slot]!.name}</b></span>
                <button className="btn sm" aria-label={`Change ${SLOT_LABEL[slot].toLowerCase()}`} onClick={() => { setPicking(slot); go(1); }}>Change</button>
              </div>
            ))}
          </section>
          <section className="section">
            <div className="pvrow">
              <span className="t"><b id="mf-onpage-label">See it on this page</b><span>Shows your fonts and sizes on the website in this tab. Turn it off to put the page back.</span></span>
              <button className="switch" role="switch" aria-checked={onPage} aria-labelledby="mf-onpage-label" onClick={togglePage} />
            </div>
          </section>
          <section className="section" id="mf-styles">
            <div className="ht">
              <h2>{rows.length} {rows.length === 1 ? 'style' : 'styles'} in your fonts</h2>
              <p className="sub">Each value is worked out from the fonts' real proportions. Tap Edit to change one.</p>
            </div>
            <div className="mfrows">
              {rows.map((r) => (
                <StyleRow
                  key={r.s.id}
                  r={r}
                  css={cssOf.get(r.font.id)}
                  fonts={fonts}
                  onSlot={(slot) => setSlots((m) => ({ ...m, [r.s.id]: slot }))}
                  onEdit={(k, v) => setEdits((m) => ({ ...m, [r.s.id]: { ...m[r.s.id], [k]: v } }))}
                  onReset={() => setEdits((m) => { const n = { ...m }; delete n[r.s.id]; return n; })}
                />
              ))}
            </div>
            <div className="acts">
              <button className="btn primary wide" onClick={() => go(3)}>Export these styles<Icon icon={ArrowRight01Icon} size={16} /></button>
            </div>
          </section>
        </>
      )}
      {step === 3 && scan && (
        <ExportStep rows={rows} names={names} setNames={setNames} format={format} setFormat={setFormat} site={{ host: scan.host, url: scan.url, title: scan.title }} toast={toast} />
      )}
    </div>
  );
}

function SubTop({ step, onBack }: { step: number; onBack: () => void }) {
  return (
    <div className="subtop mftop">
      <button className="backbtn tip" data-tip="Back" aria-label="Back" onClick={onBack}><Icon icon={ArrowLeft01Icon} size={18} /></button>
      <h1 className="crumb"><span>Step {step} of 3</span><span className="sl" aria-hidden="true">·</span><b>{STEP_TITLE[step - 1]}</b></h1>
    </div>
  );
}

// ------------------------------------------------------------- step 1: slots and the font search

function SlotButton({ slot, font, css, open, onClick }: { slot: Slot; font: PickedFont | null; css?: string; open: boolean; onClick: () => void }) {
  const opt = slot === 'mono';
  if (!font) {
    return (
      <button className={`slot${opt ? ' opt' : ''}`} aria-expanded={open} onClick={onClick}>
        <span className="aa"><Icon icon={PlusSignIcon} size={18} /></span>
        <span className="t"><b>{SLOT_LABEL[slot]}{opt ? ' · optional' : ''}</b><small>{opt ? 'For labels and code' : 'Tap to choose'}</small></span>
      </button>
    );
  }
  return (
    <button className={`slot set${opt ? ' opt' : ''}`} aria-expanded={open} aria-label={`${SLOT_LABEL[slot]}: ${font.name}. Change`} onClick={onClick}>
      <span className="aa" style={{ fontFamily: css }}>Aa</span>
      <span className="t"><small>{SLOT_LABEL[slot]}</small><b className="fname" style={{ fontFamily: css }}>{font.name}</b></span>
      <span className="go">Change</span>
    </button>
  );
}

const FROM_LABEL = { library: 'Your Library', google: 'Google Fonts', local: 'This computer' } as const;

function Picker({ slot, current, onPick, onClose }: { slot: Slot; current: PickedFont | null; onPick: (f: PickedFont | null) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [library, setLibrary] = useState<PickedFont[]>([]);
  const [local, setLocal] = useState<PickedFont[]>([]);
  const [localAsked, setLocalAsked] = useState(localFontsReady());
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    libraryFonts().then(setLibrary).catch(() => undefined);
    if (localFontsReady()) localFonts().then(setLocal).catch(() => undefined);
    input.current?.focus();
  }, []);
  const results = useMemo(() => searchFonts(q, slot, library, local), [q, slot, library, local]);
  const askLocal = async () => {
    setLocalAsked(true);
    try {
      setLocal(await localFonts());
    } catch {
      setLocal([]);
    }
  };
  // Group labels only where the source changes.
  let last: string | null = null;
  return (
    <div className="picker" onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
      <label className="search">
        <Icon icon={Search01Icon} size={16} />
        <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search fonts" aria-label={`Search fonts for the ${SLOT_LABEL[slot].toLowerCase()}`} autoComplete="off" spellCheck={false} />
      </label>
      <ul className="flist" aria-label="Fonts">
        {slot === 'mono' && current && (
          <li><button className="fitem" onClick={() => onPick(null)}><span className="fn none">No mono font</span><small>Labels and code use your body font</small></button></li>
        )}
        {results.map(({ font, from }) => {
          const head = from !== last ? FROM_LABEL[from] : null;
          last = from;
          return (
            <li key={font.id}>
              {head && <span className="grp">{head}</span>}
              <FontItem font={font} on={current?.id === font.id} onPick={() => onPick(font)} />
            </li>
          );
        })}
        {!results.length && <li className="nores">No fonts match “{q}”.</li>}
      </ul>
      {localFontAccessAvailable() && !localAsked && (
        <button className="linkbtn localask" onClick={askLocal}><Icon icon={SysComputerIcon} size={16} />Include fonts on this computer</button>
      )}
    </div>
  );
}

function FontItem({ font, on, onPick }: { font: PickedFont; on: boolean; onPick: () => void }) {
  const [css, setCss] = useState<string | undefined>(font.from === 'local' ? `"${font.name}"` : undefined);
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (font.from === 'local') return;
    // Load the name's letters only when the row scrolls into view.
    const el = ref.current;
    if (!el) return;
    let off = false;
    const io = new IntersectionObserver((e) => {
      if (!e[0]?.isIntersecting) return;
      io.disconnect();
      if (font.catalogFamily) nameFont(font.catalogFamily).then((c) => !off && c && setCss(c));
      else measurePicked(font, null).then(({ css: c }) => !off && setCss(c));
    });
    io.observe(el);
    return () => {
      off = true;
      io.disconnect();
    };
  }, [font]);
  const w = font.weights === 'any' ? 'All weights' : font.weights.length === 1 ? '1 weight' : `${font.weights.length} weights`;
  return (
    <button ref={ref} className="fitem" aria-pressed={on} onClick={onPick}>
      <span className="fn" style={{ fontFamily: css }}>{font.name}</span>
      <small>{w}{font.from === 'google' || font.catalogFamily ? ' · Free' : ''}</small>
      {on && <span className="tick" aria-label="Chosen"><Icon icon={Tick02Icon} size={16} /></span>}
    </button>
  );
}

// ------------------------------------------------------------- step 2: one style

const KEYS: { k: AdaptKey; label: string; f: (n: number) => string; unit: string; step: number }[] = [
  { k: 'size', label: 'Size', f: fPx, unit: 'px', step: 0.5 },
  { k: 'lh', label: 'Line height', f: fLh, unit: '', step: 0.05 },
  { k: 'ls', label: 'Letter spacing', f: fEm, unit: 'em', step: 0.005 },
  { k: 'weight', label: 'Weight', f: String, unit: '', step: 100 },
];

function StyleRow({ r, css, fonts, onSlot, onEdit, onReset }: { r: MyRow; css?: string; fonts: Fonts; onSlot: (s: Slot) => void; onEdit: (k: AdaptKey, v: number) => void; onReset: () => void }) {
  const [editing, setEditing] = useState(false);
  const val = (k: AdaptKey) => (k === 'size' ? r.size : k === 'lh' ? r.lh : k === 'ls' ? r.ls : r.weight);
  const from = (k: AdaptKey) => (k === 'size' ? r.from.size : k === 'lh' ? r.from.lh : k === 'ls' ? r.from.ls : r.from.weight);
  const slotOptions = (['heading', 'body', 'mono'] as Slot[]).filter((s) => s !== 'mono' || fonts.mono);
  const edited = Object.keys(r.edited).length > 0;
  return (
    <div className="mfrow" data-style={r.s.name}>
      <div className="top">
        <span className="nm"><b>{r.name}</b><small>{r.font.name} · {SLOT_LABEL[r.slot].replace(' font', '').toLowerCase()} font</small></span>
        <button className="btn sm" aria-expanded={editing} onClick={() => setEditing(!editing)}><Icon icon={editing ? Tick02Icon : SysEditIcon} size={16} />{editing ? 'Done' : 'Edit'}</button>
      </div>
      <div className="smp" dir="auto" style={{ fontFamily: css, fontSize: Math.min(r.size, 26), fontWeight: r.weight, letterSpacing: `${r.ls}em`, lineHeight: 1.2, textTransform: r.caps ? 'uppercase' : undefined }}>{r.s.sample || r.name}</div>
      <div className="chgs">
        {KEYS.map(({ k, label, f }) => {
          const a = from(k);
          const b = val(k);
          const changed = f(a) !== f(b);
          const mine = r.edited[k] != null;
          return (
            <div key={k} className={`chg${changed ? '' : ' same'}`}>
              <span className="l">{label}</span>
              <span className="v">{changed ? <><s>{f(a)}</s><span className="arr" aria-label="to">→</span><b>{f(b)}</b></> : <>Same · {f(b)}</>}</span>
              {(changed || mine) && <span className="why">{mine ? `You set this. Ours was ${f(r.auto[k])}.` : r.auto.why[k]}</span>}
            </div>
          );
        })}
      </div>
      {editing && (
        <div className="edit">
          <div className="seg" role="group" aria-label={`Font for ${r.name}`}>
            {slotOptions.map((s) => (
              <button key={s} aria-pressed={r.slot === s} onClick={() => onSlot(s)}>{SLOT_LABEL[s].replace(' font', '')}</button>
            ))}
          </div>
          <div className="fields">
            {KEYS.map(({ k, label, unit, step }) => (
              <NumField key={k} label={`${label}${unit ? ` (${unit})` : ''}`} value={val(k)} step={step} onChange={(v) => onEdit(k, v)} />
            ))}
          </div>
          {edited && <button className="linkbtn" onClick={onReset}><Icon icon={SysUndoIcon} size={16} />Use our values</button>}
        </div>
      )}
    </div>
  );
}

function NumField({ label, value, step, onChange }: { label: string; value: number; step: number; onChange: (v: number) => void }) {
  const [text, setText] = useState(String(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(String(value));
  }, [value]);
  const commit = (t: string) => {
    const n = Number(t.replace(',', '.').replace('−', '-'));
    if (Number.isFinite(n) && t.trim() !== '') onChange(step >= 100 ? Math.round(n) : n);
  };
  return (
    <label className="nf">
      <span>{label}</span>
      <input
        className="field"
        inputMode="decimal"
        value={text}
        onFocus={() => { focused.current = true; }}
        onBlur={() => { focused.current = false; setText(String(value)); }}
        onChange={(e) => { setText(e.target.value); commit(e.target.value); }}
      />
    </label>
  );
}

// ------------------------------------------------------------- step 3: export

function ExportStep({ rows, names, setNames, format, setFormat, site, toast }: { rows: MyRow[]; names: NameStyle; setNames: (n: NameStyle) => void; format: MyFormat; setFormat: (f: MyFormat) => void; site: { host: string; url: string; title: string }; toast: (m: string) => void }) {
  const [copied, setCopied] = useState(false);
  const code = useMemo(() => (format === 'figma' ? '' : exportMine(format, rows, names, site.host)), [format, rows, names, site.host]);
  const copy = async () => {
    const text = format === 'figma' ? figmaMine(rows, names, site).text : code;
    if (await copyToClipboard(text)) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
      if (format === 'figma') toast('Copied. In Figma, open the Font Finder Plus plugin and paste.');
    } else toast('Could not copy. Click the panel first, then try again.');
  };
  const download = () => {
    const file = format === 'css' ? 'my-type.css' : 'my-theme.css';
    const url = URL.createObjectURL(new Blob([code], { type: 'text/css' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = file;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast(`Downloaded ${file}`);
  };
  const first = rows[0];
  return (
    <section className="section" id="mf-export">
      <div className="lab">
        <span id="mf-names">Style names</span>
        <div className="seg" role="group" aria-labelledby="mf-names">
          <button aria-pressed={names === 'simple'} onClick={() => setNames('simple')}>Simple{first ? `: ${first.name}` : ''}</button>
          <button aria-pressed={names === 'site'} onClick={() => setNames('site')}>The site's{first ? `: ${first.s.name}` : ''}</button>
        </div>
      </div>
      <div className="lab">
        <span id="mf-format">Format</span>
        <div className="seg" role="group" aria-labelledby="mf-format">
          {([['css', 'CSS'], ['tailwind', 'Tailwind'], ['figma', 'Figma']] as [MyFormat, string][]).map(([k, l]) => (
            <button key={k} aria-pressed={format === k} onClick={() => setFormat(k)}>{l}</button>
          ))}
        </div>
      </div>
      {format === 'figma' ? (
        <>
          <div className="figlist">
            {rows.map((r) => (
              <div key={r.s.id}><span>{names === 'simple' ? r.name : r.s.name}</span><em>{r.font.name} {r.weight} · {fPx(r.size)} / {fLh(r.lh)}</em></div>
            ))}
          </div>
          <p className="sub">Copies {rows.length} text {rows.length === 1 ? 'style' : 'styles'}. In Figma, run the Font Finder Plus plugin and paste.</p>
          <div className="acts">
            <button className="btn primary wide" onClick={copy}><Icon icon={copied ? Tick02Icon : FigmaIcon} size={16} />{copied ? 'Copied' : 'Copy for Figma'}</button>
          </div>
        </>
      ) : (
        <>
          <pre className="code" tabIndex={0} aria-label={`${format === 'css' ? 'CSS' : 'Tailwind'} code`}>{code}</pre>
          <div className="acts row2">
            <button className="btn primary grow" onClick={copy}><Icon icon={copied ? Tick02Icon : Copy01Icon} size={16} />{copied ? 'Copied' : `Copy ${format === 'css' ? 'CSS' : 'Tailwind'}`}</button>
            <button className="btn" onClick={download}><Icon icon={Download01Icon} size={16} />Download</button>
          </div>
        </>
      )}
    </section>
  );
}
