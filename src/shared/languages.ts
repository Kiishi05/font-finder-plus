// Character sets each language needs (CJK uses common characters, see below). A font "supports" a language here when
// it has every character in `required`. These are the letters of each
// alphabet (precomposed forms), not a full typographic test.
export interface LanguagePack {
  code: string;
  label: string;
  script: string;
  required: string;
  /** Characters that are commonly used but not essential (tone marks and so on). */
  extra?: string;
}

const range = (a: number, b: number, skip: number[] = []) => {
  let s = '';
  for (let c = a; c <= b; c++) if (!skip.includes(c)) s += String.fromCodePoint(c);
  return s;
};

const BASIC = range(0x41, 0x5a) + range(0x61, 0x7a);

export const LANGUAGE_PACKS: LanguagePack[] = [
  // Latin script
  { code: 'en', label: 'English', script: 'Latin', required: BASIC + '0123456789' },
  { code: 'es', label: 'Spanish', script: 'Latin', required: BASIC + 'ÁÉÍÓÚÜÑáéíóúüñ¿¡' },
  { code: 'fr', label: 'French', script: 'Latin', required: BASIC + 'ÀÂÆÇÈÉÊËÎÏÔŒÙÛÜŸàâæçèéêëîïôœùûüÿ' },
  { code: 'de', label: 'German', script: 'Latin', required: BASIC + 'ÄÖÜäöüß' },
  { code: 'it', label: 'Italian', script: 'Latin', required: BASIC + 'ÀÈÉÌÒÙàèéìòù' },
  { code: 'pt', label: 'Portuguese', script: 'Latin', required: BASIC + 'ÁÂÃÀÇÉÊÍÓÔÕÚáâãàçéêíóôõú' },
  { code: 'nl', label: 'Dutch', script: 'Latin', required: BASIC + 'ËëÏïÉé' },
  { code: 'pl', label: 'Polish', script: 'Latin', required: BASIC + 'ĄąĆćĘęŁłŃńÓóŚśŹźŻż' },
  { code: 'cs', label: 'Czech', script: 'Latin', required: BASIC + 'ÁČĎÉĚÍŇÓŘŠŤÚŮÝŽáčďéěíňóřšťúůýž' },
  { code: 'ro', label: 'Romanian', script: 'Latin', required: BASIC + 'ĂÂÎȘȚăâîșț' },
  { code: 'hu', label: 'Hungarian', script: 'Latin', required: BASIC + 'ÁÉÍÓÖŐÚÜŰáéíóöőúüű' },
  { code: 'tr', label: 'Turkish', script: 'Latin', required: BASIC + 'ÇçĞğİıÖöŞşÜü' },
  { code: 'vi', label: 'Vietnamese', script: 'Latin', required: BASIC + 'ĂăÂâĐđÊêÔôƠơƯư' + range(0x1ea0, 0x1ef9) },
  { code: 'id', label: 'Indonesian and Malay', script: 'Latin', required: BASIC },
  { code: 'fil', label: 'Filipino', script: 'Latin', required: BASIC + 'Ññ' },
  { code: 'sw', label: 'Swahili', script: 'Latin', required: BASIC },
  { code: 'zu', label: 'Zulu', script: 'Latin', required: BASIC },
  { code: 'yo', label: 'Yoruba', script: 'Latin', required: BASIC + 'ẸẹỌọṢṣÀàÁáÈèÉéÌìÍíÒòÓóÙùÚúŃńǸǹ', extra: '̣̀́' },
  { code: 'ig', label: 'Igbo', script: 'Latin', required: BASIC + 'ỊịỌọỤụṄṅ', extra: '̀́̄' },
  { code: 'ha', label: 'Hausa', script: 'Latin', required: BASIC + 'ƁɓƊɗƘƙ', extra: 'Ƴƴʼ' },
  { code: 'tw', label: 'Twi (Akan)', script: 'Latin', required: BASIC + 'ƐɛƆɔ' },
  // Other scripts
  { code: 'ru', label: 'Russian', script: 'Cyrillic', required: range(0x410, 0x44f) + 'Ёё' },
  { code: 'uk', label: 'Ukrainian', script: 'Cyrillic', required: range(0x410, 0x44f) + 'ЄєІіЇїҐґ' },
  { code: 'el', label: 'Greek', script: 'Greek', required: range(0x391, 0x3a9, [0x3a2]) + range(0x3b1, 0x3c9) + 'ΆΈΉΊΌΎΏάέήίόύώ' },
  { code: 'ar', label: 'Arabic', script: 'Arabic', required: range(0x621, 0x63a) + range(0x641, 0x64a) },
  { code: 'fa', label: 'Persian', script: 'Arabic', required: range(0x621, 0x63a) + range(0x641, 0x648) + 'پچژگکی' },
  { code: 'he', label: 'Hebrew', script: 'Hebrew', required: range(0x5d0, 0x5ea) },
  { code: 'hi', label: 'Hindi', script: 'Devanagari', required: 'अआइईउऊऋएऐओऔकखगघङचछजझञटठडढणतथदधनपफबभमयरलवशषसहािीुूृेैोौंः्।' },
  { code: 'bn', label: 'Bengali', script: 'Bengali', required: 'অআইঈউঊঋএঐওঔকখগঘঙচছজঝঞটঠডঢণতথদধনপফবভমযরলশষসহািীুূৃেৈোৌ্' },
  { code: 'th', label: 'Thai', script: 'Thai', required: range(0xe01, 0xe2e) + range(0xe30, 0xe39) + range(0xe40, 0xe44) + range(0xe48, 0xe4b) },
  { code: 'am', label: 'Amharic', script: 'Ethiopic', required: range(0x1200, 0x1206) + range(0x1208, 0x120e) + range(0x1218, 0x121e) + range(0x1228, 0x122e) + range(0x1230, 0x1236) + range(0x1240, 0x1246) + range(0x1260, 0x1266) + range(0x1270, 0x1276) + range(0x1290, 0x1296) + range(0x12a0, 0x12a6) + range(0x12a8, 0x12ae) + range(0x12c8, 0x12ce) + range(0x12d8, 0x12de) + range(0x12e8, 0x12ee) + range(0x12f0, 0x12f6) + range(0x1308, 0x130e) + '።' },
  // Chinese, Japanese and Korean have thousands of characters. These check a
  // set of very common ones; a font with them is built for that language.
  { code: 'zh-hans', label: 'Chinese (Simplified)', script: 'Han', required: '的一是不了人我在有他这为之大来以个中上们早好你，。' },
  { code: 'zh-hant', label: 'Chinese (Traditional)', script: 'Han', required: '的一是不了人我在有他這為之大來以個中上們早安你好，。' },
  { code: 'ja', label: 'Japanese', script: 'Kana and Kanji', required: range(0x3041, 0x3093) + range(0x30a1, 0x30f6) + '日本語人。、' },
  { code: 'ko', label: 'Korean', script: 'Hangul', required: '가나다라마바사아자차카타파하한국어좋은아침입니다의는을' },
];

export interface PackResult {
  pack: LanguagePack;
  status: 'full' | 'partial' | 'none';
  missing: string[];
}

export function checkPacks(codepoints: Set<number>): PackResult[] {
  return LANGUAGE_PACKS.map((pack) => {
    const chars = [...pack.required];
    const missing = chars.filter((ch) => !codepoints.has(ch.codePointAt(0)!));
    const status = missing.length === 0 ? 'full' : missing.length === chars.length ? 'none' : 'partial';
    return { pack, status, missing };
  });
}

/** Every character any pack needs, for asking Google Fonts which ones a family has. */
export function allPackChars(): string {
  return [...new Set(LANGUAGE_PACKS.flatMap((p) => [...p.required]))].join('');
}
