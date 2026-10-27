// HEIC/HEIF photos (iPhone) are decoded with libheif (LGPL-3.0), shipped as
// its own unchanged file in heic/ and loaded only when a HEIC file is opened.

interface HeifImage {
  get_width(): number;
  get_height(): number;
  display(target: { data: Uint8ClampedArray; width: number; height: number }, cb: (d: unknown) => void): void;
}
interface LibHeif { HeifDecoder: new () => { decode(buf: ArrayBuffer | Uint8Array): HeifImage[] } }

let lib: Promise<LibHeif> | null = null;

function load(): Promise<LibHeif> {
  lib ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = chrome.runtime.getURL('heic/libheif.js');
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Could not load the HEIC decoder.'));
    document.head.appendChild(s);
  }).then(async () => {
    const factory = (window as unknown as { libheif: (o: object) => Promise<LibHeif> }).libheif;
    // The decoder needs its WebAssembly file handed to it.
    const wasmBinary = await (await fetch(chrome.runtime.getURL('heic/libheif.wasm'))).arrayBuffer();
    return factory({ wasmBinary });
  });
  lib.catch(() => (lib = null));
  return lib;
}

export const isHeic = (f: File) => /\.(heic|heif)$/i.test(f.name) || /image\/hei[cf]/i.test(f.type);

export async function heicToCanvas(file: File): Promise<HTMLCanvasElement> {
  const libheif = await load();
  const images = new libheif.HeifDecoder().decode(new Uint8Array(await file.arrayBuffer()));
  const img = images[0];
  if (!img) throw new Error('This HEIC file has no image in it.');
  const width = img.get_width();
  const height = img.get_height();
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const imageData = ctx.createImageData(width, height);
  await new Promise<void>((resolve, reject) =>
    img.display(imageData, (d) => (d ? resolve() : reject(new Error('This HEIC image could not be decoded.')))),
  );
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}
