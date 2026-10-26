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
  { code: 'es', label: 'Spanish', text: 'El veloz murciélago hindú comía feliz cardillo y kiwi' },
  { code: 'fr', label: 'French', text: 'Portez ce vieux whisky au juge blond qui fume' },
  { code: 'de', label: 'German', text: 'Zwölf Boxkämpfer jagen Viktor quer über den großen Sylter Deich' },
  { code: 'it', label: 'Italian', text: 'Ma la volpe, col suo balzo, ha raggiunto il quieto Fido' },
  { code: 'pt', label: 'Portuguese', text: 'Luís argüia à Júlia que «brações, fé, chá, óxido, pôr, zângão» eram palavras do português' },
  { code: 'nl', label: 'Dutch', text: "Pa's wijze lynx bezag vroom het fikse aquaduct" },
  { code: 'pl', label: 'Polish', text: 'Pchnąć w tę łódź jeża lub ośm skrzyń fig' },
  { code: 'cs', label: 'Czech', text: 'Příliš žluťoučký kůň úpěl ďábelské ódy' },
  { code: 'ro', label: 'Romanian', text: 'Bună dimineața' },
  { code: 'hu', label: 'Hungarian', text: 'Árvíztűrő tükörfúrógép' },
  { code: 'tr', label: 'Turkish', text: 'Pijamalı hasta yağız şoföre çabucak güvendi' },
  { code: 'vi', label: 'Vietnamese', text: 'Chào buổi sáng · Tiếng Việt' },
  { code: 'id', label: 'Indonesian and Malay', text: 'Selamat pagi' },
  { code: 'fil', label: 'Filipino', text: 'Magandang umaga' },
  { code: 'sw', label: 'Swahili', text: 'Habari za asubuhi · Karibu sana' },
  { code: 'zu', label: 'Zulu', text: 'Sawubona' },
  { code: 'yo', label: 'Yoruba', text: 'Ẹ káàárọ̀ · Ẹ ẹ Ọ ọ Ṣ ṣ À á È é Ì í Ò ó Ù ú' },
  { code: 'ig', label: 'Igbo', text: 'Ụtụtụ ọma · Ị ị Ọ ọ Ụ ụ Ṅ ṅ' },
  { code: 'ha', label: 'Hausa', text: 'Barka da safiya · Ɓ ɓ Ɗ ɗ Ƙ ƙ' },
  { code: 'tw', label: 'Twi (Akan)', text: 'Maakye · Ɛ ɛ Ɔ ɔ' },
  { code: 'ru', label: 'Russian', text: 'Съешь же ещё этих мягких французских булок, да выпей чаю' },
  { code: 'uk', label: 'Ukrainian', text: 'Добрий ранок' },
  { code: 'el', label: 'Greek', text: 'Ξεσκεπάζω την ψυχοφθόρα βδελυγμία' },
  { code: 'ar', label: 'Arabic', text: 'صباح الخير' },
  { code: 'fa', label: 'Persian', text: 'صبح بخیر' },
  { code: 'he', label: 'Hebrew', text: 'בוקר טוב' },
  { code: 'hi', label: 'Hindi', text: 'नमस्ते · सुप्रभात' },
  { code: 'bn', label: 'Bengali', text: 'শুভ সকাল' },
  { code: 'th', label: 'Thai', text: 'สวัสดีตอนเช้า' },
  { code: 'am', label: 'Amharic', text: 'ሰላም · ኢትዮጵያ' },
  { code: 'zh-hans', label: 'Chinese (Simplified)', text: '早上好，你好' },
  { code: 'zh-hant', label: 'Chinese (Traditional)', text: '早安，你好' },
  { code: 'ja', label: 'Japanese', text: 'おはようございます' },
  { code: 'ko', label: 'Korean', text: '좋은 아침입니다' },
];

export function languageSample(code: string): LanguageSample {
  return LANGUAGE_SAMPLES.find((l) => l.code === code) ?? LANGUAGE_SAMPLES[0];
}
