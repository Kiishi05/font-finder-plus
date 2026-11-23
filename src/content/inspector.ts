import { CLASS_LABEL, SOURCE_LABEL, googleFamily, licenseBadge } from '../shared/catalog';
import { declarationCss, lineHeightLabel, rgbToHex, round, weightLabel } from '../shared/css';
import { Bookmark02Icon, LibBookmarkAddIcon as BookmarkAdd02Icon, Cancel01Icon, Copy01Icon, CursorPointer01Icon, PinIcon, RulerIcon, ScanImageIcon, SidebarRightIcon, SysTextFontIcon as TextFontIcon, Tick02Icon, iconSvg } from '../shared/icons';
import type { ElementFontInfo } from '../shared/types';
import { pictureContext } from './context';
import { OWN_FONT_PREFIX, elementLabel, facesFor, familyCss, fontFacts, loadFaceMap, measureMetrics, resolveRendered, roleOf, type Rendered } from './detect';
import { elementsForKey, familyOf, isClipped, isOurNode } from './scan';
import { css } from './inspector-css';

declare const __FFP_TEST__: boolean;

interface Current {
  el: Element;
  info: ElementFontInfo;
  rendered: Rendered;
  fileUrl: string | null;
  /** CSS font-family to draw the name and metrics with (the swapped-in font while a swap is on). */
  css?: string;
  /** The font this element showed before a swap ("Try on page", "Make it free"). */
  swappedFrom?: string;
  /** Hovering a picture (SVG drawing, image, canvas): there is no font to read. */
  picture?: { kind: 'svg' | 'image'; el: Element; text?: 'checking' | 'yes' | 'no' | 'unknown' };
}

let root: ShadowRoot | null = null;
let host: HTMLDivElement | null = null;
let active = false;
let pinned = false;
let current: Current | null = null;
let lastMouse = { x: 0, y: 0 };
let rafPending = false;
let copiedRow: string | null = null;
let saved = false;
let uiFontsLoaded = false;
let onStateChange: (on: boolean) => void = () => {};
/** The dock stays, but pointing at text does nothing (the Inspect button in the dock). */
let paused = false;
/** Whether the side panel is open in this window (told by the background). */
let panelOpen = false;
/** First-run tips above the dock: 0 point, 1 pin, 2 copy, 3 done. Kept in chrome.storage.local. */
let coachStep = 3;
const COACH_KEY = 'ffp:coachStep';
const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

const $ = <T extends Element>(sel: string) => root!.querySelector(sel) as T;

/** Read the card's element again (after a font swap or undo changed it). */
export function refreshCard() {
  if (!current || !root) return;
  const el = current.el;
  current = infoFor(el);
  renderCard();
}

/** Hide the extension's own things on the page for a moment (for screenshots). */
export function hideUi(hidden: boolean) {
  if (host) host.style.visibility = hidden ? 'hidden' : '';
}

export function setStateListener(fn: (on: boolean) => void) {
  onStateChange = fn;
}

export function isInspecting() {
  return active;
}

/** The dock is on the page but pointing at text does nothing. */
export function isPaused() {
  return active && paused;
}

/** From the side panel's switch: pause or resume, keeping the dock. */
export function pause(on: boolean) {
  if (!active || !root) return;
  if (paused !== on) setPaused(on);
}

async function loadUiFonts() {
  if (uiFontsLoaded) return;
  uiFontsLoaded = true;
  const load = async (file: string, family: string) => {
    try {
      const buf = await (await fetch(chrome.runtime.getURL(`fonts/${file}`))).arrayBuffer();
      const face = new FontFace(`${OWN_FONT_PREFIX}${family}`, buf, { weight: '100 900', unicodeRange: file.includes('-ext') ? 'U+0100-024F, U+1E00-1EFF, U+20A0-20CF, U+2C60-2C7F, U+A720-A7FF' : 'U+0000-00FF, U+0131, U+0152-0153, U+2000-206F, U+20AC, U+2122, U+2212' });
      await face.load();
      document.fonts.add(face);
    } catch {
      /* falls back to system-ui; the tooltip still works */
    }
  };
  await Promise.all([load('Geist.woff2', 'Geist'), load('Geist-ext.woff2', 'Geist'), load('GeistMono.woff2', 'Geist Mono'), load('GeistMono-ext.woff2', 'Geist Mono')]);
}

function ensureUi() {
  if (root) return;
  host = document.createElement('div');
  host.id = 'ffp-root';
  host.style.cssText = 'all: initial; position: fixed; inset: 0; pointer-events: none; z-index: 2147483647;';
  // Closed so pages cannot reach in. The test build opens it so tests can check the card.
  root = host.attachShadow({ mode: __FFP_TEST__ ? 'open' : 'closed' });
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
        <div class="tools">
          <span class="chip"></span>
          <button class="pin" aria-label="Pinned. Click to unpin" title="Unpin (Esc)" hidden>${iconSvg(PinIcon, 12)}<span>Pinned</span>${iconSvg(Cancel01Icon, 11)}</button>
        </div>
      </div>
      <canvas class="metrics" width="576" height="208"></canvas>
      <div class="rows"></div>
      <div class="picnote" hidden>
        <p></p>
        <button class="btn primary identify">${iconSvg(ScanImageIcon, 14)}<span>Identify the font in this picture</span></button>
      </div>
      <div class="foot" hidden>
        <button class="btn primary copycss">${iconSvg(Copy01Icon, 15)}<span>Copy CSS</span></button>
        <button class="btn save">${iconSvg(Bookmark02Icon, 15)}<span>Save</span></button>
        <button class="btn sq details" aria-label="Open the details in the side panel" title="Details in the side panel">${iconSvg(SidebarRightIcon, 16)}</button>
      </div>
      <p class="hint"></p>
    </div>
    <div class="coach" role="status" hidden><span class="step"></span><span class="ctext"></span><button class="cx" aria-label="Hide the tips">${iconSvg(Cancel01Icon, 13)}</button></div>
    <div class="dock" role="toolbar" aria-label="Font Finder Plus" hidden>
      <span class="grip" title="Drag to move" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></span>
      <button class="db" data-dock="inspect" aria-label="Inspect fonts" aria-pressed="true">${iconSvg(CursorPointer01Icon, 20)}<span class="tip">Inspect fonts<span class="k">${isMac ? '⌥⇧F' : 'Alt+Shift+F'}</span></span></button>
      <button class="db" data-dock="area" aria-label="Read a picture or an area">${iconSvg(ScanImageIcon, 20)}<span class="tip">Read a picture or an area</span></button>
      <button class="db" data-dock="fonts" aria-label="Every font on this page">${iconSvg(TextFontIcon, 20)}<span class="tip">Every font on this page</span></button>
      <button class="db" data-dock="system" aria-label="Type system">${iconSvg(RulerIcon, 20)}<span class="tip">Type system</span></button>
      <button class="db" data-dock="save" aria-label="Save the font">${iconSvg(BookmarkAdd02Icon, 20)}<span class="tip">Save the font<span class="k">S</span></span></button>
      <span class="sep"></span>
      <button class="db" data-dock="panel" aria-label="Side panel" aria-pressed="false">${iconSvg(SidebarRightIcon, 20)}<span class="tip">Open the side panel</span></button>
      <button class="db stop" data-dock="off" aria-label="Turn off">${iconSvg(Cancel01Icon, 20)}<span class="tip">Turn off<span class="k">Esc</span></span></button>
    </div>
    <div class="flag" hidden></div>`;
  document.documentElement.appendChild(host);

  $('.pin').addEventListener('click', (e) => {
    e.stopPropagation();
    setPinned(false);
  });
  $('.copycss').addEventListener('click', (e) => {
    e.stopPropagation();
    copyCss();
  });
  $('.save').addEventListener('click', (e) => {
    e.stopPropagation();
    saveCurrent();
  });
  $('.details').addEventListener('click', (e) => {
    e.stopPropagation();
    if (current) openPanel({ view: 'detail', family: current.info.displayName ?? current.info.family });
  });
  $('.rows').addEventListener('click', async (e) => {
    const btn = (e.target as Element).closest('button[data-copy]') as HTMLButtonElement | null;
    if (!btn) return;
    e.stopPropagation();
    await copyText(btn.dataset.copy!);
    copiedRow = btn.dataset.key!;
    renderRows();
    advanceCoach(3);
    setTimeout(() => {
      copiedRow = null;
      renderRows();
    }, 1400);
  });
  $('.identify').addEventListener('click', (e) => {
    e.stopPropagation();
    const pic = current?.picture;
    if (!pic) return;
    const r = pic.el.getBoundingClientRect();
    const rect = { x: Math.max(0, r.left), y: Math.max(0, r.top), w: Math.min(innerWidth, r.right) - Math.max(0, r.left), h: Math.min(innerHeight, r.bottom) - Math.max(0, r.top), dpr: devicePixelRatio };
    hideCard();
    chrome.runtime.sendMessage({ type: 'ffp:identify-rect', rect, pageUrl: location.href, context: pictureContext(pic.el) }, () => void chrome.runtime.lastError);
  });
  $('.cx').addEventListener('click', (e) => {
    e.stopPropagation();
    advanceCoach(3);
  });
  $('.dock').addEventListener('click', (e) => {
    const b = (e.target as Element).closest('button[data-dock]') as HTMLButtonElement | null;
    if (!b) return;
    e.stopPropagation();
    switch (b.dataset.dock) {
      case 'inspect':
        setPaused(!paused);
        break;
      case 'area':
        openPanel({ view: 'image', select: true });
        break;
      case 'fonts':
        openPanel({ view: 'page' });
        break;
      case 'system':
        openPanel({ view: 'system' });
        break;
      case 'save':
        if (current && !current.picture) saveCurrent();
        else flashTip(b, 'Point at some text first');
        break;
      case 'panel':
        if (panelOpen) chrome.runtime.sendMessage({ type: 'ffp:close-panel-request' }, () => void chrome.runtime.lastError);
        else openPanel({});
        break;
      case 'off':
        // The X closes Font Finder Plus completely: the dock and the side panel.
        if (panelOpen) chrome.runtime.sendMessage({ type: 'ffp:close-panel-request' }, () => void chrome.runtime.lastError);
        stop();
        break;
    }
  });
  initDockDrag();
  chrome.storage?.onChanged?.addListener((changes, area) => {
    if (area === 'local' && COACH_KEY in changes) {
      coachStep = Number(changes[COACH_KEY].newValue ?? 0);
      renderCoach();
    }
  });
}

// ------------------------------------------------------------------ moving the dock

const DOCK_KEY = 'ffp:dockPos';

/** Keep the dock fully on screen. */
function placeDock(x: number, y: number) {
  const d = $<HTMLElement>('.dock');
  const w = d.offsetWidth || 360;
  const h = d.offsetHeight || 54;
  const nx = Math.min(Math.max(8, x), innerWidth - w - 8);
  const ny = Math.min(Math.max(8, y), innerHeight - h - 8);
  d.style.left = `${nx}px`;
  d.style.top = `${ny}px`;
  d.style.bottom = 'auto';
  d.style.transform = 'none';
  d.classList.add('moved');
  return { x: nx, y: ny };
}

/** Drag the dock by its grip. Where you leave it is remembered for every site. */
function initDockDrag() {
  const grip = $<HTMLElement>('.grip');
  let start: { px: number; py: number; x: number; y: number } | null = null;
  grip.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const r = $<HTMLElement>('.dock').getBoundingClientRect();
    start = { px: e.clientX, py: e.clientY, x: r.left, y: r.top };
    grip.setPointerCapture(e.pointerId);
  });
  grip.addEventListener('pointermove', (e) => {
    if (!start) return;
    placeDock(start.x + e.clientX - start.px, start.y + e.clientY - start.py);
  });
  const end = () => {
    if (!start) return;
    start = null;
    const r = $<HTMLElement>('.dock').getBoundingClientRect();
    try {
      chrome.storage.local.set({ [DOCK_KEY]: { x: r.left / innerWidth, y: r.top / innerHeight } });
    } catch {
      /* not available in tests */
    }
  };
  grip.addEventListener('pointerup', end);
  grip.addEventListener('pointercancel', end);
  // Double-click the grip to put the dock back in the middle.
  grip.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    const d = $<HTMLElement>('.dock');
    d.removeAttribute('style');
    d.classList.remove('moved');
    try {
      chrome.storage.local.remove(DOCK_KEY);
    } catch {
      /* not available in tests */
    }
  });
}

function restoreDock() {
  try {
    chrome.storage.local.get(DOCK_KEY, (v) => {
      const pos = v?.[DOCK_KEY] as { x: number; y: number } | undefined;
      if (pos) requestAnimationFrame(() => placeDock(pos.x * innerWidth, pos.y * innerHeight));
    });
  } catch {
    /* not available in tests */
  }
}

/** Ask the background to open the side panel (it must do it at once, while the click still counts). */
function openPanel(req: { view?: 'page' | 'system' | 'image' | 'detail'; select?: boolean; family?: string }) {
  chrome.runtime.sendMessage({ type: 'ffp:open-panel', ...req }, () => void chrome.runtime.lastError);
}

export function setPanelOpen(open: boolean) {
  panelOpen = open;
  if (!root) return;
  const b = $<HTMLButtonElement>('.db[data-dock="panel"]');
  b.setAttribute('aria-pressed', String(open));
  b.querySelector('.tip')!.textContent = open ? 'Close the side panel' : 'Open the side panel';
}

function flashTip(b: HTMLElement, text: string) {
  const tip = b.querySelector('.tip') as HTMLElement;
  const prev = tip.innerHTML;
  tip.textContent = text;
  b.classList.add('saytip');
  setTimeout(() => {
    tip.innerHTML = prev;
    b.classList.remove('saytip');
  }, 1600);
}

async function copyCss() {
  if (!current || current.picture) return;
  const s = current.info;
  await copyText(
    declarationCss(s.declared, {
      fontSize: s.fontSize,
      fontWeight: s.weight,
      fontStyle: s.style,
      lineHeight: s.lineHeight,
      letterSpacing: s.letterSpacing,
      color: s.color,
    }, s.family),
  );
  if (!$<HTMLElement>('.foot').hidden) flashButton('.copycss', 'Copied');
  else flashTip($('.db[data-dock="inspect"]'), 'CSS copied');
  advanceCoach(3);
}

async function saveCurrent() {
  if (!current || current.picture) return;
  const reply = await new Promise<{ ok: boolean } | null>((resolve) =>
    chrome.runtime.sendMessage(
      { type: 'ffp:save-from-page', info: current!.info, pageUrl: location.href, fileUrl: current!.fileUrl, files: current!.info.kind === 'web' ? facesFor(current!.info.family) : [] },
      (r) => resolve(chrome.runtime.lastError ? null : r),
    ),
  );
  saved = !!reply?.ok;
  if (saved) $('.save').innerHTML = `${iconSvg(Bookmark02Icon, 15, 1.5, true)}<span>Saved</span>`;
  if (!$<HTMLElement>('.foot').hidden) flashButton('.save', saved ? 'Saved' : 'Could not save');
  else flashTip($('.db[data-dock="save"]'), saved ? `${current.info.displayName ?? current.info.family} saved` : 'Could not save');
}

// ------------------------------------------------------------------ tips

const COACH_TEXT = () => [
  'Point at any text to see its font',
  'Click the text or press <span class="kbd">Space</span> to pin the card',
  'Pinned. Click a value to copy it, or <span class="kbd">C</span> copies all the CSS. <span class="kbd">Esc</span> unpins',
];

function renderCoach() {
  if (!root) return;
  const c = $<HTMLElement>('.coach');
  c.hidden = !active || paused || coachStep >= 3;
  if (c.hidden) return;
  c.querySelector('.step')!.textContent = `${coachStep + 1}/3`;
  c.querySelector('.ctext')!.innerHTML = COACH_TEXT()[coachStep];
}

/** Move the tips on to a step (never back). Step 3 hides them for good. */
function advanceCoach(to: number) {
  if (coachStep >= to) return;
  coachStep = to;
  try {
    chrome.storage.local.set({ [COACH_KEY]: to });
  } catch {
    /* not available in tests */
  }
  renderCoach();
}

function setPaused(on: boolean) {
  paused = on;
  if (on) {
    pinned = false;
    current = null;
    $<HTMLElement>('.card').hidden = true;
    $<HTMLElement>('.card').classList.remove('pinned');
    $<HTMLElement>('.hl').hidden = true;
    document.documentElement.style.removeProperty('cursor');
  } else {
    document.documentElement.style.setProperty('cursor', 'crosshair', 'important');
  }
  $('.db[data-dock="inspect"]').setAttribute('aria-pressed', String(!on));
  // The panel's switch shows the same thing as the dock's Inspect button.
  onStateChange(!on);
  ($('.db[data-dock="inspect"] .tip') as HTMLElement).firstChild!.textContent = on ? 'Paused. Click to inspect again' : 'Inspect fonts';
  renderCoach();
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

/** A picture rather than text: an SVG drawing without real text, an image, a canvas or a video. */
function pictureOf(el: Element): Current['picture'] | undefined {
  const svg = el.closest('svg');
  if (svg && !svg.querySelector('text')) return { kind: 'svg', el: svg };
  if (el instanceof HTMLImageElement || el instanceof HTMLCanvasElement || el instanceof HTMLVideoElement || el instanceof HTMLPictureElement) return { kind: 'image', el };
  // A box showing a background image and no text (common on social sites).
  if (!(el.textContent ?? '').trim() && /url\(/.test(getComputedStyle(el).backgroundImage)) return { kind: 'image', el };
  return undefined;
}

const hasOwnText = (el: Element) => [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && (n.nodeValue ?? '').trim());

/** Whether a picture has text in it, found by a quick check of the screen (cached per picture). */
const pictureText = new WeakMap<Element, 'yes' | 'no' | 'unknown'>();

function checkPictureText(pic: NonNullable<Current['picture']>, attempt = 0) {
  const known = pictureText.get(pic.el);
  if (known) {
    pic.text = known;
    return;
  }
  pic.text = 'checking';
  const r = pic.el.getBoundingClientRect();
  const rect = { x: Math.max(0, r.left), y: Math.max(0, r.top), w: Math.min(innerWidth, r.right) - Math.max(0, r.left), h: Math.min(innerHeight, r.bottom) - Math.max(0, r.top), dpr: devicePixelRatio };
  if (rect.w < 16 || rect.h < 10) {
    pictureText.set(pic.el, 'no');
    pic.text = 'no';
    return;
  }
  // Keep the card and toolbar out of the screenshot.
  hideUi(true);
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      chrome.runtime.sendMessage({ type: 'ffp:picture-text', rect }, (reply?: { ok: boolean; hasText?: boolean }) => {
        void chrome.runtime.lastError;
        hideUi(false);
        const v = reply?.ok ? (reply.hasText ? 'yes' : 'no') : 'unknown';
        // Chrome allows only a couple of screenshots a second: try once more before giving up.
        if (v === 'unknown' && attempt < 2 && current?.picture?.el === pic.el) {
          window.setTimeout(() => current?.picture?.el === pic.el && checkPictureText(current.picture, attempt + 1), 700);
          return;
        }
        if (v !== 'unknown') pictureText.set(pic.el, v);
        if (current?.picture?.el === pic.el) {
          current.picture.text = v;
          renderCard();
          position();
        }
      });
    }),
  );
}

function infoFor(el: Element): Current {
  const picture = pictureOf(el);
  if (picture) el = picture.el;
  const cs = getComputedStyle(el);
  let text = '';
  el.childNodes.forEach((n) => {
    if (n.nodeType === Node.TEXT_NODE) text += n.nodeValue;
  });
  if (!text.trim()) text = (el.textContent ?? '').slice(0, 200);
  const rendered = resolveRendered(familyOf(el, cs), cs.fontWeight, cs.fontStyle, text);
  const facts = fontFacts(rendered);
  const size = parseFloat(cs.fontSize);
  const m = measureMetrics(familyCss(rendered), cs.fontWeight, cs.fontStyle, size);
  const info: ElementFontInfo = {
    family: rendered.family,
    displayName: facts.displayName,
    catalogFamily: facts.catalogFamily,
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
  // "Use with my fonts" or "Paste type from Figma" put another font here: name that font.
  const typedFamily = picture ? null : el.closest('[data-ffp-type-family]')?.getAttribute('data-ffp-type-family');
  if (typedFamily) {
    const gf = googleFamily(typedFamily);
    const css = cs.fontFamily;
    const tm = measureMetrics(css, cs.fontWeight, cs.fontStyle, size);
    const typedInfo: ElementFontInfo = {
      ...info,
      family: gf?.family ?? typedFamily,
      displayName: gf?.family ?? typedFamily,
      catalogFamily: gf?.family ?? null,
      kind: 'web',
      source: gf ? 'google' : info.source,
      declared: [gf?.family ?? typedFamily, rendered.genericName ?? 'sans-serif'],
      fellBackFrom: [],
      capHeight: tm.cap ? round(tm.cap, 1) : null,
      xHeight: tm.x ? round(tm.x, 1) : null,
      licenseType: gf?.l ?? 'unknown',
      classification: gf?.c ?? info.classification,
    };
    return { el, info: typedInfo, rendered, fileUrl: null, css, swappedFrom: info.displayName ?? info.family };
  }
  const swapped = el.getAttribute('data-ffp-swap');
  if (swapped && !picture) {
    // A trial font is showing here: describe that font, and say what it replaced.
    const gf = googleFamily(swapped);
    const css = cs.fontFamily;
    const sm = measureMetrics(css, cs.fontWeight, cs.fontStyle, size);
    const swappedInfo: ElementFontInfo = {
      ...info,
      family: gf?.family ?? swapped,
      displayName: gf?.family ?? swapped,
      catalogFamily: gf?.family ?? null,
      kind: 'web',
      source: 'google',
      sourceHost: 'fonts.gstatic.com',
      declared: [gf?.family ?? swapped, rendered.genericName ?? 'sans-serif'],
      fellBackFrom: [],
      capHeight: sm.cap ? round(sm.cap, 1) : null,
      xHeight: sm.x ? round(sm.x, 1) : null,
      licenseType: gf?.l ?? 'unknown',
      classification: gf?.c ?? info.classification,
    };
    return { el, info: swappedInfo, rendered, fileUrl: null, css, swappedFrom: info.displayName ?? info.family };
  }
  return { el, info, rendered, fileUrl: facts.fileUrl, picture };
}

// ------------------------------------------------------------------ render

function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

function renderCard() {
  if (!current) return;
  const { info, rendered } = current;
  const pic = current.picture;
  $<HTMLElement>('.picnote').hidden = !pic;
  $<HTMLElement>('.metrics').hidden = !!pic;
  $<HTMLElement>('.rows').hidden = !!pic;
  $<HTMLElement>('.chip').hidden = !!pic;
  const name = $<HTMLElement>('.name');
  if (pic) {
    const t = pic.text ?? 'unknown';
    $<HTMLElement>('.picnote p').textContent =
      t === 'checking' ? 'Checking this picture for text…'
        : t === 'no' ? 'No text found in this picture, so there is no font here.'
          : t === 'yes' ? 'The text here is part of a picture, so its font cannot be read from the page. Identify it to find the font.'
            : 'This picture could not be checked for text. If it has text, right-click it and choose Identify the font in this image.';
    $<HTMLElement>('.identify').hidden = t !== 'yes';
    name.textContent = t === 'yes' ? 'Picture with text' : t === 'no' ? 'Picture, no text' : 'Picture';
    name.style.fontFamily = '"FFP Geist", system-ui';
    name.style.fontWeight = '600';
    name.style.fontStyle = 'normal';
    $<HTMLElement>('.meta').textContent = pic.kind === 'svg' ? 'SVG drawing' : 'Image';
    $<HTMLElement>('.fallback').hidden = true;
    renderPinState();
    return;
  }
  name.textContent = info.displayName ?? info.family;
  name.style.fontFamily = `${current.css ?? familyCss(rendered)}, system-ui`;
  name.style.fontWeight = info.weight;
  name.style.fontStyle = info.style;
  const src = info.kind === 'web' ? SOURCE_LABEL[info.source] : info.kind === 'generic' ? 'Browser default' : 'System font';
  $<HTMLElement>('.meta').textContent = `${info.tag} · ${src}${info.catalogFamily && info.source !== 'google' ? ' · on Google Fonts' : ''}${current.swappedFrom ? ` · showing instead of ${current.swappedFrom}` : ''}`;
  const fb = $<HTMLElement>('.fallback');
  fb.hidden = !info.fellBackFrom.length;
  fb.textContent = info.fellBackFrom.length ? `Fallback: ${info.fellBackFrom.join(', ')} did not load` : '';
  const badge = licenseBadge(info.licenseType);
  const chip = $<HTMLElement>('.chip');
  chip.className = `chip ${badge.tone}`;
  chip.innerHTML = `<span class="dot"></span>${badge.text}`;
  chip.title = `${CLASS_LABEL[info.classification]} · ${badge.text}`;
  renderPinState();
  drawMetrics();
  renderRows();
}

/** Pinned: the "Pinned" button, the actions and the copy hint. Not pinned: how to pin. */
function renderPinState() {
  const pic = !!current?.picture;
  $<HTMLElement>('.pin').hidden = !pinned;
  $<HTMLElement>('.foot').hidden = !pinned || pic;
  const hint = $<HTMLElement>('.hint');
  hint.hidden = pic && !pinned;
  hint.className = pinned ? 'hint' : 'hint pinme';
  hint.innerHTML = pinned
    ? pic ? '<span class="kbd">Esc</span> unpins' : 'Click a value to copy just that. <span class="kbd">Esc</span> unpins.'
    : `${iconSvg(PinIcon, 13)}Click or press <span class="kbd">Space</span> to pin it`;
}

function renderRows() {
  if (!current) return;
  const i = current.info;
  const italic = i.style !== 'normal' ? ` ${i.style[0].toUpperCase()}${i.style.slice(1)}` : '';
  const rows: { key: string; label: string; value: string; copy: string; swatch?: string }[] = [
    { key: 'weight', label: 'Weight', value: `${weightLabel(i.weight)}${italic}`, copy: i.weight },
    { key: 'size', label: 'Size', value: `${round(i.fontSize, 2)}px`, copy: `${round(i.fontSize, 2)}px` },
    { key: 'line', label: 'Line height', value: lineHeightLabel(i.lineHeight, i.fontSize), copy: i.lineHeight },
    { key: 'track', label: 'Spacing', value: i.letterSpacing === 'normal' ? 'Normal' : i.letterSpacing, copy: i.letterSpacing },
    { key: 'color', label: 'Colour', value: rgbToHex(i.color), copy: rgbToHex(i.color).split(' ')[0], swatch: i.color },
    { key: 'family', label: 'Family', value: i.displayName ?? i.family, copy: i.displayName ?? i.family },
  ];
  $<HTMLElement>('.rows').innerHTML = rows
    .map((r) => {
      const copied = copiedRow === r.key;
      return `<button class="row${copied ? ' copied' : ''}" data-copy="${escapeHtml(r.copy)}" data-key="${r.key}" title="Click to copy" aria-label="Copy ${r.label}: ${escapeHtml(r.value)}">
        <span class="k">${r.label}</span>
        <span class="v">${r.swatch ? `<span class="sw" style="background:${escapeHtml(r.swatch)}"></span>` : ''}${copied ? 'Copied' : escapeHtml(r.value)}</span>
        <span class="s">${copied ? iconSvg(Tick02Icon, 12, 2) : iconSvg(Copy01Icon, 12)}</span>
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
  c.fillStyle = '#F8F9FA';
  c.beginPath();
  c.roundRect(0, 0, W, H, 12 * scale);
  c.fill();
  const { info, rendered } = current;
  const fam = current.css ?? familyCss(rendered);
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
  line(base - capA, '#878C95', true);
  line(base - xA, '#B1B6BE', true);
  line(base, '#16181C', false);
  c.fillStyle = '#16181C';
  c.textBaseline = 'alphabetic';
  c.fillText('Hxg', 14 * scale, base);
  c.font = `${10 * scale}px "${OWN_FONT_PREFIX}JetBrains Mono", ui-monospace, monospace`;
  c.textAlign = 'right';
  const label = (text: string, y: number, color: string) => {
    c.fillStyle = color;
    c.fillText(text, W - 10 * scale, y);
  };
  label(info.capHeight != null ? `CAP ${info.capHeight}PX` : 'CAP', base - capA - 5 * scale, '#5A5F68');
  label(info.xHeight != null ? `X-HEIGHT ${info.xHeight}PX` : 'X-HEIGHT', base - xA - 5 * scale, '#5A5F68');
  label('BASELINE', base - 5 * scale, '#16181C');
  c.textAlign = 'left';
}

function position() {
  if (!current) return;
  const card = $<HTMLElement>('.card');
  const w = card.offsetWidth;
  const h = card.offsetHeight;
  const vw = innerWidth;
  const vh = innerHeight;
  let x = lastMouse.x + 18;
  let y = lastMouse.y + 18;
  if (x + w > vw - 8) x = Math.max(8, lastMouse.x - w - 18);
  if (y + h + 60 > vh - 8) y = Math.max(8, lastMouse.y - h - 18);
  card.style.transform = `translate(${x}px, ${y}px)`;
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
  if (current.picture) checkPictureText(current.picture);
  saved = false;
  copiedRow = null;
  const card = $<HTMLElement>('.card');
  card.hidden = false;
  renderCard();
  position();
  if (!current.picture) advanceCoach(1);
}

/** Hide the card until the mouse moves over other text. Inspecting keeps going. */
function hideCard() {
  pinned = false;
  current = null;
  const card = $<HTMLElement>('.card');
  card.hidden = true;
  card.classList.remove('pinned');
  $<HTMLElement>('.hl').hidden = true;
  hiddenUntilMove = true;
}

let hiddenUntilMove = false;

function setPinned(on: boolean) {
  pinned = on;
  $<HTMLElement>('.card').classList.toggle('pinned', on);
  renderPinState();
  position();
  if (on) advanceCoach(2);
  if (on && current) {
    chrome.runtime.sendMessage({ type: 'ffp:pinned', info: current.info, pageUrl: location.href }, () => void chrome.runtime.lastError);
  }
}

// ------------------------------------------------------------------ events

function targetAt(x: number, y: number): Element | null {
  const el = document.elementFromPoint(x, y);
  if (!el || isOurNode(el) || el === document.documentElement || el === document.body) return null;
  if (hasOwnText(el) || pictureOf(el) || (el.textContent ?? '').trim()) return el;
  // An empty layer on top (sites often cover pictures with one): look underneath for a picture or text.
  for (const under of document.elementsFromPoint(x, y)) {
    if (under === el || isOurNode(under) || under === document.body || under === document.documentElement) continue;
    if (pictureOf(under)) return under;
    if (hasOwnText(under)) return under;
  }
  return null;
}

function onMove(e: MouseEvent) {
  const moved = Math.abs(e.clientX - lastMouse.x) + Math.abs(e.clientY - lastMouse.y);
  lastMouse = { x: e.clientX, y: e.clientY };
  if (hiddenUntilMove) {
    if (moved < 12) return;
    hiddenUntilMove = false;
  }
  if (paused || pinned || rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => {
    rafPending = false;
    const el = targetAt(lastMouse.x, lastMouse.y);
    if (el) show(el);
  });
}



function onClick(e: MouseEvent) {
  if (paused || isOurNode(e.composedPath()[0] as Node)) return;
  // Clicking the page pins the card instead of following links or pressing buttons.
  e.preventDefault();
  e.stopPropagation();
  lastMouse = { x: e.clientX, y: e.clientY };
  // Pinned: a click unpins and the card follows the mouse again.
  if (pinned) {
    setPinned(false);
    const el = targetAt(e.clientX, e.clientY);
    current = null;
    if (el) show(el);
    return;
  }
  const el = targetAt(e.clientX, e.clientY);
  if (!el) return;
  current = null;
  hiddenUntilMove = false;
  show(el);
  setPinned(true);
}

function block(e: Event) {
  if (paused || isOurNode(e.composedPath()[0] as Node)) return;
  e.preventDefault();
  e.stopPropagation();
}

function editable(t: EventTarget | null) {
  const el = t as HTMLElement | null;
  return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
}

/** Space pins or unpins, C copies the CSS, S saves, Esc unpins and then turns off. */
function onKey(e: KeyboardEvent) {
  if (e.metaKey || e.ctrlKey || e.altKey || editable(e.composedPath()[0] ?? e.target)) return;
  const cardShown = !!current && !$<HTMLElement>('.card').hidden;
  if (e.key === 'Escape') {
    // Chrome leaves full screen with Esc: never turn off then.
    if (document.fullscreenElement) return;
    if (pinned) setPinned(false);
    else stop();
    e.preventDefault();
    return;
  }
  if (paused || !cardShown) return;
  if (e.code === 'Space') {
    setPinned(!pinned);
    e.preventDefault();
    e.stopPropagation();
  } else if (e.key === 'c' || e.key === 'C') {
    copyCss();
    e.preventDefault();
    e.stopPropagation();
  } else if (e.key === 's' || e.key === 'S') {
    saveCurrent();
    e.preventDefault();
    e.stopPropagation();
  }
}

function onScroll() {
  if (current) position();
}

export async function start() {
  if (active) return;
  active = true;
  ensureUi();
  host!.hidden = false;
  paused = false;
  $<HTMLElement>('.dock').hidden = false;
  setPaused(false);
  restoreDock();
  addEventListener('keydown', onKey, true);
  try {
    chrome.storage.local.get(COACH_KEY, (v) => {
      coachStep = Number(v?.[COACH_KEY] ?? 0);
      renderCoach();
    });
  } catch {
    coachStep = 3;
  }
  chrome.runtime.sendMessage({ type: 'ffp:panel-open?' }, (r?: { open: boolean }) => {
    void chrome.runtime.lastError;
    setPanelOpen(!!r?.open);
  });
  loadUiFonts();
  loadFaceMap();
  addEventListener('mousemove', onMove, true);
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
  removeEventListener('click', onClick, true);
  removeEventListener('mousedown', block, true);
  removeEventListener('mouseup', block, true);
  removeEventListener('scroll', onScroll, true);
  removeEventListener('keydown', onKey, true);
  paused = false;
  document.documentElement.style.removeProperty('cursor');
  if (root) {
    $<HTMLElement>('.card').hidden = true;
    $<HTMLElement>('.card').classList.remove('pinned');
    $<HTMLElement>('.dock').hidden = true;
    $<HTMLElement>('.coach').hidden = true;
    $<HTMLElement>('.hl').hidden = true;
  }
  onStateChange(false);
}

// ------------------------------------------------------------------ show on page

let markGroups: { root: Element; members: Element[]; block: boolean }[] = [];
let markTimer = 0;
let markRaf = 0;

/** Rectangles around the text itself (not the whole block it sits in). */
function textRects(el: Element): DOMRect[] {
  const out: DOMRect[] = [];
  el.childNodes.forEach((n) => {
    if (n.nodeType !== Node.TEXT_NODE || !n.nodeValue?.trim()) return;
    const range = document.createRange();
    range.selectNodeContents(n);
    for (const r of range.getClientRects()) if (r.width > 1 && r.height > 1) out.push(r);
  });
  if (!out.length) {
    // A paragraph whose text sits in child elements: use all of its text.
    const range = document.createRange();
    range.selectNodeContents(el);
    for (const r of range.getClientRects()) if (r.width > 1 && r.height > 1) out.push(r);
  }
  return out;
}

/**
 * Group the matching text into blocks. A paragraph or list whose text all uses
 * this font gets one outline; where the font is mixed with others (a link
 * inside a paragraph set in another font) only the words are outlined.
 */
function groupMarks(shown: Element[], all: Element[]) {
  const marked = new Set(shown);
  const total = new Map<Element, number>();
  const hits = new Map<Element, number>();
  for (const el of all) {
    let p: Element | null = el;
    for (let i = 0; p && p !== document.body && i < 5; i++, p = p.parentElement) {
      total.set(p, (total.get(p) ?? 0) + 1);
      if (marked.has(el)) hits.set(p, (hits.get(p) ?? 0) + 1);
    }
  }
  const byRoot = new Map<Element, Element[]>();
  for (const el of shown) {
    let root: Element = el;
    let p = el.parentElement;
    for (let i = 0; p && p !== document.body && i < 4; i++, p = p.parentElement) {
      const t = total.get(p) ?? 0;
      if (t > 14 || t !== (hits.get(p) ?? 0)) break;
      root = p;
    }
    const list = byRoot.get(root) ?? [];
    list.push(el);
    byRoot.set(root, list);
  }
  // Merge groups that sit inside another group.
  const roots = [...byRoot.keys()];
  for (const r of roots) {
    const outer = roots.find((o) => o !== r && byRoot.has(o) && o.contains(r));
    if (outer) {
      byRoot.get(outer)!.push(...byRoot.get(r)!);
      byRoot.delete(r);
    }
  }
  markGroups = [...byRoot.entries()].map(([root, members]) => ({
    root,
    members,
    // One box only when every piece of text inside uses this font. If another
    // font is mixed in (a code word in a sentence), each piece gets its own outline.
    block: (total.get(root) ?? 1) === (hits.get(root) ?? 1) && !getComputedStyle(root).display.startsWith('inline'),
  }));
}

function drawMarks() {
  if (!root) return;
  const marks = $<HTMLElement>('.marks');
  const frag = document.createDocumentFragment();
  const box = (r: { left: number; top: number; width: number; height: number }) => {
    if (r.top + r.height < 0 || r.top > innerHeight) return;
    const d = document.createElement('div');
    d.className = 'mark';
    d.style.transform = `translate(${r.left - 4}px, ${r.top - 3}px)`;
    d.style.width = `${r.width + 8}px`;
    d.style.height = `${r.height + 6}px`;
    frag.appendChild(d);
  };
  for (const g of markGroups) {
    const rects = g.members.flatMap(textRects);
    if (!rects.length) continue;
    if (g.block) {
      const left = Math.min(...rects.map((r) => r.left));
      const top = Math.min(...rects.map((r) => r.top));
      const right = Math.max(...rects.map((r) => r.right));
      const bottom = Math.max(...rects.map((r) => r.bottom));
      box({ left, top, width: right - left, height: bottom - top });
    } else {
      rects.forEach(box);
    }
  }
  marks.replaceChildren(frag);
}

function onMarkScroll() {
  cancelAnimationFrame(markRaf);
  markRaf = requestAnimationFrame(drawMarks);
}

let markKey: string | null = null;

function clearMarks() {
  markGroups = [];
  markKey = null;
  clearTimeout(markTimer);
  removeEventListener('scroll', onMarkScroll, true);
  removeEventListener('resize', onMarkScroll);
  if (root) {
    $<HTMLElement>('.marks').replaceChildren();
    $<HTMLElement>('.flag').hidden = true;
  }
}

/**
 * Outline the text that uses a font (from "Show on page" in the side panel).
 * The outlines follow the page while it scrolls and fade after 6 seconds.
 */
/** Outline a given set of elements (readability issues). Same toggle and fade as fonts. */
export function highlightElements(id: string, els: Element[], label: string): { shown: number; hidden: number; cleared?: boolean } {
  ensureUi();
  const was = markKey;
  clearMarks();
  if (was === id) return { shown: 0, hidden: 0, cleared: true };
  host!.hidden = false;
  const shown = els.filter((e) => e.getClientRects().length && !isClipped(e));
  if (!shown.length) return { shown: 0, hidden: els.length };
  markGroups = shown.map((root) => ({ root, members: [root], block: !getComputedStyle(root).display.startsWith('inline') }));
  markKey = id;
  const flag = $<HTMLElement>('.flag');
  flag.textContent = `${label} · ${shown.length} on the page`;
  flag.hidden = false;
  addEventListener('scroll', onMarkScroll, true);
  addEventListener('resize', onMarkScroll);
  const first = shown[0].getBoundingClientRect();
  if (first.top < 0 || first.bottom > innerHeight) shown[0].scrollIntoView({ block: 'center', behavior: 'smooth' });
  drawMarks();
  markTimer = window.setTimeout(clearMarks, 6000);
  return { shown: shown.length, hidden: els.length - shown.length };
}

export function highlightKey(key: string | null, label?: string): { shown: number; hidden: number; cleared?: boolean } {
  ensureUi();
  // Clicking "Show on page" again for the same font removes the outlines.
  const wasShowing = markKey;
  clearMarks();
  if (!key) return { shown: 0, hidden: 0 };
  if (wasShowing === key) return { shown: 0, hidden: 0, cleared: true };
  host!.hidden = false;
  const { shown, hidden, all } = elementsForKey(key);
  const flag = $<HTMLElement>('.flag');
  const name = label ?? 'This font';
  // Nothing visible: the side panel explains it, so no pop-up on the page.
  if (!shown.length) return { shown: 0, hidden };
  groupMarks(shown, all);
  markKey = key;
  flag.textContent = `${name} · ${shown.length} on the page${hidden ? ` · ${hidden} hidden in menus or pop-ups` : ''}`;
  flag.hidden = false;
  addEventListener('scroll', onMarkScroll, true);
  addEventListener('resize', onMarkScroll);
  const first = shown[0].getBoundingClientRect();
  if (first.top < 0 || first.bottom > innerHeight) shown[0].scrollIntoView({ block: 'center', behavior: 'smooth' });
  drawMarks();
  markTimer = window.setTimeout(clearMarks, 6000);
  return { shown: shown.length, hidden };
}
