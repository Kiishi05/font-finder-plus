// The plugin window. Reads a paste from Font Finder Plus, shows each font with
// whether this Figma has it, and sends the choices to the plugin code.
// Screens: paste, fonts, creating, done.
import {
  ArrowDown01Icon,
  ArrowUpRight01Icon,
  ClipboardIcon,
  File01Icon,
  RefreshIcon,
  SecurityLockIcon,
  TextFontIcon,
  Tick02Icon,
  VariableIcon,
} from '@hugeicons/core-free-icons';
import { parsePayload, type FigmaFont, type FigmaPayload } from '../../src/shared/figma-payload';

type IconNode = [string, Record<string, string>][];
const icon = (node: unknown, size = 16) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" aria-hidden="true">${(node as IconNode)
    .map(([tag, a]) => `<${tag} ${Object.entries(a).filter(([k]) => k !== 'key').map(([k, v]) => `${k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())}="${v}"`).join(' ')}/>`)
    .join('')}</svg>`;

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const post = (msg: Record<string, unknown>) => parent.postMessage({ pluginMessage: msg }, '*');
const isMac = /Mac/.test(navigator.platform);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

type Status = Record<string, { real: string | null; standIns: Record<string, boolean> }>;
type Screen = 'start' | 'fonts' | 'creating' | 'done';
interface Built { styles: number; variables: number; page: string | null; missing: string[] }
interface Step { id: 'fonts' | 'vars' | 'styles' | 'page'; label: string }

let screen: Screen = 'start';
let payload: FigmaPayload | null = null;
let status: Status | null = null;
const choice = new Map<string, string | null>();
let saved = 0;
let tab: 'missing' | 'ready' = 'missing';
let openKey: string | null = null; // the font whose Details are open
let ddKey: string | null = null; // the font whose stand-in menu is open
let manual = false; // the paste box is showing
let checking = false; // a Check again is running
const opts = { styles: true, variables: true, specimen: true };
let steps: Step[] = [];
let stepNow = 0;
let built: Built | null = null;

// ------------------------------------------------------------- helpers

const LIC: Record<string, [string, string]> = {
  OFL: ['free', 'Free'], APACHE: ['free', 'Free'], UFL: ['free', 'Free'], 'free-other': ['free', 'Free'],
  commercial: ['paid', 'Paid'], system: ['system', 'System'],
};
const licBadge = (f: FigmaFont) => {
  const [cls, label] = LIC[f.licence.type] ?? ['unknown', 'Unknown'];
  return `<span class="lic ${cls}"><i></i>${label}</span>`;
};

function previewHtml(f: FigmaFont) {
  if (f.preview?.kind === 'svg') return `<img class="pv" alt="${esc(f.name)} drawn in the font" src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(f.preview.svg)}">`;
  if (f.preview?.kind === 'png') return `<img class="pv" alt="${esc(f.name)} drawn in the font" src="${esc(f.preview.data)}">`;
  return `<span class="pv none">No preview: the font file could not be read.</span>`;
}

const lookAlikes = (f: FigmaFont) => {
  const seen = new Set<string>();
  return [f.standIn, ...f.alternatives].filter((a): a is { family: string; score: number } => !!a && !seen.has(a.family) && !!seen.add(a.family));
};

/** The stand-in in use: the one picked, else the first look-alike this Figma has. */
function currentStandIn(f: FigmaFont): string | null {
  const st = status?.[f.key];
  if (!st) return null;
  if (!choice.has(f.key)) choice.set(f.key, lookAlikes(f).find((o) => st.standIns[o.family])?.family ?? null);
  return choice.get(f.key) ?? null;
}

const ready = () => (payload && status ? payload.fonts.filter((f) => status![f.key]?.real) : []);
const missing = () => (payload && status ? payload.fonts.filter((f) => !status![f.key]?.real) : []);

function render() {
  const sc = document.querySelector('.scroll');
  const y = sc ? sc.scrollTop : 0;
  $('main').innerHTML = screen === 'start' ? startHtml() : screen === 'fonts' ? fontsHtml() : screen === 'creating' ? creatingHtml() : doneHtml();
  document.body.classList.toggle('has-foot', screen === 'fonts');
  const n = document.querySelector('.scroll');
  if (n) n.scrollTop = y;
}

function go(s: Screen) {
  screen = s;
  openKey = null;
  ddKey = null;
  render();
  const n = document.querySelector('.scroll');
  if (n) n.scrollTop = 0;
  if (s === 'start') $('paste')?.focus();
}

const recheckBtn = () => `<button class="btn wide2" id="recheck"${checking ? ' disabled' : ''}>${icon(RefreshIcon)}${checking ? 'Checking…' : 'Check again'}</button>`;

// ------------------------------------------------------------- screens

function startHtml() {
  return `
  <div class="scroll">
    <section class="card">
      <div class="ph"><h2>Bring a website's type into Figma</h2><p>Text styles, variables and a specimen page, from any site you check with Font Finder Plus.</p></div>
      <button class="paste" id="paste" aria-label="Paste from Font Finder Plus">
        <span class="pic">${icon(ClipboardIcon, 28)}</span>
        <b>Paste from Font Finder Plus</b>
        <span class="faint">Press <kbd>${isMac ? '⌘' : 'Ctrl'}</kbd> <kbd>V</kbd> anywhere in this window</span>
      </button>
      <ol class="steps">
        <li><span class="n">1</span><span>In Chrome, open a website and click the Font Finder Plus icon</span></li>
        <li><span class="n">2</span><span>Click <b>Copy for Figma</b> on the Page or System tab</span></li>
        <li><span class="n">3</span><span>Come back here and paste</span></li>
      </ol>
      ${manual ? '<textarea id="manual" aria-label="Paste here" placeholder="Paste into this box"></textarea>' : '<button class="link" id="showmanual">Paste into a box instead</button>'}
    </section>
    ${saved ? `<section class="card recheck">
      <div><b>${plural(saved, 'text style')} in this file ${saved === 1 ? 'uses a stand-in' : 'use stand-ins'}</b><p>If you have installed the real fonts since, Check again swaps them into those text styles.</p></div>
      ${recheckBtn()}
    </section>` : ''}
    <p class="note">${icon(SecurityLockIcon, 14)}<span>Nothing leaves your computer. This plugin makes no network requests.</span></p>
  </div>`;
}

function standHtml(f: FigmaFont) {
  const st = status![f.key];
  const opts = lookAlikes(f);
  if (!opts.length) return `<div class="stand"><span class="sub">No free look-alike found. Inter will stand in.</span></div>`;
  const current = currentStandIn(f);
  if (!current) {
    return `<div class="stand"><span class="sub">Its free look-alikes (${opts.map((o) => esc(o.family)).join(', ')}) are not in this Figma. A similar ${f.classification === 'mono' ? 'monospace' : f.classification === 'serif' ? 'serif' : 'sans serif'} font Figma has will stand in.</span></div>`;
  }
  const cur = opts.find((o) => o.family === current);
  const open = ddKey === f.key;
  return `<div class="stand">
    <span class="sl">Stands in with</span>
    <div class="dd">
      <button data-dd="${esc(f.key)}" aria-haspopup="listbox" aria-expanded="${open}" aria-label="Stand-in for ${esc(f.name)}: ${esc(current)}"><span>${esc(current)}</span>${cur ? `<span class="pct">${cur.score}%</span>` : ''}<span class="chev">${icon(ArrowDown01Icon, 14)}</span></button>
      ${open ? `<ul role="listbox" aria-label="Look-alikes for ${esc(f.name)}">${opts
        .map((o) => {
          const has = !!st.standIns[o.family];
          const sel = o.family === current;
          return `<li role="option" tabindex="-1" aria-selected="${sel}"${has ? '' : ' aria-disabled="true"'} data-pick="${esc(f.key)}" data-family="${esc(o.family)}"><span>${esc(o.family)}</span>${has ? '' : '<span class="ni">Not in Figma</span>'}<span class="pct">${o.score}%</span>${sel ? icon(Tick02Icon) : '<i></i>'}</li>`;
        })
        .join('')}</ul>` : ''}
    </div>
  </div>`;
}

function fontCard(f: FigmaFont) {
  const st = status?.[f.key];
  const open = openKey === f.key;
  return `
  <section class="card fcard">
    <div class="fmeta"><b title="${esc(f.name)}">${esc(f.name)}</b>${licBadge(f)}<span class="grow"></span><button class="link" data-open="${esc(f.key)}" aria-expanded="${open}">${open ? 'Less' : 'Details'}<span class="chev">${icon(ArrowDown01Icon, 14)}</span></button></div>
    ${previewHtml(f)}
    ${st && !st.real ? standHtml(f) : ''}
    ${open ? `<div class="more">
      <div class="kv"><span>Licence</span><b>${esc(f.licence.name)}</b></div>
      <div class="kv"><span>Used for</span><b>${f.roles.length ? esc(f.roles.join(', ')) : 'Not known'}</b></div>
      <div class="kv"><span>Served by</span><b>${esc(f.source)}</b></div>
      ${f.foundry ? `<div class="kv"><span>Foundry</span><b>${esc(f.foundry)}</b></div>` : ''}
      ${st?.real && st.real !== f.name ? `<div class="kv"><span>In Figma as</span><b>${esc(st.real)}</b></div>` : ''}
      <p>${esc(f.licence.short)} This is a summary, not legal advice.</p>
      ${f.getIt ? `<button class="btn getit" data-url="${esc(f.getIt.url)}">Get it from ${esc(f.getIt.label)} ${icon(ArrowUpRight01Icon, 14)}</button>` : ''}
    </div>` : ''}
  </section>`;
}

const sw = (k: keyof typeof opts, label: string) => `<button class="switch" role="switch" aria-checked="${opts[k]}" aria-label="${label}" data-opt="${k}"></button>`;

function fontsHtml() {
  const p = payload!;
  const r = ready();
  const m = missing();
  if (status && !m.length) tab = 'ready';
  const list = !status ? p.fonts : tab === 'ready' ? r : m;
  const any = opts.styles || opts.variables || opts.specimen;
  return `
  <div class="scroll">
    <section class="card sitecard">
      <div class="sh"><b>${esc(p.site.host)}</b><span>${plural(p.fonts.length, 'font')} · ${plural(p.styles.length, 'text style')}${p.scale ? ` · ${esc(p.scale.name)} scale` : ''}</span></div>
      <div class="meter" role="img" aria-label="${status ? `${r.length} of ${p.fonts.length} fonts are in Figma` : 'Checking'}"><i style="transform:scaleX(${status ? r.length / Math.max(1, p.fonts.length) : 0})"></i></div>
      ${status
        ? `<div class="legend"><span><i class="d ok"></i>${r.length} in Figma</span>${m.length ? `<span><i class="d sub"></i>${m.length} use a free stand-in for now</span>` : ''}</div>`
        : '<div class="checking">Checking which fonts this Figma has…</div>'}
    </section>
    ${status ? `<div class="seg" role="tablist" aria-label="Fonts">${(
      [['missing', 'Not in Figma', m.length], ['ready', 'In Figma', r.length]] as const
    )
      .map(([k, l, n]) => `<button role="tab" data-tab="${k}" aria-selected="${tab === k}">${l} <span class="n">${n}</span></button>`)
      .join('')}</div>` : ''}
    ${status && tab === 'missing' && m.length ? '<p class="hintline">A free look-alike stands in until you install the real font.</p>' : ''}
    ${status && tab === 'ready' && !r.length ? '<p class="hintline">None of these fonts are installed in Figma yet.</p>' : ''}
    <div class="fonts">${list.map(fontCard).join('')}</div>
    <section class="card create">
      <h2>Create</h2>
      <div class="opt"><span class="oi">${icon(TextFontIcon)}</span><span class="ot"><b>Text styles</b><span>${plural(p.styles.length, 'style')}, named like the site's HTML</span></span>${sw('styles', 'Text styles')}</div>
      <div class="opt"><span class="oi">${icon(VariableIcon)}</span><span class="ot"><b>Variables</b><span>Sizes and line heights, linked to the styles</span></span>${sw('variables', 'Variables')}</div>
      <div class="opt"><span class="oi">${icon(File01Icon)}</span><span class="ot"><b>Specimen page</b><span>Every font with its licence and where to get it</span></span>${sw('specimen', 'Specimen page')}</div>
    </section>
    <button class="btn wide2" id="again">Paste another site</button>
  </div>
  <footer class="foot"><button class="btn primary wide" id="build"${status && any ? '' : ' disabled'}>Create in Figma</button></footer>`;
}

function creatingHtml() {
  const done = Math.min(stepNow, steps.length);
  return `
  <div class="scroll">
    <section class="card prog" aria-busy="true">
      <h2>Creating in Figma</h2>
      <div class="bar"><i style="transform:scaleX(${steps.length ? (done + 0.5 * (done < steps.length ? 1 : 0)) / steps.length : 0})"></i></div>
      <ul class="plist" role="status">${steps
        .map((s, i) => `<li class="${i < stepNow ? 'done' : i === stepNow ? 'now' : ''}"><span class="pi">${i < stepNow ? icon(Tick02Icon) : i === stepNow ? '<span class="spin"></span>' : '<i></i>'}</span>${esc(s.label)}</li>`)
        .join('')}</ul>
    </section>
  </div>`;
}

function doneHtml() {
  const r = built!;
  const m = r.missing;
  return `
  <div class="scroll">
    <section class="card donecard">
      <span class="dicon">${icon(Tick02Icon, 24)}</span>
      <div><h2>Done</h2><p>${r.page ? 'Everything is in this file. The specimen page shows each style with its font, licence and where to get it.' : 'Everything is in this file.'}</p></div>
      <div class="tiles">
        <div><b>${r.styles}</b><span>${r.styles === 1 ? 'Text style' : 'Text styles'}</span></div>
        <div><b>${r.variables}</b><span>${r.variables === 1 ? 'Variable' : 'Variables'}</span></div>
        <div><b>${r.page ? 1 : 0}</b><span>Page</span></div>
      </div>
      ${r.page ? '<button class="btn primary wide" id="gotopage">Go to the specimen page</button>' : ''}
    </section>
    ${m.length ? `<section class="card recheck">
      <div><b>${plural(m.length, 'font')} ${m.length === 1 ? 'uses a stand-in' : 'use stand-ins'} for now</b><p>Install ${esc(m.slice(0, 2).join(', '))}${m.length > 2 ? ` and ${m.length - 2} more` : ''} on your computer, then press Check again. It swaps the real fonts into your text styles, and everything using those styles updates.</p></div>
      ${recheckBtn()}
    </section>` : ''}
    <button class="btn wide2" id="again">Paste another site</button>
  </div>`;
}

// ------------------------------------------------------------- actions

function handleText(t: string) {
  const p = parsePayload(t);
  if (!p) {
    if (t.trim()) toast('That is not from Font Finder Plus. In Chrome, click Copy for Figma in the side panel first.');
    return;
  }
  payload = p;
  status = null;
  choice.clear();
  tab = 'missing';
  manual = false;
  go('fonts');
  post({ type: 'check', payload: p });
}

function startBuild() {
  const p = payload;
  if (!p || !status) return;
  steps = [{ id: 'fonts', label: 'Loading fonts' }];
  if (opts.variables) steps.push({ id: 'vars', label: 'Adding variables' });
  if (opts.styles) steps.push({ id: 'styles', label: `Making ${plural(p.styles.length, 'text style')}` });
  if (opts.specimen) steps.push({ id: 'page', label: 'Drawing the specimen page' });
  stepNow = 0;
  go('creating');
  post({
    type: 'build',
    payload: p,
    choices: p.fonts.map((f) => ({ key: f.key, family: currentStandIn(f) })),
    opts: { ...opts },
  });
}

/** Move the step list on from a progress message. */
function onProgress(msg: string) {
  const at = (id: Step['id']) => steps.findIndex((s) => s.id === id);
  let i = -1;
  if (/variables were skipped/i.test(msg)) {
    toast(msg);
    i = at('vars') + 1;
  } else if (/^made \d+ text style/i.test(msg)) i = at('styles') + 1;
  else if (/variable/i.test(msg)) i = at('vars');
  else if (/text style/i.test(msg)) i = at('styles');
  else if (/specimen/i.test(msg)) i = at('page');
  if (i > stepNow) {
    stepNow = i;
    if (screen === 'creating') render();
  }
}

function recheck() {
  checking = true;
  render();
  post({ type: 'recheck' });
}

let toastTimer = 0;
function toast(m: string) {
  const el = $('toast');
  el.textContent = m;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (el.hidden = true), 4000);
}

async function pasteClick() {
  try {
    const t = await navigator.clipboard.readText();
    if (t) return handleText(t);
  } catch {
    /* Figma's window usually cannot read the clipboard on a click */
  }
  toast(`Press ${isMac ? '⌘' : 'Ctrl'}+V to paste, or use the box below.`);
  manual = true;
  render();
  $('manual')?.focus();
}

// ------------------------------------------------------------- events

document.addEventListener('click', (e) => {
  const t = e.target as HTMLElement;
  const q = <T extends HTMLElement = HTMLElement>(s: string) => t.closest<T>(s);
  let el: HTMLElement | null;
  if (ddKey && !q('.dd')) {
    ddKey = null;
    render();
  }
  if (q('#paste')) return void pasteClick();
  if (q('#showmanual')) {
    manual = true;
    render();
    return $('manual')?.focus();
  }
  if (q('#recheck')) return recheck();
  if (q('#again')) {
    payload = null;
    status = null;
    built = null;
    return go('start');
  }
  if (q('#build')) return startBuild();
  if (q('#gotopage')) return post({ type: 'goto-page' });
  if ((el = q('[data-tab]'))) {
    tab = el.dataset.tab as typeof tab;
    openKey = null;
    return render();
  }
  if ((el = q('[data-open]'))) {
    openKey = openKey === el.dataset.open ? null : el.dataset.open!;
    return render();
  }
  if ((el = q('[data-dd]'))) {
    ddKey = ddKey === el.dataset.dd ? null : el.dataset.dd!;
    render();
    placeMenu();
    return;
  }
  if ((el = q('[data-pick]'))) {
    if (el.getAttribute('aria-disabled') === 'true') return;
    choice.set(el.dataset.pick!, el.dataset.family!);
    const k = ddKey;
    ddKey = null;
    render();
    return focusDd(k);
  }
  if ((el = q('[data-opt]'))) {
    const k = el.dataset.opt as keyof typeof opts;
    opts[k] = !opts[k];
    return render();
  }
  if ((el = q('[data-url]'))) post({ type: 'open', url: el.dataset.url });
});

const focusDd = (k: string | null) => k && document.querySelector<HTMLElement>(`[data-dd="${CSS.escape(k)}"]`)?.focus();

/** Open the stand-in menu upwards when there is no room below, and focus the chosen option. */
function placeMenu() {
  const ul = document.querySelector<HTMLElement>('.dd ul');
  if (!ul) return;
  const sc = document.querySelector('.scroll')!.getBoundingClientRect();
  const r = ul.getBoundingClientRect();
  if (r.bottom > sc.bottom && r.top - r.height - 40 > sc.top) ul.classList.add('up');
  (ul.querySelector<HTMLElement>('[aria-selected="true"]') ?? ul.querySelector<HTMLElement>('li'))?.focus();
}

document.addEventListener('keydown', (e) => {
  const t = e.target as HTMLElement;
  if (ddKey && e.key === 'Escape') {
    const k = ddKey;
    ddKey = null;
    render();
    focusDd(k);
    return;
  }
  if (t.matches('.dd li') && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
    e.preventDefault();
    const items = Array.from(t.parentElement!.querySelectorAll<HTMLElement>("li"));
    const i = items.indexOf(t) + (e.key === 'ArrowDown' ? 1 : -1);
    items[(i + items.length) % items.length].focus();
  } else if (t.matches('.dd li') && (e.key === 'Enter' || e.key === ' ')) {
    e.preventDefault();
    t.click();
  }
});

document.addEventListener('input', (e) => {
  const t = e.target as HTMLElement;
  if (t.id === 'manual') handleText((t as HTMLTextAreaElement).value);
});

document.addEventListener('paste', (e) => {
  if ((e.target as HTMLElement)?.id === 'manual') return;
  if (screen === 'creating') return;
  const t = e.clipboardData?.getData('text/plain') ?? '';
  e.preventDefault();
  handleText(t);
});

window.onmessage = (e: MessageEvent) => {
  const msg = e.data?.pluginMessage;
  if (!msg) return;
  if (msg.type === 'init') {
    saved = msg.saved;
    if (screen === 'start') render();
  } else if (msg.type === 'checked') {
    status = msg.status;
    if (!missing().length) tab = 'ready';
    if (screen === 'fonts') render();
  } else if (msg.type === 'progress') {
    onProgress(String(msg.msg ?? ''));
  } else if (msg.type === 'built') {
    built = msg.result as Built;
    stepNow = steps.length;
    render();
    window.setTimeout(() => go('done'), 350);
  } else if (msg.type === 'rechecked') {
    const r = msg.result as { swapped: number; still: string[]; total: number };
    checking = false;
    toast(r.swapped ? `Swapped the real font into ${plural(r.swapped, 'text style')}.` : r.still.length ? `Still not installed: ${r.still.join(', ')}.` : 'All styles already use the real fonts.');
    if (built) built.missing = built.missing.filter((n) => r.still.includes(n));
    if (screen === 'start') saved = r.still.length ? saved : 0;
    if (screen === 'start' || screen === 'done') render();
  } else if (msg.type === 'error') {
    toast(`Something went wrong: ${msg.msg}`);
    checking = false;
    if (screen === 'creating') go('fonts');
    else render();
  }
};

render();
$('paste')?.focus();
