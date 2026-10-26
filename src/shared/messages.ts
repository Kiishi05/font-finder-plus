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
  | { type: 'ffp:swaps' };

export interface PingReply {
  ok: true;
  inspecting: boolean;
  url: string;
  host: string;
  title: string;
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
  | { type: 'ffp:pinned'; info: ElementFontInfo; pageUrl: string }
  | { type: 'ffp:save-from-page'; info: ElementFontInfo; pageUrl: string; fileUrl: string | null; files: FaceFile[] }
  | { type: 'ffp:open-detail'; family: string; source: SourceKind }
  | { type: 'ffp:fetch-font-bg'; url: string }
  | { type: 'ffp:inject'; tabId: number; startInspecting: boolean };

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
