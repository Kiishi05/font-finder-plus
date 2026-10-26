import { useEffect, useMemo, useState } from 'react';
import { declarationCss } from '../../shared/css';
import { Alert02Icon, ArrowDown01Icon, ArrowUp01Icon, Copy01Icon, Download01Icon, Target02Icon } from '../../shared/icons';
import { sendToTab } from '../../shared/messages';
import type { PageFontUsage, PageScan, ReadabilityIssue, SystemScan } from '../../shared/types';
import { Icon } from '../components/Icon';
import { Select } from '../components/Select';
import { copyToClipboard, usePageScan, useSystemScan, type TabState } from '../lib/hooks';
import { usePreviewFamily } from '../lib/preview';
import { EXPORTS, detectScale, devSummary, exportSystem, nameStyles, type ExportFormat, type NamedStyle } from '../lib/system';

interface Props {
  tab: TabState;
  toast: (m: string) => void;
}

const LEVEL: Record<ReadabilityIssue['level'], { text: string; tone: string }> = {
  fail: { text: 'Fails', tone: 'bad' },
  warn: { text: 'Check', tone: 'warn' },
  tip: { text: 'Tip', tone: 'neutral' },
};

export function SystemView({ tab, toast }: Props) {
  const ready = !!tab.ping;
  const { scan } = usePageScan(tab.tabId, ready, tab.ping?.url, tab.fontsVersion);
  const { system, loading, error, rerun } = useSystemScan(tab.tabId, ready, tab.ping?.url, scan, tab.fontsVersion);
  const styles = useMemo(() => (system ? nameStyles(system.styles) : []), [system]);

  if (!ready) {
    return (
      <div className="empty">
        <h2>Type system, readability and export</h2>
        <p>Click the Font Finder Plus icon on the page you want to check. This tab then shows its text styles, readability checks, how its fonts load, and exports for CSS, Tailwind, Figma and Framer.</p>
      </div>
    );
  }

  return (
    <>
      <nav className="jump" aria-label="Jump to">
        {[['sys-styles', 'Styles'], ['sys-read', 'Readability'], ['sys-dev', 'Developer'], ['sys-export', 'Export'], ['sys-compare', 'Compare']].map(([id, label]) => (
          <button key={id} onClick={() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>{label}</button>
        ))}
      </nav>
      {loading && !system && <div className="notice neutral">Reading the page's text styles…</div>}
      {error && <div className="notice amber"><Icon icon={Alert02Icon} size={15} />{error}</div>}
      {system && scan && (
        <>
          <StylesCard styles={styles} scan={scan} tabId={tab.tabId} toast={toast} />
          <ReadabilityCard issues={system.issues} tabId={tab.tabId} toast={toast} />
          <DevCard system={system} scan={scan} />
          <ExportCard styles={styles} host={scan.host} toast={toast} />
          <CompareCard tabId={tab.tabId} scan={scan} system={system} styles={styles} />
          <button className="btn" style={{ height: 40, borderRadius: 12 }} onClick={rerun} disabled={loading}>{loading ? 'Reading…' : 'Check the page again'}</button>
        </>
      )}
    </>
  );
}

// ------------------------------------------------------------- styles

function StylesCard({ styles, scan, tabId, toast }: { styles: NamedStyle[]; scan: PageScan; tabId: number | null; toast: (m: string) => void }) {
  const [all, setAll] = useState(false);
  const scale = useMemo(() => detectScale(styles), [styles]);
  const fonts = useMemo(() => new Map(scan.fonts.map((f) => [f.key, f])), [scan]);
  const shown = all ? styles : styles.slice(0, 10);
  return (
    <section className="section" id="sys-styles">
      <h2>[Type styles] {styles.length} on this page</h2>
      <div className="scalebox">
        {scale.ratio ? (
          <span><b>{scale.ratio} scale ({scale.label})</b>, from a {scale.base}px base. {scale.fits} of {scale.total} other sizes fit.</span>
        ) : (
          <span><b>No single size scale.</b> {scale.total < 2 ? 'Too few different sizes to tell.' : 'The sizes do not follow one ratio.'}</span>
        )}
        <span className="mono muted" style={{ fontSize: 11 }}>{scale.sizes.join(' · ')} px</span>
      </div>
      <div className="styles">
        {shown.map((s) => <StyleRow key={s.id} s={s} font={fonts.get(s.fontKey) ?? null} tabId={tabId} toast={toast} />)}
      </div>
      {styles.length > 10 && (
        <button className="linkbtn row" style={{ gap: 4, alignSelf: 'flex-start', textDecoration: 'none' }} onClick={() => setAll(!all)}>
          {all ? 'Show fewer' : `Show ${styles.length - 10} more`} <Icon icon={all ? ArrowUp01Icon : ArrowDown01Icon} size={14} />
        </button>
      )}
      <span className="muted" style={{ fontSize: 11.5 }}>Names are suggestions from the page's HTML (h1 to h6, paragraphs, buttons). Styles used once are left out unless they are headings.</span>
    </section>
  );
}

function StyleRow({ s, font, tabId, toast }: { s: NamedStyle; font: PageFontUsage | null; tabId: number | null; toast: (m: string) => void }) {
  const preview = usePreviewFamily(font ?? { family: s.family, kind: 'local', files: [] }, tabId);
  const css = declarationCss(s.declared, { fontSize: s.size, fontWeight: s.weight, fontStyle: s.style, lineHeight: s.lineHeight == null ? 'normal' : `${s.lineHeight}px`, letterSpacing: s.letterSpacing ? `${s.letterSpacing}px` : 'normal', color: '' }, s.family);
  return (
    <div className="stylerow">
      <div className="row" style={{ alignItems: 'baseline' }}>
        <span className="tagname">{s.name}</span>
        <span className="grow muted" style={{ fontSize: 11.5, overflowWrap: 'anywhere' }}>{s.displayName} · {s.weight}{s.style !== 'normal' ? ' italic' : ''}</span>
        <button className="iconbtn sm" aria-label={`Copy CSS for ${s.name}`} title="Copy CSS" onClick={async () => (await copyToClipboard(css)) && toast(`Copied CSS for ${s.name}`)}><Icon icon={Copy01Icon} size={14} /></button>
      </div>
      <div className="stylesample" dir="auto" style={{ fontFamily: preview.css, fontSize: Math.min(s.size, 44), fontWeight: Number(s.weight) || 400, fontStyle: s.style, letterSpacing: s.em ? `${s.em}em` : undefined, textTransform: s.transform as React.CSSProperties['textTransform'], lineHeight: 1.15 }}>
        {s.sample || s.name}
      </div>
      <span className="mono muted" style={{ fontSize: 11 }}>
        {s.size}px / {s.lineHeight == null ? 'normal' : `${s.lineHeight}px (${s.lh})`} · tracking {s.em ? `${s.em}em` : '0'}{s.transform !== 'none' ? ` · ${s.transform}` : ''} · {s.count}×{s.size > 44 ? ' · preview capped at 44px' : ''}
      </span>
    </div>
  );
}

// ------------------------------------------------------------- readability

function ReadabilityCard({ issues, tabId, toast }: { issues: ReadabilityIssue[]; tabId: number | null; toast: (m: string) => void }) {
  const [on, setOn] = useState<string | null>(null);
  const show = async (i: ReadabilityIssue) => {
    if (tabId == null) return;
    const r = await sendToTab<{ shown: number; hidden: number; cleared?: boolean }>(tabId, { type: 'ffp:highlight-issue', id: i.id, label: i.title });
    setOn(r?.shown ? i.id : null);
    if (r?.shown) window.setTimeout(() => setOn((cur) => (cur === i.id ? null : cur)), 6000);
    if (r && !r.shown && !r.cleared) toast('These are not visible on the page right now');
  };
  return (
    <section className="section" id="sys-read">
      <h2>[Readability] {issues.length ? `${issues.length} to look at` : 'All clear'}</h2>
      {!issues.length && <span style={{ fontSize: 12.5 }}>No problems found with text size, line height, line length or contrast.</span>}
      <div className="issues">
        {issues.map((i) => (
          <div key={i.id} className="issue">
            <div className="row" style={{ alignItems: 'flex-start' }}>
              <span className={`pill ${LEVEL[i.level].tone}`}>{LEVEL[i.level].text}</span>
              <b className="grow" style={{ fontSize: 12.5 }}>{i.title} <span className="muted" style={{ fontWeight: 400 }}>({i.count})</span></b>
            </div>
            <span className="muted" style={{ fontSize: 12 }}>{i.detail}</span>
            <span className="muted" style={{ fontSize: 11.5, fontStyle: 'italic', overflowWrap: 'anywhere' }}>“{i.sample}”</span>
            <button className={`btn sm${on === i.id ? ' done' : ''}`} style={{ alignSelf: 'flex-start' }} onClick={() => show(i)}>
              <Icon icon={Target02Icon} size={13} />{on === i.id ? 'Hide outlines' : 'Show on page'}
            </button>
          </div>
        ))}
      </div>
      <span className="muted" style={{ fontSize: 11.5 }}>Checks visible text against WCAG 2.1 AA contrast and common reading guidelines. Text on images or gradients is not checked for contrast.</span>
    </section>
  );
}

// ------------------------------------------------------------- developer

function DevCard({ system, scan }: { system: SystemScan; scan: PageScan }) {
  const d = useMemo(() => devSummary(system.dev, scan), [system, scan]);
  const kb = Math.round(d.knownBytes / 1024);
  return (
    <section className="section" id="sys-dev">
      <h2>[Developer] How fonts load</h2>
      <div className="grid2" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 6 }}>
        <Stat k="[Files]" v={String(d.files)} />
        <Stat k="[Size]" v={d.files ? (kb ? `${kb} KB${d.unknownSizes ? '+' : ''}` : 'Hidden') : '0'} />
        <Stat k="[Formats]" v={Object.entries(d.formats).map(([f, n]) => `${f} ${n}`).join(' · ') || 'none'} />
      </div>
      {d.unknownSizes > 0 && <span className="muted" style={{ fontSize: 11.5 }}>{d.unknownSizes} {d.unknownSizes === 1 ? 'file comes' : 'files come'} from a server that hides download sizes, so the total is a minimum.</span>}
      <div className="tips">
        {d.tips.map((t, i) => (
          <div key={i} className="row" style={{ alignItems: 'flex-start', fontSize: 12.5 }}>
            <span className={`pill ${t.level === 'warn' ? 'warn' : t.level === 'ok' ? 'good' : 'neutral'}`}>{t.level === 'warn' ? 'Check' : t.level === 'ok' ? 'Good' : 'Tip'}</span>
            <span className="grow">{t.text}</span>
          </div>
        ))}
      </div>
      <dl className="kv">
        {d.families.map((f) => (
          <FamilyRow key={f.family} f={f} />
        ))}
      </dl>
      {system.dev.preloads.length > 0 && <span className="muted" style={{ fontSize: 11.5, overflowWrap: 'anywhere' }}>Preloaded: {system.dev.preloads.map((u) => u.split('/').pop()).join(', ')}</span>}
    </section>
  );
}

function FamilyRow({ f }: { f: ReturnType<typeof devSummary>['families'][number] }) {
  return (
    <>
      <dt style={{ overflowWrap: 'anywhere' }}>{f.family}</dt>
      <dd style={{ fontSize: 12 }}>
        {f.loaded} of {f.faces} files loaded · weights {f.weightsLoaded.join(', ') || 'none'} · font-display {f.display.join(', ')}
        {!f.used && f.loaded > 0 ? ' · not used here' : ''}
      </dd>
    </>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="stack" style={{ padding: '8px 10px', borderRadius: 10, background: 'var(--field)', minWidth: 0 }}>
      <span className="label" style={{ fontSize: 9 }}>{k}</span>
      <span style={{ fontSize: 12.5, overflowWrap: 'anywhere' }}>{v}</span>
    </div>
  );
}

// ------------------------------------------------------------- export

function ExportCard({ styles, host, toast }: { styles: NamedStyle[]; host: string; toast: (m: string) => void }) {
  const [format, setFormat] = useState<ExportFormat>('css');
  const meta = EXPORTS.find((e) => e.id === format)!;
  const text = useMemo(() => exportSystem(format, styles, host), [format, styles, host]);
  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: format === 'tokens' ? 'application/json' : 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = meta.file;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };
  return (
    <section className="section" id="sys-export">
      <h2>[Export] This page's type system</h2>
      <Select<ExportFormat> label="Export format" value={format} onChange={setFormat} options={EXPORTS.map((e) => ({ value: e.id, label: e.label }))} />
      <span className="muted" style={{ fontSize: 12 }}>{meta.note}</span>
      <pre className="code" aria-label={`${meta.label} code`}>{text}</pre>
      <div className="row" style={{ gap: 6 }}>
        <button className="btn sm primary" onClick={async () => (await copyToClipboard(text)) && toast(`Copied ${meta.label}`)}><Icon icon={Copy01Icon} size={13} />Copy</button>
        <button className="btn sm" onClick={download}><Icon icon={Download01Icon} size={13} />Download {meta.file}</button>
      </div>
    </section>
  );
}

// ------------------------------------------------------------- compare

interface Saved { scan: PageScan; system: SystemScan | null; savedAt: number }

function CompareCard({ tabId, scan, system, styles }: { tabId: number | null; scan: PageScan; system: SystemScan; styles: NamedStyle[] }) {
  const [others, setOthers] = useState<{ tabId: number; title: string; saved: Saved }[]>([]);
  const [pick, setPick] = useState<string>('');
  useEffect(() => {
    (async () => {
      const all = await chrome.storage.session.get(null);
      const tabs = await chrome.tabs.query({});
      const open = new Map(tabs.map((t) => [t.id, t]));
      const list = Object.entries(all)
        .filter(([k]) => k.startsWith('compare:'))
        .map(([k, v]) => ({ tabId: Number(k.slice(8)), saved: v as Saved }))
        .filter((o) => o.tabId !== tabId && open.has(o.tabId) && o.saved?.scan)
        .map((o) => ({ ...o, title: open.get(o.tabId)?.title ?? o.saved.scan.host }));
      setOthers(list);
      if (list.length && !pick) setPick(String(list[0].tabId));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId]);
  const other = others.find((o) => String(o.tabId) === pick) ?? null;
  return (
    <section className="section" id="sys-compare">
      <h2>[Compare] With another tab</h2>
      {!others.length ? (
        <span className="muted" style={{ fontSize: 12.5 }}>Open another site in a new tab and click the Font Finder Plus icon there (or switch to it with the panel open). It then appears here to compare with this page.</span>
      ) : (
        <>
          <Select label="Tab to compare with" value={pick} onChange={setPick} options={others.map((o) => ({ value: String(o.tabId), label: `${o.saved.scan.host} · ${o.title}`.slice(0, 80) }))} />
          {other && <Comparison a={{ scan, system, styles }} b={other.saved} />}
        </>
      )}
    </section>
  );
}

function Comparison({ a, b }: { a: { scan: PageScan; system: SystemScan; styles: NamedStyle[] }; b: Saved }) {
  const bStyles = useMemo(() => (b.system ? nameStyles(b.system.styles) : []), [b]);
  const name = (f: PageFontUsage) => f.displayName || f.family;
  const aFonts = a.scan.fonts.map(name);
  const bFonts = b.scan.fonts.map(name);
  const allFonts = [...new Set([...aFonts, ...bFonts])];
  const body = (list: NamedStyle[]) => list.find((s) => s.name === 'body');
  const h1 = (list: NamedStyle[]) => list.find((s) => s.name === 'h1') ?? list.find((s) => /^h[1-6]$|display/.test(s.name));
  const fmt = (s?: NamedStyle) => (s ? `${s.displayName} ${s.size}px / ${s.lh ?? 'normal'}` : 'None found');
  const scaleText = (list: NamedStyle[]) => {
    if (!list.length) return 'Unknown';
    const sc = detectScale(list);
    return sc.ratio ? `${sc.ratio} (${sc.label})` : 'No single scale';
  };
  const same = a.scan.host === b.scan.host;
  const ha = same ? a.scan.title || 'This tab' : a.scan.host;
  const hb = same ? b.scan.title || 'Other tab' : b.scan.host;
  const rows: [string, string, string][] = [
    ['Fonts', String(aFonts.length), String(bFonts.length)],
    ['Body text', fmt(body(a.styles)), b.system ? fmt(body(bStyles)) : 'Open System on that tab once'],
    ['Main heading', fmt(h1(a.styles)), b.system ? fmt(h1(bStyles)) : '…'],
    ['Text styles', String(a.styles.length), b.system ? String(bStyles.length) : '…'],
    ['Size scale', scaleText(a.styles), b.system ? scaleText(bStyles) : '…'],
    ['Readability issues', String(a.system.issues.length), b.system ? String(b.system.issues.length) : '…'],
  ];
  return (
    <div className="stack" style={{ gap: 10 }}>
      <table className="cmp">
        <thead><tr><th /><th>{ha}</th><th>{hb}</th></tr></thead>
        <tbody>
          {rows.map(([k, x, y]) => <tr key={k}><td>{k}</td><td>{x}</td><td>{y}</td></tr>)}
        </tbody>
      </table>
      <table className="cmp">
        <thead><tr><th>Font</th><th>{ha}</th><th>{hb}</th></tr></thead>
        <tbody>
          {allFonts.map((f) => <tr key={f}><td>{f}</td><td>{aFonts.includes(f) ? 'Yes' : '–'}</td><td>{bFonts.includes(f) ? 'Yes' : '–'}</td></tr>)}
        </tbody>
      </table>
    </div>
  );
}
