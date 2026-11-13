// Plain explanations for pages the extension cannot read, from Chrome's error.

export const FILE_ACCESS_HINT = 'Allow access to file URLs';

/** Why a page cannot be read, in plain words. `fileAccess`: whether the user allowed file URLs. */
export function explainInjectError(err: string, url: string | undefined, fileAccess: boolean): string {
  const u = url ?? /url "([^"]+)"/i.exec(err)?.[1] ?? '';
  if (/^file:/i.test(u) || /file:\/\//i.test(err)) {
    return fileAccess
      ? 'This file on your computer could not be read. Reload it and try again.'
      : `This is a file on your computer. Chrome only lets extensions read files if you allow it: on the extension's details page, turn on "${FILE_ACCESS_HINT}", then reload this file.`;
  }
  if (/^(chrome|edge|brave|opera|vivaldi|about):/i.test(u) || /chrome:\/\//i.test(err)) return "This is one of Chrome's own pages (settings, new tab, history...). Chrome does not let any extension read them.";
  if (/chromewebstore\.google\.com|chrome\.google\.com\/webstore/i.test(u) || /extensions gallery/i.test(err)) return 'The Chrome Web Store blocks every extension, so its fonts cannot be read here.';
  if (/^chrome-extension:/i.test(u)) return "This page belongs to another extension. Chrome does not let extensions read each other's pages.";
  if (/^view-source:/i.test(u)) return 'This is a page\'s source code view. Open the page itself to read its fonts.';
  if (/\.pdf($|[?#])/i.test(u)) return "This is a PDF in Chrome's PDF viewer, which extensions cannot read. Fonts inside a PDF are not web fonts. To identify one, take a screenshot and use the Image tab.";
  if (/cannot access|cannot be scripted/i.test(err)) return 'Chrome does not let extensions read this page. Reload it and try again; if it still fails, the page is protected.';
  return 'Could not start on this page. Reload the page and try again.';
}

/** Pages that draw their text as pictures (canvas), so fonts cannot be read from the page itself. */
export function drawsTextAsPictures(url: string | undefined): string | null {
  if (!url) return null;
  if (/^https:\/\/docs\.google\.com\/(document|presentation|spreadsheets)\//.test(url)) return 'Google Docs, Slides and Sheets draw their text as pictures.';
  if (/^https:\/\/(www\.)?figma\.com\/(file|design|proto|board)\//.test(url)) return 'Figma draws its text as pictures.';
  if (/^https:\/\/(www\.)?canva\.com\/design\//.test(url)) return 'Canva draws much of its text as pictures.';
  return null;
}
