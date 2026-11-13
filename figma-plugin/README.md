# Font Finder Plus for Figma

The Figma half of Font Finder Plus. The Chrome extension reads a website's real fonts and text styles. This plugin brings them into Figma:

- **Installed or not.** Each font is marked as installed in Figma or not, using the fonts Figma itself lists (your computer's fonts, Google Fonts built into Figma and your team's shared fonts).
- **Free stand-ins.** A font you do not have is replaced by its closest free Google Fonts look-alike (matched by letter shapes and proportions). You can pick another from the list.
- **Text styles and variables.** One text style per style on the site (named `example.com/h1`, `example.com/body`...), with size, line height, letter spacing and case. Sizes and line heights are also variables, bound to the styles. A variable per font records which family is in use.
- **A specimen page.** Each font drawn in the real font (vector outlines from its file, or a picture of how the page draws it when the file cannot be read), its licence in plain words, foundry, where to get it, and the text styles.
- **Check again.** After you install a missing font, reopen the plugin and click **Check again for installed fonts**. Every style that used a stand-in switches to the real font.

Licence summaries are summaries, not legal advice. "Unknown" means unknown: nothing is guessed.

## Privacy

The plugin makes no network requests (`"networkAccess": { "allowedDomains": ["none"] }` in `manifest.json`). It only reads what you paste.

## Try it (Figma desktop app)

1. Build it: `npm run build:figma` (from the project folder). This writes `figma-plugin/dist/`.
2. In the Figma desktop app, open any design file.
3. Menu > **Plugins > Development > Import plugin from manifest…** and choose `figma-plugin/manifest.json`.
4. In Chrome, open a website, click the Font Finder Plus icon, then **Send to Figma** (bottom of the Page tab, or the Figma section of the System tab).
5. In Figma, run **Plugins > Development > Font Finder Plus**, click the paste area and press Cmd+V (Mac) or Ctrl+V (Windows).
6. Choose what to create and click **Create in Figma**.

Plugins in development only run in the desktop app. Once published to the Figma Community it also runs in the browser.

## Publish to the Figma Community

1. In the Figma desktop app: **Plugins > Development > Manage plugins in development**, find Font Finder Plus, then **Publish**.
2. Figma gives the plugin a real ID. Put it in `manifest.json` (replace `font-finder-plus-dev`).
3. Add a cover image (1920 × 1080), an icon (128 × 128), a description and a support contact. Figma reviews new plugins before they go live.

## Files

```
figma-plugin/
  manifest.json   plugin settings (no network access)
  src/code.ts     runs in Figma: checks fonts, makes styles, variables and the specimen page
  src/ui.ts       the plugin window: paste, font list, stand-in choice
  src/ui.html     the window's layout and styles (uses Figma's theme colours)
  src/match.ts    matching site fonts to Figma's fonts (weights to style names)
  dist/           built files (npm run build:figma)
```

The pasted format is defined in `src/shared/figma-payload.ts`, shared with the extension. Tests: `node tests/figma.mjs` runs the plugin against a stand-in for Figma that is as strict as the real one about loading fonts, and drives the window in a browser.
