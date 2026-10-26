import { CLASS_LABEL, SOURCE_LABEL, licenseBadge } from '../shared/catalog';
import { declarationCss, lineHeightLabel, rgbToHex, round, weightLabel } from '../shared/css';
import { Bookmark02Icon, Cancel01Icon, Copy01Icon, KeyboardIcon, PinIcon, Tick02Icon, iconSvg } from '../shared/icons';
import type { ElementFontInfo } from '../shared/types';
import { OWN_FONT_PREFIX, elementLabel, facesFor, familyCss, fontFacts, loadFaceMap, measureMetrics, resolveRendered, roleOf, type Rendered } from './detect';
import { elementsForKey, isOurNode } from './scan';
import { css } from './inspector-css';

interface Current {
  el: Element;
  info: ElementFontInfo;
  rendered: Rendered;
  fileUrl: string | null;
}

let root: ShadowRoot | null = null;
let host: HTMLDivElement | null = null;
let active = false;
let pinned = false;
let current: Current | null = null;
let lastMouse = { x: 0, y: 0 };
let rafPending = false;
let tipDismissed = false;
let copiedRow: string | null = null;
let saved = false;
let uiFontsLoaded = false;
let onStateChange: (on: boolean) => void = () => {};

const $ = <T extends Element>(sel: string) => root!.querySelector(sel) as T;

export function setStateListener(fn: (on: boolean) => void) {
  onStateChange = fn;
}

export function isInspecting() {
  return active;
}

async function loadUiFonts() {
  if (uiFontsLoaded) return;
  uiFontsLoaded = true;
  const load = async (file: string, family: string) => {
    try {
      const buf = await (await fetch(chrome.runtime.getURL(`fonts/${file}`))).arrayBuffer();
      const face = new FontFace(`${OWN_FONT_PREFIX}${family}`, buf, { weight: '100 900' });
      await face.load();
      document.fonts.add(face);
    } catch {
      /* falls back to system-ui; the tooltip still works */
    }
  };
  await Promise.all([load('Inter.woff2', 'Inter'), load('JetBrainsMono.woff2', 'JetBrains Mono')]);
}

function ensureUi() {
  if (root) return;
  host = document.createElement('div');
  host.id = 'ffp-root';
  host.style.cssText = 'all: initial; position: fixed; inset: 0; pointer-events: none; z-index: 2147483647;';
  root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `
    <style>${css}</style>
    <div class="hl" hidden></div>
    <div class="marks"></div>
    <div class="card" role="dialog" aria-label="Font details" hidden>
      <div class="head">
        <div class="titles">
          <div class="name"></div>
          <div class="meta"></div>
          <div class="fallback" hidden></div>
        </div>
        <span class="chip"></span>
        <button class="iconbtn pin" aria-label="Pin this card" title="Pin (Space)">${iconSvg(PinIcon, 15)}</button>
      </div>
      <canvas class="metrics" width="576" height="208"></canvas>
      <div class="rows"></div>
      <div class="foot">
        <button class="btn primary copycss">${iconSvg(Copy01Icon, 14)}<span>Copy all as CSS</span></button>
        <button class="btn save">${iconSvg(Bookmark02Icon, 14)}<span>Save to library</span></button>
      </div>
    </div>
    <div class="tip" hidden>
      ${iconSvg(KeyboardIcon, 15)}
      <span>Press <kbd>Space</kbd> to pin, <kbd>Esc</kbd> to stop</span>
      <button class="iconbtn x" aria-label="Hide this tip">${iconSvg(Cancel01Icon, 12, 2)}</button>
    </div>`;
  document.documentElement.appendChild(host);

  $('.pin').addEventListener('click', (e) => {
    e.stopPropagation();
    setPinned(!pinned);
  });
  $('.copycss').addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!current) return;
    const s = current.info;
    await copyText(
      declarationCss(s.declared, {
        fontSize: s.fontSize,
        fontWeight: s.weight,
        fontStyle: s.style,
        lineHeight: s.lineHeight,
        letterSpacing: s.letterSpacing,
        color: s.color,
      }),
    );
    flashButton('.copycss', 'Copied CSS');
  });
  $('.save').addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!current) return;
    const reply = await new Promise<{ ok: boolean } | null>((resolve) =>
      chrome.runtime.sendMessage(
        { type: 'ffp:save-from-page', info: current!.info, pageUrl: location.href, fileUrl: current!.fileUrl, files: current!.info.kind === 'web' ? facesFor(current!.info.family) : [] },
        (r) => resolve(chrome.runtime.lastError ? null : r),
      ),
    );
    saved = !!reply?.ok;
    flashButton('.save', saved ? 'Saved' : 'Could not save');
  });
  $('.rows').addEventListener('click', async (e) => {
    const btn = (e.target as Element).closest('button[data-copy]') as HTMLButtonElement | null;
    if (!btn) return;
    e.stopPropagation();
    await copyText(btn.dataset.copy!);
    copiedRow = btn.dataset.key!;
    renderRows();
    setTimeout(() => {
      copiedRow = null;
      renderRows();
    }, 1400);
  });
  $('.tip .x').addEventListener('click', (e) => {
    e.stopPropagation();
    tipDismissed = true;
    $<HTMLElement>('.tip').hidden = true;
    chrome.storage.local.set({ tipDismissed: true });
  });
}

function flashButton(sel: string, text: string) {
  const b = $<HTMLButtonElement>(sel);
  const span = b.querySelector('span')!;
  const prev = span.textContent;
  span.textContent = text;
  b.classList.add('done');
  setTimeout(() => {
    span.textContent = prev;
    b.classList.remove('done');
  }, 1500);
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    /* fall back below */
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;left:-9999px;top:0;';
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  ta.remove();
}

// ------------------------------------------------------------------ info

function infoFor(el: Element): Current {
  const cs = getComputedStyle(el);
  let text = '';
  el.childNodes.forEach((n) => {
    if (n.nodeType === Node.TEXT_NODE) text += n.nodeValue;
  });
  if (!text.trim()) text = (el.textContent ?? '').slice(0, 200);
  const rendered = resolveRendered(cs.fontFamily, cs.fontWeight, cs.fontStyle, text);
  const facts = fontFacts(rendered);
  const size = parseFloat(cs.fontSize);
  const m = measureMetrics(familyCss(rendered), cs.fontWeight, cs.fontStyle, size);
  const info: ElementFontInfo = {
    family: rendered.family,
    kind: rendered.kind,
    genericName: rendered.genericName,
    source: facts.source,
    sourceHost: facts.host,
    declared: rendered.declared,
    fellBackFrom: rendered.fellBackFrom,
    role: roleOf(el),
    tag: elementLabel(el),
    weight: cs.fontWeight,
    style: cs.fontStyle,
    fontSize: size,
    lineHeight: cs.lineHeight,
    letterSpacing: cs.letterSpacing,
    color: cs.color,
    capHeight: m.cap ? round(m.cap, 1) : null,
    xHeight: m.x ? round(m.x, 1) : null,
    licenseType: facts.licenseType,
    classification: facts.classification,
  };
  return { el, info, rendered, fileUrl: facts.fileUrl };
}

// ------------------------------------------------------------------ render

function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

function renderCard() {
  if (!current) return;
  const { info, rendered } = current;
  const name = $<HTMLElement>('.name');
  name.textContent = info.family;
  name.style.fontFamily = `${familyCss(rendered)}, system-ui`;
  name.style.fontWeight = info.weight;
  name.style.fontStyle = info.style;
  const src = info.kind === 'web' ? SOURCE_LABEL[info.source] : info.kind === 'generic' ? 'Browser default' : 'System font';
  $<HTMLElement>('.meta').textContent = `[${info.tag} · ${src.toUpperCase()}]`;
  const fb = $<HTMLElement>('.fallback');
  fb.hidden = !info.fellBackFrom.length;
  fb.textContent = info.fellBackFrom.length ? `Fallback: ${info.fellBackFrom.join(', ')} did not load` : '';
  const badge = licenseBadge(info.licenseType);
  const chip = $<HTMLElement>('.chip');
  chip.className = `chip ${badge.tone}`;
  chip.innerHTML = `<span class="dot"></span>${badge.text}`;
  chip.title = `${CLASS_LABEL[info.classification]} · ${badge.text}`;
  $<HTMLElement>('.pin').classList.toggle('on', pinned);
  drawMetrics();
  renderRows();
}

function renderRows() {
  if (!current) return;
  const i = current.info;
  const rows: { key: string; label: string; value: string; copy: string; swatch?: string }[] = [
    { key: 'weight', label: 'Weight', value: weightLabel(i.weight), copy: i.weight },
    { key: 'style', label: 'Style', value: i.style[0].toUpperCase() + i.style.slice(1), copy: i.style },
    { key: 'size', label: 'Size', value: `${round(i.fontSize, 2)}px`, copy: `${round(i.fontSize, 2)}px` },
    { key: 'line', label: 'Line height', value: lineHeightLabel(i.lineHeight, i.fontSize), copy: i.lineHeight },
    { key: 'track', label: 'Tracking', value: i.letterSpacing === 'normal' ? 'Normal' : i.letterSpacing, copy: i.letterSpacing },
    { key: 'color', label: 'Color', value: rgbToHex(i.color), copy: rgbToHex(i.color).split(' ')[0], swatch: i.color },
  ];
  $<HTMLElement>('.rows').innerHTML = rows
    .map((r) => {
      const copied = copiedRow === r.key;
      return `<button class="row${copied ? ' copied' : ''}" data-copy="${escapeHtml(r.copy)}" data-key="${r.key}" title="Click to copy">
        <span class="k">${r.label}</span>
        <span class="v">${r.swatch ? `<span class="sw" style="background:${escapeHtml(r.swatch)}"></span>` : ''}${escapeHtml(r.value)}</span>
        <span class="s">${copied ? `${iconSvg(Tick02Icon, 13, 2)}Copied` : iconSvg(Copy01Icon, 13)}</span>
      </button>`;
    })
    .join('');
}

function drawMetrics() {
  if (!current) return;
  const canvas = $<HTMLCanvasElement>('.metrics');
  const c = canvas.getContext('2d')!;
  const W = canvas.width;
  const H = canvas.height;
  const scale = W / 288; // canvas is drawn at 2x
  c.clearRect(0, 0, W, H);
  c.fillStyle = '#F4F4F3';
  c.beginPath();
  c.roundRect(0, 0, W, H, 12 * scale);
  c.fill();
  const { info, rendered } = current;
  const fam = familyCss(rendered);
  const fs = 76 * scale;
  c.font = `${info.style} ${info.weight} ${fs}px ${fam}, serif`;
  const base = 80 * scale;
  const capA = c.measureText('H').actualBoundingBoxAscent;
  const xA = c.measureText('x').actualBoundingBoxAscent;
  const line = (y: number, color: string, dash: boolean) => {
    c.save();
    c.strokeStyle = color;
    c.lineWidth = 1 * scale;
    if (dash) c.setLineDash([4 * scale, 3 * scale]);
    c.beginPath();
    c.moveTo(0, Math.round(y) + 0.5);
    c.lineTo(W, Math.round(y) + 0.5);
    c.stroke();
    c.restore();
  };
  line(base - capA, '#8A8A86', true);
  line(base - xA, '#19C05A', true);
  line(base, '#111111', false);
  c.fillStyle = '#111111';
  c.textBaseline = 'alphabetic';
  c.fillText('Hxg', 14 * scale, base);
  c.font = `${10 * scale}px "${OWN_FONT_PREFIX}JetBrains Mono", ui-monospace, monospace`;
  c.textAlign = 'right';
  const label = (text: string, y: number, color: string) => {
    c.fillStyle = color;
    c.fillText(text, W - 10 * scale, y);
  };
  label(info.capHeight != null ? `CAP ${info.capHeight}` : 'CAP', base - capA - 5 * scale, '#5C5C5A');
  label(info.xHeight != null ? `X ${info.xHeight}` : 'X', base - xA - 5 * scale, '#0B7A37');
  label('BASELINE', base - 5 * scale, '#111111');
  c.textAlign = 'left';
}

function position() {
  if (!current) return;
  const card = $<HTMLElement>('.card');
  const tip = $<HTMLElement>('.tip');
  const w = card.offsetWidth;
  const h = card.offsetHeight;
  const vw = innerWidth;
  const vh = innerHeight;
  let x = lastMouse.x + 18;
  let y = lastMouse.y + 18;
  if (x + w > vw - 8) x = Math.max(8, lastMouse.x - w - 18);
  if (y + h + 46 > vh - 8) y = Math.max(8, lastMouse.y - h - 18);
  card.style.transform = `translate(${x}px, ${y}px)`;
  if (!tip.hidden) {
    const below = y + h + 10;
    const ty = below + 34 < vh ? below : Math.max(8, y - 44);
    tip.style.transform = `translate(${x}px, ${ty}px)`;
  }
  // highlight box
  const hl = $<HTMLElement>('.hl');
  const r = current.el.getBoundingClientRect();
  hl.hidden = false;
  hl.style.transform = `translate(${r.left - 4}px, ${r.top - 4}px)`;
  hl.style.width = `${r.width + 8}px`;
  hl.style.height = `${r.height + 8}px`;
}

function show(el: Element) {
  if (current?.el === el) {
    position();
    return;
  }
  current = infoFor(el);
  saved = false;
  copiedRow = null;
  const card = $<HTMLElement>('.card');
  card.hidden = false;
  $<HTMLElement>('.tip').hidden = tipDismissed;
  renderCard();
  position();
}

function setPinned(on: boolean) {
  pinned = on;
  $<HTMLElement>('.card').classList.toggle('pinned', on);
  $<HTMLElement>('.pin').classList.toggle('on', on);
  if (on && current) {
    chrome.runtime.sendMessage({ type: 'ffp:pinned', info: current.info, pageUrl: location.href }, () => void chrome.runtime.lastError);
  }
}

// ------------------------------------------------------------------ events

function targetAt(x: number, y: number): Element | null {
  const el = document.elementFromPoint(x, y);
  if (!el || isOurNode(el) || el === document.documentElement || el === document.body) return null;
  return el;
}

function onMove(e: MouseEvent) {
  lastMouse = { x: e.clientX, y: e.clientY };
  if (pinned || rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => {
    rafPending = false;
    const el = targetAt(lastMouse.x, lastMouse.y);
    if (el) show(el);
  });
}

function isTyping(e: KeyboardEvent) {
  const t = e.composedPath()[0] as HTMLElement | undefined;
  return !!t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    stop();
  } else if ((e.key === ' ' || e.code === 'Space') && !isTyping(e) && current) {
    e.preventDefault();
    e.stopPropagation();
    setPinned(!pinned);
  }
}

function onClick(e: MouseEvent) {
  if (isOurNode(e.composedPath()[0] as Node)) return;
  // Clicking the page pins the card instead of following links or pressing buttons.
  e.preventDefault();
  e.stopPropagation();
  lastMouse = { x: e.clientX, y: e.clientY };
  const el = targetAt(e.clientX, e.clientY);
  if (!el) return;
  pinned = false;
  current = null;
  show(el);
  setPinned(true);
}

function block(e: Event) {
  if (isOurNode(e.composedPath()[0] as Node)) return;
  e.preventDefault();
  e.stopPropagation();
}

function onScroll() {
  if (current) position();
}

export async function start() {
  if (active) return;
  active = true;
  ensureUi();
  host!.hidden = false;
  const st = await chrome.storage.local.get('tipDismissed');
  tipDismissed = !!st.tipDismissed;
  loadUiFonts();
  loadFaceMap();
  addEventListener('mousemove', onMove, true);
  addEventListener('keydown', onKey, true);
  addEventListener('click', onClick, true);
  addEventListener('mousedown', block, true);
  addEventListener('mouseup', block, true);
  addEventListener('scroll', onScroll, true);
  document.documentElement.style.setProperty('cursor', 'crosshair', 'important');
  onStateChange(true);
}

export function stop() {
  if (!active) return;
  active = false;
  pinned = false;
  current = null;
  removeEventListener('mousemove', onMove, true);
  removeEventListener('keydown', onKey, true);
  removeEventListener('click', onClick, true);
  removeEventListener('mousedown', block, true);
  removeEventListener('mouseup', block, true);
  removeEventListener('scroll', onScroll, true);
  document.documentElement.style.removeProperty('cursor');
  if (root) {
    $<HTMLElement>('.card').hidden = true;
    $<HTMLElement>('.tip').hidden = true;
    $<HTMLElement>('.hl').hidden = true;
  }
  onStateChange(false);
}

/** Outline every element using a font, for a moment (triggered from the side panel). */
export function highlightKey(key: string | null) {
  ensureUi();
  const marks = $<HTMLElement>('.marks');
  marks.innerHTML = '';
  if (!key) return;
  const els = elementsForKey(key);
  const frag = document.createDocumentFragment();
  for (const el of els) {
    const r = el.getBoundingClientRect();
    if (r.bottom < 0 || r.top > innerHeight) continue;
    const d = document.createElement('div');
    d.className = 'mark';
    d.style.transform = `translate(${r.left - 2}px, ${r.top - 2}px)`;
    d.style.width = `${r.width + 4}px`;
    d.style.height = `${r.height + 4}px`;
    frag.appendChild(d);
  }
  marks.appendChild(frag);
  setTimeout(() => {
    if (marks) marks.innerHTML = '';
  }, 2500);
  els[0]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
}
