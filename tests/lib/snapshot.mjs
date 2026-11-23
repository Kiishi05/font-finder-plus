// Saves what a page shows as one standalone HTML file (for laying screens out on a
// design canvas, or importing into Figma with html.to.design). Dev only, never shipped.
//
//   - styles are inlined; scripts, links and @font-face rules for our own UI fonts are left out
//   - our bundled UI fonts ("FFP Geist", "FFP Geist Mono") become Geist / Geist Mono from Google Fonts
//   - canvases, blob: and extension images, and CSS background images become data URLs
//   - fonts the page made with `new FontFace(...)` (font previews) are embedded when the
//     snapshot uses them (needs FONT_RECORDER as an init script, see below)
//   - typed field values, ticks and selections are kept
//   - animations and transitions are shown at their end
//
// Used by tests/stress.mjs (FFP_SNAPSHOT=1) and tests/capture-all.mjs.

/**
 * Init script: remembers the bytes or source of every FontFace the page creates, so a
 * snapshot can embed the preview fonts it uses. Add with context.addInitScript().
 */
export const FONT_RECORDER = `(() => {
  if (window.__ffpFaces || typeof FontFace === 'undefined') return;
  const faces = window.__ffpFaces = [];
  const Orig = FontFace;
  function F(family, source, desc) {
    const face = new Orig(family, source, desc);
    try {
      let src = null;
      if (typeof source === 'string') src = source;
      else if (source instanceof ArrayBuffer) src = source.slice(0);
      else if (ArrayBuffer.isView(source)) src = source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
      if (src) faces.push({ family: String(family), src, desc: Object.assign({}, desc || {}) });
    } catch (e) {}
    return face;
  }
  F.prototype = Orig.prototype;
  Object.setPrototypeOf(F, Orig);
  window.FontFace = F;
})();`;

const GOOGLE_UI_FONTS = 'https://fonts.googleapis.com/css2?family=Geist:wght@100..900&family=Geist+Mono:wght@100..900&family=Inter:wght@100..900&display=swap';

/**
 * Serialise the page (or the open shadow root of `rootSel`) into one HTML string.
 * Returns { html, width, height }.
 *
 * opts.rootSel     shadow host to snapshot instead of the document (e.g. '#ffp-root')
 * opts.background  page colour behind a shadow-root snapshot
 * opts.title       <title> of the file
 * opts.maxFontBytes  largest single font file to embed (default 300 KB)
 * opts.fixedHeight   give <body> the measured height (for windows laid out to fill it)
 * opts.extraCss      more CSS for the file; {H} becomes the measured height
 */
export async function snapshotHtml(page, opts = {}) {
  return page.evaluate(async ({ rootSel, background, title, maxFontBytes, googleFonts, fixedHeight, extraCss }) => {
    const host = rootSel ? document.querySelector(rootSel) : null;
    const shadow = host?.shadowRoot ?? null;
    const rootEl = shadow ?? document.body;

    const toDataUrl = async (url) => {
      try {
        const r = await fetch(url);
        if (!r.ok) return null;
        const b = await r.blob();
        return await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = () => res(null); fr.readAsDataURL(b); });
      } catch { return null; }
    };
    const needsInline = (u) => !!u && !/^(data:|https:)/.test(u);
    const b64 = (buf) => {
      const bytes = new Uint8Array(buf);
      let s = '';
      for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(s);
    };
    const mapUiFonts = (t) => t.replace(/"?FFP Geist Mono"?/g, '"Geist Mono"').replace(/"?FFP Geist"?/g, 'Geist').replace(/\s*,\s*"?FFP NotDef( Wide)?"?/g, '').replace(/"?FFP NotDef( Wide)?"?\s*,?\s*/g, '');

    // Live and cloned elements, in the same order, before anything is removed.
    const clone = shadow ? (() => { const d = document.createElement('div'); d.innerHTML = shadow.innerHTML; return d; })() : document.body.cloneNode(true);
    const live = [...rootEl.querySelectorAll('*')];
    const copy = [...clone.querySelectorAll('*')];
    const aligned = live.length === copy.length;

    // Families in use, for embedding preview fonts.
    const used = new Set();
    const famList = (v) => v.split(',').map((x) => x.trim().replace(/^["']|["']$/g, '').toLowerCase()).filter(Boolean);
    // And the characters shown in each, so only the font subsets that draw them are embedded.
    const charsOf = new Map();
    for (const el of live) {
      const fams = famList(getComputedStyle(el).fontFamily);
      fams.forEach((f) => used.add(f));
      let own = '';
      for (const n of el.childNodes) if (n.nodeType === 3) own += n.textContent;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) own += el.value + (el.placeholder ?? '');
      if (!own.trim()) continue;
      for (const f of fams) { charsOf.set(f, (charsOf.get(f) ?? '') + own); }
    }
    const inRange = (range, text) => {
      if (!range) return true;
      const spans = range.split(',').map((r) => r.trim().replace(/^U\+/i, '')).map((r) => {
        if (r.includes('?')) return [parseInt(r.replace(/\?/g, '0'), 16), parseInt(r.replace(/\?/g, 'F'), 16)];
        const [a, b] = r.split('-');
        return [parseInt(a, 16), parseInt(b ?? a, 16)];
      });
      for (const ch of text) { const c = ch.codePointAt(0); if (c > 32 && spans.some(([a, b]) => c >= a && c <= b)) return true; }
      return false;
    };

    if (aligned) {
      for (let i = 0; i < live.length; i++) {
        const l = live[i];
        const c = copy[i];
        // Form state lives in properties, not attributes.
        if (l instanceof HTMLInputElement) {
          if (l.type === 'checkbox' || l.type === 'radio') { if (l.checked) c.setAttribute('checked', ''); else c.removeAttribute('checked'); }
          else if (l.type !== 'file') c.setAttribute('value', l.value);
        } else if (l instanceof HTMLTextAreaElement) c.textContent = l.value;
        else if (l instanceof HTMLSelectElement) [...c.options].forEach((o, k) => { if (k === l.selectedIndex) o.setAttribute('selected', ''); else o.removeAttribute('selected'); });
        // Pictures from blobs, the extension or the local test server.
        if (l instanceof HTMLImageElement) {
          c.removeAttribute('srcset');
          const src = l.currentSrc || l.src;
          if (needsInline(src)) {
            let data = null;
            if (l.complete && l.naturalWidth) {
              try { const cv = document.createElement('canvas'); cv.width = l.naturalWidth; cv.height = l.naturalHeight; cv.getContext('2d').drawImage(l, 0, 0); data = cv.toDataURL(/png|svg|gif/i.test(src) ? 'image/png' : 'image/jpeg', 0.85); } catch {}
            }
            if (!data) data = await toDataUrl(src);
            if (data) c.setAttribute('src', data);
          }
        }
        // CSS background images (inline or from stylesheets) that point at blobs or the extension.
        const bg = getComputedStyle(l).backgroundImage;
        if (bg && bg !== 'none' && /url\(/.test(bg)) {
          const urls = [...bg.matchAll(/url\("?([^")]+)"?\)/g)].map((m) => m[1]).filter(needsInline);
          if (urls.length) {
            let out = bg;
            for (const u of urls) { const d = await toDataUrl(u); if (d) out = out.split(u).join(d); }
            c.style.backgroundImage = out;
          }
        }
        if (c.getAttribute('style')) c.setAttribute('style', mapUiFonts(c.getAttribute('style')));
      }
      // Canvases (font samples, pictures, share cards) become images.
      for (let i = 0; i < live.length; i++) {
        const l = live[i];
        if (!(l instanceof HTMLCanvasElement)) continue;
        const c = copy[i];
        try {
          const img = document.createElement('img');
          img.src = l.toDataURL('image/png');
          for (const a of c.attributes) if (a.name !== 'width' && a.name !== 'height') img.setAttribute(a.name, a.value);
          const r = l.getBoundingClientRect();
          img.width = Math.round(r.width) || l.width;
          img.height = Math.round(r.height) || l.height;
          c.replaceWith(img);
        } catch {}
      }
    }
    clone.querySelectorAll('script, style, link, noscript').forEach((e) => e.remove());

    // Styles, from each sheet's own text: Chrome's cssText drops shorthands that use var()
    // (font: 13px var(--ui) comes back as empty longhands). @font-face blocks are left out;
    // our UI fonts come from Google Fonts below.
    const sheets = shadow ? [...shadow.querySelectorAll('style')].map((s) => s.sheet).filter(Boolean) : [...document.styleSheets];
    const parts = [];
    for (const sh of sheets) {
      let text = null;
      const owner = sh.ownerNode;
      if (owner instanceof HTMLStyleElement) text = owner.textContent;
      else if (sh.href) { try { const r = await fetch(sh.href); if (r.ok) text = await r.text(); } catch {} }
      if (text == null) { try { text = [...sh.cssRules].map((r) => r.cssText).join('\n'); } catch { text = ''; } }
      text = text.replace(/@font-face\s*\{[^}]*\}/g, '');
      // Relative url(...) in a linked sheet: make it absolute, so it can be inlined below.
      if (sh.href) text = text.replace(/url\(\s*(["']?)(?!data:|https?:|blob:|chrome-extension:|#)([^"')]+)\1\s*\)/g, (m, q, u) => { try { return `url("${new URL(u, sh.href).href}")`; } catch { return m; } });
      parts.push(text);
      // Keep a page's own faces only when they load from the open web and are used.
      try {
        for (const r of sh.cssRules) {
          if (!(r instanceof CSSFontFaceRule)) continue;
          const fam = famList(r.style.getPropertyValue('font-family'))[0];
          if (fam && used.has(fam) && !/^ffp /.test(fam) && /url\("?https:/.test(r.cssText) && !/url\("?(?!https:)[a-z-]+:/.test(r.cssText)) parts.push(r.cssText);
        }
      } catch {}
    }
    let css = mapUiFonts(parts.join('\n'));
    if (shadow) css = css.replace(/:host\b/g, '.ffp-host');
    // url(...) that only works inside the extension or on the local test server.
    for (const u of new Set([...css.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)].map((m) => m[1].trim()).filter((u) => /^(blob:|chrome-extension:|http:)/.test(u)))) {
      const d = await toDataUrl(u);
      if (d) css = css.split(u).join(d);
    }

    // Preview fonts made with new FontFace(): embed the ones in use.
    const faceCss = [];
    const seenFace = new Set();
    for (const f of window.__ffpFaces ?? []) {
      const fam = f.family.replace(/^["']|["']$/g, '');
      if (!used.has(fam.toLowerCase())) continue;
      const d = f.desc ?? {};
      if (!inRange(d.unicodeRange, charsOf.get(fam.toLowerCase()) ?? '')) continue;
      const key = `${fam}|${d.weight ?? ''}|${d.style ?? ''}|${d.unicodeRange ?? ''}|${d.stretch ?? ''}`;
      if (seenFace.has(key)) continue;
      let src = null;
      if (typeof f.src === 'string') {
        const m = /url\(["']?([^"')]+)["']?\)/.exec(f.src);
        if (m && /^https:/.test(m[1])) src = `url("${m[1]}")`;
        else if (m) { const data = await toDataUrl(m[1]); if (data) src = `url("${data}")`; }
      } else if (f.src && f.src.byteLength <= maxFontBytes) {
        src = `url("data:font/woff2;base64,${b64(f.src)}")`;
      }
      if (!src) continue;
      seenFace.add(key);
      const desc = [`font-family: "${fam}"`, `src: ${src}`, d.weight && `font-weight: ${d.weight}`, d.style && `font-style: ${d.style}`, d.stretch && `font-stretch: ${d.stretch}`, d.unicodeRange && `unicode-range: ${d.unicodeRange}`, 'font-display: block'].filter(Boolean);
      faceCss.push(`@font-face { ${desc.join('; ')}; }`);
    }

    // Shown as it ends: no entrance animations or transitions mid-way.
    const still = '*, *::before, *::after { animation-duration: 0s !important; animation-delay: 0s !important; animation-iteration-count: 1 !important; transition-duration: 0s !important; transition-delay: 0s !important; caret-color: transparent; }';

    const de = document.documentElement;
    const htmlAttrs = [...de.attributes].filter((a) => ['class', 'data-theme', 'lang', 'dir'].includes(a.name)).map((a) => ` ${a.name}="${a.value.replace(/"/g, '&quot;')}"`).join('');
    const width = shadow ? innerWidth : de.clientWidth;
    const height = shadow ? innerHeight : Math.max(de.scrollHeight, document.body.scrollHeight, innerHeight);
    let body;
    let bodyAttrs = '';
    if (shadow) {
      // A transformed box makes position: fixed relative to it, so the dock and card stay put.
      body = `<div class="ffp-host" style="position:relative;width:${width}px;height:${height}px;overflow:hidden;transform:translateZ(0)">${clone.innerHTML}</div>`;
      bodyAttrs = ` style="margin:0;width:${width}px;height:${height}px;background:${background}"`;
    } else {
      body = clone.innerHTML;
      const cls = document.body.getAttribute('class');
      const st = (document.body.getAttribute('style') ?? '').replace(/;?\s*$/, '');
      bodyAttrs = `${cls ? ` class="${cls}"` : ''} style="${st ? `${st};` : ''}width:${width}px;min-height:${height}px;margin:0;overflow:visible;height:${fixedHeight ? `${height}px` : 'auto'}"`;
    }
    const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    const html = `<!doctype html>\n<html${htmlAttrs}><head><meta charset="utf-8"><meta name="viewport" content="width=${width}"><title>${esc(title ?? '')}</title><link rel="stylesheet" href="${googleFonts}"><style>${faceCss.join('\n')}\n${css}\n${still}\nhtml{overflow:visible;height:auto}\n${(extraCss || '').replace(/\{H\}/g, String(height))}</style></head><body${bodyAttrs}>${body}</body></html>`;
    return { html, width, height };
  }, { rootSel: opts.rootSel ?? null, background: opts.background ?? '#F4F5F7', title: opts.title ?? '', maxFontBytes: opts.maxFontBytes ?? 300 * 1024, googleFonts: GOOGLE_UI_FONTS, fixedHeight: !!opts.fixedHeight, extraCss: opts.extraCss ?? '' });
}
