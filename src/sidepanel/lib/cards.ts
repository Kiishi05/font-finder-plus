// Share cards and specimen boards, drawn on a canvas so the preview is
// exactly the PNG that is downloaded.
import { CLASS_LABEL, googleFamily, licenseBadge, LICENSE_LABEL } from '../../shared/catalog';
import type { FontRecord } from '../../shared/types';
import { aliasFor, loadPreviewFamily, previewFaces } from './fonts';
import { linkGoogleFamily } from './google';

export interface CardFont {
  name: string;
  /** CSS font-family that draws this font in the panel. */
  css: string;
  weight: string;
  style: string;
  /** Short label, e.g. "SERIF · FREE ON GOOGLE FONTS". */
  label: string;
  /** e.g. "Designed by Undercase Type · SIL Open Font License". */
  details: string;
}

export type Theme = 'light' | 'dark' | 'green';
export const THEMES: Record<Theme, { bg: string; ink: string; muted: string; line: string }> = {
  light: { bg: '#F2F1EC', ink: '#111111', muted: '#6B6B66', line: 'rgba(0,0,0,0.12)' },
  dark: { bg: '#111111', ink: '#F4F3EF', muted: '#9A9A95', line: 'rgba(255,255,255,0.16)' },
  green: { bg: '#19C05A', ink: '#04210F', muted: 'rgba(4,33,15,0.65)', line: 'rgba(4,33,15,0.2)' },
};

export const SIZES = { landscape: [1200, 675], portrait: [1080, 1350] } as const;
export type CardSize = keyof typeof SIZES;

const UI = '"FFP Inter", system-ui, sans-serif';
const MONO = '"FFP JetBrains Mono", ui-monospace, monospace';
export const ALPHABET = 'Aa Bb Cc Dd Ee Ff Gg Hh Ii Jj Kk Ll Mm Nn Oo Pp Qq Rr Ss Tt Uu Vv Ww Xx Yy Zz 0123456789 &?!';

/** CSS that draws a saved font in the panel, loading its files first. */
export async function fontCssFor(rec: FontRecord): Promise<string> {
  const files = rec.files?.length ? rec.files : rec.fileUrl ? [{ url: rec.fileUrl, format: rec.format ?? null, weight: '400', style: 'normal', unicodeRange: null }] : [];
  const kind = rec.kind ?? (rec.source === 'system' ? 'local' : 'web');
  if (kind === 'web' && files.length) {
    const faces = previewFaces(files);
    const alias = aliasFor(faces.map((f) => f.url).join('|'));
    if (await loadPreviewFamily(alias, faces, null)) return `"${alias}", "FFP NotDef"`;
  }
  const gf = googleFamily(rec.catalogFamily ?? rec.displayName ?? rec.family);
  if (gf) {
    linkGoogleFamily(gf.family);
    await document.fonts.load(`400 40px "${gf.family}"`).catch(() => undefined);
    return `"${gf.family}", "FFP NotDef"`;
  }
  return kind === 'generic' ? rec.genericName ?? 'serif' : `"${rec.family}", "FFP NotDef"`;
}

export function cardFontFor(rec: FontRecord, css: string, weight = '400', style = 'normal'): CardFont {
  const name = rec.displayName ?? rec.family;
  const free = licenseBadge(rec.licenseType).tone === 'free';
  const onGoogle = !!rec.catalogFamily || rec.source === 'google';
  const label = [CLASS_LABEL[rec.classification], onGoogle ? 'Free on Google Fonts' : free ? 'Free' : rec.licenseType === 'commercial' ? 'Paid' : null].filter(Boolean).join(' · ').toUpperCase();
  const by = rec.designers?.length ? `Designed by ${rec.designers.slice(0, 2).join(', ')}` : rec.foundry ? `By ${rec.foundry}` : null;
  const lic = rec.licenseType !== 'unknown' ? LICENSE_LABEL[rec.licenseType] : null;
  return { name, css, weight, style, label, details: [by, lic].filter(Boolean).join(' · ') };
}

/** Break text into lines that fit. Words that are too long (or text without spaces) break by character. */
function wrap(c: CanvasRenderingContext2D, text: string, maxW: number, maxLines: number): string[] {
  const words = text.split(/(\s+)/).filter((w) => w.length);
  const lines: string[] = [];
  let line = '';
  const push = (l: string) => lines.push(l.trimEnd());
  for (const w of words) {
    const test = line + w;
    if (c.measureText(test).width <= maxW || !line.trim()) {
      if (c.measureText(test).width > maxW) {
        // A single word wider than the line: break it by character.
        let part = '';
        for (const ch of w) {
          if (c.measureText(part + ch).width > maxW && part) {
            push(part);
            part = '';
          }
          part += ch;
        }
        line = part;
      } else line = test;
    } else {
      push(line);
      line = /^\s+$/.test(w) ? '' : w;
    }
  }
  if (line.trim()) push(line);
  if (lines.length > maxLines) {
    const cut = lines.slice(0, maxLines);
    let last = cut[maxLines - 1];
    while (last && c.measureText(last + '…').width > maxW) last = last.slice(0, -1);
    cut[maxLines - 1] = last + '…';
    return cut;
  }
  return lines;
}

/** Largest size (up to max) at which `text` fits in maxLines lines of width maxW. */
function fit(c: CanvasRenderingContext2D, font: (size: number) => string, text: string, maxW: number, max: number, min: number, maxLines: number): number {
  for (let size = max; size > min; size -= 4) {
    c.font = font(size);
    if (wrap(c, text, maxW, 99).length <= maxLines) return size;
  }
  return min;
}

async function ready(fonts: CardFont[], texts: string[]) {
  await Promise.all([
    document.fonts.load(`16px ${UI}`),
    document.fonts.load(`16px ${MONO}`),
    ...fonts.map((f) => document.fonts.load(`${f.style} ${f.weight} 60px ${f.css}`, texts.join(' ') || 'A').catch(() => undefined)),
  ]);
}

export interface ShareOptions {
  size: CardSize;
  theme: Theme;
  text: string;
  font: CardFont;
  second: CardFont | null;
  watermark: boolean;
}

export async function drawShareCard(canvas: HTMLCanvasElement, o: ShareOptions): Promise<void> {
  const [W, H] = SIZES[o.size];
  canvas.width = W;
  canvas.height = H;
  const c = canvas.getContext('2d')!;
  const t = THEMES[o.theme];
  const portrait = o.size === 'portrait';
  const pad = Math.round(W * 0.065);
  const inner = W - pad * 2;
  await ready([o.font, ...(o.second ? [o.second] : [])], [o.font.name, o.text, ALPHABET]);
  c.fillStyle = t.bg;
  c.fillRect(0, 0, W, H);
  c.textBaseline = 'alphabetic';

  // Label
  c.fillStyle = t.muted;
  c.font = `400 ${portrait ? 24 : 21}px ${MONO}`;
  let y = pad + 24;
  c.fillText(`[${o.second ? `${o.font.label ? o.font.label + ' · ' : ''}WITH ${o.second.name.toUpperCase()}` : o.font.label}]`.slice(0, 90), pad, y);

  // Middle block: name as large as fits, then the text. Centred in the space
  // between the label and the footer (or the alphabet on portrait cards).
  const footer = H - pad;
  const alphaSize = 34;
  const alphaLines = 3;
  const alphaTop = portrait ? footer - 70 - alphaLines * alphaSize * 1.35 : footer - 70;
  const regionTop = y + 30;
  const regionBottom = alphaTop - 30;
  const nameFont = (sz: number) => `${o.font.style} ${o.font.weight} ${sz}px ${o.font.css}`;
  const nameSize = fit(c, nameFont, o.font.name, inner, portrait ? 190 : 150, 48, 2);
  c.font = nameFont(nameSize);
  const nameLines = wrap(c, o.font.name, inner, 2);
  const body = o.second ?? o.font;
  const sampleSize = portrait ? 48 : 40;
  const bodyFont = `${body.style} ${body.weight} ${sampleSize}px ${body.css}`;
  c.font = bodyFont;
  const nameH = nameLines.length * nameSize * 0.95;
  const labelH = o.second ? 40 : 0;
  const maxSampleLines = Math.max(1, Math.min(portrait ? 6 : 3, Math.floor((regionBottom - regionTop - nameH - sampleSize * 0.6 - labelH) / (sampleSize * 1.3))));
  const sampleLines = wrap(c, o.text, inner, maxSampleLines);
  const blockH = nameH + sampleSize * 0.6 + sampleLines.length * sampleSize * 1.3 + labelH;
  y = regionTop + Math.max(0, (regionBottom - regionTop - blockH) * 0.45);
  c.fillStyle = t.ink;
  c.font = nameFont(nameSize);
  for (const line of nameLines) {
    y += Math.round(nameSize * 0.95);
    c.fillText(line, pad, y);
  }
  y += Math.round(sampleSize * 0.6);
  c.font = bodyFont;
  for (const line of sampleLines) {
    y += Math.round(sampleSize * 1.3);
    c.fillText(line, pad, y);
  }
  if (o.second) {
    c.font = `400 ${portrait ? 20 : 18}px ${MONO}`;
    c.fillStyle = t.muted;
    y += 40;
    c.fillText(`BODY TEXT · ${o.second.name.toUpperCase()}`, pad, y);
    c.fillStyle = t.ink;
  }

  // Alphabet (portrait has the room)
  if (portrait) {
    c.font = `${o.font.style} ${o.font.weight} ${alphaSize}px ${o.font.css}`;
    c.fillStyle = t.ink;
    let ay = alphaTop;
    for (const line of wrap(c, ALPHABET, inner, alphaLines)) {
      ay += Math.round(alphaSize * 1.35);
      c.fillText(line, pad, ay);
    }
  }

  // Footer
  c.strokeStyle = t.line;
  c.lineWidth = 2;
  c.beginPath();
  c.moveTo(pad, footer - 44);
  c.lineTo(W - pad, footer - 44);
  c.stroke();
  c.fillStyle = t.muted;
  c.font = `400 ${portrait ? 20 : 18}px ${MONO}`;
  const markW = o.watermark ? 260 : 0;
  const details = wrap(c, o.font.details || ' ', inner - markW, 1)[0] ?? '';
  c.fillText(details, pad, footer);
  if (o.watermark) drawMark(c, t, W - pad, footer, portrait ? 22 : 20);
}

function drawMark(c: CanvasRenderingContext2D, t: (typeof THEMES)[Theme], right: number, baseline: number, size: number) {
  c.font = `600 ${size}px ${UI}`;
  const label = 'Font Finder Plus';
  const w = c.measureText(label).width;
  c.fillStyle = t.ink;
  c.fillText(label, right - w, baseline);
  c.fillStyle = '#19C05A';
  c.beginPath();
  c.arc(right - w - size * 0.7, baseline - size * 0.35, size * 0.28, 0, Math.PI * 2);
  c.fill();
}

export interface BoardOptions {
  name: string;
  theme: Theme;
  text: string;
  fonts: CardFont[];
  watermark: boolean;
}

/** A specimen board: every font with its name, the text, and its alphabet. Width 1200, height grows. */
export async function drawBoard(canvas: HTMLCanvasElement, o: BoardOptions): Promise<void> {
  const W = 1200;
  const pad = 64;
  const inner = W - pad * 2;
  await ready(o.fonts, [o.text, ALPHABET, ...o.fonts.map((f) => f.name)]);
  const measure = document.createElement('canvas').getContext('2d')!;
  const layout = (c: CanvasRenderingContext2D, draw: boolean, t: (typeof THEMES)[Theme]) => {
    let y = pad + 40;
    c.textBaseline = 'alphabetic';
    c.font = `600 40px ${UI}`;
    c.fillStyle = t.ink;
    if (draw) c.fillText(o.name || 'Specimen board', pad, y);
    y += 34;
    c.font = `400 18px ${MONO}`;
    c.fillStyle = t.muted;
    if (draw) c.fillText(`${o.fonts.length} ${o.fonts.length === 1 ? 'FONT' : 'FONTS'} · ${new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }).toUpperCase()}`, pad, y);
    y += 36;
    for (const f of o.fonts) {
      if (draw) {
        c.strokeStyle = t.line;
        c.lineWidth = 2;
        c.beginPath();
        c.moveTo(pad, y);
        c.lineTo(W - pad, y);
        c.stroke();
      }
      y += 44;
      c.font = `400 18px ${MONO}`;
      c.fillStyle = t.muted;
      if (draw) c.fillText(`${f.name.toUpperCase()}${f.label ? ` · ${f.label}` : ''}`.slice(0, 100), pad, y);
      c.font = `${f.style} ${f.weight} 64px ${f.css}`;
      c.fillStyle = t.ink;
      for (const line of wrap(c, o.text || f.name, inner, 2)) {
        y += 76;
        if (draw) c.fillText(line, pad, y);
      }
      c.font = `${f.style} ${f.weight} 26px ${f.css}`;
      y += 14;
      for (const line of wrap(c, ALPHABET, inner, 2)) {
        y += 36;
        if (draw) c.fillText(line, pad, y);
      }
      if (f.details) {
        c.font = `400 16px ${MONO}`;
        c.fillStyle = t.muted;
        y += 34;
        if (draw) c.fillText(f.details.slice(0, 120), pad, y);
      }
      y += 36;
    }
    return y + (o.watermark ? 40 : 0) + pad - 36;
  };
  const t = THEMES[o.theme];
  const H = Math.max(400, Math.ceil(layout(measure, false, t)));
  canvas.width = W;
  canvas.height = H;
  const c = canvas.getContext('2d')!;
  c.fillStyle = t.bg;
  c.fillRect(0, 0, W, H);
  layout(c, true, t);
  if (o.watermark) drawMark(c, t, W - pad, H - pad + 10, 18);
}

export function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not make the image'))), 'image/png'));
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'font';

// ------------------------------------------------------------- "Fonts used on [site]"

export interface SiteFont { name: string; css: string; weight: string; style: string; label: string }

/** CSS that draws a font from a page scan in the panel. */
export async function fontCssForUsage(u: import('../../shared/types').PageFontUsage, tabId: number | null): Promise<string> {
  if (u.kind === 'generic') return u.genericName ?? 'serif';
  if (u.kind === 'local') return `"${u.family}", "FFP NotDef"`;
  const faces = previewFaces(u.files);
  if (faces.length) {
    const alias = aliasFor(faces.map((f) => f.url).join('|'));
    if (await loadPreviewFamily(alias, faces, tabId)) return `"${alias}", "FFP NotDef"`;
  }
  const gf = googleFamily(u.catalogFamily ?? u.displayName ?? u.family);
  if (gf) {
    await linkGoogleFamily(gf.family);
    return `"${gf.family}", "FFP NotDef"`;
  }
  return `"${u.family}", system-ui`;
}

export async function drawSiteCard(canvas: HTMLCanvasElement, o: { size: CardSize; theme: Theme; host: string; fonts: SiteFont[]; watermark: boolean }): Promise<void> {
  const [W, H] = SIZES[o.size];
  canvas.width = W;
  canvas.height = H;
  const c = canvas.getContext('2d')!;
  const t = THEMES[o.theme];
  const portrait = o.size === 'portrait';
  const pad = Math.round(W * 0.065);
  const inner = W - pad * 2;
  await ready(o.fonts as CardFont[], o.fonts.map((f) => f.name));
  c.fillStyle = t.bg;
  c.fillRect(0, 0, W, H);
  c.textBaseline = 'alphabetic';
  c.fillStyle = t.muted;
  c.font = `400 ${portrait ? 24 : 21}px ${MONO}`;
  c.fillText(`[FONTS USED ON ${o.host.toUpperCase()}]`.slice(0, 80), pad, pad + 24);

  const footer = H - pad;
  const top = pad + 70;
  const bottom = footer - 70;
  const n = Math.max(1, o.fonts.length);
  const slot = (bottom - top) / n;
  o.fonts.forEach((f, i) => {
    const y0 = top + slot * i;
    const nameFont = (sz: number) => `${f.style} ${f.weight} ${sz}px ${f.css}`;
    const size = fit(c, nameFont, f.name, inner, Math.min(portrait ? 150 : 120, slot * 0.62), 28, 1);
    c.font = nameFont(size);
    c.fillStyle = t.ink;
    c.fillText(wrap(c, f.name, inner, 1)[0] ?? f.name, pad, y0 + size * 0.95);
    c.font = `400 ${portrait ? 20 : 17}px ${MONO}`;
    c.fillStyle = t.muted;
    c.fillText(f.label.slice(0, 90), pad, y0 + size * 0.95 + (portrait ? 34 : 28));
    if (i < n - 1) {
      c.strokeStyle = t.line;
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(pad, y0 + slot - 8);
      c.lineTo(W - pad, y0 + slot - 8);
      c.stroke();
    }
  });

  c.strokeStyle = t.line;
  c.lineWidth = 2;
  c.beginPath();
  c.moveTo(pad, footer - 44);
  c.lineTo(W - pad, footer - 44);
  c.stroke();
  c.fillStyle = t.muted;
  c.font = `400 ${portrait ? 20 : 18}px ${MONO}`;
  c.fillText(`${o.fonts.length} ${o.fonts.length === 1 ? 'FONT' : 'FONTS'}`, pad, footer);
  if (o.watermark) drawMark(c, t, W - pad, footer, portrait ? 22 : 20);
}
