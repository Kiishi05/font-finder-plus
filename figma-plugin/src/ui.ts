// The plugin window. Two doors from Home:
// - Bring a website's type in: paste what the extension copied, preview it by font
//   (or as a type system), pick stand-ins, create styles, variables and a style guide.
// - See your type on the web: the file's text styles with a role each, then a site,
//   then "Copy for Chrome" (the extension reads it with System > Paste type from Figma).
// Plus Fix a captured page (swap fonts Figma is missing in the selection) and Settings.
import {
  Alert02Icon,
  ArrowDown01Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  ArrowUpRight01Icon,
  BookOpen01Icon,
  ClipboardIcon,
  Copy01Icon,
  CursorPointer02Icon,
  Delete02Icon,
  FrameIcon,
  Globe02Icon,
  InformationCircleIcon,
  Link01Icon,
  MagicWand01Icon,
  RefreshIcon,
  SecurityLockIcon,
  Settings02Icon,
  TextFontIcon,
  Tick02Icon,
  Cancel01Icon,
  VariableIcon,
} from '@hugeicons/core-free-icons';
import { parsePayload, type FigmaFont, type FigmaPayload, type FigmaStyle } from '../../src/shared/figma-payload';
import { buildWebPayload, normalizeSite, payloadName, roleWhenTicked, ROLES, type Role, type WebStyle } from './web';

type IconNode = [string, Record<string, string>][];
const icon = (node: unknown, size = 18) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" aria-hidden="true">${(node as IconNode)
    .map(([tag, a]) => `<${tag} ${Object.entries(a).filter(([k]) => k !== 'key').map(([k, v]) => `${k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())}="${v}"`).join(' ')}/>`)
    .join('')}</svg>`;

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T | null;
const post = (msg: Record<string, unknown>) => parent.postMessage({ pluginMessage: msg }, '*');
const isMac = /Mac/.test(navigator.platform);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const list = (xs: string[], max = 2) => (xs.length <= max ? xs.join(' and ') : `${xs.slice(0, max).join(', ')} and ${xs.length - max} more`);
const num = (n: number) => String(Math.round(n * 10) / 10);
const cssFamily = (...fams: (string | null | undefined)[]) => [...fams.filter(Boolean).map((f) => `'${String(f).replace(/['\\<>]/g, '')}'`), 'var(--ui)'].join(', ');

type Status = Record<string, { real: string | null; standIns: Record<string, boolean> }>;
type Screen =
  | 'home' | 'settings'
  | 'paste' | 'pastebox' | 'preview' | 'system' | 'standins' | 'creating' | 'done' | 'build-error'
  | 'fix-select' | 'fix' | 'fixed'
  | 'web-styles' | 'web-site' | 'web-copied';
interface Built { styles: number; variables: number; page: string | null; missing: string[] }
interface Step { id: 'fonts' | 'vars' | 'styles' | 'page'; label: string; n: string }
interface Settings { variables: boolean; specimen: boolean; naming: 'site' | 'role' }
interface StandIns { count: number; styles: string[]; fonts: string[] }
interface Selection { count: number; name: string }
interface Candidate { family: string; score: number | null }
interface MissingFont { family: string; styles: string[]; layers: number; licence: string | null; candidates: Candidate[] }
interface Scan extends Selection { texts: number; layers: number; fonts: MissingFont[] }
interface FixResult { layers: number; linked: number; failed: string[]; map: Record<string, string> }

let screen: Screen = 'home';
let file = '';
let settings: Settings = { variables: true, specimen: true, naming: 'site' };
let recent: string[] = [];
let standIns: StandIns = { count: 0, styles: [], fonts: [] };
let stillMissing = false; // the last Check again found the real fonts still missing
let checking = false; // a Check again is running
let selection: Selection = { count: 0, name: '' };
let toastTimer = 0;
let dd: string | null = null; // the open dropdown ("s:<font key>", "f:<family>" or "r:<style id>")

// Bring a website in
let payload: FigmaPayload | null = null;
let status: Status | null = null;
const choice = new Map<string, string | null>();
const opts = { styles: true, variables: true, specimen: true };
let pasteError = false;
let pasteText = '';
let steps: Step[] = [];
let stepNow = 0;
let built: Built | null = null;
let buildError = '';

// Fix a captured page
let scan: Scan | null = null;
let scanning = false;
const fixTo = new Map<string, string>();
let link = true;
let fixResult: FixResult | null = null;

// See it on the web
let webStyles: WebStyle[] | null = null;
const use = new Map<string, boolean>();
const roles = new Map<string, Role>();
let siteInput = '';
let copiedSite = '';

// ------------------------------------------------------------- building blocks

const LIC: Record<string, [string, string]> = {
  OFL: ['free', 'Free'], APACHE: ['free', 'Free'], UFL: ['free', 'Free'], 'free-other': ['free', 'Free'],
  commercial: ['paid', 'Paid'], system: ['system', 'System'], unknown: ['unknown', 'Unknown'],
};
const licBadge = (type: string | null | undefined) => {
  if (!type) return '';
  const [cls, label] = LIC[type] ?? LIC.unknown;
  return `<span class="lic ${cls}"><span class="dot"></span>${label}</span>`;
};
const kbd = (k: string) => `<span class="kbds"><span class="kbd">${isMac ? '⌘' : 'Ctrl'}</span><span class="kbd">${k}</span></span>`;
const fine = (ic: unknown, text: string) => `<p class="fine">${icon(ic, 14)}<span>${text}</span></p>`;
const privacy = fine(SecurityLockIcon, 'Nothing leaves your computer. This plugin makes no network requests.');
const fileTop = () => `<div class="topbar"><div class="fileid"><small>This file</small><b>${esc(file || 'Untitled')}</b></div><button class="sqbtn" data-go="settings" aria-label="Settings">${icon(Settings02Icon)}</button></div>`;
const subTop = (back: Screen | null, crumb: string, right = '') =>
  `<div class="topbar"><button class="sqbtn white" ${back ? `data-go="${back}"` : 'disabled'} aria-label="Back">${icon(ArrowLeft01Icon)}</button><span class="crumb">${crumb}</span>${right}</div>`;
const dropZone = (wait = false) =>
  `<button class="drop${wait ? ' wait' : ''}" id="paste" aria-label="Paste from Font Finder Plus"><span class="ic">${icon(ClipboardIcon, 22)}</span><b>${wait ? 'Waiting for your paste' : 'Paste from Font Finder Plus'}</b><span>Press ${kbd('V')} anywhere in this window</span></button>`;
const alertCard = (title: string, text: string, extra = '') =>
  `<section class="card"><div class="alert" role="alert"><span class="ai">${icon(Alert02Icon)}</span><div class="t"><b>${title}</b><p>${text}</p>${extra}</div></div></section>`;
const emptyCard = (ic: unknown, title: string, text: string) =>
  `<section class="card"><div class="empty"><span class="ic">${icon(ic, 20)}</span><b>${title}</b><p>${text}</p></div></section>`;
const recheckBtn = () => `<button class="btn full" id="recheck"${checking ? ' disabled' : ''}>${icon(RefreshIcon, 16)}${checking ? 'Checking…' : 'Check again'}</button>`;
const sw = (attr: string, on: boolean, label: string) => `<button class="switch" role="switch" aria-checked="${on}" aria-label="${esc(label)}" ${attr}></button>`;

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
const stylesOf = (f: FigmaFont) => (payload ? payload.styles.filter((s) => s.fontKey === f.key) : []);
const styleLabel = (s: FigmaStyle) => (s.label ?? s.name).replace(/\s*\(.*\)$/, '');
const sizeText = (s: FigmaStyle) => `${num(s.size)}/${s.lineHeight ? num(s.lineHeight) : 'auto'}`;
const kindName = (f: FigmaFont) => (f.classification === 'mono' ? 'monospace' : f.classification === 'serif' ? 'serif' : 'sans serif');

/** A dropdown of fonts: stand-ins for a pasted font, or replacements in Fix. */
function ddField(key: string, current: string, options: { family: string; score: number | null; has: boolean }[], label: string) {
  const open = dd === key;
  const cur = options.find((o) => o.family === current);
  return `<div class="dd"><button class="ddbtn" data-dd="${esc(key)}" aria-haspopup="listbox" aria-expanded="${open}" aria-label="${esc(label)}: ${esc(current)}"><span>${esc(current)}</span>${cur?.score != null ? `<em>${cur.score}%</em>` : ''}<span class="chev">${icon(ArrowDown01Icon, 15)}</span></button>
    ${open ? `<ul class="menu" role="listbox" aria-label="${esc(label)}">${options
      .map((o) => `<li role="option" tabindex="-1" aria-selected="${o.family === current}"${o.has ? '' : ' aria-disabled="true"'} data-pick="${esc(key)}" data-family="${esc(o.family)}"><span>${esc(o.family)}</span>${o.has ? '' : '<span class="ni">Not in Figma</span>'}${o.score != null ? `<em>${o.score}%</em>` : ''}${o.family === current ? icon(Tick02Icon, 15) : '<span class="sp"></span>'}</li>`)
      .join('')}</ul>` : ''}</div>`;
}

// ------------------------------------------------------------- home and settings

function standInCard() {
  if (!standIns.count) return '';
  const fonts = list(standIns.fonts);
  const n = standIns.count;
  const text = stillMissing
    ? `${esc(fonts)} ${standIns.fonts.length === 1 ? 'is' : 'are'} still not installed. Install ${standIns.fonts.length === 1 ? 'it' : 'them'} on this computer, restart Figma, then check again.`
    : `Installed ${esc(fonts)}? Check again swaps ${standIns.fonts.length === 1 ? 'it' : 'them'} into ${n === 1 ? `the ${esc(standIns.styles[0])} style` : `${n} text styles`}.`;
  return `<section class="card" id="standin-note"><div class="ht"><h3>${plural(n, 'text style')} ${n === 1 ? 'uses' : 'use'} a stand-in</h3><p>${text}</p></div>${recheckBtn()}</section>`;
}

function homeHtml() {
  return {
    body: `${fileTop()}
    <section class="card"><div class="ht"><h3>Bring a website's type in</h3><p>Text styles, variables and a style guide from any site you check in Chrome.</p></div>${dropZone()}</section>
    <section class="card"><div class="ht"><h3>See your type on the web</h3><p>Try this file's text styles on any website. Nothing changes for anyone else.</p></div><button class="btn full" data-go="web-styles">${icon(Globe02Icon, 16)}Choose text styles</button></section>
    <button class="rowlink" data-go="fix-select"><span class="smic">${icon(MagicWand01Icon)}</span><span class="t"><b>Fix a captured page</b><span>Swap fonts Figma is missing in a frame</span></span>${icon(ArrowRight01Icon)}</button>
    ${standInCard()}
    ${privacy}`,
  };
}

function settingsHtml() {
  const host = payload?.site.host ?? 'example.com';
  return {
    body: `${subTop('home', '<b>Settings</b>')}
    <section class="card"><h3>When creating</h3><div class="opts">
      <div class="opt"><span class="t"><b>Variables</b><span>${settings.variables ? 'On' : 'Off'} by default</span></span>${sw('data-def="variables"', settings.variables, 'Variables on by default')}</div>
      <div class="opt"><span class="t"><b>Style guide page</b><span>${settings.specimen ? 'On' : 'Off'} by default</span></span>${sw('data-def="specimen"', settings.specimen, 'Style guide page on by default')}</div></div></section>
    <section class="card"><div class="ht"><h3>Name text styles</h3><p>Like <b>${settings.naming === 'site' ? `${esc(host)}/Headings/H1` : 'Headings/Heading 1'}</b></p></div>
      <div class="seg" role="group" aria-label="Name text styles"><button data-naming="site" aria-pressed="${settings.naming === 'site'}">By site and tag</button><button data-naming="role" aria-pressed="${settings.naming === 'role'}">By role</button></div></section>
    <section class="card"><div class="ht"><h3>Recent websites</h3><p>Used by See it on the web.</p></div>
      ${recent.length
        ? `<div class="sitelist">${recent.map((h) => `<div><span>${esc(h)}</span><button class="ib" data-forget="${esc(h)}" aria-label="Remove ${esc(h)}">${icon(Delete02Icon, 15)}</button></div>`).join('')}</div>
      <button class="linkb redlink" id="clear-sites">Clear all</button>`
        : '<p class="sub">None yet.</p>'}</section>
    ${privacy}`,
  };
}

// ------------------------------------------------------------- bring a website in

function pasteHtml() {
  return {
    body: `${subTop('home', '<b>Bring a website in</b>')}
    ${pasteError ? alertCard("That isn't from Font Finder Plus", 'In Chrome, press Copy for Figma first, then paste here again.') : ''}
    <section class="card">${dropZone(true)}
      <ol class="steps"><li><span class="n">1</span><span>In Chrome, click Font Finder Plus on any site</span></li><li><span class="n">2</span><span>Press <b>Copy for Figma</b> on the Page or System tab</span></li><li><span class="n">3</span><span>Come back here and press ${kbd('V')}</span></li></ol>
    </section>
    <button class="linkb" data-go="pastebox" id="showmanual">Paste into a box instead</button>`,
  };
}

function pasteBoxHtml() {
  return {
    body: `${subTop('paste', '<b>Bring a website in</b>')}
    ${pasteError ? alertCard("That isn't from Font Finder Plus", 'In Chrome, press Copy for Figma first, then paste it here.') : ''}
    <section class="card"><div class="ht"><h3>Paste into this box</h3><p>For when ${kbd('V')} doesn't reach the window.</p></div>
      <textarea class="field" id="manual" placeholder="Paste here" aria-label="Paste here">${esc(pasteText)}</textarea></section>`,
    foot: `<button class="btn pri wide" id="readbox"${pasteText.trim() ? '' : ' disabled'}>Read it</button>`,
  };
}

function fontGroup(f: FigmaFont) {
  const st = status?.[f.key];
  const uses = stylesOf(f);
  const stand = st && !st.real ? currentStandIn(f) : null;
  return `<section class="card fg fcard" data-font="${esc(f.key)}"><div class="fg-t"><b title="${esc(f.name)}">${esc(f.name)}</b>${licBadge(f.licence.type)}<span class="grow"></span><span class="state">${!st ? 'Checking' : st.real ? 'In Figma' : 'Not in Figma'}</span></div>
    ${previewHtml(f)}
    ${uses.length ? `<div class="uses">${uses.map((s) => `<div><span>${esc(styleLabel(s))}</span><em>${sizeText(s)}</em></div>`).join('')}</div>` : '<p class="sub">Not used by a text style on this page.</p>'}
    ${st && !st.real ? `<div class="standin"><span class="t">${stand ? `<b>${esc(stand)}</b> stands in for now` : `A ${kindName(f)} font Figma has stands in for now`}</span><button class="btn sm" data-go="standins">Change</button></div>` : ''}
  </section>`;
}

function stepCounts() {
  const p = payload!;
  return { vars: p.fonts.length + p.styles.length + p.styles.filter((s) => s.lineHeight).length };
}

const createCard = () => {
  const p = payload!;
  const rows: [keyof typeof opts, unknown, string, string][] = [
    ['styles', TextFontIcon, 'Text styles', `${plural(p.styles.length, 'style')}, named ${settings.naming === 'site' ? 'like the site' : 'by role'}`],
    ['variables', VariableIcon, 'Variables', 'Sizes and line heights, linked to the styles'],
    ['specimen', BookOpen01Icon, 'Style guide page', 'Every font, its licence and where to get it'],
  ];
  return `<section class="card"><h3>Create</h3><div class="opts">${rows
    .map(([k, ic, t, s]) => `<div class="opt"><span class="smic">${icon(ic)}</span><span class="t"><b>${t}</b><span>${s}</span></span>${sw(`data-opt="${k}"`, opts[k], t)}</div>`)
    .join('')}</div></section>`;
};
const createFoot = () => `<button class="btn pri wide" id="build"${status && (opts.styles || opts.variables || opts.specimen) ? '' : ' disabled'}>Create in Figma</button>`;

function previewHtmlScreen() {
  const p = payload!;
  const r = ready();
  const order = [...p.fonts].sort((a, b) => stylesOf(b).length - stylesOf(a).length);
  return {
    body: `${subTop('home', `Page / <b>${esc(p.site.host)}</b>`)}
    <section class="card"><div class="stline"><div class="t"><small>Captured page</small><b>${esc(p.site.host)}</b></div><span class="count">${plural(p.fonts.length, 'font')}</span></div>
      <div class="meter" role="img" aria-label="${status ? `${r.length} of ${p.fonts.length} fonts are in Figma` : 'Checking'}"><i style="transform:scaleX(${status ? r.length / Math.max(1, p.fonts.length) : 0})"></i></div>
      <p class="sub">${status ? `${r.length} of ${p.fonts.length} fonts are in Figma.${r.length < p.fonts.length ? ' Free look-alikes stand in for the rest.' : ''}` : 'Checking which fonts this Figma has…'}</p>
      ${p.scale ? `<button class="btn sm start" data-go="system">See the type system</button>` : ''}</section>
    <div class="label"><b>By font</b><span class="count">${plural(p.styles.length, 'style')}</span></div>
    <div class="fonts">${order.map(fontGroup).join('')}</div>
    ${createCard()}`,
    foot: createFoot(),
  };
}

function systemHtml() {
  const p = payload!;
  const byKey = new Map(p.fonts.map((f) => [f.key, f]));
  const sorted = [...p.styles].sort((a, b) => b.size - a.size);
  const m = missing();
  return {
    body: `${subTop('preview', `System / <b>${esc(p.site.host)}</b>`)}
    <section class="card"><div class="stline"><div class="t"><small>Type system</small><b>${p.scale ? `${esc(p.scale.name)} · ${p.scale.ratio}` : 'Sizes'}</b></div><span class="count">${plural(sorted.length, 'step')}</span></div>
      <div class="scale">${sorted.map((s) => {
        const f = byKey.get(s.fontKey);
        const fam = f ? cssFamily(status?.[f.key]?.real ?? f.cssFamily, currentStandIn(f)) : cssFamily();
        return `<div><span class="s" style="font-family:${esc(fam)};font-weight:${esc(s.weight)};font-size:${Math.min(s.size, 30)}px">${esc(styleLabel(s))}</span><em>${num(s.size)}</em></div>`;
      }).join('')}</div>
      ${sorted.some((s) => s.size > 30) ? '<p class="sub">Sizes over 30 are drawn smaller here.</p>' : ''}</section>
    <section class="card"><div class="ht"><h3>Fonts</h3><p>${status ? (m.length ? `${plural(m.length, 'font')} ${m.length === 1 ? "isn't" : "aren't"} in Figma. Free look-alikes stand in.` : 'Every font is in Figma.') : 'Checking which fonts this Figma has…'}</p></div>
      <div class="uses">${p.fonts.map((f) => `<div><span>${esc(f.name)}</span><em>${!status ? '…' : status[f.key]?.real ? 'In Figma' : esc(currentStandIn(f) ?? 'Stand-in')}</em></div>`).join('')}</div>
      ${m.length ? '<button class="btn sm start" data-go="standins">Change stand-ins</button>' : ''}</section>
    ${createCard()}`,
    foot: createFoot(),
  };
}

function standinsHtml() {
  const m = missing();
  return {
    body: `${subTop('preview', '<b>Stand-ins</b>')}
    <section class="card"><div class="ht"><h3>${m.length ? `${plural(m.length, 'font')} ${m.length === 1 ? "isn't" : "aren't"} in Figma` : 'Every font is in Figma'}</h3><p>A free look-alike stands in until you install the real one. Check again swaps it in later.</p></div></section>
    ${m.map((f) => {
      const st = status![f.key];
      const options = lookAlikes(f).map((o) => ({ family: o.family, score: o.score, has: !!st.standIns[o.family] }));
      const cur = currentStandIn(f);
      const uses = stylesOf(f).map(styleLabel);
      return `<section class="card fg fcard"><div class="fg-t"><b title="${esc(f.name)}">${esc(f.name)}</b>${licBadge(f.licence.type)}</div>
        ${uses.length ? `<p class="sub">${esc(uses.join(', '))}</p>` : ''}
        ${cur ? ddField(`s:${f.key}`, cur, options, `Stand-in for ${f.name}`) : `<p class="sub">${options.length ? `Its free look-alikes (${esc(options.slice(0, 3).map((o) => o.family).join(', '))}) are not in this Figma. A similar ${kindName(f)} font Figma has will stand in.` : 'No free look-alike found. Inter will stand in.'}</p>`}
        ${previewHtml(f)}
        <p class="sub">${esc(f.licence.name)}. ${esc(f.licence.short)} This is a summary, not legal advice.</p>
        ${f.getIt ? `<button class="btn sm start" data-url="${esc(f.getIt.url)}">Get it from ${esc(f.getIt.label)}${icon(ArrowUpRight01Icon, 15)}</button>` : ''}</section>`;
    }).join('')}`,
    foot: `<button class="btn pri wide" data-go="preview">Done</button>`,
  };
}

function creatingHtml() {
  const p = Math.min(stepNow, steps.length);
  return {
    body: `${subTop(null, `Page / <b>${esc(payload?.site.host ?? '')}</b>`)}
    <section class="card" aria-busy="true"><div class="ht"><h3>Creating in Figma</h3><p>Keep this window open. It takes a few seconds.</p></div>
      <div class="bar"><i style="transform:scaleX(${steps.length ? (p + (p < steps.length ? 0.5 : 0)) / steps.length : 0})"></i></div>
      <ul class="plist" role="status">${steps
        .map((s, i) => `<li class="${i < p ? 'done' : i === p ? 'now' : ''}"><span class="pi">${i < p ? icon(Tick02Icon, 14) : i === p ? '<span class="spin"></span>' : '<i></i>'}</span>${esc(s.label)}<em>${esc(s.n)}</em></li>`)
        .join('')}</ul></section>`,
  };
}

function doneHtml() {
  const r = built!;
  const m = r.missing;
  return {
    body: `${subTop('home', `Page / <b>${esc(payload?.site.host ?? '')}</b>`)}
    <section class="card donecard"><span class="bigic">${icon(Tick02Icon, 22)}</span><div class="ht"><h3>${r.styles ? `${plural(r.styles, 'text style')} ${r.styles === 1 ? 'is' : 'are'} in this file` : 'Done'}</h3><p>${r.page ? 'The style guide shows each one with its font, licence and where to get it.' : 'Everything is in this file.'}</p></div>
      <div class="tiles"><div><b>${r.styles}</b><span>${r.styles === 1 ? 'Text style' : 'Text styles'}</span></div><div><b>${r.variables}</b><span>${r.variables === 1 ? 'Variable' : 'Variables'}</span></div><div><b>${r.page ? 1 : 0}</b><span>Page</span></div></div></section>
    ${m.length ? `<section class="card"><div class="ht"><h3>${plural(m.length, 'font')} ${m.length === 1 ? 'uses a stand-in' : 'use stand-ins'}</h3><p>Install ${esc(list(m))}, then check again. Every layer using those styles updates.</p></div>${recheckBtn()}</section>` : ''}
    <button class="rowlink" data-go="web-styles"><span class="smic">${icon(Globe02Icon)}</span><span class="t"><b>See these styles on the web</b><span>Try them on any website in Chrome</span></span>${icon(ArrowRight01Icon)}</button>`,
    foot: `${r.page ? '<button class="btn pri wide" id="gotopage">Go to the style guide</button>' : ''}<button class="linkb" id="again">Bring another site in</button>`,
  };
}

function buildErrorHtml() {
  return {
    body: `${subTop('preview', `Page / <b>${esc(payload?.site.host ?? '')}</b>`)}
    ${alertCard("Couldn't create the styles", `${esc(/[.!?]$/.test(buildError) ? buildError : `${buildError}.`)} If you can only view this file, duplicate it to your drafts or ask the owner for edit access.`)}
    ${fine(InformationCircleIcon, 'Your choices are kept.')}`,
    foot: `<button class="btn pri wide" id="build">Try again</button><button class="linkb" data-go="preview">Back to preview</button>`,
  };
}

// ------------------------------------------------------------- fix a captured page

const frameCard = (sub: string, name: string) =>
  `<section class="card"><div class="stline"><span class="smic">${icon(FrameIcon)}</span><div class="t"><small>${sub}</small><b>${esc(name)}</b></div></div></section>`;

function fixSelectHtml() {
  const has = selection.count > 0;
  return {
    body: `${subTop('home', '<b>Fix a captured page</b>')}
    ${has ? frameCard('Selected', selection.name) : emptyCard(CursorPointer02Icon, 'Select a captured frame', "Pick a frame you brought in from the web. We'll find the fonts Figma is missing.")}
    ${fine(InformationCircleIcon, 'Works with any text layers, including pages captured with other plugins.')}`,
    foot: `<button class="btn pri wide" id="fixscan"${has && !scanning ? '' : ' disabled'}>${scanning ? 'Looking…' : 'Find missing fonts'}</button>`,
  };
}

function fixHtml() {
  const s = scan!;
  const card = frameCard(`Selected · ${plural(s.texts, 'text layer')}`, s.name);
  if (!s.fonts.length) {
    return {
      body: `${subTop('fix-select', '<b>Fix a captured page</b>')}${card}${emptyCard(Tick02Icon, s.texts ? 'Nothing to fix' : 'No text here', s.texts ? 'Every font in this selection is already in Figma.' : 'The selection has no text layers.')}`,
      foot: `<button class="btn wide" data-go="fix-select">Select another frame</button>`,
    };
  }
  const can = s.fonts.filter((f) => fixTo.get(f.family));
  return {
    body: `${subTop('fix-select', '<b>Fix a captured page</b>')}${card}
    <div class="label"><b>Missing fonts</b><span class="count">${s.fonts.length}</span></div>
    ${s.fonts.map((f) => `<section class="card fg"><div class="fg-t"><b title="${esc(f.family)}">${esc(f.family)}</b>${licBadge(f.licence)}<span class="grow"></span><span class="state">${plural(f.layers, 'layer')}</span></div>
      <p class="sub">${esc(f.styles.join(', '))}</p>
      ${f.candidates.length ? ddField(`f:${f.family}`, fixTo.get(f.family)!, f.candidates.map((c) => ({ ...c, has: true })), `Replacement for ${f.family}`) : '<p class="sub">No font in this Figma to swap in.</p>'}</section>`).join('')}
    <section class="card"><div class="opt"><span class="smic">${icon(Link01Icon)}</span><span class="t"><b>Link to text styles</b><span>Use this file's Font Finder Plus styles where font and size match</span></span>${sw('id="link"', link, 'Link to text styles')}</div></section>`,
    foot: `<button class="btn pri wide" id="fixapply"${can.length ? '' : ' disabled'}>Fix ${plural(s.layers, 'layer')}</button>`,
  };
}

function fixedHtml() {
  const r = fixResult!;
  const rows = Object.entries(r.map).map(([from, to]) => `<div><span>${esc(from)}</span><em>${esc(to)}</em></div>`);
  if (r.linked) rows.push(`<div><span>Linked to text styles</span><em>${r.linked}</em></div>`);
  return {
    body: `${subTop('fix-select', '<b>Fix a captured page</b>')}
    <section class="card"><span class="bigic">${icon(Tick02Icon, 22)}</span><div class="ht"><h3>Fixed ${plural(r.layers, 'layer')}</h3><p>${r.failed.length ? `${esc(list(r.failed))} could not be loaded, so some layers still miss a font.` : 'Every layer in the selection now shows a font Figma has.'} Press ${kbd('Z')} to undo.</p></div>
      <div class="uses">${rows.join('')}</div></section>`,
    foot: `<button class="btn wide" data-go="fix-select">Fix another frame</button>`,
  };
}

// ------------------------------------------------------------- see it on the web

const roleOf = (s: WebStyle): Role => (use.get(s.id) ? roles.get(s.id) ?? 'none' : 'none');
const chosen = () => (webStyles ?? []).filter((s) => use.get(s.id) && roleOf(s) !== 'none');
const shortName = (n: string) => n.split('/').pop()!.trim();
const ROLE_LABEL = Object.fromEntries(ROLES) as Record<Role, string>;
ROLE_LABEL.h3 = 'Other headings';

function groups(styles: WebStyle[]) {
  const map = new Map<string, WebStyle[]>();
  for (const s of styles) map.set(s.family, [...(map.get(s.family) ?? []), s]);
  return [...map];
}

function roleBtn(s: WebStyle) {
  const r = roleOf(s);
  const key = `r:${s.id}`;
  const open = dd === key;
  return `<div class="dd"><button class="rolebtn${r === 'none' ? ' none' : ''}" data-dd="${esc(key)}" aria-haspopup="listbox" aria-expanded="${open}" aria-label="Role of ${esc(s.name)}: ${ROLE_LABEL[r]}">${ROLE_LABEL[r]}<span class="chev">${icon(ArrowDown01Icon, 14)}</span></button>
    ${open ? `<ul class="menu right" role="listbox" aria-label="Role of ${esc(s.name)}">${ROLES.map(([k, l]) => `${k === 'none' ? '<hr>' : ''}<li role="option" tabindex="-1" aria-selected="${r === k}" data-role="${esc(s.id)}" data-value="${k}"><span>${l}</span>${r === k ? icon(Tick02Icon, 15) : '<span class="sp"></span>'}</li>`).join('')}</ul>` : ''}</div>`;
}

function webStylesHtml() {
  const top = subTop('home', '<b>See it on the web</b>', '<span class="count">1 of 2</span>');
  if (!webStyles) return { body: `${top}<section class="card"><p class="sub">Reading this file's text styles…</p></section>` };
  if (!webStyles.length) {
    return {
      body: `${subTop('home', '<b>See it on the web</b>')}${emptyCard(TextFontIcon, 'No text styles in this file', "Bring a website's type in first, or make text styles in Figma.")}`,
      foot: `<button class="btn pri wide" data-go="paste">${icon(ClipboardIcon, 16)}Paste from Font Finder Plus</button>`,
    };
  }
  return {
    body: `${top}
    <section class="card"><div class="ht"><h3>Where does each style go?</h3><p>We guessed from the names and sizes. Change any of them.</p></div></section>
    ${groups(webStyles).map(([family, items]) => {
      const paid = items.some((s) => s.paid && !s.standInFor && use.get(s.id));
      const stand = items.find((s) => s.standInFor);
      return `<section class="card fg" data-family="${esc(family)}"><div class="fg-t"><b style="font-family:${esc(cssFamily(family))}">${esc(family)}</b>${items.some((s) => s.paid && !s.standInFor) ? licBadge('commercial') : ''}</div>
      ${stand ? `<p class="sub">Stands in for ${esc(stand.standInFor)}. Chrome gets ${esc(family)}.</p>` : ''}
      <div class="srows">${items.map((s) => `<div class="srow${use.get(s.id) ? '' : ' off'}"><button class="ck" role="checkbox" aria-checked="${!!use.get(s.id)}" aria-label="Use ${esc(s.name)}" data-use="${esc(s.id)}">${icon(Tick02Icon, 14)}</button><span class="si"><b title="${esc(s.name)}">${esc(shortName(s.name))}</b><span>${s.weight} · ${num(s.size)}/${num(s.lineHeight)}</span></span>${roleBtn(s)}</div>`).join('')}</div>
      ${paid ? `<div class="paidnote"><span class="dot"></span><span>Paid. Chrome shows ${esc(family)} only on a computer that has it installed.</span></div>` : ''}</section>`;
    }).join('')}`,
    foot: `<button class="btn pri wide" data-go="web-site" id="web-next"${chosen().length ? '' : ' disabled'}>Next: pick a website</button>`,
  };
}

function webSiteHtml() {
  const c = chosen();
  const site = normalizeSite(siteInput);
  const fams = groups(c);
  return {
    body: `${subTop('web-styles', '<b>See it on the web</b>', '<span class="count">2 of 2</span>')}
    <section class="card"><div class="ht"><h3>Pick a website</h3><p>Your own, a client's or a competitor's.</p></div>
      <label class="field">${icon(Globe02Icon)}<input id="site" value="${esc(siteInput)}" placeholder="yoursite.com" aria-label="Website" autocomplete="off" spellcheck="false"></label>
      ${recent.length ? `<div class="recent">${recent.map((h) => `<span class="rchip${site?.label === h ? ' on' : ''}"><button class="rp" data-site="${esc(h)}" aria-pressed="${site?.label === h}">${esc(h)}</button><button class="rx" data-forget="${esc(h)}" aria-label="Remove ${esc(h)}">${icon(Cancel01Icon, 12)}</button></span>`).join('')}</div>` : ''}</section>
    <section class="card"><div class="ht"><h3>Your type</h3><p>${plural(c.length, 'style')} in ${plural(fams.length, 'font')}.</p></div>
      <div class="yourtype">${fams.map(([family, items]) => `<div><span class="f" style="font-family:${esc(cssFamily(family))}">${esc(family)}</span><span class="w">${esc([...new Set(items.map((s) => ROLE_LABEL[roleOf(s)]))].join(', '))}</span></div>`).join('')}</div></section>
    ${fine(InformationCircleIcon, 'Opening the site from here is coming later. For now, copy your type and paste it in the extension.')}`,
    foot: `<button class="btn pri wide" id="copy"${site && c.length ? '' : ' disabled'}>${icon(Copy01Icon, 16)}Copy for Chrome</button>`,
  };
}

function webCopiedHtml() {
  return {
    body: `${subTop('web-site', '<b>See it on the web</b>')}
    <section class="card"><span class="bigic">${icon(Copy01Icon, 22)}</span><div class="ht"><h3>Copied</h3><p id="copied-how">In Chrome, open ${esc(copiedSite)}, click Font Finder Plus, then System → Paste type from Figma.</p></div></section>
    ${fine(InformationCircleIcon, "Only you see it. The website doesn't change.")}`,
    foot: `<button class="btn wide" id="copy">${icon(Copy01Icon, 16)}Copy again</button>`,
  };
}

// ------------------------------------------------------------- render

const SCREENS: Record<Screen, () => { body: string; foot?: string }> = {
  home: homeHtml, settings: settingsHtml,
  paste: pasteHtml, pastebox: pasteBoxHtml, preview: previewHtmlScreen, system: systemHtml, standins: standinsHtml,
  creating: creatingHtml, done: doneHtml, 'build-error': buildErrorHtml,
  'fix-select': fixSelectHtml, fix: fixHtml, fixed: fixedHtml,
  'web-styles': webStylesHtml, 'web-site': webSiteHtml, 'web-copied': webCopiedHtml,
};

function render() {
  const sc = document.querySelector('.body');
  const y = sc ? sc.scrollTop : 0;
  const active = document.activeElement as HTMLInputElement | null;
  const focusId = active?.id;
  const caret = active && 'selectionStart' in active ? active.selectionStart : null;
  const s = SCREENS[screen]();
  $('main')!.innerHTML = `<div class="body" data-screen="${screen}">${s.body}</div>${s.foot ? `<footer class="foot">${s.foot}</footer>` : ''}`;
  document.body.classList.toggle('has-foot', !!s.foot);
  const n = document.querySelector('.body');
  if (n) n.scrollTop = y;
  if (focusId && (focusId === 'site' || focusId === 'manual')) {
    const el = $<HTMLInputElement>(focusId);
    el?.focus();
    if (el && caret != null) el.setSelectionRange(caret, caret);
  }
}

function go(s: Screen) {
  screen = s;
  dd = null;
  if (s === 'web-styles' && !webStyles) post({ type: 'web-styles' });
  if (s === 'paste' || s === 'pastebox') pasteError = false;
  render();
  const n = document.querySelector('.body');
  if (n) n.scrollTop = 0;
  if (s === 'home' || s === 'paste') $('paste')?.focus();
  if (s === 'pastebox') $('manual')?.focus();
  if (s === 'web-site') $('site')?.focus();
}

// ------------------------------------------------------------- actions

function handleText(t: string) {
  const p = parsePayload(t);
  if (!p) {
    if (!t.trim()) return;
    pasteError = true;
    if (screen !== 'pastebox') screen = 'paste';
    render();
    toast('That is not from Font Finder Plus. In Chrome, click Copy for Figma first.');
    return;
  }
  payload = p;
  status = null;
  built = null;
  choice.clear();
  pasteError = false;
  pasteText = '';
  opts.styles = true;
  opts.variables = settings.variables;
  opts.specimen = settings.specimen;
  go('preview');
  post({ type: 'check', payload: p });
}

function startBuild() {
  const p = payload;
  if (!p || !status) return;
  steps = [{ id: 'fonts', label: 'Loading fonts', n: String(p.fonts.length) }];
  if (opts.variables) steps.push({ id: 'vars', label: 'Adding variables', n: String(stepCounts().vars) });
  if (opts.styles) steps.push({ id: 'styles', label: 'Making text styles', n: String(p.styles.length) });
  if (opts.specimen) steps.push({ id: 'page', label: 'Drawing the style guide', n: '1 page' });
  stepNow = 0;
  go('creating');
  post({
    type: 'build',
    payload: p,
    choices: p.fonts.map((f) => ({ key: f.key, family: currentStandIn(f) })),
    opts: { ...opts, naming: settings.naming },
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
  else if (/specimen|style guide/i.test(msg)) i = at('page');
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

function toast(m: string) {
  const el = $('toast')!;
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
  if (screen === 'home') go('paste');
  else toast(`Press ${isMac ? '⌘' : 'Ctrl'}+V to paste, or use the box.`);
}

/** Copy text from the plugin window. Figma's iframe allows execCommand on a click. */
async function copyText(t: string): Promise<boolean> {
  const ta = document.createElement('textarea');
  ta.value = t;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  ta.remove();
  if (ok) return true;
  try {
    await navigator.clipboard.writeText(t);
    return true;
  } catch {
    return false;
  }
}

async function copyForChrome() {
  const site = normalizeSite(siteInput);
  if (!site || !webStyles) return;
  const c = chosen();
  const name = payloadName(file || 'Untitled', c.map((s) => s.name));
  const json = JSON.stringify(buildWebPayload(name, site.url, webStyles, c.map((s) => ({ id: s.id, role: roleOf(s) }))));
  if (!(await copyText(json))) return toast("Couldn't copy. Try again.");
  copiedSite = site.label;
  post({ type: 'remember-site', site: site.label });
  if (screen === 'web-copied') toast('Copied again');
  else go('web-copied');
}

function setRole(id: string, r: Role) {
  if (r === 'none') use.set(id, false);
  else {
    use.set(id, true);
    roles.set(id, r);
  }
}

// ------------------------------------------------------------- events

document.addEventListener('click', (e) => {
  const t = e.target as HTMLElement;
  const q = <T extends HTMLElement = HTMLElement>(s: string) => t.closest<T>(s);
  let el: HTMLElement | null;
  if (dd && !q('.dd')) {
    dd = null;
    render();
  }
  if ((el = q('[data-go]'))) {
    if ((el as HTMLButtonElement).disabled) return;
    return go(el.dataset.go as Screen);
  }
  if (q('#paste')) return void pasteClick();
  if (q('#readbox')) return handleText(pasteText);
  if (q('#recheck')) return recheck();
  if (q('#again')) {
    payload = null;
    status = null;
    built = null;
    return go('home');
  }
  if (q('#build')) return startBuild();
  if (q('#gotopage')) return post({ type: 'goto-page' });
  if (q('#fixscan')) {
    scanning = true;
    render();
    return post({ type: 'fix-scan' });
  }
  if (q('#fixapply')) {
    const map: Record<string, string> = {};
    for (const f of scan?.fonts ?? []) {
      const to = fixTo.get(f.family);
      if (to) map[f.family] = to;
    }
    scanning = true;
    return post({ type: 'fix-apply', map, link });
  }
  if (q('#link')) {
    link = !link;
    return render();
  }
  if (q('#copy')) return void copyForChrome();
  if (q('#clear-sites')) {
    recent = [];
    render();
    return post({ type: 'clear-sites' });
  }
  if ((el = q('[data-forget]'))) {
    const h = el.dataset.forget!;
    recent = recent.filter((x) => x !== h);
    render();
    toast(`Removed ${h}`);
    return post({ type: 'forget-site', site: h });
  }
  if ((el = q('[data-site]'))) {
    siteInput = el.dataset.site!;
    return render();
  }
  if ((el = q('[data-def]'))) {
    const k = el.dataset.def as 'variables' | 'specimen';
    settings = { ...settings, [k]: !settings[k] };
    render();
    return post({ type: 'settings', settings });
  }
  if ((el = q('[data-naming]'))) {
    settings = { ...settings, naming: el.dataset.naming as Settings['naming'] };
    render();
    return post({ type: 'settings', settings });
  }
  if ((el = q('[data-dd]'))) {
    dd = dd === el.dataset.dd ? null : el.dataset.dd!;
    render();
    placeMenu();
    return;
  }
  if ((el = q('[data-pick]'))) {
    if (el.getAttribute('aria-disabled') === 'true') return;
    const key = el.dataset.pick!;
    const fam = el.dataset.family!;
    if (key.startsWith('s:')) choice.set(key.slice(2), fam);
    else if (key.startsWith('f:')) fixTo.set(key.slice(2), fam);
    dd = null;
    render();
    return focusDd(key);
  }
  if ((el = q('[data-role]'))) {
    const id = el.dataset.role!;
    setRole(id, el.dataset.value as Role);
    dd = null;
    render();
    return focusDd(`r:${id}`);
  }
  if ((el = q('[data-use]'))) {
    const id = el.dataset.use!;
    const s = webStyles?.find((x) => x.id === id);
    if (!s) return;
    if (use.get(id)) use.set(id, false);
    else setRole(id, roles.get(id) && roles.get(id) !== 'none' ? roles.get(id)! : roleWhenTicked(s));
    return render();
  }
  if ((el = q('[data-opt]'))) {
    const k = el.dataset.opt as keyof typeof opts;
    opts[k] = !opts[k];
    return render();
  }
  if ((el = q('[data-url]'))) post({ type: 'open', url: el.dataset.url });
});

const focusDd = (k: string | null) => k && document.querySelector<HTMLElement>(`[data-dd="${CSS.escape(k)}"]`)?.focus();

/** Open a menu upwards when there is no room below, and focus the chosen option. */
function placeMenu() {
  const ul = document.querySelector<HTMLElement>('.dd .menu');
  if (!ul) return;
  const sc = document.querySelector('.body')!.getBoundingClientRect();
  const r = ul.getBoundingClientRect();
  if (r.bottom > sc.bottom && r.top - r.height - 50 > sc.top) ul.classList.add('up');
  (ul.querySelector<HTMLElement>('[aria-selected="true"]') ?? ul.querySelector<HTMLElement>('li'))?.focus();
}

document.addEventListener('keydown', (e) => {
  const t = e.target as HTMLElement;
  if (dd && e.key === 'Escape') {
    const k = dd;
    dd = null;
    render();
    focusDd(k);
    return;
  }
  if (t.matches('.menu li') && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
    e.preventDefault();
    const items = Array.from(t.parentElement!.querySelectorAll<HTMLElement>('li'));
    const i = items.indexOf(t) + (e.key === 'ArrowDown' ? 1 : -1);
    items[(i + items.length) % items.length].focus();
  } else if (t.matches('.menu li') && (e.key === 'Enter' || e.key === ' ')) {
    e.preventDefault();
    t.click();
  } else if (t.id === 'site' && e.key === 'Enter') {
    e.preventDefault();
    void copyForChrome();
  }
});

document.addEventListener('input', (e) => {
  const t = e.target as HTMLInputElement;
  if (t.id === 'manual') {
    pasteText = t.value;
    if (parsePayload(pasteText)) return handleText(pasteText);
    const b = $<HTMLButtonElement>('readbox');
    if (b) b.disabled = !pasteText.trim();
  } else if (t.id === 'site') {
    siteInput = t.value;
    const site = normalizeSite(siteInput);
    const b = $<HTMLButtonElement>('copy');
    if (b) b.disabled = !site || !chosen().length;
    document.querySelectorAll<HTMLElement>('.rchip').forEach((c) => {
      const on = c.querySelector<HTMLElement>('.rp')!.dataset.site === site?.label;
      c.classList.toggle('on', on);
      c.querySelector('.rp')!.setAttribute('aria-pressed', String(on));
    });
  }
});

document.addEventListener('paste', (e) => {
  const t = e.target as HTMLElement;
  if (t?.id === 'manual' || t?.id === 'site' || t?.tagName === 'INPUT') return;
  if (screen === 'creating') return;
  const text = e.clipboardData?.getData('text/plain') ?? '';
  e.preventDefault();
  handleText(text);
});

window.onmessage = (e: MessageEvent) => {
  const msg = e.data?.pluginMessage;
  if (!msg) return;
  if (msg.type === 'init') {
    file = msg.file ?? file;
    if (msg.settings) settings = msg.settings;
    if (msg.recent) recent = msg.recent;
    if (msg.selection) selection = msg.selection;
    standIns = msg.standIns ?? { count: msg.saved ?? 0, styles: [], fonts: [] };
    if (['home', 'settings', 'fix-select'].includes(screen)) render();
  } else if (msg.type === 'checked') {
    status = msg.status;
    if (['preview', 'system', 'standins'].includes(screen)) render();
  } else if (msg.type === 'progress') {
    onProgress(String(msg.msg ?? ''));
  } else if (msg.type === 'built') {
    built = msg.result as Built;
    webStyles = null; // the file's styles changed
    stepNow = steps.length;
    render();
    window.setTimeout(() => go('done'), 350);
  } else if (msg.type === 'rechecked') {
    const r = msg.result as { swapped: number; still: string[]; total: number; standIns?: StandIns };
    checking = false;
    if (r.standIns) standIns = r.standIns;
    stillMissing = !r.swapped && r.still.length > 0;
    webStyles = null;
    toast(r.swapped ? `Swapped the real font into ${plural(r.swapped, 'text style')}.` : r.still.length ? `Still not installed: ${list(r.still)}.` : 'All styles already use the real fonts.');
    if (built) built.missing = built.missing.filter((n) => r.still.includes(n));
    render();
  } else if (msg.type === 'web-styles' && Array.isArray(msg.styles)) {
    webStyles = msg.styles as WebStyle[];
    if (msg.file) file = msg.file;
    for (const s of webStyles) {
      if (!roles.has(s.id)) roles.set(s.id, s.role === 'none' ? roleWhenTicked(s) : s.role);
      if (!use.has(s.id)) use.set(s.id, s.role !== 'none');
    }
    if (screen === 'web-styles' || screen === 'web-site') render();
  } else if (msg.type === 'recent' && Array.isArray(msg.recent)) {
    recent = msg.recent;
    if (screen === 'settings' || screen === 'web-site') render();
  } else if (msg.type === 'settings' && msg.settings) {
    settings = msg.settings;
  } else if (msg.type === 'selection') {
    selection = msg.selection;
    if (screen === 'fix-select') render();
  } else if (msg.type === 'fix-scanned') {
    scanning = false;
    scan = msg.result as Scan;
    for (const f of scan.fonts) if (!fixTo.has(f.family) || !f.candidates.some((c) => c.family === fixTo.get(f.family))) {
      if (f.candidates[0]) fixTo.set(f.family, f.candidates[0].family);
      else fixTo.delete(f.family);
    }
    go('fix');
  } else if (msg.type === 'fixed') {
    scanning = false;
    fixResult = msg.result as FixResult;
    webStyles = null;
    go('fixed');
  } else if (msg.type === 'error') {
    checking = false;
    scanning = false;
    if (msg.during === 'build' || screen === 'creating') {
      buildError = String(msg.msg ?? 'Something went wrong.');
      go('build-error');
    } else {
      toast(`Something went wrong: ${msg.msg}`);
      render();
    }
  }
};

render();
$('paste')?.focus();
