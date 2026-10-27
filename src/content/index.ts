import type { FetchFontReply, PingReply, ScanReply, ToContent } from '../shared/messages';
import { arrayBufferToBase64 } from '../shared/messages';
import { clearRenderCache } from './detect';
import { hideUi, highlightElements, highlightKey, isInspecting, setStateListener, start, stop } from './inspector';
import { scanPage, watchNewFonts } from './scan';
import { afterPaint, imageRect, selectArea } from './select';
import { SHAPE_TEXT, shapeFromCanvas } from '../shared/shape';
import { elementsForIssue, scanSystem } from './system';
import { activeSwaps, swapFont, unswap, varyFont } from './swap';

declare global {
  interface Window {
    __ffpLoaded?: boolean;
  }
}

const MAX_FONT_BYTES = 4 * 1024 * 1024;

if (!window.__ffpLoaded) {
  window.__ffpLoaded = true;

  setStateListener((on) => {
    chrome.runtime.sendMessage({ type: 'ffp:inspector-state', on, url: location.href }, () => void chrome.runtime.lastError);
  });

  chrome.runtime.onMessage.addListener((msg: ToContent, _sender, reply) => {
    switch (msg.type) {
      case 'ffp:ping': {
        const r: PingReply = { ok: true, inspecting: isInspecting(), url: location.href, host: location.hostname, title: document.title };
        reply(r);
        return false;
      }
      case 'ffp:inspect':
        if (msg.on) start();
        else stop();
        reply({ ok: true });
        return false;
      case 'ffp:scan':
        clearRenderCache();
        scanPage()
          .then((scan) => reply({ ok: true, scan } satisfies ScanReply))
          .catch((err) => reply({ ok: false, error: String(err?.message ?? err) } satisfies ScanReply));
        return true;
      case 'ffp:fetch-font':
        fetchFont(msg.url).then(reply);
        return true;
      case 'ffp:swap':
        swapFont(msg.key, msg.family, msg.faces, msg.generic, msg.aspect)
          .then((count) => reply({ ok: true, count }))
          .catch((err) => reply({ ok: false, error: String(err?.message ?? err) }));
        return true;
      case 'ffp:unswap':
        unswap(msg.key);
        reply({ ok: true });
        return false;
      case 'ffp:vary':
        reply({ ok: true, count: varyFont(msg.key, msg.settings, msg.weight) });
        return false;
      case 'ffp:swaps':
        reply({ ok: true, swaps: activeSwaps() });
        return false;
      case 'ffp:measure': {
        // Measure the font the way this page draws it (works even when its file cannot be downloaded).
        const fam = `"${msg.family.replace(/"/g, '')}"`;
        document.fonts
          .load(`${msg.style} ${msg.weight} 40px ${fam}`, SHAPE_TEXT)
          .catch(() => undefined)
          .then(() => reply({ ok: true, shape: shapeFromCanvas(fam, msg.weight, msg.style) }))
          .catch(() => reply({ ok: false }));
        return true;
      }
      case 'ffp:select-area':
        hideUi(true);
        selectArea().then((r) => {
          reply({ ok: true, rect: r });
        });
        return true;
      case 'ffp:image-rect': {
        const r = imageRect(msg.src);
        hideUi(true);
        afterPaint(() => reply({ ok: true, rect: r }));
        return true;
      }
      case 'ffp:hide-ui':
        hideUi(msg.hidden);
        reply({ ok: true });
        return false;
      case 'ffp:system':
        try {
          reply({ ok: true, system: scanSystem() });
        } catch (err) {
          reply({ ok: false, error: String((err as Error)?.message ?? err) });
        }
        return false;
      case 'ffp:highlight-issue':
        reply({ ok: true, ...highlightElements(`issue:${msg.id}`, elementsForIssue(msg.id), msg.label) });
        return false;
      case 'ffp:highlight':
        reply({ ok: true, ...highlightKey(msg.key, msg.label) });
        return false;
    }
    return false;
  });

  watchNewFonts();

  // Tell the side panel when a single-page app changes its URL.
  let lastUrl = location.href;
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      chrome.runtime.sendMessage({ type: 'ffp:page-changed', url: lastUrl }, () => void chrome.runtime.lastError);
    }
  }, 1000);
}

/** Fetch a font file from the page's own origin (works for same-site and CORS-enabled files). */
async function fetchFont(url: string): Promise<FetchFontReply> {
  try {
    const res = await fetch(url, { credentials: 'same-origin' });
    if (!res.ok) return { ok: false, error: `The server answered ${res.status}.` };
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_FONT_BYTES) return { ok: false, error: 'The font file is larger than 4 MB.' };
    return { ok: true, base64: arrayBufferToBase64(buf) };
  } catch {
    return { ok: false, error: 'The site does not allow this file to be read from another page.' };
  }
}
