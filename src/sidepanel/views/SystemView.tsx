import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { googleFamily } from '../../shared/catalog';
import { figmaTypeToApply, parseFigmaType, type FigmaTypeClip } from '../../shared/figmatype';
import {
  Alert02Icon, ArrowDown01Icon, ArrowRight01Icon, Cancel01Icon, Copy01Icon, Download01Icon, FigmaIcon, SysRefreshIcon, SysTextFontIcon, Target02Icon, Tick02Icon,
  SysArrowReloadIcon, SysClipboardIcon, SysMagicIcon,
} from '../../shared/icons';
import { sendToTab, type ApplyTypeReply } from '../../shared/messages';
import { CLEAN_RATIOS, cleanScale, closestRatio, diffText } from '../../shared/typeadapt';
import type { PageFontUsage, PageScan, ReadabilityIssue, SystemScan } from '../../shared/types';
import { Icon } from '../components/Icon';
import { applyToPage, undoOnPage, useAppliedOwner } from '../lib/applytype';
import { buildFigmaPayload } from '../lib/figma';
import { freeCssUrl, swapFaces } from '../lib/google';
import { healthCheck, type Health } from '../lib/health';
import { copyToClipboard, usePageScan, useSystemScan, type TabState } from '../lib/hooks';
import { usePreviewFamily } from '../lib/preview';
import { EXPORTS, cleanScaleCss, detectScale, devSummary, exportSystem, nameStyles, prettyStyleName, type ExportFormat, type NamedStyle } from '../lib/system';

interface Props {
  tab: TabState;
  toast: (m: string) => void;
  onMyFonts: () => void;
}

const COPY_FAIL = 'Could not copy. Click the panel first, then try again.';

/** A key that reads as "copied" for 1.6s after a successful copy. */
function useCopied() {
  const [copied, setCopied] = useState<string | null>(null);
  const timer = useRef<number>();
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const mark = useCallback((key: string) => {
    setCopied(key);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(null), 1600);
  }, []);
  return [copied, mark] as const;
}

export function SystemView({ tab, toast, onMyFonts }: Props) {
  const ready = !!tab.ping;
  const { scan } = usePageScan(tab.tabId, ready, tab.ping?.url, tab.fontsVersion);
  const { system, loading, error, rerun } = useSystemScan(tab.tabId, ready, tab.ping?.url, scan, tab.fontsVersion);
  const styles = useMemo(() => (system ? nameStyles(system.styles) : []), [system]);
  const health = useMemo(() => (system && scan ? healthCheck({ scan, styles, issues: system.issues, dev: devSummary(system.dev, scan), scale: detectScale(styles) }) : null), [scan, styles, system]);

  if (!ready) {
    return (
      <section className="empty">
        <span className="eic"><Icon icon={SysTextFontIcon} size={22} /></span>
        <div className="et">
          <h2>Check a page's type system</h2>
          <p>Click the Font Finder Plus icon on a page. This tab then shows its text sizes next to a clean scale, readability checks and exports for CSS, Tailwind and Figma.</p>
        </div>
      </section>
    );
  }

  return (
    <div className="sys">
      {loading && !system && <div className="notice neutral">Reading the page's text styles…</div>}
      {error && <div className="notice neutral"><Icon icon={Alert02Icon} size={15} />{error}</div>}
      {system && scan && health && (
        <>
          <ScaleCard styles={styles} scan={scan} tabId={tab.tabId} toast={toast} onAgain={rerun} loading={loading} />
          <button className="mfentry" onClick={onMyFonts}>
            <span className="ic"><Icon icon={SysMagicIcon} size={18} /></span>
            <span className="t"><b>Use with my fonts</b><span>Pick a heading and body font. Sizes and spacing are adjusted to fit them.</span></span>
            <span className="chev"><Icon icon={ArrowRight01Icon} size={16} /></span>
          </button>
          <FigmaPasteRow tabId={tab.tabId} toast={toast} />
          <ReadabilityCard system={system} styles={styles} health={health} tabId={tab.tabId} toast={toast} />
          <DevCard system={system} scan={scan} health={health} />
          <ExportCard styles={styles} scan={scan} system={system} tabId={tab.tabId} toast={toast} />
          <CompareCard tabId={tab.tabId} scan={scan} system={system} styles={styles} />
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------- clean scale

const FIRST = 8;
const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

function ScaleCard({ styles, scan, tabId, toast, onAgain, loading }: { styles: NamedStyle[]; scan: PageScan; tabId: number | null; toast: (m: string) => void; onAgain: () => Promise<void>; loading: boolean }) {
  const sorted = useMemo(() => [...styles].sort((a, b) => b.size - a.size || b.count - a.count), [styles]);
  const base = styles.find((s) => s.name === 'body')?.size ?? 16;
  const best = useMemo(() => closestRatio(sorted.map((s) => s.size), base), [sorted, base]);
  const [ratio, setRatio] = useState<number>(best);
  useEffect(() => setRatio(best), [best]);
  const rows = useMemo(() => cleanScale(sorted, (s) => s.size, base, ratio), [sorted, base, ratio]);
  const far = rows.filter((r) => r.far).length;
  const [all, setAll] = useState(false);
  const [copied, markCopied] = useCopied();
  const owner = useAppliedOwner(tabId);
  const trying = owner === 'scale';
  const fonts = useMemo(() => new Map(scan.fonts.map((f) => [f.key, f])), [scan]);
  const spinRef = useRef<HTMLSpanElement>(null);
  const shown = all ? rows : rows.slice(0, FIRST);
  const fmt = (n: number) => `${+n.toFixed(1)}px`;

  const copy = async () => {
    const css = cleanScaleCss(rows.map((r) => ({ name: r.item.name, size: r.size, ideal: r.ideal })), base, ratio, scan.host);
    if (await copyToClipboard(css)) markCopied('scale');
    else toast(COPY_FAIL);
  };
  const tryOn = async () => {
    if (tabId == null) return;
    if (trying) {
      await undoOnPage(tabId);
      toast('The page is back as it was');
      return;
    }
    const r = await applyToPage(tabId, 'scale', rows.filter((x) => x.ideal !== x.size).map((x) => ({ selectorRole: x.item.name.replace(/-\d+$/, ''), styleId: x.item.id, name: prettyStyleName(x.item.name), size: x.ideal, lineHeight: x.item.lh != null ? Math.round(x.item.lh * x.ideal * 10) / 10 : undefined })));
    if (!r?.ok) toast('The page did not answer. Reload it and try again.');
    else toast(`Showing the ×${ratio} scale on the page`);
  };
  const again = () => {
    const svg = spinRef.current?.querySelector('svg');
    if (svg && !reduced()) svg.animate([{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }], { duration: 500, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' });
    onAgain();
  };

  return (
    <section className="section" id="sys-styles">
      <div className="ht">
        <div className="hrow">
          <h2>Type scale <span className="count">{styles.length} {styles.length === 1 ? 'style' : 'styles'}</span></h2>
          <button className="iconbtn sm tip sysagain" aria-label="Check the page again" data-tip="Check the page again" onClick={again} disabled={loading}>
            <span ref={spinRef} className="spin"><Icon icon={SysRefreshIcon} size={16} /></span>
          </button>
        </div>
        <p className="sub">The sizes this website uses, next to a tidy scale built from its body size ({fmt(base)}). Each step is {ratio}× the one before.</p>
      </div>
      <div className="ratio">
        <span className="rl" id="sys-ratio-label">How much bigger each step is</span>
        <div className="seg" role="group" aria-labelledby="sys-ratio-label">
          {CLEAN_RATIOS.map((r) => (
            <button key={r} aria-pressed={ratio === r} onClick={() => setRatio(r)}>×{r}{r === best && <span className="n">closest</span>}</button>
          ))}
        </div>
      </div>
      <div className="ctbl">
        <div className="ch" aria-hidden="true"><span>Style</span><span>This site</span><span /><span>Clean scale</span></div>
        {shown.map((r) => (
          <ScaleRow key={r.item.id} s={r.item} font={fonts.get(r.item.fontKey) ?? null} tabId={tabId} ideal={r.ideal} diff={r.diff} far={r.far} toast={toast} />
        ))}
      </div>
      {rows.length > FIRST && (
        <div>
          <button className="sysdisc" aria-expanded={all} onClick={() => setAll(!all)}>
            {all ? 'Show fewer' : `Show ${rows.length - FIRST} more`}
            <span className="chev"><Icon icon={ArrowDown01Icon} size={14} /></span>
          </button>
        </div>
      )}
      <p className="hint">
        <Icon icon={far ? Alert02Icon : Tick02Icon} size={16} />
        <span>{far ? <><b>{far} {far === 1 ? 'size is' : 'sizes are'} far from this scale</b>, marked with a dot. They would change the most.</> : 'Every size is already close to this scale.'}</span>
      </p>
      <div className="exacts">
        <button className="btn primary grow" onClick={copy}>
          <Icon icon={copied === 'scale' ? Tick02Icon : Copy01Icon} size={16} />{copied === 'scale' ? 'Copied' : 'Copy this scale'}
        </button>
        <button className="btn" aria-pressed={trying} onClick={tryOn} disabled={tabId == null}>{trying ? 'Put page back' : 'Try on page'}</button>
      </div>
    </section>
  );
}

function ScaleRow({ s, font, tabId, ideal, diff, far, toast }: { s: NamedStyle; font: PageFontUsage | null; tabId: number | null; ideal: number; diff: number; far: boolean; toast: (m: string) => void }) {
  const preview = usePreviewFamily(font ?? { family: s.family, kind: 'local', files: [] }, tabId);
  const name = prettyStyleName(s.name);
  const show = async () => {
    if (tabId == null) return;
    const r = await sendToTab<{ shown: number; cleared?: boolean }>(tabId, { type: 'ffp:highlight-issue', id: `style:${s.id}`, label: name });
    if (r && !r.shown && !r.cleared) toast('This style is not visible on the page right now');
  };
  return (
    <button className="cr" data-style={s.name} onClick={show} aria-label={`${name}: ${+s.size.toFixed(1)}px on this site, ${ideal}px on the clean scale${far ? ', far from the scale' : ''}. Show on page`}>
      <span className="cn" style={{ fontFamily: preview.css, fontWeight: Number(s.weight) || 400, fontStyle: s.style }} title={`${s.displayName} ${s.weight}`}>{name}</span>
      <span className="cy">{+s.size.toFixed(1)}px</span>
      <span className="ar" aria-hidden="true"><Icon icon={ArrowRight01Icon} size={14} /></span>
      <span className={`cs${far ? ' far' : ''}`}>
        <span className="cv">{far && <i className="fardot" aria-hidden="true" />}<b>{ideal}px</b></span>
        <small>{diffText(diff)}</small>
      </span>
    </button>
  );
}

// ------------------------------------------------------------- paste type from Figma

function FigmaPasteRow({ tabId, toast }: { tabId: number | null; toast: (m: string) => void }) {
  const [mode, setMode] = useState<'idle' | 'field' | 'busy' | 'done'>('idle');
  const [clip, setClip] = useState<FigmaTypeClip | null>(null);
  const [result, setResult] = useState<ApplyTypeReply | null>(null);
  const [bad, setBad] = useState(false);
  const owner = useAppliedOwner(tabId);
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (mode === 'field') field.current?.focus();
  }, [mode]);
  // Replaced by another part of the panel: show the row again.
  useEffect(() => {
    if (mode === 'done' && owner !== 'figma') setMode('idle');
  }, [owner, mode]);

  const apply = async (text: string) => {
    const c = parseFigmaType(text);
    if (!c) {
      setBad(true);
      setMode('field');
      return;
    }
    if (tabId == null) return;
    setBad(false);
    setClip(c);
    setMode('busy');
    const styles = figmaTypeToApply(c, (fam) => (googleFamily(fam) ? freeCssUrl(googleFamily(fam)!.family) : undefined));
    // Google fonts: the panel fetches the files, so the page's security rules cannot block them.
    const withFaces = await Promise.all(styles.map(async (st) => {
      const gf = st.family ? googleFamily(st.family) : null;
      if (!gf) return st;
      try {
        return { ...st, family: gf.family, faces: await swapFaces(gf.family), generic: gf.c === 'serif' ? 'serif' : gf.c === 'mono' ? 'monospace' : 'sans-serif' };
      } catch {
        return st;
      }
    }));
    const r = await applyToPage(tabId, 'figma', withFaces);
    if (!r?.ok) {
      toast('The page did not answer. Reload it and try again.');
      setMode('idle');
      return;
    }
    setResult(r);
    setMode('done');
  };
  const start = async () => {
    setBad(false);
    try {
      const text = await navigator.clipboard.readText();
      if (text && parseFigmaType(text)) return apply(text);
    } catch {
      /* no clipboard access: paste into the field instead */
    }
    setMode('field');
  };
  const undo = async () => {
    if (tabId != null) await undoOnPage(tabId);
    setMode('idle');
    setResult(null);
    toast('The page is back as it was');
  };

  if (mode === 'done' && clip && result) {
    const missed = result.applied.filter((a) => !a.count).length;
    return (
      <section className="section figpaste" id="sys-figma-paste">
        <div className="ht">
          <h2>{clip.name}</h2>
          <p className="sub">Type from Figma, on this page now. {missed ? `${missed} ${missed === 1 ? 'style has' : 'styles have'} nothing to land on here.` : 'Every style found a place.'}</p>
        </div>
        <div className="landed">
          {clip.styles.map((s, i) => {
            const a = s.role === 'none' ? null : result.applied.find((x) => x.name === s.name && x.role === s.role);
            return (
              <div key={i} className="lrow2">
                <span className="nm"><b>{s.name}</b><small>{s.family} {s.weight} · {s.size}px</small></span>
                <span className="where">{!a ? 'Not applied' : a.count ? `${s.role === 'body' ? 'Body text' : s.role === 'label' ? 'Labels' : s.role.toUpperCase()} · ${a.count}` : `No ${s.role === 'body' ? 'body text' : s.role} here`}</span>
                {a && !a.fontLoaded && <span className="warnnote">Font not found, so a stand-in shows</span>}
              </div>
            );
          })}
        </div>
        <div className="exacts">
          <button className="btn primary grow" onClick={undo}>Put page back</button>
        </div>
      </section>
    );
  }
  if (mode === 'field' || mode === 'busy') {
    return (
      <section className="section figpaste" id="sys-figma-paste">
        <div className="ht">
          <div className="hrow">
            <h2>Paste type from Figma</h2>
            <button className="iconbtn sm" aria-label="Close" onClick={() => setMode('idle')}><Icon icon={Cancel01Icon} size={16} /></button>
          </div>
          <p className="sub">In the Font Finder Plus Figma plugin, choose See it on the web. Then paste here.</p>
        </div>
        <input
          ref={field}
          className="field"
          aria-label="Paste type from Figma"
          placeholder={mode === 'busy' ? 'Putting it on the page…' : 'Paste here'}
          disabled={mode === 'busy'}
          value=""
          onPaste={(e) => { e.preventDefault(); apply(e.clipboardData.getData('text')); }}
          onChange={(e) => apply(e.target.value)}
        />
        {bad && <p className="hint"><Icon icon={Alert02Icon} size={16} /><span>That is not type from the Figma plugin. Copy it again in Figma, then paste.</span></p>}
      </section>
    );
  }
  return (
    <button className="mfentry small" id="sys-figma-paste" onClick={start}>
      <span className="ic"><Icon icon={SysClipboardIcon} size={18} /></span>
      <span className="t"><b>Paste type from Figma</b><span>Try text styles from the Figma plugin on this page.</span></span>
      <span className="chev"><Icon icon={ArrowRight01Icon} size={16} /></span>
    </button>
  );
}

// ------------------------------------------------------------- readability

type Status = 'pass' | 'warn' | 'fail';

function StatusIcon({ s }: { s: Status }) {
  const label = s === 'pass' ? 'Passes' : s === 'fail' ? 'Fails' : 'Check';
  return (
    <span className={`st ${s}`} role="img" aria-label={label}>
      <Icon icon={s === 'pass' ? Tick02Icon : s === 'fail' ? Cancel01Icon : Alert02Icon} size={14} />
    </span>
  );
}

interface Check { id: string; short: string; title: string; value: string; s: Status; detail: string; show: string | null; sample?: string }

const fmtN = (n: number, d = 2) => String(+n.toFixed(d));

function readabilityChecks(system: SystemScan, styles: NamedStyle[]): Check[] {
  const m = system.measures;
  const issue = (...ids: string[]) => system.issues.find((i) => ids.includes(i.id)) ?? null;
  const st = (i: ReadabilityIssue | null): Status => (!i ? 'pass' : i.level === 'fail' ? 'fail' : 'warn');
  const body = styles.find((s) => s.name === 'body') ?? null;
  const caps = styles.filter((s) => s.transform === 'uppercase');
  const out: Check[] = [];
  const add = (id: string, short: string, value: string, i: ReadabilityIssue | null, passTitle: string, passDetail: string, show: string | null) =>
    out.push({ id, short, title: i?.title ?? passTitle, value, s: st(i), detail: i?.detail ?? passDetail, show: i ? i.id : show, sample: i?.sample });

  const c = issue('contrast');
  add('contrast', 'Contrast', m?.contrast ? `${fmtN(m.contrast.ratio, 1)}:1` : '–', c, 'Enough contrast', m?.contrast ? `All text checked has enough contrast. The lowest is ${fmtN(m.contrast.ratio, 1)}:1 (${m.contrast.text}). WCAG AA asks for 4.5:1, or 3:1 for large text.` : 'No text on a plain background to check.', m?.contrast ? 'm:contrast' : null);
  const smallest = m?.smallest ?? (styles.length ? Math.min(...styles.map((s) => s.size)) : null);
  add('small', 'Small text', smallest != null ? `${fmtN(smallest, 1)}px` : '–', issue('tiny'), 'No tiny text', `The smallest text is ${smallest != null ? fmtN(smallest, 1) : '?'}px. Text under 12px is hard to read for many people.`, 'm:small');
  add('length', 'Line length', m?.perLine ? `${m.perLine} ch` : '–', issue('long', 'short'), 'Comfortable line length', m?.perLine ? `Paragraph lines run to about ${m.perLine} characters. Between 45 and 80 is easy to follow.` : 'No long paragraphs to measure.', m?.perLine ? 'm:length' : null);
  add('body', 'Body size', body ? `${fmtN(body.size, 1)}px` : '–', issue('bodysize'), 'Body text is 16px or bigger', body ? `Body text is ${fmtN(body.size, 1)}px. 16px or more is easy to read on screens.` : 'No body text found.', body ? `style:${body.id}` : null);
  add('lh', 'Line height', body?.lh != null ? fmtN(body.lh) : body ? 'normal' : '–', issue('tight', 'loose'), 'Comfortable line height', body?.lh != null ? `Body line height is ${fmtN(body.lh)}. Around 1.4 to 1.6 is comfortable for paragraphs.` : 'Body text uses the font\'s normal line height.', body ? `style:${body.id}` : null);
  const thin = m?.thinnest ?? null;
  add('thin', 'Thin text', thin == null ? '–' : thin >= 400 ? '400+' : String(thin), issue('thin'), 'No thin text', thin == null ? 'No small text to check.' : `Small text uses weight ${thin} or heavier. Light weights fade at small sizes.`, 'm:thin');
  const capsIssue = issue('capsspace', 'caps');
  const hasCaps = caps.length > 0 || m?.capsSpacing != null || !!capsIssue;
  const capsEm = m?.capsSpacing ?? (caps.length ? Math.min(...caps.map((s) => s.em)) : null);
  add('caps', 'All caps', !hasCaps ? 'None' : capsEm != null ? `${fmtN(capsEm, 3)}em` : '–', capsIssue, hasCaps ? 'All-caps text is spaced out' : 'No all-caps text', hasCaps ? 'Short all-caps labels have some letter spacing, which helps them read.' : 'Nothing on this page is set in all caps.', hasCaps ? 'm:caps' : null);
  return out;
}

function ReadabilityCard({ system, styles, health, tabId, toast }: { system: SystemScan; styles: NamedStyle[]; health: Health; tabId: number | null; toast: (m: string) => void }) {
  const checks = useMemo(() => readabilityChecks(system, styles), [system, styles]);
  const score = health.parts.find((p) => p.id === 'readability')?.score ?? health.score;
  const fails = checks.filter((c) => c.s === 'fail').length;
  const warns = checks.filter((c) => c.s === 'warn').length;
  const passed = checks.filter((c) => c.s === 'pass').length;
  const [sel, setSel] = useState<string>(() => (checks.find((c) => c.s === 'fail') ?? checks.find((c) => c.s === 'warn') ?? checks[0]).id);
  const [on, setOn] = useState(false);
  const c = checks.find((x) => x.id === sel) ?? checks[0];
  useEffect(() => setOn(false), [sel]);
  const show = async () => {
    if (tabId == null || !c.show) return;
    const r = await sendToTab<{ shown: number; hidden: number; cleared?: boolean }>(tabId, { type: 'ffp:highlight-issue', id: c.show, label: c.title });
    setOn(!!r?.shown);
    if (r?.shown) window.setTimeout(() => setOn(false), 6000);
    if (r && !r.shown && !r.cleared) toast('These are not visible on the page right now');
  };
  return (
    <section className="section" id="sys-health">
      <div className="ht row">
        <div>
          <h2>Readability</h2>
          <p className="sub">{fails || warns ? `${fails} to fix, ${warns} to check. ` : 'Everything passes. '}Tap a check to see it.</p>
        </div>
        <div className="bigscore" aria-label={`Readability score ${score} out of 100`}><b>{score}</b><span>/100</span></div>
      </div>
      <div className="tiles" id="sys-read">
        {checks.map((x) => (
          <button key={x.id} className="tile" aria-pressed={sel === x.id} onClick={() => setSel(x.id)}>
            <span className="tp"><StatusIcon s={x.s} /><span className="v">{x.value}</span></span>
            <b>{x.short}</b>
          </button>
        ))}
        <div className="tile sum"><span className="tp"><span className="v">{passed} of {checks.length}</span></span><b>passed</b></div>
      </div>
      <div className="tdet" aria-live="polite">
        <div className="hrow"><StatusIcon s={c.s} /><b>{c.title}</b><span className="v">{c.value}</span></div>
        <p>{c.detail}</p>
        {c.sample && c.s !== 'pass' && <div className="quote">“{c.sample}”</div>}
        {c.show && (
          <div>
            <button className="btn sm" aria-pressed={on} onClick={show}><Icon icon={Target02Icon} size={16} />{on ? 'Hide outlines' : 'Show on page'}</button>
          </div>
        )}
      </div>
      <p className="readnote">Checked against WCAG 2.1 AA contrast and common reading guidelines. Text on images or gradients is not checked for contrast.</p>
    </section>
  );
}

// ------------------------------------------------------------- developer checks

const PART_TONE = (n: number) => (n >= 85 ? 'good' : n >= 65 ? 'warn' : 'bad');

function DevCard({ system, scan, health }: { system: SystemScan; scan: PageScan; health: Health }) {
  const d = useMemo(() => devSummary(system.dev, scan), [system, scan]);
  const [open, setOpen] = useState(false);
  const [fams, setFams] = useState(false);
  const [part, setPart] = useState<string | null>(null);
  const kb = Math.round(d.knownBytes / 1024);
  const formats = Object.entries(d.formats);
  const tips = d.tips.filter((t) => t.level !== 'ok').length;
  const size = d.files ? (kb ? `${kb} KB${d.unknownSizes ? '+' : ''}` : 'Size hidden') : null;
  const summary = [`${d.files} ${d.files === 1 ? 'file' : 'files'}`, size, `${tips} ${tips === 1 ? 'tip' : 'tips'}`, `health ${health.score}/100`].filter(Boolean).join(' · ');
  return (
    <section className="section" id="sys-dev">
      <button className="fold" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="t"><span className="h">Developer checks</span><span className="sub">{summary}</span></span>
        <span className="chev"><Icon icon={ArrowDown01Icon} size={18} /></span>
      </button>
      {open && (
        <div className="sysload">
          <div className="stats">
            <div className="stat"><span>Files</span><b>{d.files}</b></div>
            <div className="stat"><span>Size</span><b>{d.files ? (kb ? `${kb} KB${d.unknownSizes ? '+' : ''}` : 'Hidden') : '0'}</b></div>
            <div className="stat" title={formats.map(([f, n]) => `${f.toUpperCase()}: ${n} ${n === 1 ? 'file' : 'files'}`).join(', ')}>
              <span>Formats</span><b className="wrap">{formats.map(([f]) => f.toUpperCase()).join(' · ') || 'None'}</b>
            </div>
          </div>
          {d.unknownSizes > 0 && <p className="sub">{d.unknownSizes} {d.unknownSizes === 1 ? 'file comes' : 'files come'} from a server that hides download sizes, so the total is a minimum.</p>}
          <div className="dlist">
            {d.tips.map((t, i) => (
              <div key={i}><StatusIcon s={t.level === 'ok' ? 'pass' : 'warn'} /><p>{t.text}</p></div>
            ))}
          </div>
          {(d.families.length > 0 || system.dev.preloads.length > 0) && (
            <div className="famsbox">
              <button className="famhead" aria-expanded={fams} onClick={() => setFams(!fams)}>
                <span>Each family</span><span className="count">{d.families.length}</span><span className="grow" />
                <span className="chev"><Icon icon={ArrowDown01Icon} size={14} /></span>
              </button>
              {fams && (
                <div className="fams">
                  {d.families.map((f) => (
                    <div key={f.family} className="fam">
                      <b title={f.family}>{f.family}</b>
                      <span className="r">{f.loaded} of {f.faces} {f.faces === 1 ? 'file' : 'files'}</span>
                      <span className="d">
                        {!f.used && f.loaded === 0
                          ? 'Not used on this page'
                          : `${f.weightsLoaded.join(', ') || 'No weights loaded'} · font-display ${f.display.join(', ') || 'auto'}${!f.used ? ' · not used here' : ''}`}
                      </span>
                    </div>
                  ))}
                  {system.dev.preloads.length > 0 && (
                    <div className="fam preloads">
                      <span className="d">Preloaded: {system.dev.preloads.map((u) => u.split('/').pop()).join(', ')}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          <div className="syshealth" id="sys-parts">
            <div className="hh"><h3>Type system health</h3><span className="n">{health.score}/100 · {health.grade}</span></div>
            <p className="sub">Fonts, sizes, weights, loading and readability, from what this page uses.</p>
            <div className="sysparts">
              {health.parts.map((p) => (
                <div key={p.id} className="syspart">
                  <button className="part" aria-expanded={part === p.id} onClick={() => setPart(part === p.id ? null : p.id)}>
                    <span className="lbl">{p.label}</span>
                    <span className="bar" aria-hidden="true"><i className={PART_TONE(p.score)} style={{ width: `${p.score}%` }} /></span>
                    <span className="n">{p.score}</span>
                    <span className="chev"><Icon icon={ArrowDown01Icon} size={14} /></span>
                  </button>
                  {part === p.id && (
                    <div className="finds">
                      {p.findings.map((f, i) => (
                        <div key={i} className="find">
                          <StatusIcon s={f.level === 'ok' ? 'pass' : f.level === 'bad' ? 'fail' : 'warn'} />
                          <span>{f.text}{f.fix && <span className="muted"> {f.fix}</span>}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

// ------------------------------------------------------------- dropdown

interface DdOption<T extends string> { value: T; label: string; hint?: string }

/** A small custom listbox: a filled button that opens a menu with a subtle edge and shadow. */
export function Dropdown<T extends string>({ value, options, onChange, label, prefix }: { value: T; options: DdOption<T>[]; onChange: (v: T) => void; label: string; prefix?: string }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const cur = options.find((o) => o.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    list.current?.focus();
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  const openMenu = () => {
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    setOpen(true);
  };
  const pick = (v: T) => {
    onChange(v);
    setOpen(false);
    btn.current?.focus();
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(options.length - 1, a + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === 'Home') { e.preventDefault(); setActive(0); }
    else if (e.key === 'End') { e.preventDefault(); setActive(options.length - 1); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(options[active].value); }
    else if (e.key === 'Escape' || e.key === 'Tab') { setOpen(false); if (e.key === 'Escape') btn.current?.focus(); }
  };

  return (
    <div className="sysdd" data-open={open || undefined} ref={wrap}>
      <button
        ref={btn}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label}: ${cur?.label ?? ''}`}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={(e) => { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); openMenu(); } }}
      >
        <span className="val">{prefix && <span className="pre">{prefix}</span>}<span className="txt">{cur?.label}</span></span>
        <span className="chev"><Icon icon={ArrowDown01Icon} size={16} /></span>
      </button>
      {open && (
        <ul role="listbox" aria-label={label} tabIndex={-1} ref={list} onKeyDown={onKey} aria-activedescendant={`${label}-${active}`.replace(/\W+/g, '-')}>
          {options.map((o, i) => (
            <li
              key={o.value}
              id={`${label}-${i}`.replace(/\W+/g, '-')}
              role="option"
              aria-selected={o.value === value}
              data-active={i === active || undefined}
              onPointerEnter={() => setActive(i)}
              onClick={() => pick(o.value)}
            >
              <span className="txt">{o.label}</span>
              {o.value === value ? <Icon icon={Tick02Icon} size={14} /> : o.hint ? <span className="hint">{o.hint}</span> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ------------------------------------------------------------- export (one dropdown, Copy and Download)

type ExportChoice = ExportFormat | 'figma';

function ExportCard({ styles, scan, system, tabId, toast }: { styles: NamedStyle[]; scan: PageScan; system: SystemScan; tabId: number | null; toast: (m: string) => void }) {
  const [format, setFormat] = useState<ExportChoice>('css');
  const [copied, markCopied] = useCopied();
  const [busy, setBusy] = useState(false);
  const meta = format === 'figma' ? null : EXPORTS.find((e) => e.id === format)!;
  const text = useMemo(() => (format === 'figma' ? '' : exportSystem(format, styles, scan.host)), [format, styles, scan.host]);

  const figma = async (): Promise<string | null> => {
    if (tabId == null) return null;
    setBusy(true);
    try {
      return (await buildFigmaPayload(scan, tabId, system)).text;
    } catch {
      toast('Could not prepare the fonts for Figma. Check the page again and retry.');
      return null;
    } finally {
      setBusy(false);
    }
  };
  const copy = async () => {
    const t = format === 'figma' ? await figma() : text;
    if (t == null) return;
    if (await copyToClipboard(t)) {
      markCopied('code');
      if (format === 'figma') toast('Copied. In Figma, open the Font Finder Plus plugin and paste.');
    } else toast(COPY_FAIL);
  };
  const download = async () => {
    const t = format === 'figma' ? await figma() : text;
    if (t == null) return;
    const file = format === 'figma' ? 'figma-type-system.txt' : meta!.file;
    const url = URL.createObjectURL(new Blob([t], { type: format === 'tokens' ? 'application/json' : 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = file;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast(`Downloaded ${file}`);
  };
  const options = [...EXPORTS.map((e) => ({ value: e.id as ExportChoice, label: e.label, hint: e.file })), { value: 'figma' as ExportChoice, label: 'Figma (Font Finder Plus plugin)', hint: 'Paste in the plugin' }];
  return (
    <section className="section" id="sys-export">
      <div className="ht">
        <h2>Use this type system</h2>
        <p className="sub">Copy it as code, or paste it into a design tool.</p>
      </div>
      <Dropdown<ExportChoice> label="Export format" value={format} onChange={setFormat} options={options} />
      {format === 'figma' ? (
        <div className="figsteps">
          <ol>
            <li>Copy for Figma below.</li>
            <li>In Figma, run the Font Finder Plus plugin.</li>
            <li>Paste. You get {styles.length} text {styles.length === 1 ? 'style' : 'styles'}, and each font with its licence and closest free stand-in.</li>
          </ol>
        </div>
      ) : (
        <>
          <p className="exnote">{meta!.note}</p>
          <pre className="code" tabIndex={0} aria-label={`${meta!.label} code`}>{text}</pre>
        </>
      )}
      <div className="exacts">
        <button className="btn primary grow" onClick={copy} disabled={busy || (format === 'figma' && tabId == null)}>
          <Icon icon={copied === 'code' ? Tick02Icon : format === 'figma' ? FigmaIcon : Copy01Icon} size={16} />
          {busy ? 'Preparing…' : copied === 'code' ? 'Copied' : format === 'figma' ? 'Copy for Figma' : 'Copy'}
        </button>
        <button className="btn" onClick={download} disabled={busy}><Icon icon={Download01Icon} size={16} />Download</button>
      </div>
    </section>
  );
}

// ------------------------------------------------------------- compare

interface Saved { scan: PageScan; system: SystemScan | null; savedAt: number }

function CompareCard({ tabId, scan, system, styles }: { tabId: number | null; scan: PageScan; system: SystemScan; styles: NamedStyle[] }) {
  const [others, setOthers] = useState<{ tabId: number; title: string; saved: Saved }[]>([]);
  const [pick, setPick] = useState<string>('');
  const [open, setOpen] = useState(false);
  useEffect(() => {
    (async () => {
      const all = await chrome.storage.session.get(null);
      const tabs = await chrome.tabs.query({});
      const openTabs = new Map(tabs.map((t) => [t.id, t]));
      const list = Object.entries(all)
        .filter(([k]) => k.startsWith('compare:'))
        .map(([k, v]) => ({ tabId: Number(k.slice(8)), saved: v as Saved }))
        .filter((o) => o.tabId !== tabId && openTabs.has(o.tabId) && o.saved?.scan)
        .map((o) => ({ ...o, title: openTabs.get(o.tabId)?.title ?? o.saved.scan.host }));
      setOthers(list);
      if (list.length && !pick) setPick(String(list[0].tabId));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId]);
  const other = others.find((o) => String(o.tabId) === pick) ?? null;
  return (
    <section className="section syscompare" id="sys-compare">
      <button className="fold" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="lead"><Icon icon={SysArrowReloadIcon} size={18} /></span>
        <span className="t"><span className="h">Compare with another tab</span><span className="sub">See this page's type next to another site.</span></span>
        <span className="chev"><Icon icon={ArrowDown01Icon} size={18} /></span>
      </button>
      {open && (!others.length ? (
        <p className="sub">Open another site in a new tab and click the Font Finder Plus icon there (or switch to it with the panel open). It then appears here to compare with this page.</p>
      ) : (
        <>
          <Dropdown
            label="Tab to compare with"
            prefix="With"
            value={pick}
            onChange={setPick}
            options={others.map((o) => ({ value: String(o.tabId), label: o.saved.scan.host === scan.host ? `${o.title}`.slice(0, 60) : o.saved.scan.host, hint: o.saved.scan.host === scan.host ? undefined : o.title.slice(0, 40) }))}
          />
          {other && <Comparison a={{ scan, system, styles }} b={other.saved} />}
        </>
      ))}
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
    return sc.ratio ? `${sc.ratio}, ${sc.label?.toLowerCase()}` : 'No single scale';
  };
  const readText = (n: number) => (n ? `${n} to look at` : 'All clear');
  const same = a.scan.host === b.scan.host;
  const ha = 'This page';
  const title = b.scan.title || 'Other tab';
  const hb = same ? (title.length > 32 ? `${title.slice(0, 31).trimEnd()}…` : title) : b.scan.host;
  const rows: [string, string, string][] = [
    ['Fonts', String(aFonts.length), String(bFonts.length)],
    ['Body text', fmt(body(a.styles)), b.system ? fmt(body(bStyles)) : 'Open System on that tab once'],
    ['Main heading', fmt(h1(a.styles)), b.system ? fmt(h1(bStyles)) : '…'],
    ['Text styles', String(a.styles.length), b.system ? String(bStyles.length) : '…'],
    ['Size scale', scaleText(a.styles), b.system ? scaleText(bStyles) : '…'],
    ['Readability', readText(a.system.issues.length), b.system ? readText(b.system.issues.length) : '…'],
  ];
  const mark = (yes: boolean) => (yes ? <span className="yes" role="img" aria-label="Yes"><Icon icon={Tick02Icon} size={14} /></span> : <span className="no" role="img" aria-label="No">–</span>);
  return (
    <>
      <table className="cmp">
        <thead><tr><th /><th>{ha}</th><th>{hb}</th></tr></thead>
        <tbody>
          {rows.map(([k, x, y]) => <tr key={k}><td>{k}</td><td>{x}</td><td>{y}</td></tr>)}
        </tbody>
      </table>
      <table className="cmp">
        <thead><tr><th>Font</th><th>{ha}</th><th>{hb}</th></tr></thead>
        <tbody>
          {allFonts.map((f) => <tr key={f}><td className="fname">{f}</td><td>{mark(aFonts.includes(f))}</td><td>{mark(bFonts.includes(f))}</td></tr>)}
        </tbody>
      </table>
    </>
  );
}
