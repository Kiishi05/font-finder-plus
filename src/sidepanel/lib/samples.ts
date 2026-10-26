// Sample sentences for previewing fonts in other languages. Pangrams are
// well-known ones; the others are short everyday phrases plus the letters each
// language needs, so missing characters are easy to spot.
export interface LanguageSample {
  code: string;
  label: string;
  text: string;
}

export const LANGUAGE_SAMPLES: LanguageSample[] = [
  { code: 'en', label: 'English', text: 'The quick brown fox jumps over the lazy dog' },
  { code: 'yo', label: 'Yoruba', text: 'Ẹ káàárọ̀ · Ẹ ẹ Ọ ọ Ṣ ṣ À á È é Ì í Ò ó Ù ú' },
  { code: 'ig', label: 'Igbo', text: 'Ụtụtụ ọma · Ị ị Ọ ọ Ụ ụ Ṅ ṅ' },
  { code: 'ha', label: 'Hausa', text: 'Barka da safiya · Ɓ ɓ Ɗ ɗ Ƙ ƙ ƴ' },
  { code: 'sw', label: 'Swahili', text: 'Habari za asubuhi · Karibu sana' },
  { code: 'tw', label: 'Twi', text: 'Maakye · Ɛ ɛ Ɔ ɔ' },
  { code: 'ar', label: 'Arabic', text: 'صباح الخير' },
  { code: 'am', label: 'Amharic', text: 'ሰላም · ኢትዮጵያ' },
  { code: 'vi', label: 'Vietnamese', text: 'Chào buổi sáng · Tiếng Việt' },
  { code: 'ru', label: 'Russian (Cyrillic)', text: 'Съешь же ещё этих мягких французских булок, да выпей чаю' },
  { code: 'el', label: 'Greek', text: 'Ξεσκεπάζω την ψυχοφθόρα βδελυγμία' },
  { code: 'pl', label: 'Polish', text: 'Pchnąć w tę łódź jeża lub ośm skrzyń fig' },
  { code: 'tr', label: 'Turkish', text: 'Pijamalı hasta yağız şoföre çabucak güvendi' },
  { code: 'de', label: 'German', text: 'Zwölf Boxkämpfer jagen Viktor quer über den großen Sylter Deich' },
  { code: 'fr', label: 'French', text: 'Portez ce vieux whisky au juge blond qui fume' },
  { code: 'es', label: 'Spanish', text: 'El veloz murciélago hindú comía feliz cardillo y kiwi' },
];

export function languageSample(code: string): LanguageSample {
  return LANGUAGE_SAMPLES.find((l) => l.code === code) ?? LANGUAGE_SAMPLES[0];
}
