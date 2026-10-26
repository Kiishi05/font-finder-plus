import { MAX_CACHED_FONT_BYTES, db } from '../../shared/db';
import { base64ToArrayBuffer, sendToExtension, sendToTab, type FetchFontReply } from '../../shared/messages';
import type { FaceFile, ParsedFontFile } from '../../shared/types';

// ------------------------------------------------------------- font bytes

const inflight = new Map<string, Promise<ArrayBuffer>>();

/**
 * Get a font file's bytes. Tries, in order: local cache, a direct fetch (works
 * for CORS-enabled hosts such as Google Fonts), the page's content script
 * (same-site files), then the background worker (needs all-sites access).
 */
export function getFontBytes(url: string, tabId: number | null): Promise<ArrayBuffer> {
  const existing = inflight.get(url);
  if (existing) return existing;
  const p = (async () => {
    const cached = await db.fontFiles.get(url);
    if (cached) return cached.bytes;
    let bytes: ArrayBuffer | null = null;
    let lastError = 'The font file could not be downloaded.';
    if (url.startsWith('data:')) {
      bytes = await (await fetch(url)).arrayBuffer();
    }
    if (!bytes) {
      try {
        const res = await fetch(url, { credentials: 'omit' });
        if (res.ok) bytes = await res.arrayBuffer();
      } catch {
        /* blocked by CORS: try the page */
      }
    }
    if (!bytes && tabId != null) {
      const r = await sendToTab<FetchFontReply>(tabId, { type: 'ffp:fetch-font', url }, 15000);
      if (r?.ok && r.base64) bytes = base64ToArrayBuffer(r.base64);
      else if (r?.error) lastError = r.error;
    }
    if (!bytes) {
      const r = await sendToExtension<{ ok: boolean; base64?: string; error?: string }>({ type: 'ffp:fetch-bg', url, as: 'base64' } as never);
      if (r?.ok && r.base64) bytes = base64ToArrayBuffer(r.base64);
      else if (r?.error === 'no-permission') lastError = 'This site blocks reading the font file. Allow access to all sites in Settings to read it.';
      else if (r?.error) lastError = r.error;
    }
    if (!bytes) throw new Error(lastError);
    if (bytes.byteLength <= MAX_CACHED_FONT_BYTES) {
      await db.fontFiles.put({ url, bytes, size: bytes.byteLength, fetchedAt: Date.now() }).catch(() => undefined);
    }
    return bytes;
  })();
  inflight.set(url, p);
  p.catch(() => inflight.delete(url));
  return p;
}

// ------------------------------------------------------------- previews

const loadedAliases = new Map<string, Promise<boolean>>();

export function aliasFor(url: string): string {
  let h = 0;
  for (let i = 0; i < url.length; i++) h = (Math.imul(31, h) + url.charCodeAt(i)) | 0;
  return `ffp-${(h >>> 0).toString(36)}`;
}

/** Register a family alias for a set of faces so the panel can draw text in the real font. */
export async function loadPreviewFamily(alias: string, faces: FaceFile[], tabId: number | null): Promise<boolean> {
  const key = alias;
  const hit = loadedAliases.get(key);
  if (hit) return hit;
  const p = (async () => {
    let any = false;
    const seen = new Set<string>();
    for (const f of faces) {
      if (!f.url) continue;
      const k = `${f.weight}|${f.style}|${f.unicodeRange ?? ''}`;
      if (seen.has(k)) continue;
      seen.add(k);
      try {
        const bytes = await getFontBytes(f.url, tabId);
        const desc: FontFaceDescriptors = { weight: f.weight || '400', style: f.style || 'normal' };
        if (f.unicodeRange) desc.unicodeRange = f.unicodeRange;
        const face = new FontFace(alias, bytes, desc);
        await face.load();
        document.fonts.add(face);
        any = true;
      } catch {
        /* skip this face */
      }
    }
    return any;
  })();
  loadedAliases.set(key, p);
  return p;
}

/**
 * The faces to load for previews: every subset file (so other alphabets show
 * in the font when it has them), one set per weight and style, at most 48 files.
 */
export function previewFaces(files: FaceFile[]): FaceFile[] {
  const withUrl = files.filter((f) => f.url);
  const seen = new Set<string>();
  return withUrl.filter((f) => {
    const k = `${f.url}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, 48);
}

// ------------------------------------------------------------- parsing

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (p: ParsedFontFile) => void; reject: (e: Error) => void }>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('../../workers/font.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent<{ id: number; ok: boolean; parsed?: ParsedFontFile; error?: string }>) => {
    const p = pending.get(e.data.id);
    if (!p) return;
    pending.delete(e.data.id);
    if (e.data.ok && e.data.parsed) p.resolve(e.data.parsed);
    else p.reject(new Error(e.data.error ?? 'This font file could not be read.'));
  };
  return worker;
}

export function parseFontBytes(bytes: ArrayBuffer): Promise<ParsedFontFile> {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    // copy so the cached buffer stays usable
    const copy = bytes.slice(0);
    getWorker().postMessage({ id, bytes: copy }, [copy]);
  });
}
