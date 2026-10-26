# Font Finder Plus

A Chrome extension (Manifest V3) for designers and developers. Hover any text to see the font that is really rendering, see every font a page uses, save fonts to collections, and copy their CSS.

Status: **Phase 1 (Identify)** and **Phase 2 (Understand)** are complete. Later phases add swapping and pairing, type systems, export, specimen boards and identifying fonts from images.

## Load it in Chrome

1. `npm install`
2. `npm run build` (creates `dist/`)
3. Open `chrome://extensions`, switch on **Developer mode**, click **Load unpacked**, choose the `dist` folder.
4. Pin Font Finder Plus from the puzzle icon.

After pulling new code: `git pull && npm install && npm run build`, then click the reload arrow on the extension card and refresh the tab you are testing.

## Using it

- **Start:** click the toolbar icon or press `Alt` + `Shift` + `F`. The side panel opens and the hover inspector starts on that tab. You can also right-click anywhere on the web page and choose **Inspect fonts on this page**.
- **Stop:** click **Stop** on the black bar at the bottom of the page, click the toolbar icon again, press `Alt` + `Shift` + `F`, use the switch in the panel, or close the side panel.
- **Hover card:** shows the rendered font, weight, style, size, line height, letter spacing and colour, plus cap height and x-height measured from the real font. Click any value to copy it.
  - Click to pin the card so you can use its buttons, click again to unpin. Links and buttons on the page are not followed while inspecting.
  - The card's close button hides it until you move to other text. `Esc` is not used, because Chrome also uses it to leave full screen.
- **Page tab:** every font the page renders, how many elements use it and where (headings, body, buttons, links, navigation, code, captions). Fonts that are named in the CSS but never loaded are called out, with the font that shows instead.
- **Font detail:** facts read from the font file itself (format, foundry, designer, version, glyph count, metrics, variable axes), the CSS stack, the source, and the licence type where it is known.
- **Icon fonts** (for example Font Awesome, Material Symbols or a site's own icon font) are named in one line and left out of the list, because they draw symbols rather than text.
- **Show on page:** outlines the text that uses a font, follows the page as it scrolls, and fades after 6 seconds.
- **Library:** saved fonts in a grid or wide list, collections with colours (a font can be in several), search, and filters for style, licence, source and Google Fonts availability.
- **Licence, in plain language** (font detail): what you can do with the font (websites, print, apps, logos, changing it, selling it). Open licences (OFL, Apache, Ubuntu) are summarised from their published text. About 50 well-known commercial families are matched to the foundry that sells them, with a link; their exact terms are never guessed. Anything else is shown as unknown. Always marked "This is a summary, not legal advice."
- **Languages** (font detail): checks 35 languages (including English, Spanish, French, German, Italian, Portuguese, Yoruba, Igbo, Hausa, Swahili, Twi, Zulu, Russian, Greek, Arabic, Hebrew, Hindi, Bengali, Thai, Amharic, Chinese, Japanese and Korean) against the font's real character list. A language counts as supported only when every letter of its alphabet is present. Chinese, Japanese and Korean have thousands of characters, so a set of very common ones is checked. Missing letters are listed.
- **On this computer** (font detail): a quick yes or no, and, with Chrome's Local Font Access (Chrome asks once), the installed styles. The installed copy can then be used for the language check and glyphs.
- **Glyphs** (font detail): every character in the font, grouped by Unicode block, searchable by letter or code point. Click one to copy it, or its CSS or HTML code.
- Previews never borrow letters from another font: a missing character shows as a box (Adobe NotDef).
- **Sample text:** each font's name, your own text, or a sample sentence in one of 16 languages.

## Permissions, and why each one is needed

| Permission | Why |
| --- | --- |
| `activeTab` | Lets the extension read the page you are on, but only after you click its icon, press its shortcut or use its right-click menu on that tab. No access to other tabs. |
| `scripting` | Starts the inspector on that page (injects the content script) when you ask it to. |
| `sidePanel` | Shows the main workspace in Chrome's side panel. |
| `storage` | Saves settings (theme, your Google Fonts API key, whether the guide is hidden) in Chrome's local storage on this computer. |
| `contextMenus` | Adds **Inspect fonts on this page** to the right-click menu. |
| `<all_urls>` (optional, off by default) | Only if you turn it on in Settings. Lets the extension download font files from sites that block other pages from reading them, so foundry, format and metrics can be shown there, and lets you start inspecting from the side panel. Chrome asks you first, and you can turn it off again in Settings. |

The extension does not ask for access to all your sites when you install it.

## Privacy

- Everything runs on your computer. The library lives in IndexedDB inside the extension. There is no account and no server.
- No browsing data is sent anywhere. Font files are downloaded only from the hosts the page already uses.
- For fonts in the Google Fonts catalogue, the language check asks Google Fonts for a file holding the test characters (the request carries only the family name and those characters, nothing about the page you are on).
- Local Font Access (installed styles) runs only when you click, and the font list never leaves your computer.
- Your Google Fonts API key is stored only in `chrome.storage.local`. It is never written to code, logs or the library, and it is only sent to Google's Web Fonts API when you use it.

## How the real font is found

CSS lists fonts in order (`font-family: "Söhne", Arial, sans-serif`). The browser uses the first one that is available. For each piece of text the extension:

1. Reads the computed font stack, weight and style.
2. Checks Chrome's list of web fonts (`document.fonts`) for faces that have actually loaded and that cover the characters in that text (unicode ranges are respected).
3. For names that are not web fonts, checks whether the font is installed by comparing measured text widths against fallback fonts.
4. For generic names such as `sans-serif` or `system-ui`, finds which installed font they map to by matching measured widths.
5. Reads `@font-face` rules (including cross-origin stylesheets such as Google Fonts) to find each font's file, and from the file's address decides the source: Google Fonts, Adobe Fonts, Bunny Fonts, self-hosted, another CDN, embedded, or added by a script.

Fonts the browser has not fetched yet (pages often load fonts lazily) are given up to 3 seconds to load before anything is reported as missing.

## Data sources

- `src/shared/data/gf-catalog.json` holds all Google Fonts families with category, designers, axes and licence. Rebuild it with `npm run build:catalog`.
  - Families, categories, designers and axes come from the public metadata the Google Fonts website uses.
  - Licences are not in that metadata or in the Developer API. They are read from the official [google/fonts](https://github.com/google/fonts) repository, where each family sits in an `ofl/`, `apache/` or `ufl/` folder. Families that cannot be found there are stored as unknown, never guessed.
- Facts about a specific font (foundry, designer, version, metrics, axes) are read from the font file's own tables with [fontkit](https://github.com/foliojs/fontkit), in a Web Worker so pages and the panel stay fast.

## Known limits

- Chrome does not let extensions run on `chrome://` pages, the Chrome Web Store or the built-in PDF viewer.
- Some fonts (for example Adobe Fonts) are protected or split into many small files. If a file cannot be read, the panel says so and shows what it does know.
- On macOS the system interface font (San Francisco) cannot be addressed by name, so it is reported as "San Francisco" from the platform rather than measured.
- On Linux, the system can substitute similar fonts for well-known names (for example Liberation Sans for Arial), so the name shown is the one the page asked for.
- Text inside iframes from other sites and inside closed shadow roots is not scanned.

## Develop

- `npm run build` builds `dist/`. `npm run watch` rebuilds on change.
- `npm run typecheck` runs TypeScript.
- `npm run build:test && npm test` builds a test copy (`dist-test/`, with host access granted so no prompt is needed) and runs the end-to-end checks in `tests/run.mjs` with Playwright.

```
src/
  background/   service worker: toolbar click, shortcut, right-click menu, saving, fetching
  content/      runs in the page on demand: detection, page scan, hover card
  sidepanel/    React side panel: Page, Font detail, Library, Settings
  workers/      font file parser (fontkit) in a Web Worker
  shared/       types, database (Dexie), messages, catalogue, CSS helpers, icons, brand name
scripts/        build and catalogue scripts
tests/          end-to-end checks and a test page
```

Rename the product in `src/shared/brand.ts` and `public/manifest.json`.

## Credits and licences

- Interface fonts: [Inter](https://rsms.me/inter/) and [JetBrains Mono](https://www.jetbrains.com/lp/mono/), both under the SIL Open Font License 1.1 (see `public/fonts/`).
- [Adobe NotDef](https://github.com/adobe-fonts/adobe-notdef), SIL Open Font License 1.1, draws boxes for missing characters in previews.
- Icons: [Hugeicons](https://hugeicons.com) free set, MIT License.
- Font parsing: fontkit, MIT License. Database: Dexie, Apache 2.0.
