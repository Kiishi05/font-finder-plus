// Unicode blocks used to group glyphs. Ranges are from the Unicode standard.
export const BLOCKS: [number, number, string][] = [
  [0x0000, 0x007f, 'Basic Latin'],
  [0x0080, 0x00ff, 'Latin-1 Supplement'],
  [0x0100, 0x017f, 'Latin Extended-A'],
  [0x0180, 0x024f, 'Latin Extended-B'],
  [0x0250, 0x02af, 'IPA Extensions'],
  [0x02b0, 0x02ff, 'Spacing Modifier Letters'],
  [0x0300, 0x036f, 'Combining Diacritical Marks'],
  [0x0370, 0x03ff, 'Greek and Coptic'],
  [0x0400, 0x04ff, 'Cyrillic'],
  [0x0500, 0x052f, 'Cyrillic Supplement'],
  [0x0530, 0x058f, 'Armenian'],
  [0x0590, 0x05ff, 'Hebrew'],
  [0x0600, 0x06ff, 'Arabic'],
  [0x0750, 0x077f, 'Arabic Supplement'],
  [0x0900, 0x097f, 'Devanagari'],
  [0x0e00, 0x0e7f, 'Thai'],
  [0x10a0, 0x10ff, 'Georgian'],
  [0x1200, 0x137f, 'Ethiopic'],
  [0x1ab0, 0x1aff, 'Combining Diacritical Marks Extended'],
  [0x1dc0, 0x1dff, 'Combining Diacritical Marks Supplement'],
  [0x1e00, 0x1eff, 'Latin Extended Additional'],
  [0x1f00, 0x1fff, 'Greek Extended'],
  [0x2000, 0x206f, 'General Punctuation'],
  [0x2070, 0x209f, 'Superscripts and Subscripts'],
  [0x20a0, 0x20cf, 'Currency Symbols'],
  [0x20d0, 0x20ff, 'Combining Marks for Symbols'],
  [0x2100, 0x214f, 'Letterlike Symbols'],
  [0x2150, 0x218f, 'Number Forms'],
  [0x2190, 0x21ff, 'Arrows'],
  [0x2200, 0x22ff, 'Mathematical Operators'],
  [0x2300, 0x23ff, 'Miscellaneous Technical'],
  [0x2460, 0x24ff, 'Enclosed Alphanumerics'],
  [0x2500, 0x257f, 'Box Drawing'],
  [0x2580, 0x259f, 'Block Elements'],
  [0x25a0, 0x25ff, 'Geometric Shapes'],
  [0x2600, 0x26ff, 'Miscellaneous Symbols'],
  [0x2700, 0x27bf, 'Dingbats'],
  [0x27c0, 0x27ef, 'Miscellaneous Mathematical Symbols-A'],
  [0x27f0, 0x27ff, 'Supplemental Arrows-A'],
  [0x2c60, 0x2c7f, 'Latin Extended-C'],
  [0x2e00, 0x2e7f, 'Supplemental Punctuation'],
  [0x3000, 0x303f, 'CJK Symbols and Punctuation'],
  [0x3040, 0x309f, 'Hiragana'],
  [0x30a0, 0x30ff, 'Katakana'],
  [0x4e00, 0x9fff, 'CJK Unified Ideographs'],
  [0xa720, 0xa7ff, 'Latin Extended-D'],
  [0xac00, 0xd7af, 'Hangul Syllables'],
  [0xe000, 0xf8ff, 'Private Use Area'],
  [0xfb00, 0xfb4f, 'Alphabetic Presentation Forms'],
  [0xfb50, 0xfdff, 'Arabic Presentation Forms-A'],
  [0xfe20, 0xfe2f, 'Combining Half Marks'],
  [0xfe70, 0xfeff, 'Arabic Presentation Forms-B'],
  [0xff00, 0xffef, 'Halfwidth and Fullwidth Forms'],
];

export function blockOf(cp: number): string {
  for (const [a, b, name] of BLOCKS) if (cp >= a && cp <= b) return name;
  return 'Other';
}

/** Characters with nothing to draw (controls, spaces) are left out of the glyph grid. */
export function isDrawable(cp: number): boolean {
  if (cp < 0x21 || (cp >= 0x7f && cp <= 0xa0)) return false;
  if (cp === 0xad || (cp >= 0x2000 && cp <= 0x200f) || (cp >= 0x2028 && cp <= 0x202f) || cp === 0x205f || cp === 0x3000 || cp === 0xfeff) return false;
  return true;
}

export function isCombining(cp: number): boolean {
  return (cp >= 0x300 && cp <= 0x36f) || (cp >= 0x1ab0 && cp <= 0x1aff) || (cp >= 0x1dc0 && cp <= 0x1dff) || (cp >= 0x20d0 && cp <= 0x20ff) || (cp >= 0xfe20 && cp <= 0xfe2f);
}

export const hex = (cp: number) => cp.toString(16).toUpperCase().padStart(4, '0');
