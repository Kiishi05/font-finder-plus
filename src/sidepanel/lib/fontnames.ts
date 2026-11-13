// Finds font names written in an image ("Font: Clash Display", or a list of
// names under each sample). Names are checked against the Google Fonts
// catalogue and the known foundry list; nothing is guessed beyond those.
import { allGoogleFamilies, googleFamily } from '../../shared/catalog';
import { knownFont, knownFontNames, type KnownFont } from '../../shared/licences';
import { allFreeFonts } from '../../shared/freecatalog';
import type { OcrLine } from './ocr';

export interface NamedFont {
  name: string;
  /** google: in the Google Fonts catalogue. known: in the known foundry list. unknown: looks like the font's name, but is in no list we have. */
  kind: 'google' | 'known' | 'unknown';
  known: KnownFont | null;
  /** Index of the line it was read from. */
  line: number;
}

const squash = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');

let index: Map<string, { name: string; kind: NamedFont['kind']; known: KnownFont | null; free?: boolean }> | null = null;
function getIndex() {
  if (index) return index;
  index = new Map();
  for (const { name, known } of knownFontNames()) index.set(squash(name), { name, kind: known.licence === 'OFL' && googleFamily(name) ? 'google' : 'known', known });
  for (const name of allGoogleFamilies()) if (!index.has(squash(name))) index.set(squash(name), { name, kind: 'google', known: null });
  // Free fonts from Fontshare, Font Squirrel and open-source foundries.
  for (const f of allFreeFonts()) if (!index.has(squash(f.name))) index.set(squash(f.name), { name: f.name, kind: 'known', known: knownFont(f.name), free: true });
  return index;
}

// Words around a name that say it is a font.
const STRONG_CUE = /\b(fonts?|typefaces?|typography|font:)/i;
const CUE = /\b(fonts?|typefaces?|typography|using|use|set in|in|heading|headings|body|title|titles)\b/i;
const STYLE = /\b(thin|hairline|extra ?light|light|regular|book|medium|semi ?bold|bold|extra ?bold|black|heavy|italic|condensed|display)\b/gi;
// Font names that are also everyday English words: only counted next to "font" or similar.
const EVERYDAY = new Set(['play', 'share', 'average', 'outfit', 'prompt', 'ultra', 'inter', 'cookie', 'sail', 'satisfy', 'actor', 'charm', 'basic', 'italic', 'gothic', 'acme', 'jost', 'lustria', 'molle', 'offside', 'oregano', 'quando', 'convergence', 'judson', 'author', 'supreme', 'synonym', 'tanker', 'pitch', 'national', 'metric', 'platform', 'decimal', 'operator', 'brown', 'replica', 'mercury', 'archer', 'chronicle', 'sentinel', 'knockout', 'obsidian', 'intro', 'obviously', 'social', 'oracle', 'value', 'stardom', 'melodrama', 'rowan', 'mate', 'gruppo', 'scada', 'viga', 'voces', 'unna', 'abel', 'sumana', 'amaranth', 'neuton', 'prata', 'basic', 'belleza', 'philosopher', 'sacramento', 'monoton', 'boogaloo', 'questrial', 'galada', 'oi', 'jura', 'teko', 'cabin', 'domine', 'arvo', 'lobster', 'pacifico', 'righteous', 'bangers', 'creepster', 'handlee', 'tangerine', 'voltaire', 'smooch', 'yesteryear', 'parisienne', 'redressed', 'marmelad', 'stalemate', 'signika', 'sriracha', 'barlow', 'bitter', 'cardo', 'exo', 'hind', 'mukta', 'martel', 'rambla', 'rosario', 'courgette', 'damion']);

export function findFontNames(lines: OcrLine[]): NamedFont[] {
  const ix = getIndex();
  const found = new Map<string, NamedFont>();
  // Does the image talk about fonts anywhere ("10 fonts you need")?
  const aboutFonts = lines.some((l) => STRONG_CUE.test(l.text));
  lines.forEach((l, li) => {
    const words = l.text.split(/[^A-Za-z0-9&'’]+/).filter(Boolean);
    const strong = STRONG_CUE.test(l.text);
    const cue = CUE.test(l.text);
    const short = words.length <= 4;
    // The line is only a name, maybe with a style ("Montserrat Bold", "3. Satoshi").
    const bare = squash(l.text.replace(STYLE, ' ').replace(/^\s*\d+[.)]?\s*/, ''));
    const whole = ix.get(bare);
    if (whole && bare.length >= 3 && (!EVERYDAY.has(bare) || aboutFonts) && (!whole.free || aboutFonts || bare.length >= 8)) {
      if (!found.has(whole.name)) found.set(whole.name, { name: whole.name, kind: whole.kind, known: whole.known, line: li });
      return;
    }
    const used = new Array(words.length).fill(false);
    for (let n = Math.min(4, words.length); n >= 1; n--) {
      for (let i = 0; i + n <= words.length; i++) {
        if (used.slice(i, i + n).some(Boolean)) continue;
        const key = squash(words.slice(i, i + n).join(' '));
        if (key.length < 4) continue;
        const hit = ix.get(key);
        if (!hit) continue;
        if (n === 1) {
          const capital = /^[A-Z0-9]/.test(words[i]);
          if (!capital) continue;
          // One-word names from the large free lists (many are everyday words) need a post about fonts.
          if (hit.free && !aboutFonts) continue;
          if (EVERYDAY.has(key) ? !strong : !(cue || short)) continue;
        }
        for (let k = i; k < i + n; k++) used[k] = true;
        if (!found.has(hit.name)) found.set(hit.name, { name: hit.name, kind: hit.kind, known: hit.known, line: li });
      }
    }
  });
  return [...found.values()];
}

// Words in a post that show it is about a typeface ("is an Helvetica-inspired typeface with 7 weights").
const ABOUT_TYPE = /\b(fonts?|typefaces?|typography|type family|glyphs?|weights?|specimen|-inspired|inspired by|designed by|foundry|free for)\b/i;
const COMMON_HEADINGS = /^(the|a|an|new|free|best|top|font|fonts|typeface|typography|design|hello|welcome)$/i;

/**
 * A name the picture seems to be about, even if it is in no list we have: in a
 * post about a typeface, the biggest short heading is usually the font's name
 * ("Amiamie"). Returned as "unknown", never guessed further.
 */
export function possibleName(lines: OcrLine[], headingLine: number | null, known: NamedFont[]): NamedFont | null {
  if (headingLine == null || !lines.some((l) => ABOUT_TYPE.test(l.text))) return null;
  const text = lines[headingLine]?.text.trim() ?? '';
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length || words.length > 3 || text.length < 3 || text.length > 30) return null;
  if (!words.every((w) => /^[A-Z0-9][\p{L}0-9'’&.-]*$/u.test(w)) || words.some((w) => COMMON_HEADINGS.test(w))) return null;
  if (known.some((n) => squash(n.name) === squash(text))) return null;
  return { name: text.replace(/[.:!]+$/, ''), kind: 'unknown', known: null, line: headingLine };
}

// ------------------------------------------------------------- names in the post around a picture

// "site.com/fonts/lil-grot… — Lil Grotesk": a link to a font page, then its name (or the other way round).
const NAME = "([A-Z0-9][\\p{L}0-9'’&.]*(?:[ -][A-Z0-9][\\p{L}0-9'’&.]*){0,3})";
const FONT_LINK = "(?:https?://)?[\\w.-]+\\.[a-z]{2,}/\\S*(?:font|type|typeface|fonts|family|families)\\S*";
const LINK_THEN_NAME = new RegExp(`${FONT_LINK}\\s*[—–:-]+\\s*${NAME}`, 'gu');
const NAME_THEN_LINK = new RegExp(`${NAME}\\s*[—–:-]+\\s*${FONT_LINK}`, 'gu');
// "Font: Lil Grotesk", "Typeface — Amiamie", "set in Söhne".
const LABELLED = new RegExp(`\\b(?:font|typeface|type|set in|fonts? used|typefaces? used)\\s*[:—–-]+\\s*${NAME}`, 'giu');

/**
 * Font names in the text around a picture (alt text, the post it is in). Names
 * in a catalogue are confirmed; others are only taken when the post clearly
 * names them (next to a link to a font page, or after "Font:"), and are shown
 * as not confirmed.
 */
export function namesFromContext(context: string[] | undefined): NamedFont[] {
  if (!context?.length) return [];
  const ix = getIndex();
  const found = new Map<string, NamedFont>();
  const add = (raw: string, sure: boolean) => {
    const name = raw.trim().replace(/[.,:;!?…]+$/, '');
    const words = name.split(/\s+/);
    if (name.length < 3 || name.length > 40 || words.length > 4 || words.some((w) => COMMON_HEADINGS.test(w))) return;
    const hit = ix.get(squash(name.replace(STYLE, ' ')));
    if (hit) {
      if (!found.has(hit.name)) found.set(hit.name, { name: hit.name, kind: hit.kind, known: hit.known, line: -1 });
    } else if (sure && ![...found.keys()].some((k) => squash(k) === squash(name))) {
      found.set(name, { name, kind: 'unknown', known: null, line: -1 });
    }
  };
  const text = context.join('\n');
  for (const re of [LINK_THEN_NAME, NAME_THEN_LINK, LABELLED]) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) add(m[1], true);
  }
  // Catalogue names anywhere in a post that is about type ("Lunchtype", "Satoshi").
  if (ABOUT_TYPE.test(text) || found.size) {
    const lines: OcrLine[] = context.map((t) => ({ text: t, confidence: 100, bbox: { x0: 0, y0: 0, x1: 0, y1: 0 }, baseline: null, symbols: [] }));
    for (const n of findFontNames(lines)) if (!found.has(n.name)) found.set(n.name, { ...n, line: -1 });
  }
  return [...found.values()].slice(0, 8);
}
