// The plugin window. Reads a paste from Font Finder Plus, shows each font with
// whether this Figma has it, and sends the choices to the plugin code.
import { Alert02Icon, ArrowUpRight01Icon, ClipboardIcon, Tick02Icon } from '@hugeicons/core-free-icons';
import { parsePayload, type FigmaFont, type FigmaPayload } from '../../src/shared/figma-payload';

type IconNode = [string, Record<string, string>][];
const icon = (node: unknown, size = 14) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" aria-hidden="true">${(node as IconNode)
    .map(([tag, a]) => `<${tag} ${Object.entries(a).filter(([k]) => k !== 'key').map(([k, v]) => `${k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())}="${v}"`).join(' ')}/>`)
    .join('')}</svg>`;

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const post = (msg: Record<string, unknown>) => parent.postMessage({ pluginMessage: msg }, '*');

type Status = Record<string, { real: string | null; standIns: Record<string, boolean> }>;
let payload: FigmaPayload | null = null;
let status: Status | null = null;
const choice = new Map<string, string | null>();
let saved = 0;

function previewHtml(f: FigmaFont) {
  if (f.preview?.kind === 'svg') return `<img class="pv" alt="${esc(f.name)} drawn in the font" src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(f.preview.svg)}">`;
  if (f.preview?.kind === 'png') return `<img class="pv" alt="${esc(f.name)} drawn in the font" src="${esc(f.preview.data)}">`;
  return `<span class="pv none">No preview: the font file could not be read.</span>`;
}

function standInOptions(f: FigmaFont, st: Status[string]) {
  const opts = [f.standIn, ...f.alternatives].filter((a): a is { family: string; score: number } => !!a);
  if (!opts.length) return '<span class="muted">No free look-alike found. Inter will stand in.</span>';
  const current = choice.get(f.key) ?? opts.find((o) => st.standIns[o.family])?.family ?? null;
  choice.set(f.key, current);
  if (!current) {
    return `<span class="muted small">Its free look-alikes (${opts.map((o) => esc(o.family)).join(', ')}) are not in this Figma. A similar ${f.classification === 'mono' ? 'monospace' : f.classification === 'serif' ? 'serif' : 'sans serif'} font Figma has will stand in.</span>`;
  }
  return `<label class="pick"><span>Stand in with</span><select data-key="${esc(f.key)}">${opts
    .map((o) => `<option value="${esc(o.family)}"${o.family === current ? ' selected' : ''}${st.standIns[o.family] ? '' : ' disabled'}>${esc(o.family)} · ${o.score}%${st.standIns[o.family] ? '' : ' (not in Figma)'}</option>`)
    .join('')}</select></label>`;
}

function renderStart() {
  $('main').innerHTML = `
    <div class="paste" id="paste" tabindex="0" role="button" aria-label="Paste from Font Finder Plus">
      ${icon(ClipboardIcon, 28)}
      <b>Paste from Font Finder Plus</b>
      <span>Press ${/Mac/.test(navigator.platform) ? '⌘' : 'Ctrl'}+V here</span>
    </div>
    <ol class="steps">
      <li>In Chrome, open a website and click the Font Finder Plus icon.</li>
      <li>In the side panel, click <b>Send to Figma</b> (Page tab or System tab).</li>
      <li>Come back here and paste.</li>
    </ol>
    <textarea id="manual" aria-label="Or paste here" placeholder="Or paste into this box"></textarea>
    <div class="card">
      <b>Fix a captured page</b>
      <span class="muted">Imported a web page with Figma's capture or HTML to Figma? Select its frames (or nothing, for the whole page) to find text in fonts you do not have and swap in look-alikes Figma has.</span>
      <button class="btn" id="findmissing">Find missing fonts</button>
    </div>
    ${saved ? `<div class="card"><span>${saved} text styles or layers in this file use stand-ins from Font Finder Plus.</span><button class="btn" id="recheck">Check again for installed fonts</button></div>` : ''}
    <p class="muted small">Nothing leaves your computer. This plugin makes no network requests.</p>`;
  $('paste').focus();
  $('manual').addEventListener('input', (e) => handleText((e.target as HTMLTextAreaElement).value));
  $('findmissing').addEventListener('click', () => {
    $('findmissing').textContent = 'Looking…';
    post({ type: 'find-missing' });
  });
  $('recheck')?.addEventListener('click', () => {
    $('recheck').textContent = 'Checking…';
    post({ type: 'recheck' });
  });
}

function renderFonts() {
  if (!payload) return;
  const p = payload;
  const missing = status ? p.fonts.filter((f) => !status![f.key]?.real).length : 0;
  $('main').innerHTML = `
    <header class="site">
      <div><b>${esc(p.site.host)}</b><span class="muted">${p.fonts.length} fonts · ${p.styles.length} text styles${p.scale ? ` · ${esc(p.scale.name)} scale` : ''}</span></div>
      <button class="link" id="again">Paste another</button>
    </header>
    ${status ? `<div class="summary ${missing ? 'warn' : 'ok'}">${icon(missing ? Alert02Icon : Tick02Icon)}<span>${missing ? `${missing} of ${p.fonts.length} fonts are not installed in Figma. Free look-alikes will stand in until you install them.` : 'Every font is installed in Figma.'}</span></div>` : '<div class="summary">Checking which fonts this Figma has…</div>'}
    <ul class="fonts">${p.fonts
      .map((f) => {
        const st = status?.[f.key];
        const chip = !st ? '' : st.real ? `<span class="chip ok">${icon(Tick02Icon, 12)}Installed</span>` : `<span class="chip warn">Not installed</span>`;
        return `<li class="font">
          ${previewHtml(f)}
          <div class="row"><b class="name">${esc(f.name)}</b>${chip}</div>
          <span class="lic lic-${esc(f.licence.type)}">${esc(f.licence.name)}</span>
          <span class="muted small">${esc(f.licence.short)} This is a summary, not legal advice.</span>
          <span class="muted small">${f.foundry ? `Foundry: ${esc(f.foundry)}` : 'Foundry: unknown'} · served by ${esc(f.source)}${f.roles.length ? ` · ${esc(f.roles.join(', '))}` : ''}</span>
          ${f.getIt ? `<button class="link" data-open="${esc(f.getIt.url)}">Get it: ${esc(f.getIt.label)} ${icon(ArrowUpRight01Icon, 12)}</button>` : ''}
          ${st && !st.real ? standInOptions(f, st) : ''}
        </li>`;
      })
      .join('')}</ul>
    <fieldset class="opts">
      <legend>Create</legend>
      <label><input type="checkbox" id="o-styles" checked> Text styles (${p.styles.length})</label>
      <label><input type="checkbox" id="o-vars" checked> Variables for sizes and line heights</label>
      <label><input type="checkbox" id="o-page" checked> A specimen page with licences and links</label>
    </fieldset>
    <button class="btn primary" id="build"${status ? '' : ' disabled'}>Create in Figma</button>
    <p class="muted small" id="progress" role="status"></p>`;
  $('again').addEventListener('click', () => {
    payload = null;
    status = null;
    renderStart();
  });
  document.querySelectorAll<HTMLSelectElement>('select[data-key]').forEach((s) => s.addEventListener('change', () => choice.set(s.dataset.key!, s.value)));
  document.querySelectorAll<HTMLButtonElement>('[data-open]').forEach((b) => b.addEventListener('click', () => post({ type: 'open', url: b.dataset.open })));
  $('build').addEventListener('click', () => {
    ($('build') as HTMLButtonElement).disabled = true;
    $('build').textContent = 'Creating…';
    post({
      type: 'build',
      payload: p,
      choices: p.fonts.map((f) => ({ key: f.key, family: choice.get(f.key) ?? null })),
      opts: { styles: ($('o-styles') as HTMLInputElement).checked, variables: ($('o-vars') as HTMLInputElement).checked, specimen: ($('o-page') as HTMLInputElement).checked },
    });
  });
}

interface Missing { family: string; styles: string[]; layers: number; source: 'google' | 'paid' | 'free-elsewhere' | 'unknown'; getIt: { label: string; url: string } | null; options: { family: string; score: number | null }[] }
const SOURCE_TEXT: Record<Missing['source'], string> = {
  google: 'Free on Google Fonts. Figma may not have it yet: install it from Google Fonts.',
  paid: 'A paid font.',
  'free-elsewhere': 'Free, from outside Google Fonts.',
  unknown: 'Not in the font lists we know.',
};
const fixChoice = new Map<string, string>();

function renderMissing(list: Missing[], checked: number, scope: string, site: string | null) {
  fixChoice.clear();
  $('main').innerHTML = `
    <header class="site">
      <div><b>${list.length ? `${list.length} missing ${list.length === 1 ? 'font' : 'fonts'}` : 'No missing fonts'}</b><span class="muted">${checked} text layers checked in the ${scope === 'selection' ? 'selection' : 'whole page'}${site ? ` · look-alikes from your scan of ${esc(site)}` : ''}</span></div>
      <button class="link" id="back">Back</button>
    </header>
    ${list.length ? '' : '<div class="summary ok">Every font in these layers is available in Figma.</div>'}
    <ul class="fonts">${list
      .map((m) => {
        if (m.options[0]) fixChoice.set(m.family, m.options[0].family);
        return `<li class="font">
          <div class="row"><b class="name">${esc(m.family)}</b><span class="chip warn">${m.layers} ${m.layers === 1 ? 'layer' : 'layers'}</span></div>
          <span class="muted small">${esc(m.styles.join(', '))}. ${SOURCE_TEXT[m.source]}</span>
          ${m.getIt ? `<button class="link" data-open="${esc(m.getIt.url)}">Get it: ${esc(m.getIt.label)} ${icon(ArrowUpRight01Icon, 12)}</button>` : ''}
          ${m.options.length
            ? `<label class="pick"><span>Replace with</span><select data-fix="${esc(m.family)}">${m.options.map((o) => `<option value="${esc(o.family)}">${esc(o.family)}${o.score != null ? ` · ${o.score}%` : ''}</option>`).join('')}</select></label>`
            : '<span class="muted small">No replacement found in this Figma.</span>'}
        </li>`;
      })
      .join('')}</ul>
    ${list.length ? `<button class="btn primary" id="fix">Replace in ${list.reduce((n, m) => n + m.layers, 0)} layers</button><p class="muted small">The original font is kept with each layer. After you install it, run this plugin and click Check again to switch back.</p>` : ''}
    <p class="muted small" id="progress" role="status"></p>`;
  $('back').addEventListener('click', () => renderStart());
  document.querySelectorAll<HTMLSelectElement>('select[data-fix]').forEach((s) => s.addEventListener('change', () => fixChoice.set(s.dataset.fix!, s.value)));
  document.querySelectorAll<HTMLButtonElement>('[data-open]').forEach((b) => b.addEventListener('click', () => post({ type: 'open', url: b.dataset.open })));
  document.getElementById('fix')?.addEventListener('click', () => {
    ($('fix') as HTMLButtonElement).disabled = true;
    $('fix').textContent = 'Replacing…';
    post({ type: 'fix-missing', choices: Object.fromEntries(fixChoice) });
  });
}

function handleText(t: string) {
  const p = parsePayload(t);
  if (!p) {
    if (t.trim()) toast('That is not from Font Finder Plus. In Chrome, click Send to Figma in the side panel first.');
    return;
  }
  payload = p;
  status = null;
  choice.clear();
  renderFonts();
  post({ type: 'check', payload: p });
}

let toastTimer = 0;
function toast(m: string) {
  const el = $('toast');
  el.textContent = m;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (el.hidden = true), 4000);
}

document.addEventListener('paste', (e) => {
  if ((e.target as HTMLElement)?.id === 'manual') return;
  const t = e.clipboardData?.getData('text/plain') ?? '';
  e.preventDefault();
  handleText(t);
});

window.onmessage = (e: MessageEvent) => {
  const msg = e.data?.pluginMessage;
  if (!msg) return;
  if (msg.type === 'init') {
    saved = msg.saved;
    if (!payload) renderStart();
  } else if (msg.type === 'checked') {
    status = msg.status;
    renderFonts();
  } else if (msg.type === 'progress') {
    const el = document.getElementById('progress');
    if (el) el.textContent = msg.msg;
  } else if (msg.type === 'built') {
    const r = msg.result as { styles: number; variables: number; page: string | null; missing: string[] };
    const el = document.getElementById('progress');
    if (el) el.textContent = `Done. ${r.styles} text styles, ${r.variables} variables${r.page ? `, and the page "${r.page}"` : ''}.${r.missing.length ? ` Install ${r.missing.join(', ')}, then reopen this plugin and click Check again to swap the real fonts in.` : ''}`;
    $('build').textContent = 'Create again';
    ($('build') as HTMLButtonElement).disabled = false;
  } else if (msg.type === 'missing') {
    renderMissing(msg.missing, msg.checked, msg.scope, msg.site);
  } else if (msg.type === 'fixed') {
    const el = document.getElementById('progress');
    if (el) el.textContent = `Done. Replaced fonts in ${msg.changed} layers${msg.failed ? `; ${msg.failed} could not be changed` : ''}.`;
    const b = document.getElementById('fix');
    if (b) b.textContent = 'Replaced';
  } else if (msg.type === 'rechecked') {
    const r = msg.result as { swapped: number; still: string[]; total: number };
    toast(r.swapped ? `Swapped the real font into ${r.swapped} text styles.` : r.still.length ? `Still not installed: ${r.still.join(', ')}.` : 'All styles already use the real fonts.');
    const b = document.getElementById('recheck');
    if (b) b.textContent = 'Check again for installed fonts';
  } else if (msg.type === 'error') {
    toast(`Something went wrong: ${msg.msg}`);
    const b = document.getElementById('build') as HTMLButtonElement | null;
    if (b) {
      b.disabled = false;
      b.textContent = 'Create in Figma';
    }
  }
};

renderStart();
