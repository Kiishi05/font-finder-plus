# Chrome Web Store listing

Paste these into the Chrome Web Store developer dashboard. Upload `release/font-finder-plus-<version>.zip` made with `npm run package`.

## Store listing tab

**Name:** Font Finder Plus

**Summary (132 characters max):**
Find the real fonts on any website or image. See licences, metrics and free alternatives, save them and copy the CSS.

**Category:** Developer Tools (or Productivity > Workflow and Planning)

**Language:** English

**Description:**

Font Finder Plus tells you which font is really showing on a page, not just what the CSS asks for.

Hover any text to see the font that renders it, its size, weight, line height and colour. Click to pin the card. Open the side panel to see every font on the page, where each one is used, and which fonts failed to load.

For each font you get:
- The licence in plain language, when it is known (free, commercial or system). Unknown means unknown: nothing is guessed. This is a summary, not legal advice.
- Metrics measured from the font file: x-height, cap height, ascender, descender.
- Every glyph, its Unicode name, and the languages the font supports.
- Close free alternatives from Google Fonts, measured against the page, and pairing ideas you can try live on the page.
- Copy-ready CSS.

Find a font in an image: drop in a screenshot or photo (PNG, JPG, WebP or HEIC), or right-click a picture on a page. Text is read on your computer and matched against the Google Fonts catalogue and the fonts on the page.

Save fonts to your library, sort them into collections, build mood boards and make share cards.

Private by design: everything runs on your computer. No account, no tracking, no analytics. The only network calls are to Google Fonts for the catalogue and previews, and to the page's own font files when you inspect it.

## Privacy practices tab

**Single purpose:**
Identify and inspect the fonts used on web pages and in images, and keep a personal library of them.

**Permission justifications:**

- `activeTab`: Reads the fonts on the current tab only after the user clicks the toolbar icon, presses the shortcut or uses the right-click menu.
- `scripting`: Injects the inspector (hover card and page scan) into the current tab when the user starts it.
- `sidePanel`: The main interface (font list, details, library) is shown in the side panel.
- `storage`: Stores settings on the user's computer, such as theme and an optional Google Fonts API key the user enters.
- `contextMenus`: Adds "Inspect fonts on this page" and "Identify the font in this image" to the right-click menu.
- Optional host permission `<all_urls>`: Off by default and requested only when the user turns it on in Settings. Used to read font files that sites block from other origins (to show foundry, format and metrics) and to keep the inspector running when the user switches tabs.

**Remote code:** No, I am not using remote code. All JavaScript and WebAssembly (text recognition, HEIC decoding) is packaged in the extension.

**Data usage:** Tick none of the data types. The extension does not collect or transmit user data. Page content, images and the library stay on the user's computer.

Certify:
- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

**Privacy policy URL:** Host the text below (for example as a GitHub Pages page or a public gist) and paste its URL.

## Privacy policy

Font Finder Plus runs entirely on your computer.

- It reads a web page only when you start it on that page. It reads the page's fonts, text styles and font files to show you what fonts are used.
- Images you add are read on your computer. They are not uploaded.
- Your saved fonts, collections, boards, history and screenshots are stored in your browser on this computer. You can export them from the Library tab and delete them all in Settings > Privacy.
- The extension contacts Google Fonts (fonts.googleapis.com, fonts.gstatic.com and, if you add an API key, www.googleapis.com/webfonts) to load the catalogue and font previews. Google may see these requests as it does for any website using Google Fonts. It also downloads the page's own font files from the site that serves them, the same files your browser already loaded.
- No analytics, no tracking, no account, no advertising. Nothing about the pages you visit is sent anywhere.
- An optional Google Fonts API key is stored only in Chrome's local storage on this computer.

Contact: add your email here.

## Still needed before you submit

- Screenshots: 1280 x 800 (at least one, up to five). Take these after the redesign.
- Small promo tile: 440 x 280 (optional).
- Store icon: 128 x 128 (`public/icons/icon128.png`, replace after the redesign if the icon changes).
- A one-time developer registration fee is required to publish.
