// Telling text that was really read from noise (no recognition library here, so tests can load it).
import type { OcrLine } from './ocr';

/** A word that reads like a word: lower case, Capitalised or ALL CAPS letters, or a number. */
const WORDLIKE = /^(?:[A-Za-z][a-z]+(?:['’][a-z]+)?|[A-Z]{2,}|[0-9][0-9.,:%]*|[A-Za-z]&[A-Za-z])$/;

/** How many letters of the line are in real-looking words (3 letters or more, or numbers). */
export function wordLetters(text: string): number {
  return text
    .split(/[\s.,;:!?"“”()[\]{}/|·•—–-]+/)
    .filter((w) => (w.length >= 3 || /^[0-9]{2,}$/.test(w)) && WORDLIKE.test(w))
    .reduce((n, w) => n + w.length, 0);
}

/**
 * Lines that were really read: Tesseract also "reads" icons, photos and
 * textures as strings like "CEgl es — — Es". A line is kept when enough of it
 * is real-looking words and it was read with reasonable confidence.
 */
export function realLines(lines: OcrLine[]): OcrLine[] {
  return lines.filter((l) => {
    const chars = l.text.replace(/\s/g, '').length;
    if (!chars) return false;
    const share = wordLetters(l.text) / chars;
    if (l.confidence >= 70) return share >= 0.4;
    if (l.confidence >= 45) return share >= 0.65 && wordLetters(l.text) >= 3;
    return false;
  });
}

