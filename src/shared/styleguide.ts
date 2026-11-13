// Turns a page's many text styles into a tidy type system for a style guide:
// near-duplicates merged, grouped (headings, body, buttons and labels, code)
// and named the way designers name them (Heading 1 (H1), Body Large (body-lg)).
import type { FigmaStyle } from './figma-payload';

export type StyleGroup = 'Headings' | 'Body' | 'Buttons & labels' | 'Code';
export const GROUP_ORDER: StyleGroup[] = ['Headings', 'Body', 'Buttons & labels', 'Code'];

export interface GuideStyle extends FigmaStyle {
  group: StyleGroup;
  /** "Heading 1 (H1)", "Body Large (body-lg)". */
  label: string;
  /** Short name for the Figma style: "H1", "body-lg". */
  token: string;
}

function groupOf(name: string): StyleGroup {
  if (/^(h[1-6]|display)/.test(name)) return 'Headings';
  if (/^(button|link|nav|caption)/.test(name)) return 'Buttons & labels';
  if (/^code/.test(name)) return 'Code';
  return 'Body';
}

const SIZE_WORDS = [['xl', 'Extra Large'], ['lg', 'Large'], ['md', 'Medium'], ['sm', 'Small'], ['xs', 'Extra Small'], ['xxs', 'Tiny']] as const;

/** Merge styles that look the same (same font, weight and style; size within 1px; line height within 2px). */
function merge(styles: FigmaStyle[]): FigmaStyle[] {
  const out: FigmaStyle[] = [];
  for (const s of [...styles].sort((a, b) => b.count - a.count)) {
    const twin = out.find(
      (o) =>
        o.fontKey === s.fontKey && o.weight === s.weight && o.style === s.style && o.transform === s.transform &&
        Math.abs(o.size - s.size) <= 1 && Math.abs((o.lineHeight ?? o.size * 1.2) - (s.lineHeight ?? s.size * 1.2)) <= 2 &&
        groupOf(o.name) === groupOf(s.name),
    );
    if (twin) twin.count += s.count;
    else out.push({ ...s });
  }
  return out;
}

/** At most `max` styles: every heading, then the most used of the rest. */
export function organizeStyles(styles: FigmaStyle[], max = 16): GuideStyle[] {
  const merged = merge(styles);
  const headings = merged.filter((s) => groupOf(s.name) === 'Headings').sort((a, b) => b.size - a.size).slice(0, 6);
  const rest = merged.filter((s) => groupOf(s.name) !== 'Headings').sort((a, b) => b.count - a.count).slice(0, Math.max(4, max - headings.length));
  const out: GuideStyle[] = [];
  headings.forEach((s, i) => out.push({ ...s, group: 'Headings', label: `Heading ${i + 1} (H${i + 1})`, token: `H${i + 1}` }));
  for (const g of ['Body', 'Buttons & labels', 'Code'] as StyleGroup[]) {
    const list = rest.filter((s) => groupOf(s.name) === g).sort((a, b) => b.size - a.size);
    // Size words from the middle out: one style is "md"; two are "lg" and "md"; and so on.
    const start = Math.max(0, 2 - Math.floor((list.length - 1) / 2));
    list.forEach((s, i) => {
      const [short, long] = SIZE_WORDS[Math.min(SIZE_WORDS.length - 1, start + i)];
      const base = g === 'Body' ? 'body' : g === 'Code' ? 'code' : /^link/.test(s.name) ? 'link' : 'button';
      const title = g === 'Body' ? 'Body' : g === 'Code' ? 'Code' : base === 'link' ? 'Link' : 'Button/Tag';
      const token = list.length === 1 && g !== 'Body' ? base : `${base}-${short}`;
      out.push({ ...s, group: g, label: list.length === 1 && g !== 'Body' ? title : `${title} ${long} (${token})`, token });
    });
  }
  return out;
}

/** Letter spacing as designers write it: a percentage of the size ("-1.5%"). */
export const spacingPercent = (s: { letterSpacing: number; size: number }) => {
  const v = Math.round((s.letterSpacing / s.size) * 1000) / 10;
  return v === 0 ? '0%' : `${v}%`;
};

export const weightName = (w: string) =>
  ({ '100': 'Thin', '200': 'Extra Light', '300': 'Light', '400': 'Regular', '500': 'Medium', '600': 'Semi Bold', '700': 'Bold', '800': 'Extra Bold', '900': 'Black' } as Record<string, string>)[String(Math.round(Number(w) / 100) * 100)] ?? w;
