import type { SourceKind } from './types';

/** Decide where a font file comes from, using only its URL and the page's host. */
export function sourceFromUrl(url: string | null, pageHost: string): { kind: SourceKind; host: string | null } {
  if (!url) return { kind: 'script', host: null };
  if (url.startsWith('data:')) return { kind: 'embedded', host: null };
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return { kind: 'unknown', host: null };
  }
  if (host === 'fonts.gstatic.com' || host === 'fonts.googleapis.com') return { kind: 'google', host };
  if (host.endsWith('typekit.net') || host.endsWith('typekit.com')) return { kind: 'adobe', host };
  if (host === 'fonts.bunny.net') return { kind: 'bunny', host };
  if (sameSite(host, pageHost)) return { kind: 'self-hosted', host };
  return { kind: 'cdn', host };
}

function sameSite(a: string, b: string): boolean {
  if (a === b) return true;
  const base = (h: string) => h.split('.').slice(-2).join('.');
  return base(a) === base(b);
}

export function formatFromUrl(url: string | null, hint: string | null): string | null {
  if (hint) return hint.replace(/["']/g, '').toLowerCase();
  if (!url) return null;
  if (url.startsWith('data:')) {
    const m = url.match(/^data:([^;,]+)/);
    if (m) {
      if (m[1].includes('woff2')) return 'woff2';
      if (m[1].includes('woff')) return 'woff';
      if (m[1].includes('ttf') || m[1].includes('truetype')) return 'truetype';
      if (m[1].includes('otf') || m[1].includes('opentype')) return 'opentype';
    }
    return null;
  }
  const path = url.split(/[?#]/)[0].toLowerCase();
  if (path.endsWith('.woff2')) return 'woff2';
  if (path.endsWith('.woff')) return 'woff';
  if (path.endsWith('.ttf')) return 'truetype';
  if (path.endsWith('.otf')) return 'opentype';
  if (path.endsWith('.eot')) return 'embedded-opentype';
  return null;
}

/** Read the real format from the first bytes of a font file. */
export function sniffFormat(bytes: ArrayBuffer): string {
  const v = new DataView(bytes);
  if (bytes.byteLength < 4) return 'unknown';
  const tag = String.fromCharCode(v.getUint8(0), v.getUint8(1), v.getUint8(2), v.getUint8(3));
  if (tag === 'wOF2') return 'woff2';
  if (tag === 'wOFF') return 'woff';
  if (tag === 'OTTO') return 'opentype';
  if (tag === 'true' || v.getUint32(0) === 0x00010000) return 'truetype';
  if (tag === 'ttcf') return 'collection';
  return 'unknown';
}

export const FORMAT_LABEL: Record<string, string> = {
  woff2: 'WOFF2',
  woff: 'WOFF',
  truetype: 'TTF',
  opentype: 'OTF',
  'embedded-opentype': 'EOT',
  collection: 'TTC',
  unknown: 'Unknown',
};
