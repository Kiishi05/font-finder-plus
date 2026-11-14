import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { declarationCss } from '../../shared/css';
import { Alert02Icon, ArrowDown01Icon, Copy01Icon, Download01Icon, FigmaIcon, SysRefreshIcon, SysTextFontIcon, Target02Icon, Tick02Icon } from '../../shared/icons';
import { sendToTab } from '../../shared/messages';
import type { PageFontUsage, PageScan, ReadabilityIssue, SystemScan } from '../../shared/types';
import { Icon } from '../components/Icon';
import { copyToClipboard, usePageScan, useSystemScan, type TabState } from '../lib/hooks';
import { usePreviewFamily } from '../lib/preview';
import { buildFigmaPayload } from '../lib/figma';
import { healthCheck } from '../lib/health';
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

const NAV: [string, string][] = [
  ['sys-health', 'Health'],
  ['sys-styles', 'Styles'],
  ['sys-read', 'Readability'],
  ['sys-dev', 'Fonts'],
  ['sys-export', 'Export'],
];

const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

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

export function SystemView({ tab, toast }: Props) {
  const ready = !!tab.ping;
  const { scan } = usePageScan(tab.tabId, ready, tab.ping?.url, tab.fontsVersion);
  const { system, loading, error, rerun } = useSystemScan(tab.tabId, ready, tab.ping?.url, scan, tab.fontsVersion);
  const styles = useMemo(() => (system ? nameStyles(system.styles) : []), [system]);

  if (!ready) {
    return (
      <section className="empty">
        <span className="eic"><Icon icon={SysTextFontIcon} size={22} /></span>
        <div className="et">
          <h2>Check a page's type system</h2>
          <p>Click the Font Finder Plus icon on a page. This tab then shows its text styles, a health score, readability checks and exports for CSS, Tailwind and Figma.</p>
        </div>
      </section>
    );
  }

  const again = async () => {
    await rerun();
  };

  return (
    <div className="sys">
      {loading && !system && <div className="notice neutral">Reading the page's text styles…</div>}
      {error && <div className="notice amber"><Icon icon={Alert02Icon} size={15} />{error}</div>}
      {system && scan && (
        <>
          <HealthCard styles={styles} scan={scan} system={system} toast={toast} onAgain={again} loading={loading} />
          <StylesCard styles={styles} scan={scan} tabId={tab.tabId} toast={toast} />
          <ReadabilityCard issues={system.issues} tabId={tab.tabId} toast={toast} />
          <DevCard system={system} scan={scan} />
          <UseCard styles={styles} scan={scan} system={system} tabId={tab.tabId} toast={toast} />
          <CompareCard tabId={tab.tabId} scan={scan} system={system} styles={styles} />
          <FloatNav />
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------- floating section tabs

function FloatNav() {
  const [cur, setCur] = useState(NAV[0][0]);
  const navRef = useRef<HTMLElement>(null);
  const hlRef = useRef<HTMLSpanElement>(null);
  const lock = useRef<{ id: string; until: number } | null>(null);

  const sync = useCallback(() => {
    const line = window.innerHeight * 0.33;
    let next = NAV[0][0];
    for (const [id] of NAV) {
      const el = document.getElementById(id);
      if (el && el.getBoundingClientRect().top <= line) next = id;
    }
    if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) next = NAV[NAV.length - 1][0];
    if (lock.current && Date.now() < lock.current.until) next = lock.current.id;
    setCur(next);
  }, []);

  useEffect(() => {
    sync();
    const end = () => {
      lock.current = null;
      sync();
    };
    window.addEventListener('scroll', sync, { passive: true });
    window.addEventListener('resize', sync);
    window.addEventListener('scrollend', end);
    return () => {
      window.removeEventListener('scroll', sync);
      window.removeEventListener('resize', sync);
      window.removeEventListener('scrollend', end);
    };
  }, [sync]);

  useLayoutEffect(() => {
    const b = navRef.current?.querySelector<HTMLButtonElement>(`[data-jump="${cur}"]`);
    const hl = hlRef.current;
    if (!b || !hl) return;
    hl.style.width = `${b.offsetWidth}px`;
    hl.style.transform = `translateX(${b.offsetLeft}px)`;
  }, [cur]);

  const jump = (id: string) => {
    lock.current = { id, until: Date.now() + 1200 };
    setCur(id);
    document.getElementById(id)?.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' });
  };

  return (
    <nav className="sysnav" aria-label="Sections" ref={navRef}>
      <span className="hl" aria-hidden="true" ref={hlRef} />
      {NAV.map(([id, label]) => (
        <button key={id} data-jump={id} aria-current={cur === id} onClick={() => jump(id)}>{label}</button>
      ))}
    </nav>
  );
}

// ------------------------------------------------------------- health

const PART_TONE = (n: number) => (n >= 85 ? 'good' : n >= 65 ? 'warn' : 'bad');
const FIND_LABEL = { bad: 'Fix', warn: 'Check', tip: 'Tip', ok: 'Good' } as const;
const FIND_TONE = { bad: 'bad', warn: 'warn', tip: 'neutral', ok: 'good' } as const;

function HealthCard({ styles, scan, system, toast, onAgain, loading }: { styles: NamedStyle[]; scan: PageScan; system: SystemScan; toast: (m: string) => void; onAgain: () => Promise<void>; loading: boolean }) {
  const health = useMemo(() => healthCheck({ scan, styles, issues: system.issues, dev: devSummary(system.dev, scan), scale: detectScale(styles) }), [scan, styles, system]);
  const [open, setOpen] = useState<string | null>(null);
  const [copied, markCopied] = useCopied();
  const spinRef = useRef<HTMLSpanElement>(null);
  const report = () =>
    [`Type system health for ${scan.host}: ${health.score}/100 (${health.grade})`, '', ...health.parts.flatMap((p) => [`${p.label}: ${p.score}/100`, ...p.findings.map((f) => `  - ${f.text}${f.fix ? ` ${f.fix}` : ''}`), ''])].join('\n');
  const again = () => {
    const svg = spinRef.current?.querySelector('svg');
    if (svg && !reduced()) svg.animate([{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }], { duration: 500, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' });
    onAgain();
  };
  const copy = async () => {
    if (await copyToClipboard(report())) markCopied('report');
    else toast('Could not copy. Click the panel first, then try again.');
  };
  return (
    <section className="section" id="sys-health">
      <div className="sechead syshead">
        <h2>Type system check</h2>
        <button className="iconbtn sm tip sysagain" aria-label="Check the page again" data-tip="Check the page again" onClick={again} disabled={loading}>
          <span ref={spinRef} className="spin"><Icon icon={SysRefreshIcon} size={16} /></span>
        </button>
      </div>
      <div className="sysscore">
        <div className={`num ${PART_TONE(health.score)}`} aria-label={`Score ${health.score} out of 100`}>
          <b>{health.score}</b><small>/100</small>
        </div>
        <div className="txt">
          <b>{health.grade}</b>
          <span className="sub">Fonts, sizes, weights, loading and readability, from what this page uses.</span>
        </div>
      </div>
      <div className="sysparts">
        {health.parts.map((p) => (
          <div key={p.id} className="syspart">
            <button className="part" aria-expanded={open === p.id} onClick={() => setOpen(open === p.id ? null : p.id)}>
              <span className="lbl">{p.label}</span>
              <span className="bar" aria-hidden="true"><i className={PART_TONE(p.score)} style={{ width: `${p.score}%` }} /></span>
              <span className="n">{p.score}</span>
              <span className="chev"><Icon icon={ArrowDown01Icon} size={14} /></span>
            </button>
            {open === p.id && (
              <div className="finds">
                {p.findings.map((f, i) => (
                  <div key={i} className="find">
                    <span className={`pill ${FIND_TONE[f.level]}`}>{FIND_LABEL[f.level]}</span>
                    <span>{f.text}{f.fix && <span className="muted"> {f.fix}</span>}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      <div>
        <button className="btn sm" onClick={copy}>
          <Icon icon={copied === 'report' ? Tick02Icon : Copy01Icon} size={14} />{copied === 'report' ? 'Copied' : 'Copy report'}
        </button>
      </div>
    </section>
  );
}

// ------------------------------------------------------------- styles

const FIRST = 5;

function StylesCard({ styles, scan, tabId, toast }: { styles: NamedStyle[]; scan: PageScan; tabId: number | null; toast: (m: string) => void }) {
  const [all, setAll] = useState(false);
  const [copied, markCopied] = useCopied();
  const scale = useMemo(() => detectScale(styles), [styles]);
  const fonts = useMemo(() => new Map(scan.fonts.map((f) => [f.key, f])), [scan]);
  const shown = all ? styles : styles.slice(0, FIRST);
  return (
    <section className="section" id="sys-styles">
      <div className="sechead"><h2>Type styles <span className="count">{styles.length}</span></h2></div>
      <div className="scalebox">
        {scale.ratio ? (
          <span title={`${scale.fits} of ${scale.total} other sizes fit`}><b>{scale.label} scale</b> ({scale.ratio}) from a {scale.base}px base</span>
        ) : (
          <span><b>No single size scale.</b> {scale.total < 2 ? 'Too few different sizes to tell.' : 'The sizes do not follow one ratio.'}</span>
        )}
        <span className="sizes">{scale.sizes.join(' · ')} px</span>
      </div>
      <div className="styles">
        {shown.map((s) => (
          <StyleRow key={s.id} s={s} font={fonts.get(s.fontKey) ?? null} tabId={tabId} copied={copied === s.id} onCopied={() => markCopied(s.id)} toast={toast} />
        ))}
      </div>
      {styles.length > FIRST && (
        <div>
          <button className="sysdisc" aria-expanded={all} onClick={() => setAll(!all)}>
            {all ? 'Show fewer' : `Show ${styles.length - FIRST} more`}
            <span className="chev"><Icon icon={ArrowDown01Icon} size={14} /></span>
          </button>
        </div>
      )}
    </section>
  );
}

const SAMPLE_CAP = 36;

function StyleRow({ s, font, tabId, copied, onCopied, toast }: { s: NamedStyle; font: PageFontUsage | null; tabId: number | null; copied: boolean; onCopied: () => void; toast: (m: string) => void }) {
  const preview = usePreviewFamily(font ?? { family: s.family, kind: 'local', files: [] }, tabId);
  const css = declarationCss(s.declared, { fontSize: s.size, fontWeight: s.weight, fontStyle: s.style, lineHeight: s.lineHeight == null ? 'normal' : `${s.lineHeight}px`, letterSpacing: s.letterSpacing ? `${s.letterSpacing}px` : 'normal', color: '' }, s.family);
  const copy = async () => {
    if (await copyToClipboard(css)) onCopied();
    else toast('Could not copy. Click the panel first, then try again.');
  };
  return (
    <div className="stylerow">
      <div className="top">
        <span className="tagname">{s.name}</span>
        <span className="who">{s.displayName} · {s.weight}{s.style !== 'normal' ? ' italic' : ''}</span>
        <button className={`iconbtn sm tip${copied ? ' copied' : ''}`} aria-label={`Copy CSS for ${s.name}`} data-tip={copied ? 'Copied' : 'Copy CSS'} onClick={copy}>
          <Icon icon={copied ? Tick02Icon : Copy01Icon} size={16} />
        </button>
      </div>
      <div className="stylesample" dir="auto" style={{ fontFamily: preview.css, fontSize: Math.min(s.size, SAMPLE_CAP), fontWeight: Number(s.weight) || 400, fontStyle: s.style, letterSpacing: s.em ? `${s.em}em` : undefined, textTransform: s.transform as React.CSSProperties['textTransform'] }}>
        {s.sample || s.name}
      </div>
      <span className="meta">
        {s.size}px / {s.lineHeight == null ? 'normal' : `${s.lineHeight}px`} · tracking {s.em ? `${s.em}em` : '0'}{s.transform !== 'none' ? ` · ${s.transform}` : ''} · used {s.count}×
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
      <div className="sechead"><h2>Readability <span className="count">{issues.length ? `${issues.length} to look at` : 'All clear'}</span></h2></div>
      {!issues.length && <p className="sub">No problems found with text size, line height, line length or contrast.</p>}
      {issues.length > 0 && (
        <div className="issues">
          {issues.map((i) => (
            <div key={i.id} className="issue on-grey">
              <div className="top">
                <span className={`pill ${LEVEL[i.level].tone}`}>{LEVEL[i.level].text}</span>
                <b>{i.title} <span>({i.count})</span></b>
              </div>
              <p>{i.detail}</p>
              <div className="quote">“{i.sample}”</div>
              <button className="btn sm" aria-pressed={on === i.id} onClick={() => show(i)}>
                <Icon icon={Target02Icon} size={14} />{on === i.id ? 'Hide outlines' : 'Show on page'}
              </button>
            </div>
          ))}
        </div>
      )}
      <p className="readnote">Checked against WCAG 2.1 AA contrast and common reading guidelines. Text on images or gradients is not checked for contrast.</p>
    </section>
  );
}

// ------------------------------------------------------------- fonts and loading

function DevCard({ system, scan }: { system: SystemScan; scan: PageScan }) {
  const d = useMemo(() => devSummary(system.dev, scan), [system, scan]);
  const [open, setOpen] = useState(false);
  const kb = Math.round(d.knownBytes / 1024);
  const formats = Object.entries(d.formats);
  const tone = (l: string) => (l === 'warn' ? 'warn' : l === 'ok' ? 'good' : 'neutral');
  const label = (l: string) => (l === 'warn' ? 'Check' : l === 'ok' ? 'Good' : 'Tip');
  return (
    <section className="section" id="sys-dev">
      <div className="sechead"><h2>Fonts and loading</h2></div>
      <div className="sysload">
        <div className="stats">
          <div className="stat"><span>Files</span><b>{d.files}</b></div>
          <div className="stat"><span>Size</span><b>{d.files ? (kb ? `${kb} KB${d.unknownSizes ? '+' : ''}` : 'Hidden') : '0'}</b></div>
          <div className="stat" title={formats.map(([f, n]) => `${f.toUpperCase()}: ${n} ${n === 1 ? 'file' : 'files'}`).join(', ')}>
            <span>Formats</span><b className="wrap">{formats.map(([f]) => f.toUpperCase()).join(' · ') || 'None'}</b>
          </div>
        </div>
        {d.unknownSizes > 0 && <p className="sub">{d.unknownSizes} {d.unknownSizes === 1 ? 'file comes' : 'files come'} from a server that hides download sizes, so the total is a minimum.</p>}
        <div className="tips">
          {d.tips.map((t, i) => (
            <div key={i} className="find">
              <span className={`pill ${tone(t.level)}`}>{label(t.level)}</span>
              <span>{t.text}</span>
            </div>
          ))}
        </div>
        {(d.families.length > 0 || system.dev.preloads.length > 0) && (
          <div className="famsbox">
            <button className="famhead" aria-expanded={open} onClick={() => setOpen(!open)}>
              <span>Each family</span><span className="count">{d.families.length}</span><span className="grow" />
              <span className="chev"><Icon icon={ArrowDown01Icon} size={14} /></span>
            </button>
            {open && (
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
      </div>
    </section>
  );
}

// ------------------------------------------------------------- dropdown

interface DdOption<T extends string> { value: T; label: string; hint?: string }

/** A small custom listbox: a filled button that opens a menu with a subtle edge and shadow. */
function Dropdown<T extends string>({ value, options, onChange, label, prefix }: { value: T; options: DdOption<T>[]; onChange: (v: T) => void; label: string; prefix?: string }) {
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
        <span className="chev"><Icon icon={ArrowDown01Icon} size={14} /></span>
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

// ------------------------------------------------------------- use this type system (Figma + export)

function UseCard({ styles, scan, system, tabId, toast }: { styles: NamedStyle[]; scan: PageScan; system: SystemScan; tabId: number | null; toast: (m: string) => void }) {
  const [format, setFormat] = useState<ExportFormat>('css');
  const [copied, markCopied] = useCopied();
  const [busy, setBusy] = useState(false);
  const meta = EXPORTS.find((e) => e.id === format)!;
  const text = useMemo(() => exportSystem(format, styles, scan.host), [format, styles, scan.host]);

  // Same behaviour as the SendToFigma component, with a full width button and a Copied state.
  const sendFigma = async () => {
    if (tabId == null) return;
    setBusy(true);
    try {
      const { text: payloadText, payload } = await buildFigmaPayload(scan, tabId, system);
      if (await copyToClipboard(payloadText)) {
        markCopied('figma');
        toast(`Copied ${payload.fonts.length} fonts and ${payload.styles.length} styles. In Figma, open the Font Finder Plus plugin and paste.`);
      } else toast('Could not copy. Click the panel first, then try again.');
    } catch {
      toast('Could not prepare the fonts for Figma. Scan the page again and retry.');
    } finally {
      setBusy(false);
    }
  };
  const copyCode = async () => {
    if (await copyToClipboard(text)) markCopied('code');
    else toast('Could not copy. Click the panel first, then try again.');
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: format === 'tokens' ? 'application/json' : 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = meta.file;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast(`Downloaded ${meta.file}`);
  };
  return (
    <section className="section" id="sys-export">
      <div className="sechead"><h2>Use this type system</h2></div>
      <div className="figrow" id="sys-figma">
        <div className="t">
          <b>Send to Figma</b>
          <span>Copies {styles.length} text {styles.length === 1 ? 'style' : 'styles'} and every font with its licence, where to get it and the closest free stand-in. In Figma, run the Font Finder Plus plugin and paste.</span>
        </div>
        <button className="btn primary wide" onClick={sendFigma} disabled={busy || tabId == null}>
          <Icon icon={copied === 'figma' ? Tick02Icon : FigmaIcon} size={16} />
          {busy ? 'Preparing…' : copied === 'figma' ? 'Copied' : 'Copy for Figma'}
        </button>
      </div>
      <div className="hair" />
      <div className="sysexport">
        <h3>Export as code</h3>
        <Dropdown<ExportFormat> label="Export format" value={format} onChange={setFormat} options={EXPORTS.map((e) => ({ value: e.id, label: e.label, hint: e.file }))} />
        <p className="exnote">{meta.note}</p>
        <pre className="code" tabIndex={0} aria-label={`${meta.label} code`}>{text}</pre>
        <div className="exacts">
          <button className="btn sm primary" onClick={copyCode}>
            <Icon icon={copied === 'code' ? Tick02Icon : Copy01Icon} size={14} />{copied === 'code' ? 'Copied' : 'Copy'}
          </button>
          <button className="btn sm" onClick={download} title={meta.file}><Icon icon={Download01Icon} size={14} />Download</button>
        </div>
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
    <section className="section syscompare" id="sys-compare">
      <div className="sechead"><h2>Compare with another tab</h2></div>
      {!others.length ? (
        <p className="sub">Open another site in a new tab and click the Font Finder Plus icon there (or switch to it with the panel open). It then appears here to compare with this page.</p>
      ) : (
        <>
          <p className="sub">Puts this page's type next to another site you have open. Open Font Finder Plus on that tab once and it shows up here.</p>
          <Dropdown
            label="Tab to compare with"
            prefix="With"
            value={pick}
            onChange={setPick}
            options={others.map((o) => ({ value: String(o.tabId), label: o.saved.scan.host === scan.host ? `${o.title}`.slice(0, 60) : o.saved.scan.host, hint: o.saved.scan.host === scan.host ? undefined : o.title.slice(0, 40) }))}
          />
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
