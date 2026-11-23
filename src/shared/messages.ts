import type { ElementFontInfo, FaceFile, PageScan, SourceKind } from './types';

// Messages sent to the content script in a tab.
export type ToContent =
  | { type: 'ffp:ping' }
  | { type: 'ffp:inspect'; on: boolean }
  | { type: 'ffp:scan' }
  | { type: 'ffp:fetch-font'; url: string }
  | { type: 'ffp:highlight'; key: string | null; label?: string }
  | { type: 'ffp:swap'; key: string; family: string; faces: { base64: string; weight: string; style: string; unicodeRange: string | null }[]; generic: string; aspect: number | null }
  | { type: 'ffp:unswap'; key: string | null }
  | { type: 'ffp:vary'; key: string; settings: string | null; weight: string | null }
  | { type: 'ffp:swaps' }
  | { type: 'ffp:system' }
  | { type: 'ffp:hide-ui'; hidden: boolean }
  | { type: 'ffp:select-area' }
  | { type: 'ffp:image-rect'; src: string }
  | { type: 'ffp:picture-context'; src: string }
  | { type: 'ffp:measure'; family: string; weight: string; style: string }
  | { type: 'ffp:prints'; family: string; weight: string; style: string }
  | { type: 'ffp:fine-prints'; family: string; weight: string; style: string }
  | { type: 'ffp:specimen'; family: string; weight: string; style: string; text: string }
  | { type: 'ffp:highlight-issue'; id: string; label: string }
  | { type: 'ffp:panel-state'; open: boolean }
  /** The panel's switch: pause or resume pointing, keeping the dock on the page. */
  | { type: 'ffp:pause'; paused: boolean }
  /** Set type styles on the page (Use with my fonts, Paste type from Figma). `on: false` puts the page back. */
  | { type: 'ffp:apply-type'; styles: ApplyTypeStyle[]; on: boolean }
  /** Measure fonts the way this page draws them (x-height, cap height, extents, width). */
  | { type: 'ffp:type-metrics'; fonts: { family: string; weight: string; style: string }[] };

/** Where a style goes on the page: a heading level, body text, labels... `none` is not applied. */
export type TypeRole = 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'display' | 'lead' | 'body' | 'small' | 'label' | 'caption' | 'button' | 'link' | 'nav' | 'code' | 'none';

export interface ApplyTypeFace {
  base64: string;
  weight: string;
  style: string;
  unicodeRange: string | null;
}

/** One style to set on the page. Values left out are not changed. */
export interface ApplyTypeStyle {
  selectorRole: TypeRole | string;
  /** The exact elements of a System tab style (more precise than the role); falls back to the role. */
  styleId?: string;
  /** Shown in the reply, e.g. "Display". */
  name?: string;
  family?: string;
  weight?: number | string;
  /** px */
  size?: number;
  /** px */
  lineHeight?: number;
  /** em */
  letterSpacing?: number;
  textTransform?: string;
  /** A stylesheet that loads the family (Google Fonts css2 address). */
  fontUrlCss?: string;
  /** Font files, when the panel already has them (works whatever the page's security rules). */
  faces?: ApplyTypeFace[];
  /** Generic family to fall back to (serif, sans-serif, monospace). */
  generic?: string;
}

export interface ApplyTypeReply {
  ok: boolean;
  /** Each style, with how many elements it landed on. */
  applied: { name?: string; role: string; count: number; fontLoaded: boolean }[];
  error?: string;
}

export interface PingReply {
  ok: true;
  inspecting: boolean;
  url: string;
  host: string;
  title: string;
  /** The tab shows a PDF in Chrome's PDF viewer (its text cannot be read). */
  pdf?: boolean;
}

export interface FetchFontReply {
  ok: boolean;
  base64?: string;
  error?: string;
}

// Messages sent to the extension (background worker and side panel).
export type ToExtension =
  | { type: 'ffp:inspector-state'; on: boolean; url: string }
  | { type: 'ffp:page-changed'; url: string }
  | { type: 'ffp:fonts-changed'; url: string }
  | { type: 'ffp:pinned'; info: ElementFontInfo; pageUrl: string }
  | { type: 'ffp:save-from-page'; info: ElementFontInfo; pageUrl: string; fileUrl: string | null; files: FaceFile[] }
  | { type: 'ffp:open-detail'; family: string; source: SourceKind }
  | { type: 'ffp:fetch-font-bg'; url: string }
  | { type: 'ffp:inject'; tabId: number; startInspecting: boolean }
  | { type: 'ffp:identify-rect'; rect: { x: number; y: number; w: number; h: number; dpr: number }; pageUrl: string; context?: string[] }
  /** From the dock on the page: open the side panel, optionally at a tab or a font. */
  | { type: 'ffp:open-panel'; view?: 'page' | 'system' | 'image' | 'detail'; select?: boolean; family?: string }
  | { type: 'ffp:close-panel-request' }
  | { type: 'ffp:panel-open?' }
  /** To the side panel: close yourself. */
  | { type: 'ffp:close-panel' };

export type ScanReply = { ok: true; scan: PageScan } | { ok: false; error: string };

export function sendToTab<T>(tabId: number, msg: ToContent, timeoutMs = 4000): Promise<T | null> {
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (!done) {
        done = true;
        resolve(null);
      }
    }, timeoutMs);
    try {
      chrome.tabs.sendMessage(tabId, msg, (reply: T) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        // Reading lastError marks it handled (no injected script in the tab).
        if (chrome.runtime.lastError) resolve(null);
        else resolve(reply ?? null);
      });
    } catch {
      clearTimeout(timer);
      resolve(null);
    }
  });
}

export function sendToExtension<T>(msg: ToExtension): Promise<T | null> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(msg, (reply: T) => {
        if (chrome.runtime.lastError) resolve(null);
        else resolve(reply ?? null);
      });
    } catch {
      resolve(null);
    }
  });
}

export function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

export function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}
