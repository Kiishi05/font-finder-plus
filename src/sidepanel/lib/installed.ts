// "Do I have this font?" Two checks:
// 1. Quick, no permission: draw text with the font name and see whether the
//    shape changes compared with fallback fonts. Only tells yes or no.
// 2. Detailed: Chrome's Local Font Access (asks permission once) lists the
//    installed styles and gives the file, so its version and characters can be read.

const SAMPLE = 'mmmmmmmmmmlli WWW 0123456789 Ağ';

export function quickInstalled(family: string): boolean {
  const c = document.createElement('canvas').getContext('2d');
  if (!c) return false;
  for (const fb of ['monospace', 'serif', 'sans-serif']) {
    c.font = `72px ${fb}`;
    const base = c.measureText(SAMPLE).width;
    c.font = `72px "${family.replace(/"/g, '')}", ${fb}`;
    if (Math.abs(c.measureText(SAMPLE).width - base) > 0.5) return true;
  }
  return false;
}

export interface InstalledFace {
  family: string;
  fullName: string;
  style: string;
  postscriptName: string;
  blob: () => Promise<Blob>;
}

interface LocalFontData {
  family: string;
  fullName: string;
  style: string;
  postscriptName: string;
  blob(): Promise<Blob>;
}

export function localFontAccessAvailable(): boolean {
  return typeof (window as unknown as { queryLocalFonts?: unknown }).queryLocalFonts === 'function';
}

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Installed faces of a family. Must be called from a click (Chrome asks permission the first time). */
export async function installedFaces(family: string): Promise<InstalledFace[]> {
  const q = (window as unknown as { queryLocalFonts: () => Promise<LocalFontData[]> }).queryLocalFonts;
  const all = await q();
  const want = squash(family);
  return all
    .filter((f) => squash(f.family) === want)
    .map((f) => ({ family: f.family, fullName: f.fullName, style: f.style, postscriptName: f.postscriptName, blob: () => f.blob() }));
}
